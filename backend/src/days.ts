import { Temporal } from 'temporal-polyfill';

/**
 * What "a day" is. Pure functions, no database, no clock.
 *
 * A day is a calendar date in the user's home time zone, as 'YYYY-MM-DD'.
 * Day ends are worked out with Temporal, which handles the odd cases: clocks that
 * change at midnight, 23 and 25 hour days, and midnights that never happen.
 */
export type Day = string;
export type Zone = { from_day: Day; tz: string };

const HOUR = 3_600_000;
export const GRACE_MS = 60 * 60_000; // finish a started challenge this long after the day ends
export const OFFLINE_MS = 48 * HOUR; // an offline completion may arrive this long after
export const WIN_BACK_MS = 48 * HOUR;
export const SHORT_DAY_MS = 4 * HOUR; // a time zone move can leave a day too short to play

export function addDays(day: Day, n: number): Day {
  return Temporal.PlainDate.from(day).add({ days: n }).toString();
}

export function localDate(at: Date, tz: string): Day {
  return Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(tz).toPlainDate().toString();
}

/** The first moment of a date in a zone. */
function startOfDate(day: Day, tz: string): number {
  return Temporal.PlainDate.from(day).toZonedDateTime(tz).epochMilliseconds;
}

export function isTimezone(tz: string): boolean {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false; // no raw offsets like +05:30
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** zones must be sorted by from_day, oldest first. */
export function zoneIndex(zones: Zone[], day: Day): number {
  let found = 0;
  for (let i = 1; i < zones.length; i++) if (zones[i]!.from_day <= day) found = i;
  return found;
}

/**
 * The moment a day ends, which is also when the next one starts.
 *
 * A zone change never moves the end of the day it was asked for on. The first day in the
 * new zone starts there and ends at its own midnight in the new zone, so it is longer
 * going west and shorter going east. Crossing the date line eastward can leave it with no
 * time at all. It still may not end before it starts.
 */
export function dayEnd(zones: Zone[], day: Day): Date {
  const i = zoneIndex(zones, day);
  const end = startOfDate(addDays(day, 1), zones[i]!.tz);
  if (i > 0 && zones[i]!.from_day === day) {
    return new Date(Math.max(end, dayEnd(zones, addDays(day, -1)).getTime()));
  }
  return new Date(end);
}

export function dayStart(zones: Zone[], day: Day): Date {
  return dayEnd(zones, addDays(day, -1));
}

export function dayLength(zones: Zone[], day: Day): number {
  return dayEnd(zones, day).getTime() - dayStart(zones, day).getTime();
}

/** Which day it is. Never repeats a date and never goes back, even after a zone change. */
export function currentDay(zones: Zone[], at: Date): Day {
  for (let i = zones.length - 1; i > 0; i--) {
    const zone = zones[i]!;
    if (at >= dayStart(zones, zone.from_day)) {
      const date = localDate(at, zone.tz);
      return date > zone.from_day ? date : zone.from_day;
    }
  }
  return localDate(at, zones[0]!.tz);
}

/** The next day with any time in it. A move across the date line can skip a date. */
export function nextDay(zones: Zone[], day: Day): Day {
  let next = addDays(day, 1);
  while (dayLength(zones, next) === 0) next = addDays(next, 1);
  return next;
}

export type Verdict = 'on_time' | 'grace' | 'offline' | 'too_early' | 'too_late';

/** Does a completion arriving now count for its day? */
export function judge(c: {
  now: Date;
  dayStart: Date;
  dayEnd: Date;
  startedAt: Date | null; // when the server heard the start
  bundleIssuedAt: Date | null; // when this phone first got this challenge
  lastContactAt: Date | null; // when this phone last talked to us, outbox aside
}): Verdict {
  const late = c.now.getTime() - c.dayEnd.getTime();
  if (c.now < c.dayStart) return 'too_early';
  if (c.dayStart >= c.dayEnd) return 'too_late'; // a date that was skipped cannot be played
  if (late < 0) return 'on_time';
  if (c.startedAt && c.startedAt < c.dayEnd && late <= GRACE_MS) return 'grace';
  const hadBundle = c.bundleIssuedAt !== null && c.bundleIssuedAt < c.dayEnd;
  const silentSince = c.lastContactAt === null || c.lastContactAt < c.dayEnd;
  if (hadBundle && silentSince && late <= OFFLINE_MS) return 'offline';
  return 'too_late';
}
