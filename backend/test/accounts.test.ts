import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { after, beforeEach, describe, test } from 'node:test';
import { Phone, app, buildApp, clean, close, pool, setClock } from './helpers.ts';

beforeEach(() => clean());
after(close);

const person = () => ({ email: `${randomUUID()}@example.com`, password: 'pullday123', timezone: 'UTC', deviceId: randomUUID() });
const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });

describe('accounts', () => {
  test('sign up, then log in, however the email is typed', async () => {
    const me = { ...person(), email: 'Asha.Rao@Example.com' };
    const made = await post('/auth/signup', me);
    assert.equal(made.statusCode, 201);
    assert.equal(made.json().user.email, 'asha.rao@example.com');
    const { password, deviceId } = me;
    const back = await post('/auth/login', { email: '  ASHA.RAO@example.com ', password, deviceId });
    assert.equal(back.statusCode, 200);
    assert.equal(back.json().user.id, made.json().user.id);
    assert.notEqual(back.json().token, made.json().token);
  });

  test('one account per email, even when two sign up at once', async () => {
    const me = person();
    const all = await Promise.all([post('/auth/signup', me), post('/auth/signup', { ...me, email: me.email.toUpperCase() })]);
    assert.deepEqual(all.map((res) => res.statusCode).sort(), [201, 409]);
    assert.equal(all.find((res) => res.statusCode === 409)!.json().error, 'email_taken');
  });

  test('a wrong password and an unknown email look the same', async () => {
    const me = person();
    await post('/auth/signup', me);
    const { email, deviceId } = me;
    const wrong = await post('/auth/login', { email, password: 'not-my-password', deviceId });
    const unknown = await post('/auth/login', { email: 'nobody@example.com', password: 'not-my-password', deviceId });
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.body, unknown.body);
  });

  test('what is refused at sign up', async () => {
    const good = person();
    const bad: object[] = [
      { ...good, email: 'nope' },
      { ...good, email: 'a b@example.com' },
      { ...good, email: 'a\u0000@example.com' },
      { ...good, email: ['a@example.com'] },
      { ...good, email: `${'a'.repeat(250)}@example.com` },
      { ...good, password: 'short' },
      { ...good, password: 'x'.repeat(201) },
      { ...good, password: 12345678 },
      { ...good, timezone: 'Nowhere' },
      { ...good, deviceId: 'my phone' },
      { ...good, is_test: true },
      { ...good, date: '2026-11-23' },
      {},
    ];
    for (const body of bad) {
      const res = await post('/auth/signup', body);
      assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 80));
      assert.ok(res.json().error && res.json().message);
    }
    assert.equal((await pool.query('select 1 from users')).rowCount, 0);
  });

  test('nobody can sign up as a test account', async () => {
    const res = await post('/auth/signup', { ...person(), email: 'Done@pullday.test' });
    assert.equal(res.statusCode, 409);
  });

  test('passwords and tokens are not stored as they are', async () => {
    const phone = await Phone.signUp();
    const users = await pool.query('select password_hash from users');
    assert.ok(!users.rows[0].password_hash.includes('pullday123'));
    const sessions = await pool.query<{ token_hash: Buffer }>('select token_hash from sessions');
    assert.ok(!sessions.rows[0]!.token_hash.equals(Buffer.from(phone.token)));
    assert.ok(!sessions.rows[0]!.token_hash.equals(Buffer.from(phone.token, 'base64url')));
  });
});

