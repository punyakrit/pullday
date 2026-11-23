import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Engine } from '../src/core/engine';
import type { Today } from '../src/core/types';
import { World, playAll, settle } from './fakes';

const CLEAN = '2026-11-23T12:00:00Z';

/** A phone, and a server that keeps the rules of the real one: one grant for a transaction, 2 at most. */
async function shop(over: Partial<Today> = {}, held = 0) {
  const world = new World(CLEAN);
  const server = { held, granted: new Map<string, string>(), refunds: [] as string[], begun: [] as string[], loseReply: false };
  world.normal(over);
  const normal = world.respond;
  world.respond = (method, path, body) => {
    if (path === '/today') return { status: 200, body: world.today({ ...over, freezes: server.held, freezeRefunds: server.refunds }) };
    if (path === '/freezes/purchases') {
      if (server.held >= 2) return { status: 409, body: { error: 'freezes_full', message: 'You already hold 2 freezes, the most you can.' } };
      server.begun.push((body as { id: string }).id);
      return { status: 200, body: { beganAt: new Date(world.time).toISOString(), priceCents: 199 } };
    }
    const confirm = /^\/freezes\/purchases\/(.+)\/confirm$/.exec(path);
    if (!confirm) return normal(method, path, body);
    const { transactionId } = body as { transactionId: string };
    if (!server.granted.has(transactionId)) {
      const full = server.held >= 2;
      server.granted.set(transactionId, full ? 'refunded' : 'granted');
      if (full) server.refunds = [...server.refunds, transactionId];
      else server.held++;
    }
    if (server.loseReply) return 'down';
    return { status: 200, body: { freezeId: transactionId, state: server.granted.get(transactionId) } };
  };
  const engine = world.open();
  await engine.sync();
  world.calls = [];
  return { world, engine, server };
}
const states = (engine: Engine) => engine.getSnapshot().saved.purchases.map((one) => one.state);
const notices = (engine: Engine) => engine.getSnapshot().saved.notices.map((one) => one.text);
const onDisk = (world: World) => JSON.parse(world.storage.get('user:u1:saved')!).value.purchases as { id: string; state: string }[];

/** Tap buy, and the sheet is up. */
async function tap(engine: Engine) {
  const run = engine.buyFreeze();
  await settle();
  return run;
}
/** The whole way, through the sheet. */
async function buy(world: World, engine: Engine) {
  const run = engine.buyFreeze();
  await settle();
  world.store.pay();
  world.storeGoesOn();
  const answer = await run;
  await settle();
  return answer;
}
const kill = (world: World, engine: Engine) => {
  engine.stop();
  return world.open();
};

describe('buying a freeze', () => {
  test('saved, begun on the server, the sheet, paid, confirmed, finished', async () => {
    const { world, engine, server } = await shop();
    const run = engine.buyFreeze();
    assert.equal(onDisk(world)[0]!.state, 'buying'); // before anyone is asked
    await settle();
    assert.deepEqual(server.begun, [onDisk(world)[0]!.id]);
    assert.ok(world.store.getSheet());
    world.store.pay();
    world.storeGoesOn();
    assert.equal(await run, 'granted');
    await settle();
    assert.deepEqual(states(engine), []);
    assert.deepEqual(world.store.transactions('u1'), []);
    assert.deepEqual(notices(engine), []); // the shop says it
    assert.equal(engine.getSnapshot().today!.freezes, 1);
    assert.equal(await buy(world, engine), 'granted');
    assert.equal(engine.getSnapshot().today!.freezes, 2);
  });

  test('a double tap is one purchase', async () => {
    const { world, engine, server } = await shop();
    const taps = [engine.buyFreeze(), engine.buyFreeze(), engine.buyFreeze()];
    await settle();
    world.store.pay();
    world.store.pay();
    world.storeGoesOn();
    assert.deepEqual(await Promise.all(taps), ['granted', 'granted', 'granted']);
    assert.deepEqual([server.begun.length, server.held], [1, 1]);
  });

  test('at 2: the server says no before the store is asked', async () => {
    const { world, engine } = await shop({}, 2);
    await assert.rejects(engine.buyFreeze(), /already hold 2/);
    assert.equal(world.store.getSheet(), null);
    assert.deepEqual([states(engine), world.store.transactions('u1')], [[], []]);
  });

  test('offline: the sheet never opens', async () => {
    const { world, engine } = await shop();
    world.online = false;
    await assert.rejects(engine.buyFreeze());
    assert.equal(world.store.getSheet(), null);
    assert.deepEqual(states(engine), []);
  });

  test('a phone that cannot save does not begin', async () => {
    const { world, engine } = await shop();
    world.storage.full = true;
    await assert.rejects(engine.buyFreeze(), /not saved/);
    assert.deepEqual(world.calls, []);
    assert.equal(engine.getSnapshot().buying, null);
  });

  test('cancelled, and failed: no money, said until it is read or tried again', async () => {
    const { world, engine } = await shop();
    const run = engine.buyFreeze();
    await settle();
    world.store.cancel();
    assert.equal(await run, 'canceled');
    assert.deepEqual(states(engine), ['canceled']);
    assert.equal(await Promise.resolve(engine.buyFreeze('canceled')), 'canceled');
    const failing = engine.buyFreeze('failed');
    await settle();
    world.storeGoesOn();
    assert.equal(await failing, 'failed');
    assert.deepEqual([states(engine), world.store.transactions('u1')], [['failed'], []]);
    engine.dismissPurchase(engine.getSnapshot().saved.purchases[0]!.id);
    assert.deepEqual(states(engine), []);
  });

  test('once it is paying, the sheet cannot be closed under it', async () => {
    const { world, engine } = await shop();
    const run = engine.buyFreeze();
    await settle();
    world.store.pay();
    world.store.cancel();
    world.storeGoesOn();
    assert.equal(await run, 'granted');
  });
});

