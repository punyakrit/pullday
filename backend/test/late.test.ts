import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import { ANSWERS, HOUR, Phone, advance, app, buildApp, clean, close, pool, setClock } from './helpers.ts';

beforeEach(() => clean());
after(close);

describe('11:58pm', () => {
  test('started at 11:58pm, finished at 12:01am, counts for the day it was started', async () => {
    const phone = await Phone.signUp();
    await phone.playOn('2026-11-23');
    setClock('2026-11-24T23:58:00Z');
    const { challenge } = await phone.today();
    await phone.start(challenge.id);

    setClock('2026-11-25T00:01:00Z');
    const done = await phone.complete(challenge.id);
    assert.equal(done.status, 200);
    assert.equal(done.body.day, '2026-11-24');
    assert.equal(done.body.streak, 2);
    const today = await phone.today();
    assert.equal(today.day, '2026-11-25');
    assert.equal(today.todayDone, false); // the new day is still there to be played
    assert.deepEqual(await phone.days(), ['23 done', '24 done']);
  });

  test('looking at the app after midnight does not spend a freeze or break the streak mid-challenge', async () => {
    const phone = await Phone.signUp();
    await phone.playOn('2026-11-23');
    await phone.buyFreeze();
    setClock('2026-11-24T23:58:00Z');
    const { challenge } = await phone.today();
    await phone.start(challenge.id);

    setClock('2026-11-25T00:30:00Z');
    const between = await phone.today();
    assert.equal(between.streak, 1);
    assert.equal(between.freezes, 1);
    assert.equal(between.winBack, null);
    assert.equal(between.resume.id, challenge.id); // a killed app can pick it up again
    const done = await phone.complete(challenge.id);
    assert.equal(done.body.streak, 2);
    assert.equal(done.body.freezes, 1);
    assert.equal((await phone.today()).resume, null);
  });

  test('both days can be finished after midnight, in either order', async () => {
    const phone = await Phone.signUp();
    setClock('2026-11-24T23:58:00Z');
    const { challenge, tomorrow } = await phone.today();
    await phone.start(challenge.id);
    setClock('2026-11-25T00:10:00Z');
    assert.equal((await phone.complete(tomorrow.id)).status, 200);
    assert.equal((await phone.complete(challenge.id)).body.streak, 2);
  });

  test('60 minutes is the limit, to the millisecond', async () => {
    for (const [late, status] of [[60 * 60_000, 200], [60 * 60_000 + 1, 409]] as const) {
      await clean('2026-11-23T23:58:00Z');
      const phone = await Phone.signUp();
      const { challenge } = await phone.today();
      await phone.start(challenge.id);
      setClock('2026-11-24T00:00:00Z');
      advance(late);
      await phone.collection(); // online after midnight, so only the start can save it
      assert.equal((await phone.complete(challenge.id)).status, status);
    }
  });

  test('abandoned after midnight: settled once the 60 minutes are over', async () => {
    const phone = await Phone.signUp();
    await phone.playOn('2026-11-23');
    setClock('2026-11-24T23:58:00Z');
    await phone.start((await phone.today()).challenge.id);
    setClock('2026-11-25T01:00:00Z');
    assert.equal((await phone.today()).streak, 1);
    advance(1);
    const today = await phone.today();
    assert.equal(today.streak, 0);
    assert.equal(today.winBack.lostStreak, 1);
    assert.equal(today.resume, null);
  });

  test('a start after midnight does not count as a start', async () => {
    const phone = await Phone.signUp();
    setClock('2026-11-23T23:58:00Z');
    const { challenge } = await phone.today();
    setClock('2026-11-24T00:01:00Z');
    const started = await phone.start(challenge.id);
    assert.equal(started.status, 409);
    assert.equal(started.body.error, 'too_late');
    // The refused start still showed the phone was online, so it cannot claim to have been offline.
    assert.equal((await phone.complete(challenge.id)).body.error, 'too_late');
  });

  test('the start never reached us, but the finish is the first thing we hear', async () => {
    const phone = await Phone.signUp();
    setClock('2026-11-23T23:58:00Z');
    const { challenge } = await phone.today();
    setClock('2026-11-24T00:01:00Z');
    const done = await phone.complete(challenge.id);
    assert.equal(done.status, 200);
    assert.equal(done.body.day, '2026-11-23');
  });
});

