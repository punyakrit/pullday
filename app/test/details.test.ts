import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { type Details, fetchDetails, keptDetails } from '../src/core/details';
import { HOUR, MemoryStorage, World, playAll, settle } from './fakes';

const DETAILS: Details = {
  id: 'c1',
  grader: 'PSA',
  certNumber: '1',
  priceCents: 885,
  population: 8,
  story: 'A story.',
  priceHistory: [
    { date: '2026-10-26', priceCents: 900 },
    { date: '2026-11-02', priceCents: 885 },
  ],
  priceDate: '2026-11-02',
};

async function opened(iso: string) {
  const world = new World(iso);
  serve(world);
  const engine = world.open();
  await engine.sync();
  world.calls = [];
  return { world, engine, today: engine.getSnapshot().today!, storage: world.storage };
}

function serve(world: World, body: object = { ...DETAILS, name: 'Name', acquiredAt: '2026-11-01T00:00:00Z' }) {
  world.normal();
  const normal = world.respond;
  world.respond = (method, path) => (path.startsWith('/cards/') ? { status: 200, body } : normal(method, path));
}

/** Calls that the server takes as the phone having been online. */
const contact = (calls: string[]) => calls.filter((call) => !/\/(start|complete|reveal-seen)$/.test(call));

describe('opening a card never costs an offline day', () => {
  test('finished offline, opened the next morning while the finish cannot be sent: no call that counts', async () => {
    const { world, engine, today, storage } = await opened('2026-11-23T20:00:00Z');
    world.online = false;
    playAll(engine, today.challenge);
    engine.revealShown(today.challenge.id);
    world.time += 14 * HOUR; // 10am
    world.online = true;
    world.respond = (_, path) => (path.startsWith('/cards/') ? { status: 200, body: DETAILS } : { status: 503, body: 'busy' });
    await assert.rejects(fetchDetails(engine, storage, 'c1'));
    await settle();
    assert.ok(world.calls.length > 0); // it did try to send first
    assert.deepEqual(contact(world.calls), []);
    assert.equal(engine.waitsFor(), 'send');
    assert.equal(engine.getSnapshot().unsent, 1);
  });

  test('the finish can be sent: it goes first, in order, and the card after it', async () => {
    const { world, engine, today, storage } = await opened('2026-11-23T20:00:00Z');
    world.online = false;
    playAll(engine, today.challenge);
    engine.revealShown(today.challenge.id);
    world.time += 14 * HOUR;
    world.online = true;
    assert.equal((await fetchDetails(engine, storage, 'c1')).population, 8);
    const id = today.challenge.id;
    assert.deepEqual(world.calls, [`POST /challenges/${id}/start`, `POST /challenges/${id}/complete`, `POST /challenges/${id}/reveal-seen`, 'GET /cards/c1']);
    assert.equal(engine.waitsFor(), null);
  });

  test('begun and not finished at 12:10am: no call that counts, until it is finished or the hour is over', async () => {
    const { world, engine, today, storage } = await opened('2026-11-23T23:50:00Z');
    engine.answer(today.challenge, 0, 'rare');
    await settle();
    world.calls = [];
    world.clock = '2026-11-24T00:10:00Z';
    await assert.rejects(fetchDetails(engine, storage, 'c1'));
    assert.deepEqual(world.calls, []);
    assert.equal(engine.waitsFor(), 'finish');

    world.clock = '2026-11-24T01:00:01Z';
    await fetchDetails(engine, storage, 'c1');
    assert.deepEqual(contact(world.calls), ['GET /cards/c1']);
  });

  test('two days played in the air: both go before the card', async () => {
    const { world, engine, today, storage } = await opened('2026-11-23T20:00:00Z');
    world.online = false;
    playAll(engine, today.challenge);
    world.time += 24 * HOUR;
    playAll(engine, today.tomorrow);
    world.time += 12 * HOUR;
    world.online = true;
    await fetchDetails(engine, storage, 'c1');
    const first = world.calls.findIndex((call) => contact([call]).length > 0);
    assert.equal(world.calls[first], 'GET /cards/c1');
    assert.equal(world.calls.slice(0, first).filter((call) => call.endsWith('/complete')).length, 2);
  });

  test('a session that ended while opening a card logs out and keeps what is unsent', async () => {
    const { world, engine, today, storage } = await opened('2026-11-23T20:00:00Z');
    world.respond = (_, path) => (path.startsWith('/cards/') ? { status: 401, body: { error: 'signed_out', message: '' } } : { status: 503, body: '' });
    await assert.rejects(fetchDetails(engine, storage, 'c1'));
    assert.equal(world.signedOut, 1);
    assert.equal(today.challenge.id, engine.getSnapshot().today!.challenge.id);
  });

  /** The rule itself: whoever adds a screen cannot go around the gate without this failing. */
  test('nothing but the engine and the session talks to the server', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((one) => (one.isDirectory() ? files(join(dir, one.name)) : [join(dir, one.name)]));
    const found = files(join(__dirname, '..', 'src'))
      .filter((file) => /\.tsx?$/.test(file))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8');
        const name = file.split('/src/')[1]!;
        return [/\bapi\.call\b/, /\bfetch\(/, /\bXMLHttpRequest\b/, /\bnew Api\(/, /\bWebSocket\b/].filter((one) => one.test(text)).map((one) => `${name} ${one.source}`);
      });
    assert.deepEqual(found.sort(), [
      'core/api.ts \\bfetch\\(', // the one everything goes through
      'core/engine.ts \\bapi\\.call\\b',
      'lib/pictures.ts \\bfetch\\(', // asks for a picture, which needs no login and does not count
      'lib/session.ts \\bapi\\.call\\b', // logging in and out, which do not count
      'lib/session.ts \\bfetch\\(',
      'lib/session.ts \\bnew Api\\(',
    ]);
  });
});

describe('what is kept on the phone', () => {
  test('opened once, it is there offline, without anything about the owner', async () => {
    const { world, engine, storage } = await opened('2026-11-23T12:00:00Z');
    assert.equal(keptDetails(storage, 'c1'), null);
    await fetchDetails(engine, storage, 'c1');
    world.online = false;
    await assert.rejects(fetchDetails(engine, storage, 'c1'));
    assert.deepEqual(keptDetails(storage, 'c1'), DETAILS);
    assert.ok(!storage.get('card:c1')!.includes('acquiredAt'));
  });

  test('a reply that is not a card is not kept, and a damaged row is fetched again', async () => {
    const { world, engine, storage } = await opened('2026-11-23T12:00:00Z');
    for (const body of [{}, { ...DETAILS, priceHistory: [{ date: 'soon', priceCents: 1 }] }, { ...DETAILS, population: null }]) {
      serve(world, body);
      await assert.rejects(fetchDetails(engine, storage, 'c1'));
      assert.equal(keptDetails(storage, 'c1'), null);
    }
    storage.set('card:c1', '{"version":1,"value":{"id"');
    assert.equal(keptDetails(storage, 'c1'), null);
    serve(world);
    assert.equal((await fetchDetails(engine, storage, 'c1')).story, 'A story.');
  });

  test('no space to keep it: it is still shown', async () => {
    const { engine } = await opened('2026-11-23T12:00:00Z');
    const full = new MemoryStorage();
    full.full = true;
    assert.equal((await fetchDetails(engine, full, 'c1')).population, 8);
  });
});
