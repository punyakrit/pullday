import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Engine, Snapshot } from '../core/engine';
import type { View as DayView } from '../core/state';
import { daysText } from '../core/streakDays';
import { useServerNow } from '../lib/useEngine';
import { CardImage, describeCard } from '../ui/CardImage';
import { Shape } from '../ui/Icons';
import { LiveFlame } from '../ui/LiveFlame';
import { Opening, Rise } from '../ui/Rise';
import { Ticking } from '../ui/Roll';
import { Words } from '../ui/Words';
import { CARD_RATIO, rarityColor, rarityName, space } from '../ui/theme';

export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
}

type Props = { engine: Engine; snapshot: Snapshot; view: Extract<DayView, { kind: 'done' }> };

/** Today is done: the card, and the time to the next one. */
export function Done({ engine, snapshot, view }: Props) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const left = view.nextAt - engine.clock.now();
  const now = useServerNow(engine, left > 3_600_000 ? 15_000 : 1_000);
  const { card } = view;
  const width = Math.floor(Math.min(window.width * 0.56, (window.height - insets.top - insets.bottom - 380) / CARD_RATIO));
  const streak = snapshot.today?.streak ?? 0;

  return (
    <Opening>
      <View style={styles.screen}>
        <Rise style={styles.wide}>
          <Words kind="title" accessibilityRole="header" style={styles.centre}>
            Done for today
          </Words>
        </Rise>
        <Rise at={1}>
          {card ? (
            <View style={styles.card} accessible accessibilityLabel={`Today's card. ${describeCard(card)}. ${rarityName[card.rarity]}.`}>
              <CardImage card={card} width={width} height={Math.floor(width * CARD_RATIO)} shape priority="high" />
              <View style={styles.name}>
                <Shape rarity={card.rarity} size={18} />
                <Words kind="label" numberOfLines={1} style={styles.shrink}>
                  {card.name}
                </Words>
                <Words kind="label" style={{ color: rarityColor[card.rarity] }}>
                  {rarityName[card.rarity]}
                </Words>
              </View>
            </View>
          ) : (
            <Words kind="soft" style={styles.centre}>
              You own every card, so there was none to pull.
            </Words>
          )}
        </Rise>

        <Rise at={2}>
          <View style={styles.next} accessible accessibilityLabel={`Next challenge in ${countdown(view.nextAt - now)}`}>
            <Words kind="soft">Next challenge in</Words>
            <Ticking text={countdown(view.nextAt - now)} size={46} />
          </View>
        </Rise>
        <Rise at={3} style={styles.name}>
          <LiveFlame size={20} streak={snapshot.streak} />
          <Words kind="label">
            {snapshot.streakKnown
              ? `${daysText(streak)} in a row`
              : snapshot.unsent > 0 && snapshot.streakOld
                ? 'Your streak updates when you are online'
                : 'Checking your streak'}
          </Words>
        </Rise>
      </View>
    </Opening>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: space.l, paddingBottom: space.m },
  centre: { textAlign: 'center' },
  wide: { alignSelf: 'stretch' },
  card: { alignItems: 'center', gap: space.m },
  name: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s, maxWidth: '100%' },
  shrink: { flexShrink: 1 },
  next: { alignItems: 'center' },
});
