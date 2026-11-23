import { TEST_EMAILS } from '../auth.ts';
import { pool } from '../db.ts';
import { migrate } from '../migrate.ts';
import { seedAll } from '../seed.ts';

// npm run seed            every test account, in this computer's time zone
// npm run seed -- UTC     or in another one
const timezone = process.argv[2] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
await migrate();
await seedAll(timezone);
console.log(`ready in ${timezone}: ${TEST_EMAILS.join(', ')}`);
await pool.end();
