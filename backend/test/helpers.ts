import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { FakeStripe } from './fakeStripe.ts';

// A separate database, so tests never touch the one you play with.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const base = process.env.DATABASE_URL ?? 'postgres://pullday:pullday@127.0.0.1:54329/pullday';
const testUrl = new URL(base);
testUrl.pathname = '/pullday_test';
const admin = new pg.Client({ connectionString: base });
await admin.connect();

// Tests share one database and empty it, so one test file at a time, across every run on this
// computer. The lock belongs to this connection: a run that is killed lets go of it.
const free = await admin.query<{ ok: boolean }>(`select pg_try_advisory_lock(hashtext('pullday_tests')) as ok`);
if (!free.rows[0]?.ok) {
  console.error('waiting for another test run to finish a file');
  await admin.query(`select pg_advisory_lock(hashtext('pullday_tests'))`);
}

const exists = await admin.query(`select 1 from pg_database where datname = 'pullday_test'`);
if (!exists.rowCount) await admin.query('create database pullday_test');
process.env.DATABASE_URL = testUrl.href;

// Imported after the address is set.
const { pool } = await import('../src/db.ts');
const { migrate } = await import('../src/migrate.ts');
const { buildApp } = await import('../src/app.ts');
const { setRealClock } = await import('../src/time.ts');
const { transaction } = await import('../src/db.ts');
const { lockUser } = await import('../src/auth.ts');
const streakModule = await import('../src/streak.ts');
const { TEST_EMAILS } = await import('../src/auth.ts');
const { resetAccount, seedAll } = await import('../src/seed.ts');
const { pickCards } = await import('../src/challenges.ts');
const { StripeUnreachable, inWords, stripeKeys } = await import('../src/stripe.ts');

// Tests empty the users table. If a test file imports anything from src/ that opens the
// database, it can be loaded before the address above is set. Never go on if that happened.
const connected = await pool.query<{ name: string }>('select current_database() as name');
if (connected.rows[0]?.name !== 'pullday_test') {
  throw new Error(`tests are connected to ${connected.rows[0]?.name}: import src/ through test/helpers.ts`);
}
await migrate();

export { TEST_EMAILS, buildApp, pickCards, inWords, stripeKeys, pool, resetAccount, seedAll };
export const stripe = new FakeStripe();
stripe.noAnswer = () => new StripeUnreachable();
export const app = buildApp({ devTools: true, stripe });
/** The same server with no Stripe keys. */
export const keyless = buildApp({ devTools: true });

let clock = Date.parse('2026-11-23T12:00:00Z');
setRealClock(() => clock);

export const setClock = (iso: string) => void (clock = Date.parse(iso));
export const getClock = () => new Date(clock);
export const advance = (ms: number) => void (clock += ms);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const ANSWERS = Array(8).fill('common') as string[];

export async function clean(iso = '2026-11-23T12:00:00Z') {
  setClock(iso);
  await pool.query('truncate users cascade');
  stripe.reset();
}
export async function close() {
  await app.close();
  await keyless.close();
  await pool.end();
  await admin.end(); // last, so the next run never meets this one's connections
}

/** One phone, signed in to one account. */
export class Phone {
  constructor(
    readonly token: string,
    readonly deviceId: string,
    readonly userId: string,
    readonly email: string,
  ) {}

  static async signUp(timezone = 'UTC', email = `${randomUUID()}@example.com`): Promise<Phone> {
    const deviceId = randomUUID();
    const body = { email, password: 'pullday123', timezone, deviceId };
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: body });
    if (res.statusCode !== 201) throw new Error(`sign up failed: ${res.body}`);
    return new Phone(res.json().token, deviceId, res.json().user.id, email);
  }

  static async logIn(email: string, deviceId = randomUUID() as string): Promise<Phone> {
    const body = { email, password: 'pullday123', deviceId };
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: body });
    if (res.statusCode !== 200) throw new Error(`log in failed: ${res.body}`);
    return new Phone(res.json().token, deviceId, res.json().user.id, email);
  }

  async call(method: 'GET' | 'POST' | 'PUT', url: string, body?: object) {
    const headers = { authorization: `Bearer ${this.token}` };
    const res = await app.inject(body ? { method, url, headers, payload: body } : { method, url, headers });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  }
  async today() {
    const res = await this.call('GET', '/today');
    if (res.status !== 200) throw new Error(`today failed: ${JSON.stringify(res.body)}`);
    return res.body;
  }
  start = (id: string) => this.call('POST', `/challenges/${id}/start`);
  complete = (id: string, answers = ANSWERS) => this.call('POST', `/challenges/${id}/complete`, { answers });
  revealSeen = (id: string) => this.call('POST', `/challenges/${id}/reveal-seen`);
  async collection() {
    return (await this.call('GET', '/collection')).body.cards as { cardId: string; revealSeenAt: string | null }[];
  }
  /** Buy a freeze, now or at a given moment. There is no shop yet. */
  async buyFreeze(at: Date | string = getClock()) {
    await pool.query('insert into freezes (user_id, purchased_at) values ($1, $2)', [this.userId, at]);
  }
  /** Win back with the money left out of it. payments.test.ts has the money. */
  async winBack() {
    const { winBack } = await this.today();
    const filled =
      winBack &&
      (await transaction(async (db) => streakModule.coverBreak(db, await lockUser(db, this.userId), winBack.missedDay, getClock())));
    if (!filled) throw new Error('there is no streak to win back');
  }
  async days() {
    const { recentDays } = await this.today();
    return recentDays.map((row: { day: string; status: string }) => `${row.day.slice(8)} ${row.status}`) as string[];
  }
  /** Play on each of these dates at noon UTC. */
  async playOn(...dates: string[]) {
    for (const date of dates) {
      setClock(`${date}T12:00:00Z`);
      const done = await this.play();
      if (done.status !== 200) throw new Error(`play failed: ${JSON.stringify(done.body)}`);
      await this.revealSeen(done.body.challengeId);
    }
  }
  /** Open the app and do today's challenge. */
  async play() {
    const { challenge } = await this.today();
    await this.start(challenge.id);
    return this.complete(challenge.id);
  }
}
