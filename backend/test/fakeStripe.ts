import type { Intent, StripeApi } from '../src/stripe.ts';

/** Stripe, as far as this app can tell. Nothing here goes near a network. */
export class FakeStripe implements StripeApi {
  readonly publishableKey = 'pk_test_fake';
  intents = new Map<string, Intent & { amountCents: number; times: number }>();
  refunds = new Map<string, string>(); // by intent
  keys = new Map<string, string>(); // idempotency key to what it made
  calls: string[] = [];
  down = false;
  refundsDown = false;
  signature = 'good';
  noAnswer = () => new Error('no answer'); // helpers.ts puts the real error here

  reset(): void {
    this.intents.clear();
    this.refunds.clear();
    this.keys.clear();
    this.calls = [];
    this.down = this.refundsDown = false;
  }

  private call(name: string): void {
    this.calls.push(name);
    if (this.down) throw this.noAnswer();
  }
  private get(id: string) {
    const intent = this.intents.get(id);
    if (!intent) throw new Error(`no such intent ${id}`);
    return intent;
  }

  async createIntent({ key, amountCents }: { key: string; amountCents: number; metadata: Record<string, string> }): Promise<Intent> {
    this.call('create');
    await new Promise((resolve) => setImmediate(resolve)); // two phones can be in here at once
    const before = this.keys.get(key);
    if (before) return { ...this.get(before) };
    const id = `pi_${this.intents.size + 1}`;
    this.keys.set(key, id);
    this.intents.set(id, { id, status: 'open', clientSecret: `${id}_secret`, problem: null, amountCents, times: 0 });
    return { ...this.get(id) };
  }
  async getIntent(id: string): Promise<Intent> {
    this.call('get');
    return { ...this.get(id) };
  }
  async cancelIntent(id: string): Promise<Intent> {
    this.call('cancel');
    const intent = this.get(id);
    if (intent.status !== 'succeeded' && intent.status !== 'processing') intent.status = 'canceled';
    return { ...intent };
  }
  async refund({ key, intentId }: { key: string; intentId: string }): Promise<string> {
    this.call('refund');
    if (this.refundsDown) throw new Error('no answer');
    const before = this.keys.get(key);
    if (before) return before;
    if (this.get(intentId).status !== 'succeeded') throw new Error('nothing to refund');
    const id = `re_${this.refunds.size + 1}`;
    if (this.refunds.has(intentId)) throw new Error('refunded twice');
    this.keys.set(key, id);
    this.refunds.set(intentId, id);
    return id;
  }
  async confirm(id: string, card: 'visa' | 'declined'): Promise<void> {
    this.call('confirm');
    if (card === 'visa') this.pay(id);
    else this.decline(id);
  }
  readEvent(body: Buffer, signature: string | undefined): string | null {
    if (signature !== this.signature) throw new Error('bad signature');
    const event = JSON.parse(body.toString()) as { type: string; data: { object: { id: string } } };
    return event.type.startsWith('payment_intent.') ? event.data.object.id : null;
  }

  // What a card and a bank do

  /** The card is charged. Stripe refuses a second time, as the real one does. */
  pay(id: string): boolean {
    const intent = this.get(id);
    if (intent.status === 'succeeded' || intent.status === 'canceled') return false;
    intent.status = 'succeeded';
    intent.problem = null;
    intent.times++;
    return true;
  }
  decline(id: string, problem = 'Your card was declined.'): void {
    Object.assign(this.get(id), { status: 'open', problem });
  }
  bank(id: string): void {
    Object.assign(this.get(id), { status: 'bank', problem: null });
  }
  processing(id: string): void {
    Object.assign(this.get(id), { status: 'processing', problem: null });
  }
  /** Money taken and not given back. */
  get kept(): number {
    return [...this.intents.values()].filter((one) => one.status === 'succeeded' && !this.refunds.has(one.id)).reduce((sum, one) => sum + one.amountCents * one.times, 0);
  }
}
