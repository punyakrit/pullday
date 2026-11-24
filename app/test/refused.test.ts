import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Engine } from '../src/core/engine';
import { FIRST, roundOf } from '../src/core/round';
import { whyStuck } from '../src/core/stuck';
import type { Today } from '../src/core/types';
import { World, card, challenge, playAll, settle } from './fakes';

const DAY = '2026-11-23';
const view = (engine: Engine) => engine.getSnapshot().view;
const notices = (engine: Engine) => engine.getSnapshot().saved.notices.map((one) => one.text);
const answersOf = (engine: Engine) => {
  const shown = view(engine);
  assert.equal(shown.kind, 'challenge');
  return shown.kind === 'challenge' ? shown.answers.length : -1;
};
const idOf = (engine: Engine) => {
  const shown = view(engine);
  return shown.kind === 'challenge' ? shown.challenge.id : null;
};

async function opened() {
  const world = new World(`${DAY}T12:00:00Z`);
  world.normal();
  const engine = world.open();
  await engine.sync();
  world.calls = [];
  return { world, engine, today: engine.getSnapshot().today!.challenge };
}

/** The server forgets the account's challenges while the app is open, and makes new ones. */
function reset(world: World, over: Partial<Today> = {}) {
  world.normal({ challenge: challenge(DAY, { id: 'ch-new', cards: Array.from({ length: 8 }, (_, i) => card(`new-${i}`)) }), ...over });
  const normal = world.respond;
  world.respond = (method, path, body) =>
    path.startsWith('/challenges/') && !path.includes('ch-new') ? { status: 404, body: { error: 'no_such_challenge', message: 'That challenge does not exist.' } } : normal(method, path, body);
}

describe('a refused finish', () => {
  test('the account was reset while the app was open: said, asked again, and the new challenge from its first card', async () => {
    const { world, engine, today } = await opened();
    engine.begin(today);
    await settle();
    reset(world);
    world.calls = [];
    playAll(engine, today);
    assert.equal(view(engine).kind, 'reveal'); // for now
    await settle();
    assert.deepEqual(world.calls, [`POST /challenges/${today.id}/complete`, 'GET /today', 'GET /collection']);
    assert.deepEqual([idOf(engine), answersOf(engine)], ['ch-new', 0]);
    assert.equal(notices(engine).length, 1);
    assert.match(notices(engine)[0]!, /no longer has that challenge, so it did not count/);
    assert.equal(engine.getSnapshot().unsent, 0);
    playAll(engine, engine.getSnapshot().today!.challenge); // and that one can be played
    assert.equal(view(engine).kind, 'reveal');
    await settle();
    assert.equal(notices(engine).length, 1);
  });

  for (const [status, code] of [[409, 'too_late'], [409, 'too_early'], [400, 'bad_request'], [403, 'anything']] as const) {
    test(`${code}: asked again at once, one line, from the first card`, async () => {
      const { world, engine, today } = await opened();
      const normal = world.respond;
      world.respond = (method, path) => (path.endsWith('/complete') ? { status, body: { error: code, message: 'no' } } : normal(method, path));
      playAll(engine, today);
      await settle();
      assert.equal(world.calls.filter((call) => call === 'GET /today').length, 1);
      assert.equal(notices(engine).length, 1);
      assert.deepEqual([idOf(engine), answersOf(engine)], [today.id, 0]);
    });
  }

  test('also when a sync was under way that asked before', async () => {
    const { world, engine, today } = await opened();
    engine.begin(today);
    await settle();
    world.calls = [];
    const syncing = engine.sync(); // its /today is from before the reset
    await Promise.resolve();
    await settle();
    reset(world);
    playAll(engine, today);
    await syncing;
    await settle();
    assert.equal(idOf(engine), 'ch-new');
  });

  test('and /today fails: not the challenge that is gone, not given up, and no storm of calls', async () => {
    const { world, engine, today } = await opened();
    engine.begin(today);
    await settle();
    reset(world);
    const after = world.respond;
    world.respond = (method, path, body) => (path === '/today' ? { status: 503, body: { error: 'down', message: '' } } : after(method, path, body));
    world.calls = [];
    playAll(engine, today);
    await settle();
    assert.equal(view(engine).kind, 'empty');
    assert.equal(notices(engine).length, 1);
    assert.ok(world.calls.length <= 4, world.calls.join());
    assert.ok(world.timers.length > 0); // it tries again by itself
    world.calls = [];
    engine.wake(); // and when the app comes to the front, however fresh the last answer is
    await settle();
    assert.ok(world.calls.includes('GET /today'));
    world.respond = after;
    await engine.tryAgain();
    assert.deepEqual([idOf(engine), answersOf(engine)], ['ch-new', 0]);
  });

  test('a wake right after a refusal asks, although the app was just told', async () => {
    const { world, engine, today } = await opened();
    engine.begin(today);
    await settle();
    reset(world);
    world.hangs = '/today';
    playAll(engine, today);
    await settle();
    world.hangs = null;
    await new Promise((resolve) => setTimeout(resolve, 260)); // the hung call is over
    world.calls = [];
    engine.wake();
    await settle();
    assert.equal(idOf(engine), 'ch-new');
  });
});

