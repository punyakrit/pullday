import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HOUR, MINUTE, USER, World, card, challenge, playAll, settle } from './fakes';

const view = (engine: { getSnapshot(): { view: { kind: string } } }) => engine.getSnapshot().view.kind;

async function opened(iso: string) {
  const world = new World(iso);
  world.normal();
  const engine = world.open();
  await engine.sync();
  world.calls = [];
  return { world, engine, today: engine.getSnapshot().today! };
}

describe('the loop', () => {
  test('challenge first, then reveal, then done', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    assert.equal(view(engine), 'challenge');
    playAll(engine, today.challenge);
    assert.equal(view(engine), 'reveal');
    await settle();
    assert.deepEqual(world.calls, [`POST /challenges/${today.challenge.id}/start`, `POST /challenges/${today.challenge.id}/complete`]);
    const { view: shown } = engine.getSnapshot();
    assert.ok(shown.kind === 'reveal' && shown.reveal.saved && shown.reveal.card?.id === 'reward-2026-11-23');

    engine.revealShown(today.challenge.id);
    assert.equal(view(engine), 'reveal'); // stays until it is closed
    engine.closeReveal();
    assert.equal(view(engine), 'done');
    await settle();
    assert.ok(world.calls.includes(`POST /challenges/${today.challenge.id}/reveal-seen`));
    assert.equal(engine.getSnapshot().streakKnown, true);
  });

  test('the finish is on disk before the reveal shows', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    world.online = false;
    const onDisk: string[] = [];
    const stop = engine.subscribe(() => {
      if (view(engine) === 'reveal') onDisk.push(world.storage.get('user:u1:saved')!);
    });
    playAll(engine, today.challenge);
    stop();
    const { outbox } = (JSON.parse(onDisk[0]!) as { value: { outbox: { kind: string }[] } }).value;
    assert.deepEqual(outbox.map((item) => item.kind), ['start', 'complete']);
  });

  test('every swipe is final and counted once', async () => {
    const { engine, today } = await opened('2026-11-23T12:00:00Z');
    engine.answer(today.challenge, 0, 'rare');
    engine.answer(today.challenge, 0, 'holo'); // again
    engine.answer(today.challenge, 5, 'holo'); // out of order
    assert.deepEqual(engine.getSnapshot().saved.plays[today.challenge.id]!.answers, ['rare']);
  });

  test('a challenge done on another phone is done here', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    engine.answer(today.challenge, 0, 'rare');
    await settle();
    world.normal({ challenge: challenge('2026-11-23', { completedAt: '2026-11-23T11:00:00Z' }), todayDone: true });
    await engine.sync();
    assert.equal(view(engine), 'done');
  });
});

describe('killed', () => {
  test('mid swipe: the same card, the same answers', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    engine.answer(today.challenge, 0, 'rare');
    engine.answer(today.challenge, 1, 'holo');
    const again = world.open();
    const { view: shown } = again.getSnapshot();
    assert.deepEqual(shown.kind === 'challenge' && shown.answers, ['rare', 'holo']);
  });

  test('mid reveal: the reveal starts over, until it was shown to the end', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    playAll(engine, today.challenge);
    await settle();
    for (let i = 0; i < 2; i++) assert.equal(view(world.open()), 'reveal');
    engine.revealShown(today.challenge.id);
    assert.equal(view(world.open()), 'done');
  });

  test('offline with everything unsent: it is all sent later, in order', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    world.online = false;
    playAll(engine, today.challenge);
    engine.revealShown(today.challenge.id);
    await settle();
    const again = world.open();
    assert.equal(again.getSnapshot().unsent, 1);
    assert.equal(again.getSnapshot().streakKnown, false);
    world.online = true;
    await again.sync();
    const id = today.challenge.id;
    assert.deepEqual(world.calls.slice(0, 4), [
      `POST /challenges/${id}/start`,
      `POST /challenges/${id}/complete`,
      `POST /challenges/${id}/reveal-seen`,
      'GET /today',
    ]);
    assert.equal(again.getSnapshot().unsent, 0);
  });
});

