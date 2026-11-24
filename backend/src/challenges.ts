import { type User, getZones } from './auth.ts';
import { type CardSummary, type Rarity, catalogue, summary } from './cards.ts';
import type { Db } from './db.ts';
import { type Day, type Zone, addDays, currentDay, dayEnd, dayStart, judge, nextDay } from './days.ts';
import { ApiError } from './errors.ts';
import { owePaymentsFixedLate } from './payments.ts';
import { getStreak, refundExtra, replay, settle } from './streak.ts';
import { zoneStatus } from './timezone.ts';
import { now } from './time.ts';

type Challenge = {
  id: string;
  day: Day;
  card_ids: string[];
  reward_card_id: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  answers: Rarity[] | null;
};

const COLUMNS = 'id, day, card_ids, reward_card_id, started_at, completed_at, answers';

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** 8 different cards: 2 common, 2 rare, 2 holo, and 2 from anywhere. Never the reward. */
export async function pickCards(rewardId: string | null): Promise<string[]> {
  const { list, noPicture } = await catalogue();
  return chooseCards(list, noPicture, rewardId);
}

/** A card with no picture only if there are not enough others. */
export function chooseCards(list: CardSummary[], noPicture: Set<string>, rewardId: string | null): string[] {
  const shuffled = shuffle(list.filter((card) => card.id !== rewardId));
  const pool = [...shuffled.filter((card) => !noPicture.has(card.id)), ...shuffled.filter((card) => noPicture.has(card.id))];
  const picked: CardSummary[] = [];
  for (const rarity of ['common', 'rare', 'holo'] as const) {
    picked.push(...pool.filter((card) => card.rarity === rarity).slice(0, 2));
  }
  picked.push(...pool.filter((card) => !picked.includes(card)).slice(0, 2));
  return shuffle(picked).map((card) => card.id);
}

/**
 * A random card the user does not own, or null if they own every one. A card promised by
 * another unfinished challenge is left alone, because a phone that is offline may already have
 * shown it. When finishing, taking a promised card beats giving nothing. A card with no picture
 * is given only when no other is left.
 */
async function pickReward(db: Db, userId: string, today: Day, forDay: Day, takePromised = false): Promise<string | null> {
  const found = await db.query<{ id: string }>(
    `with promised as (
       select reward_card_id as id from challenges
        where user_id = $1 and completed_at is null and reward_card_id is not null and day >= $2 and day <> $3)
     select c.id from cards c
      where not exists (select 1 from collection o where o.user_id = $1 and o.card_id = c.id)
        and ($4 or c.id not in (select id from promised))
      order by c.id in (select id from promised), c.id in (select card_id from cards_without_picture), random()
      limit 1`,
    [userId, addDays(today, -4), forDay, takePromised],
  );
  return found.rows[0]?.id ?? null;
}

async function owns(db: Db, userId: string, cardId: string): Promise<boolean> {
  const found = await db.query('select 1 from collection where user_id = $1 and card_id = $2', [userId, cardId]);
  return Boolean(found.rowCount);
}

/** Find or make the challenge for a day, and note that this phone now has it. */
async function issue(db: Db, user: User, today: Day, day: Day, deviceId: string): Promise<Challenge> {
  const found = await db.query<Challenge>(`select ${COLUMNS} from challenges where user_id = $1 and day = $2`, [
    user.id,
    day,
  ]);
  let challenge = found.rows[0];
  if (!challenge) {
    const reward = await pickReward(db, user.id, today, day);
    const made = await db.query<Challenge>(
      `insert into challenges (user_id, day, card_ids, reward_card_id) values ($1, $2, $3, $4) returning ${COLUMNS}`,
      [user.id, day, await pickCards(reward), reward],
    );
    challenge = made.rows[0]!;
  } else if (!challenge.completed_at) {
    // The promised card can be taken by a dev grant, or a new card can become available.
    const reward = challenge.reward_card_id;
    if (!reward || (await owns(db, user.id, reward))) {
      challenge.reward_card_id = await pickReward(db, user.id, today, day);
      await db.query('update challenges set reward_card_id = $2 where id = $1', [challenge.id, challenge.reward_card_id]);
    }
  }
  await db.query(
    'insert into bundle_issues (challenge_id, device_id, issued_at) values ($1, $2, $3) on conflict do nothing',
    [challenge.id, deviceId, now(user)],
  );
  return challenge;
}

