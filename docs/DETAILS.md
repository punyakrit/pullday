# Details

The long version of `DECISIONS.md`, kept so nothing is lost.

Status: all 8 steps in `docs/PLAN.md` are built, except the recording. **Every check below was made on an emulator or a simulator.** The owner opened the app on one real phone, a OnePlus, and found that the last swipe could end on an empty screen. The fix was tried on the emulator, not there. They were release builds on an Android emulator and an iOS simulator. `brief.md` asks for a real phone, so this is open, and so is how anything feels under a thumb.

## What was built first, and why

Six of the nine bad reviews are about days, money or lost progress. Those are wrong on every phone if the server is wrong, so the server rules came first, in a fixed box. Then the one full loop on the phone, including offline, because a loop that only works online would have to be rebuilt.

## The nine reviews

The AI checked none of these on a real phone. "Both" is the Android emulator and the iOS simulator.

1. **11:58pm, streak reset.** Fixed: 60 minutes to finish what was begun. Server tests, and played past midnight with the dev menu.
2. **On the plane, didn't count.** Fixed: today and tomorrow play offline and count up to 48 hours late. Server and app tests, and airplane mode on Android.
3. **Changes his phone date.** Fixed for that: the phone never sends a date. Tests, and the date moved on the emulator. Left: staying offline can claim a day up to 48 hours late.
4. **Bought a freeze, still lost the streak.** Fixed: it counts from when the purchase began. Tests, and pending, killed and offline on Android, pending and killed on iOS. The store is a fake.
5. **Paid to win back, money gone.** Fixed: Stripe is always asked, and what is not honoured is refunded. Tests, and real Stripe test payments on both, killed and cut off in the middle. Left: no webhook from the real Stripe.
6. **Took a call, the card was gone.** Fixed: saved before it is shown, and it plays again until it was seen. Tests, and killed and left in the middle on Android, pulled by hand on both. No real call.
7. **Collection lags.** Better, not proven: on the emulator no bare area on hard flings. A cheap phone is the question, and that is open.
8. **Swiping feels sticky.** Better, not proven: 35 of 35 flicks, and again under load, but some batches lost a few while the emulator was slow (below). A thumb has to say.
9. **App froze on the rare card.** Better, not proven: light only, moved on the UI thread, and the picture is ready before it turns. Never seen to freeze on either.

## What counts as a day

**The calendar date in the user's home time zone, kept on the server.** People think "I did it on Tuesday". A rolling 24 hours punishes 9am then 10am, and UTC ends the day mid-afternoon for some. The phone never sends a date, so changing its clock does nothing.

**A zone change waits for the end of the current day, once every 7 days.** The running day's end never moves. The next day is longer going west, shorter going east. Dates never repeat. A day under 4 hours cannot break a streak.

**Late is allowed when it was honest.** It counts if it arrives that day, or within 60 minutes after if we heard it start, or within 48 hours if that phone already had the bundle and has sent nothing but its outbox since the day ended.

**Missed days settle oldest first, on the next contact.** A late day replays settlement from that day, so the order things arrive in does not matter. A freeze it gives back can save a later day.

**The streak is read from day records, never a counter.** Frozen and won back days hold it together and add nothing.

## On the phone

**The outbox is the promise.** Every swipe is saved while its card is still leaving the screen, and the finish is saved before anything is revealed, in one write. Sent in order: start, complete, reveal seen. Nothing else goes first. Until it is empty the streak is the last known one, and says it may be old when offline or when the call failed. What is saved has a version. A row that cannot be read is kept aside, never fatal. On a full phone play goes on in memory, and no card is shown until the finish is safe.

**Swipes are decided on the UI thread.** One touch surface, never re-rendered, moves whichever card is on top. A card in flight is never in the way.

**Calm and light, so the cards are the only colour.** The reveal is the one dark place. Motion is transform and opacity on the UI thread, runs once per opening, and is off with Reduce Motion. A grid cell is a plain view until it is touched.

**The reveal starts over until it was seen.** A call, the home button or a kill before that replays it. Once a card starts to turn it stays.

**The collection shows all 1,993, yours in colour.** Small pictures on disk, grey ones made by the server. The name is under every picture, so a cell is never empty. "No picture" and "couldn't load" are told apart, and the second is tried again.

**Every read goes through one gate.** A card opened at 12:02am must not cost a day finished on a plane. A test fails if any other file talks to the server.

**Only our own 401 logs out.** Hotel wifi, proxies, 5xx and no network never do.

## Money

**The server decides, and Stripe is the only one who knows.** One PaymentIntent for a break, with an idempotency key, so a double tap or two phones can only pay once. A webhook, a status check and a sweep all ask Stripe and then do the same thing, once. The app saves that a payment began before the sheet opens, and afterwards says "Checking your payment" until there is an answer. "Failed" and "no money was taken" only come from Stripe, "not paid" after it was asked more than once. Once it is paid or refunded, that break is not offered again until a `/today` that was asked later, also after a kill.

