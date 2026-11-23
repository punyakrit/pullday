import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useIsFocused } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, type HostInstance, Platform, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ownedNow } from '../../core/collection';
import type { Engine } from '../../core/engine';
import type { Card } from '../../core/types';
import { useCatalogue } from '../../lib/catalogue';
import { GAP, gridFor } from '../../lib/grid';
import type { ImageWidth } from '../../lib/images';
import { openCard } from '../../lib/openCard';
import { useSession } from '../../lib/session';
import { useEngine } from '../../lib/useEngine';
import { Button } from '../../ui/Button';
import { CardImage, describeCard } from '../../ui/CardImage';
import { Press } from '../../ui/Press';
import { Opening } from '../../ui/Rise';
import { Roll } from '../../ui/Roll';
import { Words } from '../../ui/Words';
import { hairline } from '../../ui/hairline';
import { CARD_RATIO, colors, rarityName, space } from '../../ui/theme';

const count = new Intl.NumberFormat('en-US');
const keyOf = (card: Card) => card.id;

export default function CollectionTab() {
  const session = useSession();
  // The tab bar makes every tab at launch. Nothing of this one is made, or downloaded, until it is opened.
  const focused = useIsFocused();
  const [opened, setOpened] = useState(false);
  if (focused && !opened) setOpened(true);
  if (!opened) return <View style={styles.screen} />;
  return session.status === 'in' ? <Collection key={session.user.id} engine={session.engine} /> : null;
}

/** The whole catalogue: yours in colour, the rest grey. */
function Collection({ engine }: { engine: Engine }) {
  const snapshot = useEngine(engine);
  const catalogue = useCatalogue(engine, snapshot.connection);
  const { width } = useWindowDimensions();
  const { columns, cell, size } = gridFor(width);
  const [filter, setFilter] = useState<Filter>('all');
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

  const renderItem = useCallback(({ item }: { item: Card }) => <Cell card={item} owned={ids.has(item.id)} width={cell} size={size} />, [cell, ids, size]);
  const refresh = useCallback(async () => {
    setPulling(true);
    await engine.sync();
    setPulling(false);
  }, [engine]);
  const choose = useCallback((next: Filter) => {
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
          <View style={styles.count} accessible accessibilityLabel={`You have ${yours.length} of ${catalogue.list.length} cards`}>
            <Opening>
              <Roll text={count.format(yours.length)} size={27} />
            </Opening>
            <Words kind="soft" style={styles.of}>of {count.format(catalogue.list.length)}</Words>
          </View>
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
          <Choices filter={filter} onChoose={choose} />
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
              indicatorStyle="black"
              refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void refresh()} tintColor={colors.soft} colors={[colors.ink]} />}
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

type Filter = 'all' | 'yours';

/** The white part slides to the one that is chosen. */
function Choices({ filter, onChoose }: { filter: Filter; onChoose: (next: Filter) => void }) {
  const [width, setWidth] = useState(0);
  const at = useSharedValue(filter === 'all' ? 0 : 1);
  useEffect(() => {
    at.value = withSpring(filter === 'all' ? 0 : 1, { duration: 320, dampingRatio: 0.85 });
  }, [at, filter]);
  const half = Math.max(0, (width - 6) / 2);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: at.value * half }] }));
  return (
    <View style={styles.filter} accessibilityRole="tablist" onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
      {half > 0 && <Animated.View style={[styles.chosen, { width: half }, slide]} />}
      <Choice title="All cards" chosen={filter === 'all'} onPress={() => onChoose('all')} />
      <Choice title="Yours" chosen={filter === 'yours'} onPress={() => onChoose('yours')} />
    </View>
  );
}

function Choice({ title, chosen, onPress }: { title: string; chosen: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: chosen }} accessibilityLabel={title} onPress={onPress} style={styles.choice}>
      <Words kind="label" style={{ color: chosen ? colors.ink : colors.soft }} maxFontSizeMultiplier={1.2}>
        {title}
      </Words>
    </Pressable>
  );
}

const Cell = memo(function Cell({ card, owned, width, size }: { card: Card; owned: boolean; width: number; size: ImageWidth }) {
  const height = Math.floor(width * CARD_RATIO);
  return (
    <Press
      style={styles.cell}
      onPress={(event) => openCard(card.id, event.currentTarget as unknown as HostInstance, width)}
      accessibilityRole="button"
      accessibilityLabel={`${describeCard(card)}. ${rarityName[card.rarity]}. ${owned ? 'Yours' : 'Not yours yet'}`}
    >
      <CardImage card={card} width={width} height={height} grey={!owned} asleep={!owned} size={size} />
    </Press>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.s },
  count: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  of: { paddingBottom: 4 },
  filter: { flexDirection: 'row', marginHorizontal: space.l, marginBottom: space.m, padding: 3, borderRadius: 14, backgroundColor: '#E7E7E7' },
  choice: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  chosen: { position: 'absolute', left: 3, top: 3, bottom: 3, borderRadius: 11, backgroundColor: colors.panel, borderWidth: hairline, borderColor: colors.line },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m, paddingHorizontal: space.xl },
  centre: { textAlign: 'center' },
  wide: { alignSelf: 'stretch', marginTop: space.m },
  list: { paddingHorizontal: space.l - GAP / 2, paddingBottom: Platform.select({ ios: 110, default: space.xxl }) },
  cell: { paddingHorizontal: GAP / 2, paddingBottom: GAP },
});