describe('contact', () => {
  test('a refused start never stops the complete behind it', async () => {
    const { world, engine, today } = await opened('2026-11-23T20:00:00Z');
    world.online = false;
    playAll(engine, today.challenge);
    engine.revealShown(today.challenge.id);
    world.clock = '2026-11-24T10:00:00Z';
    world.online = true;
    const normal = world.respond;
    world.normal();
    const after = world.respond;
    world.respond = (method, path) =>
      path.endsWith('/start') ? { status: 409, body: { error: 'too_late', message: 'This day is over.' } } : after(method, path);
    void normal;
    await engine.sync();
    const id = today.challenge.id;
    assert.deepEqual(world.calls.slice(0, 4), [
      `POST /challenges/${id}/start`,
      `POST /challenges/${id}/complete`,
      `POST /challenges/${id}/reveal-seen`,
      'GET /today',
    ]);
    assert.deepEqual(engine.getSnapshot().saved.notices, []);
  });

  test('finished but unsent from a day that ended: no call that counts', async () => {
    const { world, engine, today } = await opened('2026-11-23T20:00:00Z');
    world.online = false;
    playAll(engine, today.challenge);
    world.clock = '2026-11-24T10:00:00Z';
    world.online = true;
    world.respond = () => ({ status: 503, body: 'busy' });
    await engine.sync();
    await assert.rejects(engine.get('/cards/c_0001'));
    assert.ok(world.calls.length > 0);
    assert.ok(world.calls.every((call) => call.endsWith('/start') || call.endsWith('/complete')), world.calls.join());
    assert.equal(engine.getSnapshot().connection, 'trouble');
  });

  test('begun but unfinished at midnight: held for 60 minutes, and shown first', async () => {
    const { world, engine, today } = await opened('2026-11-23T23:55:00Z');
    engine.answer(today.challenge, 0, 'rare');
    await settle();
    world.calls = [];
    for (const iso of ['2026-11-23T23:59:30Z', '2026-11-24T00:02:00Z', '2026-11-24T01:00:00Z']) {
      world.clock = iso;
      await engine.sync();
      await assert.rejects(engine.get('/cards/c_0001'));
      assert.deepEqual(world.calls, [], iso);
      const { view: shown } = engine.getSnapshot();
      assert.ok(shown.kind === 'challenge' && shown.challenge.id === today.challenge.id, iso);
    }
    world.clock = '2026-11-24T01:00:00.001Z';
    await engine.sync();
    assert.ok(world.calls.includes('GET /today'));
    const { view: shown } = engine.getSnapshot();
    assert.ok(shown.kind === 'challenge' && shown.challenge.day === '2026-11-24');
  });

  test('finished at 12:01: sent, revealed, and then the new day', async () => {
    const { world, engine, today } = await opened('2026-11-23T23:58:00Z');
    engine.answer(today.challenge, 0, 'rare');
    await settle();
    world.clock = '2026-11-24T00:01:00Z';
    for (let i = 1; i < 8; i++) engine.answer(today.challenge, i, 'common');
    await settle();
    assert.equal(view(engine), 'reveal');
    assert.ok(world.calls.includes(`POST /challenges/${today.challenge.id}/complete`));
    engine.revealShown(today.challenge.id);
    engine.closeReveal();
    await settle();
    const { view: shown } = engine.getSnapshot();
    assert.ok(shown.kind === 'challenge' && shown.challenge.day === '2026-11-24');
  });

  test('never begun: opening the app at 12:20am does not bring yesterday back', async () => {
    const { world, engine } = await opened('2026-11-23T20:00:00Z');
    world.clock = '2026-11-24T00:20:00Z';
    engine.refreshView();
    const { view: shown } = engine.getSnapshot();
    assert.ok(shown.kind === 'challenge' && shown.challenge.day === '2026-11-24'); // tomorrow's bundle, no connection needed
    await engine.sync();
    assert.ok(world.calls.includes('GET /today'));
  });

  test('a first touch after midnight does not hold anything', async () => {
    const { world, engine, today } = await opened('2026-11-23T20:00:00Z');
    world.clock = '2026-11-24T00:20:00Z';
    engine.begin(today.challenge); // a stale screen
    engine.refreshView();
    const { view: shown } = engine.getSnapshot();
    assert.ok(shown.kind === 'challenge' && shown.challenge.day === '2026-11-24');
  });

  test('outbox always first, and nothing else while it cannot be sent', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    world.online = false;
    engine.answer(today.challenge, 0, 'rare');
    await settle();
    world.online = true;
    world.respond = () => ({ status: 500, body: '' });
    world.calls = [];
    await engine.sync();
    assert.deepEqual(world.calls, [`POST /challenges/${today.challenge.id}/start`]);
  });

  test('something the server can never take is let go after 48 hours', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    world.online = false;
    playAll(engine, today.challenge);
    world.online = true;
    world.respond = (_method, path) => (path.includes(today.challenge.id) ? { status: 500, body: '' } : { status: 200, body: {} });
    world.clock = '2026-11-25T23:59:00Z';
    await engine.sync();
    assert.equal(engine.getSnapshot().unsent, 1);
    world.clock = '2026-11-26T00:01:00Z';
    world.normal();
    const normal = world.respond;
    world.respond = (method, path) => (path.includes(today.challenge.id) ? { status: 500, body: '' } : normal(method, path));
    await engine.sync();
    assert.equal(engine.getSnapshot().unsent, 0);
    assert.ok(world.calls.includes('GET /today'));
  });
});

