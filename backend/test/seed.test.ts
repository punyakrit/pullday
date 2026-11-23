import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import { HOUR, Phone, TEST_EMAILS, advance, buildApp, clean, close, pool, resetAccount, seedAll, setClock } from './helpers.ts';

beforeEach(() => clean());
after(close);

const DAY = 24 * HOUR;
const open = (name: string) => Phone.logIn(`${name}@pullday.test`);
async function count(phone: Phone, table: string) {
  return Number((await pool.query(`select count(*) from ${table} where user_id = $1`, [phone.userId])).rows[0].count);
}

// At midnight, at noon and one second before the end of the day, in three zones.
for (const [zone, start, noon, end] of [
  ['UTC', '2026-11-23T00:00:00Z', '2026-11-23T12:00:00Z', '2026-11-23T23:59:59Z'],
  ['Asia/Kolkata', '2026-11-22T18:30:00Z', '2026-11-23T06:30:00Z', '2026-11-23T18:29:59Z'],
  ['America/New_York', '2026-11-23T05:00:00Z', '2026-11-23T17:00:00Z', '2026-11-24T04:59:59Z'],
] as const) {
  for (const iso of [start, noon, end]) {
    describe(`every seeded account, ${zone}, ${iso}`, () => {
      beforeEach(async () => {
        setClock(iso);
        await seedAll(zone);
      });

      test('new@: nothing done', async () => {
        const phone = await open('new');
        const today = await phone.today();
        assert.equal(today.day, '2026-11-23');
        assert.equal(today.streak, 0);
        assert.equal(today.todayDone, false);
        assert.equal(today.freezes, 0);
        assert.equal(today.winBack, null);
        assert.deepEqual(today.unseenReveals, []);
        assert.deepEqual(await phone.collection(), []);
      });

      test("today@: 12 day streak, today's challenge not done", async () => {
        const phone = await open('today');
        const today = await phone.today();
        assert.equal(today.streak, 12);
        assert.equal(today.todayDone, false);
        assert.equal(today.challenge.completedAt, null);
        assert.equal((await phone.collection()).length, 12);
        assert.equal((await phone.play()).body.streak, 13);
      });

      test('done@: 30 day streak, today already done', async () => {
        const phone = await open('done');
        const today = await phone.today();
        assert.equal(today.streak, 30);
        assert.equal(today.todayDone, true);
        assert.ok(today.challenge.completedAt <= today.now);
        assert.deepEqual(today.unseenReveals, []);
        assert.equal((await phone.collection()).length, 30);
        const again = await phone.complete(today.challenge.id);
        assert.equal(again.body.repeated, true);
        assert.equal(again.body.streak, 30);
      });

      test('freeze@: owns 1 freeze, and it saves the 7 day streak', async () => {
        const phone = await open('freeze');
        const held = await pool.query('select used_on_day from freezes where user_id = $1', [phone.userId]);
        assert.deepEqual(held.rows, [{ used_on_day: null }]); // until the app is opened
        const today = await phone.today();
        assert.equal(today.streak, 7);
        assert.equal(today.freezes, 0);
        assert.equal(today.winBack, null);
        assert.deepEqual(today.recentDays.at(-1), { day: '2026-11-22', status: 'frozen' });
        assert.equal((await phone.play()).body.streak, 8);
      });

      test('broken@: the 40 day streak broke yesterday, win back open', async () => {
        const phone = await open('broken');
        const today = await phone.today();
        assert.equal(today.streak, 0);
        assert.equal(today.todayDone, false);
        assert.equal(today.winBack.missedDay, '2026-11-22');
        assert.equal(today.winBack.lostStreak, 40);
        assert.equal(today.winBack.priceCents, 499);
        assert.ok(Date.parse(today.winBack.closesAt) - Date.parse(today.now) > 24 * HOUR);
        await phone.winBack();
        assert.equal((await phone.today()).streak, 40);
      });

      test('collector@: 300 cards, 5 binder pages filled', async () => {
        const phone = await open('collector');
        assert.equal((await phone.collection()).length, 300);
        const pages = await pool.query(
          'select page, count(*)::int as filled from binder_slots where user_id = $1 group by page order by page',
          [phone.userId],
        );
        assert.deepEqual(pages.rows, [1, 2, 3, 4, 5].map((page) => ({ page, filled: 9 })));
        assert.equal((await phone.today()).todayDone, false);
      });
    });
  }
}

