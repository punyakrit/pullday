import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import { HOUR, Phone, clean, close, pool, setClock } from './helpers.ts';

beforeEach(() => clean());
after(close);

/** A 3 day streak: 20, 21 and 22 November. */
async function threeDays() {
  setClock('2026-11-20T12:00:00Z');
  const phone = await Phone.signUp();
  await phone.playOn('2026-11-20', '2026-11-21', '2026-11-22');
  return phone;
}

async function freezeRows(phone: Phone) {
  const found = await pool.query(
    'select used_on_day, refund_due_at from freezes where user_id = $1 order by purchased_at, id',
    [phone.userId],
  );
  return found.rows;
}

describe('counting', () => {
  test('+1 a day, and doing it again the same day does nothing', async () => {
    const phone = await threeDays();
    assert.equal((await phone.today()).streak, 3);
    const again = await phone.play();
    assert.equal(again.body.repeated, true);
    assert.equal(again.body.streak, 3);
  });

  test('a missed day with no freeze breaks it, and the next day starts at 1', async () => {
    const phone = await threeDays();
    await phone.playOn('2026-11-24');
    assert.equal((await phone.today()).streak, 1);
  });

  test('not done yet today is not a miss', async () => {
    const phone = await threeDays();
    setClock('2026-11-23T23:59:59.999Z');
    assert.equal((await phone.today()).streak, 3);
    setClock('2026-11-24T00:00:00Z');
    assert.equal((await phone.today()).streak, 0);
  });

  test('away for years: one break, and it does not take long', async () => {
    const phone = await threeDays();
    setClock('2031-11-22T12:00:00Z');
    const before = Date.now();
    const today = await phone.today();
    assert.ok(Date.now() - before < 2000);
    assert.equal(today.streak, 0);
    assert.equal(today.winBack, null);
    const breaks = await pool.query('select missed_day from streak_breaks where user_id = $1', [phone.userId]);
    assert.deepEqual(breaks.rows, [{ missed_day: '2026-11-23' }]);
  });
});

describe('freeze', () => {
  test('used on a missed day: the streak survives and does not grow', async () => {
    const phone = await threeDays();
    await phone.buyFreeze();
    setClock('2026-11-24T12:00:00Z');
    const today = await phone.today();
    assert.equal(today.streak, 3);
    assert.equal(today.freezes, 0);
    assert.equal(today.winBack, null);
    assert.deepEqual(await phone.days(), ['20 done', '21 done', '22 done', '23 frozen']);
    assert.equal((await phone.play()).body.streak, 4);
  });

  test('used once, however many times the app is opened', async () => {
    const phone = await threeDays();
    await phone.buyFreeze();
    await phone.buyFreeze();
    setClock('2026-11-24T12:00:00Z');
    const all = await Promise.all(Array.from({ length: 5 }, () => phone.today()));
    for (const today of all) assert.equal(today.freezes, 1);
  });

  test('two misses with one freeze: the first day is saved, the second breaks', async () => {
    const phone = await threeDays();
    await phone.buyFreeze();
    setClock('2026-11-25T12:00:00Z');
    const today = await phone.today();
    assert.equal(today.streak, 0);
    assert.equal(today.freezes, 0);
    assert.deepEqual(await phone.days(), ['20 done', '21 done', '22 done', '23 frozen']);
    assert.equal(today.winBack.missedDay, '2026-11-24');
    assert.equal(today.winBack.lostStreak, 3);
    assert.equal(today.winBack.closesAt, '2026-11-27T00:00:00.000Z');
  });

  test('two misses with two freezes: both days are saved, oldest freeze first', async () => {
    const phone = await threeDays();
    await phone.buyFreeze('2026-11-21T10:00:00Z');
    await phone.buyFreeze('2026-11-22T10:00:00Z');
    setClock('2026-11-25T12:00:00Z');
    assert.equal((await phone.today()).streak, 3);
    assert.deepEqual(
      (await freezeRows(phone)).map((row) => row.used_on_day),
      ['2026-11-23', '2026-11-24'],
    );
  });

  test('bought too late: after the missed day ended it saves nothing, and is kept', async () => {
    const phone = await threeDays();
    await phone.buyFreeze('2026-11-24T00:00:00Z'); // the very moment the 23rd ended
    setClock('2026-11-24T12:00:00Z');
    const today = await phone.today();
    assert.equal(today.streak, 0);
    assert.equal(today.freezes, 1);
    assert.equal(today.winBack.lostStreak, 3);
  });

  test('bought in the last moment of the missed day, it works', async () => {
    const phone = await threeDays();
    await phone.buyFreeze('2026-11-23T23:59:59.999Z');
    setClock('2026-11-24T12:00:00Z');
    const today = await phone.today();
    assert.equal(today.streak, 3);
    assert.equal(today.freezes, 0);
  });

  test('one bought in time and one too late, over two missed days', async () => {
    const phone = await threeDays();
    await phone.buyFreeze('2026-11-24T10:00:00Z'); // after the 23rd, before the end of the 24th
    setClock('2026-11-25T12:00:00Z');
    const today = await phone.today();
    assert.equal(today.streak, 0); // the 23rd had nothing to save it
    assert.equal(today.freezes, 1); // and a broken streak does not use freezes
  });

  test('not spent when there is no streak to save', async () => {
    const phone = await Phone.signUp();
    await phone.buyFreeze();
    setClock('2026-11-28T12:00:00Z');
    assert.equal((await phone.today()).freezes, 1);
  });

  test('a freeze cannot be spent twice, even by the database', async () => {
    const phone = await threeDays();
    const spend = () =>
      pool.query(`insert into freezes (user_id, purchased_at, used_on_day) values ($1, now(), '2026-11-23')`, [phone.userId]);
    await spend();
    await assert.rejects(spend, /freezes_user_id_used_on_day_key/);
  });
});

