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
  type Purchase,
  type PurchaseState,
  type Saved,
  type View,
  emptySaved,
  findReveal,
  isFinished,
  isOver,
  mayContact,
  waitsFor,
  nextChange,
  whatToShow,
} from './state';
import type { FakeStore, Outcome, Transaction } from './store';
import type { Challenge, Completed, Rarity, Storage, Today, User, WinBack } from './types';

/** Just asked: no need to ask again. */
const FRESH_MS = 5_000;
/** How often Stripe has to say "not paid" before we say so. */
const UNPAID_CHECKS = 3;

/** What the phone says about its own connection. */
export type Net = { connected: boolean; reachable: boolean; kind: string };

const TOO_MANY = 'You can hold 2 freezes, so a third was not kept. Its $1.99 goes back to you.';

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
  /** While the sheet is open: what was said before it opened. */
  payment: Payment | null;
  /** The freeze that is being bought right now. The button says so, and nothing else needs to. */
  buying: string | null;
  /** Only with nothing unsent, and not while a payment is under way. */
  offer: WinBack | null;
};

/** What the payment sheet needs. */
export type Sheet = { clientSecret: string; publishableKey: string };

type Paid = { id: string; state: 'open' | 'bank' | 'processing' | 'declined' | 'paid' | 'canceled' | 'refunding' | 'refunded'; problem: string | null };

/** How buying a freeze ended, as far as it is known. 'paid': the server could not be told yet. */
export type Bought = 'granted' | 'refunded' | 'paid' | Exclude<Outcome, 'purchased'>;

export type OwnedCard = { cardId: string; acquiredAt: string; revealSeenAt: string | null };

