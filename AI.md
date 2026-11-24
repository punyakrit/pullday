# AI

Tool: Claude Code with Claude Opus 5.5. Commits it made carry a `Co-Authored-By` line. Every mistake that was written down is in `docs/AI-DETAILS.md`.

## What AI was used for

Nearly everything that is typed: the plan, the backend, SQL, seeds, the app, tests, measurements and these documents. It also probed all 1,993 image links (27 broken) and read current docs before using a library.

The owner set the order, the day rules, the outbox and money rules, the palette, font and motion, filled in the Stripe keys, read the result, and found bugs that AI had missed. AI chose the rest, and did most of the testing on the emulator and the simulator. Other Claude sessions reviewed the code.

## Where it was wrong

**Found by the owner or another reviewer, not by the AI that wrote it:**

- **The plane review would have come back.** A start counted as being online, so the start sent the next morning made the finish too late. A test asserted the wrong behaviour on purpose, and all 185 passed.
- **The last swipe could end on an empty screen.** The owner found it on a real phone: the server refused the finish, and the app said nothing.
- **An old declined payment blocked a new offer**, with no way out. AI had tested one break at a time.
- **An open card flickered when the server answered.**
- **A failed picture was never tried again**, and said "no picture" when the connection was the problem.
- **The challenge gave the answer away** for cards with no picture: their rarity shape was drawn in its place.
- **After a win back the offer stayed under "Paid"** until the next `/today`, and for good if that failed.
- **The flame said "last known" after every last swipe**, online too.
- **A card could be dragged under the buttons**. "Checking your payment" showed behind the open sheet. The dev menu's offline switch outlived the log out.

**Found by AI, later than it should have been:**

- **Half the swipes did not register**, the exact review. A fast flick's last movement only arrives in the end event. 2 or 3 of 7 at first. Counting flicks found it.
- **Tests emptied the real database**, because one file opened its connection too early. They passed while doing it. Now they refuse to run on any other database.
- **A full phone crashed the app on the first swipe.** AI had noted it without trying it.
- **Saved rows had no version.** An update could have lost a day.
- **Two payments for one break were possible** in the first version. "Closed by hand" was taken as proof that nothing was charged.
- **The same card was promised to two days**, and a date that never happened could be claimed.

**Wrong conclusions:**

- A killed app was taken for a crash, a cached launch picture for a bug, and stand-in photos for bare cards.
- An airplane mode test proved nothing: the cable kept the connection.
- Some flick batches lost 3 to 7 of 35, and minutes later none. The cause is not proven.

## What was thrown away

- Stamps on every card, and mounting cards as needed: 30 views for each swipe. Now one set follows the top card.
- Testing in the dev client. Everything is checked in a release build.
- The first look, dark, with Barlow. Replaced by the light one.
- Keeping every size of every picture: it would have filled the disk.
- The first way of choosing a reward, which only preferred cards that were not promised.

## How it was checked

Passing tests prove little when the same AI wrote both, so 51 server rules were broken on purpose, one at a time. 46 were caught. The other 5 led to new tests, or to removing a line that did nothing. The shop had 10 more, all caught. In step 8 the new payment tests were run without the fix, and 5 of them failed.

No test calls the real Stripe. Payments were also tried with Stripe's test cards. AI never had a real phone.
