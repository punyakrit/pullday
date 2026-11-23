import { ActivityIndicator, type PressableProps, StyleSheet } from 'react-native';
import { Press } from './Press';
import { Words } from './Words';
import { hairline } from './hairline';
import { colors } from './theme';

type Props = Omit<PressableProps, 'children' | 'style'> & { title: string; kind?: 'main' | 'quiet' | 'light' | 'dark'; busy?: boolean };

/** `light` and `dark` are the main and the quiet one on the stage. */
export function Button({ title, kind = 'main', busy = false, disabled, ...rest }: Props) {
  const color = kind === 'quiet' || kind === 'light' ? colors.ink : colors.onInk;
  return (
    <Press
      accessibilityRole="button"
      // Always named. Without a name Android reads out "busy", and React Native never takes that back.
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled) || busy, busy }}
      disabled={disabled || busy}
      inner={[styles.button, styles[kind], disabled && styles.dim]}
      {...rest}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <Words kind="label" style={{ color, textAlign: 'center', alignSelf: 'stretch' }}>
          {title}
        </Words>
      )}
    </Press>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 8 },
  main: { backgroundColor: colors.ink },
  quiet: { backgroundColor: colors.panel, borderWidth: hairline, borderColor: '#C9C9C9' },
  light: { backgroundColor: '#FFFFFF' },
  dark: { backgroundColor: '#FFFFFF1A', borderWidth: hairline, borderColor: '#FFFFFF55' },
  dim: { opacity: 0.5 },
});
