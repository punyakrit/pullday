import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, test } from 'node:test';
import { HOUR, MINUTE, Phone, advance, clean, close, pool, resetAccount, setClock } from './helpers.ts';

beforeEach(() => clean());
after(close);

const begin = (phone: Phone, id: string = randomUUID()) => phone.call('POST', '/freezes/purchases', { id });
const confirm = (phone: Phone, id: string, transactionId = `txn-${id}`) => phone.call('POST', `/freezes/purchases/${id}/confirm`, { transactionId });
/** Begun, paid and confirmed at once. */
async function buy(phone: Phone) {
  const { status, body } = await begin(phone);
  assert.equal(status, 200, JSON.stringify(body));
  return (await confirm(phone, body.id)).body as { id: string; freezeId: string; state: string };
}
const begun = async (phone: Phone) => (await begin(phone)).body.id as string;
async function rows() {
  const found = await pool.query<{ used_on_day: string | null; refund_due_at: Date | null }>('select used_on_day, refund_due_at from freezes order by purchased_at, id');
  return found.rows.map((row) => (row.refund_due_at ? 'refund' : (row.used_on_day ?? 'held')));
}
/** Done on the 20th, 21st and 22nd. It is noon on the 22nd. */
async function threeDays() {
  const phone = await Phone.signUp();
  await phone.playOn('2026-11-20', '2026-11-21', '2026-11-22');
  return phone;
}

describe('buying', () => {
  test('begun, paid, confirmed: one freeze, then a second', async () => {
    const phone = await Phone.signUp();
    const { status, body } = await begin(phone);
    assert.deepEqual([status, body.priceCents, body.beganAt], [200, 199, '2026-11-23T12:00:00.000Z']);
    assert.equal((await phone.today()).freezes, 0); // nothing is granted before the store has the money
    assert.equal((await confirm(phone, body.id)).body.state, 'granted');
    assert.equal((await phone.today()).freezes, 1);
    await buy(phone);
    assert.equal((await phone.today()).freezes, 2);
  });

  test('a retry, a double tap and two phones grant once', async () => {
    const phone = await Phone.signUp();
    const other = await Phone.logIn(phone.email);
    const id = randomUUID();
    const both = await Promise.all([begin(phone, id), begin(phone, id), begin(other, id)]);
    assert.deepEqual(both.map((reply) => reply.status), [200, 200, 200]);
    const all = await Promise.all([confirm(phone, id), confirm(phone, id), confirm(other, id), confirm(phone, id)]);
    assert.equal(new Set(all.map(({ body }) => body.freezeId)).size, 1);
    assert.ok(all.every(({ body }) => body.state === 'granted'));
    assert.deepEqual(await rows(), ['held']);
  });

  test('the first moment it began is kept', async () => {
    const phone = await Phone.signUp();
    const id = await begun(phone);
    advance(HOUR);
    assert.equal((await begin(phone, id)).body.beganAt, '2026-11-23T12:00:00.000Z');
  });

  test('paid twice for one purchase: one freeze, and the other money is owed back', async () => {
    const phone = await Phone.signUp();
    const id = await begun(phone);
    assert.equal((await confirm(phone, id, 'txn-a')).body.state, 'granted');
    assert.equal((await confirm(phone, id, 'txn-b')).body.state, 'refunded');
    assert.equal((await confirm(phone, id, 'txn-b')).body.state, 'refunded');
    assert.equal((await phone.today()).freezes, 1);
    assert.equal((await phone.today()).freezeRefunds.length, 1);
  });

  test('a transaction cannot be used again for another purchase or another account', async () => {
    const phone = await Phone.signUp();
    const stranger = await Phone.signUp();
    const first = await begun(phone);
    const second = await begun(phone);
    await confirm(phone, first, 'txn-a');
    await confirm(phone, second, 'txn-a');
    assert.equal((await phone.today()).freezes, 1);
    assert.equal((await confirm(stranger, await begun(stranger), 'txn-a')).body.error, 'not_yours');
    assert.equal((await confirm(stranger, second, 'txn-b')).body.error, 'not_yours');
    assert.equal((await begin(stranger, first)).body.error, 'not_yours');
    assert.equal((await stranger.today()).freezes, 0);
  });

  test('money for a purchase we never heard begin is not turned away, and counts from now', async () => {
    const phone = await threeDays();
    setClock('2026-11-24T09:00:00Z');
    assert.equal((await phone.today()).streak, 0);
    assert.equal((await confirm(phone, randomUUID())).body.state, 'granted');
    const today = await phone.today();
    assert.deepEqual([today.freezes, today.streak], [1, 0]);
  });

  test('begun and never paid costs nothing and blocks nothing', async () => {
    const phone = await Phone.signUp();
    for (let i = 0; i < 5; i++) await begun(phone);
    assert.equal((await phone.today()).freezes, 0);
    await buy(phone);
    await buy(phone);
    assert.equal((await phone.today()).freezes, 2);
  });

  test('a reset forgets it all', async () => {
    await resetAccount('today@pullday.test', 'UTC');
    const phone = await Phone.logIn('today@pullday.test');
    await buy(phone);
    await resetAccount('today@pullday.test', 'UTC');
    assert.equal((await phone.today()).freezes, 0);
    assert.equal((await pool.query('select 1 from freeze_purchases')).rowCount, 0);
  });
});

