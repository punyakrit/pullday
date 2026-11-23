import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CATALOGUE, CLOCK, type Kind, OWNED, SAVED, TODAY, readLogin, readRow, writeRow } from '../src/core/rows';
import { emptySaved } from '../src/core/state';
import { HOUR, MemoryStorage, USER, World, card, challenge, playAll, settle } from './fakes';

const KEY = 'user:u1:saved';
const ASIDE = `${KEY}:aside`;

/** 3 of 8 swiped and one finish unsent, as the phone has it. */
async function playedOffline() {
  const world = new World('2026-11-23T12:00:00Z');
  world.normal();
  const engine = world.open();
  await engine.sync();
  const { challenge: one, tomorrow } = engine.getSnapshot().today!;
  world.online = false;
  playAll(engine, one);
  engine.revealShown(one.id);
  engine.closeReveal();
  world.time += 24 * HOUR;
  engine.refreshView();
  for (let i = 0; i < 3; i++) engine.answer(tomorrow, i, 'rare');
  await settle();
  engine.stop();
  return { world, one, tomorrow };
}

/** The row as an app from before versions wrote it. */
function withoutVersion(world: World, key: string) {
  const { value } = JSON.parse(world.storage.get(key)!) as { value: unknown };
  world.storage.set(key, JSON.stringify(value));
}

describe('an update of the app', () => {
  test('rows from before there were versions: nothing is lost, and what was unsent is sent', async () => {
    const { world, one, tomorrow } = await playedOffline();
    for (const key of [KEY, 'user:u1:today', 'user:u1:owned', 'user:u1:clock']) withoutVersion(world, key);
    const engine = world.open();
    const { view, unsent, saved } = engine.getSnapshot();
    assert.ok(view.kind === 'challenge' && view.challenge.id === tomorrow.id);
    assert.equal(view.answers.length, 3);
    assert.equal(unsent, 1);
    assert.deepEqual(saved.notices, []);
    world.online = true;
    world.calls = [];
    await engine.sync();
    assert.ok(world.calls.includes(`POST /challenges/${one.id}/complete`));
    assert.equal(engine.getSnapshot().unsent, 0);
    assert.equal(world.storage.get(ASIDE), null);
  });

  test('upgrades run in order, from the version the row has', () => {
    const kind: Kind<string> = {
      upgrades: [(old) => `${old} a`, (old) => `${old} b`, (old) => `${old} c`],
      check: (value): value is string => typeof value === 'string',
    };
    const storage = new MemoryStorage();
    const read = (text: string) => {
      storage.set('k', text);
      return readRow(storage, 'k', kind);
    };
    assert.deepEqual(read('"from 0"'), { value: 'from 0 a b c', unusable: false });
    assert.deepEqual(read('{"version":2,"value":"from 2"}'), { value: 'from 2 c', unusable: false });
    assert.deepEqual(read('{"version":3,"value":"from 3"}'), { value: 'from 3', unusable: false });
    assert.deepEqual(read('{"version":4,"value":"from a newer app"}'), { value: null, unusable: true });
    writeRow(storage, 'k', kind, 'now');
    assert.equal(storage.get('k'), '{"version":3,"value":"now"}');
  });

  test('an upgrade that cannot make sense of the row does not stop the app', () => {
    const kind: Kind<string> = {
      upgrades: [(old) => (old as { a: { b: string } }).a.b],
      check: (value): value is string => typeof value === 'string',
    };
    const storage = new MemoryStorage();
    storage.set('k', '{}');
    assert.deepEqual(readRow(storage, 'k', kind), { value: null, unusable: true });
  });
});

