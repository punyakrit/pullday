import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { LoginKeeper, type Secure, readLogin } from '../src/core/login';
import { MemoryStorage, USER } from './fakes';

const LOGIN = { token: 't', user: USER };

/** A phone: the app's own data, the secure store, and how full it is. */
class Phone {
  storage = new MemoryStorage();
  text: string | null = null;
  secureFull = false;
  made = 0;
  slow: (() => void)[] | null = null;
  secure: Secure = {
    get: async () => this.text,
    set: async (text) => {
      if (this.slow) await new Promise<void>((go) => this.slow!.push(go));
      if (this.secureFull) throw new Error('no space');
      this.text = text;
    },
    remove: async () => void (this.text = null),
  };
  start = () => new LoginKeeper(this.storage, this.secure, () => `device-${++this.made}`);
  deleteApp(): void {
    this.storage = new MemoryStorage(); // on iOS the secure store stays
  }
}

describe('the kept login', () => {
  test('after a restart or an update it is still there, on the same device', async () => {
    const phone = new Phone();
    const first = phone.start();
    await first.keep(LOGIN);
    const again = phone.start();
    const kept = await again.restore();
    assert.deepEqual([kept?.token, kept?.user.id], ['t', USER.id]);
    assert.equal(again.deviceId(), 'device-1');
    assert.equal(phone.made, 1);
  });

  test('the app was deleted and installed again: the login that stayed behind is removed', async () => {
    const phone = new Phone();
    await phone.start().keep(LOGIN);
    phone.deleteApp();
    const again = phone.start();
    assert.equal(await again.restore(), null);
    assert.equal(phone.text, null);
    assert.equal(again.deviceId(), 'device-2');
  });

  test('a login from before it carried the device id', () => {
    const text = JSON.stringify(LOGIN);
    assert.equal(readLogin(text, 'device-1')?.device, 'device-1');
    assert.equal(readLogin(text, null), null);
  });

  test('damaged, or from another install', () => {
    for (const text of ['', '{', 'null', '[]', '{"token":"t"}', '{"token":1,"user":{}}', '{"token":"t","user":{"id":"a"}}']) {
      assert.equal(readLogin(text, 'device-1'), null);
    }
    assert.equal(readLogin(JSON.stringify({ ...LOGIN, device: 'device-9', loose: false }), 'device-1'), null);
    assert.equal(readLogin(JSON.stringify({ ...LOGIN, device: 'device-9', loose: true }), 'device-1'), null);
  });
});

describe('a login on a full phone', () => {
  test('no space for the device id: still logged in after a restart, same device, and kept once there is space', async () => {
    const phone = new Phone();
    phone.storage.full = true;
    await phone.start().keep(LOGIN);
    const second = phone.start();
    assert.equal((await second.restore())?.token, 't');
    assert.equal(second.deviceId(), 'device-1');
    await second.retry(); // still full
    phone.storage.full = false;
    await second.retry();
    assert.equal(phone.storage.get('device'), 'device-1');
    // From here it is an ordinary login: deleting the app ends it.
    assert.equal((await phone.start().restore())?.token, 't');
    phone.deleteApp();
    assert.equal(await phone.start().restore(), null);
  });

  test('no space in the secure store either: logged in for now, and kept once there is space', async () => {
    const phone = new Phone();
    phone.storage.full = phone.secureFull = true;
    const keeper = phone.start();
    await keeper.keep(LOGIN); // does not throw
    assert.equal(phone.text, null);
    assert.equal(keeper.deviceId(), 'device-1');
    assert.equal(keeper.deviceId(), 'device-1'); // the same for a second log in
    phone.storage.full = phone.secureFull = false;
    await keeper.retry();
    assert.equal((await phone.start().restore())?.token, 't');
  });

  test('logged out before there was space: it is not kept after all', async () => {
    const phone = new Phone();
    phone.secureFull = true;
    const keeper = phone.start();
    await keeper.keep(LOGIN);
    await keeper.forget();
    phone.secureFull = false;
    await keeper.retry();
    assert.equal(phone.text, null);
  });

  test('a slow write cannot bring back a login that was removed', async () => {
    const phone = new Phone();
    phone.slow = [];
    const keeper = phone.start();
    const keeping = keeper.keep(LOGIN);
    await new Promise((go) => setImmediate(go));
    const forgetting = keeper.forget();
    phone.slow.forEach((go) => go());
    await Promise.all([keeping, forgetting]);
    assert.equal(phone.text, null);
  });
});