describe('two days in the air', () => {
  test('both played from the bundle, both sent in order, no streak shown in between', async () => {
    const { world, engine, today } = await opened('2026-11-23T20:00:00Z');
    world.online = false;
    playAll(engine, today.challenge);
    engine.revealShown(today.challenge.id);
    engine.closeReveal();
    assert.equal(view(engine), 'done');
    world.clock = '2026-11-24T15:00:00Z';
    engine.refreshView();
    const { view: second } = engine.getSnapshot();
    assert.ok(second.kind === 'challenge' && second.challenge.id === today.tomorrow.id);
    playAll(engine, today.tomorrow);
    engine.revealShown(today.tomorrow.id);
    engine.closeReveal();
    assert.equal(engine.getSnapshot().streakKnown, false);

    world.clock = '2026-11-25T10:00:00Z';
    world.online = true;
    const known: boolean[] = [];
    engine.subscribe(() => {
      if (engine.getSnapshot().unsent > 0) known.push(engine.getSnapshot().streakKnown);
    });
    await engine.sync();
    const sent = world.calls.filter((call) => call.startsWith('POST')).map((call) => call.replace('POST /challenges/ch-', ''));
    assert.deepEqual(sent, [
      '2026-11-23/start', '2026-11-23/complete', '2026-11-23/reveal-seen',
      '2026-11-24/start', '2026-11-24/complete', '2026-11-24/reveal-seen',
    ]);
    assert.ok(known.every((one) => one === false));
    assert.equal(engine.getSnapshot().streakKnown, true);
  });

  test('a third day with no bundle asks for a connection', async () => {
    const { world, engine } = await opened('2026-11-23T20:00:00Z');
    world.online = false;
    world.clock = '2026-11-25T10:00:00Z';
    engine.refreshView();
    assert.equal(view(engine), 'empty');
  });
});

