import type { Snapshot } from './engine';
import { type PaymentState, isFor } from './state';

export type Banner =
  | { kind: 'full' }
  | { kind: 'notice'; id: string; text: string }
  | { kind: 'payment'; state: PaymentState }
  | { kind: 'late'; until: number }
  | { kind: 'waiting'; challengeId: string }
  | { kind: 'winBack'; lostStreak: number }
  | { kind: 'offline'; unsent: boolean }
  | { kind: 'trouble'; unsent: boolean };

/**
 * The one line above Today, the most useful first. None over a reveal: it would push the card under
 * its own title, and move it when it goes. The reveal says itself if the card is not saved yet.
 */
export function bannerFor({
  view,
  unsaved,
  saved,
  connection,
  unsent,
  payment,
  offer,
}: Pick<Snapshot, 'view' | 'unsaved' | 'saved' | 'connection' | 'unsent' | 'payment' | 'offer'>): Banner | null {
  if (view.kind === 'reveal') return null;
  if (unsaved) return { kind: 'full' };
  const [notice] = saved.notices;
  const urgent = saved.notices.find((one) => one.first);
  if (urgent) return { kind: 'notice', id: urgent.id, text: urgent.text };
  // An offer ends, so it is not behind what can be read at any time. All of it is on the streak screen too.
  if (notice && !offer) return { kind: 'notice', id: notice.id, text: notice.text };
  // While there is an offer no payment is under way. What became of one for an earlier break is not the news.
  if (payment && payment.state !== 'unpaid' && (!offer || isFor(payment, offer))) return { kind: 'payment', state: payment.state };
  if (view.kind === 'challenge' && view.lateUntil !== null) return { kind: 'late', until: view.lateUntil };
  if (view.kind === 'challenge' && view.waiting) return { kind: 'waiting', challengeId: view.waiting.challengeId };
  if (offer) return { kind: 'winBack', lostStreak: offer.lostStreak };
  if (connection === 'offline' || connection === 'trouble') return { kind: connection, unsent: unsent > 0 };
  return null;
}
