import { Image } from 'expo-image';
import { PixelRatio } from 'react-native';
import type { Challenge, Today } from '../core/types';
import { API_URL } from './config';

export type ImageWidth = 200 | 400 | 1080;

export function imageUrl(cardId: string, width: ImageWidth, grey = false): string {
  return `${API_URL.replace(/\/+$/, '')}/images/${cardId}?w=${width}${grey ? '&grey=1' : ''}`;
}

/** The smallest size that still looks sharp at this many points wide. */
export function widthFor(points: number): ImageWidth {
  const pixels = points * PixelRatio.get();
  return pixels <= 230 ? 200 : pixels <= 640 ? 400 : 1080;
}

const asked = new Set<string>();
const queue: string[] = [];
let running = 0;

function pump(): void {
  while (running < 3 && queue.length > 0) {
    const url = queue.shift()!;
    running++;
    Image.prefetch(url, 'disk')
      .then((ok) => {
        if (!ok) asked.delete(url); // try again with the next bundle
      })
      .catch(() => asked.delete(url))
      .finally(() => {
        running--;
        pump();
      });
  }
}

function prefetch(urls: string[]): void {
  for (const url of urls) {
    if (asked.has(url)) continue;
    asked.add(url);
    queue.push(url);
  }
  pump();
}

/** Today's pictures first, small before large, then tomorrow's, so the loop works offline. */
export function prefetchBundle(today: Today): void {
  const large = widthFor(280);
  const urls = (challenge: Challenge, width: ImageWidth) => [
    ...challenge.cards.map((card) => imageUrl(card.id, width)),
    ...(challenge.reward ? [imageUrl(challenge.reward.id, width)] : []),
  ];
  for (const challenge of [today.resume, today.challenge, today.tomorrow]) {
    if (!challenge || challenge.completedAt) continue;
    prefetch(urls(challenge, 400));
  }
  if (large === 400) return;
  for (const challenge of [today.resume, today.challenge]) {
    if (challenge && !challenge.completedAt) prefetch(urls(challenge, large));
  }
  if (today.tomorrow.reward) prefetch([imageUrl(today.tomorrow.reward.id, large)]);
}
