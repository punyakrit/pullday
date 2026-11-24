import type { ConfigContext, ExpoConfig } from 'expo/config';

// Plain http is only for a backend on this computer. A build for the hosted one refuses it.
// The same default is in src/lib/config.ts.
const local = (process.env.EXPO_PUBLIC_API_URL || 'https://922a46307bd4607b7d32.agent37.app').startsWith('http://');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name!,
  slug: config.slug!,
  android: {
    ...config.android,
    // The dev client brings these. A build for a deployed backend needs none of them.
    blockedPermissions: local
      ? []
      : ['ACCESS_LOCAL_NETWORK', 'ACCESS_WIFI_STATE', 'SYSTEM_ALERT_WINDOW', 'USE_BIOMETRIC', 'USE_FINGERPRINT'].map(
          (name) => `android.permission.${name}`,
        ),
  },
  plugins: [...(config.plugins ?? []), [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: local,
          // One kind builds in a third of the time of all four. Others: ANDROID_ARCHS=x86_64, or a list with commas.
          buildArchs: (process.env.ANDROID_ARCHS || 'arm64-v8a').split(','),
          // Stripe's optional card provisioning, which we do not use. See plugins/withoutTapAndPay.js.
          extraProguardRules: '-dontwarn com.stripe.android.pushProvisioning.**\n-dontwarn com.google.android.gms.tapandpay.**',
        },
      },
    ]],
});
