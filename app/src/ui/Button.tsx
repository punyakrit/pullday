import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, View } from 'react-native';
import { Words } from './Words';
import { colors } from './theme';

type Props = Omit<PressableProps, 'children' | 'style'> & { title: string; kind?: 'main' | 'quiet'; busy?: boolean };

export function Button({ title, kind = 'main', busy = false, disabled, ...rest }: Props) {
  const main = kind === 'main';
  return (
    <View style={styles.clip}>
      <Pressable
        accessibilityRole="button"
        // Always named. Without a name Android reads out "busy", and React Native never takes that back.
        accessibilityLabel={title}
        accessibilityState={{ disabled: Boolean(disabled) || busy, busy }}
        android_ripple={{ color: main ? '#00000022' : '#FFFFFF22' }}
        disabled={disabled || busy}
        style={({ pressed }) => [styles.button, main ? styles.main : styles.quiet, (pressed || disabled) && styles.dim]}
        {...rest}
      >
        {busy ? (
          <ActivityIndicator color={main ? colors.onLabel : colors.ink} />
        ) : (
          <Words kind="label" style={{ color: main ? colors.onLabel : colors.ink, textAlign: 'center', alignSelf: 'stretch' }}>
            {title}
          </Words>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { borderRadius: 10, overflow: 'hidden' },
  button: { minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  main: { backgroundColor: colors.label },
  quiet: { backgroundColor: colors.raised },
  dim: { opacity: 0.7 },
});
