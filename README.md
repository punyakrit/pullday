# Pullday

A card collecting app built around a daily habit. This is a test app for a work trial. It is not a real product and is not in any store.

- `backend/` Node + TypeScript API on Postgres. Done for the daily loop. Payments and binder are not built yet.
- `app/` React Native + TypeScript. Empty for now.
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

## Check it works

In a second terminal, with the server running:

```bash
cd backend
npm run play-day
```

This plays a full day for `new@pullday.test`: log in, 8 swipes, reveal, card in the collection, streak +1, then into the next day. It needs `DEV_TOOLS=1`, which `.env.example` sets.

```bash
npm test
```

Tests use their own database (`pullday_test`) and do not need the server. They never touch your data.

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
| `POST /challenges/:id/start` | Tells the server it began |
| `POST /challenges/:id/complete` | `answers`: 8 of `common`, `rare`, `holo`. Safe to repeat |
| `POST /challenges/:id/reveal-seen` | Safe to repeat |
| `GET /collection` | Owned cards |
| `GET /catalogue` | All 1,993 cards, light, gzip and ETag |
| `GET /cards/:id` | Details, price history, story |
| `GET /images/:id?w=200\|400\|1080&grey=1` (open) | WebP. 404 `image_missing` or 504 `image_slow` |
| `POST /dev/move-time` | `minutes`, forward only |
| `POST /dev/grant-card` | `cardId`, or `count`, or nothing for one random card |
| `POST /dev/reset` | Optional `timezone` |

`/dev/*` exists only with `DEV_TOOLS=1` and only works for the six test accounts.

`deviceId` is a UUID the app makes once at install. `complete` and `reveal-seen` are the outbox: the app sends them before any other call after being offline.

## Stop

```bash
npm run db:down
```

Add `docker volume rm pullday_pullday-db` to delete the data too.
