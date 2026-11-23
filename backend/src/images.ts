import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import sharp, { type Sharp } from 'sharp';
import { config } from './config.ts';
import { pool } from './db.ts';
import { ApiError } from './errors.ts';

export const WIDTHS = [200, 400, 1080] as const;
export type Width = (typeof WIDTHS)[number];

sharp.cache(false); // our own cache is on disk; keep memory for decoding

async function urlFromCatalogue(id: string): Promise<string | null> {
  const found = await pool.query<{ image_url: string }>('select image_url from cards where id = $1', [id]);
  return found.rows[0]?.image_url ?? null;
}

const defaults = {
  cacheDir: config.imageCacheDir,
  urlFor: urlFromCatalogue,
  timeoutMs: 45_000, // a 14 MB original takes about 20 seconds here, longer on a slow line
  maxBytes: 20 * 1024 * 1024, // the largest original is 14.4 MB
  maxPixels: 100_000_000,
  parallel: 6, // enough that a few slow originals do not hold up the rest
};
export type ImageOptions = typeof defaults;

class OriginError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

/** Resized copies of card photos. Each original is downloaded once and kept in every size. */
export function imageStore(overrides: Partial<ImageOptions> = {}) {
  const options = { ...defaults, ...overrides };
  const working = new Map<string, Promise<void>>(); // one download per card, however many ask
  const failed = new Map<string, { error: OriginError; until: number }>();
  const waiting: (() => void)[] = [];
  let running = 0;

  const file = (id: string, width: Width, grey: boolean) => `${options.cacheDir}/${id}-${width}${grey ? '-grey' : ''}.webp`;

  async function download(url: string): Promise<Buffer> {
    const res = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs) });
    try {
      if (!res.ok) throw new OriginError(`origin said ${res.status}`, res.status === 404 || res.status === 410);
      if (Number(res.headers.get('content-length')) > options.maxBytes) throw new OriginError('too large', true);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of res.body ?? []) {
        size += chunk.length; // the header can be missing or wrong
        if (size > options.maxBytes) throw new OriginError('too large', true);
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } finally {
      await res.body?.cancel().catch(() => {}); // give the connection back
    }
  }

  async function save(path: string, data: Buffer): Promise<void> {
    const temporary = `${path}.${randomUUID()}`;
    await writeFile(temporary, data);
    await rename(temporary, path); // never a half written file
  }

  async function make(id: string): Promise<void> {
    const url = await options.urlFor(id);
    if (!url) throw new ApiError(404, 'no_such_card', 'We do not have that card.');
    const original = await download(url);
    let base: Sharp;
    try {
      // What it is comes from the bytes: 32 originals have the wrong content type.
      const image = sharp(original, { limitInputPixels: options.maxPixels, failOn: 'error' });
      const resized = image.autoOrient().resize({ width: 1080, withoutEnlargement: true }).flatten({ background: '#ffffff' });
      const { data, info } = await resized.toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
      base = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    } catch (err) {
      throw new OriginError(`not a usable image: ${(err as Error).message}`, true);
    }
    await mkdir(options.cacheDir, { recursive: true });
    for (const width of WIDTHS) {
      const sized = base.clone().resize({ width, withoutEnlargement: true });
      await save(file(id, width, false), await sized.clone().webp({ quality: 80 }).toBuffer());
      await save(file(id, width, true), await sized.clone().greyscale().webp({ quality: 75 }).toBuffer());
    }
  }

  /** At most a few at a time. The newest request goes first: it is what is on screen now. */
  async function inTurn(work: () => Promise<void>): Promise<void> {
    if (running >= options.parallel) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      await work();
    } finally {
      const next = waiting.pop();
      if (next) next(); // hand over the turn
      else running--;
    }
  }

  function makeOnce(id: string): Promise<void> {
    let job = working.get(id);
    if (!job) {
      job = inTurn(() => make(id)).finally(() => working.delete(id));
      working.set(id, job);
    }
    return job;
  }

  return async function getImage(id: string, width: Width, grey: boolean): Promise<Buffer> {
    const path = file(id, width, grey);
    const cached = await readFile(path).catch(() => null);
    if (cached) return cached;

    const before = failed.get(id);
    if (before && before.until > Date.now()) throw unavailable(before.error);
    try {
      await makeOnce(id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const error = err instanceof OriginError ? err : new OriginError((err as Error).message, false);
      failed.set(id, { error, until: Date.now() + (error.permanent ? 60 * 60_000 : 30_000) });
      throw unavailable(error);
    }
    failed.delete(id);
    return readFile(path);
  };
}

function unavailable(error: OriginError): ApiError {
  return error.permanent
    ? new ApiError(404, 'image_missing', 'This card has no picture.')
    : new ApiError(504, 'image_slow', 'This picture is taking too long. Try again in a moment.');
}
