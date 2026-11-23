import { TEST_EMAILS } from '../auth.ts';
import { pool } from '../db.ts';
import { resetAccount } from '../seed.ts';

// npm run reset -- freeze          or freeze@pullday.test, optionally with a time zone
const [name, timezone] = process.argv.slice(2);
const email = name && TEST_EMAILS.find((known) => known === name || known.split('@')[0] === name);
if (!email) {
  console.error(`usage: npm run reset -- <${TEST_EMAILS.map((known) => known.split('@')[0]).join('|')}> [time zone]`);
  process.exitCode = 1;
} else {
  await resetAccount(email, timezone);
  console.log(`${email} is back to its starting state`);
}
await pool.end();
