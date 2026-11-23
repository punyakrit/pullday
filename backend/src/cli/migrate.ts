import { pool } from '../db.ts';
import { migrate } from '../migrate.ts';

await migrate(console.log);
console.log('database is up to date');
await pool.end();
