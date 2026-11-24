import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useOpening } from './Rise';
import { useFontScale } from './fontScale';
import { serifDrop } from './Words';
import { colors, serif } from './theme';

/** How wide each digit of the serif is, for its size. It has no tabular ones. */
const WIDTH = [0.46, 0.249, 0.404, 0.371, 0.393, 0.382, 0.404, 0.364, 0.433, 0.402];
const WIDEST = 0.6;
const TEN = '0\n1\n2\n3\n4\n5\n6\n7\n8\n9';

const scaled = (size: number, scale: number) => size * Math.min(scale, 1.3);

/**
 * A big number that counts up when the screen opens, and rolls on when it changes. Each digit is a strip
 * that slides, so nothing is written again and nothing is laid out. `quick`: it follows a finger. `unit`: what
 * it counts, small and on the same line.
 */
export function Roll({ text, size, color = colors.ink, quick = false, unit }: { text: string; size: number; color?: string; quick?: boolean; unit?: string }) {
  const scale = useFontScale();
  const big = scaled(size, scale);
  const chars = [...text];
  return (
    <View style={[styles.row, level(big)]} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {chars.map((char, i) => {
        const place = chars.length - i; // counted from the right, so 9 to 10 keeps the ones
        return char >= '0' && char <= '9' ? (
          <Digit key={`d${place}`} digit={Number(char)} size={big} color={color} delay={i * 50} quick={quick} />
        ) : (
          <Text key={`c${place}`} allowFontScaling={false} style={[styles.text, { fontSize: big, lineHeight: lineOf(big), letterSpacing: big * -0.03, color }]}>
            {char}
          </Text>
        );
      })}
      {unit !== undefined && (
        // The space is as big as the number, so the line it stands on is the number's.
        <Text allowFontScaling={false} style={[styles.text, { fontSize: big, lineHeight: lineOf(big), letterSpacing: big * -0.05, color }]}>
          {' '}
          <Text style={{ fontSize: scaled(27, scale), letterSpacing: -0.8 }}>{unit}</Text>
        </Text>
      )}
    </View>
  );
}

const lineOf = (size: number) => Math.round(size * 1.16);
const level = (size: number) => ({ transform: [{ translateY: serifDrop(size, lineOf(size)) }] });

function Digit({ digit, size, color, delay, quick }: { digit: number; size: number; color: string; delay: number; quick: boolean }) {
  const reduced = useReducedMotion();
  const opening = useOpening();
  const line = lineOf(size);
  const at = useSharedValue(opening && !reduced ? 0 : digit);
  useEffect(() => {
    at.value = reduced || quick ? digit : withDelay(delay, withTiming(digit, { duration: 640, easing: Easing.out(Easing.cubic) }));
  }, [at, delay, digit, quick, reduced]);
  const strip = useAnimatedStyle(() => ({ transform: [{ translateY: -at.value * line }] }));
  const width = size * (WIDTH[digit]! - 0.03);
  return (
    <View style={{ width, height: line, overflow: 'hidden' }}>
      <Animated.View style={[{ position: 'absolute', left: (width - size * WIDEST) / 2, width: size * WIDEST }, strip]}>
        <Text allowFontScaling={false} style={[styles.text, { fontSize: size, lineHeight: line, textAlign: 'center', color }]}>
          {TEN}
        </Text>
      </Animated.View>
    </View>
  );
}

/** A number that ticks. Every digit has the same room, so nothing beside it moves. */
export function Ticking({ text, size, color = colors.ink }: { text: string; size: number; color?: string }) {
  const scale = useFontScale();
  const big = scaled(size, scale);
  return (
    <View style={[styles.row, level(big)]} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {[...text].map((char, i) => (
        <Text key={i} allowFontScaling={false} style={[styles.text, { fontSize: big, lineHeight: lineOf(big), color, textAlign: 'center' }, char >= '0' && char <= '9' && { width: big * 0.45 }]}>
          {char}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  text: { fontFamily: serif, includeFontPadding: false },
});
