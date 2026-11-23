import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { type Day, type Zone, addDays, isTimezone, localDate } from './days.ts';
import { type Db, pool, transaction } from './db.ts';
import { ApiError } from './errors.ts';
import { nowForNewUser } from './time.ts';

export type User = {
  id: string;
  email: string;
  is_test: boolean;
  dev_offset_ms: number;
  settled_through: Day;
};

/** Who is calling, and from which phone. */
export type Caller = { userId: string; deviceId: string };

export const TEST_EMAILS = ['new', 'today', 'done', 'freeze', 'broken', 'collector'].map(
  (name) => `${name}@pullday.test`,
);

const scrypt = promisify<string, Buffer, number, Buffer>(scryptCallback);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64);
  return `${salt.toString('base64')}:${key.toString('base64')}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(':').map((part) => Buffer.from(part, 'base64'));
  const given = await scrypt(password.normalize('NFKC'), salt!, 64);
  return timingSafeEqual(given, key!);
}

// Compared against when the email is unknown, so both cases take the same time.
const nobody = hashPassword(randomBytes(16).toString('hex'));

function cleanEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

async function openSession(db: Db, userId: string, deviceId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('insert into devices (user_id, device_id) values ($1, $2) on conflict do nothing', [userId, deviceId]);
  await db.query('insert into sessions (token_hash, user_id, device_id) values ($1, $2, $3)', [
    hashToken(token),
    userId,
    deviceId,
  ]);
  return token;
}

export type SignedIn = { token: string; user: { id: string; email: string; timezone: string } };

export async function signUp(input: {
  email: string;
  password: string;
  timezone: string;
  deviceId: string;
}): Promise<SignedIn> {
  const email = cleanEmail(input.email);
  if (!isTimezone(input.timezone)) throw new ApiError(400, 'bad_timezone', 'That time zone is not one we know.');
  // Seeded accounts cannot be claimed by whoever signs up first.
  if (TEST_EMAILS.includes(email)) throw new ApiError(409, 'email_taken', 'That email already has an account.');
  const passwordHash = await hashPassword(input.password);
  const at = nowForNewUser();
  const today = localDate(at, input.timezone);
  return transaction(async (db) => {
    const inserted = await db.query<{ id: string }>(
      `insert into users (email, password_hash, settled_through, created_at)
       values ($1, $2, $3, $4) on conflict (email) do nothing returning id`,
      [email, passwordHash, addDays(today, -1), at],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new ApiError(409, 'email_taken', 'That email already has an account.');
    await db.query('insert into user_timezones (user_id, from_day, tz) values ($1, $2, $3)', [id, today, input.timezone]);
    const token = await openSession(db, id, input.deviceId);
    return { token, user: { id, email, timezone: input.timezone } };
  });
}

export async function logIn(input: { email: string; password: string; deviceId: string }): Promise<SignedIn> {
  const email = cleanEmail(input.email);
  const found = await pool.query<{ id: string; password_hash: string }>(
    'select id, password_hash from users where email = $1',
    [email],
  );
  const row = found.rows[0];
  const ok = await checkPassword(input.password, row?.password_hash ?? (await nobody));
  if (!row || !ok) throw new ApiError(401, 'wrong_login', 'That email and password do not match.');
  return transaction(async (db) => {
    const token = await openSession(db, row.id, input.deviceId);
    const zones = await getZones(db, row.id);
    return { token, user: { id: row.id, email, timezone: zones.at(-1)!.tz } };
  });
}

export async function logOut(token: string): Promise<void> {
  await pool.query('delete from sessions where token_hash = $1', [hashToken(token)]);
}

/** The token is the only thing that says who is calling. */
export async function findCaller(token: string): Promise<Caller | null> {
  const found = await pool.query<{ user_id: string; device_id: string }>(
    'select user_id, device_id from sessions where token_hash = $1',
    [hashToken(token)],
  );
  const row = found.rows[0];
  return row ? { userId: row.user_id, deviceId: row.device_id } : null;
}

/** Locks the user for this transaction, so two phones or two taps run one after the other. */
export async function lockUser(db: Db, userId: string): Promise<User> {
  const found = await db.query<User>(
    'select id, email, is_test, dev_offset_ms, settled_through from users where id = $1 for update',
    [userId],
  );
  const user = found.rows[0];
  if (!user) throw new ApiError(401, 'signed_out', 'Please log in again.');
  return user;
}

export async function getZones(db: Db, userId: string): Promise<Zone[]> {
  const found = await db.query<Zone>('select from_day, tz from user_timezones where user_id = $1 order by from_day', [
    userId,
  ]);
  return found.rows;
}