describe('pending', () => {
  async function pending(held = 0) {
    const all = await shop({}, held);
    const run = all.engine.buyFreeze('pending');
    await settle();
    all.world.storeGoesOn();
    assert.equal(await run, 'pending');
    return all;
  }

  test('approved later, with the app open', async () => {
    const { world, engine, server } = await pending();
    assert.deepEqual([states(engine), server.held], [['pending'], 0]);
    world.store.decide('u1', true);
    await settle();
    assert.deepEqual([states(engine), server.held, notices(engine)], [[], 1, ['Your streak freeze is here.']]);
  });

  test('approved while the app was dead', async () => {
    const { world, engine, server } = await pending();
    engine.stop();
    world.store.decide('u1', true);
    const again = world.open();
    assert.deepEqual(states(again), ['pending']);
    await again.sync();
    await settle();
    assert.deepEqual([states(again), server.held], [[], 1]);
  });

  test('declined: no money, and it says so', async () => {
    const { world, engine, server } = await pending();
    world.store.decide('u1', false);
    await settle();
    assert.deepEqual([states(engine), server.held, world.store.transactions('u1')], [['declined'], 0, []]);
  });

  test('another can be bought meanwhile, and if it completes at 2 the money goes back', async () => {
    const { world, engine, server } = await pending(1);
    assert.equal(await buy(world, engine), 'granted');
    assert.deepEqual(states(engine), ['pending']);
    world.store.decide('u1', true);
    await settle();
    assert.equal(server.held, 2);
    assert.deepEqual(notices(engine), ['You can hold 2 freezes, so a third was not kept. Its $1.99 goes back to you.']); // once
    assert.deepEqual(world.store.transactions('u1'), []);
  });
});

describe('killed while buying', () => {
  test('before the server had heard of it: as if nothing happened', async () => {
    const { world, engine } = await shop();
    void engine.buyFreeze();
    const again = kill(world, engine);
    await again.sync();
    assert.deepEqual(states(again), []);
  });

  test('with the sheet open: not bought, no money was taken', async () => {
    const { world, engine } = await shop();
    void tap(engine);
    await settle();
    const again = world.open(); // no stop: it just dies
    await again.sync();
    assert.deepEqual(states(again), ['unpaid']);
  });

  test('right after the tap on buy: the store goes on, and the freeze arrives', async () => {
    const { world, engine, server } = await shop();
    void engine.buyFreeze('purchased');
    await settle();
    const again = kill(world, engine);
    await again.sync();
    assert.deepEqual([states(again), server.held], [['processing'], 0]);
    world.storeGoesOn();
    await settle();
    assert.deepEqual([states(again), server.held, notices(again)], [[], 1, ['Your streak freeze is here.']]);
  });

  test('charged, and dead before the server heard: handed over on launch, granted once', async () => {
    const { world, engine, server } = await shop();
    server.loseReply = true; // the server granted it, the phone never heard
    const run = engine.buyFreeze('purchased');
    await settle();
    world.storeGoesOn();
    assert.equal(await run, 'paid');
    assert.equal(server.held, 1);
    const again = kill(world, engine);
    server.loseReply = false;
    await again.sync();
    await settle();
    assert.deepEqual([states(again), server.held, world.store.transactions('u1')], [[], 1, []]);
  });

  test('what the phone had saved is gone: the store still hands it over', async () => {
    const { world, engine, server } = await shop();
    void engine.buyFreeze('purchased');
    await settle();
    engine.stop();
    world.storage.remove('user:u1:saved');
    const again = world.open();
    await again.sync();
    world.storeGoesOn();
    await settle();
    assert.deepEqual([states(again), server.held], [[], 1]);
  });

  test('another account on this phone does not get it', async () => {
    const { world, engine, server } = await shop();
    void engine.buyFreeze('purchased');
    await settle();
    engine.stop();
    const other = world.open({ id: 'u2', email: 'b@example.com', timezone: 'UTC' });
    world.storeGoesOn();
    await other.sync();
    assert.deepEqual([states(other), server.held], [[], 0]);
    assert.equal(world.store.transactions('u1').length, 1); // it waits for its own
  });
});

