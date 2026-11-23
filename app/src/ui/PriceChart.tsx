import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import type { Price } from '../core/details';
import { dateText, describePrices, inOrder, money, nearest, plot } from '../core/prices';
import { Words } from './Words';
import { colors, space } from './theme';

const HEIGHT = 148;
const INSET = { x: 8, y: 26 };
const LINE = '#34A89C'; // checked against the panel behind it: contrast 3 to 1 and more

/** The price, week by week, and the day it is from. Drag across it to read a week. */
export function PriceChart({ priceCents, priceDate, history }: { priceCents: number; priceDate: string | null; history: Price[] }) {
  const prices = useMemo(() => inOrder(history), [history]);
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const drawn = useMemo(() => plot(prices, width, HEIGHT, INSET), [prices, width]);

  // Kept the same, so drawing a week does not set the gesture up again under the finger.
  const point = useCallback((x: number) => setPicked(drawn ? nearest(drawn.points, x) : null), [drawn]);
  const lift = useCallback(() => setPicked(null), []);
  const pan = usePanGesture({
    activeOffsetX: [-6, 6],
    failOffsetY: [-12, 12], // up and down is for the page
    onActivate: (event) => {
      'worklet';
      scheduleOnRN(point, event.x);
    },
    onUpdate: (event) => {
      'worklet';
      scheduleOnRN(point, event.x);
    },
    onFinalize: () => {
      'worklet';
      scheduleOnRN(lift);
    },
  });

  const week = picked === null ? null : prices[picked];
  const first = prices[0];
  const last = prices.at(-1);
  const at = drawn?.points[picked ?? prices.length - 1];
  return (
    <View style={styles.chart}>
      <Words kind="title" style={styles.tabular}>
        {money(week ? week.priceCents : priceCents)}
      </Words>
      <Words kind="soft">{week ? `Week of ${dateText(week.date)}` : priceDate ? `On ${dateText(priceDate)}` : 'Date not known'}</Words>
      {first && last && (
        <>
          <GestureDetector gesture={pan}>
            <View
              style={styles.box}
              collapsable={false}
              onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
              accessible
              accessibilityRole="image"
              accessibilityLabel={describePrices(prices)}
            >
              {drawn && at && (
                <>
                  <Svg width={width} height={HEIGHT}>
                    {[drawn.high, drawn.low].map((i) => (
                      <Line key={i} x1={INSET.x} x2={width - INSET.x} y1={drawn.points[i]!.y} y2={drawn.points[i]!.y} stroke={colors.raised} strokeWidth={1} />
                    ))}
                    <Path d={drawn.area} fill={LINE} fillOpacity={0.14} />
                    <Path d={drawn.path} stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" fill="none" />
                    {picked !== null && <Line x1={at.x} x2={at.x} y1={4} y2={HEIGHT} stroke={colors.soft} strokeWidth={1} />}
                    <Circle cx={at.x} cy={at.y} r={6} fill={colors.deep} />
                    <Circle cx={at.x} cy={at.y} r={4} fill={LINE} />
                  </Svg>
                  <Extreme text={`High ${money(prices[drawn.high]!.priceCents)}`} y={drawn.points[drawn.high]!.y - 19} x={drawn.points[drawn.high]!.x} width={width} />
                  {drawn.low !== drawn.high && (
                    <Extreme text={`Low ${money(prices[drawn.low]!.priceCents)}`} y={drawn.points[drawn.low]!.y + 3} x={drawn.points[drawn.low]!.x} width={width} />
                  )}
                </>
              )}
            </View>
          </GestureDetector>
          <View style={styles.dates}>
            <Words kind="soft" style={styles.small}>
              {dateText(first.date, 'short')}
            </Words>
            <Words kind="soft" style={styles.small}>
              {dateText(last.date, 'short')}
            </Words>
          </View>
        </>
      )}
      <Words kind="soft" style={styles.small}>
        {prices.length === 0 ? 'No price history. ' : ''}Test data, not a real price.
      </Words>
    </View>
  );
}

/** Beside its point, and never off the edge. */
function Extreme({ text, x, y, width }: { text: string; x: number; y: number; width: number }) {
  const left = Math.max(0, Math.min(x - 60, width - 120));
  const align = x < 60 ? 'left' : x > width - 60 ? 'right' : 'center';
  return (
    <View pointerEvents="none" style={[styles.extreme, { left, top: y }]}>
      <Words kind="soft" numberOfLines={1} maxFontSizeMultiplier={1.1} style={[styles.small, styles.tabular, { textAlign: align }]}>
        {text}
      </Words>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { borderRadius: 12, backgroundColor: colors.deep, padding: space.l, gap: 2 },
  box: { height: HEIGHT, marginTop: space.s },
  dates: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.s },
  small: { fontSize: 13, lineHeight: 16 },
  tabular: { fontVariant: ['tabular-nums'] },
  extreme: { position: 'absolute', width: 120 },
});
