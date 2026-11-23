import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type Answer, Pictures } from '../src/core/pictures';
import { MemoryStorage, settle } from './fakes';

function phone(storage = new MemoryStorage()) {
  const world = { answer: 'unreachable' as Answer | 'throws', asked: [] as string[], timers: [] as { work: () => void; ms: number }[], told: 0, storage };
  const pictures = new Pictures({
    storage,
    ask: async (cardId) => {
      world.asked.push(cardId);
      if (world.answer === 'throws') throw new Error('network');
      return world.answer;
    },
    setTimer: (work, ms) => {
      const timer = { work, ms };
      world.timers.push(timer);
      return () => void (world.timers = world.timers.filter((one) => one !== timer));
    },
  });
  const stop = pictures.subscribe(() => world.told++);
  return { world, pictures, stop };
}

describe('a picture that did not load', () => {
  test('the server says there is none: no picture, and not tried again', async () => {
    const { world, pictures } = phone();
    world.answer = 'none';
    await pictures.failed('c1', 'u1');
    assert.equal(pictures.look('c1', 'u1').state, 'none');
    assert.equal(pictures.look('c1', 'another size').state, 'none'); // it is about the card
    assert.deepEqual(world.timers, []);
    pictures.retry();
    assert.equal(pictures.look('c1', 'u1').attempt, 0);
  });

  test('no connection: could not load, and tried again when it is back', async () => {
    const { world, pictures } = phone();
    for (const answer of ['unreachable', 'throws', 'there'] as const) {
      world.answer = answer;
      await pictures.failed('c1', answer);
      assert.deepEqual(pictures.look('c1', answer), { state: 'failed', attempt: 0 });
    }
    const told = world.told;
    pictures.retry();
    assert.equal(world.told, told + 1);
    // Still the same words until the picture is there, so nothing flickers while it tries.
    assert.deepEqual(pictures.look('c1', 'there'), { state: 'failed', attempt: 1 });
    pictures.loaded('c1', 'there');
    assert.deepEqual(pictures.look('c1', 'there'), { state: 'fine', attempt: 1 });
    assert.equal(pictures.look('c1', 'throws').state, 'failed'); // one address at a time
  });

  test('fails twice, then there is no picture after all', async () => {
    const { world, pictures } = phone();
    await pictures.failed('c1', 'u1');
    pictures.retry();
    world.answer = 'none';
    await pictures.failed('c1', 'u1');
    assert.equal(pictures.look('c1', 'u1').state, 'none');
  });

  test('others are not touched, and what is the same stays the same object', async () => {
    const { pictures } = phone();
    const fine = pictures.look('c2', 'u2');
    await pictures.failed('c1', 'u1');
    assert.equal(pictures.look('c2', 'u2'), fine);
    assert.equal(pictures.look('c1', 'u1'), pictures.look('c1', 'u1'));
    pictures.loaded('c2', 'u2');
    assert.equal(pictures.look('c2', 'u2'), fine);
  });

  test('a load that went well says nothing to anyone', () => {
    const { world, pictures } = phone();
    for (let i = 0; i < 100; i++) pictures.loaded(`c${i}`, `u${i}`);
    assert.equal(world.told, 0);
  });
});

describe('while it is on screen', () => {
  test('tried again every 30 seconds, with one timer however many failed', async () => {
    const { world, pictures } = phone();
    for (let i = 0; i < 5; i++) await pictures.failed(`c${i}`, `u${i}`);
    assert.deepEqual(world.timers.map((timer) => timer.ms), [30_000]);
    world.timers.shift()!.work();
    assert.equal(pictures.look('c0', 'u0').attempt, 1);
    assert.deepEqual(world.timers, []); // until it fails again
    await pictures.failed('c0', 'u0');
    assert.equal(world.timers.length, 1);
    pictures.retry(); // the connection came back first
    assert.deepEqual(world.timers, []);
  });

  test('nothing on screen: no timer', async () => {
    const { world, pictures, stop } = phone();
    stop();
    await pictures.failed('c1', 'u1');
    assert.deepEqual(world.timers, []);
    pictures.subscribe(() => {});
    assert.equal(world.timers.length, 1);
  });
});

describe('remembered for the next time', () => {
  test('offline, a card known to have no picture says so, and is still tried', async () => {
    const storage = new MemoryStorage();
    const first = phone(storage);
    first.world.answer = 'none';
    await first.pictures.failed('c1', 'u1');

    const { world, pictures } = phone(storage); // the app was closed and opened
    assert.equal(pictures.look('c1', 'u1').state, 'fine'); // it may have one by now
    await pictures.failed('c1', 'u1'); // but there is no connection
    assert.equal(pictures.look('c1', 'u1').state, 'none');
    await pictures.failed('c2', 'u2');
    assert.equal(pictures.look('c2', 'u2').state, 'failed');
    pictures.retry();
    assert.equal(pictures.look('c1', 'u1').attempt, 1);
    pictures.loaded('c1', 'u1'); // it has one now
    assert.equal(pictures.look('c1', 'u1').state, 'fine');
    assert.equal(world.asked.length, 2);
    const third = phone(storage);
    await third.pictures.failed('c1', 'u1');
    assert.equal(third.pictures.look('c1', 'u1').state, 'failed'); // forgotten again
  });

  test('a damaged list, or no space for it, does no harm', async () => {
    const storage = new MemoryStorage();
    storage.set('cards-without-picture', '{"version":1,"value":[1,2');
    storage.full = true;
    const { world, pictures } = phone(storage);
    world.answer = 'none';
    await pictures.failed('c1', 'u1');
    await settle();
    assert.equal(pictures.look('c1', 'u1').state, 'none');
  });
});
