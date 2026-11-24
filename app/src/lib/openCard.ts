import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import type { HostInstance } from 'react-native';

export type OpenCard = (id: string, view?: HostInstance | null, width?: number) => void;
export type Rect = { x: number; y: number; width: number };

let openedAt = -Infinity;
let from: { id: string; rect: Rect; at: number } | null = null;

/** Two quick taps open one card, not two. Where it was tapped is kept, so it can grow from there. */
export function useOpenCard(): OpenCard {
  const router = useRouter();
  return useCallback<OpenCard>(
    (id, view, width = 0) => {
      const now = performance.now();
      if (now - openedAt < 600) return;
      openedAt = now;
      from = null;
      view?.measureInWindow((x, y, whole) => {
        from = { id, rect: { x: x + (whole - width) / 2, y, width }, at: performance.now() };
      });
      router.push({ pathname: '/card/[id]', params: { id } });
    },
    [router],
  );
}

/** Where the card was when it was tapped, once, and only just now. */
export function openedFrom(id: string): Rect | null {
  const found = from?.id === id && performance.now() - from.at < 1_000 ? from.rect : null;
  from = null;
  return found;
}
