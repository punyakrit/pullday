import type { ReactNode } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { hairline } from './hairline';
import { colors, softShadow, space } from './theme';

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export const panel = { borderRadius: 18, backgroundColor: colors.panel, borderWidth: hairline, borderColor: colors.line, boxShadow: softShadow } as const;

const styles = StyleSheet.create({
  panel: { ...panel, padding: space.xl, gap: space.m },
});