**Begun inside the 48 hours counts whenever it ends.** An unpaid one is closed an hour after. What cannot be honoured is refunded: also when a late offline day fixed the streak after it was paid. The check never counts as contact. Beginning does, so it waits for the outbox.

**A freeze counts from when the server recorded that the purchase began**, not from when the money was confirmed. Approval can come hours later, and "bought a freeze, got charged, still lost my streak" is one of the reviews. So the server notes the moment before the store opens, and a late confirmation settles the days since then again. A freeze begun at 11:58pm and approved in the morning saves that day.

**One grant for each store transaction, two freezes at most.** The app saves the purchase, the server checks there is room, and only then the store's sheet opens. A purchase is finished with the store only after the server has confirmed it. At 2 it is refused before any charge. One that completes at 2 anyway is recorded as a refund and the person is told. Beginning waits for the outbox. Confirming never counts as contact.

## Where instructions and brief.md pulled apart

Binder screens wait, but `collector@` must have 5 pages, so the table and seed exist. A freeze that would make 3 is marked `refund_due`.

## Cut or not built yet

Binder (the planned cut). No search. No password reset, email check, rate limit or session expiry.

## Known limits and what is still broken

- Smoothness is only measured on an emulator (`docs/MEASUREMENTS.md`): no bare area on a fast scroll, and frame numbers that say little. The quick build in the README is for 64 bit phones. The one for all phones was built, but never tried on a 32 bit one.
- A phone kept offline, or made to send nothing but its outbox, can claim a day up to 48 hours late.
- The bundle holds the answers and the reward, so a curious person can read them.
- Offline, the phone chooses the day from its own clock. Moved forward it shows tomorrow, the server refuses it, and the app says so.
- A 1080 picture can take 20 seconds to make. The reward's is made when its challenge is handed out, others when first asked for. 27 pictures are gone at their source (404, all asked again on 24 November 2026), and are drawn as a slab. They stay in the collection. The list is in `005_cards_without_picture.sql`, so nothing is asked while picking. They are picked for a reward or a challenge only when nothing else is left to give: a card promised to another day is not left to give. Seeded accounts follow the same rule, except the 300 cards of `collector@`. What was handed out before stays as it was. A link that dies later has to be added by hand.
- After a trip shorter than 7 days you cannot move your zone straight back.
- Money: no webhook from the real Stripe was ever received, only the fake's. A refund that fails is tried every minute, and nobody is told. If a freeze comes back after a win back was paid, the person keeps both. Resetting a test account in the middle of a payment leaves it open at Stripe.
- Shop: the store is a fake on the phone, so the server takes the phone's word that money was paid, and a refund is only a row. A changed app could begin every day and pay only after a miss. A real store's receipt, with its date, would close both. If a streak is won back while a freeze is pending, the person gets both: nothing is lost, and the offer says so first. A notice that a freeze was used stays if that day later turns out to be done.
- Flicks: three batches in step 7 gave 32, 29 and 28 of 35, with and without the new motion. Minutes later the same builds, and the one from before, gave 35 of 35 four times. The emulator was slow or also being touched, neither is proven. A flick that is heard of late now counts.
- Small, seen in step 6 and 7: with several notices the Buy button is pushed below the fold. On iOS the card is already half grown when the details fade in. A kill from the dev menu shows macOS's crash report.
- Android lives through font size, bold text, language and display size (`plugins/withLastingActivity.js`). Text follows a new font size live. Bold text was only checked not to crash. A recreated activity was also tried, 8 of 8, on a build without those config changes.
- A link from outside that is opened while Stripe's sheet is up still closes the sheet. Only the icon and recents keep it.
- On Today a win back offer goes before notices that can be read at any time. They are all on the streak screen.
- The README was followed in a fresh clone, on one Mac, with empty npm, Gradle and CocoaPods caches, cloned from this Mac because it was not pushed. Android 8:55. iOS 9:27 the first time, for two kinds of CPU, and 8:54 after that was cut to one, though Xcode could then reuse parts of the first. The Android SDK, the NDK, Xcode and the Postgres image were already there. No other computer was tried. `dev:android` and `dev:ios` were not.
- Step 8: that a paid offer stays away when `/today` fails is tested in code only. On Android the normal way was watched with a real Stripe test payment: paid, offer gone, flame lit. The reveal and the alignment were looked at on Android, the alignment also on iOS.
- Small, seen in step 5: closing the sheet takes about 6 seconds to say "Not paid". After a decline and then a cancel it still says the decline. A "Paid" notice from before a reset by script stays until dismissed. The 3D Secure page shows the name of the Stripe account. Killing from the dev menu is a real crash.
