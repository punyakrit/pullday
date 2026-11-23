import { useEffect, useState } from 'react';
import type { Engine } from '../core/engine';
import { CATALOGUE, readRow, writeRow } from '../core/rows';
import type { Card } from '../core/types';
import { storage } from './storage';

const CARDS = 'catalogue';
const ETAG = 'catalogue-etag';
let byId: Map<string, Card> | null = null;

function read(): Map<string, Card> | null {
  if (byId) return byId;
  const cards = readRow(storage, CARDS, CATALOGUE).value; // not usable: downloaded again
  if (cards) byId = new Map(cards.map((card) => [card.id, card]));
  return byId;
}

/** Every card, downloaded once and kept. Asked about again only to see if it changed. */
export function useCatalogue(engine: Engine): Map<string, Card> | null {
  const [cards, setCards] = useState(read);
  useEffect(() => {
    let live = true;
    const etag = byId ? storage.get(ETAG) : null;
    engine
      .get<{ cards: Card[] }>('/catalogue', etag ? { 'if-none-match': etag } : {})
      .then((reply) => {
        if (reply.notModified) return;
        byId = new Map(reply.data.cards.map((card) => [card.id, card]));
        const kept = writeRow(storage, CARDS, CATALOGUE, reply.data.cards);
        if (kept && reply.etag) storage.set(ETAG, reply.etag); // never the new mark on the old cards
        if (live) setCards(byId);
      })
      .catch(() => {}); // what is on the phone is still good
    return () => {
      live = false;
    };
  }, [engine]);
  return cards;
}
