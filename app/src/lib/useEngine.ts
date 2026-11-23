import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Engine, Snapshot } from '../core/engine';

export function useEngine(engine: Engine): Snapshot {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}

/** Looks again by itself when a day ends or a late challenge closes. */
export function useDayTimer(engine: Engine, snapshot: Snapshot): void {
  useEffect(() => {
    const at = engine.nextChange();
    if (at === null) return;
    const wait = Math.min(Math.max(at - engine.clock.now(), 0) + 50, 2 ** 31 - 1);
    const timer = setTimeout(() => {
      engine.refreshView();
      void engine.sync();
    }, wait);
    return () => clearTimeout(timer);
  }, [engine, snapshot]);
}

/** The server's time, ticking, for a countdown. */
export function useServerNow(engine: Engine, everyMs: number): number {
  const [now, setNow] = useState(() => engine.clock.now());
  useEffect(() => {
    setNow(engine.clock.now());
    const timer = setInterval(() => setNow(engine.clock.now()), everyMs);
    return () => clearInterval(timer);
  }, [engine, everyMs]);
  return now;
}
