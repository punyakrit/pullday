import { handleURLCallback } from '@stripe/stripe-react-native';
import { placeOf } from '../core/links';

/** A link from outside. A bank sends people back here after 3D Secure: that is Stripe's, not a screen. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  if (!path.includes('stripe-redirect')) return placeOf(path);
  handleURLCallback(path).catch(() => {});
  return null;
}
