import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { ANSWERS, Phone, clean, close } from './helpers.ts';

beforeEach(() => clean());
after(close);

test('the whole loop: challenge, reveal, card in collection', async () => {
  const phone = await Phone.signUp();
  const today = await phone.today();
  assert.equal(today.day, '2026-11-23');
  assert.equal(today.challenge.cards.length, 8);
  assert.deepEqual(await phone.collection(), []);

  const started = await phone.start(today.challenge.id);
  assert.equal(started.status, 200);
  const answers = today.challenge.cards.map((card: { rarity: string }) => card.rarity);
  const done = await phone.complete(today.challenge.id, answers);
  assert.equal(done.status, 200);
  assert.equal(done.body.score, 8);
  assert.deepEqual(done.body.card, today.challenge.reward); // the card that was promised

  const seen = await phone.revealSeen(today.challenge.id);
  assert.equal(seen.status, 200);
  const owned = await phone.collection();
  assert.deepEqual(owned.map((card) => card.cardId), [today.challenge.reward.id]);
  assert.ok(owned[0]!.revealSeenAt);
  assert.deepEqual((await phone.today()).unseenReveals, []);
});

test('finishing counts even with a score of 0', async () => {
  const phone = await Phone.signUp();
  const { challenge } = await phone.today();
  const wrong = challenge.cards.map((card: { rarity: string }) => (card.rarity === 'common' ? 'holo' : 'common'));
  const done = await phone.complete(challenge.id, wrong);
  assert.equal(done.body.score, 0);
  assert.ok(done.body.card);
});

test('a bundle is 8 different cards with at least 2 of each rarity, and never the reward', async () => {
  for (let i = 0; i < 25; i++) {
    const { challenge, tomorrow } = await (await Phone.signUp()).today();
    for (const bundle of [challenge, tomorrow]) {
      const ids = bundle.cards.map((card: { id: string }) => card.id);
      assert.equal(new Set(ids).size, 8);
      assert.ok(!ids.includes(bundle.reward.id));
      for (const rarity of ['common', 'rare', 'holo']) {
        assert.ok(bundle.cards.filter((card: { rarity: string }) => card.rarity === rarity).length >= 2, rarity);
      }
    }
    assert.notEqual(challenge.reward.id, tomorrow.reward.id);
  }
});

test('asking again gives the same challenge and the same reward', async () => {
  const phone = await Phone.signUp();
  const first = await phone.today();
  const second = await phone.today();
  assert.deepEqual(second.challenge, first.challenge);
  assert.deepEqual(second.tomorrow, first.tomorrow);
});

test('all 8 answers are needed, and only real ones', async () => {
  const phone = await Phone.signUp();
  const { challenge } = await phone.today();
  for (const answers of [ANSWERS.slice(1), [...ANSWERS, 'common'], [...ANSWERS.slice(1), 'legendary'], []]) {
    assert.equal((await phone.complete(challenge.id, answers)).status, 400);
  }
  assert.deepEqual(await phone.collection(), []);
});

test("another person's challenge does not exist for you", async () => {
  const { challenge } = await (await Phone.signUp()).today();
  const other = await Phone.signUp();
  assert.equal((await other.start(challenge.id)).status, 404);
  assert.equal((await other.complete(challenge.id)).status, 404);
  assert.equal((await other.revealSeen(challenge.id)).status, 404);
});
