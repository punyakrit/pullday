import { PaymentSheet, PaymentSheetError, initPaymentSheet, initStripe, presentPaymentSheet } from '@stripe/stripe-react-native';
import { Refused, Unreachable } from '../core/api';
import type { Engine } from '../core/engine';
import { colors } from '../ui/theme';

let running = false;

/** Open the payment sheet and wait for it to go. Returns what went wrong before there was anything to pay. */
export async function payForWinBack(engine: Engine): Promise<string | null> {
  if (running) return null; // a second tap
  running = true;
  try {
    const sheet = await engine.beginPayment();
    if (!sheet) return null; // paid already, or on its way
    await initStripe({ publishableKey: sheet.publishableKey, urlScheme: 'pulldaytest' });
    const opened = await initPaymentSheet({
      merchantDisplayName: 'Pullday Test',
      paymentIntentClientSecret: sheet.clientSecret,
      allowsDelayedPaymentMethods: false, // card only
      link: { display: PaymentSheet.LinkDisplay.NEVER },
      returnURL: 'pulldaytest://stripe-redirect',
      style: 'alwaysDark',
      primaryButtonLabel: 'Pay $4.99',
      appearance: { colors: { primary: colors.green, background: colors.deep, primaryText: colors.ink } },
    });
    if (opened.error) {
      await engine.sheetClosed(true);
      return 'The payment form could not be opened. Try again in a moment.';
    }
    const { error } = await presentPaymentSheet();
    // Whatever it says, Stripe is asked.
    await engine.sheetClosed(error?.code === PaymentSheetError.Canceled);
    return null;
  } catch (err) {
    if (err instanceof Refused) return err.message;
    if (err instanceof Unreachable) return err.kind === 'server' ? 'Payments cannot be reached right now. Try again in a moment.' : 'Connect to win your streak back.';
    return "This phone can't save right now, so no payment was begun. It may be out of space.";
  } finally {
    running = false;
  }
}
