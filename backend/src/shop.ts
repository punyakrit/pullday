import { type User, getZones } from './auth.ts';
import type { Db } from './db.ts';
import { currentDay } from './days.ts';
import { ApiError } from './errors.ts';
import { FREEZE_PRICE_CENTS, MAX_FREEZES, countFreezes, refundExtra, replay, settle } from './streak.ts';
import { now } from './time.ts';

/*
 * Buying freezes. The caller holds the user lock, so two phones wait for each other.
 * The store is a fake on the phone, so there is nobody to ask if a transaction is real. With a real store,
 * confirm() is where the receipt would be checked.
 */

async function findPurchase(db: Db, userId: string, id: string): Promise<{ began_at: Date } | null> {
  const found = await db.query<{ user_id: string; began_at: Date }>('select user_id, began_at from freeze_purchases where id = $1', [id]);
  const purchase = found.rows[0];
  if (purchase && purchase.user_id !== userId) throw new ApiError(409, 'not_yours', 'This purchase belongs to another account.');
  return purchase ?? null;
}

/** Before the store is asked for anything. This is the moment the freeze will count from. */
export async function begin(db: Db, user: User, id: string) {
  const at = now(user);
  await settle(db, user, await getZones(db, user.id), at); // a missed day may be about to use one
  const before = await findPurchase(db, user.id, id);
  if (!before) {
    if ((await countFreezes(db, user.id)) >= MAX_FREEZES) throw new ApiError(409, 'freezes_full', 'You already hold 2 freezes, the most you can.');
    await db.query('insert into freeze_purchases (id, user_id, began_at) values ($1, $2, $3)', [id, user.id, at]);
  }
  return { id, beganAt: before?.began_at ?? at, priceCents: FREEZE_PRICE_CENTS };
}

/**
 * The store has taken the money. Granted once for each transaction, however often and from however many
 * phones this is asked. It counts from when the purchase began, so days since then are settled again.
 */
export async function confirm(db: Db, user: User, id: string, transactionId: string) {
  const at = now(user);
  const known = await db.query<{ id: string; user_id: string; refund_due_at: Date | null }>(
    'select id, user_id, refund_due_at from freezes where transaction_id = $1',
    [transactionId],
  );
  const granted = known.rows[0];
  if (granted && granted.user_id !== user.id) throw new ApiError(409, 'not_yours', 'This purchase belongs to another account.');
  if (granted) return { id, freezeId: granted.id, state: granted.refund_due_at ? 'refunded' : 'granted' };

  // Money was taken, so it is never turned away. One we never heard begin, begins now.
  const purchase = (await findPurchase(db, user.id, id)) ?? { began_at: at };
  await db.query('insert into freeze_purchases (id, user_id, began_at) values ($1, $2, $3) on conflict do nothing', [id, user.id, at]);
  const again = (await db.query('select 1 from freezes where purchase_id = $1', [id])).rowCount !== 0;
  const made = await db.query<{ id: string }>(
    `insert into freezes (user_id, purchased_at, purchase_id, transaction_id, refund_due_at) values ($1, $2, $3, $4, $5) returning id`,
    [user.id, purchase.began_at, id, transactionId, again ? at : null], // paid twice for one purchase: the second goes back
  );
  const freezeId = made.rows[0]!.id;
  const zones = await getZones(db, user.id);
  await replay(db, user, zones, currentDay(zones, purchase.began_at), at);
  await refundExtra(db, user.id, at, freezeId);
  const result = await db.query<{ owed: boolean }>('select refund_due_at is not null as owed from freezes where id = $1', [freezeId]);
  return { id, freezeId, state: result.rows[0]!.owed ? 'refunded' : 'granted' };
}
