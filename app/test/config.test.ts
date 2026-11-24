import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(`${import.meta.dirname}/../${path}`, 'utf8');

test('with no .env: the hosted backend, the same in both places, and not plain http', () => {
  const [config, build] = ['src/lib/config.ts', 'app.config.ts'].map((path) => /EXPO_PUBLIC_API_URL \|\| '([^']+)'/.exec(read(path))?.[1]);
  assert.ok(config?.startsWith('https://'));
  assert.equal(build, config);
});