describe('plane with no wifi', () => {
  test('done in the air, landed the next day', async () => {
    const phone = await Phone.signUp();
    await phone.playOn('2026-11-23');
    setClock('2026-11-24T20:00:00Z');
    const { challenge } = await phone.today();
    setClock('2026-11-25T09:00:00Z');
    const done = await phone.complete(challenge.id);
    assert.equal(done.status, 200);
    assert.equal(done.body.day, '2026-11-24');
    assert.equal(done.body.streak, 2);
    assert.deepEqual(done.body.card, challenge.reward); // the card the phone already showed
  });

  test('two days in the air: the first sync does not block the second', async () => {
    const phone = await Phone.signUp();
    setClock('2026-11-23T20:00:00Z');
    const { challenge, tomorrow } = await phone.today();
    setClock('2026-11-25T10:00:00Z');
    assert.equal((await phone.complete(challenge.id)).status, 200);
    await phone.revealSeen(challenge.id);
    const second = await phone.complete(tomorrow.id);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.card, tomorrow.reward);
    assert.equal(second.body.streak, 2);
    const owned = (await phone.collection()).map((card) => card.cardId).sort();
    assert.deepEqual(owned, [challenge.reward.id, tomorrow.reward.id].sort());
  });

  test('two days in the air, sent in the wrong order', async () => {
    const phone = await Phone.signUp();
    await phone.buyFreeze();
    await phone.playOn('2026-11-23');
    setClock('2026-11-24T10:00:00Z');
    const { challenge, tomorrow } = await phone.today();
    setClock('2026-11-26T10:00:00Z');
    await phone.complete(tomorrow.id);
    const last = await phone.complete(challenge.id);
    assert.equal(last.body.streak, 3);
    assert.equal(last.body.freezes, 1); // used while the first day was missing, then given back
  });

  test('48 hours is the limit, to the millisecond', async () => {
    for (const [late, status] of [[48 * HOUR, 200], [48 * HOUR + 1, 409]] as const) {
      await clean('2026-11-23T20:00:00Z');
      const phone = await Phone.signUp();
      const { challenge } = await phone.today();
      setClock('2026-11-24T00:00:00Z');
      advance(late);
      assert.equal((await phone.complete(challenge.id)).status, status);
    }
  });

  test('any other call after the day ended means it was not offline', async () => {
    for (const url of ['/today', '/collection', '/catalogue', '/cards/c_0001']) {
      await clean('2026-11-23T20:00:00Z');
      const phone = await Phone.signUp();
      const { challenge } = await phone.today();
      setClock('2026-11-24T09:00:00Z');
      await phone.call('GET', url);
      const done = await phone.complete(challenge.id);
      assert.equal(done.status, 409, url);
      assert.equal(done.body.error, 'too_late');
      assert.deepEqual(await phone.collection(), []);
    }
  });

  test('a call before the day ended is fine', async () => {
    const phone = await Phone.signUp();
    setClock('2026-11-23T20:00:00Z');
    const { challenge } = await phone.today();
    setClock('2026-11-23T23:59:59Z');
    await phone.collection();
    setClock('2026-11-24T09:00:00Z');
    assert.equal((await phone.complete(challenge.id)).status, 200);
  });

  test('logged out while away: logging in again does not lose the outbox', async () => {
    const phone = await Phone.signUp();
    setClock('2026-11-23T20:00:00Z');
    const { challenge } = await phone.today();
    setClock('2026-11-24T09:00:00Z');
    const again = await Phone.logIn(phone.email, phone.deviceId);
    assert.equal((await again.complete(challenge.id)).status, 200);
  });

  test('a phone that never had the bundle cannot claim it late', async () => {
    const phone = await Phone.signUp();
    setClock('2026-11-23T20:00:00Z');
    const { challenge } = await phone.today();
    setClock('2026-11-24T09:00:00Z');
    const other = await Phone.logIn(phone.email);
    assert.equal((await other.complete(challenge.id)).body.error, 'too_late');
  });

  test('another phone being online does not take it away', async () => {
    const plane = await Phone.signUp();
    const tablet = await Phone.logIn(plane.email);
    setClock('2026-11-23T20:00:00Z');
    const { challenge } = await plane.today();
    setClock('2026-11-24T09:00:00Z');
    await tablet.today();
    assert.equal((await plane.complete(challenge.id)).status, 200);
  });
});

