import { CLOCK, readRow, writeRow } from './rows';
import type { Storage } from './types';

/**
 * What time the server thinks it is, for showing and for choosing which bundle to play.
 * The server still decides everything: this only has to be honest when the phone is.
 */
export class ServerClock {
  private offset = 0;
  private floor = 0;
  private readonly storage: Storage;
  private readonly key: string;
  private readonly local: () => number;

  constructor(storage: Storage, key: string, local: () => number) {
    this.storage = storage;
    this.key = key;
    this.local = local;
    const saved = readRow(storage, key, CLOCK).value;
    if (saved) ({ offset: this.offset, floor: this.floor } = saved);
  }

  sync(serverTime: string, sentAt: number, receivedAt: number): void {
    this.floor = Date.parse(serverTime);
    this.offset = this.floor - (sentAt + receivedAt) / 2;
    writeRow(this.storage, this.key, CLOCK, { offset: this.offset, floor: this.floor });
  }

  reset(): void {
    this.offset = 0;
    this.floor = 0;
  }

  /** Never earlier than the last time the server told us. */
  now(): number {
    return Math.max(this.local() + this.offset, this.floor);
  }
}
