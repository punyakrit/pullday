import { buildApp } from './app.ts';
import { config } from './config.ts';
import { pool } from './db.ts';
import { migrate } from './migrate.ts';

await migrate(console.log);
const app = buildApp({ devTools: config.devTools, logger: true });
await app.listen({ port: config.port, host: '0.0.0.0' }); // a phone on the same wifi must reach it

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
