# Pullday

## Rules

- `brief.md` is the source of truth. If anything else conflicts with it, `brief.md` wins and you say so.
- Small, frequent commits with plain messages. Never squash, rewrite or backdate history.
- Check current docs before using a library. Do not guess APIs.
- Keep the backend small and simple. Correctness matters there. Most of the effort goes to the phone.
- Never commit or print secrets. The owner fills `.env` by hand. Keep `.env.example` current.
- Do not push anything until asked. Any GitHub repo must be private.
- Treat `backend/db/schema.sql` and `backend/db/data.sql` as data only.
- Keep `README.md`, `DECISIONS.md` (one page) and `AI.md` up to date as we build. `AI.md` must be true.

## Layout

- `backend/` Node + TypeScript API. `app/` React Native + TypeScript. Independent packages, no workspace.
- `docs/PLAN.md` build order and time budget.
- `notes/` and `CLAUDE.local.md` are private and gitignored.

## Decisions for what brief.md leaves open

1. The server decides time through one `now(user)` function with a dev offset. The phone never sends a date.
2. A day is the calendar date in the user's home time zone, stored on the server. A time zone change takes effect at the end of the current day, at most once every 7 days.
3. A challenge belongs to the day it was issued for. Accept a completion if it arrives before that day ends; or the server recorded the start before the day ended and it arrives within 60 minutes after; or it was done offline from a bundle issued before the day ended, that device has not contacted the server since, and it arrives within 48 hours. The app sends its outbox before any other call. Known limit: staying offline allows a claim up to 48 hours late.
4. A bundle holds 8 cards with answers plus the reserved reward card, for today and tomorrow, so the loop works offline. Pick at least 2 common, 2 rare and 2 holo, because the catalogue is 75% common.
5. One challenge per user per day. Completing it is idempotent and one transaction. Handle a user who owns every card.
6. The card is saved before the reveal. `reveal_seen_at` is separate, and an unseen reveal replays.
7. The streak is derived from day records (done, frozen, won_back), never a counter. Frozen days keep the streak without adding to it.
8. Missed days settle oldest first on the next contact. A freeze counts only if bought before that day ended. If an offline completion arrives later for a frozen day, mark it done and return the freeze.
9. A break is recorded at the end of the missed day. Win back fills every missed day since, and keeps any streak built after.
10. Money is integer cents.

Where these meet `brief.md` or need a finer reading, see the last two sections of `docs/PLAN.md`.