describe('a refused start', () => {
  test('no such challenge: the new one at once, not 8 swipes later', async () => {
    const { world, engine, today } = await opened();
    reset(world);
    engine.begin(today);
    await settle();
    assert.deepEqual(world.calls, [`POST /challenges/${today.id}/start`, 'GET /today', 'GET /collection']);
    assert.deepEqual([idOf(engine), answersOf(engine)], ['ch-new', 0]);
    assert.deepEqual(notices(engine), []); // nothing was lost
  });

  test('a swipe or two were lost with it: said', async () => {
    const { world, engine, today } = await opened();
    reset(world);
    engine.answer(today, 0, 'rare');
    engine.answer(today, 1, 'rare');
    await settle();
    assert.equal(idOf(engine), 'ch-new');
    assert.equal(notices(engine).length, 1);
    engine.answer(today, 2, 'rare'); // the deck that is on its way out
    assert.deepEqual(Object.keys(engine.getSnapshot().saved.plays), []);
    assert.deepEqual(engine.getSnapshot().saved.outbox, []);
  });

  test('also in the last minute of the day, when a begun challenge holds all contact', async () => {
    const { world, engine, today } = await opened();
    world.clock = `${DAY}T23:59:30Z`;
    reset(world);
    engine.answer(today, 0, 'rare');
    await settle();
    assert.equal(idOf(engine), 'ch-new');
  });

  test('too late or anything else changes nothing', async () => {
    const { world, engine, today } = await opened();
    const normal = world.respond;
    world.respond = (method, path) => (path.endsWith('/start') ? { status: 409, body: { error: 'too_late', message: '' } } : normal(method, path));
    engine.answer(today, 0, 'rare');
    await settle();
    assert.deepEqual(world.calls, [`POST /challenges/${today.id}/start`]);
    assert.deepEqual([idOf(engine), answersOf(engine)], [today.id, 1]);
  });
});

describe('the deck starts over', () => {
  test('when its answers are taken away, with the same challenge', async () => {
    const { world, engine, today } = await opened();
    const normal = world.respond;
    world.respond = (method, path) => (path.endsWith('/complete') ? { status: 400, body: { error: 'bad_request', message: '' } } : normal(method, path));
    let round = roundOf(FIRST, view(engine));
    engine.subscribe(() => (round = roundOf(round, view(engine))));
    const before = round.key;
    playAll(engine, today);
    assert.equal(round.key, before); // not while it goes on
    await settle();
    assert.deepEqual([idOf(engine), answersOf(engine)], [today.id, 0]);
    assert.notEqual(round.key, before);
  });

  test('and only then', () => {
    const at = (answers: number, id = 'a') => ({ kind: 'challenge', challenge: challenge(DAY, { id }), answers: Array(answers).fill('rare'), lateUntil: null, waiting: null }) as const;
    const reveal = { kind: 'reveal', reveal: { challengeId: 'a', day: DAY, card: null, score: 1, saved: false } } as const;
    let round = roundOf(FIRST, at(3));
    const first = round.key;
    for (const next of [at(3), at(4), at(8), reveal, { kind: 'empty' } as const]) {
      round = roundOf(round, next);
      assert.equal(round.key, first);
    }
    round = roundOf(round, at(0)); // after the reveal was taken back
    const second = round.key;
    assert.notEqual(second, first);
    round = roundOf(round, at(1));
    assert.equal(round.key, second);
    round = roundOf(round, at(0));
    assert.notEqual(round.key, second); // one answer is enough
    assert.notEqual(roundOf(round, at(0, 'b')).key, round.key); // another challenge
    assert.equal(roundOf(round, at(0)), round); // nothing new, nothing to draw
  });
});

