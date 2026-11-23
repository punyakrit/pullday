import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import { type Zone, addDays, currentDay, dayEnd, dayLength, dayStart, isTimezone, nextDay } from '../src/days.ts';
import { HOUR, Phone, clean, close, getClock, setClock } from './helpers.ts';

beforeEach(() => clean());
after(close);

const move = (phone: Phone, timezone: string) => phone.call('PUT', '/me/timezone', { timezone });
const zones = (first: string, from: string, second: string): Zone[] => [
  { from_day: '2026-01-01', tz: first },
  { from_day: from, tz: second },
];

describe('the day is the home date', () => {
  test('11:30pm in New York is still that day, though it is tomorrow in UTC', async () => {
    setClock('2026-11-24T04:30:00Z');
    const phone = await Phone.signUp('America/New_York');
    const today = await phone.today();
    assert.equal(today.day, '2026-11-23');
    assert.equal(today.endsAt, '2026-11-24T05:00:00.000Z');
    await phone.play();
    setClock('2026-11-24T05:00:00Z');
    const next = await phone.today();
    assert.equal(next.day, '2026-11-24');
    assert.equal(next.todayDone, false);
    assert.equal(next.streak, 1);
  });

  test('only real time zone names are taken', async () => {
    for (const name of ['Asia/Kolkata', 'America/Argentina/Buenos_Aires', 'UTC', 'Etc/GMT+5']) assert.ok(isTimezone(name), name);
    for (const name of ['', 'Mars/Base', '+05:30', 'UTC; drop table users', 'Asia/Kolkata ']) assert.ok(!isTimezone(name), name);
    const phone = await Phone.signUp();
    assert.equal((await move(phone, 'Mars/Base')).status, 400);
    assert.equal((await phone.today()).timezone, 'UTC');
  });
});

describe('changing it', () => {
  test('takes effect at the end of the current day', async () => {
    setClock('2026-11-23T17:00:00Z'); // noon in New York
    const phone = await Phone.signUp('America/New_York');
    const before = await phone.today();
    const changed = await move(phone, 'Europe/London');
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.body, {
      timezone: 'America/New_York',
      pendingTimezone: { timezone: 'Europe/London', startsAt: '2026-11-24T05:00:00.000Z' },
    });
    const after = await phone.today();
    assert.equal(after.endsAt, before.endsAt);
    setClock('2026-11-24T05:00:00Z');
    const next = await phone.today();
    assert.equal(next.timezone, 'Europe/London');
    assert.equal(next.pendingTimezone, null);
    assert.equal(next.day, '2026-11-24');
    assert.equal(next.endsAt, '2026-11-25T00:00:00.000Z');
  });

  test('at most once every 7 days', async () => {
    const phone = await Phone.signUp('UTC');
    assert.equal((await move(phone, 'Asia/Tokyo')).status, 200);
    assert.equal((await move(phone, 'Asia/Tokyo')).status, 200); // same again changes nothing
    const refused = await move(phone, 'America/New_York');
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, 'timezone_too_soon');
    setClock('2026-11-30T11:59:59.999Z');
    assert.equal((await move(phone, 'America/New_York')).status, 409);
    setClock('2026-11-30T12:00:00Z');
    assert.equal((await move(phone, 'America/New_York')).status, 200);
  });

  test('moving west at 11:59pm does not give more time for the day that is ending', async () => {
    const phone = await Phone.signUp('UTC');
    await phone.playOn('2026-11-23');
    setClock('2026-11-24T23:59:00Z');
    await move(phone, 'Pacific/Honolulu');
    setClock('2026-11-25T00:00:00Z'); // 2pm on the 24th in Honolulu
    const today = await phone.today();
    assert.equal(today.day, '2026-11-25');
    assert.equal(today.streak, 0);
    assert.equal(today.winBack.missedDay, '2026-11-24');
  });

  test('a trip east and back keeps a daily player on an unbroken streak', async () => {
    setClock('2026-11-23T17:00:00Z');
    const phone = await Phone.signUp('America/New_York');
    let streak = 0;
    const playAt = async (iso: string) => {
      setClock(iso);
      const done = await phone.play();
      assert.equal(done.body.repeated, false, iso);
      assert.equal(done.body.streak, ++streak, iso);
    };
    await playAt('2026-11-23T17:00:00Z');
    assert.equal((await move(phone, 'Asia/Tokyo')).status, 200);
    await playAt('2026-11-24T12:00:00Z'); // 9pm in Tokyo
    for (let day = 25; day <= 30; day++) await playAt(`2026-11-${day}T03:00:00Z`);
    await playAt('2026-12-01T03:00:00Z');
    assert.equal((await move(phone, 'America/New_York')).status, 200); // 7 days after the first
    for (let day = 2; day <= 5; day++) await playAt(`2026-12-0${day}T17:00:00Z`);
  });
});