describe('out of space', () => {
  test('swiping goes on, the app says so, and it is saved once there is space', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    engine.answer(today.challenge, 0, 'rare');
    world.storage.full = true;
    engine.answer(today.challenge, 1, 'holo');
    engine.answer(today.challenge, 2, 'common');
    const { view: shown, unsaved } = engine.getSnapshot();
    assert.ok(unsaved && shown.kind === 'challenge' && shown.answers.length === 3);
    const killed = world.open().getSnapshot().view;
    assert.ok(killed.kind === 'challenge' && killed.answers.length === 1); // the last that was saved

    world.storage.full = false;
    engine.wake();
    assert.equal(engine.getSnapshot().unsaved, false);
    const again = world.open().getSnapshot().view;
    assert.ok(again.kind === 'challenge' && again.answers.length === 3);
  });

  test('the finish is neither on disk nor with the server: nothing is revealed', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    world.storage.full = true;
    world.online = false;
    playAll(engine, today.challenge);
    await settle();
    const { view: shown, unsent } = engine.getSnapshot();
    assert.ok(shown.kind === 'challenge' && shown.answers.length === 8);
    assert.equal(unsent, 1);

    world.storage.full = false; // space, still offline: now it is safe
    engine.wake();
    const { view: after } = engine.getSnapshot();
    assert.ok(after.kind === 'reveal' && !after.reveal.saved);
    assert.equal(world.open().getSnapshot().unsent, 1);
  });

  test('no space, but the server has it: revealed', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    world.storage.full = true;
    playAll(engine, today.challenge);
    assert.equal(view(engine), 'challenge');
    await settle();
    const { view: shown, unsaved } = engine.getSnapshot();
    assert.ok(unsaved && shown.kind === 'reveal' && shown.reveal.saved);
    engine.showReveal(today.challenge.id);
    engine.revealShown(today.challenge.id); // a save that fails does not take the open card away
    assert.equal(view(engine), 'reveal');
    engine.closeReveal();
    await settle();
    assert.equal(view(engine), 'done');
  });

  test('a late finish with no space: the new day, and the card once it is safe', async () => {
    const { world, engine, today } = await opened('2026-11-23T23:55:00Z');
    engine.answer(today.challenge, 0, 'rare');
    await settle();
    world.storage.full = true;
    world.online = false;
    world.clock = '2026-11-24T00:05:00Z';
    for (let i = 1; i < 8; i++) engine.answer(today.challenge, i, 'rare');
    const { view: shown } = engine.getSnapshot();
    assert.ok(shown.kind === 'challenge' && shown.challenge.day === '2026-11-24' && shown.waiting === null);
    world.storage.full = false;
    engine.wake();
    const { view: after } = engine.getSnapshot();
    assert.ok(after.kind === 'challenge' && after.waiting?.challengeId === today.challenge.id);
  });

  test('a full phone is not offline', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    world.storage.full = true;
    await engine.sync();
    assert.equal(engine.getSnapshot().connection, 'online');
    assert.deepEqual(world.calls, ['GET /today', 'GET /collection']);
  });
});

describe('what the server refuses', () => {
  const refuse = async (code: string, seen: boolean) => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    world.online = false;
    playAll(engine, today.challenge);
    if (seen) engine.revealShown(today.challenge.id);
    world.online = true;
    const normal = world.respond;
    world.respond = (method, path) =>
      path.endsWith('/complete') ? { status: 409, body: { error: code, message: 'no' } } : normal(method, path);
    await engine.sync();
    return engine.getSnapshot();
  };

  test('too late: says so, and says the card was not added if it was shown', async () => {
    const hidden = await refuse('too_late', false);
    assert.equal(hidden.saved.notices.length, 1);
    assert.doesNotMatch(hidden.saved.notices[0]!.text, /card you saw/);
    const shown = await refuse('too_late', true);
    assert.match(shown.saved.notices[0]!.text, /The card you saw was not added/);
    assert.equal(shown.unsent, 0);
  });

  test('too early: the day can still be played when it comes', async () => {
    const after = await refuse('too_early', true);
    assert.match(after.saved.notices[0]!.text, /Check the date/);
    assert.equal(after.view.kind, 'challenge');
    assert.deepEqual(after.saved.plays, {});
  });

  test('an account reset elsewhere: a half played challenge does not come back after midnight', async () => {
    const { world, engine, today } = await opened('2026-11-23T20:00:00Z');
    engine.answer(today.challenge, 0, 'rare');
    await settle();
    world.normal({ challenge: challenge('2026-11-23', { id: 'ch-new' }) });
    await engine.sync();
    assert.deepEqual(engine.getSnapshot().saved.plays, {});
    world.clock = '2026-11-24T00:01:00Z';
    engine.refreshView();
    const { view: shown } = engine.getSnapshot();
    assert.ok(shown.kind === 'challenge' && shown.challenge.day === '2026-11-24');
  });

  test('an account that was reset: dropped without a word', async () => {
    const after = await refuse('no_such_challenge', false);
    assert.deepEqual(after.saved.notices, []);
    assert.equal(after.view.kind, 'challenge');
  });

  test('the server gave a different card: that is the one shown', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    const normal = world.respond;
    world.respond = (method, path) => {
      const reply = normal(method, path);
      if (reply !== 'down' && path.endsWith('/complete')) Object.assign(reply.body as object, { card: card('other') });
      return reply;
    };
    playAll(engine, today.challenge);
    await settle();
    const { view: shown } = engine.getSnapshot();
    assert.ok(shown.kind === 'reveal' && shown.reveal.card?.id === 'other');
  });
});

