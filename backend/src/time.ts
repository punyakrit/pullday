/** The one clock. Nothing else in src/ may read the time for a rule. */

type Clocked = { is_test: boolean; dev_offset_ms: number };

let realClock: () => number = Date.now;
let devTools = false;

export function enableDevOffset(on: boolean): void {
  devTools = on;
}

/** Tests only. */
export function setRealClock(clock: () => number): void {
  realClock = clock;
}

/** The time for this user. The offset only works for test accounts with dev tools on. */
export function now(user: Clocked): Date {
  const offset = devTools && user.is_test ? user.dev_offset_ms : 0;
  return new Date(realClock() + offset);
}

/** For a user who does not exist yet. */
export function nowForNewUser(): Date {
  return now({ is_test: false, dev_offset_ms: 0 });
}
