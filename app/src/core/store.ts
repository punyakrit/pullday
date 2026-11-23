import { type Kind, readRow, writeRow } from './rows';
import type { Storage } from './types';

/*
 * A fake app store. It stands in for the App Store or Play billing, so it knows nothing about Pullday: not the
 * server, not the freezes. Like a real one it
 * - shows its own sheet, and answers with bought, pending, failed or cancelled,
 * - keeps what it knows even if the app dies in the middle, and goes on with it when the app opens again,
 * - reports a pending purchase later, when someone has approved or declined it,
 * - hands over a purchase again and again until the app says it is finished with it.
 */

export const PRODUCT = { id: 'streak_freeze', name: 'Streak freeze', price: '$1.99' } as const;

export type Outcome = 'purchased' | 'pending' | 'failed' | 'canceled';

/** `token` is the app's own id for the purchase, `account` the Pullday account. The store only carries them. */
export type Transaction = {
  id: string;
  token: string;
  account: string;
  state: 'processing' | 'pending' | 'purchased' | 'declined';
  outcome: Outcome; // what processing will end in
};

/** The sheet that is on the screen. */
export type Sheet = { token: string; account: string; busy: boolean; resolve: (outcome: Outcome) => void };

const KEY = 'store';
const PROCESSING_MS = 1_200;

const ROWS: Kind<Transaction[]> = {
  upgrades: [(old) => old],
  check: (value): value is Transaction[] =>
    Array.isArray(value) && value.every((row) => row && typeof row.id === 'string' && typeof row.token === 'string' && typeof row.account === 'string'),
};

type Options = { storage: Storage; newId: () => string; setTimer?: (work: () => void, ms: number) => void };

export class FakeStore {
  private rows: Transaction[];
  private open: Sheet | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
    this.rows = readRow(options.storage, KEY, ROWS).value ?? [];
    for (const row of this.rows) if (row.state === 'processing') this.later(row.id); // the app died, the store did not
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getSheet = (): Sheet | null => this.open;

  /** Everything not finished yet, for one account. */
  transactions(account: string): Transaction[] {
    return this.rows.filter((row) => row.account === account);
  }

  /** Opens the sheet and waits for its answer. With an outcome (dev menu) it answers by itself. */
  purchase(token: string, account: string, outcome?: Outcome): Promise<Outcome> {
    if (this.open) return Promise.resolve('failed'); // one sheet at a time
    return new Promise((resolve) => {
      this.open = { token, account, busy: false, resolve };
      if (outcome === 'canceled') this.cancel();
      else if (outcome) this.pay(outcome);
      else this.tell();
    });
  }

  /** The button on the sheet. From here on the store goes on with it whatever happens to the app. */
  pay(outcome: Outcome = 'purchased'): void {
    if (!this.open || this.open.busy) return;
    const { token, account } = this.open;
    const row: Transaction = { id: `fake-${this.options.newId()}`, token, account, state: 'processing', outcome };
    if (!this.write([...this.rows, row])) return this.close('failed');
    this.open = { ...this.open, busy: true };
    this.later(row.id);
    this.tell();
  }

  cancel(): void {
    if (this.open && !this.open.busy) this.close('canceled');
  }

  /** Dev menu: what the parent, or the bank, says about the ones that wait. */
  decide(account: string, approved: boolean): number {
    const waiting = this.rows.filter((row) => row.account === account && row.state === 'pending').length;
    this.write(this.rows.map((row) => (row.account === account && row.state === 'pending' ? { ...row, state: approved ? 'purchased' : 'declined' } : row)));
    this.tell();
    return waiting;
  }

  /** The app has handed it out, or told the person it was declined. */
  finish(id: string): void {
    this.write(this.rows.filter((row) => row.id !== id));
    this.tell();
  }

  /** Dev menu: the account starts over. */
  forget(account: string): void {
    if (this.transactions(account).length === 0) return;
    this.write(this.rows.filter((row) => row.account !== account));
    this.tell();
  }

  private later(id: string): void {
    (this.options.setTimer ?? setTimeout)(() => {
      const row = this.rows.find((one) => one.id === id);
      if (row?.state !== 'processing') return;
      const { outcome } = row;
      const done = outcome === 'purchased' || outcome === 'pending';
      this.write(done ? this.rows.map((one) => (one.id === id ? { ...one, state: outcome } : one)) : this.rows.filter((one) => one.id !== id));
      if (this.open?.token === row.token) this.close(outcome);
      else this.tell();
    }, PROCESSING_MS);
  }

  private close(outcome: Outcome): void {
    const sheet = this.open;
    this.open = null;
    sheet?.resolve(outcome);
    this.tell();
  }

  private write(rows: Transaction[]): boolean {
    const before = this.rows;
    this.rows = rows;
    const kept = writeRow(this.options.storage, KEY, ROWS, rows);
    if (!kept && rows.length > before.length) this.rows = before; // a purchase that could not be kept never was
    return kept;
  }

  private tell(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
