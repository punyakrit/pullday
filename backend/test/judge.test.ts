import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judge } from '../src/days.ts';

// The rule on its own, with no endpoint in front of it.
const at = (time: string) => new Date(`2026-11-${time}Z`);
const day = { dayStart: at('23T00:00:00'), dayEnd: at('24T00:00:00') };
const nothing = { startedAt: null, bundleIssuedAt: null, lastContactAt: null };

test('before, during and after the day, with nothing else known', () => {
  assert.equal(judge({ ...day, ...nothing, now: at('22T23:59:59.999') }), 'too_early');
  assert.equal(judge({ ...day, ...nothing, now: at('23T00:00:00') }), 'on_time');
  assert.equal(judge({ ...day, ...nothing, now: at('23T23:59:59.999') }), 'on_time');
  assert.equal(judge({ ...day, ...nothing, now: at('24T00:00:00') }), 'too_late');
});

test('grace needs a start from before the end', () => {
  const late = { ...day, ...nothing, now: at('24T00:01:00') };
  assert.equal(judge({ ...late, startedAt: at('23T23:59:59.999') }), 'grace');
  assert.equal(judge({ ...late, startedAt: at('24T00:00:00') }), 'too_late');
  assert.equal(judge({ ...late, now: at('24T01:00:00'), startedAt: at('23T12:00:00') }), 'grace');
  assert.equal(judge({ ...late, now: at('24T01:00:00.001'), startedAt: at('23T12:00:00') }), 'too_late');
});

test('offline needs a bundle from before the end and silence since', () => {
  const late = { ...day, ...nothing, now: at('25T12:00:00'), bundleIssuedAt: at('23T10:00:00'), lastContactAt: at('23T10:00:00') };
  assert.equal(judge(late), 'offline');
  assert.equal(judge({ ...late, bundleIssuedAt: null }), 'too_late');
  assert.equal(judge({ ...late, bundleIssuedAt: at('24T00:00:00') }), 'too_late');
  assert.equal(judge({ ...late, lastContactAt: at('23T23:59:59.999') }), 'offline');
  assert.equal(judge({ ...late, lastContactAt: at('24T00:00:00') }), 'too_late');
  assert.equal(judge({ ...late, now: at('26T00:00:00') }), 'offline');
  assert.equal(judge({ ...late, now: at('26T00:00:00.001') }), 'too_late');
});

test('a date with no time in it cannot be played', () => {
  const none = { dayStart: day.dayStart, dayEnd: day.dayStart };
  const held = { startedAt: null, bundleIssuedAt: at('22T10:00:00'), lastContactAt: at('22T10:00:00') };
  assert.equal(judge({ ...none, ...held, now: at('23T10:00:00') }), 'too_late');
});
