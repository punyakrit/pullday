import Storage from 'expo-sqlite/kv-store';
import type { Storage as Store } from '../core/types';

/** SQLite, synchronous: when set() returns, the row is on disk. */
export const storage: Store = {
  get: (key) => Storage.getItemSync(key),
  set: (key, value) => Storage.setItemSync(key, value),
  remove: (key) => void Storage.removeItemSync(key),
};
