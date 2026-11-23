import type { Price } from './details';

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (cents: number): string => dollars.format(cents / 100);

/** A plain date from the server, never moved by the phone's time zone. */
export function dateText(date: string, length: 'long' | 'short' = 'long'): string {
  const at = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return at.toLocaleDateString(undefined, { day: 'numeric', month: length, timeZone: 'UTC', ...(length === 'long' ? { year: 'numeric' } : {}) });
}

/** The day of a moment, in the home time zone, like every other day here. */
export function dayOf(moment: string, zone: string | undefined): string {
  const options = { day: 'numeric', month: 'long', year: 'numeric' } as const;
  try {
    return new Date(moment).toLocaleDateString(undefined, { ...options, timeZone: zone });
  } catch {
    return new Date(moment).toLocaleDateString(undefined, options); // a zone this phone does not know
  }
}

export type Plot = {
  points: { x: number; y: number }[];
  low: number; // which point
  high: number;
  path: string;
  area: string;
};

/**
 * Where the line goes, in a box. Not from zero: 13 weeks of a price would be a flat line at the top. The
 * lowest and the highest are written beside it instead.
 */
export function plot(prices: Price[], width: number, height: number, inset: { x: number; y: number }): Plot | null {
  if (prices.length === 0 || width <= 0 || height <= 0) return null;
  const cents = prices.map((one) => one.priceCents);
  const low = cents.indexOf(Math.min(...cents));
  const high = cents.indexOf(Math.max(...cents));
  const range = cents[high]! - cents[low]!;
  const inside = { width: width - inset.x * 2, height: height - inset.y * 2 };
  const points = cents.map((value, i) => ({
    x: inset.x + (prices.length === 1 ? inside.width : (inside.width * i) / (prices.length - 1)),
    y: inset.y + inside.height * (range === 0 ? 0.5 : 1 - (value - cents[low]!) / range), // a price that never moved: the middle
  }));
  const path = points.map(({ x, y }, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const first = points[0]!;
  const last = points.at(-1)!;
  return { points, low, high, path, area: `${path}L${last.x.toFixed(1)} ${height}L${first.x.toFixed(1)} ${height}Z` };
}

/** The point nearest to a finger. */
export function nearest(points: { x: number }[], x: number): number {
  let best = 0;
  points.forEach((point, i) => {
    if (Math.abs(point.x - x) < Math.abs(points[best]!.x - x)) best = i;
  });
  return best;
}

/** Oldest first, whatever order it came in. */
export const inOrder = (prices: Price[]): Price[] => [...prices].sort((a, b) => a.date.localeCompare(b.date));

/** In words, for someone who cannot see the line. */
export function describePrices(prices: Price[]): string {
  const first = prices[0];
  const last = prices.at(-1);
  if (!first || !last) return 'No price history.';
  const cents = prices.map((one) => one.priceCents);
  return (
    `Price history, ${prices.length} weeks. From ${money(first.priceCents)} on ${dateText(first.date)} to ${money(last.priceCents)} on ${dateText(last.date)}. ` +
    `Lowest ${money(Math.min(...cents))}, highest ${money(Math.max(...cents))}.`
  );
}
