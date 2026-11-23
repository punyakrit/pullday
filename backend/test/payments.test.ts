import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { after, beforeEach, describe, test } from 'node:test';
import { HOUR, Phone, advance, app, clean, close, keyless, pool, setClock, stripe, stripeKeys } from './helpers.ts';

beforeEach(() => clean());
after(close);

/** Done on the 20th, 21st and 22nd, missed the 23rd. It is the 24th, 9am. */
async function broken(): Promise<Phone> {
  const phone = await Phone.signUp();
  await phone.playOn('2026-11-20', '2026-11-21', '2026-11-22');
  setClock('2026-11-24T09:00:00Z');
  await phone.today();
  return phone;
}
const begin = (phone: Phone, missedDay = '2026-11-23') => phone.call('POST', '/win-back', { missedDay });
const check = (phone: Phone, id: string) => phone.call('GET', `/win-back/payments/${id}`);
const intentOf = async (id: string) => (await pool.query('select intent_id from win_back_payments where id = $1', [id])).rows[0].intent_id as string;
const hook = (id: string, signature = 'good', type = 'payment_intent.succeeded') =>
  app.inject({ method: 'POST', url: '/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, payload: JSON.stringify({ type, data: { object: { id } } }) });
const started = async (phone: Phone) => {
  const { body } = await begin(phone);
  return { id: body.id as string, intent: await intentOf(body.id) };
};

describe('paying', () => {
  test('begun, paid, checked: the streak is what it was', async () => {
    const phone = await broken();
    const { status, body } = await begin(phone);
    assert.equal(status, 200);
    assert.deepEqual([body.state, body.amountCents, body.publishableKey, body.clientSecret], ['open', 499, 'pk_test_fake', 'pi_1_secret']);
    assert.equal((await phone.today()).streak, 0);
    stripe.pay('pi_1');
    assert.equal((await check(phone, body.id)).body.state, 'paid');
    const today = await phone.today();
    assert.deepEqual([today.streak, today.winBack], [3, null]);
    assert.equal(stripe.kept, 499);
  });

  test('40 days is 40 again', async () => {
    const phone = await Phone.signUp();
    const days = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 9, 14 + i)).toISOString().slice(0, 10));
    await phone.playOn(...days);
    setClock('2026-11-24T09:00:00Z');
    assert.equal((await phone.today()).streak, 0);
    const { id, intent } = await started(phone);
    stripe.pay(intent);
    await check(phone, id);
    assert.equal((await phone.today()).streak, 40);
    assert.equal((await phone.play()).body.streak, 41);
  });

  test('only Stripe says failed, and it can be tried again with the same payment', async () => {
    const phone = await broken();
    const { id, intent } = await started(phone);
    stripe.decline(intent);
    const declined = (await check(phone, id)).body;
    assert.deepEqual([declined.state, declined.problem], ['declined', 'Your card was declined.']);
    const again = await begin(phone);
    assert.deepEqual([again.body.id, again.body.clientSecret], [id, `${intent}_secret`]);
    stripe.pay(intent);
    assert.equal((await check(phone, id)).body.state, 'paid');
    assert.equal(stripe.intents.size, 1);
  });

  test('3D Secure, and a bank that takes its time', async () => {
    const phone = await broken();
    const { id, intent } = await started(phone);
    stripe.bank(intent);
    assert.equal((await check(phone, id)).body.state, 'bank');
    assert.ok((await begin(phone)).body.clientSecret); // it can be gone on with
    stripe.processing(intent);
    assert.equal((await check(phone, id)).body.state, 'processing');
    assert.equal((await begin(phone)).body.clientSecret, null); // and here there is nothing to press
    stripe.pay(intent);
    assert.equal((await check(phone, id)).body.state, 'paid');
  });

  test('Stripe cannot be asked: no answer is not a no', async () => {
    const phone = await broken();
    const { id, intent } = await started(phone);
    stripe.down = true;
    assert.equal((await check(phone, id)).status, 503);
    stripe.pay(intent);
    stripe.down = false;
    assert.equal((await check(phone, id)).body.state, 'paid');
  });

  test('asking what became of it never counts as having been online', async () => {
    const phone = await broken();
    const { id } = await started(phone);
    const contact = async () => (await pool.query('select last_contact_at from devices where user_id = $1', [phone.userId])).rows[0].last_contact_at.getTime();
    const before = await contact();
    advance(HOUR);
    await check(phone, id);
    assert.equal(await contact(), before);
    await begin(phone); // beginning one does: the phone may only do it with nothing unsent
    assert.ok((await contact()) > before);
  });

  test("not somebody else's, and not one that does not exist", async () => {
    const phone = await broken();
    const { id } = await started(phone);
    const other = await Phone.signUp();
    assert.equal((await check(other, id)).status, 404);
    assert.equal((await begin(other)).body.error, 'no_win_back');
    assert.equal((await begin(phone, '2026-11-22')).body.error, 'no_win_back'); // a day that was done
    assert.equal((await begin(phone, '2026-11-24')).body.error, 'no_win_back');
    assert.equal((await begin(phone, '2020-01-01')).body.error, 'no_win_back');
    assert.equal(stripe.intents.size, 1);
  });
});

