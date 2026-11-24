# AI, in detail

Every mistake that was written down, step by step. The short version is `AI.md`.

Tool: Claude Code with Claude Opus 5.5. Commits it made carry a `Co-Authored-By` line.

## What AI wrote

Step 0 and 1, all of it: the plan, the backend code, SQL, seeds, scripts, tests and the first version of these documents. The ten rules in `CLAUDE.md` came from the owner's instructions. AI wrote the finer readings listed in `docs/PLAN.md`.

AI also checked the data (1,993 cards, 66 with no number, 799 with no variety, prices end 2026-11-02), probed every image link (27 broken, largest 14.4 MB, some with the wrong content type) and read the current docs for Fastify, sharp, node-postgres and node:test before using them.

Step 7, all of it: the light look, the motion and four fixes. The owner set the palette, the font, the radius, every motion and the rules for them. AI chose the rolling digits, the black day marks, the launch drawing and the drawn slab for cards with no picture.

Step 6, all of it: the freeze purchases on the server, the fake store, the shop and its tests. The owner set the rules: one grant for each transaction, counted from when it began, refunds recorded, nothing that can cost an offline day.

Step 5, all of it: payments on the server, the fake Stripe, the streak screen, the sheet and the dev menu. The owner set the rules for money, and filled in the keys. AI only checked that they were test keys, and never saw them.

Step 4, all of it: the collection, card details, chart, their tests and the measurements. The owner asked for the rules that matter: why a picture failed, and the one gate.

Step 2, all of it: the app (Expo SDK 58), its tests, the icons, the image warming script and the Dockerfile. The owner chose the loop, the rules for the outbox and what the dev menu must do. AI chose the look. The Gesture Handler docs did not load, so its version 3 API was read from the installed type files.

## Where AI was wrong

After step 8:

- **The last swipe could end on an empty screen.** The owner found it on a real phone, a OnePlus. The account was reset on the server while the app was open, so the finish got 404. The app deleted the play, said nothing and did not ask for `/today`, and the deck kept its own 8 answers. Any refused finish ended like that. AI had a test called "dropped without a word", which asserted it.
- **A refused start was ignored**, also when it said that there is no such challenge.
- **On a full phone with no connection the last swipe ended on an empty deck too**, with only the line above it.

On the new look (step 7):

- **The first build cut "Done for today" to "Done for"** on Android. Seen in the screenshots.
- **The grey cards with no picture could not be read.** The wash over grey pictures was also over their words. The owner saw it.
- **All of Collection was made and downloaded at launch**, before anyone opened it. Found when the owner asked about lazy loading.
- **A card could be dragged down under the buttons.** The owner found it. It was there since step 2.
- **The status bar stayed dark on the dark reveal on iOS.** The Android code has no effect there. Seen in a recording.
- **Every throw started eight springs for one dot.** Found while looking for lost flicks. It was not the cause.
- **AI took a cached launch picture for a bug**, and nearly a deliberate kill for a crash when the owner sent the report.

On the shop (step 6), and what it found in step 5:

- **A declined payment for an old break stayed in the way of a new one.** The app paid for the saved payment first and the offer second, so "Try again" asked for a day nobody could win back, with no way out. The owner found it. AI had tested one break at a time.
- **"Checking your payment" showed behind the open sheet**, while the person was still typing the card number. The owner saw it.
- **A check that ran while the sheet was open could write "not paid" on disk.** A kill after that would have believed it. Found while fixing the line above. Now nothing is checked until the sheet is closed.
- **The first version of the shop would never have said "Bought"**, because the store's own event confirmed the purchase before the code that was waiting for it. Found rereading, before the tests.
- **An airplane mode test proved nothing**: the cable kept the old connection alive, and the purchase went through. Done again with the server stopped too.

On payments (step 5):

- **The first version could have made two payments for one break**, if the phone named another missed day of the same run. Found rereading, before the tests.
- **"Closed by hand" was taken as proof that nothing was charged.** After a connection error in the sheet it proves nothing. Now Stripe is asked again.
- **Stripe's words for programmers reached the screen** when a bank refused. Seen on the emulator.
- **The Android release build broke twice** on a part of Stripe's SDK that we do not use.
- **AI took a killed app for a crash.** The emulator's Play Store was updating WebView. It became the first real test of a kill while paying.

