import { useSyncExternalStore } from 'react';
import { Dimensions, PixelRatio, Platform } from 'react-native';

/** Android's own views take up a new size a moment after we hear of it. Measured before that, React keeps the old one. */
const SETTLE_MS = 500;

let scale = PixelRatio.getFontScale();
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

Dimensions.addEventListener('change', ({ window }: { window: { fontScale: number } }) => {
  clearTimeout(timer);
  timer = setTimeout(
    () => {
      if (window.fontScale === scale) return;
      scale = window.fontScale;
      for (const listener of listeners) listener();
    },
    Platform.OS === 'android' ? SETTLE_MS : 0,
  );
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The font size from Settings. It can change while the app is open. */
export const useFontScale = (): number => useSyncExternalStore(subscribe, () => scale);
