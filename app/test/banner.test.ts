import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { bannerFor } from '../src/core/banner';
import { type Reveal, type View, emptySaved } from '../src/core/state';
import { card, challenge } from './fakes';

const reveal: Reveal = { challengeId: 'old', day: '2026-11-22', card: card('old'), score: 3, saved: false };
const playing: View = { kind: 'challenge', challenge: challenge('2026-11-23'), answers: [], lateUntil: null, waiting: null };
const notices = [
  { id: 'a', text: 'First' },
  { id: 'b', text: 'Second' },
];
const calm = { view: playing, unsaved: false, saved: emptySaved(), connection: 'online', unsent: 0 } as const;
const bad = { unsaved: true, saved: { ...emptySaved(), notices }, connection: 'offline', unsent: 1 } as const;

describe('the line above Today', () => {
  test('nothing to say', () => assert.equal(bannerFor(calm), null));

  test('never over a reveal, whatever there is to say', () => {
    for (const saved of [true, false]) {
      assert.equal(bannerFor({ ...bad, view: { kind: 'reveal', reveal: { ...reveal, saved } } }), null);
    }
  });

  test('one at a time, the most useful first', () => {
    const view: View = { ...playing, lateUntil: 5, waiting: reveal };
    let now: Parameters<typeof bannerFor>[0] = { ...bad, view };
    assert.equal(bannerFor(now)?.kind, 'full');
    now = { ...now, unsaved: false };
    assert.deepEqual(bannerFor(now), { kind: 'notice', id: 'a', text: 'First' });
    now = { ...now, saved: emptySaved() };
    assert.deepEqual(bannerFor(now), { kind: 'late', until: 5 });
    now = { ...now, view: { ...playing, waiting: reveal } };
    assert.deepEqual(bannerFor(now), { kind: 'waiting', challengeId: 'old' });
    now = { ...now, view: playing };
    assert.deepEqual(bannerFor(now), { kind: 'offline', unsent: true });
    assert.deepEqual(bannerFor({ ...now, unsent: 0 }), { kind: 'offline', unsent: false });
    assert.deepEqual(bannerFor({ ...now, connection: 'trouble' }), { kind: 'trouble', unsent: true });
    assert.equal(bannerFor({ ...now, connection: 'unknown' }), null);
  });

  test('also when today is done, and when there is nothing to play', () => {
    const done: View = { kind: 'done', challenge: challenge('2026-11-23'), card: null, saved: true, nextAt: 0 };
    for (const view of [done, { kind: 'empty' } as const]) assert.equal(bannerFor({ ...bad, view })?.kind, 'full');
  });
});