async function describe(challenge: Challenge, zones: Zone[]) {
  return {
    id: challenge.id,
    day: challenge.day,
    startsAt: dayStart(zones, challenge.day),
    endsAt: dayEnd(zones, challenge.day),
    startedAt: challenge.started_at,
    completedAt: challenge.completed_at,
    answers: challenge.answers,
    cards: await Promise.all(challenge.card_ids.map(summary)),
    reward: challenge.reward_card_id ? await summary(challenge.reward_card_id) : null,
  };
}

async function unseenReveals(db: Db, userId: string) {
  const found = await db.query<{ challenge_id: string; card_id: string; acquired_at: Date; day: Day }>(
    `select o.challenge_id, o.card_id, o.acquired_at, c.day
       from collection o join challenges c on c.id = o.challenge_id
      where o.user_id = $1 and o.reveal_seen_at is null order by c.day`,
    [userId],
  );
  return Promise.all(
    found.rows.map(async (row) => ({
      challengeId: row.challenge_id,
      day: row.day,
      acquiredAt: row.acquired_at,
      card: await summary(row.card_id),
    })),
  );
}

/** Started before midnight and not finished: the phone may carry on with it. */
async function resumable(db: Db, user: User, zones: Zone[], today: Day) {
  if (user.settled_through >= addDays(today, -1)) return null; // settling stops only for this
  const found = await db.query<Challenge>(
    `select ${COLUMNS} from challenges where user_id = $1 and day = $2 and completed_at is null`,
    [user.id, addDays(user.settled_through, 1)],
  );
  return found.rows[0] ? describe(found.rows[0], zones) : null;
}

/** Everything the phone needs to play today and tomorrow with no connection. */
export async function getToday(db: Db, user: User, deviceId: string) {
  const at = now(user);
  const zones = await getZones(db, user.id);
  const today = currentDay(zones, at);
  await settle(db, user, zones, at);
  return {
    now: at,
    day: today,
    endsAt: dayEnd(zones, today),
    ...zoneStatus(zones, today),
    ...(await getStreak(db, user, today, at)),
    resume: await resumable(db, user, zones, today),
    challenge: await describe(await issue(db, user, today, today, deviceId), zones),
    tomorrow: await describe(await issue(db, user, today, nextDay(zones, today), deviceId), zones),
    unseenReveals: await unseenReveals(db, user.id),
  };
}

async function findChallenge(db: Db, userId: string, id: string): Promise<Challenge> {
  const found = await db.query<Challenge>(`select ${COLUMNS} from challenges where id = $1 and user_id = $2`, [id, userId]);
  if (!found.rows[0]) throw new ApiError(404, 'no_such_challenge', 'That challenge does not exist.');
  return found.rows[0];
}

/** Only a start heard during the day counts. The first one is kept. */
export async function start(db: Db, user: User, challengeId: string) {
  const at = now(user);
  const challenge = await findChallenge(db, user.id, challengeId);
  const zones = await getZones(db, user.id);
  if (!challenge.completed_at && !challenge.started_at) {
    if (at < dayStart(zones, challenge.day)) throw new ApiError(409, 'too_early', 'This challenge is not open yet.');
    if (at >= dayEnd(zones, challenge.day)) throw new ApiError(409, 'too_late', 'This day is over.');
    challenge.started_at = at;
    await db.query('update challenges set started_at = $2 where id = $1', [challenge.id, at]);
  }
  return { challengeId: challenge.id, startedAt: challenge.started_at, completedAt: challenge.completed_at };
}

