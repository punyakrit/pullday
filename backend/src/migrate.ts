import { readdir, readFile } from 'node:fs/promises';
import { ROOT } from './config.ts';
import { pool, transaction } from './db.ts';

/** Applies schema.sql, data.sql, then db/migrations in name order. Each runs once. */
export async function migrate(log: (line: string) => void = () => {}): Promise<void> {
  await pool.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const files = ['schema.sql', 'data.sql'];
  for (const name of (await readdir(`${ROOT}db/migrations`)).sort()) {
    if (name.endsWith('.sql')) files.push(`migrations/${name}`);
  }
  for (const name of files) {
    const ran = await transaction(async (db) => {
      // One runner at a time, even if two processes start together.
      await db.query(`select pg_advisory_xact_lock(hashtext('pullday_migrate'))`);
      const seen = await db.query('select 1 from schema_migrations where name = $1', [name]);
      if (seen.rowCount) return false;
      await db.query(await readFile(`${ROOT}db/${name}`, 'utf8'));
      await db.query('insert into schema_migrations (name) values ($1)', [name]);
      return true;
    });
    if (ran) log(`applied ${name}`);
  }
}
