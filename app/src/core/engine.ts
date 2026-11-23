import { type Api, Refused, SignedOut, Unreachable } from './api';
import { ServerClock } from './clock';
import { OWNED, SAVED, TODAY, readRow, writeRow } from './rows';
import {
  CARDS,
  OFFLINE_MS,
  type OutboxItem,
  type Open,
  type Payment,
  type Play,
  type Saved,
  type View,
  emptySaved,
  findReveal,
  isFinished,
  mayContact,
  waitsFor,
  nextChange,
  whatToShow,
} from './state';
import type { Challenge, Completed, Rarity, Storage, Today, User, WinBack } from './types';

/** Just asked: no need to ask again. */
const FRESH_MS = 5_000;
/** How often Stripe has to say "not paid" before we say so. */
const UNPAID_CHECKS = 3;

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
  /** What is shown is only the last we knew. */
  streakOld: boolean;
  payment: Payment | null;
  /** Only with nothing unsent, and not while a payment is under way. */
  offer: WinBack | null;
};

/** What the payment sheet needs. */
export type Sheet = { clientSecret: string; publishableKey: string };

type Paid = { id: string; state: 'open' | 'bank' | 'processing' | 'declined' | 'paid' | 'canceled' | 'refunding' | 'refunded'; problem: string | null };

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
  private paying: Promise<Sheet | null> | null = null;
  private checking: Promise<void> | null = null;
  private cancelCheck: (() => void) | null = null;
  private checks = 0;
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
    this.cancelCheck?.();
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

  /** Before anything else is asked. A send that began before the network came back may be about to fail: then our own. */
  private async sendFirst(): Promise<boolean> {
    const joined = this.flushing !== null;
    return (await this.flush()) || (joined && (await this.flush()));
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
    // With more days waiting behind it, this reply's streak is not the end of it.
    const more = this.saved.outbox.some((other) => other !== item && other.kind === 'complete');
    if (this.today && !more) {
      const { streak, todayDone, freezes, winBack, recentDays, settledThrough } = data;
      this.today = { ...this.today, streak, todayDone, freezes, winBack, recentDays, settledThrough };
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
    if (this.saved.payment) void this.checkPayment();
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
    if (this.isPending()) void this.checkPayment();
    this.syncing = true;
    this.publish();
    if (!(await this.sendFirst())) return;
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

  /** Why get would refuse now, for the words on the screen. */
  waitsFor = (): 'finish' | 'send' | null => waitsFor(this.saved, this.clock.now());

  /** A read for another screen. Goes through the same gate as everything else. */
  get<T>(path: string, headers?: Record<string, string>) {
    return this.ask<T>('GET', path, undefined, headers);
  }

  private async ask<T>(method: 'GET' | 'POST', path: string, body?: object, headers?: Record<string, string>) {
    const sent = await this.sendFirst();
    if (!sent || !mayContact(this.saved, this.clock.now())) throw new Unreachable('network', 'Waiting for your challenge to be sent');
    try {
      const reply = await this.deps.api.call<T>(method, path, body, headers);
      this.heard();
      this.publish();
      return reply;
    } catch (err) {
      if (!(err instanceof Refused)) this.failed(err);
      throw err;
    }
  }

  // Winning a streak back

  /**
   * Begin to pay, or go on with it. Saved on the phone before this returns, because the sheet opens next.
   * Null: there is nothing to pay with, the payment is past that. A second tap waits for the first.
   */
  beginPayment(): Promise<Sheet | null> {
    this.paying ??= this.startPayment().finally(() => {
      this.paying = null;
    });
    return this.paying;
  }

  private async startPayment(): Promise<Sheet | null> {
    // One that is under way is gone on with. One that is over, perhaps for another break, must not stand in the way.
    const winBack = this.today?.winBack ?? null;
    const wanted = this.isPending() ? this.saved.payment : (winBack ?? this.saved.payment);
    if (!wanted) throw new Refused(409, 'no_win_back', 'There is no streak to win back.');
    const { missedDay, lostStreak } = wanted;
    // It counts as contact, so it waits for everything else like any other call.
    const { data } = await this.ask<Paid & { clientSecret: string | null; publishableKey: string }>('POST', '/win-back', { missedDay });
    this.saved.payment = { id: data.id, missedDay, lostStreak, state: 'checking', problem: null };
    this.checks = 0;
    this.save();
    if (!data.clientSecret) {
      this.heardOf(data, true);
      return null;
    }
    if (this.unsaved) {
      this.saved.payment = null;
      this.publish();
      throw new Error('not saved'); // a payment that a kill would lose is not begun
    }
    return { clientSecret: data.clientSecret, publishableKey: data.publishableKey };
  }

  /** The sheet is gone. What it said is not the answer: Stripe is asked. */
  sheetClosed(canceled: boolean): Promise<void> {
    // Closed by hand, nothing is likely to be on its way. But a connection error may have come before that,
    // and the card may have been charged all the same. So Stripe is asked twice.
    this.checks = canceled ? UNPAID_CHECKS - 1 : 0;
    return this.checkPayment();
  }

  private isPending = () => ['checking', 'processing', 'bank'].includes(this.saved.payment?.state ?? '');

  /** What became of the payment. A quiet call: it never counts as contact, so it does not wait for the gate. */
  checkPayment(): Promise<void> {
    this.checking ??= this.checkNow().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async checkNow(): Promise<void> {
    const { payment } = this.saved;
    this.cancelCheck?.();
    this.cancelCheck = null;
    if (!payment || this.stopped) return;
    try {
      const { data } = await this.deps.api.call<Paid>('GET', `/win-back/payments/${payment.id}`);
      this.heard();
      if (this.saved.payment?.id === payment.id) this.heardOf(data, false);
    } catch (err) {
      if (err instanceof Refused) {
        // Not there any more: the account started over.
        if (this.saved.payment?.id === payment.id) this.saved.payment = null;
        this.save();
        return;
      }
      this.failed(err);
    }
    this.planCheck();
  }

  private planCheck(): void {
    const state = this.saved.payment?.state;
    if (this.stopped || (state !== 'checking' && state !== 'processing')) return;
    const wait = Math.min(1_500 * 2 ** this.checks, 30_000);
    this.checks++;
    this.cancelCheck?.();
    this.cancelCheck = (this.deps.setTimer ?? realTimer)(() => void this.checkPayment(), wait);
  }

  private heardOf(paid: Paid, justBegun: boolean): void {
    const payment = this.saved.payment!;
    const days = `${payment.lostStreak} day streak`;
    if (paid.state === 'paid') {
      this.saved.payment = null;
      this.notice(`Paid. Your ${days} is back.`);
    } else if (paid.state === 'refunded' || paid.state === 'refunding') {
      this.saved.payment = null;
      this.notice(`Your streak did not need it, so your payment ${paid.state === 'refunded' ? 'was' : 'is being'} refunded in full.`);
    } else if (paid.state === 'open') {
      // Not paid. Right after a kill it may still be on its way, so it is asked a few times more.
      const sure = this.checks >= UNPAID_CHECKS;
      this.saved.payment = { ...payment, state: justBegun || !sure ? 'checking' : 'unpaid', problem: null };
    } else {
      this.saved.payment = { ...payment, state: paid.state, problem: paid.problem };
    }
    this.save();
    if (this.saved.payment === null) void this.sync();
  }

  /** The person has read it. */
  dismissPayment(): void {
    if (this.isPending() && this.saved.payment?.state !== 'bank') return; // not while it is not known
    this.saved.payment = null;
    this.save();
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
    this.cancelCheck?.();
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
    const streakKnown =
      this.today !== null &&
      !this.saved.outbox.some((item) => item.kind === 'complete') &&
      this.clock.now() < Date.parse(this.today.endsAt);
    const { payment } = this.saved;
    const winBack = this.today?.winBack ?? null;
    const offered = winBack !== null && streakKnown && this.saved.outbox.length === 0 && mayContact(this.saved, this.clock.now());
    return {
      saved: this.saved,
      today: this.today,
      owned: this.owned,
      view: whatToShow(this.saved, this.today, this.clock.now(), this.open, this.unsaved),
      connection: this.connection,
      syncing: this.syncing,
      unsent: this.saved.outbox.filter((item) => item.kind === 'complete').length,
      unsaved: this.unsaved,
      streakKnown,
      streakOld: !streakKnown || this.connection === 'offline' || this.connection === 'trouble',
      payment,
      offer: offered && !this.isPending() && this.clock.now() < Date.parse(winBack.closesAt) ? winBack : null,
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
