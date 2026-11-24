import { useEffect, useSyncExternalStore } from 'react';
import { CatalogueKeeper } from '../core/catalogue';
import type { Catalogue } from '../core/collection';
import type { Engine } from '../core/engine';
import { storage } from './storage';

const keeper = new CatalogueKeeper(storage);

/** After a sync: so the list is here before anyone is offline. */
export const ensureCatalogue = (engine: Engine): void => void keeper.ensure((path, headers) => engine.get(path, headers));

/** What is on the phone, and the moment it arrives. */
export const useCards = (): Catalogue | null => useSyncExternalStore(keeper.subscribe, keeper.now);

/** The same, and it is asked if it changed. Or, when there is none, whenever the connection changes. */
export function useCatalogue(engine: Engine, connection: string): Catalogue | null {
  const catalogue = useCards();
  const wanted = catalogue !== null || connection;
  useEffect(() => void keeper.refresh((path, headers) => engine.get(path, headers)), [engine, wanted]);
  return catalogue;
}
