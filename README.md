# Pullday

A card collecting app built around a daily habit. This is a test app for a work trial. It is not a real product and is not in any store.

- `backend/` Node + TypeScript API on Postgres. Done for the daily loop. Payments and binder are not built yet.
- `app/` React Native + TypeScript, Expo SDK 58. The daily loop: log in, challenge, reveal, dev menu. The collection with every card, and card details. Measurements are in `docs/MEASUREMENTS.md`.
- `docs/PLAN.md` build order. `DECISIONS.md` what and why. `AI.md` how AI was used.

## Run the backend

You need Docker (running) and Node 22 or newer.

```bash
cd backend
cp .env.example .env
npm ci
npm run db:up
npm run seed
npm start
```

The API is now on `http://localhost:4000`. A phone on the same wifi reaches it on your computer's address, port 4000.

`npm run seed` creates the tables, loads the catalogue and puts all six test accounts in their starting state as of right now. Run it again any time, it is also the way to freshen accounts that were seeded days ago. It uses this computer's time zone. For another one: `npm run seed -- Europe/London`.

### Stripe test keys (only for win back)

Without them everything else works, and win back says payments are not set up.

1. Make a free account on [dashboard.stripe.com](https://dashboard.stripe.com) and stay in test mode (a sandbox).
2. Developers, API keys: copy the publishable key (`pk_test_…`) and the secret key (`sk_test_…`).
3. Put them in `backend/.env` as `STRIPE_PUBLISHABLE_KEY` and `STRIPE_SECRET_KEY`, and restart. The app gets the publishable key from the backend.

A key that is not a test key stops the server from starting. Test cards: `4242 4242 4242 4242` pays, `4000 0000 0000 0002` is declined, `4000 0027 6000 3184` asks for 3D Secure (code `424242` on iOS). Any date to come, any CVC.

A webhook is not needed: the server asks Stripe itself. To have one, point it at `/stripe/webhook` for `payment_intent.*` and put its secret in `STRIPE_WEBHOOK_SECRET`.

## Run the app

Android first. You need JDK 17 to 21, the Android SDK, and a phone with USB debugging on (or an emulator). The backend must be running.

```bash
cd app
cp .env.example .env
npm ci
adb reverse tcp:4000 tcp:4000
npx expo run:android --variant release
```

That is a real release build against the backend on this computer, about 6 minutes the first time. The log in screen has a row of test accounts that fill in with a tap. The dev menu is under the person icon, for the six test accounts, in every build.

For a build that reloads as you edit: `npm run android`, with `adb reverse tcp:8081 tcp:8081` as well.

iOS simulator: `npx expo run:ios --configuration Release`. `expo-dev-client` is pinned to 58.0.19 because newer ones need Xcode 27.1. Drop the pin and the override in `app/package.json` once you have it.

Another backend: set `EXPO_PUBLIC_API_URL` in `app/.env` and build again. Plain `http://` is only allowed when that address is `http://`.

```bash
npm run typecheck
```

```bash
npm test
```

These test the app's outbox, offline rules, payments, clock and swipe decisions without a phone. No test goes near the real Stripe.

## Check the backend

In a second terminal, with the server running:

```bash
cd backend
npm run play-day
```

This plays a full day for `new@pullday.test`: log in, 8 swipes, reveal, card in the collection, streak +1, then into the next day. It needs `DEV_TOOLS=1`, which `.env.example` sets.

```bash
npm test
```

Tests use their own database (`pullday_test`) and do not need the server. They never touch your data. Two runs at once are fine: they take turns, a file at a time.

## Test accounts

Password `pullday123` for all.

| Email | State |
| --- | --- |
| `new@pullday.test` | Brand new |
| `today@pullday.test` | 12 day streak, today not done |
| `done@pullday.test` | 30 day streak, today done |
| `freeze@pullday.test` | 7 day streak, missed yesterday, owns 1 freeze. Opening the app uses it |
| `broken@pullday.test` | 40 day streak broke yesterday, win back open |
| `collector@pullday.test` | 300 cards, 5 binder pages filled |

Put one back: `npm run reset -- freeze`

## API

Send `Authorization: Bearer <token>` except where marked open. Errors are `{ "error": "code", "message": "for people" }`.

| Call | What it does |
| --- | --- |
| `POST /auth/signup` (open) | `email, password, timezone, deviceId` |
| `POST /auth/login` (open) | `email, password, deviceId` |
| `POST /auth/logout` | Ends this session |
| `PUT /me/timezone` | `timezone`. From the end of today, once every 7 days |
| `GET /today` | Settles missed days. Streak, freezes, win back, bundles for today and tomorrow, unseen reveals |
| `POST /challenges/:id/start` | Tells the server it began. Refused with `too_late` once the day is over, which does no harm |
| `POST /challenges/:id/complete` | `answers`: 8 of `common`, `rare`, `holo`. Safe to repeat |
| `POST /challenges/:id/reveal-seen` | Safe to repeat |
| `POST /win-back` | `missedDay`. Begins or goes on with the one payment for that break. 409 `no_win_back` or `payments_not_set_up` |
| `GET /win-back/payments/:id` | Asks Stripe what became of it. Never counts as contact |
| `POST /stripe/webhook` (open) | Only a hint: Stripe is asked before anything happens |
| `GET /collection` | Owned cards |
| `GET /catalogue` | All 1,993 cards, light, gzip and ETag |
| `GET /cards/:id` | Details, price history, story |
| `GET /images/:id?w=200\|400\|1080&grey=1` (open) | WebP. 404 `image_missing` or 504 `image_slow` (try again) |
| `POST /dev/move-time` | `minutes`, forward only |
| `POST /dev/grant-card` | `cardId`, or `count`, or nothing for one random card |
| `POST /dev/pay` | `paymentId`, `card` (`visa` or `declined`), `afterMs`. Pays with Stripe's own test card |
| `POST /dev/reset` | Optional `timezone` |

`/dev/*` exists only with `DEV_TOOLS=1` and only works for the six test accounts.

`deviceId` is a UUID the app makes once at install. `start`, `complete` and `reveal-seen` are the outbox: the app sends them, in order, before any other call after being offline. They never count as the phone having been online. A refused `start` must not stop the `complete` behind it.

## Pictures

`npm run warm-images` (in `backend`) makes the 200 and 400 pictures, colour and grey, for every card: about 260 MB and 20 minutes. Safe to stop and run again. Without it the first view of each picture is slow. The 1080 ones are made when first asked for.

## Stop

```bash
npm run db:down
```

Add `docker volume rm pullday_pullday-db` to delete the data too.