type Deps = {
  api: Api;
  storage: Storage;
  user: User;
  store: FakeStore;
  newId: () => string;
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
  private sheet: { before: Payment | null } | null = null; // it is on the screen
  private checking: Promise<void> | null = null;
  private cancelCheck: (() => void) | null = null;
  private checks = 0;
  private buying: { id: string; run: Promise<Bought>; confirmed: 'granted' | 'refunded' | null } | null = null;
  private confirming: Promise<void> | null = null;
  private confirmMs = 0;
  private cancelConfirm: (() => void) | null = null;
  private readonly leaveStore: () => void;
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
    this.leaveStore = deps.store.subscribe(() => this.reconcile());
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
    this.cancelConfirm?.();
    this.leaveStore();
    if (this.deps.store.getSheet()?.account === this.user.id) this.deps.store.cancel();
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
      const { streak, todayDone, freezes, freezesUsed, freezeRefunds, winBack, recentDays, settledThrough } = data;
      this.today = { ...this.today, streak, todayDone, freezes, freezesUsed, freezeRefunds, winBack, recentDays, settledThrough };
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
    this.reconcile();
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
    this.reconcile();
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
    const before = this.saved.payment;
    // It counts as contact, so it waits for everything else like any other call.
    const { data } = await this.ask<Paid & { clientSecret: string | null; publishableKey: string }>('POST', '/win-back', { missedDay });
    // On disk it is already being checked, for a phone that dies now. On the screen, only once the sheet is gone.
    this.sheet = { before };
    this.saved.payment = { id: data.id, missedDay, lostStreak, state: 'checking', problem: null };
    this.checks = 0;
    this.save();
    if (!data.clientSecret) {
      this.sheet = null;
      this.heardOf(data, true);
      return null;
    }
    if (this.unsaved) {
      this.sheet = null;
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
    this.sheet = null;
    this.publish();
    return this.checkPayment();
  }

  private isPending = (payment = this.saved.payment) => ['checking', 'processing', 'bank'].includes(payment?.state ?? '');

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
    if (!payment || this.stopped || this.sheet) return; // with the sheet open there is nothing to say yet
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

  // Buying a freeze

  /** A second tap gets the first one's answer. Throws if it could not begin: then nothing was asked of the store. */
  buyFreeze(outcome?: Outcome): Promise<Bought> {
    if (this.buying) return this.buying.run;
    const id = this.deps.newId();
    const run = this.buy(id, outcome).finally(() => {
      this.buying = null;
      this.publish();
    });
    this.buying = { id, run, confirmed: null };
    return run;
  }

  private async buy(id: string, outcome?: Outcome): Promise<Bought> {
    // On disk before anyone is asked, and again before the sheet opens. A phone that dies knows what to look for.
    this.saved.purchases = [...this.saved.purchases.filter((one) => !isOver(one)), { id, beganAt: null, state: 'buying' }];
    this.save();
    try {
      if (this.unsaved) throw new Error('not saved');
      // The server says whether there is room, and when it began. It counts as contact, so it waits for the outbox.
      const { data } = await this.ask<{ beganAt: string }>('POST', '/freezes/purchases', { id });
      this.setPurchase(id, 'buying', Date.parse(data.beganAt));
      if (this.unsaved) throw new Error('not saved');
    } catch (err) {
      this.dropPurchase(id);
      if (err instanceof Refused) void this.sync(); // what we knew about the freezes was old
      throw err;
    }
    const ended = await this.deps.store.purchase(id, this.user.id, outcome);
    if (ended === 'failed' || ended === 'canceled') {
      this.setPurchase(id, ended);
      return ended;
    }
    this.reconcile();
    if (ended === 'pending') return 'pending';
    await this.confirmPaid();
    return this.buying?.confirmed ?? 'paid';
  }

  /** Make what we have agree with what the store knows: on launch, and whenever the store has news. */
  private reconcile(): void {
    if (this.stopped) return;
    const rows = this.deps.store.transactions(this.user.id);
    const said: Record<Transaction['state'], PurchaseState> = { processing: 'processing', pending: 'pending', purchased: 'paid', declined: 'declined' };
    let { purchases } = this.saved;
    for (const row of rows) {
      const known = purchases.find((one) => one.id === row.token);
      if (!known) purchases = [...purchases, { id: row.token, beganAt: null, state: said[row.state] }];
      else if (known.state !== said[row.state]) purchases = purchases.map((one) => (one === known ? { ...known, state: said[row.state] } : one));
    }
    // Not with the store: the app died with the sheet open, or the store gave up. No money was taken.
    purchases = purchases.flatMap((one): Purchase[] => {
      if (isOver(one) || one.id === this.buying?.id || rows.some((row) => row.token === one.id)) return [one];
      return one.beganAt === null ? [] : [{ ...one, state: 'unpaid' }];
    });
    if (purchases.length !== this.saved.purchases.length || purchases.some((one, i) => one !== this.saved.purchases[i])) {
      this.saved.purchases = purchases;
      this.save();
    }
    if (this.unsaved) return;
    for (const row of rows) if (row.state === 'declined') this.deps.store.finish(row.id);
    if (rows.some((row) => row.state === 'purchased')) void this.confirmPaid();
  }

  /** Tell the server what the store has taken money for. Quiet calls: they never count as contact. */
  private confirmPaid(): Promise<void> {
    this.confirming ??= this.confirmAll().finally(() => {
      this.confirming = null;
    });
    return this.confirming;
  }

  private async confirmAll(): Promise<void> {
    this.cancelConfirm?.();
    const tried = new Set<string>();
    const next = () => this.deps.store.transactions(this.user.id).find((row) => row.state === 'purchased' && !tried.has(row.id));
    let done = false;
    for (let row = next(); row && !this.stopped; row = next()) {
      tried.add(row.id);
      try {
        const { data } = await this.deps.api.call<{ freezeId: string; state: 'granted' | 'refunded' }>('POST', `/freezes/purchases/${row.token}/confirm`, { transactionId: row.id });
        this.heard();
        this.confirmMs = 0;
        done = true;
        if (data.state === 'refunded') this.tell(`refund:${data.freezeId}`, TOO_MANY);
        else if (this.buying?.id !== row.token) this.notice('Your streak freeze is here.'); // else the shop says it
        if (this.buying?.id === row.token) this.buying.confirmed = data.state;
        this.dropPurchase(row.token);
        if (!this.unsaved) this.deps.store.finish(row.id); // only now: until then the store hands it over again
      } catch (err) {
        if (err instanceof Refused) continue; // asked again next time
        this.failed(err);
        this.confirmMs = Math.min(Math.max(3_000, this.confirmMs * 2), 60_000);
        this.cancelConfirm = (this.deps.setTimer ?? realTimer)(() => void this.confirmPaid(), this.confirmMs);
        break;
      }
    }
    if (done) void this.sync();
  }

  /** The person has read it. */
  dismissPurchase(id: string): void {
    if (this.saved.purchases.some((one) => one.id === id && isOver(one))) this.dropPurchase(id);
  }

  private setPurchase(id: string, state: PurchaseState, beganAt?: number): void {
    this.saved.purchases = this.saved.purchases.map((one) => (one.id === id ? { ...one, state, beganAt: beganAt ?? one.beganAt } : one));
    this.save();
  }

  private dropPurchase(id: string): void {
    this.saved.purchases = this.saved.purchases.filter((one) => one.id !== id);
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
    this.sheet = null;
    this.cancelCheck?.();
    this.unsaved = false;
    this.deps.store.forget(this.user.id);
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

  /** Once on this phone. */
  private tell(key: string, text: string): void {
    const told = this.saved.told ?? [];
    if (told.includes(key)) return;
    this.saved.told = [...told, key];
    this.notice(text);
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
    const payment = this.sheet ? this.sheet.before : this.saved.payment;
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
      buying: this.buying?.id ?? null,
      offer: offered && !this.isPending(payment) && this.clock.now() < Date.parse(winBack.closesAt) ? winBack : null,
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
