import { lockUser } from './auth.ts';
import { type Db, pool, transaction } from './db.ts';
import type { Day } from './days.ts';
import { ApiError } from './errors.ts';
import { WIN_BACK_PRICE_CENTS, coverBreak, findOffer } from './streak.ts';
import { type Intent, type StripeApi, StripeUnreachable } from './stripe.ts';
import { now } from './time.ts';

/** A sheet that was open when the 48 hours ended may still be paid. After this it is closed for good. */
const LATE_MS = 60 * 60_000;

type Row = {
  id: string;
  user_id: string;
  missed_day: Day;
  amount_cents: number;
  closes_at: Date;
  intent_id: string | null;
  state: 'open' | 'paid' | 'canceled';
  refund_due_at: Date | null;
  refund_reason: 'not_needed' | 'fixed_late' | null;
  refunded_at: Date | null;
};
const COLUMNS = 'id, user_id, missed_day, amount_cents, closes_at, intent_id, state, refund_due_at, refund_reason, refunded_at';

export type PaymentState = 'open' | 'bank' | 'processing' | 'declined' | 'paid' | 'canceled' | 'refunding' | 'refunded';

function describe(row: Row, intent: Intent | null) {
  let state: PaymentState;
  if (row.refunded_at) state = 'refunded';
  else if (row.refund_due_at) state = 'refunding';
  else if (row.state !== 'open') state = row.state;
  else if (intent?.status === 'bank' || intent?.status === 'processing') state = intent.status;
  else state = intent?.problem ? 'declined' : 'open';
  return {
    id: row.id,
    missedDay: row.missed_day,
    state,
    amountCents: row.amount_cents,
    problem: state === 'declined' ? intent!.problem : null,
    refundReason: row.refund_reason,
  };
}

const find = async (db: Pick<Db, 'query'>, where: string, values: unknown[]): Promise<Row | null> =>
  (await db.query<Row>(`select ${COLUMNS} from win_back_payments where ${where}`, values)).rows[0] ?? null;

