import { type User, getZones } from './auth.ts';
import type { Db } from './db.ts';
import { type Day, type Zone, GRACE_MS, SHORT_DAY_MS, WIN_BACK_MS, addDays, currentDay, dayEnd, dayLength } from './days.ts';
import { ApiError } from './errors.ts';
import { now } from './time.ts';

export type Status = 'done' | 'frozen' | 'won_back';
export const MAX_FREEZES = 2;
export const FREEZE_PRICE_CENTS = 199;
export const WIN_BACK_PRICE_CENTS = 499;

async function getRecords(db: Db, userId: string): Promise<Map<Day, Status>> {
  const found = await db.query<{ day: Day; status: Status }>('select day, status from day_records where user_id = $1', [
    userId,
  ]);
  return new Map(found.rows.map((row) => [row.day, row.status]));
}

/**
 * The streak as of a day: done days in the unbroken run of records that ends there.
 * Frozen and won back days hold the run together without adding to it. Days that are not
 * settled yet (today, or yesterday while a started challenge can still be finished) are
 * not missed, so they are stepped over.
 */
export function countStreak(records: Map<Day, Status>, asOf: Day, settledThrough: Day): number {
  let count = 0;
  for (let day = asOf; ; day = addDays(day, -1)) {
    const status = records.get(day);
    if (status === 'done') count++;
    else if (!status && day <= settledThrough) return count;
  }
}

/** A day that has ended, but whose started challenge can still be finished. */
async function stillOpen(db: Db, userId: string, day: Day, end: Date, at: Date): Promise<boolean> {
  if (at.getTime() - end.getTime() > GRACE_MS) return false;
  const found = await db.query(
    'select 1 from challenges where user_id = $1 and day = $2 and completed_at is null and started_at < $3',
    [userId, day, end],
  );
  return Boolean(found.rowCount);
}

/**
 * Make every ended day final, oldest first. The caller holds the user lock.
 * A missed day uses the oldest freeze bought before that day ended, or breaks the streak.
 */
export async function settle(db: Db, user: User, zones: Zone[], at: Date): Promise<void> {
  const today = currentDay(zones, at);
  const last = addDays(today, -1);
  if (user.settled_through >= last) return;

  const records = await getRecords(db, user.id);
  let settled = user.settled_through;
  while (settled < last) {
    const day = addDays(settled, 1);
    if (!records.has(day)) {
      const end = dayEnd(zones, day);
      if (await stillOpen(db, user.id, day, end, at)) break;
      const alive = records.has(addDays(day, -1));
      if (alive) {
        const free = dayLength(zones, day) < SHORT_DAY_MS; // too short to play, so it costs nothing
        const used = free
          ? null
          : await db.query(
              `update freezes set used_on_day = $2
                where id = (select id from freezes
                             where user_id = $1 and used_on_day is null and refund_due_at is null and purchased_at < $3
                             order by purchased_at, id limit 1)`,
              [user.id, day, end],
            );
        if (free || used?.rowCount) {
          await db.query(`insert into day_records (user_id, day, status) values ($1, $2, 'frozen')`, [user.id, day]);
          records.set(day, 'frozen');
        } else {
          await db.query(
            'insert into streak_breaks (user_id, missed_day, broke_at) values ($1, $2, $3) on conflict do nothing',
            [user.id, day, end],
          );
        }
      }
    }
    settled = day;
  }
  await db.query('update users set settled_through = $2 where id = $1', [user.id, settled]);
  user.settled_through = settled;
}

/**
 * A day in the past turned out to be done. Undo what was settled from that day on and settle
 * it again, so the result is what it would have been had we known at the time.
 */
export async function replay(db: Db, user: User, zones: Zone[], from: Day, at: Date): Promise<void> {
  if (from > user.settled_through) return settle(db, user, zones, at);
  await db.query('update freezes set used_on_day = null where user_id = $1 and used_on_day >= $2', [user.id, from]);
  await db.query(`delete from day_records where user_id = $1 and day >= $2 and status = 'frozen'`, [user.id, from]);
  await db.query('delete from streak_breaks where user_id = $1 and missed_day >= $2 and won_back_at is null', [
    user.id,
    from,
  ]);
  user.settled_through = addDays(from, -1);
  await settle(db, user, zones, at);
  // A freeze that came back while 2 newer ones are held would make 3. The limit is 2, so it is
  // owed as money instead.
  await db.query(
    `update freezes set refund_due_at = $2 where id in (
       select id from freezes where user_id = $1 and used_on_day is null and refund_due_at is null
        order by purchased_at desc, id desc offset $3)`,
    [user.id, at, MAX_FREEZES],
  );
}

/** The oldest break that can still be won back. It covers every later one. */
async function openBreak(db: Db, userId: string, at: Date) {
  const found = await db.query<{ missed_day: Day; broke_at: Date }>(
    `select missed_day, broke_at from streak_breaks
      where user_id = $1 and won_back_at is null and broke_at > $2 order by missed_day limit 1`,
    [userId, new Date(at.getTime() - WIN_BACK_MS)],
  );
  return found.rows[0] ?? null;
}

/**
 * Fill every missed day since the break. Days done after it are already there, so they join up.
 * Payment is checked by the caller. There is no endpoint yet.
 */
export async function winBack(db: Db, user: User): Promise<void> {
  const at = now(user);
  const zones = await getZones(db, user.id);
  await settle(db, user, zones, at);
  const broken = await openBreak(db, user.id, at);
  if (!broken) throw new ApiError(409, 'no_win_back', 'There is no streak to win back.');
  for (let day = broken.missed_day; day <= user.settled_through; day = addDays(day, 1)) {
    await db.query(
      `insert into day_records (user_id, day, status) values ($1, $2, 'won_back') on conflict do nothing`,
      [user.id, day],
    );
  }
  await db.query(
    'update streak_breaks set won_back_at = $3 where user_id = $1 and missed_day >= $2 and won_back_at is null',
    [user.id, broken.missed_day, at],
  );
}

/** What the phone shows about the streak. */
export async function getStreak(db: Db, user: User, today: Day, at: Date) {
  const records = await getRecords(db, user.id);
  const broken = await openBreak(db, user.id, at);
  const freezes = await db.query<{ count: number }>(
    'select count(*)::int as count from freezes where user_id = $1 and used_on_day is null and refund_due_at is null',
    [user.id],
  );
  const recent = [...records].sort().slice(-30);
  return {
    streak: countStreak(records, today, user.settled_through),
    todayDone: records.get(today) === 'done',
    freezes: freezes.rows[0]!.count,
    winBack: broken && {
      missedDay: broken.missed_day,
      lostStreak: countStreak(records, addDays(broken.missed_day, -1), user.settled_through),
      closesAt: new Date(broken.broke_at.getTime() + WIN_BACK_MS),
      priceCents: WIN_BACK_PRICE_CENTS,
    },
    recentDays: recent.map(([day, status]) => ({ day, status })),
  };
}