describe('late sync after a freeze', () => {
  /** The plane has the bundle for the 23rd (and the 24th). The tablet is online on the 24th. */
  async function planeAndTablet() {
    const plane = await threeDays();
    const tablet = await Phone.logIn(plane.email);
    setClock('2026-11-23T10:00:00Z');
    const bundle = await plane.today();
    return { plane, tablet, bundle };
  }

  test('the frozen day becomes done and the freeze comes back', async () => {
    const { plane, tablet, bundle } = await planeAndTablet();
    await plane.buyFreeze();
    setClock('2026-11-24T09:00:00Z');
    assert.equal((await tablet.today()).freezes, 0);

    setClock('2026-11-24T18:00:00Z');
    const done = await plane.complete(bundle.challenge.id);
    assert.equal(done.status, 200);
    assert.equal(done.body.streak, 4);
    assert.equal(done.body.freezes, 1);
    assert.deepEqual(await plane.days(), ['20 done', '21 done', '22 done', '23 done']);
  });

  test('sending it twice gives the freeze back once', async () => {
    const { plane, tablet, bundle } = await planeAndTablet();
    await plane.buyFreeze();
    setClock('2026-11-24T09:00:00Z');
    await tablet.today();
    await plane.complete(bundle.challenge.id);
    assert.equal((await plane.complete(bundle.challenge.id)).body.freezes, 1);
  });

  test('the freeze that comes back saves the next missed day', async () => {
    const { plane, tablet, bundle } = await planeAndTablet();
    await plane.buyFreeze();
    setClock('2026-11-25T09:00:00Z');
    const before = await tablet.today();
    assert.equal(before.streak, 0); // 23 frozen, 24 broke
    assert.equal(before.winBack.missedDay, '2026-11-24');

    const done = await plane.complete(bundle.challenge.id);
    assert.equal(done.body.streak, 4);
    assert.equal(done.body.freezes, 0);
    assert.equal(done.body.winBack, null);
    assert.deepEqual(await plane.days(), ['20 done', '21 done', '22 done', '23 done', '24 frozen']);
  });

  test('two days frozen, the first turns out done: the second still costs a freeze', async () => {
    const { plane, tablet, bundle } = await planeAndTablet();
    await plane.buyFreeze();
    await plane.buyFreeze();
    setClock('2026-11-25T09:00:00Z');
    assert.equal((await tablet.today()).freezes, 0);
    const done = await plane.complete(bundle.challenge.id);
    assert.equal(done.body.streak, 4);
    assert.equal(done.body.freezes, 1); // one back, not two
    assert.deepEqual(await plane.days(), ['20 done', '21 done', '22 done', '23 done', '24 frozen']);
  });

  test('a freeze bought too late for the next day does not save it after all', async () => {
    const { plane, tablet, bundle } = await planeAndTablet();
    await plane.buyFreeze('2026-11-25T08:00:00Z');
    setClock('2026-11-25T09:00:00Z');
    await tablet.today();
    const done = await plane.complete(bundle.challenge.id);
    assert.equal(done.body.streak, 0);
    assert.equal(done.body.freezes, 1);
    assert.equal(done.body.winBack.missedDay, '2026-11-24'); // the break moved to the real missed day
    assert.equal(done.body.winBack.lostStreak, 4);
  });

  test('a broken day becomes done and the streak joins up, with no freeze involved', async () => {
    const { plane, tablet, bundle } = await planeAndTablet();
    setClock('2026-11-24T09:00:00Z');
    assert.equal((await tablet.play()).body.streak, 1);
    const done = await plane.complete(bundle.challenge.id);
    assert.equal(done.body.streak, 5);
    assert.equal(done.body.winBack, null);
  });

  test('never more than 2 held: a third is owed as a refund, and none is lost', async () => {
    const { plane, tablet, bundle } = await planeAndTablet();
    await plane.buyFreeze();
    setClock('2026-11-24T09:00:00Z');
    await tablet.today(); // spends it on the 23rd
    await plane.buyFreeze();
    await plane.buyFreeze();
    const done = await plane.complete(bundle.challenge.id);
    assert.equal(done.body.freezes, 2);
    const rows = await freezeRows(plane);
    assert.equal(rows.length, 3);
    assert.equal(rows.filter((row) => row.refund_due_at).length, 1);
    assert.equal(rows.filter((row) => row.used_on_day).length, 0);
  });

  test('a day already won back becomes done', async () => {
    const { plane, tablet, bundle } = await planeAndTablet();
    setClock('2026-11-24T09:00:00Z');
    await tablet.today();
    await tablet.winBack();
    assert.equal((await tablet.today()).streak, 3);
    const done = await plane.complete(bundle.challenge.id);
    assert.equal(done.body.streak, 4);
    assert.deepEqual(await plane.days(), ['20 done', '21 done', '22 done', '23 done']);
  });
});

