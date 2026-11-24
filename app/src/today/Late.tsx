import { type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from '../ui/Button';
import { Words } from '../ui/Words';
import { colors, space } from '../ui/theme';

const LATE_MS = 1_500;

type Props = { why: { title: string; line: string }; onTryAgain: () => void; meanwhile?: ReactNode };

/** For a screen that waits. If it has waited for a while it says why, so it is never just empty. */
export function Late({ why, onTryAgain, meanwhile = null }: Props) {
  const [asked, setAsked] = useState(0);
  const [late, setLate] = useState(-1); // which asking took too long
  useEffect(() => {
    const timer = setTimeout(() => setLate(asked), LATE_MS);
    return () => clearTimeout(timer);
  }, [asked]);

  if (late !== asked) return asked === 0 ? meanwhile : <ActivityIndicator color={colors.soft} size="large" />;
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      <Words kind="heading" style={styles.centre}>
        {why.title}
      </Words>
      <Words kind="soft" style={styles.centre}>
        {why.line}
      </Words>
      <View style={styles.wide}>
        <Button
          title="Try again"
          onPress={() => {
            setAsked(asked + 1);
            onTryAgain();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', gap: space.m, paddingHorizontal: space.xl },
  centre: { textAlign: 'center' },
  wide: { alignSelf: 'stretch', marginTop: space.m },
});
