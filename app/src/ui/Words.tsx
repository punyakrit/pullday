import { Text, type TextProps } from 'react-native';
import { colors, serif } from './theme';

const styles = {
  title: { fontFamily: serif, fontSize: 38, lineHeight: 44, letterSpacing: -1.1, color: colors.ink },
  heading: { fontFamily: serif, fontSize: 27, lineHeight: 32, letterSpacing: -0.8, color: colors.ink },
  label: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.ink },
  body: { fontSize: 16, lineHeight: 23, color: colors.ink },
  soft: { fontSize: 15, lineHeight: 21, color: colors.soft },
} as const;

/** Text, at one of five sizes. It grows with the system setting, up to what still fits. */
export function Words({ kind = 'body', style, ...rest }: TextProps & { kind?: keyof typeof styles }) {
  return <Text maxFontSizeMultiplier={1.4} {...rest} style={[styles[kind], style]} />;
}
