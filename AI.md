# AI

Tool: Claude Code with Claude Opus 5.5. Commits it made carry a `Co-Authored-By` line.

## What AI wrote

Step 0 and 1, all of it: the plan, the backend code, SQL, seeds, scripts, tests and the first version of these documents. The ten rules in `CLAUDE.md` came from the owner's instructions. AI wrote the finer readings listed in `docs/PLAN.md`.

AI also checked the data (1,993 cards, 66 with no number, 799 with no variety, prices end 2026-11-02), probed every image link (27 broken, largest 14.4 MB, some with the wrong content type) and read the current docs for Fastify, sharp, node-postgres and node:test before using them.

Step 2, all of it: the app (Expo SDK 58), its tests, the icons, the image warming script and the Dockerfile. The owner chose the loop, the rules for the outbox and what the dev menu must do. AI chose the look. The Gesture Handler docs did not load, so its version 3 API was read from the installed type files.

## Where AI was wrong

On the phone (step 2):

- **Half the swipes did not register**, the exact review. A fast flick's last movement arrives only in the gesture's end event, and Android reports zero speed when it saw few touch points. AI decided from the last update, which said nothing had moved. Then each answer re-rendered the touch surface, which could drop the next swipe. Both were found by counting flicks on the emulator: 2 or 3 of 7 at first, 35 of 35 after.
- **Sorted cards came back.** After the app was killed mid-challenge, cards already thrown would lie on top of the deck.
- **A ghost challenge.** A half played challenge from before an account reset came back after midnight and held up all contact for an hour.
- **A gesture could cross decks.** A touch that began on one deck could throw a card on the next.
- **The sync gave up** when it joined a send that began before the network came back. The app's own tests found it.
- **The reveal was sized from the window**, so a banner pushed it over its own caption. It also said "Added to your collection" while offline.
- **An open card flickered when the server answered.** The reveal went by the card object, and the reply brings the same card in a new one. So the picture was loaded again on screen, and in the middle of the turn the card hung on its edge and the buzz came 300 ms late. A comment said the card was kept. Nothing kept it. The owner reported it. AI had tested online and offline, never a reply that lands while the card is open.
- **Each swipe mounted about 30 views**, because every card carried its own stamps. Now one set follows the top card.
- **Every size of every picture was kept**, which would have filled the deployed disk. And a picture that failed to decode once was called missing for an hour. The warming run skipped one real card that way.
- **AI nearly drew the wrong conclusion from frame timings.** They looked bad until the same test on Android's Settings app scored the same.

On the backend (step 1):

- **Tests emptied the real database.** One test file imported from `src/` directly, so the connection opened on the main database before the helper switched it to the test one. Every test in that file passed. It showed up only when the full-day script ran at the same time and was logged out mid-day. Now the tests refuse to run on any other database.
- **The plane review would have come back.** A start counted as the phone being online, even when it was refused. The app queues the start with the finish, so the start sent the next morning would have made the finish too late. A test asserted this wrong behaviour on purpose. All 185 tests passed. Another Claude session reviewing the code found it, AI in this session did not. Three new tests failed before the fix and pass after it.
- **Two test runs at once failed each other.** They share one database and empty it. When two Claude sessions ran the tests at the same moment, 38 of 189 failed for no reason in the code. Now a run waits its turn. Three runs at once, and a run after one that was killed, all pass.
- **First streak code told a repeated submit the wrong streak**, because it did not settle missed days first. Found by rereading, then tested.
- **Promised one card twice.** With a single card left, today and tomorrow both reserved it. Found by rereading.
- **A date that never happened could be claimed.** Crossing the date line leaves a day with no time in it, and the first version let an offline phone claim it. Found by rereading.
- **A time zone test was wrong, not the code.** It moved back after 6 days and 10 hours, was rightly refused, and never checked. Every move is now asserted.
- **Image limits were guesses.** 30 seconds and 4 at once were raised to 45 and 6 after trying the real files.
- A seed query failed on a type and was fixed on the first run.

## What we threw away

- Per-card stamps and marks, and mounting cards as they were needed.
- Testing in the dev client. Its menus were in the way, so everything was checked in a release build.
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
