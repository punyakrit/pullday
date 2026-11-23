import { type ReactNode, createContext, useContext, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, Keyframe, ReduceMotion } from 'react-native-reanimated';

/** How long after its first part a screen still counts as opening. */
const OPENING_MS = 900;
type Moment = { at: number | null };
const Opened = createContext<Moment>({ at: -Infinity });

/** Around a screen. What is in it comes in once, when the screen opens, and never again on a sync. */
export function Opening({ children }: { children: ReactNode }) {
  const [moment] = useState<Moment>({ at: null });
  return <Opened.Provider value={moment}>{children}</Opened.Provider>;
}

/** Is the screen opening? Asked once, by each part, when it is first drawn. */
export function useOpening(): boolean {
  const moment = useContext(Opened);
  const [opening] = useState(() => {
    moment.at ??= performance.now();
    return performance.now() - moment.at < OPENING_MS;
  });
  return opening;
}

// A new one each time: its settings belong to it.
const rise = () => new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 12 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.out(Easing.cubic) },
});
const pop = () => new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.4 }] },
  60: { opacity: 1, transform: [{ scale: 1.12 }], easing: Easing.out(Easing.quad) },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.inOut(Easing.quad) },
});

/** Fades in and rises a little, `at` places after the first. */
export function Rise({ at = 0, style, children }: { at?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const opening = useOpening();
  return (
    <Animated.View entering={opening ? rise().duration(340).delay(at * 60).reduceMotion(ReduceMotion.System) : undefined} style={style}>
      {children}
    </Animated.View>
  );
}

/** Pops in, `after` milliseconds after the screen opened. */
export function Pop({ after, children }: { after: number; children: ReactNode }) {
  const opening = useOpening();
  return <Animated.View entering={opening ? pop().duration(260).delay(after).reduceMotion(ReduceMotion.System) : undefined}>{children}</Animated.View>;
}
