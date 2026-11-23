import type { Rarity } from '../core/types';

/** How far counts, as a share of the deck. Reached by distance, by a quick flick, or a bit of both. */
export const SIDE = 0.2;
export const UP = 0.13;
const FLICK = 0.1; // seconds of the finger's speed added to the distance

export type Pull = { left: number; right: number; up: number };

/** How strongly a drag points each way. 1 or more means letting go now will throw it. */
export function pull(x: number, y: number, width: number, height: number): Pull {
  'worklet';
  const side = Math.abs(x) / (width * SIDE);
  const up = -y / (height * UP);
  return {
    left: x < 0 && side >= up ? side : 0,
    right: x > 0 && side >= up ? side : 0,
    up: up > 0 && up > side ? up : 0,
  };
}

/**
 * The finger's speed when it lifts. Android says 0 when it saw only a few touch points, which is
 * what a fast flick on a slow phone looks like, so a short gesture also gets its average speed.
 */
export function liftSpeed(reported: number, moved: number, elapsedMs: number): number {
  'worklet';
  if (elapsedMs <= 0 || elapsedMs > 350 || Math.abs(moved) < 22) return reported;
  let average = (moved / elapsedMs) * 1000;
  if (reported * average < 0) return reported; // it turned round before lifting
  // A quarter of a second and the width of a fingertip is a flick, however gentle.
  if (elapsedMs <= 250) average = Math.sign(moved) * Math.max(Math.abs(average), 700);
  return Math.abs(average) > Math.abs(reported) ? average : reported;
}

/** Where the card goes if it is let go now, or null to come back. */
export function decide(x: number, y: number, vx: number, vy: number, width: number, height: number): Rarity | null {
  'worklet';
  const going = pull(x + vx * FLICK, y + vy * FLICK, width, height);
  // A flick back the way it came is a change of mind.
  if (going.left >= 1 && x <= 4) return 'common';
  if (going.right >= 1 && x >= -4) return 'rare';
  if (going.up >= 1 && y <= 4) return 'holo';
  return null;
}
