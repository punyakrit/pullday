import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import sharp, { type Sharp } from 'sharp';
import { config } from './config.ts';
import { pool } from './db.ts';
import { ApiError } from './errors.ts';

export const WIDTHS = [200, 400, 1080] as const;
export type Width = (typeof WIDTHS)[number];
export type Variant = { width: Width; grey: boolean };

/** Small enough to keep for every card: about 135 KB a card, in four files. */
export const SMALL: Variant[] = [200, 400].flatMap((width) => [false, true].map((grey) => ({ width: width as Width, grey })));

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

export class OriginError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

/**
 * Resized copies of card photos. A download makes the small set, and the large one only if that
 * is what was asked for, because the large ones would fill a small disk.
 */
export function imageStore(overrides: Partial<ImageOptions> = {}) {
  const options = { ...defaults, ...overrides };
  const working = new Map<string, Promise<Buffer>>(); // one download, however many ask
  const failed = new Map<string, { error: OriginError; until: number }>();
  const waiting: (() => void)[] = [];
  let running = 0;

  const file = (id: string, { width, grey }: Variant) => `${options.cacheDir}/${id}-${width}${grey ? '-grey' : ''}.webp`;
  const exists = (path: string) => access(path).then(() => true, () => false);

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

  /** A full disk costs a cached copy, never the picture. */
  async function save(path: string, data: Buffer): Promise<void> {
    const temporary = `${path}.${randomUUID()}`;
    try {
      await writeFile(temporary, data);
      await rename(temporary, path); // never a half written file
    } catch (err) {
      console.error('image not cached:', (err as Error).message);
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async function make(id: string, variants: Variant[]): Promise<Buffer[]> {
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
      // Not final: an origin that is struggling sends an error page, or half a photo, as a 200.
      throw new OriginError(`not a usable image: ${(err as Error).message}`, false);
    }
    await mkdir(options.cacheDir, { recursive: true });
    const made: Buffer[] = [];
    for (const variant of variants) {
      const sized = base.clone().resize({ width: variant.width, withoutEnlargement: true });
      const image = variant.grey ? sized.greyscale().webp({ quality: 75 }) : sized.webp({ quality: 80 });
      const data = await image.toBuffer();
      await save(file(id, variant), data);
      made.push(data);
    }
    return made;
  }

  /** At most a few at a time. The newest request goes first: it is what is on screen now. */
  async function inTurn<T>(work: () => Promise<T>): Promise<T> {
    if (running >= options.parallel) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await work();
    } finally {
      const next = waiting.pop();
      if (next) next(); // hand over the turn
      else running--;
    }
  }

  async function missing(id: string, variants: Variant[]): Promise<Variant[]> {
    const present = await Promise.all(variants.map((variant) => exists(file(id, variant))));
    return variants.filter((_, i) => !present[i]);
  }

  function makeOnce(id: string, wanted: Variant): Promise<Buffer> {
    const key = file(id, wanted);
    let job = working.get(key);
    if (!job) {
      job = inTurn(async () => {
        const others = (await missing(id, SMALL)).filter((one) => one.width !== wanted.width || one.grey !== wanted.grey);
        return (await make(id, [wanted, ...others]))[0]!;
      }).finally(() => working.delete(key));
      working.set(key, job);
    }
    return job;
  }

  /** Make the small set ahead of time. Says whether there was work to do. */
  async function warm(id: string): Promise<boolean> {
    const needed = await missing(id, SMALL);
    if (needed.length === 0) return false;
    await inTurn(() => make(id, needed));
    return true;
  }

  /** The large one, before anyone asks for it. If it comes to nothing, asking for it says why. */
  async function prepare(id: string): Promise<void> {
    if (!(await exists(file(id, { width: 1080, grey: false })))) await get(id, 1080, false).catch(() => {});
  }

  async function get(id: string, width: Width, grey: boolean): Promise<Buffer> {
    const cached = await readFile(file(id, { width, grey })).catch(() => null);
    if (cached) return cached;

    const before = failed.get(id);
    if (before && before.until > Date.now()) throw unavailable(before.error);
    let image: Buffer;
    try {
      image = await makeOnce(id, { width, grey });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const error = err instanceof OriginError ? err : new OriginError((err as Error).message, false);
      failed.set(id, { error, until: Date.now() + (error.permanent ? 60 * 60_000 : 30_000) });
      throw unavailable(error);
    }
    failed.delete(id);
    return image;
  }

  return { get, warm, prepare };
}

function unavailable(error: OriginError): ApiError {
  return error.permanent
    ? new ApiError(404, 'image_missing', 'This card has no picture.')
    : new ApiError(504, 'image_slow', 'This picture is taking too long. Try again in a moment.');
}
