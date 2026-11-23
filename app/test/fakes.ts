import { Api } from '../src/core/api';
import { Engine } from '../src/core/engine';
import type { Card, Challenge, Rarity, Storage, Today, User } from '../src/core/types';

export const HOUR = 3_600_000;
export const MINUTE = 60_000;
export const ANSWERS: Rarity[] = Array(8).fill('common');
export const USER: User = { id: 'u1', email: 'new@pullday.test', timezone: 'UTC' };

export class MemoryStorage implements Storage {
  readonly rows = new Map<string, string>();
  get = (key: string) => this.rows.get(key) ?? null;
  set = (key: string, value: string) => void this.rows.set(key, value);
  remove = (key: string) => void this.rows.delete(key);
}

export function card(id: string, rarity: Rarity = 'common'): Card {
  return { id, game: 'pokemon', name: id, set: 'Set', number: null, year: 2000, variety: null, grade: 9, rarity };
}

export function challenge(day: string, over: Partial<Challenge> = {}): Challenge {
  const start = Date.parse(`${day}T00:00:00Z`);
  return {
    id: `ch-${day}`,
    day,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 24 * HOUR).toISOString(),
    startedAt: null,
    completedAt: null,
    answers: null,
    cards: Array.from({ length: 8 }, (_, i) => card(`${day}-${i}`)),
    reward: card(`reward-${day}`, 'holo'),
    ...over,
  };
}

/** A phone with a clock and a server we script. */
export class World {
  time: number;
  online = true;
  storage = new MemoryStorage();
  calls: string[] = [];
  signedOut = 0;
  timers: { work: () => void; ms: number }[] = [];
  respond: (method: string, path: string) => { status: number; body: unknown } | 'down' = () => ({ status: 200, body: {} });

  constructor(iso: string) {
    this.time = Date.parse(iso);
  }
  set clock(iso: string) {
    this.time = Date.parse(iso);
  }

  today(over: Partial<Today> = {}): Today {
    const day = new Date(this.time).toISOString().slice(0, 10);
    const next = new Date(this.time + 24 * HOUR).toISOString().slice(0, 10);
    return {
      now: new Date(this.time).toISOString(),
      day,
      endsAt: challenge(day).endsAt,
      timezone: 'UTC',
      streak: 0,
      todayDone: false,
      freezes: 0,
      winBack: null,
      recentDays: [],
      resume: null,
      challenge: challenge(day),
      tomorrow: challenge(next),
      unseenReveals: [],
      ...over,
    };
  }

  private fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = String(url).replace('http://server', '');
    const method = init?.method ?? 'GET';
    if (!this.online) throw new TypeError('Network request failed');
    const reply = this.respond(method, path);
    if (reply === 'down') throw new TypeError('Network request failed');
    this.calls.push(`${method} ${path}`);
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status: reply.status });
  };

  api = new Api({ baseUrl: 'http://server/', fetch: this.fetch as typeof fetch, now: () => this.time, timeoutMs: 200 });

  /** Open the app. Call it again for what a killed app sees. */
  open(user: User = USER): Engine {
    this.api.startSession('token');
    return new Engine({
      api: this.api,
      storage: this.storage,
      user,
      local: () => this.time,
      onSignedOut: () => void this.signedOut++,
      setTimer: (work, ms) => {
        this.timers.push({ work, ms });
        return () => void (this.timers = this.timers.filter((timer) => timer.work !== work));
      },
    });
  }

  /** The usual answers for a day. */
  normal(over: Partial<Today> = {}) {
    this.respond = (method, path) => {
      if (path === '/today') return { status: 200, body: this.today(over) };
      if (path === '/collection') return { status: 200, body: { cards: [] } };
      const done = /^\/challenges\/(ch-(.+))\/complete$/.exec(path);
      if (method === 'POST' && done) {
        const { streak, freezes, winBack, recentDays } = this.today();
        return {
          status: 200,
          body: {
            challengeId: done[1],
            day: done[2],
            completedAt: new Date(this.time).toISOString(),
            score: 8,
            card: card(`reward-${done[2]}`, 'holo'),
            repeated: false,
            streak: streak + 1,
            todayDone: true,
            freezes,
            winBack,
            recentDays,
          },
        };
      }
      return { status: 200, body: {} };
    };
  }
}

export function playAll(engine: Engine, one: Challenge, answers: Rarity[] = ANSWERS) {
  answers.forEach((rarity, i) => engine.answer(one, i, rarity));
}

export const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((resolve) => setImmediate(() => resolve()));
};
