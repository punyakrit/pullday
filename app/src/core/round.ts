import { CARDS, type View } from './state';

/** One deck on the screen. The key changes when the deck must start over. */
export type Round = { key: string; id: string; answers: number; number: number };

export const FIRST: Round = { key: '', id: '', answers: 0, number: 0 };

/**
 * A deck keeps its own answers, so that a swipe waits for nothing. So when the saved ones are taken away,
 * it must be told: also when it is the same challenge, and also when its reveal was taken back.
 */
export function roundOf(before: Round, view: View): Round {
  if (view.kind === 'reveal' && view.reveal.challengeId === before.id) return before.answers === CARDS ? before : { ...before, answers: CARDS };
  if (view.kind !== 'challenge') return before;
  const { id } = view.challenge;
  const answers = view.answers.length;
  const number = id === before.id && answers < before.answers ? before.number + 1 : before.number;
  if (id === before.id && answers === before.answers) return before;
  return { key: `${id}:${number}`, id, answers, number };
}