describe('sessions', () => {
  test('only a 401 of ours logs out', async () => {
    const notOurs: [number, unknown][] = [
      [500, 'oops'], [503, ''], [502, '<html>'], [429, ''], [200, '<html>hotel wifi</html>'], [401, '<html>proxy</html>'],
      [403, { nope: true }], [404, { error: 'not_found', message: '' }], [401, { error: 'wrong_login', message: '' }],
    ];
    for (const [status, body] of notOurs) {
      const { world, engine } = await opened('2026-11-23T12:00:00Z');
      world.respond = () => ({ status, body });
      await engine.sync();
      assert.equal(world.signedOut, 0, `${status} ${JSON.stringify(body)}`);
    }
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    world.respond = () => ({ status: 401, body: { error: 'signed_out', message: 'Please log in again.' } });
    await engine.sync();
    assert.equal(world.signedOut, 1);
  });

  test('no network never logs out, and the cached day is still there', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    world.online = false;
    await engine.sync();
    assert.equal(world.signedOut, 0);
    assert.equal(engine.getSnapshot().connection, 'offline');
    assert.equal(view(world.open()), 'challenge');
  });

  test('a 401 while sending keeps the outbox, and it is sent after logging in again', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    world.respond = () => ({ status: 401, body: { error: 'signed_out', message: '' } });
    playAll(engine, today.challenge);
    await settle();
    assert.equal(world.signedOut, 1);
    const again = world.open();
    assert.equal(again.getSnapshot().unsent, 1);
    world.normal();
    world.calls = [];
    await again.sync();
    assert.equal(world.calls[1], `POST /challenges/${today.challenge.id}/complete`);
  });

  test("a late 401 for an old session does not end the new one", async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    world.respond = () => {
      world.api.startSession('new-token');
      return { status: 401, body: { error: 'signed_out', message: '' } };
    };
    await engine.sync();
    assert.equal(world.signedOut, 0);
  });

  test('pretending to be offline ends with the session, so the next log in gets through', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    world.api.pretendOffline = true;
    await engine.sync();
    assert.equal(engine.getSnapshot().connection, 'offline');
    assert.deepEqual(world.calls, []);
    // The rest is what session.ts does on a log out, or when the server ends the session.
    engine.stop();
    world.api.endSession();
    await world.api.call('POST', '/auth/login', {});
    assert.deepEqual(world.calls, ['POST /auth/login']);
  });

  test('one account never sees what another left on the phone', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    playAll(engine, today.challenge);
    const other = world.open({ ...USER, id: 'u2' });
    assert.equal(view(other), 'empty');
    assert.equal(other.getSnapshot().unsent, 0);
  });
});

