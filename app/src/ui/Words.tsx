import { Text, type TextProps } from 'react-native';
import { colors, display } from './theme';

const styles = {
  title: { fontFamily: display.bold, fontSize: 30, lineHeight: 36, color: colors.ink },
  heading: { fontFamily: display.semi, fontSize: 22, lineHeight: 28, color: colors.ink },
  label: { fontFamily: display.semi, fontSize: 17, lineHeight: 22, color: colors.ink },
  body: { fontSize: 16, lineHeight: 23, color: colors.ink },
  soft: { fontSize: 15, lineHeight: 21, color: colors.soft },
} as const;

/** Text, at one of five sizes. It grows with the system setting, up to what still fits. */
export function Words({ kind = 'body', style, ...rest }: TextProps & { kind?: keyof typeof styles }) {
  return <Text maxFontSizeMultiplier={1.4} {...rest} style={[styles[kind], style]} />;
}
