import { useEffect, useState } from 'react';
import { type Catalogue, catalogueOf } from '../core/collection';
import type { Engine } from '../core/engine';
import { CATALOGUE, readRow, writeRow } from '../core/rows';
import type { Card } from '../core/types';
import { storage } from './storage';

const CARDS = 'catalogue';
const ETAG = 'catalogue-etag';
let held: Catalogue | null = null;

function read(): Catalogue | null {
  if (!held) {
    const cards = readRow(storage, CARDS, CATALOGUE).value; // not usable: downloaded again
    if (cards) held = catalogueOf(cards);
  }
  return held;
}

/**
 * Every card, downloaded once and kept. Asked about again only to see if it changed, or when there was
 * none and the connection is back.
 */
export function useCatalogue(engine: Engine, connection: string): Catalogue | null {
  const [catalogue, setCatalogue] = useState(read);
  const wanted = catalogue !== null || connection; // once if it is here, with every change if it is not
  useEffect(() => {
    let live = true;
    const etag = held ? storage.get(ETAG) : null;
    engine
      .get<{ cards: Card[] }>('/catalogue', etag ? { 'if-none-match': etag } : {})
      .then((reply) => {
        if (reply.notModified) return;
        held = catalogueOf(reply.data.cards);
        const kept = writeRow(storage, CARDS, CATALOGUE, reply.data.cards);
        if (kept && reply.etag) storage.set(ETAG, reply.etag); // never the new mark on the old cards
        if (live) setCatalogue(held);
      })
      .catch(() => {}); // what is on the phone is still good
    return () => {
      live = false;
    };
  }, [engine, wanted]);
  return catalogue;
}

/** What is already here, for a screen that does not fetch it. */
export const cardOnPhone = (id: string): Card | null => read()?.byId.get(id) ?? null;