On the phone (step 4):

- **One failed picture was never tried again**, and it said "No picture of this card" when the connection was the problem. The owner reported it.
- **A read gave up with a send that was about to fail**, when the network had just come back. The refresh already handled it, opening a card did not. A new test found it.
- **Opening a card showed a bare tile**, while its small picture was already in memory. Seen in the recording.
- **A phone first opened with no connection never fetched the catalogue later.** AI found it while rewriting the screen.
- **AI's first slow-scroll count was wrong**: it called frames still when everything on them was a dark tile. And one set of measurements was three times worse than the one before with the same build. Both are written down.
- **AI called the 45 odd-shaped pictures bare cards** from their proportions. Looking at them: 44 are stand-in photos from a stock site and one is a bare card.

On the phone (step 2):

- **Half the swipes did not register**, the exact review. A fast flick's last movement arrives only in the gesture's end event, and Android reports zero speed when it saw few touch points. AI decided from the last update, which said nothing had moved. Then each answer re-rendered the touch surface, which could drop the next swipe. Both were found by counting flicks on the emulator: 2 or 3 of 7 at first, 35 of 35 after.
- **Sorted cards came back.** After the app was killed mid-challenge, cards already thrown would lie on top of the deck.
- **A ghost challenge.** A half played challenge from before an account reset came back after midnight and held up all contact for an hour.
- **A gesture could cross decks.** A touch that began on one deck could throw a card on the next.
- **The sync gave up** when it joined a send that began before the network came back. The app's own tests found it.
- **The reveal was sized from the window**, so a banner pushed it over its own caption. AI then fixed the size, and a banner that came later still pushed the card under its title. Now there is none over a reveal. It also said "Added to your collection" while offline.
- **An open card flickered when the server answered.** The reveal went by the card object, and the reply brings the same card in a new one. So the picture was loaded again on screen, and in the middle of the turn the card hung on its edge and the buzz came 300 ms late. A comment said the card was kept. Nothing kept it. The owner reported it. AI had tested online and offline, never a reply that lands while the card is open.
- **A waiting card could vanish while it was open**, seconds after it was seen. It was looked up in the server's list of unseen cards, and it had just been seen. AI found it in a test while fixing the flicker and thought the app had to be left first. On the emulator a network event was enough. Its first fix kept too much: a sealed card already seen on another phone stayed too. Now only a card seen here stays.
- **The dev menu's offline switch outlived the log out**, so nobody could log in until the app was killed. The owner reported it. Ending a session is now one call that also turns the switch off.
- **A button that had been busy once stayed "busy" to Android's screen reader.** Buttons had no name of their own. AI found it reading a screen dump.
- **The app asked the server again at every change of signal**, because Android reports each one as a network event. Three times in 100 seconds untouched. Now none.
- **Moving the phone's date back stopped the app from refreshing**, for as long as it was moved back. "Asked less than 5 seconds ago" was also true of any time in the future.
- **What the phone saves had no version, and nothing checked it.** One damaged row would have stopped the app from opening, and an update that changed its shape could have lost a day. AI named it when the owner asked about SQLite, not before.
- **A full phone crashed the app on the first swipe.** Every save could throw and nothing caught it. AI had noted it as a limit without trying it. On a full emulator it was fatal, and nobody could log in.
- **On iOS a deleted app was still logged in when installed again**, because the keychain outlives it. The login now counts only with the device id made by the same install.
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

For step 6, 10 rules of the shop were broken on purpose on the server. All 10 were caught.

All the tests for lateness passed the first time, which proves little. So 51 rules were broken on purpose, one at a time, to see if a test would fail. 46 were caught by the tests as first written. Of the other 5:

- Keeping the frozen rows when settlement replays. That would have been a free freeze, and no test covered it. Added.
- Grace accepting a start from after the day ended. The start endpoint hid it. The rule now has its own tests.
- Dev calls counting as contact. The test made its call at the wrong moment. Fixed.
- The reward turning up among the 8 cards. The test passed by luck. Replaced.
- Clearing the contact time on reset. Nothing failed because the line did nothing. Removed.

All 50 that remain are caught. The images were tested against a fake origin that misbehaves, and by hand against about 80 real ones, including all 27 broken links.