describe('the connection goes after the store has charged', () => {
  test('paid, waiting, confirmed when there is a connection, finished only then', async () => {
    const { world, engine, server } = await shop();
    const run = engine.buyFreeze();
    await settle();
    world.online = false;
    world.store.pay();
    world.storeGoesOn();
    assert.equal(await run, 'paid');
    assert.deepEqual([states(engine), world.store.transactions('u1').length], [['paid'], 1]);
    assert.deepEqual(world.timers.map((timer) => timer.ms), [3_000]);
    world.online = true;
    engine.wake();
    await settle();
    assert.deepEqual([states(engine), server.held, world.store.transactions('u1')], [[], 1, []]);
  });

  test('our server in trouble: tried again by itself', async () => {
    const { world, engine, server } = await shop();
    server.loseReply = true;
    const run = engine.buyFreeze('purchased');
    await settle();
    world.storeGoesOn();
    await run;
    server.loseReply = false;
    const [timer] = world.timers;
    timer!.work();
    await settle();
    assert.deepEqual([states(engine), server.held], [[], 1]);
  });
});

describe('the offline rule', () => {
  test('beginning waits for the outbox', async () => {
    const { world, engine } = await shop();
    const one = engine.getSnapshot().today!.challenge;
    world.online = false;
    playAll(engine, one);
    await settle();
    world.online = true;
    void engine.buyFreeze();
    await settle();
    const outbox = world.calls.indexOf(`POST /challenges/${one.id}/complete`);
    assert.ok(outbox >= 0 && outbox < world.calls.indexOf('POST /freezes/purchases'), world.calls.join());
  });

  test('a challenge begun and not finished at midnight: nothing can be begun', async () => {
    const { world, engine } = await shop();
    engine.answer(engine.getSnapshot().today!.challenge, 0, 'rare');
    await settle();
    world.calls = [];
    world.clock = '2026-11-24T00:10:00Z';
    await assert.rejects(engine.buyFreeze());
    assert.deepEqual(world.calls, []);
    assert.equal(world.store.getSheet(), null);
  });

  test('but one that was begun is confirmed then, and nothing else is asked', async () => {
    const { world, engine, server } = await shop();
    const run = engine.buyFreeze('pending');
    await settle();
    world.storeGoesOn();
    await run;
    engine.answer(engine.getSnapshot().today!.challenge, 0, 'rare');
    await settle();
    world.calls = [];
    world.clock = '2026-11-24T00:10:00Z';
    world.store.decide('u1', true);
    await settle();
    assert.equal(server.held, 1);
    assert.deepEqual(world.calls.map((call) => call.replace(/purchases\/.+\//, 'purchases/*/')), ['POST /freezes/purchases/*/confirm']);
  });
});

describe('the fake store', () => {
  test('one sheet at a time', async () => {
    const { world, engine } = await shop();
    void tap(engine);
    await settle();
    assert.equal(await world.store.purchase('x', 'u1'), 'failed');
    assert.equal(world.store.getSheet()!.token, engine.getSnapshot().buying);
  });

  test('a full phone: it fails, and nothing was taken', async () => {
    const { world, engine } = await shop();
    const run = engine.buyFreeze();
    await settle();
    world.storage.full = true;
    world.store.pay();
    assert.equal(await run, 'failed');
    assert.deepEqual(world.store.transactions('u1'), []);
  });

  test('logging out closes the sheet', async () => {
    const { world, engine } = await shop();
    void tap(engine);
    await settle();
    engine.stop();
    assert.equal(world.store.getSheet(), null);
  });

  test('starting over forgets it', async () => {
    const { world, engine } = await shop();
    const run = engine.buyFreeze('pending');
    await settle();
    world.storeGoesOn();
    await run;
    engine.forget();
    assert.deepEqual([states(engine), world.store.transactions('u1')], [[], []]);
  });
});
