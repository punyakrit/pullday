import { buildApp } from './app.ts';
import { config } from './config.ts';
import { pool } from './db.ts';
import { migrate } from './migrate.ts';
import { realStripe } from './stripe.ts';

await migrate(console.log);
const app = buildApp({ devTools: config.devTools, logger: true, prepareRewards: true, stripe: config.stripe && realStripe(config.stripe) });
if (!config.stripe) console.log('Payments are not set up: no Stripe test keys. Everything else works.');
const sweep = setInterval(() => void app.payments.sweep().catch(() => {}), 60_000);
await app.listen({ port: config.port, host: '0.0.0.0' }); // a phone on the same wifi must reach it

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    clearInterval(sweep);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
