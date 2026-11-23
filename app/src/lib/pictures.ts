import { useCallback, useSyncExternalStore } from 'react';
import { type Look, Pictures } from '../core/pictures';
import { imageUrl } from './images';
import { storage } from './storage';

export const pictures = new Pictures({
  storage,
  ask: async (cardId) => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8_000);
    try {
      const { status } = await fetch(imageUrl(cardId, 200), { method: 'HEAD', signal: abort.signal });
      return status === 404 ? 'none' : status < 300 ? 'there' : 'unreachable';
    } finally {
      clearTimeout(timer);
    }
  },
});

export function usePicture(cardId: string, url: string): Look {
  const now = useCallback(() => pictures.look(cardId, url), [cardId, url]);
  return useSyncExternalStore(pictures.subscribe, now);
}
