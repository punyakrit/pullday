import * as Crypto from 'expo-crypto';
import { useSyncExternalStore } from 'react';
import { FakeStore } from '../core/store';
import { storage } from './storage';

/** One for the phone, like the real one. */
export const store = new FakeStore({ storage, newId: () => Crypto.randomUUID() });

export const useStoreSheet = () => useSyncExternalStore(store.subscribe, store.getSheet);
