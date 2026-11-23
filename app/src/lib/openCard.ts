import { router } from 'expo-router';

let openedAt = -Infinity;

/** Two quick taps open one card, not two. */
export function openCard(id: string): void {
  const now = performance.now();
  if (now - openedAt < 600) return;
  openedAt = now;
  router.push({ pathname: '/card/[id]', params: { id } });
}