describe('two at most', () => {
  test('at 2 it is refused before the store is asked', async () => {
    const phone = await Phone.signUp();
    await buy(phone);
    await buy(phone);
    const { status, body } = await begin(phone);
    assert.deepEqual([status, body.error], [409, 'freezes_full']);
    assert.equal((await pool.query('select 1 from freeze_purchases')).rowCount, 2);
  });

  test('a pending one that completes at 2 is owed back, and said', async () => {
    const phone = await Phone.signUp();
    const pending = await begun(phone);
    await buy(phone);
    await buy(phone);
    const { body } = await confirm(phone, pending);
    assert.equal(body.state, 'refunded');
    assert.equal((await confirm(phone, pending)).body.state, 'refunded');
    const today = await phone.today();
    assert.deepEqual([today.freezes, today.freezeRefunds], [2, [body.freezeId]]);
  });

  test('two phones at 1: both charged, one granted, one owed back', async () => {
    const phone = await Phone.signUp();
    const other = await Phone.logIn(phone.email);
    await buy(phone);
    const [a, b] = [await begun(phone), await begun(other)];
    const done = await Promise.all([confirm(phone, a), confirm(other, b)]);
    assert.deepEqual(done.map(({ body }) => body.state).sort(), ['granted', 'refunded']);
    assert.equal((await phone.today()).freezes, 2);
  });

  test('a missed day that is about to use one makes room first', async () => {
    const phone = await threeDays();
    await buy(phone);
    await buy(phone);
    setClock('2026-11-24T09:00:00Z'); // the 23rd was missed, nobody has told the server yet
    assert.equal((await begin(phone)).status, 200);
  });

  test('completes at 2, but a day missed meanwhile needs it: used, nothing owed', async () => {
    const phone = await threeDays();
    const pending = await begun(phone);
    setClock('2026-11-24T09:00:00Z');
    await phone.today();
    await buy(phone);
    await buy(phone); // both too late for the 23rd
    assert.equal((await confirm(phone, pending)).body.state, 'granted');
    const today = await phone.today();
    assert.deepEqual([today.streak, today.freezes, today.freezesUsed, today.freezeRefunds], [3, 2, ['2026-11-23'], []]);
  });

  test('the one that is owed back is the one that came too many, not an older one', async () => {
    const phone = await Phone.signUp();
    const old = await buy(phone);
    advance(MINUTE);
    const pending = await begun(phone);
    advance(MINUTE);
    const young = await buy(phone);
    const { body } = await confirm(phone, pending);
    assert.equal(body.state, 'refunded');
    assert.ok(![old.freezeId, young.freezeId].includes(body.freezeId));
  });
});