export function makePayments(stripe: StripeApi | null) {
  function ready(): StripeApi {
    if (!stripe) throw new ApiError(409, 'payments_not_set_up', 'Payments are not set up on this server.');
    return stripe;
  }

  /**
   * Make our side agree with what Stripe says. The user is locked, so the webhook, the phone and the sweep
   * can all bring the same news at once, and it happens once.
   */
  async function apply(rowId: string, userId: string, intent: Intent): Promise<{ row: Row; close: boolean }> {
    return transaction(async (db) => {
      const user = await lockUser(db, userId);
      const row = (await find(db, 'id = $1', [rowId]))!;
      if (row.state !== 'open') return { row, close: false };
      const at = now(user);
      if (intent.status === 'canceled') {
        await db.query(`update win_back_payments set state = 'canceled' where id = $1`, [row.id]);
      } else if (intent.status === 'succeeded') {
        // It began inside the 48 hours, so it counts whenever it ends.
        const days = await coverBreak(db, user, row.missed_day, at);
        await db.query(
          days
            ? `update win_back_payments set state = 'paid', honoured_days = $2 where id = $1`
            : `update win_back_payments set state = 'paid', refund_due_at = $2, refund_reason = 'not_needed' where id = $1`,
          [row.id, days ?? at],
        );
      } else if (intent.status !== 'processing') {
        const late = at.getTime() > row.closes_at.getTime() + LATE_MS;
        return { row, close: late || !(await findOffer(db, user, at, row.missed_day)) };
      }
      return { row: (await find(db, 'id = $1', [row.id]))!, close: false };
    });
  }

  /** Ask Stripe, and do what follows from the answer. */
  async function update(row: Row): Promise<{ row: Row; intent: Intent | null }> {
    if (row.state === 'open' && row.intent_id) {
      let intent = await ready().getIntent(row.intent_id);
      let result = await apply(row.id, row.user_id, intent);
      if (result.close) {
        // Too late, or a late day fixed the streak: nobody may pay for nothing.
        intent = await ready().cancelIntent(row.intent_id);
        result = await apply(row.id, row.user_id, intent);
      }
      return { row: await payBack(result.row), intent };
    }
    return { row: await payBack(row), intent: null };
  }

  /** Give the money back if it is owed. Tried again by the sweep until Stripe has said yes. */
  async function payBack(row: Row): Promise<Row> {
    if (!row.refund_due_at || row.refunded_at || !row.intent_id || !stripe) return row;
    try {
      const refund = await stripe.refund({ key: `refund-${row.id}`, intentId: row.intent_id });
      await pool.query('update win_back_payments set refund_id = $2, refunded_at = now() where id = $1 and refunded_at is null', [row.id, refund]);
      return (await find(pool, 'id = $1', [row.id]))!;
    } catch {
      return row;
    }
  }

  return {
    isReady: () => stripe !== null,

    /** Start paying for a break, or go on with it. Always the same PaymentIntent for the same break. */
    async begin(userId: string, missedDay: Day) {
      const api = ready();
      const row = await transaction(async (db) => {
        const user = await lockUser(db, userId);
        const at = now(user);
        const offer = await findOffer(db, user, at, missedDay);
        // One payment for one break. Also one begun for an earlier day of it, which a late day has since fixed.
        const mine = await db.query<Row>(
          `select ${COLUMNS} from win_back_payments where user_id = $1 and missed_day <= $2 order by missed_day desc`,
          [userId, missedDay],
        );
        for (const before of mine.rows) {
          const same = before.missed_day === missedDay;
          if (before.state !== 'open') {
            if (same) return before;
            continue;
          }
          const mends = same ? offer : await findOffer(db, user, at, before.missed_day);
          if (!mends || mends.missedDay !== (offer?.missedDay ?? missedDay)) continue;
          // It may still be paid a little after the 48 hours.
          return at.getTime() <= Math.max(before.closes_at.getTime(), mends.closesAt.getTime()) + LATE_MS ? before : null;
        }
        if (offer?.missedDay !== missedDay) return null;
        if (at >= offer.closesAt) return null;
        const made = await db.query<Row>(
          `insert into win_back_payments (user_id, missed_day, amount_cents, started_at, closes_at)
           values ($1, $2, $3, $4, $5) returning ${COLUMNS}`,
          [userId, missedDay, WIN_BACK_PRICE_CENTS, at, offer.closesAt],
        );
        return made.rows[0]!;
      });
      if (!row) throw new ApiError(409, 'no_win_back', 'There is no streak to win back.');
      if (row.state === 'open' && !row.intent_id) {
        // Two phones at once, or a server that was killed here, ask with the same key and get the same intent.
        const intent = await api.createIntent({ key: `win-back-${row.id}`, amountCents: row.amount_cents, metadata: { payment: row.id } });
        await pool.query('update win_back_payments set intent_id = $2 where id = $1 and intent_id is null', [row.id, intent.id]);
        row.intent_id = intent.id;
      }
      const { row: newest, intent } = await update(row);
      const payment = describe(newest, intent);
      const payable = payment.state === 'open' || payment.state === 'bank' || payment.state === 'declined';
      return { ...payment, publishableKey: api.publishableKey, clientSecret: payable ? intent!.clientSecret : null };
    },

    /** What became of a payment. Stripe is asked every time, so it works without a webhook. */
    async check(userId: string, paymentId: string) {
      const row = await find(pool, 'id = $1 and user_id = $2', [paymentId, userId]);
      if (!row) throw new ApiError(404, 'no_such_payment', 'That payment does not exist.');
      const { row: newest, intent } = await update(row);
      return describe(newest, intent);
    },

    async webhook(body: Buffer, signature: string | undefined): Promise<void> {
      const api = ready();
      let intentId: string | null;
      try {
        intentId = api.readEvent(body, signature);
      } catch {
        throw new ApiError(400, 'bad_signature', 'This is not from Stripe.');
      }
      const row = intentId ? await find(pool, 'intent_id = $1', [intentId]) : null;
      if (row) await update(row); // if Stripe cannot be asked this fails, and Stripe sends it again
    },

    /** For the phone that never comes back, and refunds that did not go through. */
    async sweep(): Promise<void> {
      if (!stripe) return;
      const due = await pool.query<Row>(
        `select ${COLUMNS} from win_back_payments
          where intent_id is not null and (state = 'open' or (refund_due_at is not null and refunded_at is null))
          order by created_at limit 100`,
      );
      for (const row of due.rows) {
        await update(row).catch((err: unknown) => {
          if (!(err instanceof StripeUnreachable)) console.error('win back payment not checked:', (err as Error).message);
        });
      }
    },

    /** Dev tools: pay it with one of Stripe's test cards, as if from the phone. */
    async confirm(userId: string, paymentId: string, card: 'visa' | 'declined'): Promise<void> {
      const api = ready();
      const row = await find(pool, 'id = $1 and user_id = $2', [paymentId, userId]);
      if (!row?.intent_id) throw new ApiError(404, 'no_such_payment', 'That payment does not exist.');
      await api.confirm(row.intent_id, card);
    },
  };
}

/**
 * A day that came late may have fixed what someone paid for. If none of the days the payment filled in
 * still needs it, the money goes back.
 */
export async function owePaymentsFixedLate(db: Db, userId: string, at: Date): Promise<void> {
  await db.query(
    `update win_back_payments p set refund_due_at = $2, refund_reason = 'fixed_late'
      where user_id = $1 and state = 'paid' and refund_due_at is null and honoured_days is not null
        and not exists (select 1 from day_records d
                         where d.user_id = p.user_id and d.day = any(p.honoured_days) and d.status = 'won_back')`,
    [userId, at],
  );
}
