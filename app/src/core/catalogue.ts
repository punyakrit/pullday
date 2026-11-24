import type { Reply } from './api';
import { type Catalogue, catalogueOf } from './collection';
import { CATALOGUE, readRow, writeRow } from './rows';
import type { Card, Storage } from './types';

const CARDS = 'catalogue';
const ETAG = 'catalogue-etag';

type Get = <T>(path: string, headers?: Record<string, string>) => Promise<Reply<T>>;

/** The list of every card, not the pictures. Downloaded once, kept, and the same for every account. */
export class CatalogueKeeper {
  private held: Catalogue | null = null;
  private running: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** What is on the phone. */
  now = (): Catalogue | null => {
    if (!this.held) {
      const cards = readRow(this.storage, CARDS, CATALOGUE).value; // not usable: downloaded again
      if (cards) this.held = catalogueOf(cards);
    }
    return this.held;
  };

  /** Only if there is none. */
  ensure(get: Get): Promise<void> {
    return this.now() ? Promise.resolve() : this.refresh(get);
  }

  /** Ask if it changed. Never throws: what is on the phone is still good. */
  refresh(get: Get): Promise<void> {
    this.running ??= this.ask(get)
      .catch(() => {})
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async ask(get: Get): Promise<void> {
    const etag = this.now() ? this.storage.get(ETAG) : null;
    const reply = await get<{ cards: Card[] }>('/catalogue', etag ? { 'if-none-match': etag } : {});
    if (reply.notModified) return;
    this.held = catalogueOf(reply.data.cards);
    const kept = writeRow(this.storage, CARDS, CATALOGUE, reply.data.cards);
    if (kept && reply.etag) this.storage.set(ETAG, reply.etag); // never the new mark on the old cards
    for (const listener of this.listeners) listener();
  }
}
