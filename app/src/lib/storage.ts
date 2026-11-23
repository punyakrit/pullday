import Storage from 'expo-sqlite/kv-store';
import type { Storage as Store } from '../core/types';

/** SQLite, synchronous: when set() returns, the row is on disk. */
export const storage: Store = {
  get: (key) => Storage.getItemSync(key),
  set: (key, value) => {
    try {
      Storage.setItemSync(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove: (key) => void Storage.removeItemSync(key),
};
