import { CARDS, type Saved } from './state';
import type { OwnedCard } from './engine';
import type { Card, Challenge, Storage, Today, User } from './types';

/**
 * One kind of row on the phone. Its version is how many upgrades it has.
 *
 * When the shape changes, add an upgrade from the shape before, and never edit an old one: some phone
 * still has it. Even for what could be fetched again. An update installed overnight is first opened
 * on the plane.
 */
export type Kind<T> = {
  upgrades: ((old: unknown) => unknown)[]; // upgrades[n] makes version n + 1 out of version n
  check: (value: unknown) => value is T;
};

/** Never throws. `unusable`: there is a row, but it is damaged, or from a newer app than this one. */
export function readRow<T>(storage: Storage, key: string, kind: Kind<T>): { value: T | null; unusable: boolean } {
  const text = storage.get(key);
  if (text === null) return { value: null, unusable: false };
  try {
    const row: unknown = JSON.parse(text);
    const versioned = isObject(row) && typeof row.version === 'number' && 'value' in row;
    let version = versioned ? (row.version as number) : 0; // 0: from before rows had versions
    let value = versioned ? row.value : row;
    if (version <= kind.upgrades.length) {
      for (; version < kind.upgrades.length; version++) value = kind.upgrades[version]!(value);
      if (kind.check(value)) return { value, unusable: false };
    }
  } catch {
    // not JSON, or an upgrade could not make sense of it
  }
  return { value: null, unusable: true };
}

/** False: it could not be written. */
export function writeRow<T>(storage: Storage, key: string, kind: Kind<T>, value: T): boolean {
  return storage.set(key, JSON.stringify({ version: kind.upgrades.length, value }));
}

// What each row must be for the rest of the app not to trip over it.

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isTime = (value: unknown): boolean => isText(value) && Number.isFinite(Date.parse(value));
const isList = (value: unknown, check: (one: unknown) => boolean): boolean => Array.isArray(value) && value.every(check);
const isRarity = (value: unknown): boolean => value === 'common' || value === 'rare' || value === 'holo';

const isCard = (value: unknown): value is Card => isObject(value) && isText(value.id) && isText(value.name) && isRarity(value.rarity);
const isCardOrNone = (value: unknown): boolean => value === null || isCard(value);

const isChallenge = (value: unknown): value is Challenge =>
  isObject(value) &&
  isText(value.id) &&
  isText(value.day) &&
  isTime(value.startsAt) &&
  isTime(value.endsAt) &&
  isList(value.cards, isCard) &&
  (value.cards as unknown[]).length === CARDS &&
  isCardOrNone(value.reward);

const isPlay = (value: unknown): boolean =>
  isObject(value) &&
  isChallenge(value.challenge) &&
  (value.begunAt === null || isNumber(value.begunAt)) &&
  isList(value.answers, isRarity) &&
  (value.answers as unknown[]).length <= CARDS &&
  (value.accepted === null || (isObject(value.accepted) && isCardOrNone(value.accepted.card)));

const isOutboxItem = (value: unknown): boolean =>
  isObject(value) &&
  isText(value.challengeId) &&
  isNumber(value.endsAt) &&
  (value.kind === 'start' || value.kind === 'reveal-seen' || (value.kind === 'complete' && isList(value.answers, isRarity)));

const same = (old: unknown) => old;

/** What was played and is unsent. The only row that cannot be fetched again. */
export const SAVED: Kind<Saved> = {
  upgrades: [same],
  check: (value): value is Saved =>
    isObject(value) &&
    isObject(value.plays) &&
    Object.values(value.plays).every(isPlay) &&
    isList(value.outbox, isOutboxItem) &&
    isObject(value.seen) &&
    isList(value.notices, (one) => isObject(one) && isText(one.id) && isText(one.text)),
};

export const TODAY: Kind<Today> = {
  upgrades: [same],
  check: (value): value is Today =>
    isObject(value) &&
    isText(value.day) &&
    isTime(value.endsAt) &&
    isNumber(value.streak) &&
    isChallenge(value.challenge) &&
    isChallenge(value.tomorrow) &&
    (value.resume === null || isChallenge(value.resume)) &&
    isList(value.unseenReveals, (one) => isObject(one) && isText(one.challengeId) && isText(one.day) && isCard(one.card)),
};

export const OWNED: Kind<OwnedCard[]> = {
  upgrades: [same],
  check: (value): value is OwnedCard[] => isList(value, (one) => isObject(one) && isText(one.cardId)),
};

export const CATALOGUE: Kind<Card[]> = {
  upgrades: [same],
  check: (value): value is Card[] => isList(value, isCard),
};

export const CLOCK: Kind<{ offset: number; floor: number }> = {
  upgrades: [same],
  check: (value): value is { offset: number; floor: number } => isObject(value) && isNumber(value.offset) && isNumber(value.floor),
};

export type Login = { token: string; user: User };

/**
 * The login kept in the secure store, if it is still this install's. iOS keeps that store when an app
 * is deleted, so a login can be there with nothing else. The device id is made at the first log in
 * and goes with the app: without it, the login is from an app that was deleted.
 */
export function readLogin(text: string | null, device: string | null): Login | null {
  if (text === null || device === null) return null;
  try {
    const login: unknown = JSON.parse(text);
    if (!isObject(login) || !isText(login.token) || !isObject(login.user)) return null;
    const { id, email } = login.user;
    return isText(id) && isText(email) ? (login as Login) : null;
  } catch {
    return null;
  }
}
