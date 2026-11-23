import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { Phone, buildApp, close } from './helpers.ts';

const { imageStore } = await import('../src/images.ts');

const photo = await sharp({ create: { width: 1500, height: 2100, channels: 3, background: '#d03020' } }).jpeg().toBuffer();
const small = await sharp({ create: { width: 300, height: 420, channels: 4, background: '#20408080' } }).png().toBuffer();
const sideways = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#ffffff' } })
  .withMetadata({ orientation: 6 })
  .jpeg()
  .toBuffer();
const noise = await sharp({ create: { width: 900, height: 900, channels: 3, background: '#000000', noise: { type: 'gaussian', mean: 120, sigma: 60 } } })
  .png()
  .toBuffer();

const hits: Record<string, number> = {};
let brokenNow = true;
const origin = createServer((request, reply) => {
  const name = request.url!.slice(1);
  hits[name] = (hits[name] ?? 0) + 1;
  if (name === 'c_0001') return void reply.writeHead(200, { 'content-type': 'image/jpeg' }).end(photo);
  if (name === 'c_0002') return void reply.writeHead(200, { 'content-type': 'application/octet-stream' }).end(small);
  if (name === 'c_0003') return void reply.writeHead(404).end('gone');
  if (name === 'c_0004') return; // never answers
  if (name === 'c_0005') return void reply.writeHead(200, { 'content-type': 'image/png' }).end(noise); // over the limit, says so
  if (name === 'c_0006') {
    reply.writeHead(200, { 'content-type': 'image/png' }); // over the limit, with no length
    for (let i = 0; i < noise.length; i += 65536) reply.write(noise.subarray(i, i + 65536));
    return void reply.end();
  }
  if (name === 'c_0007') return void reply.writeHead(200, { 'content-type': 'image/jpeg' }).end('<html>not a photo</html>');
  if (name === 'c_0008') return void reply.writeHead(200).end(photo.subarray(0, photo.length / 2)); // cut short
  if (name === 'c_0009') return void reply.writeHead(200, { 'content-type': 'image/jpeg' }).end(sideways);
  if (name === 'c_0010') {
    reply.writeHead(200, { 'content-type': 'image/jpeg' });
    return void reply.write(photo.subarray(0, 500)); // starts, then stalls
  }
  if (name === 'c_0011') return void (brokenNow ? reply.writeHead(503).end() : reply.writeHead(200).end(photo));
  if (name === 'c_0012') return void reply.writeHead(302, { location: '/c_0001' }).end();
  reply.writeHead(500).end();
});
await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${(origin.address() as AddressInfo).port}`;

const cacheDir = await mkdtemp(join(tmpdir(), 'pullday-images-'));
const images = {
  cacheDir,
  timeoutMs: 400,
  maxBytes: 500_000,
  urlFor: async (id: string) => (id === 'c_9999' ? null : `${address}/${id}`),
};
const app = buildApp({ devTools: false, images });
const get = (path: string) => app.inject({ method: 'GET', url: `/images/${path}` });

after(async () => {
  origin.closeAllConnections();
  origin.close();
  await app.close();
  await rm(cacheDir, { recursive: true });
  await close();
});

test('the test originals are the sizes they need to be', () => {
  assert.ok(noise.length > images.maxBytes);
  assert.ok(photo.length < images.maxBytes);
});

test('three widths, as webp, cached for good: one download for the small ones, one for the large', async () => {
  for (const width of [200, 400, 1080]) {
    const res = await get(`c_0001?w=${width}`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/webp');
    assert.match(String(res.headers['cache-control']), /immutable/);
    const info = await sharp(res.rawPayload).metadata();
    assert.equal(info.format, 'webp');
    assert.equal(info.width, width);
    assert.equal(info.height, Math.round((width * 2100) / 1500));
  }
  assert.equal(hits.c_0001, 2);
  for (const width of [200, 400, 1080]) await get(`c_0001?w=${width}`);
  assert.equal(hits.c_0001, 2);
});

test('greyscale has no colour left', async () => {
  const { data } = await sharp((await get('c_0001?w=200&grey=1')).rawPayload).raw().toBuffer({ resolveWithObject: true });
  const [r, g, b] = [data[0]!, data[1]!, data[2]!];
  assert.ok(Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2, `${r} ${g} ${b}`);
  const colour = await sharp((await get('c_0001?w=200')).rawPayload).raw().toBuffer();
  assert.ok(colour[0]! - colour[1]! > 100);
  assert.equal(hits.c_0001, 2);
});

test('wrong content type and transparency are handled, and small originals are not blown up', async () => {
  const res = await get('c_0002?w=1080');
  assert.equal(res.statusCode, 200);
  assert.equal((await sharp(res.rawPayload).metadata()).width, 300);
});

test('a sideways photo is turned the right way up', async () => {
  const info = await sharp((await get('c_0009?w=400')).rawPayload).metadata();
  assert.ok(info.height! > info.width!);
});

test('redirects are followed', async () => {
  assert.equal((await get('c_0012?w=200')).statusCode, 200);
});

test('the large picture of the reward is made when its challenge is handed out', async () => {
  const phone = await Phone.signUp();
  const asked = new Set<string>();
  const dir = `${cacheDir}/rewards`;
  const server = buildApp({
    devTools: false,
    prepareRewards: true,
    images: { ...images, cacheDir: dir, urlFor: async (id: string) => (asked.add(id), `${address}/c_0001`) },
  });
  const today = async () => (await server.inject({ method: 'GET', url: '/today', headers: { authorization: `Bearer ${phone.token}` } })).json();
  const { challenge, tomorrow } = await today();
  for (let i = 0; i < 100 && (await readdir(dir).catch(() => [])).filter((name) => name.includes('-1080')).length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual([...asked].sort(), [challenge.reward.id, tomorrow.reward.id].sort());
  const made = await readdir(dir);
  for (const { reward } of [challenge, tomorrow]) assert.ok(made.includes(`${reward.id}-1080.webp`), made.join());
  asked.clear();
  await today();
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual([...asked], []); // once
  await server.close();
});

test('ten requests at once make one download', async () => {
  hits.c_0001 = 0;
  const other = buildApp({ devTools: false, images: { ...images, cacheDir: `${cacheDir}/fresh` } });
  const all = await Promise.all(Array.from({ length: 10 }, () => other.inject('/images/c_0001?w=400')));
  for (const res of all) assert.equal(res.statusCode, 200);
  assert.equal(hits.c_0001, 1);
  await other.close();
});

test('a restart uses the disk cache', async () => {
  hits.c_0001 = 0;
  const restarted = buildApp({ devTools: false, images });
  assert.equal((await restarted.inject('/images/c_0001?w=200')).statusCode, 200);
  assert.equal(hits.c_0001, 0);
  await restarted.close();
});

test('a broken link is a 404, and is not asked for again straight away', async () => {
  for (let i = 0; i < 3; i++) {
    const res = await get('c_0003?w=200');
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, 'image_missing');
  }
  assert.equal(hits.c_0003, 1);
});

test('something that is not an image, or half of one, is not final', async () => {
  for (const id of ['c_0007', 'c_0008']) {
    const res = await get(`${id}?w=200`);
    assert.equal(res.statusCode, 504, id);
    assert.equal(res.headers['cache-control'], 'no-store', id);
  }
});

test('too large is refused, with or without a length', async () => {
  for (const id of ['c_0005', 'c_0006']) {
    const res = await get(`${id}?w=200`);
    assert.equal(res.statusCode, 404, id);
    assert.equal(res.json().error, 'image_missing', id);
  }
});

test('an origin that never answers, or stalls half way, times out and is not cached by the phone', async () => {
  for (const id of ['c_0004', 'c_0010']) {
    const before = Date.now();
    const res = await get(`${id}?w=200`);
    assert.equal(res.statusCode, 504, id);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.ok(Date.now() - before < 3000, id);
  }
});

test('an origin that is down for a moment is tried again later', async () => {
  assert.equal((await get('c_0011?w=200')).statusCode, 504);
  brokenNow = false;
  const realNow = Date.now;
  Date.now = () => realNow() + 31_000;
  try {
    assert.equal((await get('c_0011?w=200')).statusCode, 200);
  } finally {
    Date.now = realNow;
  }
});

test('bad requests and unknown cards', async () => {
  assert.equal((await get('c_0001?w=5000')).statusCode, 400);
  assert.equal((await get('c_0001?w=200&grey=yes')).statusCode, 400);
  assert.equal((await get('..%2f..%2fetc%2fpasswd')).statusCode, 400);
  assert.equal((await get('c_9999?w=200')).statusCode, 404);
});

test('warming makes the small sizes once, and leaves the large one for when it is asked for', async () => {
  hits.c_0001 = 0;
  const dir = `${cacheDir}/warm`;
  const store = imageStore({ ...images, cacheDir: dir });
  assert.equal(await store.warm('c_0001'), true);
  assert.deepEqual((await readdir(dir)).sort(), ['c_0001-200-grey.webp', 'c_0001-200.webp', 'c_0001-400-grey.webp', 'c_0001-400.webp']);
  assert.equal(await store.warm('c_0001'), false);
  assert.equal(hits.c_0001, 1);
  assert.ok((await store.get('c_0001', 1080, false)).length > 0);
  assert.equal(hits.c_0001, 2);
  await assert.rejects(store.warm('c_0003'), /404/);
  assert.deepEqual((await readdir(dir)).filter((name) => name.includes('1080')), ['c_0001-1080.webp']);
});

test('a full disk costs the cached copy, not the picture', async () => {
  const locked = `${cacheDir}/locked`;
  await mkdir(locked, { mode: 0o500 });
  const store = imageStore({ ...images, cacheDir: locked });
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.ok((await store.get('c_0001', 400, false)).length > 0);
    assert.ok((await store.get('c_0001', 400, false)).length > 0);
  } finally {
    console.error = quiet;
  }
  assert.deepEqual(await readdir(locked), []);
});

test('no half written files are left behind', async () => {
  const names = await readdir(cacheDir);
  assert.deepEqual(names.filter((name) => !name.endsWith('.webp') && !['fresh', 'warm', 'locked'].includes(name)), []);
});
