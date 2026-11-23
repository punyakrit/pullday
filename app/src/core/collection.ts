import type { OwnedCard } from './engine';
import type { Saved } from './state';
import type { Card } from './types';

export type Catalogue = { list: Card[]; byId: Map<string, Card> };

/** "008" before "106", "SM94" by its number, and the ones without a number last. */
function order(number: string | null): number {
  const digits = number?.replace(/\D+/g, '');
  return digits ? Number(digits) : Number.MAX_SAFE_INTEGER;
}

/**
 * In the order of a binder: set by set, by number. The server's order is by chance. Compared as plain
 * text, because a comparison that knows languages is slow on a phone, 2,000 cards at a time.
 */
export function catalogueOf(cards: Card[]): Catalogue {
  const list = [...cards].sort(
    (a, b) =>
      (a.set < b.set ? -1 : a.set > b.set ? 1 : 0) ||
      order(a.number) - order(b.number) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
      (a.id < b.id ? -1 : 1),
  );
  return { list, byId: new Map(cards.map((card) => [card.id, card])) };
}

/**
 * The cards that are yours, newest first. One finished offline is yours already. One whose reveal was not
 * seen to the end is still a surprise, so it stays grey.
 */
export function ownedNow(owned: OwnedCard[] | null, saved: Saved): OwnedCard[] {
  const plays = Object.values(saved.plays);
  const seen = (id: string) => saved.seen[id] === true;
  const known = new Set((owned ?? []).map((one) => one.cardId));
  const offline = plays
    .filter((play) => play.accepted === null && seen(play.challenge.id) && play.challenge.reward && !known.has(play.challenge.reward.id))
    .map((play): OwnedCard => ({ cardId: play.challenge.reward!.id, acquiredAt: '', revealSeenAt: 'here' }));
  const given = (wanted: boolean) =>
    new Set(plays.flatMap((play) => (play.accepted?.card && seen(play.challenge.id) === wanted ? [play.accepted.card.id] : [])));
  const hidden = given(false);
  const justSeen = given(true);
  return [...offline, ...(owned ?? []).filter((one) => !hidden.has(one.cardId) && (one.revealSeenAt !== null || justSeen.has(one.cardId)))];
}