describe('reset', () => {
  test('puts each account back, whatever was done to it, and keeps the phone logged in', async () => {
    await seedAll('UTC');
    for (const email of TEST_EMAILS) {
      const phone = await Phone.logIn(email);
      const before = await phone.today();
      await phone.play();
      await phone.call('POST', '/dev/grant-card', { count: 5 });
      await phone.call('POST', '/dev/move-time', { minutes: 60 * 24 * 10 });
      await phone.today();
      await phone.call('PUT', '/me/timezone', { timezone: 'Asia/Tokyo' });
      assert.equal((await phone.call('POST', '/dev/reset', { timezone: 'UTC' })).status, 200);
      const after = await phone.today();
      for (const key of ['day', 'now', 'streak', 'todayDone', 'freezes', 'winBack', 'recentDays', 'timezone', 'pendingTimezone']) {
        assert.deepEqual(after[key], before[key], `${email} ${key}`);
      }
      assert.equal(await count(phone, 'user_timezones'), 1);
    }
  });

  test('is relative to now: a week later it is a fresh streak again', async () => {
    await seedAll('UTC');
    advance(7 * DAY);
    const phone = await open('today');
    assert.equal((await phone.today()).streak, 0);
    await resetAccount('today@pullday.test');
    const today = await phone.today();
    assert.equal(today.streak, 12);
    assert.equal(today.timezone, 'UTC'); // the zone it had
  });

  test('an old challenge from before the reset is gone, not confused with the new one', async () => {
    await seedAll('UTC');
    const phone = await open('new');
    const { challenge } = await phone.today();
    await resetAccount('new@pullday.test');
    assert.equal((await phone.complete(challenge.id)).status, 404);
    assert.deepEqual(await phone.collection(), []);
  });

  test('only test accounts', async () => {
    await assert.rejects(resetAccount('someone@example.com'), /not a test account/);
  });
});

describe('dev tools', () => {
  test('move time: the next day comes, and only for that account', async () => {
    await seedAll('UTC');
    const phone = await open('new');
    const other = await open('today');
    await phone.play();
    const moved = await phone.call('POST', '/dev/move-time', { minutes: 12 * 60 });
    assert.equal(moved.body.now, '2026-11-24T00:00:00.000Z');
    const today = await phone.today();
    assert.equal(today.day, '2026-11-24');
    assert.equal(today.todayDone, false);
    assert.equal((await phone.play()).body.streak, 2);
    assert.equal((await other.today()).day, '2026-11-23');
  });

  test('move time does not count as being online, so offline can be tried on one phone', async () => {
    await seedAll('UTC');
    const phone = await open('new');
    const { challenge } = await phone.today();
    await phone.call('POST', '/dev/move-time', { minutes: 24 * 60 });
    await phone.call('POST', '/dev/move-time', { minutes: 60 }); // a dev call made after the day ended
    await phone.call('POST', '/dev/grant-card');
    assert.equal((await phone.complete(challenge.id)).status, 200);
  });

  test('grant: one named card, some random ones, or all that are left', async () => {
    await seedAll('UTC');
    const phone = await open('new');
    assert.deepEqual((await phone.call('POST', '/dev/grant-card', { cardId: 'c_0007' })).body, { granted: ['c_0007'] });
    assert.deepEqual((await phone.call('POST', '/dev/grant-card', { cardId: 'c_0007' })).body, { granted: [] });
    assert.equal((await phone.call('POST', '/dev/grant-card')).body.granted.length, 1);
    assert.equal((await phone.call('POST', '/dev/grant-card', { count: 2000 })).body.granted.length, 1991);
    assert.deepEqual((await phone.today()).unseenReveals, []);
    assert.equal((await phone.play()).body.card, null);
  });

  test('granting the promised card: the next bundle promises another', async () => {
    await seedAll('UTC');
    const phone = await open('new');
    const { challenge } = await phone.today();
    await phone.call('POST', '/dev/grant-card', { cardId: challenge.reward.id });
    const again = await phone.today();
    assert.equal(again.challenge.id, challenge.id);
    assert.notEqual(again.challenge.reward.id, challenge.reward.id);
    assert.equal((await phone.complete(challenge.id)).body.card.id, again.challenge.reward.id);
  });

  test('not for real accounts', async () => {
    const phone = await Phone.signUp();
    for (const [url, body] of [['move-time', { minutes: 5 }], ['grant-card', {}], ['reset', {}]] as const) {
      const res = await phone.call('POST', `/dev/${url}`, body);
      assert.equal(res.status, 403, url);
    }
    assert.equal((await phone.today()).now, '2026-11-23T12:00:00.000Z');
  });

  test('without DEV_TOOLS=1 they do not exist, and moved time has no effect', async () => {
    await seedAll('UTC');
    const phone = await open('new');
    await phone.call('POST', '/dev/move-time', { minutes: 24 * 60 });
    const production = buildApp({ devTools: false });
    try {
      const headers = { authorization: `Bearer ${phone.token}` };
      for (const url of ['/dev/move-time', '/dev/grant-card', '/dev/reset']) {
        assert.equal((await production.inject({ method: 'POST', url, headers, payload: {} })).statusCode, 404, url);
      }
      const today = await production.inject({ method: 'GET', url: '/today', headers });
      assert.equal(today.json().day, '2026-11-23');
    } finally {
      buildApp({ devTools: true }); // the switch is for the whole process
      await production.close();
    }
  });

  test('time only moves forward', async () => {
    await seedAll('UTC');
    const phone = await open('new');
    for (const minutes of [0, -5, 1.5, '60', null]) {
      assert.equal((await phone.call('POST', '/dev/move-time', { minutes })).status, 400, String(minutes));
    }
  });
});
