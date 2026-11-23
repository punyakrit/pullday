# Pullday: Mobile Work Trial

Total time: **15 hours**. React Native + TypeScript. All tools allowed, including AI.

## The product

Pullday is a card collecting app built around a daily habit.

Every day there is one short challenge: you are shown 8 cards and you sort each one with a swipe (left = common, right = rare, up = holo). Finish the challenge and today's card is revealed and added to your collection. Do it every day and your streak grows. Miss a day and the streak breaks.

Two ways to protect a streak, both paid:

- **Streak freeze**: bought in advance from the in-app shop. If you miss a day, a freeze is used up automatically and the streak survives.
- **Win back**: your streak already broke. A screen offers to restore it for a small fee, paid by card.

Every card has a details page where you learn about it: the art, set, grade, price history and its story. The collection shows the full catalogue of about 2,000 cards, with the ones you own in colour and the rest greyed out. Owned cards can be arranged into 9-slot binder pages.

### The daily loop

1. Open the app. If today's challenge isn't done, it's the first thing you see.
2. Challenge: 8 cards from the catalogue, one at a time. Swipe left = common, right = rare, up = holo. Every swipe is final; the card shows if you were right. Finishing all 8 counts, the score doesn't.
3. Reveal: you get one card you don't own yet, shown with a reveal moment. It goes into your collection.
4. Streak +1. Doing the challenge again the same day does nothing.

### Screens

Log in / sign up, Today (challenge + reveal), Collection (full catalogue, owned in colour), Card details, Binder, Shop (freeze), Streak.

### Rules

| Rule | Value |
| --- | --- |
| Users | Email + password sign up and log in. Sessions survive app restarts. |
| Challenge | 8 cards, the correct answer is the card's `rarity` |
| Daily card | A random card the user doesn't own, decided by the server |
| Streak freeze | $1.99, hold up to 2, used automatically on a missed day |
| Win back | $4.99, available for 48 hours after a streak breaks |
| What counts as "a day" | You decide, and explain why in `DECISIONS.md` |
| Testing helpers | Add a dev menu to grant cards and move time; we will use it in the check-in |

### Test accounts

Seed these so we can log in and see each state (password `pullday123` for all):

| Email | State |
| --- | --- |
| `new@pullday.test` | Brand new, nothing done |
| `today@pullday.test` | 12-day streak, today's challenge not done yet |
| `done@pullday.test` | 30-day streak, today already done |
| `freeze@pullday.test` | 7-day streak, missed yesterday, owns 1 freeze |
| `broken@pullday.test` | 40-day streak broke yesterday, win back open |
| `collector@pullday.test` | 300 cards owned, 5 binder pages filled |

## Pullday v1 is live, and the reviews are bad

> "did my challenge at 11:58pm, streak reset anyway"
>
> "did it on the plane with no wifi, didn't count"
>
> "my friend has a 400 day streak, he just changes his phone date"
>
> "bought a freeze, got charged, still lost my streak"
>
> "paid to win back my streak, it said failed, money still gone"
>
> "took a call while my card was being revealed, came back and the card was gone"
>
> "collection screen lags so bad on my phone"
>
> "swiping the cards feels sticky, half my swipes don't register"
>
> "app froze when the rare card came out"

Build Pullday so these reviews stop. **You won't finish everything, and that is on purpose.** We grade what you chose to build, the order you built it in, and how well it works on a real phone. Volume earns nothing.

Our advice: get one full loop working end to end first (challenge, reveal, card in collection, streak +1), then make it solid, then add more.

## What we give you

- `schema.sql` and `data.sql`: a Postgres catalogue of about 2,000 cards (name, set, number, year, grade, rarity, price in cents, population, a 13-week price history, a short story, an image URL). Prices, history, population, stories and images are generated test data.
- Card images are URLs. Treat them like real production images.

## What you build

- **The app, in React Native + TypeScript.** Expo or bare React Native, your choice. iOS or Android, your choice; tell us which one you tested on.
- **A minimal backend**, in whatever you like (Node, Supabase, Firebase...). It needs to handle sign up and log in, serve the cards, hold each user's streak and collection, seed the test accounts, and create card payments. Keep it small: the backend is only graded on correctness, not on how much of it there is. Spend your hours on the phone.
- **Payments**:
  - Win back: use **Stripe in test mode** (create a free Stripe account, test cards work without real money). The Stripe React Native SDK is fine.
  - Streak freeze: real App Store / Play billing is out of scope. Write a small fake store module that behaves like a real one (purchases can be pending, succeed, fail or be cancelled) and use it from the shop screen.

The feature list in "The product" is more than 15 hours of work. Pick, and tell us why.

## What we look at

- **Interactions and feel**: how swipes, the reveal, scrolling and transitions feel under your thumb, on a real phone, including a cheap Android.
- **Native mobile behaviour**: what happens when the app is backgrounded or killed, goes offline, gets a call, or comes back from another app. Platform conventions on iOS and Android.
- **UX**: loading, empty and error states, and what the user sees when something goes wrong.
- **Attention to detail**: the small things a user notices without being able to name them.
- **Correctness**: streaks, collections and money are always right.
- **Judgment**: what you built first, what you cut, and how honestly you describe what's broken.

## Rules

- Use any tools you like, including AI. You must be able to explain and change anything you hand in.
- Test on a real phone. We will.
- Make it obvious this is a test app: no real app names, logos or app store listings. Card names and sets in the data are real; that is fine.

## Check-in

Partway through, we do a 30-minute call. You show us the app on your phone, we try a few things on it, and we ask why you built what you built first. We will give you one piece of feedback; we will look for it in the final submission.

## Hand-in

1. The repo (app + backend), with your git history as is. Small, frequent commits help us follow your thinking.
2. `README.md`: how to run it, from a fresh clone, in under 10 minutes.
3. `DECISIONS.md` (one page): what you built and why in that order, what you cut, and anything you know is still broken. Honesty here scores higher than a list of features.
4. `AI.md`: what you used AI for, where it was wrong, and what you threw away.
5. A screen recording (3 to 5 minutes) on a real device showing the main loop, including what happens when the app is killed in the middle of something.
