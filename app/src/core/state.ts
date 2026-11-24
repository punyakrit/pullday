import type { Card, Challenge, Rarity, Today, WinBack } from './types';

export const CARDS = 8;
export const GRACE_MS = 60 * 60_000; // a begun challenge can be finished this long after its day
export const OFFLINE_MS = 48 * 3_600_000; // the server takes an offline day this long after
export const WIN_BACK_MS = 48 * 3_600_000; // from the end of the missed day
export const EDGE_MS = 60_000; // the last minute of a day counts as ended, because calls take time

export type OutboxItem =
  | { kind: 'start'; challengeId: string; endsAt: number }
  | { kind: 'complete'; challengeId: string; endsAt: number; answers: Rarity[] }
  | { kind: 'reveal-seen'; challengeId: string; endsAt: number };

/** One challenge as it is being played on this phone. */
export type Play = {
  challenge: Challenge; // kept whole: the server's bundle moves on, this must not
  begunAt: number | null;
  answers: Rarity[]; // saved after every swipe
  accepted: { card: Card | null; score: number } | null; // the server's word, once we have it
};

/** 'checking' until Stripe has answered, whatever happened on this phone. */
export type PaymentState = 'checking' | 'processing' | 'bank' | 'declined' | 'canceled' | 'unpaid';

/** Saved before the payment sheet opens, so that a phone that dies in the middle asks afterwards. */
export type Payment = { id: string; missedDay: string; lostStreak: number; state: PaymentState; problem: string | null };

/** 'buying' while the store's sheet is open. 'paid': the store has the money, our server has not confirmed it yet. */
export type PurchaseState = 'buying' | 'processing' | 'pending' | 'paid' | 'declined' | 'failed' | 'canceled' | 'unpaid';

/** A freeze being bought. The id is ours, and is saved before anything starts. */
export type Purchase = {
  id: string;
  beganAt: number | null; // the server's word. Null: it has not heard of it, so no sheet was opened either
  state: PurchaseState;
};

const OVER: PurchaseState[] = ['declined', 'failed', 'canceled', 'unpaid'];
/** A freeze begun before the missed day ended, and not here yet, would mend it. Nobody should pay for both. */
export const mayCover = (purchase: Purchase, offer: WinBack): boolean =>
  !isOver(purchase) && purchase.beganAt !== null && purchase.beganAt < Date.parse(offer.closesAt) - WIN_BACK_MS;

/** No money was taken, and it can be put away. */
export const isOver = (purchase: Purchase): boolean => OVER.includes(purchase.state);

/** It is about the break that is on offer, and not an earlier one. */
export const isFor = (payment: Payment | null, offer: WinBack | null): boolean => payment !== null && payment.missedDay === offer?.missedDay;

export type Notice = { id: string; text: string };

export type Saved = {
  plays: Record<string, Play>;
  outbox: OutboxItem[];
  seen: Record<string, true>; // reveals that were shown to the end
  notices: Notice[];
  payment: Payment | null;
  purchases: Purchase[];
  told: string[] | null; // freezes used or given back that were told about. Null: nothing is known on this phone yet
};

export const emptySaved = (): Saved => ({ plays: {}, outbox: [], seen: {}, notices: [], payment: null, purchases: [], told: null });

export const isFinished = (play: Play | undefined): boolean => play !== undefined && play.answers.length === CARDS;
const ends = (challenge: Challenge) => Date.parse(challenge.endsAt);

/** Begun on its own day and not finished: it may still be finished for a while. */
export function isHeldOpen(play: Play, now: number): boolean {
  const end = ends(play.challenge);
  return play.begunAt !== null && play.begunAt < end && !isFinished(play) && now <= end + GRACE_MS;
}

/**
 * May the app make a call that counts as contact? Not while a challenge from a day that has
 * ended is here, finished but unsent, or begun but unfinished up to 60 minutes after.
 */
export function mayContact(saved: Saved, now: number): boolean {
  for (const item of saved.outbox) {
    if (item.kind === 'complete' && now >= item.endsAt - EDGE_MS && now <= item.endsAt + OFFLINE_MS) return false;
  }
  for (const play of Object.values(saved.plays)) {
    if (now >= ends(play.challenge) - EDGE_MS && isHeldOpen(play, now)) return false;
  }
  return true;
}

/** What the app waits for before it may ask the server anything else. */
export function waitsFor(saved: Saved, now: number): 'finish' | 'send' | null {
  if (mayContact(saved, now)) return null;
  const open = Object.values(saved.plays).some((play) => now >= ends(play.challenge) - EDGE_MS && isHeldOpen(play, now));
  return open ? 'finish' : 'send';
}