describe('break and the 48 hour window', () => {
  test('recorded at the end of the missed day, open for exactly 48 hours', async () => {
    const phone = await threeDays();
    setClock('2026-11-24T00:00:00Z');
    const { winBack } = await phone.today();
    assert.deepEqual(winBack, {
      missedDay: '2026-11-23',
      lostStreak: 3,
      closesAt: '2026-11-26T00:00:00.000Z',
      priceCents: 499,
    });
    setClock('2026-11-25T23:59:59.999Z');
    assert.equal((await phone.today()).winBack.lostStreak, 3);
    setClock('2026-11-26T00:00:00Z');
    assert.equal((await phone.today()).winBack, null);
    await assert.rejects(phone.winBack(), /no streak to win back/);
  });

  test('found late: the window still runs from the missed day, not from when the app was opened', async () => {
    const phone = await threeDays();
    setClock('2026-11-25T20:00:00Z');
    assert.equal((await phone.today()).winBack.closesAt, '2026-11-26T00:00:00.000Z');
  });

  test('won back the next day: the same streak as before', async () => {
    const phone = await threeDays();
    setClock('2026-11-24T12:00:00Z');
    await phone.winBack();
    const today = await phone.today();
    assert.equal(today.streak, 3);
    assert.equal(today.winBack, null);
    assert.equal((await phone.play()).body.streak, 4);
  });

  test('fills every missed day since, and keeps the streak built after', async () => {
    const phone = await threeDays();
    await phone.playOn('2026-11-25'); // missed 23 and 24
    assert.equal((await phone.today()).streak, 1);
    await phone.winBack();
    assert.equal((await phone.today()).streak, 4);
    assert.deepEqual(await phone.days(), ['20 done', '21 done', '22 done', '23 won_back', '24 won_back', '25 done']);
  });

  test('cannot be used twice', async () => {
    const phone = await threeDays();
    setClock('2026-11-24T12:00:00Z');
    const results = await Promise.allSettled([phone.winBack(), phone.winBack()]);
    assert.deepEqual(results.map((res) => res.status).sort(), ['fulfilled', 'rejected']);
  });

  test('today is not filled in: it can still be done, or missed', async () => {
    const phone = await threeDays();
    setClock('2026-11-24T12:00:00Z');
    await phone.winBack();
    assert.equal((await phone.today()).todayDone, false);
    setClock('2026-11-25T12:00:00Z');
    const today = await phone.today();
    assert.equal(today.streak, 0);
    assert.equal(today.winBack.missedDay, '2026-11-24');
    assert.equal(today.winBack.lostStreak, 3);
  });

  test('no break is recorded when there was no streak', async () => {
    const phone = await Phone.signUp();
    setClock('2026-11-30T12:00:00Z');
    assert.equal((await phone.today()).winBack, null);
    assert.equal((await pool.query('select 1 from streak_breaks')).rowCount, 0);
  });

  test('a freeze after the break does not repair it', async () => {
    const phone = await threeDays();
    setClock('2026-11-24T12:00:00Z');
    await phone.today();
    await phone.buyFreeze();
    setClock('2026-11-25T12:00:00Z');
    const today = await phone.today();
    assert.equal(today.streak, 0);
    assert.equal(today.freezes, 1);
  });

  test('48 hours is real time, also over a clock change', async () => {
    setClock('2026-10-29T16:00:00Z');
    const phone = await Phone.signUp('America/New_York');
    await phone.playOn('2026-10-29', '2026-10-30'); // missed the 31st, clocks go back on the 1st
    setClock('2026-11-01T16:00:00Z');
    const { winBack } = await phone.today();
    assert.equal(winBack.closesAt, '2026-11-03T04:00:00.000Z'); // 11pm on the 2nd in New York
    assert.equal(Date.parse(winBack.closesAt) - Date.parse('2026-11-01T04:00:00Z'), 48 * HOUR);
  });
});