describe('sessions', () => {
  test('survive a restart of the app and the server, and months away', async () => {
    const phone = await Phone.signUp();
    setClock('2027-06-01T12:00:00Z');
    const restarted = buildApp({ devTools: true });
    const headers = { authorization: `Bearer ${phone.token}` };
    assert.equal((await restarted.inject({ method: 'GET', url: '/today', headers })).statusCode, 200);
    await restarted.close();
  });

  test('log out ends this session and no other', async () => {
    const phone = await Phone.signUp();
    const tablet = await Phone.logIn(phone.email);
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: { authorization: `Bearer ${phone.token}` } });
    assert.equal(out.statusCode, 204);
    const after = await phone.call('GET', '/today');
    assert.equal(after.status, 401);
    assert.equal(after.body.error, 'signed_out');
    assert.equal((await tablet.call('GET', '/today')).status, 200);
  });

  test('every private route needs a session', async () => {
    const id = randomUUID();
    const routes = [
      ['GET', '/today'], ['GET', '/collection'], ['GET', '/catalogue'], ['GET', '/cards/c_0001'], ['POST', '/auth/logout'],
      ['POST', `/challenges/${id}/start`], ['POST', `/challenges/${id}/complete`], ['POST', `/challenges/${id}/reveal-seen`],
      ['PUT', '/me/timezone'], ['POST', '/dev/move-time'], ['POST', '/dev/grant-card'], ['POST', '/dev/reset'],
    ] as const;
    for (const [method, url] of routes) {
      for (const authorization of [undefined, 'Bearer nope', 'Basic abc', 'Bearer ']) {
        const res = await app.inject({ method, url, headers: authorization ? { authorization } : {} });
        assert.equal(res.statusCode, 401, `${method} ${url} ${authorization}`);
      }
    }
  });

  test('bad ids, bad json and unknown routes get a clean error', async () => {
    const phone = await Phone.signUp();
    assert.equal((await phone.call('POST', '/challenges/1/start')).status, 400);
    assert.equal((await phone.call('POST', `/challenges/${randomUUID()}/start`)).status, 404);
    assert.equal((await phone.call('GET', '/nope')).status, 404);
    const headers = { authorization: `Bearer ${phone.token}`, 'content-type': 'application/json' };
    const res = await app.inject({ method: 'PUT', url: '/me/timezone', headers, payload: '{oops' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'bad_request');
  });
});

describe('cards', () => {
  test('the catalogue: every card, with gaps as null', async () => {
    const phone = await Phone.signUp();
    const { cards } = (await phone.call('GET', '/catalogue')).body;
    assert.equal(cards.length, 1993);
    assert.equal(cards.filter((card: { number: null }) => card.number === null).length, 66);
    assert.equal(cards.filter((card: { variety: null }) => card.variety === null).length, 799);
    assert.equal(typeof cards[0].grade, 'number');
    assert.equal(cards[0].story, undefined); // light enough for a list of 2,000
  });

  test('the catalogue is sent once: gzip, then 304', async () => {
    const phone = await Phone.signUp();
    const headers = { authorization: `Bearer ${phone.token}`, 'accept-encoding': 'gzip' };
    const first = await app.inject({ method: 'GET', url: '/catalogue', headers });
    assert.equal(first.headers['content-encoding'], 'gzip');
    assert.ok(first.rawPayload.length < 100_000, `${first.rawPayload.length} bytes`);
    assert.equal(JSON.parse(gunzipSync(first.rawPayload).toString()).cards.length, 1993);
    const again = await app.inject({
      method: 'GET',
      url: '/catalogue',
      headers: { ...headers, 'if-none-match': String(first.headers.etag) },
    });
    assert.equal(again.statusCode, 304);
    assert.equal(again.body, '');
  });

  test('details: story, whole cents, 13 weeks of prices ending 2026-11-02', async () => {
    const phone = await Phone.signUp();
    const { body } = await phone.call('GET', '/cards/c_0001');
    assert.equal(body.name, 'SHURA');
    assert.equal(body.priceCents, 885);
    assert.equal(body.grade, 10);
    assert.equal(body.certNumber, '61233732');
    assert.equal(body.priceHistory.length, 13);
    assert.deepEqual(body.priceHistory.at(-1), { date: '2026-11-02', priceCents: 885 });
    assert.equal(body.priceDate, '2026-11-02');
    assert.ok(body.priceHistory.every((point: { priceCents: number }) => Number.isInteger(point.priceCents)));
    assert.ok(body.story.length > 0);
    assert.equal(body.acquiredAt, null);
  });

  test('details of every card can be read, including the ones with gaps', async () => {
    const phone = await Phone.signUp();
    const gaps = await pool.query<{ id: string }>('select id from cards where card_number is null order by id');
    for (const { id } of gaps.rows) {
      const { status, body } = await phone.call('GET', `/cards/${id}`);
      assert.equal(status, 200);
      assert.equal(body.number, null);
    }
    assert.equal((await phone.call('GET', '/cards/c_9999')).status, 404);
    assert.equal((await phone.call('GET', '/cards/1')).status, 400);
  });

  test('details say when an owned card was won', async () => {
    const phone = await Phone.signUp();
    const done = await phone.play();
    const { body } = await phone.call('GET', `/cards/${done.body.card.id}`);
    assert.equal(body.acquiredAt, '2026-11-23T12:00:00.000Z');
  });
});