describe('a row that cannot be used', () => {
  const play = { challenge: challenge('2026-11-23'), begunAt: 1, answers: ['rare'], accepted: null };
  const saved = (over: object) => JSON.stringify({ version: 1, value: { ...emptySaved(), ...over } });
  const damaged: [string, string][] = [
    ['cut short', '{"version":1,"value":{"plays":{"ch'],
    ['empty', ''],
    ['null', 'null'],
    ['a number', '42'],
    ['from a newer app', JSON.stringify({ version: 99, value: emptySaved() })],
    ['no plays', JSON.stringify({ version: 1, value: { outbox: [], seen: {}, notices: [] } })],
    ['a play with no challenge', saved({ plays: { a: { ...play, challenge: undefined } } })],
    ['a challenge with no end', saved({ plays: { a: { ...play, challenge: { ...play.challenge, endsAt: 'soon' } } } })],
    ['a challenge with 7 cards', saved({ plays: { a: { ...play, challenge: { ...play.challenge, cards: play.challenge.cards.slice(1) } } } })],
    ['an answer that is not one', saved({ plays: { a: { ...play, answers: ['epic'] } } })],
    ['an unknown kind of work', saved({ outbox: [{ kind: 'pay', challengeId: 'a', endsAt: 1 }] })],
    ['a finish with no answers', saved({ outbox: [{ kind: 'complete', challengeId: 'a', endsAt: 1 }] })],
  ];

  for (const [name, text] of damaged) {
    test(`${name}: the app opens, keeps it aside, says so, and can be played`, async () => {
      const world = new World('2026-11-23T12:00:00Z');
      world.normal();
      world.storage.set(KEY, text);
      const engine = world.open();
      assert.equal(engine.getSnapshot().saved.notices.length, 1);
      assert.equal(world.storage.get(ASIDE), text);
      assert.equal(world.open().getSnapshot().saved.notices.length, 1); // opened again: told once
      assert.equal(world.storage.get(ASIDE), text); // and the good row did not take its place
      await engine.sync();
      playAll(engine, engine.getSnapshot().today!.challenge);
      await settle();
      assert.equal(engine.getSnapshot().unsent, 0);
      engine.dismissNotice('unreadable');
      assert.deepEqual(world.open().getSnapshot().saved.notices, []);
    });
  }

  test('what can be fetched again is fetched again, without a word', async () => {
    const { world, tomorrow } = await playedOffline();
    for (const key of ['user:u1:today', 'user:u1:owned', 'user:u1:clock']) world.storage.set(key, '{"version":1,"value":{"half');
    const engine = world.open();
    const before = engine.getSnapshot();
    assert.equal(before.today, null);
    assert.equal(before.owned, null);
    assert.equal(before.unsent, 1); // what cannot be fetched again is still here
    assert.deepEqual(before.saved.notices, []);
    world.online = true;
    await engine.sync();
    // Sent, and the half played one is still where it was left.
    const after = engine.getSnapshot();
    assert.equal(after.unsent, 0);
    assert.ok(after.view.kind === 'challenge' && after.view.challenge.id === tomorrow.id && after.view.answers.length === 3);
    assert.deepEqual(world.open().getSnapshot().owned, []);
  });

  test('starting over forgets what was kept aside too', () => {
    const world = new World('2026-11-23T12:00:00Z');
    world.storage.set(KEY, 'damaged');
    const engine = world.open();
    assert.equal(world.storage.get(ASIDE), 'damaged');
    engine.forget();
    assert.deepEqual([...world.storage.rows.keys()], []);
  });
});

describe('the kept login', () => {
  const kept = JSON.stringify({ token: 't', user: USER });

  test('after a restart or an update it is still there', () => {
    assert.deepEqual(readLogin(kept, 'device-1'), { token: 't', user: USER });
  });

  test('the app was deleted and installed again: the login that stayed behind does not count', () => {
    assert.equal(readLogin(kept, null), null);
  });

  test('never logged in, or damaged', () => {
    for (const text of [null, '', '{', 'null', '[]', '{"token":"t"}', '{"token":1,"user":{}}', '{"token":"t","user":{"id":"a"}}']) {
      assert.equal(readLogin(text, 'device-1'), null);
    }
  });
});

test('every kind of row reads back what it wrote', () => {
  const storage = new MemoryStorage();
  const world = new World('2026-11-23T12:00:00Z');
  const back = <T>(kind: Kind<T>, value: T) => {
    writeRow(storage, 'k', kind, value);
    assert.deepEqual(readRow(storage, 'k', kind), { value, unusable: false });
  };
  back(SAVED, emptySaved());
  back(TODAY, world.today());
  back(TODAY, world.today({ resume: challenge('2026-11-22'), challenge: challenge('2026-11-23', { reward: null }) }));
  back(TODAY, world.today({ unseenReveals: [{ challengeId: 'a', day: '2026-11-22', acquiredAt: '', card: card('old') }] }));
  back(OWNED, [{ cardId: 'a', acquiredAt: '2026-11-23T12:00:00Z', revealSeenAt: null }]);
  back(CATALOGUE, [card('a'), card('b', 'holo')]);
  back(CLOCK, { offset: -12.5, floor: 0 });
  assert.deepEqual(readRow(storage, 'nothing', SAVED), { value: null, unusable: false });
});
