import type { Storage, User } from './types';

export type Login = { token: string; user: User };
type Kept = Login & { device: string; loose: boolean };

/** The phone's secure store, for one value. Any of these may fail. */
export type Secure = { get(): Promise<string | null>; set(text: string): Promise<void>; remove(): Promise<void> };

const DEVICE = 'device';
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * Is what the secure store holds this install's? iOS keeps that store when an app is deleted. The device
 * id is kept with the app's own data and goes with it, so without it the login is an old app's. Unless
 * the login is loose: there was no space to keep the device id.
 */
export function readLogin(text: string, device: string | null): Kept | null {
  try {
    const { token, user, device: made, loose } = JSON.parse(text) as Partial<Kept>;
    if (!isText(token) || !isText(user?.id) || !isText(user?.email)) return null;
    const kept = isText(made) ? made : device; // a login from before it carried the device id
    if (kept === null || (device === null ? loose !== true : device !== kept)) return null;
    return { token, user, device: kept, loose: device === null };
  } catch {
    return null;
  }
}

/**
 * The login, kept between starts. A full phone can refuse either write: then it holds for as long as
 * the app is open, and is kept as soon as there is space.
 */
export class LoginKeeper {
  private readonly storage: Storage;
  private readonly secure: Secure;
  private readonly newId: () => string;
  private device: string | null = null;
  private wanted: Kept | null = null; // what should be kept and is not yet
  private last: Promise<void> = Promise.resolve();

  constructor(storage: Storage, secure: Secure, newId: () => string) {
    this.storage = storage;
    this.secure = secure;
    this.newId = newId;
  }

  /** Made once per install. The server uses it to know this phone from another. */
  deviceId(): string {
    this.device ??= this.storage.get(DEVICE) ?? this.newId();
    return this.device;
  }

  async restore(): Promise<Login | null> {
    const text = await this.secure.get();
    if (text === null) return null;
    const login = readLogin(text, this.storage.get(DEVICE));
    if (!login) {
      await this.secure.remove();
      return null;
    }
    this.device = login.device;
    if (login.loose) this.wanted = login;
    return login;
  }

  keep({ token, user }: Login): Promise<void> {
    this.wanted = { token, user, device: this.deviceId(), loose: false };
    return this.retry();
  }

  /** There may be space again. Never throws. */
  retry(): Promise<void> {
    return this.inTurn(async () => {
      const login = this.wanted;
      if (!login) return;
      const loose = !this.storage.set(DEVICE, login.device);
      await this.secure.set(JSON.stringify({ ...login, loose }));
      if (!loose && this.wanted === login) this.wanted = null;
    });
  }

  forget(): Promise<void> {
    this.wanted = null;
    return this.inTurn(() => this.secure.remove());
  }

  /** One at a time, so a write that is late cannot bring back a login that was just removed. */
  private inTurn(work: () => Promise<void>): Promise<void> {
    this.last = this.last.then(work).catch(() => {});
    return this.last;
  }
}
