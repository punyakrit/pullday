import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CatalogueKeeper } from '../src/core/catalogue';
import { catalogueOf, ownedNow } from '../src/core/collection';
import type { OwnedCard } from '../src/core/engine';
import { emptySaved } from '../src/core/state';
import type { Card } from '../src/core/types';
import { World, card, playAll, settle } from './fakes';

const own = (cardId: string, seen = true): OwnedCard => ({ cardId, acquiredAt: '2026-11-01T00:00:00Z', revealSeenAt: seen ? '2026-11-01T00:00:00Z' : null });
const ids = (list: OwnedCard[]) => list.map((one) => one.cardId);

describe('the list of cards on the phone', () => {
  async function phone() {
    const world = new World('2026-11-23T12:00:00Z');
    world.normal();
    const normal = world.respond;
    world.respond = (method, path, body) => (path === '/catalogue' ? { status: 200, body: { cards: [card('a'), card('b')] } } : normal(method, path, body));
    const engine = world.open();
    const keeper = new CatalogueKeeper(world.storage);
    const get = <T>(path: string, headers?: Record<string, string>) => engine.get<T>(path, headers);
    return { world, engine, keeper, get };
  }

  test('it is asked for after a sync that worked, and not after one that did not', async () => {
    const { world, engine } = await phone();
    world.online = false;
    await engine.sync();
    assert.equal(world.synced, 0);
    world.online = true;
    await engine.sync();
    assert.equal(world.synced, 1);
  });

  test('once, kept, and there offline after a kill', async () => {
    const { world, engine, keeper, get } = await phone();
    await engine.sync();
    world.calls = [];
    let told = 0;
    keeper.subscribe(() => told++);
    assert.equal(keeper.now(), null);
    await Promise.all([keeper.ensure(get), keeper.ensure(get), keeper.refresh(get)]);
    assert.deepEqual(world.calls, ['GET /catalogue']); // the pictures are not asked for
    assert.equal(told, 1);
    await keeper.ensure(get);
    assert.equal(world.calls.length, 1);
    world.online = false;
    assert.equal(new CatalogueKeeper(world.storage).now()?.byId.size, 2);
  });

  test('it failed: nothing is thrown, and the next sync asks again', async () => {
    const { world, engine, keeper, get } = await phone();
    await engine.sync();
    world.online = false;
    await keeper.ensure(get);
    assert.equal(keeper.now(), null);
    world.online = true;
    await keeper.ensure(get);
    assert.equal(keeper.now()?.list.length, 2);
  });

  test('the same list is given until it changes, so nothing is drawn again', async () => {
    const { engine, keeper, get } = await phone();
    await engine.sync();
    await keeper.ensure(get);
    assert.equal(keeper.now(), keeper.now());
  });
});

describe('the catalogue', () => {
  test('set by set, by number, the ones without a number last', () => {
    const of = (id: string, set: string, number: string | null): Card => ({ ...card(id), set, number });
    const { list, byId } = catalogueOf([of('a', 'B', '106'), of('b', 'B', null), of('c', 'A', '9'), of('d', 'B', '008'), of('e', 'B', 'SM94'), of('f', 'A', '10')]);
    assert.deepEqual(list.map((one) => one.id), ['c', 'f', 'd', 'e', 'a', 'b']);
    assert.equal(byId.get('e')?.number, 'SM94');
  });

  test('the same cards in another order give the same list', () => {
    const cards = Array.from({ length: 300 }, (_, i): Card => ({ ...card(`c${i}`), set: `S${i % 7}`, number: i % 5 ? String(i % 30) : null }));
    const shuffled = [...cards].sort((a, b) => (a.id.length * 7 + a.id.charCodeAt(a.id.length - 1)) - (b.id.length * 7 + b.id.charCodeAt(b.id.length - 1)));
    assert.deepEqual(catalogueOf(shuffled).list, catalogueOf(cards).list);
  });
});

describe('what is yours', () => {
  test('what the server says, newest first, without the ones whose reveal was not seen', () => {
    assert.deepEqual(ids(ownedNow([own('new', false), own('b'), own('a')], emptySaved())), ['b', 'a']);
    assert.deepEqual(ownedNow(null, emptySaved()), []);
  });

  test('a day played offline: grey until its reveal was seen, then yours before the server knows', async () => {
    const world = new World('2026-11-23T12:00:00Z');
    world.normal();
    const engine = world.open();
    await engine.sync();
    const { challenge } = engine.getSnapshot().today!;
    const yours = () => {
      const { owned, saved } = engine.getSnapshot();
      return ids(ownedNow(owned, saved));
    };
    world.online = false;
    playAll(engine, challenge);
    assert.deepEqual(yours(), []);
    engine.revealShown(challenge.id);
    assert.deepEqual(yours(), ['reward-2026-11-23']);
    world.online = true;
    await engine.flush();
    await settle();
    assert.deepEqual(yours(), ['reward-2026-11-23']); // once, not twice
  });

  test('online: the server has it, but it stays grey until its reveal was seen', async () => {
    const world = new World('2026-11-23T12:00:00Z');
    world.normal();
    const engine = world.open();
    await engine.sync();
    const { challenge } = engine.getSnapshot().today!;
    playAll(engine, challenge);
    await settle();
    const { owned, saved } = engine.getSnapshot();
    assert.deepEqual(ids(owned!), ['reward-2026-11-23']);
    assert.deepEqual(ownedNow(owned, saved), []);
    engine.revealShown(challenge.id);
    const after = engine.getSnapshot();
    assert.deepEqual(ids(ownedNow(after.owned, after.saved)), ['reward-2026-11-23']);
  });
});
