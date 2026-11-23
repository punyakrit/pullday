import type { ConfigContext, ExpoConfig } from 'expo/config';

// Plain http is only for a backend on this computer. A build for a deployed one refuses it.
const local = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').startsWith('http://');

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
  plugins: [...(config.plugins ?? []), ['expo-build-properties', { android: { usesCleartextTraffic: local } }]],
});
