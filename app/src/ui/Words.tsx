import { Platform, Text, type TextProps } from 'react-native';
import { useFontScale } from './fontScale';
import { colors, serif } from './theme';

/** The serif is 1.3 high. In a shorter line, iOS puts it at the top and Android in the middle. This is the rest of the way. */
export const serifDrop = (size: number, line: number): number => (Platform.OS === 'ios' ? Math.max(0, (size * 1.3 - line) / 2) : 0);
const serifText = (fontSize: number, lineHeight: number) => ({ fontFamily: serif, fontSize, lineHeight, transform: [{ translateY: serifDrop(fontSize, lineHeight) }] });

/** One line of it, also for what stands beside it. */
export const LINE = { title: 44, heading: 32 } as const;

const styles = {
  title: { ...serifText(38, LINE.title), letterSpacing: -1.1, color: colors.ink },
  heading: { ...serifText(27, LINE.heading), letterSpacing: -0.8, color: colors.ink },
  label: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.ink },
  body: { fontSize: 16, lineHeight: 23, color: colors.ink },
  soft: { fontSize: 15, lineHeight: 21, color: colors.soft },
} as const;

/** It grows with the system setting, up to what still fits. */
export const MOST = 1.4;

/** Text, at one of five sizes. */
export function Words({ kind = 'body', style, ...rest }: TextProps & { kind?: keyof typeof styles }) {
  // Android: a text that is there keeps the size it had. A new one takes up the new size.
  const scale = useFontScale();
  return <Text key={Platform.OS === 'android' ? scale : 0} maxFontSizeMultiplier={MOST} {...rest} style={[styles[kind], style]} />;
}