describe('never twice', () => {
  test('ten at once, from two phones: one payment, one intent', async () => {
    const phone = await broken();
    const tablet = await Phone.logIn(phone.email);
    const all = await Promise.all(Array.from({ length: 10 }, (_, i) => begin(i % 2 ? phone : tablet)));
    assert.equal(new Set(all.map(({ body }) => body.id)).size, 1);
    assert.equal(new Set(all.map(({ body }) => body.clientSecret)).size, 1);
    assert.equal(stripe.intents.size, 1);
  });

  test('both sheets are paid: the second card is not charged', async () => {
    const phone = await broken();
    const tablet = await Phone.logIn(phone.email);
    await begin(phone);
    await begin(tablet);
    assert.equal(stripe.pay('pi_1'), true);
    assert.equal(stripe.pay('pi_1'), false);
    assert.equal(stripe.kept, 499);
    const late = await begin(tablet); // paid already: there is nothing left to pay with
    assert.deepEqual([late.body.state, late.body.clientSecret], ['paid', null]);
  });

  test('the server died between making the intent and writing it down: the same one', async () => {
    const phone = await broken();
    const { id } = await started(phone);
    await pool.query('update win_back_payments set intent_id = null where id = $1', [id]);
    assert.equal((await begin(phone)).body.clientSecret, 'pi_1_secret');
    assert.equal(stripe.intents.size, 1);
  });

  test('the webhook, the phone and the sweep all say paid at once: it happens once', async () => {
    const phone = await broken();
    const { id, intent } = await started(phone);
    stripe.pay(intent);
    await Promise.all([hook(intent), check(phone, id), app.payments.sweep(), hook(intent), check(phone, id)]);
    assert.equal((await phone.today()).streak, 3);
    const rows = await pool.query(`select state, honoured_days::text[] as days, refund_due_at from win_back_payments`);
    assert.deepEqual(rows.rows, [{ state: 'paid', days: ['2026-11-23'], refund_due_at: null }]);
    assert.equal(stripe.refunds.size, 0);
  });
});

describe('the phone is not there', () => {
  test('killed while paying: the webhook alone gives the streak back', async () => {
    const phone = await broken();
    const { intent } = await started(phone);
    stripe.pay(intent);
    assert.equal((await hook(intent)).statusCode, 200);
    assert.equal((await phone.today()).streak, 3);
  });

  test('no webhook and the phone never came back: the sweep does', async () => {
    const phone = await broken();
    const { intent } = await started(phone);
    stripe.pay(intent);
    await app.payments.sweep();
    assert.equal((await phone.today()).streak, 3);
  });

  test('a webhook is only believed as far as Stripe says the same', async () => {
    const phone = await broken();
    const { intent } = await started(phone);
    assert.equal((await hook(intent)).statusCode, 200); // "succeeded", but it was not
    assert.equal((await phone.today()).streak, 0);
    assert.equal((await hook(intent, 'forged')).statusCode, 400);
    assert.equal((await hook('pi_unknown')).statusCode, 200);
    stripe.down = true;
    assert.equal((await hook(intent)).statusCode, 503); // then Stripe sends it again
  });
});

