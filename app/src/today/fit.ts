import { CARD_RATIO } from '../ui/theme';

export type Space = { width: number; height: number };

/** In half a split screen there is no room for words above and below the card, so they go beside it. */
export const isShort = (space: Space): boolean => space.height > 0 && space.height < 400;

/**
 * How wide the card is in the space there is. `words` is the height of what is above and below it while
 * it is sealed. It goes by that and by the window only, so nothing that is written later resizes a card
 * in the middle of its turn. 0 until it is known.
 */
export function cardWidth(space: Space, words: { above: number; below: number }): number {
  if (space.height <= 0) return 0;
  const short = isShort(space);
  if (!short && (words.above <= 0 || words.below <= 0)) return 0;
  const room = short ? { width: space.width * 0.36, height: space.height } : { width: space.width * 0.68, height: space.height - words.above - words.below };
  return Math.floor(Math.max(Math.min(room.width, (room.height - 36) / CARD_RATIO), 48));
}
