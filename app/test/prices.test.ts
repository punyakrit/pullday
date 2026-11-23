import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Price } from '../src/core/details';
import { dateText, dayOf, describePrices, inOrder, money, nearest, plot } from '../src/core/prices';

const week = (i: number, priceCents: number): Price => ({ date: new Date(Date.UTC(2026, 7, 10 + i * 7)).toISOString().slice(0, 10), priceCents });
const prices = [827, 839, 787, 796, 1042, 885].map((cents, i) => week(i, cents));
const inset = { x: 8, y: 20 };

test('the line stays inside its box, lowest at the bottom, highest at the top', () => {
  const { points, low, high, path } = plot(prices, 300, 140, inset)!;
  assert.deepEqual([low, high], [2, 4]);
  assert.equal(points[2]!.y, 120);
  assert.equal(points[4]!.y, 20);
  assert.deepEqual([points[0]!.x, points[5]!.x], [8, 292]);
  assert.ok(points.every(({ x, y }) => x >= 8 && x <= 292 && y >= 20 && y <= 120));
  assert.match(path, /^M8\.0 .*L292\.0 /);
});

test('a price that never moved, one price, none, and no room', () => {
  assert.deepEqual(new Set(plot([week(0, 500), week(1, 500)], 300, 140, inset)!.points.map(({ y }) => y)), new Set([70]));
  assert.equal(plot([week(0, 500)], 300, 140, inset)!.points[0]!.x, 292);
  assert.equal(plot([], 300, 140, inset), null);
  assert.equal(plot(prices, 0, 140, inset), null);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify([plot([week(0, 1)], 300, 140, inset), plot([week(0, 0), week(1, 644448)], 300, 140, inset)])));
});

test('the finger picks the nearest week', () => {
  const { points } = plot(prices, 300, 140, inset)!;
  assert.equal(nearest(points, -50), 0);
  assert.equal(nearest(points, 999), 5);
  assert.equal(nearest(points, points[3]!.x + 5), 3);
});

test('the last date is the last date, in any order and any time zone', () => {
  assert.deepEqual(inOrder([...prices].reverse()), prices);
  const before = process.env.TZ;
  for (const zone of ['Pacific/Kiritimati', 'Pacific/Honolulu', 'UTC']) {
    process.env.TZ = zone;
    assert.match(dateText('2026-11-02'), /\b2\b/);
    assert.match(dateText('2026-11-02', 'short'), /\b2\b/);
  }
  if (before === undefined) delete process.env.TZ;
  else process.env.TZ = before;
});

test('the day of a moment is the day at home', () => {
  assert.match(dayOf('2026-11-22T20:00:00Z', 'Asia/Kolkata'), /\b23\b/);
  assert.match(dayOf('2026-11-22T20:00:00Z', 'America/New_York'), /\b22\b/);
  assert.match(dayOf('2026-11-22T12:00:00Z', 'Not/AZone'), /\b2[23]\b/);
});

test('money and words', () => {
  assert.equal(money(299), '$2.99');
  assert.equal(money(472744), '$4,727.44');
  assert.match(describePrices(prices), /6 weeks\. From \$8\.27 on .* to \$8\.85 on .*Lowest \$7\.87, highest \$10\.42\./);
  assert.equal(describePrices([]), 'No price history.');
});
