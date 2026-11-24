import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import { ANSWERS, Phone, TEST_EMAILS, chooseCards, clean, close, pickCards, pool, resetAccount } from './helpers.ts';

beforeEach(() => clean());
after(close);

const gone = (await pool.query<{ card_id: string }>('select card_id from cards_without_picture order by 1')).rows.map((row) => row.card_id);
const isGone = new Set(gone);

/** The account owns every card but these. */
const ownAllBut = (phone: Phone, ids: string[]) =>
  pool.query(
    `insert into collection (user_id, card_id, acquired_at, reveal_seen_at)
     select $1, id, now(), now() from cards where id <> all($2::text[])`,
    [phone.userId, ids],
  );

test('the list has the 27, and they stay in the catalogue', async () => {
  assert.equal(gone.length, 27);
  const { cards } = (await (await Phone.signUp()).call('GET', '/catalogue')).body;
  assert.equal(cards.length, 1993);
  assert.equal(cards.filter((card: { id: string }) => isGone.has(card.id)).length, 27);
});

describe('the reward', () => {
  test('never one with no picture while one other is left', async () => {
    for (const left of ['c_0500', 'c_1000', 'c_1500']) {
      const phone = await Phone.signUp();
      await ownAllBut(phone, [...gone, left]); // by chance this would be right 1 time in 28
      const { challenge, tomorrow } = await phone.today();
      assert.equal(challenge.reward.id, left);
      assert.ok(isGone.has(tomorrow.reward.id)); // nothing else is left
      assert.equal((await phone.complete(challenge.id)).body.card.id, left);
    }
  });

  test('also when it is picked on finishing, because the promised one came some other way', async () => {
    const phone = await Phone.signUp();
    await ownAllBut(phone, [...gone, 'c_0500', 'c_1000', 'c_1500']);
    const { challenge, tomorrow } = await phone.today();
    await pool.query('insert into collection (user_id, card_id, acquired_at, reveal_seen_at) values ($1, $2, now(), now())', [phone.userId, challenge.reward.id]);
    const { card } = (await phone.complete(challenge.id)).body;
    assert.ok(!isGone.has(card.id));
    assert.ok(![challenge.reward.id, tomorrow.reward.id].includes(card.id)); // and not the one promised for tomorrow
  });

  test('a card that is promised for tomorrow is not free: one with no picture goes first', async () => {
    const phone = await Phone.signUp();
    await ownAllBut(phone, [gone[0]!, 'c_0500', 'c_1000']);
    const { challenge, tomorrow } = await phone.today();
    await pool.query('insert into collection (user_id, card_id, acquired_at, reveal_seen_at) values ($1, $2, now(), now())', [phone.userId, challenge.reward.id]);
    assert.equal((await phone.complete(challenge.id)).body.card.id, gone[0]);
    assert.deepEqual((await phone.today()).tomorrow.reward, tomorrow.reward); // a phone may have shown it
  });

  test('when only they are left, they are given', async () => {
    const phone = await Phone.signUp();
    await ownAllBut(phone, gone);
    const { challenge, tomorrow } = await phone.today();
    assert.ok(isGone.has(challenge.reward.id) && isGone.has(tomorrow.reward.id));
    assert.deepEqual((await phone.complete(challenge.id)).body.card, challenge.reward);
  });
});

describe('the 8 cards', () => {
  test('none of them, over thousands of challenges', async () => {
    for (let i = 0; i < 2000; i++) {
      const ids = await pickCards(null);
      assert.equal(new Set(ids).size, 8);
      assert.deepEqual(ids.filter((id) => isGone.has(id)), []);
    }
  });

  test('in what the phone gets, for today and tomorrow', async () => {
    const { challenge, tomorrow } = await (await Phone.signUp()).today();
    for (const { cards } of [challenge, tomorrow]) assert.ok(cards.every((card: { id: string }) => !isGone.has(card.id)));
  });

  test('only as many as it takes when there are not enough others', () => {
    const rarities = ['common', 'rare', 'holo'] as const;
    const card = (id: string, i: number) => ({ id, game: 'g', name: id, set: 's', number: null, year: 2000, variety: null, grade: 9, rarity: rarities[i % 3]! });
    const list = Array.from({ length: 12 }, (_, i) => card(`k${i}`, i)); // 4 of each
    for (let i = 0; i < 200; i++) {
      // Of the 4 rares only k10 has a picture, so one more is needed. Of the commons only k0 has none.
      const noPicture = new Set(['k1', 'k4', 'k7', 'k0']);
      const ids = chooseCards(list, noPicture, null);
      assert.equal(new Set(ids).size, 8);
      assert.equal(ids.filter((id) => noPicture.has(id)).length, 1); // one rare, to make 2
      assert.ok(!chooseCards(list, noPicture, 'k10').includes('k10'));
      assert.equal(new Set(chooseCards(list, new Set(list.map(({ id }) => id)), null)).size, 8); // nothing else at all
    }
  });
});

test('what was already handed out does not change', async () => {
  const phone = await Phone.signUp();
  const { challenge } = await phone.today();
  const cards = [gone[1]!, ...challenge.cards.slice(1).map((card: { id: string }) => card.id)];
  await pool.query('update challenges set reward_card_id = $2, card_ids = $3 where id = $1', [challenge.id, gone[0], cards]);
  const again = (await phone.today()).challenge;
  assert.equal(again.reward.id, gone[0]);
  assert.deepEqual(again.cards.map((card: { id: string }) => card.id), cards);
  assert.equal((await phone.complete(challenge.id, ANSWERS)).body.card.id, gone[0]);
  assert.deepEqual((await phone.collection()).map((one) => one.cardId), [gone[0]]);
});

test('a test account is not given them either', async () => {
  for (const email of TEST_EMAILS) {
    await resetAccount(email, 'UTC');
    await (await Phone.logIn(email)).today();
  }
  const found = await pool.query(
    `select 1 from challenges c where c.reward_card_id = any($1::text[]) or c.card_ids && $1::text[]`,
    [gone],
  );
  assert.equal(found.rowCount, 0);
});
