import { useCallback, useEffect, useState } from 'react';
import { type Details, fetchDetails, keptDetails } from '../core/details';
import type { Engine } from '../core/engine';
import { storage } from './storage';

/** What was kept from last time, then the newest. Asked for again by itself when the connection changes. */
export function useDetails(engine: Engine, id: string, connection: string, unsent: number) {
  const [details, setDetails] = useState<Details | null>(() => keptDetails(storage, id));
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [tries, setTries] = useState(0);
  const again = done || `${connection} ${unsent}`;

  useEffect(() => {
    if (done) return;
    let live = true;
    setLoading(true);
    fetchDetails(engine, storage, id)
      .then((fresh) => {
        if (!live) return;
        setDetails(fresh);
        setDone(true);
      })
      .catch(() => {}) // what was kept is still good. The screen says why there is nothing
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [again, done, engine, id, tries]);

  return { details, loading, retry: useCallback(() => setTries((n) => n + 1), []) };
}
