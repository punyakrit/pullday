const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { withAndroidManifest, withDangerousMod, withMainActivity } = require('expo/config-plugins');

/** Every change the app can live through. What is not here makes a new activity, and what was open is gone. */
const CHANGES = [
  'keyboard', 'keyboardHidden', 'navigation', 'touchscreen', 'orientation', 'screenSize', 'smallestScreenSize', 'screenLayout',
  'uiMode', 'assetsPaths', 'density', 'fontScale', 'fontWeightAdjustment', 'locale', 'layoutDirection', 'colorMode', 'mcc', 'mnc',
];

const isLauncher = (filter) => Boolean(filter.category?.some((one) => one.$['android:name'] === 'android.intent.category.LAUNCHER'));

/**
 * MainActivity is singleTask, so that a link never makes a second one. But then the icon closes what is on
 * top of it: Stripe's sheet, with a card half typed or a bank's page open. So the icon is another
 * activity's, which starts MainActivity only when there is nothing yet, and is gone at once.
 */
function lasting(manifest) {
  const application = manifest.manifest.application[0];
  const main = application.activity.find((one) => one.$['android:name'] === '.MainActivity');
  main.$['android:configChanges'] = CHANGES.join('|');
  main['intent-filter'] = (main['intent-filter'] ?? []).filter((filter) => !isLauncher(filter));
  application.activity = application.activity.filter((one) => one.$['android:name'] !== '.LauncherActivity');
  application.activity.push({
    $: {
      'android:name': '.LauncherActivity',
      'android:exported': 'true',
      'android:theme': main.$['android:theme'], // the launch screen goes over from this to MainActivity
      'android:screenOrientation': 'portrait',
    },
    'intent-filter': [
      { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] },
    ],
  });
  return manifest;
}

const source = (name) => `package ${name}

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** See plugins/withLastingActivity.js. */
class LauncherActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (isTaskRoot) {
      startActivity(Intent(this, MainActivity::class.java))
    }
    finish()
  }
}
`;

/**
 * Back at the root leaves the app open. From Android 12 the system does that by itself, but only for the
 * activity that the icon names. So here it is done as before Android 12.
 */
function staysOnBack(text) {
  const old = 'if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {';
  const now = 'if (Build.VERSION.SDK_INT > 0) { // always, see plugins/withLastingActivity.js';
  if (text.includes(now)) return text;
  if (!text.includes(old)) throw new Error('MainActivity is not what plugins/withLastingActivity.js knows');
  return text.replace(old, now);
}

module.exports = (config) => {
  config = withMainActivity(config, (mod) => {
    mod.modResults.contents = staysOnBack(mod.modResults.contents);
    return mod;
  });
  config = withAndroidManifest(config, (mod) => {
    mod.modResults = lasting(mod.modResults);
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const name = mod.android.package;
      const dir = join(mod.modRequest.platformProjectRoot, 'app/src/main/java', ...name.split('.'));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'LauncherActivity.kt'), source(name));
      return mod;
    },
  ]);
};
module.exports.lasting = lasting;
module.exports.staysOnBack = staysOnBack;