describe('the 48 hours', () => {
  test('begun inside them, paid after: it counts, and so do the days missed since', async () => {
    const phone = await broken();
    setClock('2026-11-25T23:59:00Z');
    const { id, intent } = await started(phone);
    stripe.bank(intent);
    setClock('2026-11-26T00:30:00Z');
    assert.equal((await phone.today()).winBack, null); // no new offer
    assert.equal((await check(phone, id)).body.state, 'bank'); // and not closed under their hands
    stripe.pay(intent);
    setClock('2026-11-28T09:00:00Z');
    assert.equal((await check(phone, id)).body.state, 'paid');
    const today = await phone.today();
    assert.equal(today.streak, 3);
    assert.equal(stripe.kept, 499);
  });

  test('not begun inside them: too late, to the second', async () => {
    const phone = await broken();
    setClock('2026-11-25T23:59:59.999Z');
    assert.equal((await begin(phone)).status, 200);
    await clean();
    const other = await broken();
    setClock('2026-11-26T00:00:00Z');
    assert.equal((await begin(other)).body.error, 'no_win_back');
    assert.equal(stripe.intents.size, 0);
  });

  test('begun and never paid: closed an hour after, so nobody can pay for nothing', async () => {
    const phone = await broken();
    const { id, intent } = await started(phone);
    setClock('2026-11-26T00:59:00Z');
    assert.equal((await check(phone, id)).body.state, 'open');
    assert.ok((await begin(phone)).body.clientSecret);
    setClock('2026-11-26T01:00:01Z');
    await app.payments.sweep();
    assert.equal(stripe.intents.get(intent)!.status, 'canceled');
    assert.equal((await check(phone, id)).body.state, 'canceled');
    assert.equal(stripe.pay(intent), false);
  });

  test('paid in the moment it was being closed: it still counts', async () => {
    const phone = await broken();
    const { id } = await started(phone);
    setClock('2026-11-26T02:00:00Z');
    const cancel = stripe.cancelIntent.bind(stripe);
    stripe.cancelIntent = async (one) => {
      stripe.pay(one); // first
      return cancel(one);
    };
    try {
      assert.equal((await check(phone, id)).body.state, 'paid');
    } finally {
      stripe.cancelIntent = cancel;
    }
    assert.equal((await phone.today()).streak, 3);
  });
});

describe('money that cannot be honoured goes back', () => {
  /** A phone in the air since the 22nd that played the 23rd, and a tablet at home. */
  async function planeAndTablet() {
    const plane = await Phone.signUp();
    await plane.playOn('2026-11-20', '2026-11-21', '2026-11-22');
    const bundle = await plane.today(); // holds the 23rd
    const tablet = await Phone.logIn(plane.email);
    setClock('2026-11-24T09:00:00Z');
    await tablet.today();
    return { plane, tablet, land: () => plane.complete(bundle.tomorrow.id) };
  }

  test('a late day fixed the streak before it was paid: closed, and no money taken', async () => {
    const { tablet, land } = await planeAndTablet();
    const { id, intent } = await started(tablet);
    assert.equal((await land()).status, 200);
    assert.equal((await check(tablet, id)).body.state, 'canceled');
    assert.equal(stripe.pay(intent), false);
    assert.equal(stripe.kept, 0);
  });

  test('a late day fixed it while it was being paid: refunded', async () => {
    const { tablet, land } = await planeAndTablet();
    const { id, intent } = await started(tablet);
    stripe.pay(intent);
    await land();
    const { body } = await check(tablet, id);
    assert.deepEqual([body.state, body.refundReason], ['refunded', 'not_needed']);
    assert.equal(stripe.kept, 0);
    assert.equal((await tablet.today()).streak, 4);
  });

  test('a late day fixed it after it was paid and given back: refunded', async () => {
    const { tablet, land } = await planeAndTablet();
    const { id, intent } = await started(tablet);
    stripe.pay(intent);
    assert.equal((await check(tablet, id)).body.state, 'paid');
    await land();
    assert.equal((await tablet.today()).streak, 4);
    await app.payments.sweep();
    const { body } = await check(tablet, id);
    assert.deepEqual([body.state, body.refundReason], ['refunded', 'fixed_late']);
    assert.equal(stripe.kept, 0);
  });

  test('two days missed, one fixed late after it was paid: the other still needed it, so it is kept', async () => {
    const { tablet, land } = await planeAndTablet();
    setClock('2026-11-25T08:00:00Z'); // the 24th is missed too
    const { id, intent } = await started(tablet);
    stripe.pay(intent);
    await check(tablet, id);
    await land();
    await app.payments.sweep();
    assert.equal((await check(tablet, id)).body.state, 'paid');
    assert.equal(stripe.kept, 499);
    assert.equal((await tablet.today()).streak, 4);
  });

  test('two days missed, one fixed late before it was paid: the money mends the other, and only one payment', async () => {
    const { tablet, land } = await planeAndTablet();
    setClock('2026-11-25T08:00:00Z');
    const { id, intent } = await started(tablet);
    await land(); // now the streak breaks on the 24th instead
    const { winBack } = await tablet.today();
    assert.equal(winBack.missedDay, '2026-11-24');
    const again = await begin(tablet, '2026-11-24');
    assert.equal(again.body.id, id); // the same payment
    stripe.pay(intent);
    assert.equal((await check(tablet, id)).body.state, 'paid');
    assert.equal((await tablet.today()).streak, 4);
    assert.equal(stripe.intents.size, 1);
    assert.equal(stripe.kept, 499);
  });

  test('a refund that does not go through is owed, tried again, and given once', async () => {
    const { tablet, land } = await planeAndTablet();
    const { id, intent } = await started(tablet);
    stripe.pay(intent);
    await land();
    stripe.refundsDown = true;
    assert.equal((await check(tablet, id)).body.state, 'refunding');
    await app.payments.sweep();
    stripe.refundsDown = false;
    await Promise.all([app.payments.sweep(), check(tablet, id), hook(intent, 'good', 'payment_intent.succeeded')]);
    assert.equal((await check(tablet, id)).body.state, 'refunded');
    assert.equal(stripe.refunds.size, 1);
    assert.equal(stripe.kept, 0);
  });
});

