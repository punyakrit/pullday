import { space } from '../ui/theme';
import { type ImageWidth, gridSize } from './images';

export const GAP = 10;

/** A tablet or a wide window gets more columns, not bigger cards. */
export function gridFor(width: number): { columns: number; cell: number; size: ImageWidth } {
  const columns = Math.max(3, Math.floor(width / 150));
  const cell = Math.floor((width - space.l * 2 - GAP * (columns - 1)) / columns);
  return { columns, cell, size: gridSize(cell) };
}
