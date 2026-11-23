import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardWidth, isShort } from '../src/today/fit';

const words = { above: 80, below: 150 };

test('nothing is drawn before it is known how much room there is', () => {
  assert.equal(cardWidth({ width: 0, height: 0 }, words), 0);
  assert.equal(cardWidth({ width: 360, height: 640 }, { above: 80, below: 0 }), 0);
});

test('as large as fits, between the words', () => {
  for (const space of [{ width: 360, height: 640 }, { width: 402, height: 700 }, { width: 320, height: 460 }, { width: 800, height: 1000 }]) {
    const width = cardWidth(space, words);
    assert.ok(width * 1.68 <= space.height - words.above - words.below - 30, JSON.stringify(space));
    assert.ok(width <= space.width * 0.68 && width >= 48);
  }
});

test('a smaller window, a smaller card', () => {
  const sizes = [700, 600, 500, 400].map((height) => cardWidth({ width: 360, height }, words));
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
  assert.ok(sizes[0]! > sizes[3]!);
});

test('half a split screen: beside the words, and still big enough to see', () => {
  const half = { width: 360, height: 240 };
  assert.ok(isShort(half));
  const width = cardWidth(half, words);
  assert.ok(width >= 110 && width * 1.68 <= half.height);
  assert.equal(cardWidth(half, { above: 0, below: 0 }), width); // the words are not above and below it
  assert.equal(cardWidth({ width: 360, height: 60 }, words), 48); // never less
});
