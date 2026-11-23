export type Rarity = 'common' | 'rare' | 'holo';

export type Card = {
  id: string;
  game: string;
  name: string;
  set: string;
  number: string | null;
  year: number;
  variety: string | null;
  grade: number;
  rarity: Rarity;
};

export type Challenge = {
  id: string;
  day: string;
  startsAt: string;
  endsAt: string;
  startedAt: string | null;
  completedAt: string | null;
  answers: Rarity[] | null;
  cards: Card[];
  reward: Card | null; // null: owns every card
};

export type WinBack = { missedDay: string; lostStreak: number; closesAt: string; priceCents: number };

export type StreakInfo = {
  streak: number;
  todayDone: boolean;
  freezes: number;
  winBack: WinBack | null;
  recentDays: { day: string; status: 'done' | 'frozen' | 'won_back' }[];
};

export type Today = StreakInfo & {
  now: string;
  day: string;
  endsAt: string;
  timezone: string;
  resume: Challenge | null;
  challenge: Challenge;
  tomorrow: Challenge;
  unseenReveals: { challengeId: string; day: string; acquiredAt: string; card: Card }[];
};

export type Completed = StreakInfo & {
  challengeId: string;
  day: string;
  completedAt: string;
  score: number;
  card: Card | null;
  repeated: boolean;
};

export type User = { id: string; email: string; timezone: string };

/** A small store that finishes before it returns, so a killed app loses nothing. */
export type Storage = {
  get(key: string): string | null;
  /** False: it could not be written, most likely because the phone is out of space. Never throws. */
  set(key: string, value: string): boolean;
  remove(key: string): void;
};
