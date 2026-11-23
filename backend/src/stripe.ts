import Stripe from 'stripe';
import { ApiError } from './errors.ts';

export type Keys = { secretKey: string; publishableKey: string; webhookSecret: string | null };

/**
 * Test keys or nothing. A live key stops the server from starting: this app must never be able to take
 * real money. No key is ever put in a message.
 */
export function stripeKeys(env: Record<string, string | undefined>): Keys | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? '';
  const publishableKey = env.STRIPE_PUBLISHABLE_KEY?.trim() ?? '';
  if (secretKey && !/^(sk|rk)_test_\w+$/.test(secretKey)) throw new Error('STRIPE_SECRET_KEY is not a test key. Use one that starts with sk_test_.');
  if (publishableKey && !/^pk_test_\w+$/.test(publishableKey)) throw new Error('STRIPE_PUBLISHABLE_KEY is not a test key. Use one that starts with pk_test_.');
  if (!secretKey || !publishableKey) return null;
  return { secretKey, publishableKey, webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null };
}

/** What Stripe says about a payment, in the words we need. */
export type Intent = {
  id: string;
  /** open: not paid, and nothing under way. bank: waiting for 3D Secure. */
  status: 'open' | 'bank' | 'processing' | 'succeeded' | 'canceled';
  clientSecret: string;
  /** Why the last try failed, in words for the person. Only while it is open. */
  problem: string | null;
};

/** The little of Stripe that we use. Tests have their own. */
export interface StripeApi {
  readonly publishableKey: string;
  createIntent(want: { key: string; amountCents: number; metadata: Record<string, string> }): Promise<Intent>;
  getIntent(id: string): Promise<Intent>;
  /** Cancels it if it can still be cancelled. Says what it is now either way. */
  cancelIntent(id: string): Promise<Intent>;
  refund(want: { key: string; intentId: string }): Promise<string>;
  /** Dev tools: pay with one of Stripe's own test cards. */
  confirm(id: string, card: 'visa' | 'declined'): Promise<void>;
  /** Which payment a webhook is about. Throws if the signature is wrong. */
  readEvent(body: Buffer, signature: string | undefined): string | null;
}

/** No answer is not a no. The phone goes on saying that it is checking. */
export class StripeUnreachable extends ApiError {
  constructor() {
    super(503, 'stripe_unreachable', 'The payment could not be checked. Try again in a moment.');
  }
}

async function ask<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) console.error('stripe:', err.type, err.code ?? ''); // never the message, never a key
    throw new StripeUnreachable();
  }
}

/** Stripe's words about a card are for the person. Its other words are for programmers. */
export function inWords(error: { type?: string; code?: string; message?: string }): string {
  if (error.code === 'payment_intent_authentication_failure') return 'Your bank did not approve it.';
  return error.type === 'card_error' && error.message ? error.message : 'The payment did not go through.';
}

function read(intent: Stripe.PaymentIntent): Intent {
  const status = {
    requires_payment_method: 'open',
    requires_confirmation: 'open',
    requires_action: 'bank',
    requires_capture: 'processing',
    processing: 'processing',
    succeeded: 'succeeded',
    canceled: 'canceled',
  }[intent.status as string] as Intent['status'] | undefined;
  if (!status) throw new StripeUnreachable();
  const problem = status === 'open' && intent.last_payment_error ? inWords(intent.last_payment_error) : null;
  return { id: intent.id, status, clientSecret: intent.client_secret ?? '', problem };
}

export function realStripe(keys: Keys): StripeApi {
  const stripe = new Stripe(keys.secretKey, { timeout: 10_000, maxNetworkRetries: 2, telemetry: false });
  const getIntent = (id: string) => ask(async () => read(await stripe.paymentIntents.retrieve(id)));
  return {
    publishableKey: keys.publishableKey,
    createIntent: ({ key, amountCents, metadata }) =>
      ask(async () =>
        read(
          await stripe.paymentIntents.create(
            { amount: amountCents, currency: 'usd', allowed_payment_method_types: ['card'], description: 'Pullday test app: win back a streak', metadata },
            { idempotencyKey: key },
          ),
        ),
      ),
    getIntent,
    async cancelIntent(id) {
      try {
        return read(await stripe.paymentIntents.cancel(id));
      } catch {
        return getIntent(id); // it was paid first, or is being paid
      }
    },
    refund: ({ key, intentId }) =>
      ask(async () => {
        try {
          return (await stripe.refunds.create({ payment_intent: intentId }, { idempotencyKey: key })).id;
        } catch (err) {
          if (err instanceof Stripe.errors.StripeError && err.code === 'charge_already_refunded') return 'already_refunded';
          throw err;
        }
      }),
    async confirm(id, card) {
      const method = card === 'visa' ? 'pm_card_visa' : 'pm_card_visa_chargeDeclined';
      await stripe.paymentIntents.confirm(id, { payment_method: method }).catch((err: unknown) => {
        if (err instanceof Stripe.errors.StripeCardError) return; // declined, as asked
        throw new StripeUnreachable();
      });
    },
    readEvent(body, signature) {
      // Without a secret it is only a hint. Either way Stripe is asked before anything happens.
      const event = (
        keys.webhookSecret ? stripe.webhooks.constructEvent(body, signature ?? '', keys.webhookSecret) : JSON.parse(body.toString('utf8'))
      ) as { type?: unknown; data?: { object?: { id?: unknown } } };
      const id = event.data?.object?.id;
      return typeof event.type === 'string' && event.type.startsWith('payment_intent.') && typeof id === 'string' ? id : null;
    },
  };
}
