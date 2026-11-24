import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

type Entry = { $: Record<string, string>; [key: string]: unknown };
type Manifest = { manifest: { application: { activity: Entry[] }[] } };
const { lasting, staysOnBack } = createRequire(import.meta.url)('../plugins/withLastingActivity.js') as {
  lasting: (manifest: Manifest) => Manifest;
  staysOnBack: (text: string) => string;
};

const filter = (action: string, category: string) => ({ action: [{ $: { 'android:name': `android.intent.action.${action}` } }], category: [{ $: { 'android:name': `android.intent.category.${category}` } }] });
const made = (): Manifest => ({
  manifest: {
    application: [
      {
        activity: [
          {
            $: { 'android:name': '.MainActivity', 'android:launchMode': 'singleTask', 'android:configChanges': 'keyboard|uiMode', 'android:theme': '@style/Splash' },
            'intent-filter': [filter('MAIN', 'LAUNCHER'), filter('VIEW', 'BROWSABLE')],
          },
        ],
      },
    ],
  },
});

test('Android: one activity lives through the settings, and the icon is not its own', () => {
  for (const manifest of [lasting(made()), lasting(lasting(made()))]) {
    const [main, launcher, ...more] = manifest.manifest.application[0]!.activity;
    assert.equal(more.length, 0);
    for (const change of ['fontScale', 'fontWeightAdjustment', 'locale', 'layoutDirection', 'density', 'uiMode', 'keyboard']) {
      assert.ok(main!.$['android:configChanges']!.split('|').includes(change), change);
    }
    assert.equal(main!.$['android:launchMode'], 'singleTask'); // a link still never makes a second one
    assert.deepEqual(main!['intent-filter'], [filter('VIEW', 'BROWSABLE')]);
    assert.equal(launcher!.$['android:name'], '.LauncherActivity');
    assert.deepEqual(launcher!['intent-filter'], [filter('MAIN', 'LAUNCHER')]);
    assert.equal(launcher!.$['android:theme'], '@style/Splash');
  }
});

test('Android: Back at the root leaves the app open on every version, and it is said if that cannot be put in', () => {
  const text = 'if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {\n  if (!moveTaskToBack(false)) {}\n}';
  assert.match(staysOnBack(text), /SDK_INT > 0/);
  assert.equal(staysOnBack(staysOnBack(text)), staysOnBack(text));
  assert.throws(() => staysOnBack('class MainActivity'));
});
