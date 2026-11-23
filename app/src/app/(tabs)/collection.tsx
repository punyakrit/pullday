import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ownedNow } from '../../core/collection';
import type { Engine } from '../../core/engine';
import type { Card } from '../../core/types';
import { useCatalogue } from '../../lib/catalogue';
import { gridSize } from '../../lib/images';
import { useSession } from '../../lib/session';
import { useEngine } from '../../lib/useEngine';
import { Button } from '../../ui/Button';
import { CardImage, describeCard } from '../../ui/CardImage';
import { Words } from '../../ui/Words';
import { CARD_RATIO, colors, rarityName, space } from '../../ui/theme';

const GAP = 10;
/** A tablet or a wide window gets more columns, not bigger cards. */
const columnsFor = (width: number) => Math.max(3, Math.floor(width / 150));
const count = new Intl.NumberFormat('en-US');
const keyOf = (card: Card) => card.id;

export default function CollectionTab() {
  const session = useSession();
  return session.status === 'in' ? <Collection key={session.user.id} engine={session.engine} /> : null;
}

/** The whole catalogue: yours in colour, the rest grey. */
function Collection({ engine }: { engine: Engine }) {
  const snapshot = useEngine(engine);
  const catalogue = useCatalogue(engine, snapshot.connection);
  const { width } = useWindowDimensions();
  const columns = columnsFor(width);
  const cell = Math.floor((width - space.l * 2 - GAP * (columns - 1)) / columns);
  const [filter, setFilter] = useState<'all' | 'yours'>('all');
  const [pulling, setPulling] = useState(false);
  const list = useRef<FlashListRef<Card>>(null);

  const { owned, saved } = snapshot;
  const yours = useMemo(() => ownedNow(owned, saved), [owned, saved]);
  // Only a new set of ids draws the cards again. Every sync brings a new list with the same ones.
  const key = yours.map((one) => one.cardId).join();
  const ids = useMemo(() => new Set(key ? key.split(',') : []), [key]);
  const cards = useMemo(() => {
    if (!catalogue) return [];
    if (filter === 'all') return catalogue.list;
    return [...ids].flatMap((id) => catalogue.byId.get(id) ?? []);
  }, [catalogue, filter, ids]);

  const renderItem = useCallback(({ item }: { item: Card }) => <Cell card={item} owned={ids.has(item.id)} width={cell} />, [cell, ids]);
  const refresh = useCallback(async () => {
    setPulling(true);
    await engine.sync();
    setPulling(false);
  }, [engine]);
  const choose = useCallback((next: 'all' | 'yours') => {
    setFilter(next);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const failed = snapshot.connection === 'offline' || snapshot.connection === 'trouble';
  const known = owned !== null && catalogue !== null;
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.header}>
        <Words kind="title" accessibilityRole="header">
          Collection
        </Words>
        {known && (
          <Words kind="soft" style={styles.tabular} accessibilityLabel={`You have ${yours.length} of ${catalogue.list.length} cards`}>
            {count.format(yours.length)} of {count.format(catalogue.list.length)}
          </Words>
        )}
      </View>
      {!known ? (
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
            <ActivityIndicator color={colors.soft} size="large" accessibilityLabel="Getting your cards" />
          )}
        </View>
      ) : (
        <>
          <View style={styles.filter} accessibilityRole="tablist">
            <Choice title="All cards" chosen={filter === 'all'} onPress={() => choose('all')} />
            <Choice title="Yours" chosen={filter === 'yours'} onPress={() => choose('yours')} />
          </View>
          {cards.length === 0 ? (
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
              ref={list}
              data={cards}
              extraData={ids}
              numColumns={columns}
              keyExtractor={keyOf}
              renderItem={renderItem}
              drawDistance={DRAW}
              maintainVisibleContentPosition={OFF}
              contentContainerStyle={styles.list}
              contentInsetAdjustmentBehavior="automatic"
              indicatorStyle="white"
              refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void refresh()} tintColor={colors.soft} colors={[colors.mat]} />}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

/** How far ahead of the screen cells are ready, in points. */
const DRAW = 500;
const OFF = { disabled: true };

function Choice({ title, chosen, onPress }: { title: string; chosen: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: chosen }} accessibilityLabel={title} onPress={onPress} style={[styles.choice, chosen && styles.chosen]}>
      <Words kind="label" style={{ color: chosen ? colors.onLabel : colors.soft }} maxFontSizeMultiplier={1.2}>
        {title}
      </Words>
    </Pressable>
  );
}

const Cell = memo(function Cell({ card, owned, width }: { card: Card; owned: boolean; width: number }) {
  const height = Math.floor(width * CARD_RATIO);
  return (
    <View style={styles.cell} accessible accessibilityLabel={`${describeCard(card)}. ${rarityName[card.rarity]}. ${owned ? 'Yours' : 'Not yours yet'}`}>
      <CardImage card={card} width={width} height={height} grey={!owned} size={gridSize(width)} />
      {/* Grey is not enough to tell them apart: a slab is mostly grey and white already. */}
      {!owned && <View pointerEvents="none" style={[styles.asleep, { width, height, borderRadius: width * 0.05 }]} />}
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.mat },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.s },
  tabular: { fontVariant: ['tabular-nums'] },
  filter: { flexDirection: 'row', gap: space.xs, marginHorizontal: space.l, marginBottom: space.m, padding: 3, borderRadius: 10, backgroundColor: colors.deep },
  choice: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  chosen: { backgroundColor: colors.common },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m, paddingHorizontal: space.xl },
  centre: { textAlign: 'center' },
  wide: { alignSelf: 'stretch', marginTop: space.m },
  list: { paddingHorizontal: space.l - GAP / 2, paddingBottom: Platform.select({ ios: 110, default: space.xxl }) },
  cell: { paddingHorizontal: GAP / 2, paddingBottom: GAP },
  asleep: { position: 'absolute', left: GAP / 2, backgroundColor: 'rgba(15, 61, 60, 0.52)' },
});
