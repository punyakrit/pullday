import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, space } from './theme';

export function Panel({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return <View style={[styles.panel, strong && styles.strong]}>{children}</View>;
}

const styles = StyleSheet.create({
  panel: { borderRadius: 12, backgroundColor: colors.deep, padding: space.l, gap: space.s },
  strong: { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.line },
});
