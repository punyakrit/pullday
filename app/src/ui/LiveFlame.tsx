import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Flame } from './Icons';
import { colors } from './theme';

/** A flame that lights up when the streak grows or is won back. Out at 0 days, and when it may be old. */
export function LiveFlame({ size, streak, old = false }: { size: number; streak: number | null; old?: boolean }) {
  const reduced = useReducedMotion();
  const before = useRef(streak);
  const scale = useSharedValue(1);
  const light = useSharedValue(0);
  useEffect(() => {
    const grew = before.current !== null && streak !== null && streak > before.current;
    before.current = streak;
    if (!grew || reduced) return;
    scale.value = withSequence(withTiming(1.35, { duration: 160, easing: Easing.out(Easing.quad) }), withSpring(1, { duration: 620, dampingRatio: 0.45 }));
    light.value = withSequence(withTiming(1, { duration: 160 }), withTiming(0, { duration: 900, easing: Easing.out(Easing.quad) }));
  }, [light, reduced, scale, streak]);
  const flame = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const halo = useAnimatedStyle(() => ({ opacity: light.value * 0.35, transform: [{ scale: 0.6 + light.value * 0.9 }] }));
  return (
    <View style={styles.box}>
      <Animated.View style={[styles.halo, { width: size * 1.6, height: size * 1.6, borderRadius: size }, halo]} />
      <Animated.View style={flame}>
        <Flame size={size} color={old || !streak ? colors.flameOff : colors.flame} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', backgroundColor: '#FFB45C' },
});
