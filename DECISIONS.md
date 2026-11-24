# Decisions

**Nothing has been tested on a real phone yet**, only on an Android emulator and an iOS simulator, with release builds. The long version is `docs/DETAILS.md`.

## What was built, in this order, and why

1. **Server rules for days.** Six of the nine reviews are about days, money or lost progress, and those stay wrong on every phone if the server is wrong.
2. **The loop on the phone**, offline from the start. A loop that only works online would have to be rebuilt.
3. **Kills, calls, no network.** Swipes are saved as they happen, the card before it is shown.
4. **Collection and card details.** The heaviest screens.
5. **Win back with Stripe, then the shop.** Money stands on correct days.
6. **Look and motion.** Polish comes after it works.

## What counts as a day

**The calendar date in the user's home time zone, kept on the server.** People think "I did it on Tuesday". A rolling 24 hours punishes 9am then 10am, and UTC ends the day mid-afternoon for some. The phone never sends a date.

A zone change waits for the end of the day, once every 7 days. A late challenge counts if the server heard it start and it ends within 60 minutes after midnight, or if it was done offline and arrives within 48 hours from a phone that has not been online since. The streak is read from day records, never a counter. Frozen and won back days hold it and add nothing.

## The nine reviews

1. **11:58pm:** fixed. 60 minutes to finish what was begun.
2. **Plane:** fixed. Today and tomorrow play offline.
3. **Phone date:** fixed. Staying offline can still claim a day up to 48 hours late.
4. **Freeze, streak lost:** fixed. It counts from when buying began. The store is a fake.
5. **Paid, "failed":** fixed. Only Stripe's answer is shown, and what is not honoured is refunded.
6. **Call during the reveal:** fixed. Saved first, replays until seen. No real call was tried.
7. **Collection lags:** better, not proven without a cheap phone.
8. **Sticky swipes:** better, not proven. 35 of 35 flicks, but some batches lost a few on a slow emulator.
9. **Froze on a rare card:** better, not proven. Never seen to freeze.

## Cut

Binder screens, the planned cut: the table and the seeded pages exist. Search, password reset, email check, rate limits, session expiry.

## Still broken or not known

- No real phone, no cheap Android, no real call. Frame numbers are from an emulator. Never tried on a 32 bit phone.
- Stripe's real webhook was never received. The server asks Stripe itself instead.
- A refund that fails is tried every minute, and nobody is told.
- The fake store lives on the phone, so the server takes its word. A changed app could begin a purchase every day and pay only after a miss.
- If a streak is won back while a freeze is pending, or a late freeze covers it, the person keeps both.
- The offline bundle holds the answers and the reward, so a curious person can read them.
- Offline, a phone with its date moved forward shows tomorrow. The server refuses it.
- A large picture can take 20 seconds the first time. 27 are gone at their source and drawn as a slab.
- Closing the payment sheet takes about 6 seconds to say "Not paid".
- Several notices push the Buy button off the screen. On iOS the card is half grown when the details fade in.
