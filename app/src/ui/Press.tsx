import { type ReactNode, useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cubicBezier, useReducedMotion } from 'react-native-reanimated';

type Props = Omit<PressableProps, 'children' | 'style'> & { children: ReactNode; style?: StyleProp<ViewStyle>; inner?: StyleProp<ViewStyle> };

/**
 * Gives a little under the finger, and springs back. Until it is touched for the first time it is a plain
 * view: a grid full of these costs nothing while it scrolls.
 */
export function Press({ children, style, inner, onPressIn, onPressOut, ...rest }: Props) {
  const reduced = useReducedMotion();
  const [state, setState] = useState<'never' | 'down' | 'up'>('never');
  return (
    <Pressable
      {...rest}
      style={style}
      onPressIn={(event) => {
        if (!reduced) setState('down');
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (!reduced) setState('up');
        onPressOut?.(event);
      }}
    >
      <Animated.View style={[inner, state !== 'never' && SPRING, state === 'down' && DOWN]}>{children}</Animated.View>
    </Pressable>
  );
}

const SPRING = { transform: [{ scale: 1 }], transitionProperty: 'transform', transitionDuration: 220, transitionTimingFunction: cubicBezier(0.3, 1.7, 0.5, 1) } as const;
const DOWN = { transform: [{ scale: 0.97 }], transitionDuration: 90, transitionTimingFunction: 'ease-out' } as const;
