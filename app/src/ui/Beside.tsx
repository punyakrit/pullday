import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { LINE, MOST } from './Words';

/** A shape beside a title or a heading: level with its first line, however many there are. In a row that starts at the top. */
export function Beside({ kind, children }: { kind: keyof typeof LINE; children: ReactNode }) {
  const { fontScale } = useWindowDimensions();
  return <View style={{ height: LINE[kind] * Math.min(fontScale, MOST), justifyContent: 'center' }}>{children}</View>;
}
