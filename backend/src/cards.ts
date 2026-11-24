import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { pool } from './db.ts';
import { ApiError } from './errors.ts';

export type Rarity = 'common' | 'rare' | 'holo';

/** What a card looks like in a challenge, a reveal or a grid. */
export type CardSummary = {
  id: string;
  game: string;
  name: string;
  set: string;
  number: string | null; // 66 cards have none
  year: number;
  variety: string | null; // 799 cards have none
  grade: number;
  rarity: Rarity;
};

// grade is numeric(3,1): one decimal, exact as a float.
const SUMMARY = `id, game, card_name as name, set_name as "set", card_number as number, year, variety, grade::float8 as grade, rarity`;

// The catalogue never changes while the server runs, so it is read once.
let loaded: Promise<{ list: CardSummary[]; byId: Map<string, CardSummary>; noPicture: Set<string> }> | undefined;

export function catalogue() {
  loaded ??= Promise.all([
    pool.query<CardSummary>(`select ${SUMMARY} from cards order by id`),
    pool.query<{ card_id: string }>('select card_id from cards_without_picture'),
  ]).then(([{ rows }, gone]) => ({
    list: rows,
    byId: new Map(rows.map((card) => [card.id, card])),
    noPicture: new Set(gone.rows.map((row) => row.card_id)),
  }));
  loaded.catch(() => (loaded = undefined)); // try again after a failed read
  return loaded;
}

/** The whole catalogue as one gzipped body with an ETag, so the phone downloads it once. */
let packed: { etag: string; json: Buffer; gzip: Buffer } | undefined;

export async function packedCatalogue() {
  if (!packed) {
    const json = Buffer.from(JSON.stringify({ cards: (await catalogue()).list }));
    const etag = `"${createHash('sha256').update(json).digest('base64url').slice(0, 22)}"`;
    packed = { etag, json, gzip: gzipSync(json) };
  }
  return packed;
}

export async function summary(id: string): Promise<CardSummary> {
  const card = (await catalogue()).byId.get(id);
  if (!card) throw new ApiError(404, 'no_such_card', 'We do not have that card.');
  return card;
}

export async function cardDetails(id: string, userId: string) {
  const found = await pool.query(
    `select ${SUMMARY}, grader, cert_number as "certNumber", price_cents as "priceCents", population, story,
            (select jsonb_agg(jsonb_build_object('date', p->>'date', 'priceCents', (p->>'price_cents')::int))
               from jsonb_array_elements(price_history) p) as "priceHistory",
            price_history -> -1 ->> 'date' as "priceDate",
            (select acquired_at from collection where card_id = cards.id and user_id = $2) as "acquiredAt"
       from cards where id = $1`,
    [id, userId],
  );
  if (!found.rows[0]) throw new ApiError(404, 'no_such_card', 'We do not have that card.');
  return found.rows[0];
}
