import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Everything is found from the package folder, so commands work from anywhere.
export const ROOT = fileURLToPath(new URL('..', import.meta.url));

const envFile = `${ROOT}.env`;
if (existsSync(envFile)) process.loadEnvFile(envFile); // does not override variables already set

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://pullday:pullday@127.0.0.1:54329/pullday',
  port: Number(process.env.PORT ?? 4000),
  devTools: process.env.DEV_TOOLS === '1',
  imageCacheDir: process.env.IMAGE_CACHE_DIR ?? `${ROOT}.cache/images`,
};
