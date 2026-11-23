import type { Snapshot } from './engine';

export type Banner =
  | { kind: 'full' }
  | { kind: 'notice'; id: string; text: string }
  | { kind: 'late'; until: number }
  | { kind: 'waiting'; challengeId: string }
  | { kind: 'offline'; unsent: boolean }
  | { kind: 'trouble'; unsent: boolean };

/**
 * The one line above Today, the most useful first. None over a reveal: it would push the card under
 * its own title, and move it when it goes. The reveal says itself if the card is not saved yet.
 */
export function bannerFor({ view, unsaved, saved, connection, unsent }: Pick<Snapshot, 'view' | 'unsaved' | 'saved' | 'connection' | 'unsent'>): Banner | null {
  if (view.kind === 'reveal') return null;
  if (unsaved) return { kind: 'full' };
  const notice = saved.notices[0];
  if (notice) return { kind: 'notice', ...notice };
  if (view.kind === 'challenge' && view.lateUntil !== null) return { kind: 'late', until: view.lateUntil };
  if (view.kind === 'challenge' && view.waiting) return { kind: 'waiting', challengeId: view.waiting.challengeId };
  if (connection === 'offline' || connection === 'trouble') return { kind: connection, unsent: unsent > 0 };
  return null;
}
