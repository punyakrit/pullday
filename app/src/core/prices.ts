const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (cents: number): string => dollars.format(cents / 100);

/** A plain date from the server, never moved by the phone's time zone. */
export function dateText(date: string, length: 'long' | 'short' = 'long'): string {
  const at = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return at.toLocaleDateString(undefined, { day: 'numeric', month: length, timeZone: 'UTC', ...(length === 'long' ? { year: 'numeric' } : {}) });
}