describe('day lengths', () => {
  test('east is shorter, west is longer, and the day that was running is untouched', () => {
    const east = zones('America/New_York', '2026-11-24', 'Asia/Tokyo');
    assert.equal(dayLength(east, '2026-11-23'), 24 * HOUR);
    assert.equal(dayLength(east, '2026-11-24'), 10 * HOUR);
    assert.equal(dayLength(east, '2026-11-25'), 24 * HOUR);
    const west = zones('Asia/Tokyo', '2026-11-24', 'America/New_York');
    assert.equal(dayLength(west, '2026-11-23'), 24 * HOUR);
    assert.equal(dayLength(west, '2026-11-24'), 38 * HOUR);
    assert.equal(dayLength(west, '2026-11-25'), 24 * HOUR);
  });

  test('DST: 23 and 25 hour days in New York', () => {
    const ny: Zone[] = [{ from_day: '2026-01-01', tz: 'America/New_York' }];
    assert.equal(dayLength(ny, '2026-03-08'), 23 * HOUR);
    assert.equal(dayLength(ny, '2026-11-01'), 25 * HOUR);
    assert.equal(dayEnd(ny, '2026-11-01').toISOString(), '2026-11-02T05:00:00.000Z');
  });

  test('DST at midnight: a midnight that never happens, and one that happens twice', () => {
    const santiago: Zone[] = [{ from_day: '2026-01-01', tz: 'America/Santiago' }];
    assert.equal(dayLength(santiago, '2026-09-06'), 23 * HOUR); // starts at 1am
    assert.equal(dayStart(santiago, '2026-09-06').toISOString(), '2026-09-06T04:00:00.000Z');
    const havana: Zone[] = [{ from_day: '2026-01-01', tz: 'America/Havana' }];
    assert.equal(dayLength(havana, '2026-11-01'), 25 * HOUR);
    assert.equal(dayStart(havana, '2026-11-01').toISOString(), '2026-11-01T04:00:00.000Z'); // the first one
  });

  test('every moment is inside its own day, and days only go forward, whatever the move', () => {
    const names = ['Pacific/Pago_Pago', 'Pacific/Honolulu', 'America/New_York', 'America/Havana', 'America/Santiago', 'UTC',
      'Africa/Cairo', 'Asia/Kolkata', 'Asia/Tokyo', 'Pacific/Auckland', 'Pacific/Chatham', 'Pacific/Kiritimati'];
    for (const first of names) {
      for (const second of names) {
        for (const from of ['2026-03-08', '2026-03-29', '2026-09-06', '2026-11-01']) {
          const list = zones(first, from, second);
          let last = '';
          const begin = dayStart(list, addDays(from, -2)).getTime();
          for (let ms = begin; ms < begin + 120 * HOUR; ms += HOUR / 2) {
            const at = new Date(ms);
            const day = currentDay(list, at);
            const where = `${first} to ${second} at ${at.toISOString()}`;
            assert.ok(day >= last, where);
            assert.ok(dayStart(list, day) <= at && at < dayEnd(list, day), where);
            if (last && day !== last) assert.equal(day, nextDay(list, last), where);
            last = day;
          }
        }
      }
    }
  });
});

