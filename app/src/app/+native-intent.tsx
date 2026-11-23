import { handleURLCallback } from '@stripe/stripe-react-native';

/** A bank sends people back here after 3D Secure. That is Stripe's, not a screen. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  if (!path.includes('stripe-redirect')) return path;
  handleURLCallback(path).catch(() => {});
  return null;
}
