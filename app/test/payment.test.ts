import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Engine } from '../src/core/engine';
import { bannerFor } from '../src/core/banner';
import { streakDays } from '../src/core/streakDays';
import { emptySaved } from '../src/core/state';
import { HOUR, World, challenge, playAll, settle } from './fakes';

const OFFER = { missedDay: '2026-11-22', lostStreak: 40, closesAt: '2026-11-25T00:00:00Z', priceCents: 499 };
type State = 'open' | 'bank' | 'processing' | 'declined' | 'paid' | 'canceled' | 'refunding' | 'refunded';

/** broken@, with a server whose payment is in a state we choose. */
async function broken() {
  const world = new World('2026-11-23T12:00:00Z');
  const stripe = { state: 'open' as State, problem: null as string | null, missing: false };
  world.normal({ winBack: OFFER });
  const normal = world.respond;
  world.respond = (method, path) => {
    const payment = { id: 'p1', missedDay: OFFER.missedDay, state: stripe.state, problem: stripe.problem };
    const payable = ['open', 'bank', 'declined'].includes(stripe.state);
    if (path === '/win-back') return { status: 200, body: { ...payment, clientSecret: payable ? 'secret' : null, publishableKey: 'pk_test_x' } };
    if (path.startsWith('/win-back/payments/')) return stripe.missing ? { status: 404, body: { error: 'no_such_payment', message: '' } } : { status: 200, body: payment };
    if (path === '/today' && stripe.state === 'paid') return { status: 200, body: world.today({ streak: 40, winBack: null }) };
    return normal(method, path);
  };
  const engine = world.open();
  await engine.sync();
  world.calls = [];
  return { world, engine, stripe };
}
const state = (engine: Engine) => engine.getSnapshot().payment?.state ?? null;
const notices = (engine: Engine) => engine.getSnapshot().saved.notices.map((one) => one.text);
/** Let every planned check run. */
async function pass(world: World, times = 6) {
  for (let i = 0; i < times; i++) {
    const due = world.timers;
    world.timers = [];
    for (const timer of due) timer.work();
    await settle();
  }
}

describe('paying', () => {
  test('offered, paid, checked, 40 again', async () => {
    const { world, engine, stripe } = await broken();
    assert.deepEqual(engine.getSnapshot().offer, OFFER);
    assert.deepEqual(await engine.beginPayment(), { clientSecret: 'secret', publishableKey: 'pk_test_x' });
    assert.equal(state(engine), 'checking');
    assert.equal(engine.getSnapshot().offer, null); // nothing else to press
    stripe.state = 'paid';
    await engine.sheetClosed(false);
    await settle();
    assert.equal(state(engine), null);
    assert.deepEqual(notices(engine), ['Paid. Your 40 day streak is back.']);
    assert.equal(engine.getSnapshot().today!.streak, 40);
    assert.ok(world.calls.includes('GET /today'));
  });

  test('on disk before the sheet can open', async () => {
    const { world, engine } = await broken();
    const sheet = await engine.beginPayment();
    assert.ok(sheet);
    assert.equal(JSON.parse(world.storage.get('user:u1:saved')!).value.payment.id, 'p1');
  });

  test('a phone that cannot save does not begin', async () => {
    const { world, engine } = await broken();
    world.storage.full = true;
    await assert.rejects(engine.beginPayment(), /not saved/);
    assert.equal(state(engine), null);
  });

  test('a double tap asks once', async () => {
    const { world, engine } = await broken();
    const both = await Promise.all([engine.beginPayment(), engine.beginPayment(), engine.beginPayment()]);
    assert.equal(new Set(both).size, 1);
    assert.deepEqual(world.calls, ['POST /win-back']);
  });

  test('already paid on another phone: no sheet', async () => {
    const { engine, stripe } = await broken();
    stripe.state = 'paid';
    assert.equal(await engine.beginPayment(), null);
    await settle();
    assert.equal(engine.getSnapshot().today!.streak, 40);
  });
});

