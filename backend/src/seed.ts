import { TEST_EMAILS, hashPassword } from './auth.ts';
import { type Db, transaction } from './db.ts';
import { type Day, addDays, dayStart, localDate } from './days.ts';
import { ApiError } from './errors.ts';
import { pickCards } from './challenges.ts';
import { nowForNewUser } from './time.ts';

const PASSWORD = 'pullday123'; // from brief.md
const HOUR = 3_600_000;

type Account = { db: Db; userId: string; today: Day; noon: (day: Day) => Date };

/** Days done in a row, each with the card it gave. The last one is `lastDay`. */
async function playedDays({ db, userId, noon }: Account, count: number, lastDay: Day): Promise<void> {
  const cards = await db.query<{ id: string }>('select id from cards order by md5(id || $1) limit $2', [userId, count]);
  for (let i = 0; i < count; i++) {
    const day = addDays(lastDay, -i);
    const reward = cards.rows[i]!.id;
    const at = noon(day);
    const made = await db.query<{ id: string }>(
      `insert into challenges (user_id, day, card_ids, reward_card_id, started_at, completed_at, answers)
       values ($1, $2, $3, $4, $5, $5, array_fill('common'::text, array[8])) returning id`,
      [userId, day, await pickCards(reward), reward, at],
    );
    await db.query(
      `insert into collection (user_id, card_id, acquired_at, challenge_id, reveal_seen_at) values ($1, $2, $3, $4, $3)`,
      [userId, reward, at, made.rows[0]!.id],
    );
    await db.query(`insert into day_records (user_id, day, status) values ($1, $2, 'done')`, [userId, day]);
  }
}

const settledThrough = (account: Account, day: Day) =>
  account.db.query('update users set settled_through = $2 where id = $1', [account.userId, day]);

/** Each account from brief.md, relative to today. The missed days are settled on first contact. */
const STATES: Record<string, (account: Account) => Promise<unknown>> = {
  'new@pullday.test': async () => {},
  'today@pullday.test': (account) => playedDays(account, 12, addDays(account.today, -1)),
  'done@pullday.test': (account) => playedDays(account, 30, account.today),
  'freeze@pullday.test': async (account) => {
    const missed = addDays(account.today, -1);
    await playedDays(account, 7, addDays(missed, -1));
    await account.db.query('insert into freezes (user_id, purchased_at) values ($1, $2)', [
      account.userId,
      account.noon(addDays(missed, -2)),
    ]);
    await settledThrough(account, addDays(missed, -1));
  },
  'broken@pullday.test': async (account) => {
    const missed = addDays(account.today, -1);
    await playedDays(account, 40, addDays(missed, -1));
    await settledThrough(account, addDays(missed, -1));
  },
  'collector@pullday.test': async ({ db, userId, noon, today }) => {
    await db.query(
      `insert into collection (user_id, card_id, acquired_at, reveal_seen_at)
       select $1::uuid, id, $2, $2 from (select id from cards order by md5(id || $1::uuid::text) limit 300) c`,
      [userId, noon(addDays(today, -1))],
    );
    await db.query(
      `insert into binder_slots (user_id, page, slot, card_id)
       select $1, (n - 1) / 9 + 1, (n - 1) % 9 + 1, card_id
         from (select card_id, row_number() over (order by card_id)::int as n from collection where user_id = $1) c
        where n <= 5 * 9`,
      [userId],
    );
  },
};

/**
 * Put a test account in its state from brief.md as of right now, making it if needed.
 * The account keeps its sessions, so a phone that is logged in stays logged in.
 */
export async function resetAccount(email: string, timezone?: string): Promise<void> {
  const state = STATES[email];
  if (!state) throw new ApiError(404, 'not_a_test_account', 'That is not a test account.');
  const passwordHash = await hashPassword(PASSWORD);
  const at = nowForNewUser();

  await transaction(async (db) => {
    const found = await db.query<{ id: string }>('select id from users where email = $1 for update', [email]);
    const existing = found.rows[0]?.id;
    let tz = timezone;
    if (!tz && existing) {
      const zones = await db.query<{ tz: string }>(
        'select tz from user_timezones where user_id = $1 order by from_day desc limit 1',
        [existing],
      );
      tz = zones.rows[0]?.tz;
    }
    tz ??= Intl.DateTimeFormat().resolvedOptions().timeZone;
    const today = localDate(at, tz);
    const before = addDays(today, -1);

    let userId: string;
    if (existing) {
      userId = existing;
      for (const table of ['binder_slots', 'collection', 'challenges', 'freezes', 'day_records', 'streak_breaks', 'win_back_payments', 'user_timezones']) {
        await db.query(`delete from ${table} where user_id = $1`, [userId]);
      }
      await db.query(
        `update users set password_hash = $2, is_test = true, dev_offset_ms = 0, settled_through = $3, created_at = $4 where id = $1`,
        [userId, passwordHash, before, at],
      );
    } else {
      const made = await db.query<{ id: string }>(
        `insert into users (email, password_hash, is_test, settled_through, created_at) values ($1, $2, true, $3, $4) returning id`,
        [email, passwordHash, before, at],
      );
      userId = made.rows[0]!.id;
    }
    const zones = [{ from_day: addDays(today, -60), tz }];
    await db.query('insert into user_timezones (user_id, from_day, tz) values ($1, $2, $3)', [userId, zones[0]!.from_day, tz]);
    // Never in the future: today's card for done@ is dated now if it is still morning.
    const noon = (day: Day) => new Date(Math.min(dayStart(zones, day).getTime() + 12 * HOUR, at.getTime()));
    await state({ db, userId, today, noon });
  });
}

export async function seedAll(timezone?: string): Promise<void> {
  for (const email of TEST_EMAILS) await resetAccount(email, timezone);
}
