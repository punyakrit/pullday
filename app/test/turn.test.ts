import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Engine } from '../src/core/engine';
import type { Reveal } from '../src/core/state';
import { type CardReveal, type Held, SEALED, type Turn, pictureOf, step, wordsFor } from '../src/core/turn';
import { World, card, playAll } from './fakes';

/** The reveal as the engine gives it now. */
function latest(engine: Engine): CardReveal {
  const { view } = engine.getSnapshot();
  assert.ok(view.kind === 'reveal' && view.reveal.card);
  return view.reveal as CardReveal;
}

/** All 8 played, the reveal is up, and the server has not answered yet. */
async function waitingForTheServer(given = 'reward-2026-11-23') {
  const world = new World('2026-11-23T12:00:00Z');
  world.normal();
  const engine = world.open();
  await engine.sync();
  const { challenge } = engine.getSnapshot().today!;
  const normal = world.respond;
  world.online = false;
  playAll(engine, challenge);
  await engine.sync();
  return {
    world,
    engine,
    before: latest(engine),
    async reply() {
      world.respond = (method, path) => {
        const answer = normal(method, path);
        if (answer !== 'down' && path.endsWith('/complete')) Object.assign(answer.body as object, { card: card(given, 'holo') });
        return answer;
      };
      world.online = true;
      await engine.sync();
      return latest(engine);
    },
  };
}

const pulled = step(SEALED, { kind: 'pull' });
const turningOver = (reveal: CardReveal) => step(pulled, { kind: 'ready', reveal });
const opened = (reveal: CardReveal) => step(turningOver(reveal), { kind: 'face' });
/** What Reveal.tsx draws. */
const drawn = (turn: Turn, now: Reveal) => turn.drawn ?? now;
const picture = (held: Held<string> | null, turn: Turn, now: Reveal) => {
  const { card: shown, saved } = drawn(turn, now);
  return pictureOf(held, shown?.id ?? null, saved);
};

describe('the server answers while a card is being revealed', () => {
  test('face up: the same card, the same picture, and only the words change', async () => {
    const { before, reply } = await waitingForTheServer();
    const turn = opened(before);
    const held = { cardId: before.card.id, saved: before.saved, image: 'pixels' };
    assert.deepEqual(wordsFor(before.card, before), { title: 'Your new card', line: "It joins your collection when you're online" });

    const after = await reply();
    assert.notEqual(after.card, before.card); // a new object for the same card: what made it flicker
    assert.equal(after.card.id, before.card.id);
    assert.equal(drawn(turn, after).card, before.card);
    assert.deepEqual(picture(held, turn, after), { state: 'ready', image: 'pixels' });
    assert.deepEqual(wordsFor(before.card, after), { title: 'Added to your collection', line: ' ' });
  });

  test('half way round: nothing the turn depends on changes, so it is not started again', async () => {
    const { before, reply } = await waitingForTheServer();
    const turn = turningOver(before);
    const held = { cardId: before.card.id, saved: before.saved, image: 'pixels' };
    const after = await reply();
    assert.equal(drawn(turn, after).card, before.card);
    assert.deepEqual(picture(held, turn, after), { state: 'ready', image: 'pixels' });
    // Everything that can arrive now leaves the very same turn. The buzz belongs to the turn.
    assert.equal(step(turn, { kind: 'ready', reveal: after }), turn);
    assert.equal(step(turn, { kind: 'pull' }), turn);
  });

  test('still in the sleeve: the same card keeps its picture', async () => {
    const { before, reply } = await waitingForTheServer();
    const held = { cardId: before.card.id, saved: before.saved, image: 'pixels' };
    const after = await reply();
    for (const turn of [SEALED, pulled]) assert.deepEqual(picture(held, turn, after), { state: 'ready', image: 'pixels' });
  });

  test('still in the sleeve, and it is another card: that is the one that will be turned over', async () => {
    const { before, reply } = await waitingForTheServer('other');
    const held = { cardId: before.card.id, saved: before.saved, image: 'pixels' };
    const after = await reply();
    for (const turn of [SEALED, pulled]) {
      assert.equal(drawn(turn, after).card?.id, 'other');
      assert.deepEqual(picture(held, turn, after), { state: 'loading' }); // never the other one's picture
    }
  });

  test('turning or face up, and it is another card: the one on screen stays, and the words say so', async () => {
    const { before, reply } = await waitingForTheServer('other');
    const held = { cardId: before.card.id, saved: before.saved, image: 'pixels' };
    const after = await reply();
    for (const turn of [turningOver(before), opened(before)]) {
      assert.equal(drawn(turn, after).card, before.card);
      assert.deepEqual(picture(held, turn, after), { state: 'ready', image: 'pixels' });
    }
    assert.deepEqual(wordsFor(before.card, after), { title: 'You already had this card', line: 'other was added instead' });
    assert.equal(wordsFor(before.card, { ...after, card: null }).line, 'You own every card');
  });

  test('left before it was seen: sealed again, and the newest card from the server', async () => {
    const { before, reply } = await waitingForTheServer('other');
    const after = await reply();
    for (const turn of [pulled, turningOver(before), opened(before)]) {
      assert.equal(drawn(step(turn, { kind: 'reset' }), after).card?.id, 'other');
    }
  });
});

test('sealed, pulled, turning, open: one step at a time, and never past one', async () => {
  const { before } = await waitingForTheServer();
  const ready = { kind: 'ready', reveal: before } as const;
  const stages = [SEALED, pulled, turningOver(before), opened(before)];
  assert.deepEqual(stages.map((turn) => turn.stage), ['sealed', 'pulled', 'turning', 'open']);
  assert.equal(step(SEALED, ready), SEALED);
  for (const turn of [SEALED, pulled, opened(before)]) assert.equal(step(turn, { kind: 'face' }), turn);
  for (const turn of [turningOver(before), opened(before)]) assert.equal(step(turn, { kind: 'pull' }), turn);
});

describe('a picture that could not be had', () => {
  const none = (saved: boolean): Held<string> => ({ cardId: 'reward-2026-11-23', saved, image: null });

  test('in the sleeve: asked for again once the server has answered, and then it is settled', async () => {
    const { before, reply } = await waitingForTheServer();
    assert.deepEqual(picture(none(false), SEALED, before), { state: 'none' });
    const after = await reply();
    assert.deepEqual(picture(none(false), SEALED, after), { state: 'loading' });
    assert.deepEqual(picture(none(true), SEALED, after), { state: 'none' });
  });

  test('face up: the words stay, they do not turn into a picture', async () => {
    const { before, reply } = await waitingForTheServer();
    const after = await reply();
    assert.deepEqual(picture(none(false), opened(before), after), { state: 'none' });
  });

  test('no card, no picture', () => {
    assert.deepEqual(pictureOf(null, null, false), { state: 'none' });
  });
});
