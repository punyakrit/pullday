# Measurements

**Nothing here was measured on a real phone.** 23 November 2026, release builds, `collector@pullday.test` (300 of 1,993 cards), the backend on the same Mac (M5 Max) with every small picture already made.

- Android: emulator, Android 17 (API 37), arm64, 4 cores, 3 GB, 720x1600 at 2x. Grid pictures are the 200 px ones, 12 to 16 KB each.
- iOS: simulator, iPhone 17, iOS 26.5, 3x. Grid pictures are the 400 px ones.

How: hard flings (14 unless said), the screen recorded, every frame checked for bare background (nothing drawn) and for cells whose picture is not there yet (the name is). Janky frames and memory from `dumpsys`.

## Scrolling the whole collection

| Run | Frames | Janky | p90 / p99 | Bare: average, worst frame | No picture yet: average, worst |
| --- | --- | --- | --- | --- | --- |
| Android, 8 flings, cached | 423 | 0.7% | 18 / 20 ms | 0.00%, 0.0% | 1.6%, 11% |
| Android, cached | 576 | 1.4% | 19 / 23 ms | 0.00%, 0.0% | 1.3%, 24% |
| Android, partly cached | 594 | 1.5% | 24 / 34 ms | 0.01%, 2.8% | 1.6%, 23% |
| Android, empty cache, 200 ms delay, 3 Mbit/s | 597 | 2.5% | 19 / 34 ms | 0.00%, 0.0% | 81%, 89% |
| Android, last build, 6 runs | 519 to 622 | 1.9 to 5.7% | 18 to 38 / 19 to 65 ms | 0.00 to 0.02%, 2.9% | 1 to 28%, 88% |
| iOS simulator, 4 flings, mostly cached | 83 | not measured | not measured | 0.00%, 0.0% | 0.02%, 0.5% |

Memory on Android after a run: 176 to 186 MB (PSS).

Step 7, the new look, 24 November 2026, 8 hard flings: 420 frames, 5.5% janky, p90 / p99 34 / 48 ms, bare 0.00%, no picture yet 0.00%, memory 184 MB. Collection is now made on its first open: Today alone asks for 18 pictures, opening Collection for 29 more, of 1,993.

## Flicks

7 flicks of 40 points in 60 ms, on a fresh challenge, at gaps of 0.05 to 0.4 s, 5 times: how many of 35 were counted.

| When, 24 November | Build | Counted |
| --- | --- | --- |
| 1:47 | new look and motion | 35 |
| 2:07 | + swipe down fix | 32 |
| 2:17 | the same, one spring for the dot | 29, 29 |
| 2:17, in turn with it | the same with no new motion | 32, 28 |
| 2:23, in turn | the build from before step 7 | 35, 35 |
| 2:23, in turn | one spring for the dot | 35, 35 |
| 2:30, six busy loops on 4 cores, in turn | the same | 35, 35 |
| 2:30, in turn | + a late flick counts (the last build) | 35, then 21 of 21 with one run that could not be read |
| 2:45, nothing else running | the last build | 35 |

The motion made no difference. What did is not known: the emulator's slow state, or another touch on it. On one recording of a lost flick the card moves and comes back, which is what a touch that is heard of late looks like, so that is fixed. It could not be seen losing one again.

## Opening and closing a card, Android

4 cards, open and back: 254 to 274 frames, 12 to 15% janky, p90 32 to 40 ms, p99 85 to 113 ms. Android Settings, opening 4 pages the same way: 42% janky, p90 93 ms, p99 200 ms.

## What the numbers are worth

The emulator is in a fast state or a slow one, for minutes, with nothing else running. The same flings on Android's own Settings scored 3% janky in the fast state and 59 to 82% in the slow one. In the slow state pictures come late too (15 to 28% without one, against 1 to 2%). So bare area is a finding, since it stayed at 0.02% or less in both. Janky frames are only good for comparing with Settings in the same minute.

## Still unknown

- Everything about a real phone: frames, heat, memory, how the fling feels, a slow disk.
- A cheap Android. This emulator has an M5's cores behind it. A phone with 2 GB, or a 32 bit one, was never tried.
- Pictures over a real mobile network, and from a deployed backend.
- Frames on iOS. The simulator draws with the Mac.
- The largest system text in the grid, and TalkBack or VoiceOver by hand.
