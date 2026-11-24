/**
 * Plays a full day for new@pullday.test against a running server, the way the phone will:
 * log in, 8 swipes, reveal, card in the collection, streak +1, and into the next day.
 *
 *   npm run play-day                        needs the server running with DEV_TOOLS=1
 *   API_URL=http://192.168.1.5:4000 npm run play-day
 */
import { randomUUID } from 'node:crypto';

const base = process.env.API_URL ?? 'http://127.0.0.1:4000';
let token = '';

async function call(method: string, path: string, body?: object): Promise<any> {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function check(label: string, ok: boolean, detail: unknown = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail === '' ? '' : `  (${detail})`}`);
  if (!ok) process.exitCode = 1;
}

async function play(): Promise<void> {
  const deviceId = randomUUID();
  ({ token } = await call('POST', '/auth/login', { email: 'new@pullday.test', password: 'pullday123', deviceId }));
  check('logged in as new@pullday.test', Boolean(token));
  await call('POST', '/dev/reset', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });

  let today = await call('GET', '/today');
  check('brand new: no streak, no cards, challenge waiting', today.streak === 0 && !today.todayDone, today.day);
  check('8 cards for today and 8 for tomorrow, with answers', today.challenge.cards.length === 8 && today.tomorrow.cards.length === 8);

  await call('POST', `/challenges/${today.challenge.id}/start`);
  // Get the first six right and the last two wrong. Finishing counts, the score does not.
  const answers = today.challenge.cards.map((card: { rarity: string }, i: number) =>
    i < 6 ? card.rarity : card.rarity === 'common' ? 'holo' : 'common',
  );
  for (const [i, card] of today.challenge.cards.entries()) {
    const right = answers[i] === card.rarity;
    console.log(`      swipe ${i + 1}: ${card.name} -> ${answers[i]} ${right ? 'right' : `wrong, it is ${card.rarity}`}`);
  }
  const done = await call('POST', `/challenges/${today.challenge.id}/complete`, { answers });
  check('finished all 8', done.score === 6, `score ${done.score}`);
  check('streak is 1', done.streak === 1 && done.todayDone);
  check('the card is the one the bundle promised', done.card.id === today.challenge.reward.id, done.card.name);

  // Killed here: the card must be safe and the reveal must come back.
  today = await call('GET', '/today');
  check('app killed before the reveal: it is waiting', today.unseenReveals[0]?.card.id === done.card.id);
  await call('POST', `/challenges/${done.challengeId}/reveal-seen`);
  const { cards } = await call('GET', '/collection');
  check('card in the collection, reveal seen', cards.length === 1 && cards[0].cardId === done.card.id && cards[0].revealSeenAt !== null);
  const details = await call('GET', `/cards/${done.card.id}`);
  check('card details', details.priceHistory.length === 13 && Number.isInteger(details.priceCents), `${details.priceCents} cents on ${details.priceDate}`);
  const image = await fetch(`${base}/images/${done.card.id}?w=400`);
  await image.arrayBuffer(); // a picture left unread holds the connection, and the script never ended
  const broken = image.status === 404; // 27 of 1993 originals are broken links
  check('card picture', (image.ok && image.headers.get('content-type') === 'image/webp') || broken, broken ? 'no picture for this card' : 'webp');

  const again = await call('POST', `/challenges/${done.challengeId}/complete`, { answers });
  check('doing it again does nothing', again.repeated && again.streak === 1 && again.card.id === done.card.id);

  const minutes = Math.ceil((Date.parse(today.endsAt) - Date.parse(today.now)) / 60_000);
  await call('POST', '/dev/move-time', { minutes });
  const next = await call('GET', '/today');
  check('midnight: a new day, a new challenge, streak still 1', next.day > today.day && !next.todayDone && next.streak === 1, next.day);
  check('it is the one the phone already had', next.challenge.id === today.tomorrow.id);

  await call('POST', '/dev/reset');
  await call('POST', '/auth/logout');
  console.log(process.exitCode ? '\nsomething is wrong' : '\na full day, played');
}

play().catch((err: Error) => {
  console.error(`\nstopped: ${err.message}${err.cause ? ` (${(err.cause as Error).message || 'is the server running?'})` : ''}`);
  process.exitCode = 1;
});