describe('phone date changed', () => {
  test('forward: tomorrow cannot be done today, and is still there tomorrow', async () => {
    const phone = await Phone.signUp();
    const { tomorrow } = await phone.today();
    assert.equal((await phone.start(tomorrow.id)).body.error, 'too_early');
    const early = await phone.complete(tomorrow.id);
    assert.equal(early.status, 409);
    assert.equal(early.body.error, 'too_early');
    assert.deepEqual(await phone.collection(), []);
    assert.equal((await phone.today()).streak, 0);
    setClock('2026-11-24T00:00:00Z');
    assert.equal((await phone.complete(tomorrow.id)).status, 200);
  });

  test('back: a day we know was missed cannot be done', async () => {
    const phone = await Phone.signUp();
    const { challenge } = await phone.today();
    setClock('2026-11-25T12:00:00Z');
    await phone.today();
    assert.equal((await phone.complete(challenge.id)).body.error, 'too_late');
  });

  test('a date in the request is refused, in any of them', async () => {
    const phone = await Phone.signUp();
    const { challenge } = await phone.today();
    const date = '2027-12-31';
    const url = `/challenges/${challenge.id}`;
    assert.equal((await phone.call('POST', `${url}/start`, { date })).status, 400);
    assert.equal((await phone.call('POST', `${url}/complete`, { answers: ANSWERS, date })).status, 400);
    assert.equal((await phone.call('POST', `${url}/reveal-seen`, { date })).status, 400);
    assert.equal((await phone.call('PUT', '/me/timezone', { timezone: 'UTC', date })).status, 400);
    assert.equal((await phone.today()).day, '2026-11-23');
  });
});

describe('double submit and two devices', () => {
  test('five submits at once: one card, one day', async () => {
    const phone = await Phone.signUp();
    const { challenge } = await phone.today();
    const all = await Promise.all(Array.from({ length: 5 }, () => phone.complete(challenge.id)));
    assert.deepEqual(all.map((res) => res.status), [200, 200, 200, 200, 200]);
    assert.equal(all.filter((res) => !res.body.repeated).length, 1);
    for (const res of all) assert.deepEqual(res.body.card, challenge.reward);
    assert.equal((await phone.collection()).length, 1);
    assert.equal((await phone.today()).streak, 1);
  });

  test('the reply was lost: sending again gives the same card, days later too', async () => {
    const phone = await Phone.signUp();
    const { challenge } = await phone.today();
    const first = await phone.complete(challenge.id);
    setClock('2026-12-05T12:00:00Z');
    const again = await phone.complete(challenge.id);
    assert.equal(again.status, 200);
    assert.equal(again.body.repeated, true);
    assert.deepEqual(again.body.card, first.body.card);
    assert.equal(again.body.completedAt, first.body.completedAt);
    assert.equal(again.body.streak, 0); // told the truth about today, not the day it was done
    assert.equal((await phone.collection()).length, 1);
  });

  test('two phones share one challenge, and the first to finish wins', async () => {
    const a = await Phone.signUp();
    const b = await Phone.logIn(a.email);
    const [onA, onB] = [await a.today(), await b.today()];
    assert.deepEqual(onA.challenge, onB.challenge);
    const right = onA.challenge.cards.map((card: { rarity: string }) => card.rarity);
    const [fromA, fromB] = await Promise.all([a.complete(onA.challenge.id, right), b.complete(onB.challenge.id)]);
    assert.equal(fromA.status, 200);
    assert.equal(fromB.status, 200);
    assert.deepEqual(fromA.body.card, fromB.body.card);
    assert.equal(fromA.body.score, fromB.body.score);
    assert.equal((await b.collection()).length, 1);
    assert.equal((await b.today()).todayDone, true);
  });

  test('two phones open the app for the first time at once', async () => {
    const a = await Phone.signUp();
    const b = await Phone.logIn(a.email);
    const [onA, onB] = await Promise.all([a.today(), b.today()]);
    assert.equal(onA.challenge.id, onB.challenge.id);
    assert.equal(onA.tomorrow.id, onB.tomorrow.id);
  });

  test('started on one phone before midnight, finished on the other after', async () => {
    const a = await Phone.signUp();
    const b = await Phone.logIn(a.email);
    setClock('2026-11-23T23:58:00Z');
    const { challenge } = await a.today();
    await a.start(challenge.id);
    setClock('2026-11-24T00:10:00Z');
    assert.equal((await b.today()).resume.id, challenge.id);
    assert.equal((await b.complete(challenge.id)).status, 200);
  });
});

