import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { Api, Refused, Unreachable } from '../core/api';
import { Engine } from '../core/engine';
import { LoginKeeper } from '../core/login';
import type { User } from '../core/types';
import { API_URL, TEST_ACCOUNTS } from './config';
import { prefetchBundle } from './images';
import { pictures } from './pictures';
import { storage } from './storage';
import { store } from './store';

export type Session =
  | { status: 'loading' }
  | { status: 'out'; email: string; message: string | null }
  | { status: 'in'; user: User; engine: Engine };

const KEY = 'session';
const LAST_EMAIL = 'last-email';
export const api = new Api({ baseUrl: API_URL, fetch: (...args) => fetch(...args), now: Date.now });

let session: Session = { status: 'loading' };
const listeners = new Set<() => void>();

function set(next: Session): void {
  session = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function useSession(): Session {
  return useSyncExternalStore(subscribe, () => session);
}

/** On a full phone this holds for as long as the app is open, and is kept when there is space. */
const login = new LoginKeeper(
  storage,
  {
    get: () => SecureStore.getItemAsync(KEY),
    set: (text) => SecureStore.setItemAsync(KEY, text, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
    remove: () => SecureStore.deleteItemAsync(KEY),
  },
  () => Crypto.randomUUID(),
);

function enter(user: User, token: string): void {
  api.startSession(token);
  const engine = new Engine({
    api,
    storage,
    user,
    store,
    newId: () => Crypto.randomUUID(),
    local: Date.now,
    onSignedOut: () => void leave('Your session ended. Log in again to carry on. Nothing on this phone was lost.'),
    onBundle: prefetchBundle,
    onOnline: () => pictures.retry(),
  });
  set({ status: 'in', user, engine });
  void engine.sync();
}

async function leave(message: string | null): Promise<void> {
  if (session.status === 'in') session.engine.stop();
  api.endSession();
  set({ status: 'out', email: storage.get(LAST_EMAIL) ?? '', message });
  // What is unsent stays on the phone, and is sent when the same account logs in again.
  await login.forget();
}

/** Once, when the app opens. Works with no connection. */
export async function restore(): Promise<void> {
  try {
    const kept = await login.restore();
    if (kept) return enter(kept.user, kept.token);
    set({ status: 'out', email: storage.get(LAST_EMAIL) ?? '', message: null });
  } catch {
    set({ status: 'out', email: storage.get(LAST_EMAIL) ?? '', message: 'This phone could not read your saved login. Log in again.' });
  }
}

async function open(path: '/auth/login' | '/auth/signup', body: object): Promise<void> {
  const { data } = await api.call<{ token: string; user: User }>('POST', path, body);
  storage.set(LAST_EMAIL, data.user.email);
  await login.keep(data);
  enter(data.user, data.token);
}

export function logIn(email: string, password: string): Promise<void> {
  return open('/auth/login', { email: email.trim(), password, deviceId: login.deviceId() });
}

export function signUp(email: string, password: string): Promise<void> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return open('/auth/signup', { email: email.trim(), password, timezone, deviceId: login.deviceId() });
}

export async function logOut(): Promise<void> {
  if (session.status !== 'in') return;
  // The server is told if it can be reached. The phone logs out either way.
  await api.call('POST', '/auth/logout').catch(() => {});
  await leave(null);
}

export const isTestAccount = (user: User): boolean => TEST_ACCOUNTS.includes(user.email);

/** What to tell someone about a failed log in. */
export function explain(err: unknown): string {
  if (err instanceof Refused) return err.code === 'bad_request' ? 'Check the email and password, and try again.' : err.message;
  if (err instanceof Unreachable && err.kind === 'server') return 'Pullday is having trouble. Try again in a moment.';
  if (err instanceof Unreachable) return "Can't reach Pullday. Check your connection and try again.";
  return 'Something went wrong. Try again.';
}

// Coming back to the app, or back online, is when to send and refresh.
AppState.addEventListener('change', (state) => {
  if (state !== 'active' || session.status !== 'in') return;
  void login.retry();
  session.engine.wake();
});
Network.addNetworkStateListener(({ isConnected, isInternetReachable, type }) => {
  if (session.status !== 'in') return;
  const news = session.engine.network({ connected: isConnected === true, reachable: isInternetReachable === true, kind: type ?? 'UNKNOWN' });
  if (news) pictures.retry();
});
