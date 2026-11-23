import { type User, getZones } from './auth.ts';
import type { Db } from './db.ts';
import { type Day, type Zone, addDays, currentDay, dayEnd, isTimezone, zoneIndex } from './days.ts';
import { ApiError } from './errors.ts';
import { now } from './time.ts';

const WAIT_MS = 7 * 24 * 3_600_000;

/** The zone in force today, and the one waiting for the end of today if there is one. */
export function zoneStatus(zones: Zone[], today: Day) {
  const i = zoneIndex(zones, today);
  const next = zones[i + 1];
  return {
    timezone: zones[i]!.tz,
    pendingTimezone: next ? { timezone: next.tz, startsAt: dayEnd(zones, addDays(next.from_day, -1)) } : null,
  };
}

/** Takes effect at the end of the current day, at most once every 7 days. */
export async function changeTimezone(db: Db, user: User, timezone: string) {
  if (!isTimezone(timezone)) throw new ApiError(400, 'bad_timezone', 'That time zone is not one we know.');
  const at = now(user);
  const zones = await getZones(db, user.id);
  const today = currentDay(zones, at);
  if (timezone !== zones.at(-1)!.tz) {
    const last = await db.query<{ at: Date | null }>(
      'select max(requested_at) as at from user_timezones where user_id = $1',
      [user.id],
    );
    const changed = last.rows[0]?.at;
    if (changed && at.getTime() - changed.getTime() < WAIT_MS) {
      throw new ApiError(409, 'timezone_too_soon', 'You can change your time zone once every 7 days.');
    }
    const from = addDays(today, 1);
    await db.query('insert into user_timezones (user_id, from_day, tz, requested_at) values ($1, $2, $3, $4)', [
      user.id,
      from,
      timezone,
      at,
    ]);
    zones.push({ from_day: from, tz: timezone });
  }
  return zoneStatus(zones, today);
}
