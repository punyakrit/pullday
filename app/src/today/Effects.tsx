import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Extrapolation, type SharedValue, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import type { Rarity } from '../core/types';
import { holoBright, rarityBright } from '../ui/theme';

/**
 * Light only: a few views, moved with transform and opacity by shared values. No blur, no shadow,
 * no particles made in JavaScript. Nothing here can hold up the reveal.
 */

const RAYS = 14;
const ray = (i: number) => {
  const angle = (i / RAYS) * Math.PI * 2;
  const half = 0.085;
  const point = (a: number) => `${100 + Math.cos(a) * 100} ${100 + Math.sin(a) * 100}`;
  return `M100 100L${point(angle - half)}L${point(angle + half)}Z`;
};
const rayColors = (rarity: Rarity) => (rarity === 'holo' ? holoBright : [rarityBright.rare]);
const rayColor = (rarity: Rarity, i: number) => (rarity === 'holo' ? holoBright[i % holoBright.length]! : rarityBright.rare);

/** Behind a rare or holo card. Drawn once, kept as a texture, then only turned. */
export const Rays = memo(function Rays({ rarity, size, glow, turn }: { rarity: Rarity; size: number; glow: SharedValue<number>; turn: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: glow.value * 0.75,
    transform: [{ rotate: `${turn.value * 40}deg` }, { scale: interpolate(glow.value, [0, 1], [0.6, 1]) }],
  }));
  return (
    <Animated.View pointerEvents="none" renderToHardwareTextureAndroid shouldRasterizeIOS style={[{ position: 'absolute', width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        <Defs>
          {rayColors(rarity).map((color, i) => (
            <RadialGradient key={color} id={`ray${i}`} cx={100} cy={100} r={100} gradientUnits="userSpaceOnUse">
              <Stop offset={0.35} stopColor={color} stopOpacity={1} />
              <Stop offset={1} stopColor={color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {Array.from({ length: RAYS }, (_, i) => (
          <Path key={i} d={ray(i)} fill={`url(#ray${i % rayColors(rarity).length})`} opacity={i % 2 ? 0.5 : 1} />
        ))}
      </Svg>
    </Animated.View>
  );
});

/** A band of light across the card, once. On a holo, colour that follows the finger. */
export const Sheen = memo(function Sheen({
  rarity,
  width,
  height,
  sweep,
  tilt,
}: {
  rarity: Rarity;
  width: number;
  height: number;
  sweep: SharedValue<number>;
  tilt: SharedValue<number>;
}) {
  const band = useAnimatedStyle(() => ({
    opacity: interpolate(sweep.value, [0, 0.1, 0.9, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
    transform: [{ translateX: interpolate(sweep.value, [0, 1], [-width * 1.1, width * 1.1]) }, { rotate: '18deg' }],
  }));
  const foil = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(tilt.value, [-1, 1], [-width * 0.5, width * 0.5], Extrapolation.CLAMP) }],
  }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden', borderRadius: width * 0.05 }]}>
      {rarity === 'holo' && (
        <Animated.View style={[{ position: 'absolute', left: -width * 0.5, width: width * 2, height, opacity: 0.22 }, foil]}>
          <LinearGradient
            colors={[...holoBright, ...holoBright, holoBright[0]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0.35 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
      <Animated.View style={[{ position: 'absolute', top: -height * 0.25, width: width * 0.45, height: height * 1.5, left: width * 0.275 }, band]}>
        <LinearGradient
          colors={['#FFFFFF00', rarity === 'common' ? '#FFFFFF55' : '#FFFFFFAA', '#FFFFFF00']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
});

const SPARKS = Array.from({ length: 12 }, (_, i) => ({
  angle: (i / 12) * Math.PI * 2 + (i % 2) * 0.2,
  reach: 0.78 + ((i * 37) % 10) / 22,
  size: 9 + ((i * 53) % 8),
}));

/** One burst, when a rare or holo card turns over. */
export const Sparks = memo(function Sparks({ rarity, radius, burst }: { rarity: Rarity; radius: number; burst: SharedValue<number> }) {
  return (
    <View pointerEvents="none" style={styles.sparks}>
      {SPARKS.map((spark, i) => (
        <Spark key={i} {...spark} color={rayColor(rarity, i)} radius={radius} burst={burst} />
      ))}
    </View>
  );
});

type SparkProps = (typeof SPARKS)[number] & { color: string; radius: number; burst: SharedValue<number> };

const Spark = memo(function Spark({ angle, reach, size, color, radius, burst }: SparkProps) {
  const style = useAnimatedStyle(() => {
    const far = radius * reach * burst.value;
    return {
      opacity: interpolate(burst.value, [0, 0.08, 0.6, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: Math.cos(angle) * far },
        { translateY: Math.sin(angle) * far },
        { rotate: '45deg' },
        { scale: interpolate(burst.value, [0, 0.4, 1], [0.4, 1, 0.5]) },
      ],
    };
  });
  return <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: 2, backgroundColor: color }, style]} />;
});

const styles = StyleSheet.create({ sparks: { position: 'absolute', alignItems: 'center', justifyContent: 'center' } });
