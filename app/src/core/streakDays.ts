import { isFinished, type Saved } from './state';
import type { Today } from './types';

export type DayStatus = 'done' | 'unsent' | 'frozen' | 'won_back' | 'missed' | 'today' | 'late' | 'before';
export type StreakDay = { day: string; status: DayStatus };

const DAY = 86_400_000;
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);
const name = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The last weeks, whole weeks from Monday, ending with the one of the last day we know. A missed day has no
 * record. Before the first record there is nothing to say.
 */
export function streakDays(today: Today, saved: Saved, weeks = 5): StreakDay[] {
  const records = new Map(today.recentDays.map(({ day, status }) => [day, status]));
  const unsent = new Set(
    Object.values(saved.plays)
      .filter((play) => isFinished(play) && play.accepted === null)
      .map((play) => play.challenge.day),
  );
  const first = today.recentDays[0]?.day ?? today.day;
  const end = at(today.day);
  const monday = end - ((new Date(end).getUTCDay() + 6) % 7) * DAY;
  return Array.from({ length: Math.round((end - monday) / DAY) + 1 + (weeks - 1) * 7 }, (_, i): StreakDay => {
    const day = name(monday - (weeks - 1) * 7 * DAY + i * DAY);
    const record = records.get(day);
    if (record) return { day, status: record };
    if (unsent.has(day)) return { day, status: 'unsent' };
    if (day === today.day) return { day, status: 'today' };
    if (day < first) return { day, status: 'before' };
    return { day, status: day <= today.settledThrough ? 'missed' : 'late' }; // late: it can still be finished
  });
}

export const statusName: Record<DayStatus, string> = {
  done: 'done',
  unsent: 'done, not sent yet',
  frozen: 'saved by a freeze',
  won_back: 'won back',
  missed: 'missed',
  today: 'not done yet',
  late: 'still open',
  before: '',
};
