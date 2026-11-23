import { Image, type ImageRef } from 'expo-image';
import { useEffect, useState } from 'react';
import type { Card } from '../core/types';
import { imageUrl, widthFor } from './images';

export type CardRef = { state: 'loading' } | { state: 'ready'; image: ImageRef } | { state: 'none' };

const wait = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

/**
 * The card's picture, downloaded and decoded at the size it will be shown, so turning it over
 * has nothing left to load. Falls back to the small one, then to the card's words.
 */
export function useCardRef(card: Card | null, points: number): CardRef {
  const [ref, setRef] = useState<CardRef>({ state: card ? 'loading' : 'none' });

  useEffect(() => {
    if (!card || points <= 0) return;
    let live = true;
    const load = (width: 200 | 400 | 1080) =>
      Image.loadAsync({ uri: imageUrl(card.id, width) }, { maxWidth: 1080 }).catch(() => null);
    void (async () => {
      setRef({ state: 'loading' });
      const size = widthFor(points);
      const small = size === 1080 ? load(400) : null;
      const large = await Promise.race([load(size), wait(5_000)]);
      const image = large ?? (small ? await Promise.race([small, wait(3_000)]) : null);
      if (live) setRef(image ? { state: 'ready', image } : { state: 'none' });
    })();
    return () => {
      live = false;
    };
  }, [card, points]);

  return ref;
}
