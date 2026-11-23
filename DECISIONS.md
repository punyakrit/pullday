# Decisions

Status: step 1 of 8 in `docs/PLAN.md`. The backend daily loop is done. The app is not started.

## What was built first, and why

Six of the nine bad reviews are about days, money or lost progress. Those are wrong on every phone if the server is wrong, and the server decides what a phone may do offline. So the server rules came first, in a 3 hour box, and everything else goes to the phone. Inside that box the loop was built first (sign up, challenge, card, collection), then made correct.

## What counts as a day

**The calendar date in the user's home time zone, kept on the server.** People think of a streak as "I did it on Tuesday", so a rolling 24 hours would punish playing at 9am one day and 10am the next. UTC would end the day mid-afternoon for some. The phone never sends a date, so changing the phone's clock does nothing.

**A zone change waits for the end of the current day, once every 7 days.** The end of the running day never moves, so it cannot be used to rescue a day at 11:59pm. The next day is longer going west and shorter going east. Dates never repeat. A day shorter than 4 hours, or one skipped by the date line, cannot break a streak.

**Late is allowed when it was honest.** A challenge belongs to the day it was issued for. It counts if it arrives that day, or within 60 minutes after if we heard it start, or within 48 hours if that phone already had the bundle and has not talked to us since the day ended. The outbox calls do not count as talking to us, so two offline days can sync one after the other.

**Missed days settle oldest first, on the next contact.** A day with a started challenge is not settled for 60 minutes, so nobody sees a broken streak while still swiping. When a late day arrives, settlement replays from that day, so the result is what it would have been had we known. A freeze it gives back can then save a later day.

**The streak is read from day records, never a counter.** Done adds 1. Frozen and won back hold the run together and add nothing, so a 40 day streak comes back as 40.

**The card is saved before the reveal.** Card, day and streak are one transaction with the user locked. The reveal has its own seen mark and replays until it is set.

## Where instructions and brief.md pulled apart

- Binder screens wait, but `collector@` must have 5 pages. The table and seed exist, with no endpoints.
- A late day gives its freeze back, but the limit is 2. A third is marked `refund_due` and not added. Nothing pays it out yet.

## What was cut

Payments, shop and binder screens are later steps. Binder is the planned cut. There is no password reset, email check, rate limit or session expiry.

## Known limits and what is still broken

- A phone kept offline can claim a day up to 48 hours late. Nothing can tell that from a plane. One device kept offline while another is used makes this easy.
- The bundle holds the answers and the reward, so a curious person can read them. The score does not count and the card is theirs anyway.
- After a trip shorter than 7 days you cannot move your zone straight back.
- If a won back day turns out to have been done offline, it becomes done, but the $4.99 is not handled. That belongs to payments.
- The first view of each image is slow: the server has to fetch an original of up to 14 MB. 24 cold images took 20 seconds. After that they are instant. This will hurt the first scroll of the collection unless images are fetched ahead.
- Nothing has run on a phone yet.