describe('the streak across odd days', () => {
  test('DST: played at 11:58pm on the long day and at 12:30am on the next', async () => {
    setClock('2026-10-31T16:00:00Z');
    const phone = await Phone.signUp('America/New_York');
    await phone.play();
    setClock('2026-11-02T04:58:00Z'); // 11:58pm on the 1st, after the clocks went back
    const done = await phone.play();
    assert.equal(done.body.day, '2026-11-01');
    assert.equal(done.body.streak, 2);
    setClock('2026-11-02T05:30:00Z');
    assert.equal((await phone.play()).body.streak, 3);
  });

  test('DST: 11:58pm start, clocks change at midnight, finished after', async () => {
    setClock('2026-09-05T15:00:00Z');
    const phone = await Phone.signUp('America/Santiago');
    setClock('2026-09-06T03:58:00Z'); // 11:58pm on the 5th
    const { challenge } = await phone.today();
    assert.equal(challenge.day, '2026-09-05');
    await phone.start(challenge.id);
    setClock('2026-09-06T04:01:00Z'); // 1:01am on the 6th, 3 minutes later
    assert.equal((await phone.today()).day, '2026-09-06');
    assert.equal((await phone.complete(challenge.id)).body.day, '2026-09-05');
  });

  test('across the date line, a date that never happens costs nothing', async () => {
    setClock('2026-11-23T20:00:00Z'); // 9am on the 23rd in Pago Pago
    const phone = await Phone.signUp('Pacific/Pago_Pago');
    await phone.buyFreeze();
    await phone.play();
    await move(phone, 'Pacific/Kiritimati');
    const { tomorrow } = await phone.today();
    assert.equal(tomorrow.day, '2026-11-25'); // the 24th does not exist for this person
    setClock('2026-11-24T11:00:00Z');
    const today = await phone.today();
    assert.equal(today.day, '2026-11-25');
    assert.equal(today.streak, 1);
    assert.equal(today.freezes, 1);
    assert.equal((await phone.play()).body.streak, 2);
  });

  test('a date that was skipped cannot be claimed with a bundle from before the move', async () => {
    setClock('2026-11-23T20:00:00Z');
    const phone = await Phone.signUp('Pacific/Pago_Pago');
    const { challenge, tomorrow } = await phone.today();
    assert.equal(tomorrow.day, '2026-11-24');
    await move(phone, 'Pacific/Kiritimati');
    setClock('2026-11-24T12:00:00Z');
    assert.equal((await phone.complete(tomorrow.id)).status, 409);
    assert.equal((await phone.complete(challenge.id)).status, 200); // the 23rd was real
  });

  test('a 1 hour day cannot break a streak', async () => {
    setClock('2026-11-23T20:00:00Z');
    const phone = await Phone.signUp('Pacific/Honolulu');
    await phone.play();
    await move(phone, 'Pacific/Auckland');
    setClock('2026-11-24T10:30:00Z'); // the 24th is 10:00Z to 11:00Z
    assert.equal((await phone.today()).day, '2026-11-24');
    setClock('2026-11-24T12:00:00Z');
    const today = await phone.today();
    assert.equal(today.day, '2026-11-25');
    assert.equal(today.streak, 1);
  });

  test('west across the date line: one long day, done once', async () => {
    setClock('2026-11-23T00:00:00Z');
    const phone = await Phone.signUp('Pacific/Kiritimati');
    await phone.play();
    await move(phone, 'Pacific/Pago_Pago');
    setClock('2026-11-23T10:00:00Z');
    assert.equal((await phone.play()).body.day, '2026-11-24');
    setClock('2026-11-25T10:59:00Z'); // 49 hours later, minus a minute
    const today = await phone.today();
    assert.equal(today.day, '2026-11-24');
    assert.equal(today.todayDone, true);
    assert.equal(today.streak, 2);
    assert.equal(getClock().toISOString() < today.endsAt, true);
  });
});
