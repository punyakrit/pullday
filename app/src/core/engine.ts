import { type Api, Refused, SignedOut, Unreachable } from './api';
import { ServerClock } from './clock';
import { OWNED, SAVED, TODAY, readRow, writeRow } from './rows';
import {
  CARDS,
  OFFLINE_MS,
  type OutboxItem,
  type Open,
  type Play,
  type Saved,
  type View,
  emptySaved,
  findReveal,
  isFinished,
  mayContact,
  nextChange,
  whatToShow,
} from './state';
import type { Challenge, Completed, Rarity, Storage, Today, User } from './types';

/** Just asked: no need to ask again. */
const FRESH_MS = 5_000;

/** What the phone says about its own connection. */
export type Net = { connected: boolean; reachable: boolean; kind: string };

export type Connection = 'unknown' | 'online' | 'offline' | 'trouble';

export type Snapshot = {
  saved: Saved;
  today: Today | null;
  owned: OwnedCard[] | null;
  view: View;
  connection: Connection;
  syncing: boolean;
  unsent: number;
  /** The last save did not work. What was done since is only in memory. */
  unsaved: boolean;
  /** Streak, freezes and win back are only true once the outbox is empty. */
  streakKnown: boolean;
};

export type OwnedCard = { cardId: string; acquiredAt: string; revealSeenAt: string | null };

type Deps = {
  api: Api;
  storage: Storage;
  user: User;
  local: () => number;
  onSignedOut: () => void;
  /** The server was heard again after it could not be. */
  onOnline?: () => void;
  /** Called with the challenges and cards that may be needed soon. */
  onBundle?: (today: Today) => void;
  setTimer?: (work: () => void, ms: number) => () => void;
};

const realTimer = (work: () => void, ms: number) => {
  const id = setTimeout(work, ms);
  return () => clearTimeout(id);
};

/** Everything the phone knows about one account: what is played, what is unsent, what to show. */
export class Engine {
  readonly clock: ServerClock;
  readonly user: User;
  private saved: Saved;
  private today: Today | null;
  private owned: OwnedCard[] | null;
  private open: Open | null = null;
  private connection: Connection = 'unknown';
  private syncing = false;
  private unsaved = false;
  private snapshot: Snapshot;
  private readonly listeners = new Set<() => void>();
  private flushing: Promise<boolean> | null = null;
  private syncRun: Promise<void> | null = null;
  private freshAt = -Infinity;
  private triedAt = -Infinity;
  private net: Net | null = null;
  private retryMs = 0;
  private cancelRetry: (() => void) | null = null;
  private stopped = false;
  private readonly deps: Deps;
  private readonly keys: { saved: string; today: string; owned: string; aside: string };

  constructor(deps: Deps) {
    this.deps = deps;
    this.user = deps.user;
    const base = `user:${deps.user.id}`;
    this.keys = { saved: `${base}:saved`, today: `${base}:today`, owned: `${base}:owned`, aside: `${base}:saved:aside` };
    this.clock = new ServerClock(deps.storage, `${base}:clock`, deps.local);
    // These two can be fetched again.
    this.today = readRow(deps.storage, this.keys.today, TODAY).value;
    this.owned = readRow(deps.storage, this.keys.owned, OWNED).value;
    this.saved = this.restore();
    this.snapshot = this.build();
  }