async function result(db: Db, user: User, zones: Zone[], challenge: Challenge, repeated: boolean) {
  const at = now(user);
  const cards = await Promise.all(challenge.card_ids.map(summary));
  return {
    challengeId: challenge.id,
    day: challenge.day,
    completedAt: challenge.completed_at,
    score: cards.filter((card, i) => card.rarity === challenge.answers?.[i]).length,
    card: challenge.reward_card_id ? await summary(challenge.reward_card_id) : null, // null: owns every card
    repeated,
    ...(await getStreak(db, user, currentDay(zones, at), at)),
  };
}

/**
 * Finish a challenge: the card, the day and the streak, all or nothing. The caller holds the
 * user lock, so a second tap or a second phone waits here and then gets the stored result.
 */
export async function complete(db: Db, user: User, deviceId: string, challengeId: string, answers: Rarity[]) {
  const at = now(user);
  const challenge = await findChallenge(db, user.id, challengeId);
  const zones = await getZones(db, user.id);
  if (challenge.completed_at) {
    await settle(db, user, zones, at);
    return result(db, user, zones, challenge, true);
  }

  const phone = await db.query<{ issued_at: Date | null; last_contact_at: Date | null }>(
    `select b.issued_at, d.last_contact_at from devices d
       left join bundle_issues b on b.device_id = d.device_id and b.challenge_id = $3
      where d.user_id = $1 and d.device_id = $2`,
    [user.id, deviceId, challenge.id],
  );
  const verdict = judge({
    now: at,
    dayStart: dayStart(zones, challenge.day),
    dayEnd: dayEnd(zones, challenge.day),
    startedAt: challenge.started_at,
    bundleIssuedAt: phone.rows[0]?.issued_at ?? null,
    lastContactAt: phone.rows[0]?.last_contact_at ?? null,
  });
  if (verdict === 'too_early') throw new ApiError(409, 'too_early', 'This challenge is not open yet.');
  if (verdict === 'too_late') throw new ApiError(409, 'too_late', 'This day ended before we heard from you.');

  let reward = challenge.reward_card_id;
  if (!reward || (await owns(db, user.id, reward))) {
    reward = await pickReward(db, user.id, currentDay(zones, at), challenge.day, true);
  }
  if (reward) {
    await db.query('insert into collection (user_id, card_id, acquired_at, challenge_id) values ($1, $2, $3, $4)', [
      user.id,
      reward,
      at,
      challenge.id,
    ]);
  }
  await db.query('update challenges set completed_at = $2, answers = $3, reward_card_id = $4 where id = $1', [
    challenge.id,
    at,
    answers,
    reward,
  ]);
  await db.query(
    `insert into day_records (user_id, day, status) values ($1, $2, 'done')
     on conflict (user_id, day) do update set status = 'done'`,
    [user.id, challenge.day],
  );
  await replay(db, user, zones, challenge.day, at);
  await refundExtra(db, user.id, at); // a freeze that came back may make 3
  await owePaymentsFixedLate(db, user.id, at);
  return result(db, user, zones, { ...challenge, completed_at: at, answers, reward_card_id: reward }, false);
}

export async function revealSeen(db: Db, user: User, challengeId: string) {
  await findChallenge(db, user.id, challengeId);
  await db.query(
    'update collection set reveal_seen_at = $3 where user_id = $1 and challenge_id = $2 and reveal_seen_at is null',
    [user.id, challengeId, now(user)],
  );
  return { challengeId, seen: true };
}

export async function getCollection(db: Db, userId: string) {
  const found = await db.query(
    `select card_id as "cardId", acquired_at as "acquiredAt", reveal_seen_at as "revealSeenAt"
       from collection where user_id = $1 order by acquired_at desc, card_id`,
    [userId],
  );
  return { cards: found.rows };
}
