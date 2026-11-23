import pg from 'pg';
import { config } from './config.ts';

// A `date` is a calendar day, not a moment. Keep it as 'YYYY-MM-DD'; the default
// parser would turn it into a Date in this machine's own time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
// bigint: only used for a millisecond offset, which fits in a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
pool.on('error', (err) => console.error('idle database connection failed:', err.message));

export type Db = pg.PoolClient;

/** Run everything on one connection in one transaction. Rolls back on any throw. */
export async function transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  let broken: Error | undefined;
  try {
    await db.query('begin');
    const result = await work(db);
    await db.query('commit');
    return result;
  } catch (err) {
    await db.query('rollback').catch((rollbackError: Error) => {
      broken = rollbackError; // do not put a connection back in the pool mid-transaction
    });
    throw err;
  } finally {
    db.release(broken);
  }
}
