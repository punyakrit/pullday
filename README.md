# Pullday

Sort eight cards a day, pull one, keep your streak.
This is a test app for a work trial. It is in no store, and no money is real.

## Quickest

Android: install the APK from the [latest release](https://github.com/punyakrit/pullday/releases/latest).

## Run it from a fresh clone

It talks to a hosted backend: nothing to set up. Times are from `git clone`, empty caches, on one fast Mac.

```bash
git clone https://github.com/punyakrit/pullday.git
cd pullday/app
npm ci
```

You need Node 22 or newer, and one of these:

**Android:** JDK 17 to 21, the Android SDK (`ANDROID_HOME` set), and one phone with USB debugging or one emulator. Measured: 8:55.

```bash
npm run android
```

For an emulator on an Intel computer: `ANDROID_ARCHS=x86_64 npm run android`.

**iOS simulator:** Xcode and CocoaPods. Measured: 8:54, mostly downloading pods. Tap Open if the simulator asks.

```bash
npm run ios
```

Both are release builds. `npm run dev:android` and `npm run dev:ios` reload as you edit.

## Test accounts

The log in screen has a button for each. The password is `pullday123`.

| Email | State |
| --- | --- |
| `new@pullday.test` | Brand new |
| `today@pullday.test` | 12 day streak, today not done |
| `done@pullday.test` | 30 day streak, today done |
| `freeze@pullday.test` | 7 day streak, missed yesterday, 1 freeze |
| `broken@pullday.test` | 40 day streak broke yesterday, win back open |
| `collector@pullday.test` | 300 cards, 5 binder pages |

Hosted accounts are shared, so someone may have played one. **Dev menu:** log in, tap the person icon on Today, scroll down. "Reset this account" puts one back. It also moves time and grants cards.

Win back takes Stripe test cards, with any later date and any CVC: `4242 4242 4242 4242` pays, `4000 0000 0000 0002` is declined, `4000 0027 6000 3184` asks for 3D Secure.

## Your own backend (optional)

You need Docker, running. From the top of the clone:

```bash
cd backend
cp .env.example .env
npm ci
npm run db:up
npm run seed
npm start
```

Measured: 8 seconds, with the Postgres image already there. Then point the app at it (2 minutes), in a second terminal, from the top of the clone:

```bash
cd app
cp .env.example .env
adb reverse tcp:4000 tcp:4000
npm run android
```

For iOS: no `adb`, and `npm run ios`. Delete `app/.env` and build again for the hosted one. Stripe keys, the API and the pictures are in [docs/BACKEND.md](docs/BACKEND.md).

## Tests

```bash
cd app && npm test
```

```bash
cd backend && npm test
```

The second needs `npm ci` and `npm run db:up` first.

## More

[DECISIONS.md](DECISIONS.md), [AI.md](AI.md), and [docs/](docs) for the long versions.