/** When the answer to "what to show" can change by itself. */
export function nextChange(saved: Saved, today: Today | null, now: number): number | null {
  const times: number[] = [];
  for (const challenge of [today?.challenge, today?.tomorrow]) {
    if (challenge) times.push(Date.parse(challenge.startsAt), ends(challenge));
  }
  if (today?.winBack) times.push(Date.parse(today.winBack.closesAt));
  for (const play of Object.values(saved.plays)) if (isHeldOpen(play, now)) times.push(ends(play.challenge) + GRACE_MS + 1);
  const ahead = times.filter((time) => time > now);
  return ahead.length ? Math.min(...ahead) : null;
}

export type Reveal = {
  challengeId: string;
  day: string;
  card: Card | null; // null: owns every card
  score: number | null;
  saved: boolean; // the server has it
};

/** The reveal on the screen. Seen: it was shown to the end on this phone. */
export type Open = { reveal: Reveal; seen: boolean };

export type View =
  | { kind: 'empty' } // nothing on the phone covers now
  | { kind: 'challenge'; challenge: Challenge; answers: Rarity[]; lateUntil: number | null; waiting: Reveal | null }
  | { kind: 'reveal'; reveal: Reveal }
  | { kind: 'done'; challenge: Challenge; card: Card | null; saved: boolean; nextAt: number };

function localScore(play: Play): number {
  return play.challenge.cards.filter((card, i) => card.rarity === play.answers[i]).length;
}

function revealOf(play: Play): Reveal {
  return {
    challengeId: play.challenge.id,
    day: play.challenge.day,
    card: play.accepted ? play.accepted.card : play.challenge.reward,
    score: play.accepted?.score ?? localScore(play),
    saved: play.accepted !== null,
  };
}

/** Finished, but only in memory: not on disk and not with the server. Nothing is revealed until it is safe. */
const isUnsafe = (play: Play | undefined, unsaved: boolean): boolean => unsaved && isFinished(play) && play!.accepted === null;

/** Reveals not yet shown to the end, oldest first. */
export function pendingReveals(saved: Saved, today: Today | null, unsaved = false): Reveal[] {
  const found = new Map<string, Reveal>();
  for (const unseen of today?.unseenReveals ?? []) {
    found.set(unseen.challengeId, { challengeId: unseen.challengeId, day: unseen.day, card: unseen.card, score: null, saved: true });
  }
  for (const play of Object.values(saved.plays)) if (isFinished(play) && !isUnsafe(play, unsaved)) found.set(play.challenge.id, revealOf(play));
  return [...found.values()].filter((reveal) => !saved.seen[reveal.challengeId]).sort((a, b) => a.day.localeCompare(b.day));
}

export function findReveal(saved: Saved, today: Today | null, challengeId: string): Reveal | null {
  const play = saved.plays[challengeId];
  if (play && isFinished(play)) return revealOf(play);
  const unseen = today?.unseenReveals.find((one) => one.challengeId === challengeId);
  return unseen ? { challengeId, day: unseen.day, card: unseen.card, score: null, saved: true } : null;
}

/** The one place that decides what Today shows. `gone`: what the server said it does not have is never shown. */
export function whatToShow(saved: Saved, today: Today | null, now: number, open: Open | null, unsaved = false, gone: ReadonlySet<string> = new Set()): View {
  if (open) {
    // The newest word on it. Once it was seen here the server stops listing it, and it stays until it is
    // closed. Not listed and still sealed: it was seen on another phone.
    const reveal = findReveal(saved, today, open.reveal.challengeId) ?? (open.seen ? open.reveal : null);
    if (reveal) return { kind: 'reveal', reveal };
  }
  const waiting = pendingReveals(saved, today, unsaved);

  // Yesterday's, if it was begun in time. Also one the server knows was begun, on another phone.
  const held = Object.values(saved.plays).find((play) => now >= ends(play.challenge) && isHeldOpen(play, now));
  const resume = held?.challenge ?? today?.resume ?? null;
  if (resume && !gone.has(resume.id) && now >= ends(resume) && now <= ends(resume) + GRACE_MS && !isFinished(saved.plays[resume.id])) {
    const answers = saved.plays[resume.id]?.answers ?? [];
    return { kind: 'challenge', challenge: resume, answers, lateUntil: ends(resume) + GRACE_MS, waiting: waiting[0] ?? null };
  }

  const current = [today?.challenge, today?.tomorrow].find(
    (challenge) => challenge && !gone.has(challenge.id) && Date.parse(challenge.startsAt) <= now && now < ends(challenge),
  );
  if (!current) return { kind: 'empty' };
  const play = saved.plays[current.id];
  if (!current.completedAt && (!isFinished(play) || isUnsafe(play, unsaved))) {
    return { kind: 'challenge', challenge: current, answers: play?.answers ?? [], lateUntil: null, waiting: waiting[0] ?? null };
  }
  if (waiting[0]) return { kind: 'reveal', reveal: waiting[0] };
  const card = play?.accepted ? play.accepted.card : current.reward;
  return { kind: 'done', challenge: current, card, saved: Boolean(current.completedAt || play?.accepted), nextAt: ends(current) };
}