describe('it counts from when it began', () => {
  test('begun at 11:58pm, approved after midnight: the day is saved', async () => {
    const phone = await threeDays();
    setClock('2026-11-23T23:58:00Z');
    const id = await begun(phone);
    setClock('2026-11-24T09:00:00Z');
    const before = await phone.today();
    assert.deepEqual([before.streak, before.winBack.lostStreak], [0, 3]);
    await confirm(phone, id);
    const today = await phone.today();
    assert.deepEqual([today.streak, today.winBack, today.freezes, today.freezesUsed], [3, null, 0, ['2026-11-23']]);
    assert.equal((await phone.play()).body.streak, 4);
  });

  test('begun a minute too late: kept for another day', async () => {
    const phone = await threeDays();
    setClock('2026-11-24T00:00:00Z');
    await buy(phone);
    const today = await phone.today();
    assert.deepEqual([today.streak, today.freezes], [0, 1]);
  });

  test('approved after two missed days: the first is saved, the break moves to the second', async () => {
    const phone = await threeDays();
    const id = await begun(phone);
    setClock('2026-11-25T09:00:00Z');
    assert.equal((await phone.today()).winBack.missedDay, '2026-11-23');
    await confirm(phone, id);
    const { winBack, freezesUsed } = await phone.today();
    assert.deepEqual([winBack.missedDay, winBack.lostStreak, freezesUsed], ['2026-11-24', 3, ['2026-11-23']]);
  });

  test('the streak was won back meanwhile: the freeze is kept for later', async () => {
    const phone = await threeDays();
    const id = await begun(phone);
    setClock('2026-11-24T09:00:00Z');
    await phone.winBack();
    await confirm(phone, id);
    const today = await phone.today();
    assert.deepEqual([today.streak, today.freezes], [3, 1]);
  });

  test('begun to win it back too, but not paid: nothing is left to pay for', async () => {
    const phone = await threeDays();
    const id = await begun(phone);
    setClock('2026-11-24T09:00:00Z');
    await phone.today();
    const payment = (await phone.call('POST', '/win-back', { missedDay: '2026-11-23' })).body.id;
    await confirm(phone, id);
    assert.equal((await phone.call('GET', `/win-back/payments/${payment}`)).body.state, 'canceled');
  });
});

describe('the offline rule', () => {
  /** The bundle is on the phone. It is offline from here on. */
  async function onThePlane() {
    const phone = await threeDays();
    const id = await begun(phone);
    const { tomorrow } = await phone.today();
    return { phone, id, tomorrow };
  }

  test('confirming never counts as contact: the day finished on the plane still counts', async () => {
    const { phone, id, tomorrow } = await onThePlane();
    setClock('2026-11-24T09:00:00Z');
    assert.equal((await confirm(phone, id)).status, 200); // it went ahead of the outbox
    assert.deepEqual(await rows(), ['2026-11-23']);
    assert.equal((await phone.complete(tomorrow.id)).status, 200);
    const today = await phone.today();
    assert.deepEqual([today.streak, today.freezes, today.freezesUsed], [4, 1, []]); // and the freeze came back
  });

  test('beginning does, so the app sends its outbox first', async () => {
    const { phone, tomorrow } = await onThePlane();
    setClock('2026-11-24T09:00:00Z');
    await begin(phone);
    assert.equal((await phone.complete(tomorrow.id)).body.error, 'too_late');
  });

  test('a freeze that comes back as a third is owed as money, and said', async () => {
    const phone = await threeDays();
    await buy(phone);
    const { tomorrow } = await phone.today();
    setClock('2026-11-24T09:00:00Z');
    const other = await Phone.logIn(phone.email);
    await other.today(); // uses the freeze on the 23rd
    await buy(other);
    await buy(other);
    await phone.complete(tomorrow.id);
    const today = await other.today();
    assert.deepEqual([today.streak, today.freezes, today.freezeRefunds.length], [4, 2, 1]);
  });
});
