/**
 * Makes the 200 and 400 images, colour and grey, for every card, so the first scroll is fast.
 * Run it where the image cache is. Safe to stop and run again: it skips what is there.
 *
 *   npm run warm-images
 */
import { pool } from '../db.ts';
import { OriginError, imageStore } from '../images.ts';

const PARALLEL = Number(process.env.WARM_PARALLEL ?? 6);
const images = imageStore({ parallel: PARALLEL });
const { rows } = await pool.query<{ id: string }>('select id from cards order by id');
const started = Date.now();
let next = 0;
let made = 0;
let present = 0;
const missing: string[] = [];
const failed: string[] = [];

async function one(id: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      if (await images.warm(id)) made++;
      else present++;
      return;
    } catch (err) {
      if (err instanceof OriginError && err.permanent && attempt > 1) return void missing.push(id);
      if (attempt === 3) return void failed.push(`${id} (${(err as Error).message})`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

async function worker(): Promise<void> {
  while (next < rows.length) {
    const i = next++;
    await one(rows[i]!.id);
    if ((i + 1) % 100 === 0) {
      console.log(`${i + 1} of ${rows.length}, ${Math.round((Date.now() - started) / 1000)}s`);
    }
  }
}

await Promise.all(Array.from({ length: PARALLEL }, worker));
console.log(`made ${made}, already there ${present}, no picture ${missing.length}, failed ${failed.length}`);
if (failed.length) console.log(`run again for: ${failed.join(', ')}`);
process.exitCode = failed.length ? 1 : 0;
await pool.end();
