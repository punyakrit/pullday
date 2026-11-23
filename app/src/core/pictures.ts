import { type Kind, readRow, writeRow } from './rows';
import type { Storage } from './types';

/** 'fine' also while it is loading, or not known yet. */
export type PictureState = 'fine' | 'none' | 'failed';
export type Look = { state: PictureState; attempt: number };

/** What the server says about a card's picture. Not a login call, so it never counts as contact. */
export type Answer = 'there' | 'none' | 'unreachable';

const AGAIN_MS = 30_000; // the server itself waits this long before it tries a bad original again
const NONE_KEY = 'cards-without-picture';
const NONE: Kind<string[]> = {
  upgrades: [(old) => old],
  check: (value): value is string[] => Array.isArray(value) && value.every((one) => typeof one === 'string'),
};
const FINE: Look = { state: 'fine', attempt: 0 };

type Deps = {
  ask: (cardId: string) => Promise<Answer>;
  storage: Storage;
  setTimer?: (work: () => void, ms: number) => () => void;
};

const realTimer = (work: () => void, ms: number) => {
  const id = setTimeout(work, ms);
  return () => clearTimeout(id);
};

/**
 * Which pictures did not load, and why. A card with no picture is told from a bad connection by asking
 * the server. What failed is tried again when the connection is back, and now and then while it is on
 * screen. One address at a time: the large picture may fail while the small one is there.
 */
export class Pictures {
  private readonly deps: Deps;
  private readonly looks = new Map<string, Look>(); // by address
  private readonly none = new Set<string>(); // by card: the server said so since the app opened
  private readonly before: Set<string>; // by card: it said so some other time. For the words when offline
  private readonly listeners = new Set<() => void>();
  private cancel: (() => void) | null = null;

  constructor(deps: Deps) {
    this.deps = deps;
    this.before = new Set(readRow(deps.storage, NONE_KEY, NONE).value ?? []);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.plan();
    return () => this.listeners.delete(listener);
  };

  look(cardId: string, url: string): Look {
    if (this.none.has(cardId)) return this.named('none');
    return this.looks.get(url) ?? FINE;
  }

  async failed(cardId: string, url: string): Promise<void> {
    const answer = await this.deps.ask(cardId).catch((): Answer => 'unreachable');
    if (answer === 'none') {
      this.none.add(cardId);
      this.remember(cardId, true);
    } else {
      if (answer === 'there') this.remember(cardId, false);
      const { attempt } = this.looks.get(url) ?? FINE;
      const state = answer === 'unreachable' && this.before.has(cardId) ? 'none' : 'failed';
      this.looks.set(url, { state, attempt });
    }
    this.plan();
    this.tell();
  }

  loaded(cardId: string, url: string): void {
    this.remember(cardId, false);
    const look = this.looks.get(url);
    if (!look || look.state === 'fine') return;
    this.looks.set(url, { state: 'fine', attempt: look.attempt });
    this.tell();
  }

  /** The connection is back, or some time has passed. What failed keeps its words until it is there. */
  retry(): void {
    this.cancel?.();
    this.cancel = null;
    let any = false;
    for (const [url, look] of this.looks) {
      if (look.state === 'fine') continue;
      this.looks.set(url, { state: look.state, attempt: look.attempt + 1 });
      any = true;
    }
    if (any) this.tell();
  }

  private plan(): void {
    if (this.cancel || this.listeners.size === 0) return;
    if (![...this.looks.values()].some((look) => look.state !== 'fine')) return;
    this.cancel = (this.deps.setTimer ?? realTimer)(() => {
      this.cancel = null;
      if (this.listeners.size === 0) return; // nothing on screen: when there is, it is tried anyway
      this.retry();
    }, AGAIN_MS);
  }

  private remember(cardId: string, none: boolean): void {
    if (this.before.has(cardId) === none) return;
    if (none) this.before.add(cardId);
    else this.before.delete(cardId);
    writeRow(this.deps.storage, NONE_KEY, NONE, [...this.before]);
  }

  private readonly names: Partial<Record<PictureState, Look>> = {};
  /** The same object every time, because React compares them. */
  private named(state: PictureState): Look {
    return (this.names[state] ??= { state, attempt: 0 });
  }

  private tell(): void {
    for (const listener of this.listeners) listener();
  }
}