describe('killed while paying', () => {
  test('it says it is checking, and says paid when Stripe does', async () => {
    const { world, engine, stripe } = await broken();
    await engine.beginPayment();
    engine.stop();
    const again = world.open();
    assert.equal(state(again), 'checking');
    assert.deepEqual(bannerFor(again.getSnapshot()), { kind: 'payment', state: 'checking' });
    assert.equal(again.getSnapshot().offer, null);
    stripe.state = 'paid';
    await again.sync();
    await settle();
    assert.deepEqual(notices(again), ['Paid. Your 40 day streak is back.']);
  });

  test('paid a moment later: one "not paid" from Stripe is not enough to say so', async () => {
    const { world, engine, stripe } = await broken();
    await engine.beginPayment();
    engine.stop();
    const again = world.open();
    await again.checkPayment();
    assert.equal(state(again), 'checking');
    stripe.state = 'paid';
    await pass(world, 1);
    assert.equal(state(again), null);
  });

  test('never paid: after asking a few times it says no money was taken, and can be tried again', async () => {
    const { world, engine } = await broken();
    await engine.beginPayment();
    engine.stop();
    const again = world.open();
    await again.sync();
    await pass(world);
    assert.equal(state(again), 'unpaid');
    assert.deepEqual(again.getSnapshot().offer, OFFER);
    again.dismissPayment();
    assert.equal(state(again), null);
  });

  test('with no connection it goes on checking, for as long as it takes', async () => {
    const { world, engine, stripe } = await broken();
    await engine.beginPayment();
    world.online = false;
    await engine.sheetClosed(false);
    await pass(world, 10);
    assert.equal(state(engine), 'checking');
    engine.dismissPayment(); // cannot be waved away
    assert.equal(state(engine), 'checking');
    stripe.state = 'paid';
    world.online = true;
    engine.wake();
    await settle();
    assert.deepEqual(notices(engine), ['Paid. Your 40 day streak is back.']);
  });

  test('our server or Stripe in trouble is not a no', async () => {
    const { world, engine } = await broken();
    await engine.beginPayment();
    const respond = world.respond;
    world.respond = (method, path) => (path.startsWith('/win-back/payments') ? { status: 503, body: { error: 'stripe_unreachable', message: '' } } : respond(method, path));
    await engine.sheetClosed(false);
    await pass(world, 5);
    assert.equal(state(engine), 'checking');
  });
});

describe('what Stripe says', () => {
  test('declined: the reason, no money, and the offer is back', async () => {
    const { engine, stripe } = await broken();
    await engine.beginPayment();
    Object.assign(stripe, { state: 'declined', problem: 'Your card was declined.' });
    await engine.sheetClosed(false);
    assert.deepEqual([state(engine), engine.getSnapshot().payment!.problem], ['declined', 'Your card was declined.']);
    assert.deepEqual(engine.getSnapshot().offer, OFFER);
    assert.ok(await engine.beginPayment()); // the same one again
  });

  test('closed by hand: back to the offer at once', async () => {
    const { engine } = await broken();
    await engine.beginPayment();
    await engine.sheetClosed(true);
    assert.equal(state(engine), 'unpaid');
    assert.deepEqual(engine.getSnapshot().offer, OFFER);
  });

  test('the bank is asked: it can be gone on with, or left', async () => {
    const { engine, stripe } = await broken();
    await engine.beginPayment();
    stripe.state = 'bank';
    await engine.sheetClosed(false);
    assert.equal(state(engine), 'bank');
    assert.ok(await engine.beginPayment());
    await engine.sheetClosed(false);
    engine.dismissPayment();
    assert.equal(state(engine), null);
  });

  test('refunded: says the streak did not need it', async () => {
    const { engine, stripe } = await broken();
    await engine.beginPayment();
    stripe.state = 'refunded';
    await engine.sheetClosed(false);
    assert.deepEqual(notices(engine), ['Your streak did not need it, so your payment was refunded in full.']);
  });

  test('the account was reset: let go without a word', async () => {
    const { engine, stripe } = await broken();
    await engine.beginPayment();
    stripe.missing = true;
    await engine.sheetClosed(false);
    assert.equal(state(engine), null);
    assert.deepEqual(notices(engine), []);
  });
});

