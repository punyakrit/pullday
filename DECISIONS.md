# Decisions

Status: steps 1, 2 and 4 of 8 in `docs/PLAN.md`: the backend, the daily loop, and the collection with card details. **Nothing has been tested on a real phone yet.** Only on an Android emulator and an iOS simulator, with release builds. `brief.md` asks for a real phone, so this is open.

## What was built first, and why

Six of the nine bad reviews are about days, money or lost progress. Those are wrong on every phone if the server is wrong, so the server rules came first, in a fixed box. Then the one full loop on the phone, including offline, because a loop that only works online would have to be rebuilt.

## What counts as a day

**The calendar date in the user's home time zone, kept on the server.** People think "I did it on Tuesday". A rolling 24 hours punishes 9am then 10am, and UTC ends the day mid-afternoon for some. The phone never sends a date, so changing its clock does nothing.

**A zone change waits for the end of the current day, once every 7 days.** The running day's end never moves. The next day is longer going west, shorter going east. Dates never repeat. A day under 4 hours cannot break a streak.

**Late is allowed when it was honest.** It counts if it arrives that day, or within 60 minutes after if we heard it start, or within 48 hours if that phone already had the bundle and has sent nothing but its outbox since the day ended.

**Missed days settle oldest first, on the next contact.** A late day replays settlement from that day, so the order things arrive in does not matter. A freeze it gives back can save a later day.

**The streak is read from day records, never a counter.** Frozen and won back days hold it together and add nothing.

## On the phone

**The outbox is the promise.** Every swipe is saved while its card is still leaving the screen, and the finish is saved before anything is revealed, in one write. Sent in order: start, complete, reveal seen. Nothing else goes first. No streak is shown until it is empty. What is saved has a version, so an update can read it. A row that cannot be read is kept aside and said, never fatal. If the phone is out of space, play goes on in memory, the app says so, and no card is shown until the finish is on disk or with the server.

**Swipes are decided on the UI thread.** One touch surface, never re-rendered during a challenge, moves whichever card is on top. A card in flight is never in the way. Distance counts, a flick counts, a flick back is a change of mind.

**The reveal starts over until it was seen.** Marked as seen only after the card has been face up for a moment with the app in front. A call, the home button or a kill before that replays it. Once a card starts to turn it stays: a late reply changes the words, never the card.

**The effects are cheap on purpose.** Gradients and transforms, no blur, no shadow, no particles made in JavaScript. The picture is decoded before the card may turn.

**The collection shows all 1,993, yours in colour.** In binder order, with a switch to only yours. Small pictures on disk, grey ones made by the server. The name is under every picture, so a cell is never empty. It says "no picture" only if the server says so, and "couldn't load" otherwise, and then tries again.

**Every read goes through one gate.** A card opened at 12:02am must not cost a day finished on a plane. A test fails if any other file talks to the server.

**Only our own 401 logs out.** Hotel wifi, proxies, 5xx and no network never do.

## Where instructions and brief.md pulled apart

Binder screens wait, but `collector@` must have 5 pages, so the table and seed exist. A returned freeze that would make 3 is marked `refund_due`, and nothing pays it yet.

## Cut or not built yet

Streak screen, win back, shop, binder (the planned cut). No search. No password reset, email check, rate limit or session expiry.

## Known limits and what is still broken

- Smoothness is only measured on an emulator (`docs/MEASUREMENTS.md`): no bare area on a fast scroll, and frame numbers that say little. The build does not install on a 32 bit phone.
- On iOS the launch screen still shows the template's drawing.
- A phone kept offline, or made to send nothing but its outbox, can claim a day up to 48 hours late.
- The bundle holds the answers and the reward, so a curious person can read them.
- Offline, the phone chooses the day from its own clock. Moved forward it shows tomorrow, the server refuses it, and the app says so.
- A 1080 picture is made when first asked for, which can take 20 seconds. The reveal waits 5, then uses the 400.
- After a trip shorter than 7 days you cannot move your zone straight back.
- A won back day that turns out to have been done offline becomes done, but the $4.99 is not handled.