describe('crash between grant and reveal', () => {
  test('the card is saved, and the reveal replays until it was seen', async () => {
    const phone = await Phone.signUp();
    const { challenge } = await phone.today();
    await phone.complete(challenge.id);
    // Killed here. Opening the app again, and again.
    for (let i = 0; i < 2; i++) {
      const { unseenReveals } = await phone.today();
      assert.equal(unseenReveals.length, 1);
      assert.equal(unseenReveals[0].challengeId, challenge.id);
      assert.deepEqual(unseenReveals[0].card, challenge.reward);
      const owned = await phone.collection();
      assert.equal(owned[0]!.cardId, challenge.reward.id);
      assert.equal(owned[0]!.revealSeenAt, null);
    }
    await phone.revealSeen(challenge.id);
    const { revealSeenAt } = (await phone.collection())[0]!;
    assert.ok(revealSeenAt);
    advance(HOUR);
    await phone.revealSeen(challenge.id); // the reply was lost, so it is sent again
    assert.equal((await phone.collection())[0]!.revealSeenAt, revealSeenAt);
    assert.deepEqual((await phone.today()).unseenReveals, []);
  });

  test('it replays days later, and on another phone', async () => {
    const phone = await Phone.signUp();
    const { challenge } = await phone.today();
    await phone.complete(challenge.id);
    setClock('2026-11-30T12:00:00Z');
    const other = await Phone.logIn(phone.email);
    assert.deepEqual((await other.today()).unseenReveals[0].card, challenge.reward);
  });

  test('marking a reveal as seen before finishing does not hide the reveal', async () => {
    const phone = await Phone.signUp();
    const { challenge } = await phone.today();
    await phone.revealSeen(challenge.id);
    await phone.complete(challenge.id);
    assert.equal((await phone.today()).unseenReveals.length, 1);
  });

  test('a server restart keeps the session and the unseen reveal', async () => {
    const phone = await Phone.signUp();
    const { challenge } = await phone.today();
    await phone.complete(challenge.id);
    const restarted = buildApp({ devTools: true });
    const headers = { authorization: `Bearer ${phone.token}` };
    const res = await restarted.inject({ method: 'GET', url: '/today', headers });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().unseenReveals.length, 1);
    await restarted.close();
  });

  test('a failure half way leaves nothing behind, and trying again works', async () => {
    const phone = await Phone.signUp();
    const { challenge } = await phone.today();
    await pool.query('alter table day_records add constraint broken_on_purpose check (false) not valid');
    try {
      const failed = await phone.complete(challenge.id);
      assert.equal(failed.status, 500);
      assert.ok(!JSON.stringify(failed.body).includes('broken_on_purpose')); // no internals in the reply
    } finally {
      await pool.query('alter table day_records drop constraint broken_on_purpose');
    }
    assert.deepEqual(await phone.collection(), []);
    const today = await phone.today();
    assert.equal(today.challenge.completedAt, null);
    const done = await phone.complete(challenge.id);
    assert.equal(done.status, 200);
    assert.equal(done.body.repeated, false);
    assert.equal(done.body.streak, 1);
  });
});

describe('the last cards', () => {
  const ownAllBut = (phone: Phone, ids: string[]) =>
    pool.query(
      `insert into collection (user_id, card_id, acquired_at, reveal_seen_at)
       select $1, id, now(), now() from cards where id <> all($2)`,
      [phone.userId, ids],
    );

  test('owning every card: the day still counts, with no card', async () => {
    const phone = await Phone.signUp();
    await ownAllBut(phone, []);
    const { challenge, tomorrow } = await phone.today();
    assert.equal(challenge.reward, null);
    assert.equal(tomorrow.reward, null);
    const done = await phone.complete(challenge.id);
    assert.equal(done.status, 200);
    assert.equal(done.body.card, null);
    assert.equal(done.body.streak, 1);
    assert.equal((await phone.revealSeen(challenge.id)).status, 200);
    assert.deepEqual((await phone.today()).unseenReveals, []);
    assert.equal((await phone.complete(challenge.id)).body.card, null);
    assert.equal((await phone.collection()).length, 1993);
  });

  test('one card left: promised for today only', async () => {
    const phone = await Phone.signUp();
    await ownAllBut(phone, ['c_0500']);
    const { challenge, tomorrow } = await phone.today();
    assert.equal(challenge.reward.id, 'c_0500');
    assert.equal(tomorrow.reward, null);
    assert.equal((await phone.complete(challenge.id)).body.card.id, 'c_0500');
  });

  test('one card left, promised for a missed day: the next day gets it', async () => {
    const phone = await Phone.signUp();
    await ownAllBut(phone, ['c_0500']);
    await phone.today();
    setClock('2026-11-24T12:00:00Z');
    const { challenge } = await phone.today();
    assert.equal(challenge.reward, null); // still promised to a phone that might be on a plane
    assert.equal((await phone.complete(challenge.id)).body.card.id, 'c_0500');
    assert.equal((await phone.today()).unseenReveals.length, 1);
  });

  test('the promised card was already granted some other way: a different one is given', async () => {
    const phone = await Phone.signUp();
    const { challenge } = await phone.today();
    await pool.query('insert into collection (user_id, card_id, acquired_at, reveal_seen_at) values ($1, $2, now(), now())', [
      phone.userId,
      challenge.reward.id,
    ]);
    const done = await phone.complete(challenge.id);
    assert.equal(done.status, 200);
    assert.notEqual(done.body.card.id, challenge.reward.id);
    assert.equal((await phone.collection()).length, 2);
  });
});

test('health', async () => {
  assert.deepEqual((await app.inject('/health')).json(), { ok: true });
});