describe('retries', () => {
  test('while something is unsent: 3 seconds, doubling, up to a minute', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    world.online = false;
    engine.answer(today.challenge, 0, 'rare');
    await settle();
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const timer = world.timers.at(-1)!;
      waits.push(timer.ms);
      world.timers = [];
      timer.work();
      await settle();
    }
    assert.deepEqual(waits, [3000, 6000, 12000, 24000, 48000, 60000, 60000]);
  });

  test('nothing unsent: no timer', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    world.online = false;
    await engine.sync();
    assert.deepEqual(world.timers, []);
  });

  test('waking several times in a row asks once, unless something is unsent', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    for (let i = 0; i < 4; i++) engine.wake();
    await settle();
    assert.deepEqual(world.calls, []); // it had only just asked
    world.time += 6_000;
    for (let i = 0; i < 4; i++) engine.wake();
    await settle();
    assert.deepEqual(world.calls, ['GET /today', 'GET /collection']);
    world.online = false;
    engine.answer(today.challenge, 0, 'rare');
    await settle();
    world.online = true;
    world.calls = [];
    engine.wake();
    await settle();
    assert.equal(world.calls[0], `POST /challenges/${today.challenge.id}/start`);
  });

  const wifi = { connected: true, reachable: true, kind: 'WIFI' };
  const none = { connected: false, reachable: false, kind: 'NONE' };

  test('a change of signal is not news: nothing is asked and nothing is drawn again', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    engine.network(wifi); // the first one, straight after opening
    await settle();
    assert.deepEqual(world.calls, []);
    let drawn = 0;
    engine.subscribe(() => drawn++);
    for (let i = 0; i < 20; i++) {
      world.time += 30_000;
      engine.network(wifi);
      await settle();
    }
    assert.deepEqual(world.calls, []);
    assert.equal(drawn, 0);
  });

  test('a connection that came back, or is of another kind, or now reaches the internet: asked once', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    const asked = async (...states: (typeof wifi)[]) => {
      world.time += 30_000;
      world.calls = [];
      for (const state of states) engine.network(state);
      await settle();
      return world.calls.join();
    };
    const once = 'GET /today,GET /collection';
    assert.equal(await asked(wifi), once);
    assert.equal(await asked(none), '');
    assert.equal(await asked(wifi, wifi, wifi), once);
    assert.equal(await asked({ ...wifi, kind: 'CELLULAR' }), once);
    assert.equal(await asked({ ...wifi, reachable: false }), once); // another kind again
    assert.equal(await asked({ ...wifi, reachable: false }), ''); // hotel wifi, not through yet
    assert.equal(await asked(wifi), once); // through
    assert.equal(await asked({ ...wifi, reachable: false }), '');
  });

  test('the connection comes back with something unsent: sent at once', async () => {
    const { world, engine, today } = await opened('2026-11-23T12:00:00Z');
    engine.network(none);
    world.online = false;
    engine.answer(today.challenge, 0, 'rare');
    await settle();
    world.online = true;
    engine.network(wifi);
    await settle();
    assert.equal(world.calls[0], `POST /challenges/${today.challenge.id}/start`);
  });

  test('while the last call failed, a change of signal is worth a try, but not all the time', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    engine.network(wifi);
    let tries = 0;
    world.respond = () => {
      tries++;
      return 'down';
    };
    await engine.sync();
    assert.equal(tries, 1);
    for (let i = 0; i < 10; i++) {
      world.time += 1_000;
      engine.network(wifi);
      await settle();
    }
    assert.equal(tries, 3); // at 5 and 10 seconds
    world.normal();
    world.time += 5_000;
    engine.network(wifi);
    await settle();
    assert.equal(engine.getSnapshot().connection, 'online');
    assert.deepEqual(world.calls, ['GET /today', 'GET /collection']);
  });

  test('five syncs at once make one request', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    await Promise.all(Array.from({ length: 5 }, () => engine.sync()));
    assert.deepEqual(world.calls, ['GET /today', 'GET /collection']);
  });
});

