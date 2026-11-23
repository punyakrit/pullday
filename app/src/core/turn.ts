import type { Reveal } from './state';
import type { Card } from './types';

/** A reveal that has a card in it. */
export type CardReveal = Reveal & { card: Card };

/** How far the reveal has got, and the one it is turning over. */
export type Turn =
  | { stage: 'sealed' | 'pulled'; drawn: null } //
  | { stage: 'turning' | 'open'; drawn: CardReveal };

export type TurnEvent =
  | { kind: 'pull' }
  | { kind: 'ready'; reveal: CardReveal } // its picture is decoded
  | { kind: 'face' }
  | { kind: 'reset' };

export const SEALED: Turn = { stage: 'sealed', drawn: null };

/**
 * The server may name another card until this one starts to turn. From then on it is kept: a reply
 * that lands while it turns, or while it is face up, cannot change it or start the turn again.
 */
export function step(turn: Turn, event: TurnEvent): Turn {
  switch (event.kind) {
    case 'pull':
      return turn.stage === 'sealed' ? { stage: 'pulled', drawn: null } : turn;
    case 'ready':
      return turn.stage === 'pulled' ? { stage: 'turning', drawn: event.reveal } : turn;
    case 'face':
      return turn.stage === 'turning' ? { stage: 'open', drawn: turn.drawn } : turn;
    case 'reset':
      return turn.stage === 'sealed' ? turn : SEALED;
  }
}

/** The picture we got, for which card, and whether the server had answered when we asked for it. */
export type Held<T> = { cardId: string; saved: boolean; image: T | null };
export type Picture<T> = { state: 'loading' } | { state: 'ready'; image: T } | { state: 'none' };

/**
 * A picture we have is never let go for the same card. One we could not get is worth asking for
 * again once the server has answered, because then there is a connection.
 */
export function pictureOf<T>(held: Held<T> | null, cardId: string | null, saved: boolean): Picture<T> {
  if (cardId === null) return { state: 'none' };
  if (held?.cardId !== cardId) return { state: 'loading' };
  if (held.image !== null) return { state: 'ready', image: held.image };
  return held.saved === saved ? { state: 'none' } : { state: 'loading' };
}

/** What to say above the open card. The server gives another only if this one was already owned. */
export function wordsFor(drawn: Card, latest: Reveal): { title: string; line: string } {
  if (!latest.saved) return { title: 'Your new card', line: "It joins your collection when you're online" };
  if (latest.card?.id === drawn.id) return { title: 'Added to your collection', line: ' ' };
  return { title: 'You already had this card', line: latest.card ? `${latest.card.name} was added instead` : 'You own every card' };
}
