import type { User } from './auth.ts';
import type { Db } from './db.ts';
import { ApiError } from './errors.ts';
import { now } from './time.ts';

/** Dev tools only ever touch the six seeded accounts. */
export function requireTestAccount(user: { is_test: boolean }): void {
  if (!user.is_test) throw new ApiError(403, 'not_a_test_account', 'Dev tools only work on the test accounts.');
}

/** Forward only. To go back, reset the account. */
export async function moveTime(db: Db, user: User, minutes: number) {
  user.dev_offset_ms += minutes * 60_000;
  await db.query('update users set dev_offset_ms = $2 where id = $1', [user.id, user.dev_offset_ms]);
  return { now: now(user), offsetMinutes: user.dev_offset_ms / 60_000 };
}

/** One named card, or some random ones the user does not own. */
export async function grantCards(db: Db, user: User, want: { cardId?: string; count?: number }) {
  const granted = await db.query<{ card_id: string }>(
    `insert into collection (user_id, card_id, acquired_at, reveal_seen_at)
     select $1, c.id, $2, $2 from cards c
      where ($3::text is null or c.id = $3)
        and not exists (select 1 from collection o where o.user_id = $1 and o.card_id = c.id)
      order by random() limit $4
     returning card_id`,
    [user.id, now(user), want.cardId ?? null, want.count ?? 1],
  );
  return { granted: granted.rows.map((row) => row.card_id) };
}
