import type { Engine } from './engine';
import { type Kind, readRow, writeRow } from './rows';
import type { Card, Storage } from './types';

export type Price = { date: string; priceCents: number };

/** What the server knows about a card, apart from what is on every card in the catalogue. */
export type Details = {
  id: string;
  grader: string;
  certNumber: string;
  priceCents: number;
  population: number;
  story: string;
  priceHistory: Price[]; // oldest first
  priceDate: string | null; // of the last price
};

const isText = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPrice = (value: unknown): value is Price => {
  const { date, priceCents } = (value ?? {}) as Partial<Price>;
  return isText(date) && Number.isFinite(Date.parse(date)) && isNumber(priceCents);
};

export const DETAILS: Kind<Details> = {
  upgrades: [(old) => old],
  check: (value): value is Details => {
    if (typeof value !== 'object' || value === null) return false;
    const it = value as Partial<Details>;
    return (
      isText(it.id) &&
      isText(it.grader) &&
      isNumber(it.priceCents) &&
      isNumber(it.population) &&
      isText(it.story) &&
      Array.isArray(it.priceHistory) &&
      it.priceHistory.every(isPrice) &&
      (it.priceDate === null || isText(it.priceDate))
    );
  },
};

const keyOf = (id: string) => `card:${id}`;

/** From the last time it was opened. The same for everyone on this phone: nothing about the owner is in it. */
export const keptDetails = (storage: Storage, id: string): Details | null => readRow(storage, keyOf(id), DETAILS).value;

/**
 * Only ever through engine.get: this is a call that counts as the phone having been online, and a card
 * opened at 12:02am must not cost someone the day they finished on a plane.
 */
export async function fetchDetails(engine: Engine, storage: Storage, id: string): Promise<Details> {
  const { data } = await engine.get<Details & Partial<Card>>(`/cards/${id}`);
  const { grader, certNumber, priceCents, population, story, priceHistory, priceDate } = data;
  const details: Details = { id, grader, certNumber, priceCents, population, story, priceHistory, priceDate };
  if (!DETAILS.check(details)) throw new Error('not a card');
  writeRow(storage, keyOf(id), DETAILS, details);
  return details;
}
