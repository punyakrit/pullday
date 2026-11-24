import type { Snapshot } from './engine';

/** All 8 are sorted and there is nothing to reveal. Or there is nothing to show at all. Why, as far as we know. */
export function whyStuck({ ended, unsaved, unsent, connection }: Pick<Snapshot, 'ended' | 'unsaved' | 'unsent' | 'connection'>): { title: string; line: string } {
  const apart = connection === 'offline' || connection === 'trouble';
  if (ended) return { title: 'Your session ended', line: 'Log in again to carry on.' };
  if (unsaved) {
    return {
      title: "This phone can't save your challenge",
      line: apart ? 'It may be out of space, and there is no connection to send it. Free some space, then try again.' : 'It may be out of space. Free some, then try again.',
    };
  }
  if (connection === 'trouble') return { title: 'Pullday is having trouble', line: 'Nothing on this phone is lost. Try again in a moment.' };
  if (connection === 'offline') return { title: "Can't reach Pullday", line: 'Check your connection, then try again.' };
  if (unsent > 0) return { title: 'Waiting for the server', line: 'Your challenge is saved, but not confirmed yet.' };
  return { title: 'This is taking too long', line: 'Something did not work here. Try again.' };
}