describe('a second break later', () => {
  test('is another payment', async () => {
    const phone = await broken();
    const first = await started(phone);
    stripe.pay(first.intent);
    await check(phone, first.id);
    await phone.play(); // the 24th
    setClock('2026-11-26T09:00:00Z'); // the 25th was missed
    const second = await begin(phone, '2026-11-25');
    assert.notEqual(second.body.id, first.id);
    stripe.pay('pi_2');
    await check(phone, second.body.id);
    assert.equal((await phone.today()).streak, 4);
    assert.equal(stripe.kept, 998);
  });
});

describe('without keys', () => {
  test('everything else works, and win back says so', async () => {
    const phone = await broken();
    const headers = { authorization: `Bearer ${phone.token}` };
    const today = await keyless.inject({ method: 'GET', url: '/today', headers });
    assert.deepEqual([today.statusCode, today.json().paymentsReady, today.json().winBack.lostStreak], [200, false, 3]);
    const refused = await keyless.inject({ method: 'POST', url: '/win-back', headers, payload: { missedDay: '2026-11-23' } });
    assert.deepEqual([refused.statusCode, refused.json().error], [409, 'payments_not_set_up']);
    assert.equal((await keyless.inject({ method: 'POST', url: '/stripe/webhook', headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode, 409);
    await keyless.payments.sweep();
    assert.equal((await phone.today()).paymentsReady, true);
  });

  test('only test keys are taken, and no key is ever in a message', () => {
    const secret = 'sk_test_abc123';
    const publishable = 'pk_test_abc123';
    assert.deepEqual(stripeKeys({ STRIPE_SECRET_KEY: secret, STRIPE_PUBLISHABLE_KEY: publishable }), { secretKey: secret, publishableKey: publishable, webhookSecret: null });
    for (const env of [{}, { STRIPE_SECRET_KEY: '' }, { STRIPE_SECRET_KEY: secret }, { STRIPE_PUBLISHABLE_KEY: publishable, STRIPE_SECRET_KEY: ' ' }]) assert.equal(stripeKeys(env), null);
    const live = ['sk', 'live', 'abc123'].join('_');
    for (const env of [
      { STRIPE_SECRET_KEY: live, STRIPE_PUBLISHABLE_KEY: publishable },
      { STRIPE_SECRET_KEY: secret, STRIPE_PUBLISHABLE_KEY: live.replace('sk', 'pk') },
      { STRIPE_SECRET_KEY: publishable, STRIPE_PUBLISHABLE_KEY: secret }, // the wrong way round
      { STRIPE_SECRET_KEY: live }, // even with the other one missing
    ]) {
      assert.throws(() => stripeKeys(env), (err: Error) => /not a test key/.test(err.message) && !err.message.includes('abc123'));
    }
  });

  test('tests never touch the real Stripe', () => {
    const dir = new URL('.', import.meta.url).pathname;
    for (const file of readdirSync(decodeURIComponent(dir)).filter((name) => name.endsWith('.ts'))) {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8');
      assert.ok(!/from 'stripe'|realStripe\(|api\.stripe\.com/.test(text.replace(/.*never touch[\s\S]*/, '')), file);
    }
  });
});

describe('dev tools', () => {
  test('pay or decline with a test card, only a test account, only its own payment', async () => {
    const phone = await broken();
    const { id } = await started(phone);
    assert.equal((await phone.call('POST', '/dev/pay', { paymentId: id, card: 'visa' })).body.error, 'not_a_test_account');
    await pool.query('update users set is_test = true where id = $1', [phone.userId]);
    await phone.call('POST', '/dev/pay', { paymentId: id, card: 'declined' });
    assert.equal((await check(phone, id)).body.state, 'declined');
    await phone.call('POST', '/dev/pay', { paymentId: id, card: 'visa' });
    assert.equal((await check(phone, id)).body.state, 'paid');
    assert.equal((await phone.call('POST', '/dev/pay', { paymentId: '00000000-0000-4000-8000-000000000000', card: 'visa' })).status, 404);
  });
});