describe('the last swipe never ends in an empty screen', () => {
  test('a full phone with no connection: says why, and once there is space the card', async () => {
    const { world, engine, today } = await opened();
    world.storage.full = true;
    world.online = false;
    playAll(engine, today);
    await settle();
    assert.equal(answersOf(engine), 8); // nothing is revealed
    assert.match(whyStuck(engine.getSnapshot()).title, /can't save/);
    await engine.tryAgain(); // still full
    assert.equal(answersOf(engine), 8);
    world.storage.full = false;
    await engine.tryAgain(); // still offline
    assert.equal(view(engine).kind, 'reveal');
  });

  test('a full phone, and the call hangs: says why, and trying again makes a new call', async () => {
    const { world, engine, today } = await opened();
    engine.begin(today);
    await settle();
    world.storage.full = true;
    world.hangs = '/complete';
    playAll(engine, today);
    await settle();
    assert.equal(answersOf(engine), 8);
    assert.match(whyStuck(engine.getSnapshot()).title, /can't save/);
    world.hangs = null;
    world.calls = [];
    await engine.tryAgain(); // does not wait for the one that hangs
    assert.equal(world.calls[0], `POST /challenges/${today.id}/complete`);
    assert.equal(view(engine).kind, 'reveal');
  });

  test('the call hangs on a phone that can save: the card is there anyway', async () => {
    const { world, engine, today } = await opened();
    world.hangs = '/challenges/';
    playAll(engine, today);
    await settle();
    assert.equal(view(engine).kind, 'reveal');
  });

  test('refused, and the next call hangs: trying again makes a new call', async () => {
    const { world, engine, today } = await opened();
    engine.begin(today);
    await settle();
    reset(world);
    world.hangs = '/today';
    playAll(engine, today);
    await settle();
    assert.equal(view(engine).kind, 'empty');
    world.hangs = null;
    await engine.tryAgain();
    assert.equal(idOf(engine), 'ch-new');
  });

  test('giving up a call leaves everything else alone', async () => {
    const { world, engine } = await opened();
    world.hangs = '/cards/';
    const read = engine.get('/cards/x').then(
      () => 'answered',
      () => 'given up',
    );
    let ended = false;
    void read.then(() => (ended = true));
    await settle();
    await engine.tryAgain();
    assert.equal(ended, false);
    await read;
  });

  test('the session ends on the last swipe: says so, and after logging in the card is there', async () => {
    const { world, engine, today } = await opened();
    engine.begin(today);
    await settle();
    const normal = world.respond;
    world.respond = () => ({ status: 401, body: { error: 'signed_out', message: '' } });
    let told = false;
    engine.subscribe(() => (told ||= engine.getSnapshot().ended));
    playAll(engine, today);
    await settle();
    assert.equal(world.signedOut, 1);
    assert.ok(told);
    assert.match(whyStuck(engine.getSnapshot()).title, /session ended/);
    world.respond = normal;
    const again = world.open();
    assert.equal(view(again).kind, 'reveal');
    await again.sync();
    assert.equal(again.getSnapshot().unsent, 0);
  });

  test('the session ends in the middle: after logging in it goes on at the same card', async () => {
    const { world, engine, today } = await opened();
    const normal = world.respond;
    world.respond = () => ({ status: 401, body: { error: 'signed_out', message: '' } });
    for (let i = 0; i < 4; i++) engine.answer(today, i, 'rare');
    await settle();
    world.respond = normal;
    assert.equal(answersOf(world.open()), 4);
  });

  test('a reason for everything, none of them empty', () => {
    const base = { ended: false, unsaved: false, unsent: 0, connection: 'online' } as const;
    const all = [base, { ...base, ended: true }, { ...base, unsaved: true }, { ...base, unsaved: true, connection: 'offline' }, { ...base, unsent: 1 }, { ...base, connection: 'offline' }, { ...base, connection: 'trouble' }] as const;
    const said = all.map((one) => whyStuck(one));
    assert.ok(said.every(({ title, line }) => title && line));
    assert.equal(new Set(said.map(({ title, line }) => title + line)).size, all.length);
  });
});

describe('a refused reveal-seen', () => {
  for (const [status, code] of [[404, 'no_such_challenge'], [409, 'whatever'], [400, 'bad_request']] as const) {
    test(`${code}: the card stays until it is closed, and does not come back`, async () => {
      const { world, engine, today } = await opened();
      const normal = world.respond;
      const still = { challengeId: today.id, day: DAY, acquiredAt: `${DAY}T12:00:00Z`, card: card(`reward-${DAY}`, 'holo') };
      world.respond = (method, path, body) => {
        if (path.endsWith('/reveal-seen')) return { status, body: { error: code, message: '' } };
        if (path === '/today') return { status: 200, body: world.today({ todayDone: true, challenge: challenge(DAY, { completedAt: `${DAY}T12:00:00Z` }), unseenReveals: [still] }) };
        return normal(method, path, body);
      };
      playAll(engine, today);
      await settle();
      engine.revealShown(today.id);
      await settle();
      assert.equal(view(engine).kind, 'reveal');
      assert.deepEqual(engine.getSnapshot().saved.outbox, []);
      engine.closeReveal();
      await settle();
      assert.equal(view(engine).kind, 'done');
      await engine.sync();
      assert.equal(view(engine).kind, 'done'); // the server still lists it
      engine.stop();
      assert.equal(view(world.open()).kind, 'done');
    });
  }

  test('the account was reset while the card was open: closed, then the new challenge', async () => {
    const { world, engine, today } = await opened();
    playAll(engine, today);
    await settle();
    reset(world);
    engine.revealShown(today.id);
    await settle();
    assert.equal(view(engine).kind, 'reveal');
    engine.closeReveal();
    await settle();
    assert.deepEqual([idOf(engine), answersOf(engine)], ['ch-new', 0]);
  });
});
