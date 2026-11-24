import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, test } from 'node:test';
import { placeOf } from '../src/core/links';

describe('a link from outside', () => {
  test('to a screen we have', () => {
    for (const [link, place] of [
      ['pulldaytest://', '/'],
      ['pulldaytest:///', '/'],
      ['/', '/'],
      ['pulldaytest://collection', '/collection'],
      ['pulldaytest:///collection/', '/collection'],
      ['/collection', '/collection'],
      ['pulldaytest://(tabs)/collection', '/collection'],
      ['pulldaytest://streak?x=1#y', '/streak'],
      ['pulldaytest://shop', '/shop'],
      ['pulldaytest://account', '/account'],
      ['pulldaytest://card/c_0049', '/card/c_0049'],
      ['pulldaytest:///card/c_0049?from=mail', '/card/c_0049'],
    ] as const) {
      assert.equal(placeOf(link), place, link);
    }
  });

  test('anything else leads to Today', () => {
    for (const link of [
      'pulldaytest://nowhere',
      'pulldaytest://_sitemap',
      'pulldaytest:///_sitemap',
      'pulldaytest://+not-found',
      'pulldaytest://login',
      'pulldaytest://card',
      'pulldaytest://card/',
      'pulldaytest://card/a/b',
      'pulldaytest://card/%00',
      'pulldaytest://card/../account',
      'pulldaytest://COLLECTION',
      'exp+pullday-test://?__expo_url=http%3A%2F%2F192.168.1.9%3A8081',
      'https://example.com/streak',
      '',
      '%',
      `pulldaytest://card/${'x'.repeat(500)}`,
    ]) {
      assert.equal(placeOf(link), '/', link);
    }
  });
});

/**
 * Expo Router's exported `router` is one object for the whole process. When Android makes the activity anew,
 * the new screen takes it over, and then the old one, as it goes, lets go of it for good: every call throws.
 * The one from useRouter belongs to its own screen.
 */
test('nothing uses the shared router', () => {
  const root = `${import.meta.dirname}/../src`;
  for (const name of readdirSync(root, { recursive: true }) as string[]) {
    if (!/\.tsx?$/.test(name)) continue;
    const text = readFileSync(`${root}/${name}`, 'utf8');
    for (const [, names] of text.matchAll(/import\s+{([^}]*)}\s+from\s+'expo-router'/g)) {
      const used = names!.split(',').map((one) => one.trim().split(/\s+as\s+/)[0]);
      assert.ok(!used.includes('router'), name);
    }
  }
});