describe('the clock', () => {
  test('follows the server, not the phone', async () => {
    const world = new World('2026-11-23T12:00:00Z');
    world.normal();
    const engine = world.open();
    const server = world.time;
    world.time = server + 5 * HOUR; // the phone is 5 hours ahead
    const respond = world.respond;
    world.respond = (method, path) => {
      const reply = respond(method, path);
      if (reply !== 'down' && path === '/today') Object.assign(reply.body as object, { now: new Date(server).toISOString() });
      return reply;
    };
    await engine.sync();
    assert.equal(engine.clock.now(), server);
    world.time += 10 * MINUTE;
    assert.equal(engine.clock.now(), server + 10 * MINUTE);
    assert.equal(world.open().clock.now(), server + 10 * MINUTE); // also after a restart
  });

  test('a phone date moved back does not bring a day back', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    const before = engine.clock.now();
    world.time -= 72 * HOUR;
    assert.equal(engine.clock.now(), before);
  });

  test('a phone date moved back: the next time the app comes to the front it asks, and the clock is right again', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    const server = world.time;
    const respond = world.respond;
    world.respond = (method, path) => {
      const reply = respond(method, path);
      if (reply !== 'down' && path === '/today') Object.assign(reply.body as object, { now: new Date(server + HOUR).toISOString() });
      return reply;
    };
    world.time -= 24 * HOUR;
    engine.wake();
    await settle();
    assert.deepEqual(world.calls, ['GET /today', 'GET /collection']);
    world.time += 10 * MINUTE;
    assert.equal(engine.clock.now(), server + HOUR + 10 * MINUTE);
  });

  test('knows when to look again', async () => {
    const { engine } = await opened('2026-11-23T12:00:00Z');
    assert.equal(engine.nextChange(), Date.parse('2026-11-24T00:00:00Z'));
  });
});

describe('reveals from before', () => {
  test("today's challenge comes first, and the waiting card is offered", async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    world.normal({ unseenReveals: [{ challengeId: 'ch-2026-11-22', day: '2026-11-22', acquiredAt: '', card: card('old') }] });
    await engine.sync();
    const { view: shown } = engine.getSnapshot();
    assert.ok(shown.kind === 'challenge' && shown.waiting?.card?.id === 'old');
    engine.showReveal('ch-2026-11-22');
    assert.equal(view(engine), 'reveal');
    engine.revealShown('ch-2026-11-22');
    engine.closeReveal();
    await settle();
    assert.equal(view(engine), 'challenge');
    assert.ok(world.calls.includes('POST /challenges/ch-2026-11-22/reveal-seen'));
  });

  const waitingCard = { challengeId: 'ch-2026-11-22', day: '2026-11-22', acquiredAt: '', card: card('old') };

  test('a waiting card that is open stays open when the server stops listing it, until it is closed', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    world.normal({ unseenReveals: [waitingCard] });
    await engine.sync();
    engine.showReveal('ch-2026-11-22');
    engine.revealShown('ch-2026-11-22');
    await settle();
    world.normal(); // seen, so it is no longer waiting
    await engine.sync();
    const { view: shown } = engine.getSnapshot();
    assert.ok(shown.kind === 'reveal' && shown.reveal.card?.id === 'old' && shown.reveal.saved);

    engine.closeReveal();
    assert.equal(view(engine), 'challenge');
    await settle();
    assert.equal(view(engine), 'challenge');
    assert.equal(view(world.open()), 'challenge'); // and it does not come back
  });

  test('a waiting card seen on another phone, still sealed here: let go', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    world.normal({ unseenReveals: [waitingCard] });
    await engine.sync();
    const again = world.open(); // from what was cached
    again.showReveal('ch-2026-11-22');
    assert.equal(view(again), 'reveal');
    world.normal();
    await again.sync();
    assert.equal(view(again), 'challenge');
  });

  test('the open card is let go when the account starts over', async () => {
    const { world, engine } = await opened('2026-11-23T12:00:00Z');
    world.normal({ unseenReveals: [waitingCard] });
    await engine.sync();
    engine.showReveal('ch-2026-11-22');
    world.normal();
    engine.forget();
    await engine.sync();
    assert.equal(view(engine), 'challenge');
  });

  test('owning every card: a reveal with no card', async () => {
    const world = new World('2026-11-23T12:00:00Z');
    world.normal({ challenge: challenge('2026-11-23', { reward: null }) });
    const engine = world.open();
    await engine.sync();
    const { today } = engine.getSnapshot();
    world.online = false;
    playAll(engine, today!.challenge);
    const { view: shown } = engine.getSnapshot();
    assert.ok(shown.kind === 'reveal' && shown.reveal.card === null);
  });
});
