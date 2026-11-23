# AI

Tool: Claude Code with Claude Opus 5.5. Commits it made carry a `Co-Authored-By` line.

## What AI wrote

Step 0 and 1, all of it: the plan, the backend code, SQL, seeds, scripts, tests and the first version of these documents. The ten rules in `CLAUDE.md` came from the owner's instructions. AI wrote the finer readings listed in `docs/PLAN.md`.

AI also checked the data (1,993 cards, 66 with no number, 799 with no variety, prices end 2026-11-02), probed every image link (27 broken, largest 14.4 MB, some with the wrong content type) and read the current docs for Fastify, sharp, node-postgres and node:test before using them.

## Where AI was wrong

- **Tests emptied the real database.** One test file imported from `src/` directly, so the connection opened on the main database before the helper switched it to the test one. Every test in that file passed. It showed up only when the full-day script ran at the same time and was logged out mid-day. Now the tests refuse to run on any other database.
- **First streak code told a repeated submit the wrong streak**, because it did not settle missed days first. Found by rereading, then tested.
- **Promised one card twice.** With a single card left, today and tomorrow both reserved it. Found by rereading.
- **A date that never happened could be claimed.** Crossing the date line leaves a day with no time in it, and the first version let an offline phone claim it. Found by rereading.
- **A time zone test was wrong, not the code.** It moved back after 6 days and 10 hours, was rightly refused, and never checked. Every move is now asserted.
- **Image limits were guesses.** 30 seconds and 4 at once were raised to 45 and 6 after trying the real files.
- A seed query failed on a type and was fixed on the first run.

## What we threw away

- A branch in the "which day is it" code for a zone change that has not started. It could never run.
- The first way of choosing a reward, which only preferred cards that were not promised. Now it avoids them when promising and may take one when finishing.

## How the tests were checked

All the tests for lateness passed the first time, which proves little. So 51 rules were broken on purpose, one at a time, to see if a test would fail. 46 were caught by the tests as first written. Of the other 5:

- Keeping the frozen rows when settlement replays. That would have been a free freeze, and no test covered it. Added.
- Grace accepting a start from after the day ended. The start endpoint hid it. The rule now has its own tests.
- Dev calls counting as contact. The test made its call at the wrong moment. Fixed.
- The reward turning up among the 8 cards. The test passed by luck. Replaced.
- Clearing the contact time on reset. Nothing failed because the line did nothing. Removed.

All 50 that remain are caught. The images were tested against a fake origin that misbehaves, and by hand against about 80 real ones, including all 27 broken links.