describe('the offline rule', () => {
  test('nothing is offered while anything is unsent', async () => {
    const { world, engine } = await broken();
    const { challenge: one } = engine.getSnapshot().today!;
    world.online = false;
    engine.begin(one);
    await settle();
    assert.equal(engine.getSnapshot().offer, null); // even a start
    playAll(engine, one);
    assert.equal(engine.getSnapshot().offer, null);
  });

  test('begun and not finished at midnight: no offer, and paying does not go around the gate', async () => {
    const { world, engine } = await broken();
    engine.answer(engine.getSnapshot().today!.challenge, 0, 'rare');
    await settle();
    world.calls = [];
    world.clock = '2026-11-24T00:10:00Z';
    engine.refreshView();
    assert.equal(engine.getSnapshot().offer, null);
    await assert.rejects(engine.beginPayment());
    assert.deepEqual(world.calls, []);
  });

  test('a payment that was begun is still checked then: that call does not count', async () => {
    const { world, engine, stripe } = await broken();
    await engine.beginPayment();
    engine.answer(engine.getSnapshot().today!.challenge, 0, 'rare');
    await settle();
    world.calls = [];
    world.clock = '2026-11-24T00:10:00Z';
    stripe.state = 'processing';
    await engine.sheetClosed(false);
    await settle();
    assert.deepEqual(world.calls, ['GET /win-back/payments/p1']);
    stripe.state = 'paid';
    await pass(world, 1);
    assert.ok(world.calls.every((call) => call.startsWith('GET /win-back/payments/')), world.calls.join()); // the streak waits for the gate
    assert.deepEqual(notices(engine), ['Paid. Your 40 day streak is back.']);
  });

  test('the 48 hours end while it is on screen: the offer goes', async () => {
    const { world, engine } = await broken();
    world.time = Date.parse(OFFER.closesAt) - 1;
    const respond = world.respond;
    world.respond = (method, path) => (path === '/today' ? { status: 200, body: world.today({ winBack: OFFER }) } : respond(method, path));
    await engine.sync();
    assert.ok(engine.getSnapshot().offer);
    assert.equal(engine.nextChange(), Date.parse(OFFER.closesAt));
    world.time += 1;
    engine.refreshView();
    assert.equal(engine.getSnapshot().offer, null);
  });
});

describe('the streak when it may be old', () => {
  test('two days in the air: the last known one stays until the last of them is in', async () => {
    const world = new World('2026-11-23T20:00:00Z');
    world.normal({ streak: 12 });
    const engine = world.open();
    await engine.sync();
    const { challenge: one, tomorrow } = engine.getSnapshot().today!;
    world.online = false;
    playAll(engine, one);
    world.time += 24 * HOUR;
    playAll(engine, tomorrow);
    await settle();
    assert.deepEqual([engine.getSnapshot().today!.streak, engine.getSnapshot().streakOld], [12, true]);
    const seen: number[] = [];
    engine.subscribe(() => seen.push(engine.getSnapshot().today!.streak));
    const respond = world.respond;
    world.respond = (method, path) => {
      const reply = respond(method, path);
      if (reply !== 'down' && path.endsWith('/complete')) (reply.body as { streak: number }).streak = path.includes(one.id) ? 0 : 14;
      if (reply !== 'down' && path === '/today') (reply.body as { streak: number }).streak = 14;
      return reply;
    };
    world.online = true;
    await engine.sync();
    assert.ok(!seen.includes(0), seen.join());
    assert.deepEqual([engine.getSnapshot().today!.streak, engine.getSnapshot().streakOld], [14, false]);
  });

  test('offline: what we knew, and that it may be old', async () => {
    const world = new World('2026-11-23T20:00:00Z');
    world.normal({ streak: 12 });
    const engine = world.open();
    await engine.sync();
    assert.equal(engine.getSnapshot().streakOld, false);
    world.online = false;
    const again = world.open();
    await again.sync();
    assert.deepEqual([again.getSnapshot().today!.streak, again.getSnapshot().streakOld], [12, true]);
  });
});

describe('the days', () => {
  const world = new World('2026-11-24T12:00:00Z'); // a Tuesday
  const today = world.today({
    recentDays: [
      { day: '2026-11-18', status: 'done' },
      { day: '2026-11-19', status: 'frozen' },
      { day: '2026-11-21', status: 'won_back' },
      { day: '2026-11-22', status: 'done' },
    ],
  });

  test('whole weeks, every kind of day, and nothing before the first', () => {
    const days = streakDays(today, emptySaved(), 2);
    assert.deepEqual(
      days.map(({ day, status }) => `${day.slice(8)} ${status}`),
      ['16 before', '17 before', '18 done', '19 frozen', '20 missed', '21 won_back', '22 done', '23 missed', '24 today'],
    );
    assert.equal(streakDays(today, emptySaved(), 5)[0]!.day, '2026-10-26'); // a Monday
  });

  test('a day finished here and not sent yet, and one that can still be finished', () => {
    const play = { challenge: challenge('2026-11-24'), begunAt: 1, answers: Array(8).fill('rare'), accepted: null };
    const days = streakDays({ ...today, settledThrough: '2026-11-22' }, { ...emptySaved(), plays: { a: play } }, 2);
    assert.deepEqual(days.slice(-2).map(({ status }) => status), ['late', 'unsent']);
  });
});