  // For React

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): Snapshot => this.snapshot;

  /** Look at the clock again. Call it when nextChange passes. */
  refreshView = (): void => this.publish();
  nextChange = (): number | null => nextChange(this.saved, this.today, this.clock.now());

  stop(): void {
    this.stopped = true;
    this.cancelRetry?.();
  }

  // Playing

  /** The first touch. The server hears about it as soon as it can. */
  begin(challenge: Challenge): void {
    const play = this.playOf(challenge);
    if (play.begunAt !== null) return;
    play.begunAt = this.clock.now();
    this.saved.plays[challenge.id] = play;
    this.queue({ kind: 'start', challengeId: challenge.id, endsAt: Date.parse(challenge.endsAt) });
    this.save();
    void this.flush();
  }

  /** A swipe. Final. Saved before this returns. */
  answer(challenge: Challenge, index: number, rarity: Rarity): void {
    this.begin(challenge);
    const play = this.playOf(challenge);
    if (index !== play.answers.length || isFinished(play)) return; // a swipe we already have
    play.answers = [...play.answers, rarity];
    this.saved.plays[challenge.id] = play;
    if (play.answers.length === CARDS) {
      // The finish is in the outbox, and on disk, before anything is revealed.
      this.queue({ kind: 'complete', challengeId: challenge.id, endsAt: Date.parse(challenge.endsAt), answers: play.answers });
    }
    this.save();
    if (!isFinished(play)) return;
    if (!this.unsaved) this.showReveal(challenge.id);
    void this.flush();
  }

  /** The card was shown to the end. Until this, a reveal starts over. */
  revealShown(challengeId: string): void {
    if (this.saved.seen[challengeId]) return;
    this.saved.seen[challengeId] = true;
    const challenge = this.saved.plays[challengeId]?.challenge;
    this.queue({
      kind: 'reveal-seen',
      challengeId,
      endsAt: challenge ? Date.parse(challenge.endsAt) : this.clock.now(),
    });
    const reveal = findReveal(this.saved, this.today, challengeId);
    if (reveal) this.open = { reveal, seen: true }; // stays until it is closed
    this.save();
    void this.flush();
  }

  showReveal(challengeId: string): void {
    const reveal = this.open?.reveal.challengeId === challengeId ? null : findReveal(this.saved, this.today, challengeId);
    if (!reveal) return;
    this.open = { reveal, seen: false };
    this.publish();
  }

  closeReveal(): void {
    this.open = null;
    this.publish();
    void this.sync();
  }

  dismissNotice(id: string): void {
    this.saved.notices = this.saved.notices.filter((notice) => notice.id !== id);
    this.save();
  }

  // Talking to the server

  /** Send the outbox, in order. True when it is empty. */
  flush(): Promise<boolean> {
    this.flushing ??= this.sendAll().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async sendAll(): Promise<boolean> {
    while (this.saved.outbox.length > 0) {
      if (this.stopped) return false;
      const item = this.saved.outbox[0]!;
      try {
        await this.send(item);
        this.heard();
      } catch (err) {
        if (err instanceof Refused) {
          this.heard();
          this.refused(item, err);
        } else if (err instanceof Unreachable && err.kind === 'server' && this.clock.now() > item.endsAt + OFFLINE_MS) {
          // Too old for the server to take. It must not hold up everything behind it for ever.
          this.refused(item, new Refused(409, 'too_late', ''));
        } else {
          this.failed(err);
          return false;
        }
      }
      this.saved.outbox = this.saved.outbox.filter((other) => other !== item);
      this.save();
    }
    return true;
  }

  private async send(item: OutboxItem): Promise<void> {
    const path = `/challenges/${item.challengeId}/${item.kind}`;
    if (item.kind !== 'complete') {
      await this.deps.api.call('POST', path);
      return;
    }
    const { data } = await this.deps.api.call<Completed>('POST', path, { answers: item.answers });
    const play = this.saved.plays[item.challengeId];
    if (play) play.accepted = { card: data.card, score: data.score };
    if (this.today) {
      const { streak, todayDone, freezes, winBack, recentDays } = data;
      this.today = { ...this.today, streak, todayDone, freezes, winBack, recentDays };
      writeRow(this.deps.storage, this.keys.today, TODAY, this.today);
    }
    if (data.card && this.owned && !this.owned.some((one) => one.cardId === data.card!.id)) {
      this.owned = [{ cardId: data.card.id, acquiredAt: data.completedAt, revealSeenAt: null }, ...this.owned];
      writeRow(this.deps.storage, this.keys.owned, OWNED, this.owned);
    }
  }

  /** The server said no. A refused start or reveal changes nothing. A refused finish must be told. */
  private refused(item: OutboxItem, err: Refused): void {
    if (item.kind !== 'complete') return;
    delete this.saved.plays[item.challengeId];
    if (this.open?.reveal.challengeId === item.challengeId) this.open = null;
    const wasShown = this.saved.seen[item.challengeId] === true;
    delete this.saved.seen[item.challengeId];
    if (err.code === 'too_late') {
      const lost = wasShown ? ' The card you saw was not added.' : '';
      this.notice(`A challenge reached us after its day was over, so it did not count.${lost}`);
    } else if (err.code === 'too_early') {
      this.notice("That challenge is for tomorrow. Check the date on your phone. It will be here when it's time.");
    } else if (err.code !== 'no_such_challenge') {
      this.notice('One challenge could not be saved.');
    }
  }

  /**
   * Android reports every change of signal. It is news only when the connection came back, is of
   * another kind, or now reaches the internet. Or when the last call failed, and any hint is welcome.
   */
  network(now: Net): boolean {
    const before = this.net;
    this.net = now;
    if (!now.connected) return false;
    const news = !before?.connected || before.kind !== now.kind || (now.reachable && !before.reachable);
    const failed = this.connection === 'offline' || this.connection === 'trouble';
    if (news || (failed && Math.abs(this.deps.local() - this.triedAt) >= FRESH_MS)) this.wake();
    return news;
  }

  /** The app came to the front, or the network came back. Several of these arrive together. */
  wake(): void {
    if (this.unsaved) this.save(); // there may be space again
    else this.publish();
    // Either way: the phone's clock can be moved back.
    const fresh = Math.abs(this.deps.local() - this.freshAt) < FRESH_MS && this.connection === 'online';
    if (!fresh || this.saved.outbox.length > 0) void this.sync();
  }

  /** Outbox first, then everything else. Never throws. */
  sync(): Promise<void> {
    this.syncRun ??= this.syncNow().finally(() => {
      this.syncRun = null;
      this.syncing = false;
      this.publish();
    });
    return this.syncRun;
  }

  private async syncNow(): Promise<void> {
    if (this.stopped) return;
    this.triedAt = this.deps.local();
    this.syncing = true;
    this.publish();
    // A send that began before the network came back may be about to fail. Then try our own.
    const joined = this.flushing !== null;
    if (!(await this.flush()) && !(joined && (await this.flush()))) return;
    if (this.stopped || !mayContact(this.saved, this.clock.now())) return;
    try {
      const { data, sentAt, receivedAt } = await this.deps.api.call<Today>('GET', '/today');
      this.heard();
      this.applyToday(data, sentAt, receivedAt);
      if (!mayContact(this.saved, this.clock.now())) return;
      const { data: collection } = await this.deps.api.call<{ cards: OwnedCard[] }>('GET', '/collection');
      this.owned = collection.cards;
      this.freshAt = this.deps.local();
      writeRow(this.deps.storage, this.keys.owned, OWNED, this.owned);
    } catch (err) {
      if (!(err instanceof Refused)) this.failed(err);
    }
  }

  /** A read for another screen. Goes through the same gate as everything else. */
  async get<T>(path: string, headers?: Record<string, string>) {
    const sent = await this.flush();
    if (!sent || !mayContact(this.saved, this.clock.now())) throw new Unreachable('network', 'Waiting for your challenge to be sent');
    try {
      const reply = await this.deps.api.call<T>('GET', path, undefined, headers);
      this.heard();
      this.publish();
      return reply;
    } catch (err) {
      if (!(err instanceof Refused)) this.failed(err);
      throw err;
    }
  }

  private applyToday(today: Today, sentAt: number, receivedAt: number): void {
    this.clock.sync(today.now, sentAt, receivedAt);
    this.today = today;
    writeRow(this.deps.storage, this.keys.today, TODAY, today);
    const now = this.clock.now();
    const unsent = new Set(this.saved.outbox.map((item) => item.challengeId));
    const known = [today.challenge, today.tomorrow, today.resume];
    for (const [id, play] of Object.entries(this.saved.plays)) {
      const current = known.find((challenge) => challenge?.id === id);
      const doneElsewhere = current?.completedAt && !isFinished(play);
      const old = Date.parse(play.challenge.endsAt) + OFFLINE_MS < now;
      // The account was reset: another challenge is now the one for that day.
      const replaced = !current && known.some((challenge) => challenge?.day === play.challenge.day);
      if (id !== this.open?.reveal.challengeId && !unsent.has(id) && (doneElsewhere || old || replaced)) delete this.saved.plays[id];
    }
    const keep = new Set([...Object.keys(this.saved.plays), ...unsent, ...today.unseenReveals.map((one) => one.challengeId)]);
    for (const id of Object.keys(this.saved.seen)) if (!keep.has(id)) delete this.saved.seen[id];
    this.save();
    this.deps.onBundle?.(today);
  }

  // Dev menu

  async dev(path: string, body: object): Promise<unknown> {
    const { data } = await this.deps.api.call('POST', path, body);
    this.heard();
    return data;
  }

  /** After a reset the server has forgotten everything, so the phone does too. */
  forget(): void {
    this.saved = emptySaved();
    this.today = null;
    this.owned = null;
    this.open = null;
    this.unsaved = false;
    for (const key of [...Object.values(this.keys), `user:${this.user.id}:clock`]) this.deps.storage.remove(key);
    this.clock.reset();
    this.publish();
  }

  // Inside

  private playOf(challenge: Challenge): Play {
    return this.saved.plays[challenge.id] ?? { challenge, begunAt: null, answers: [], accepted: null };
  }

  private queue(item: OutboxItem): void {
    const known = this.saved.outbox.some((other) => other.kind === item.kind && other.challengeId === item.challengeId);
    if (!known) this.saved.outbox = [...this.saved.outbox, item];
  }

  private notice(text: string): void {
    const id = `${this.clock.now()}-${this.saved.notices.length}`;
    this.saved.notices = [...this.saved.notices, { id, text }];
  }

  private heard(): void {
    const again = this.connection === 'offline' || this.connection === 'trouble';
    this.connection = 'online';
    if (again) this.deps.onOnline?.();
    this.retryMs = 0;
    this.cancelRetry?.();
    this.cancelRetry = null;
  }

  private failed(err: unknown): void {
    if (err instanceof SignedOut) {
      this.stop();
      this.deps.onSignedOut();
      return;
    }
    this.connection = err instanceof Unreachable && err.kind === 'server' ? 'trouble' : 'offline';
    if (this.saved.outbox.length > 0 && !this.stopped) {
      this.retryMs = Math.min(Math.max(3_000, this.retryMs * 2), 60_000);
      this.cancelRetry?.();
      this.cancelRetry = (this.deps.setTimer ?? realTimer)(() => void this.sync(), this.retryMs);
    }
    this.publish();
  }

  private build(): Snapshot {
    return {
      saved: this.saved,
      today: this.today,
      owned: this.owned,
      view: whatToShow(this.saved, this.today, this.clock.now(), this.open, this.unsaved),
      connection: this.connection,
      syncing: this.syncing,
      unsent: this.saved.outbox.filter((item) => item.kind === 'complete').length,
      unsaved: this.unsaved,
      streakKnown:
        this.today !== null &&
        !this.saved.outbox.some((item) => item.kind === 'complete') &&
        this.clock.now() < Date.parse(this.today.endsAt),
    };
  }

  private publish(): void {
    if (this.stopped) return;
    this.snapshot = this.build();
    for (const listener of this.listeners) listener();
  }

  /** One row, one write: what was played and what is unsent can never disagree. */
  private save(): void {
    this.unsaved = !writeRow(this.deps.storage, this.keys.saved, SAVED, this.saved);
    this.saved = { ...this.saved };
    this.publish();
  }

  /** A row that cannot be used must not stop the app from opening. It is kept aside, and said. */
  private restore(): Saved {
    const { storage } = this.deps;
    const { value, unusable } = readRow(storage, this.keys.saved, SAVED);
    if (!unusable) return value ?? emptySaved();
    storage.set(this.keys.aside, storage.get(this.keys.saved)!);
    const text = 'This phone could not read what it had saved. A challenge that was not sent yet may be missing.';
    return { ...emptySaved(), notices: [{ id: 'unreadable', text }] };
  }
}
