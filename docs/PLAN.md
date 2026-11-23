# Plan

`brief.md` is the source of truth. Total time is 15 hours. Volume earns nothing, so this is an order, not a wish list: if time runs out, the bottom of the list is what gets cut.

## Build order and time budget

| Step | What | Hours | Running total |
| --- | --- | --- | --- |
| 0 | Plan, rules, repo. **Done** | 0.5 | 0.5 |
| 1 | Backend: loop end to end, then make the days correct, then images, seeds, dev tools, tests. **Done**, 189 tests, 23 November 2026 | 3.0 | 3.5 |
| 2 | App: log in, Today, 8 swipes, reveal, card in collection, streak +1, on a real phone. Built, on an emulator and a simulator so far | 3.0 | 6.5 |
| 3 | App: make the loop solid. Outbox, kill mid-swipe, kill mid-reveal, phone call, no wifi, 11:58pm | 2.0 | 8.5 |
| 4 | Collection (2,000 cards, smooth on a cheap Android) and card details. Built, on an emulator and a simulator so far. Never on a cheap Android | 2.0 | 10.5 |
| 5 | Streak screen and win back with Stripe test mode. Built, on an emulator and a simulator, with real Stripe test payments | 1.75 | 12.25 |
| 6 | Shop and the fake store for freezes | 1.0 | 13.25 |
| 7 | Cheap Android pass, empty and error states, the check-in feedback | 1.25 | 14.5 |
| 8 | Recording, README from a fresh clone, final DECISIONS and AI notes | 0.5 | 15.0 |

Planned cut: binder screens. The table and the collector seed exist so the account is complete, but binder pages only get built if step 7 finishes early.

Why this order: six of the nine bad reviews are about days, money or lost progress, and those stay wrong on the phone if the server is wrong. The server also decides what the phone can do offline. So the server rules come first, in a fixed 3 hour box, and then everything goes to the phone.

Each step ends with a stop: plain explanation, 3 riskiest parts, questions saved to `notes/`, quiz.

## Step 1 in detail

Built in this order so there is a working loop early and it is only ever made stronger.

1. Postgres in Docker Compose, plain SQL migrations, catalogue import.
2. Loop end to end: sign up, log in, today, start, complete, reveal seen, collection. One test plays it.
3. Days: one clock, time zones, day ends, settlement, freezes, breaks, win back window.
4. Late and offline completion rules, per device.
5. Catalogue, card details, images.
6. Seeds, resets, dev endpoints.
7. Every test in the list below. Full-day script. Fresh clone check.

### Review to rule

| Review | What stops it |
| --- | --- |
| 11:58pm, streak reset anyway | Start is recorded by the server. Finish within 60 minutes still counts. The day is not settled while that is open. |
| On the plane, didn't count | Bundle for today and tomorrow on the phone. Accepted up to 48 hours late from a device that has been offline since. |
| Changes his phone date | The phone never sends a date. A completion names a challenge, and the server knows which day it belongs to. |
| Bought a freeze, still lost my streak | Settlement is oldest first, in one transaction, and counts a freeze only if bought before that day ended. |
| Card gone after a call | Card is saved before the reveal. `reveal_seen_at` is separate and an unseen reveal replays. |
| Paid to win back, money gone | One payment for each break. The server asks Stripe, by webhook, status check and sweep. The phone saves that it began before the sheet opens, and says failed only when Stripe does. What cannot be honoured is refunded. |
| Collection lags, swipes sticky, app froze | Steps 2 to 4 and 7. Resized WebP images are the part the server owns. |

### Tests

11:58pm start and 12:01am finish, plane with no wifi, phone date changed, double submit, two devices, crash between grant and reveal, freeze used, two misses with one freeze, freeze bought too late, late sync after a freeze, break and 48 hour window, time zone changes and DST, every seeded account.

### Done when

A fresh clone runs from README.md in under 10 minutes, all tests pass, and a script plays a full day for `new@pullday.test`.

## Where the instructions and brief.md pull apart

`brief.md` wins. These are the places it mattered.

1. **Binder.** Instruction: binder not now. Brief: `collector@pullday.test` has 5 binder pages filled. So the binder table and that seed are built, with no binder endpoints.
2. **Freeze cap.** Instruction: a late offline completion returns the freeze. Brief: hold up to 2. If returning it would make 3, the freeze is marked `refund_due` and not added. No money moves until step 5.
3. **Order.** Brief advises one full loop end to end first. Instruction is the whole backend first. Advice is not a rule, so the order stands, but the loop is built first inside step 1 and the backend is boxed at 3 hours.

## Readings of the rules that need a decision

| Question | Choice |
| --- | --- |
| "Has not contacted the server since": since what? | Since that day ended. Any logged-in call counts as contact, except the outbox calls (start, complete, reveal seen), logging in or out, and dev tools. Pictures need no login and do not count. Two offline days then sync one after the other without the first blocking the second. |
| What the phone must do in return | Outbox first, in order: start, complete, reveal seen. A refused start never stops the complete behind it. While a challenge from a day that has ended is on the phone, finished but unsent, or begun but unfinished up to 60 minutes after the day ended, the app makes no call that counts as contact. No win back offer is shown until the outbox is empty, and the streak shown is the last known one, marked as old: with two offline days, the reply to the first says streak 0, because the second has not arrived yet. |
| Do won back days add to the streak? | No, same as frozen. A 40 day streak comes back as 40, not 41. |
| `broken@`, "broke yesterday" | Yesterday is the missed day, so the break is at the end of yesterday and the window closes 48 hours after that. |
| Midnight passes with a challenge open | The day is not settled for 60 minutes if it was started, so no freeze is spent and no break shows while the user is still swiping. |
| Late completion changes the past | Settlement replays from that day, so the result is the same as if it had arrived on time. A freeze it gives back can save a later day. |
| Time zone moves | The current day's end never moves. The next day starts there and ends at its own midnight in the new zone: longer going west, shorter going east. Day labels never repeat. A day shorter than 4 hours cannot break a streak. |
