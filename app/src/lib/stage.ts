import { useSyncExternalStore } from 'react';

/** Is the reveal on? Then everything around it is dark too: the tab bar and the system's own bars. */
let dark = false;
const listeners = new Set<() => void>();

export function setStage(on: boolean): void {
  if (dark === on) return;
  dark = on;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useStage = () => useSyncExternalStore(subscribe, () => dark);
