import { FlashList } from '@shopify/flash-list';
import { memo, useCallback, useMemo } from 'react';
import { ActivityIndicator, Platform, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Engine, OwnedCard } from '../../core/engine';
import type { Card } from '../../core/types';
import { useCatalogue } from '../../lib/catalogue';
import { useSession } from '../../lib/session';
import { useEngine } from '../../lib/useEngine';
import { Button } from '../../ui/Button';
import { CardImage, describeCard } from '../../ui/CardImage';
import { Words } from '../../ui/Words';
import { CARD_RATIO, colors, rarityName, space } from '../../ui/theme';

const COLUMNS = 3;
const GAP = 10;

export default function CollectionTab() {
  const session = useSession();
  return session.status === 'in' ? <Collection key={session.user.id} engine={session.engine} /> : null;
}

/** The cards you own, newest first. The whole catalogue comes later. */
function Collection({ engine }: { engine: Engine }) {
  const snapshot = useEngine(engine);
  const catalogue = useCatalogue(engine);
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - space.l * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  const { owned, saved } = snapshot;
  const shown = useMemo(() => {
    // A card finished offline is yours already. One whose reveal was not seen is kept as a surprise.
    const waiting = Object.values(saved.plays)
      .filter((play) => play.accepted === null && saved.seen[play.challenge.id] && play.challenge.reward)
      .map((play): OwnedCard => ({ cardId: play.challenge.reward!.id, acquiredAt: '', revealSeenAt: 'here' }));
    const hidden = new Set(
      Object.values(saved.plays)
        .filter((play) => play.accepted?.card && !saved.seen[play.challenge.id])
        .map((play) => play.accepted!.card!.id),
    );
    const justSeen = new Set(
      Object.values(saved.plays).flatMap((play) => (saved.seen[play.challenge.id] && play.accepted?.card ? [play.accepted.card.id] : [])),
    );
    const known = new Set((owned ?? []).map((one) => one.cardId));
    return [
      ...waiting.filter((one) => !known.has(one.cardId)),
      ...(owned ?? []).filter((one) => !hidden.has(one.cardId) && (one.revealSeenAt !== null || justSeen.has(one.cardId))),
    ];
  }, [owned, saved]);

  const renderItem = useCallback(
    ({ item }: { item: OwnedCard }) => <Cell card={catalogue?.get(item.cardId) ?? null} width={cell} />,
    [catalogue, cell],
  );

  const failed = snapshot.connection === 'offline' || snapshot.connection === 'trouble';
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.header}>
        <Words kind="title" accessibilityRole="header">
          Collection
        </Words>
        {owned && (
          <Words kind="soft" style={styles.tabular}>
            {shown.length} of {catalogue?.size ?? '1,993'}
          </Words>
        )}
      </View>
      {owned === null || catalogue === null ? (
        <View style={styles.middle}>
          {failed && !snapshot.syncing ? (
            <>
              <Words kind="heading" style={styles.centre}>
                Connect to see your cards
              </Words>
              <View style={styles.wide}>
                <Button title="Try again" onPress={() => void engine.sync()} />
              </View>
            </>
          ) : (
            <ActivityIndicator color={colors.soft} size="large" />
          )}
        </View>
      ) : shown.length === 0 ? (
        <View style={styles.middle}>
          <Words kind="heading" style={styles.centre}>
            No cards yet
          </Words>
          <Words kind="soft" style={styles.centre}>
            Finish today&apos;s challenge to pull your first one.
          </Words>
        </View>
      ) : (
        <FlashList
          data={shown}
          numColumns={COLUMNS}
          keyExtractor={(item) => item.cardId}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void engine.sync()} tintColor={colors.soft} />}
        />
      )}
    </SafeAreaView>
  );
}

const Cell = memo(function Cell({ card, width }: { card: Card | null; width: number }) {
  return (
    <View style={styles.cell} accessible accessibilityLabel={card ? `${describeCard(card)}. ${rarityName[card.rarity]}` : 'Card'}>
      {card ? <CardImage card={card} width={width} height={Math.floor(width * CARD_RATIO)} /> : <View style={{ width, height: Math.floor(width * CARD_RATIO) }} />}
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.mat },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.m },
  tabular: { fontVariant: ['tabular-nums'] },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m, paddingHorizontal: space.xl },
  centre: { textAlign: 'center' },
  wide: { alignSelf: 'stretch', marginTop: space.m },
  list: { paddingHorizontal: space.l - GAP / 2, paddingBottom: Platform.select({ ios: 110, default: space.xxl }) },
  cell: { paddingHorizontal: GAP / 2, paddingBottom: GAP },
});
