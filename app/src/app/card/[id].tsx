import { useLocalSearchParams, useNavigation } from 'expo-router';
import { type ComponentRef, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ownedNow } from '../../core/collection';
import type { Engine } from '../../core/engine';
import { dayOf } from '../../core/prices';
import type { Card } from '../../core/types';
import { cardOnPhone } from '../../lib/catalogue';
import { useSession } from '../../lib/session';
import { gridFor } from '../../lib/grid';
import { openedFrom } from '../../lib/openCard';
import { useDetails } from '../../lib/useDetails';
import { useEngine } from '../../lib/useEngine';
import { Button } from '../../ui/Button';
import { CardImage, describeCard } from '../../ui/CardImage';
import { Shape } from '../../ui/Icons';
import { panel } from '../../ui/Panel';
import { PriceChart } from '../../ui/PriceChart';
import { Opening, Rise } from '../../ui/Rise';
import { Words } from '../../ui/Words';
import { hairline } from '../../ui/hairline';
import { CARD_RATIO, colors, rarityColor, rarityName, space } from '../../ui/theme';

export default function CardScreen() {
  const session = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  return session.status === 'in' && id ? <CardDetails key={id} engine={session.engine} id={id} /> : null;
}

function CardDetails({ engine, id }: { engine: Engine; id: string }) {
  const snapshot = useEngine(engine);
  const card = cardOnPhone(id); // the list it was opened from has it
  const insets = useSafeAreaInsets();
  const { owned, saved } = snapshot;
  const mine = useMemo(() => ownedNow(owned, saved).find((one) => one.cardId === id) ?? null, [id, owned, saved]);

  return (
    <Opening>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
        contentInsetAdjustmentBehavior="automatic"
        indicatorStyle="black"
      >
        {card ? (
          <>
            <Art card={card} owned={mine !== null} />
            <Rise at={1} style={styles.name}>
              <Shape rarity={card.rarity} size={24} />
              <Words kind="title" style={styles.shrink} accessibilityRole="header">
                {card.name}
              </Words>
            </Rise>
            <Rise at={2}>
              <Words kind="soft" style={styles.centre}>
                <Words kind="soft" style={{ color: rarityColor[card.rarity] }}>
                  {rarityName[card.rarity]}
                </Words>
                {mine === null ? '. Not yours yet' : mine.acquiredAt ? `. Yours since ${dayOf(mine.acquiredAt, snapshot.today?.timezone)}` : '. Yours'}
              </Words>
            </Rise>
            <More engine={engine} card={card} />
          </>
        ) : (
          <Words kind="soft" style={styles.centre}>
            This card is not on this phone yet. Connect to see it.
          </Words>
        )}
      </ScrollView>
    </Opening>
  );
}

function Art({ card, owned }: { card: Card; owned: boolean }) {
  const window = useWindowDimensions();
  const width = Math.floor(Math.min(window.width * 0.64, (window.height * 0.55) / CARD_RATIO, 320));
  const reduced = useReducedMotion();
  const view = useRef<ComponentRef<typeof View>>(null);
  const [start] = useState(() => openedFrom(card.id));
  const grown = useSharedValue(start && !reduced ? 0 : 1);
  const off = useSharedValue({ x: 0, y: 0, scale: 1 });
  // It starts where it was tapped, at the size it was there, and grows into its place.
  useLayoutEffect(() => {
    if (!start || reduced) return;
    view.current?.measureInWindow((x, y) => {
      const scale = start.width / width;
      off.value = { x: start.x + start.width / 2 - (x + width / 2), y: start.y + (start.width * CARD_RATIO) / 2 - (y + (width * CARD_RATIO) / 2), scale };
      grown.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    });
  }, [grown, off, reduced, start, width]);
  const growing = useAnimatedStyle(() => {
    const left = 1 - grown.value;
    return { transform: [{ translateX: off.value.x * left }, { translateY: off.value.y * left }, { scale: 1 + (off.value.scale - 1) * left }] };
  });
  return (
    <View style={styles.art} accessible accessibilityRole="image" accessibilityLabel={describeCard(card)}>
      <View ref={view} collapsable={false} style={{ width, height: Math.floor(width * CARD_RATIO) }}>
        <Animated.View style={growing}>
          <CardImage card={card} width={width} height={Math.floor(width * CARD_RATIO)} grey={!owned} shape under={gridFor(window.width).size} priority="high" />
        </Animated.View>
      </View>
    </View>
  );
}

/** What the server knows. It waits for the screen to have opened, so it never stutters the opening. */
function More({ engine, card }: { engine: Engine; card: Card }) {
  const snapshot = useEngine(engine);
  const { details, loading, retry } = useDetails(engine, card.id, snapshot.connection, snapshot.unsent);
  const settled = useSettled();
  const shown = settled ? details : null;

  return (
    <>
      <Rise at={3} style={styles.facts}>
        <Fact name="Set" value={card.set} />
        <Fact name="Year" value={String(card.year)} />
        <Fact name="Number" value={card.number ?? 'Not numbered'} />
        {card.variety !== null && <Fact name="Variety" value={card.variety} />}
        <Fact name="Grade" value={`${shown?.grader ?? 'PSA'} ${card.grade}`} />
        <Fact name="Population" value={shown ? `${shown.population.toLocaleString('en-US')} at this grade` : ' '} last />
      </Rise>
      {shown ? (
        <>
          <Section title="Price">
            <PriceChart priceCents={shown.priceCents} priceDate={shown.priceDate} history={shown.priceHistory} />
          </Section>
          <Section title="Story">
            <Words>{shown.story}</Words>
          </Section>
        </>
      ) : loading || !settled ? (
        <View style={styles.waiting}>
          <ActivityIndicator color={colors.soft} accessibilityLabel="Getting the price and story" />
        </View>
      ) : (
        <View style={styles.waiting}>
          <Words kind="soft" style={styles.centre}>
            {whyNot(engine, snapshot.connection)}
          </Words>
          {engine.waitsFor() !== 'finish' && (
            <View style={styles.wide}>
              <Button kind="quiet" title="Try again" onPress={retry} />
            </View>
          )}
        </View>
      )}
    </>
  );
}

function whyNot(engine: Engine, connection: string): string {
  const waits = engine.waitsFor();
  if (waits === 'finish') return 'Finish the challenge you started first. Then the price and story load.';
  if (waits === 'send') return 'Your finished challenge is sent first. Then the price and story load.';
  if (connection === 'trouble') return "Pullday is having trouble, so the price and story aren't here.";
  return 'Connect to see the price and story.';
}

/** The screen has finished sliding in. The timer is for when there was no slide. */
function useSettled(): boolean {
  const navigation = useNavigation();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const done = () => setSettled(true);
    const timer = setTimeout(done, 600);
    // Not in the general type: it is the native stack's own event.
    const stop = (navigation as unknown as { addListener(name: 'transitionEnd', heard: () => void): () => void }).addListener('transitionEnd', done);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [navigation]);
  return settled;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Opening>
      <Rise style={styles.section}>
        <Words kind="heading" accessibilityRole="header">
          {title}
        </Words>
        {children}
      </Rise>
    </Opening>
  );
}

function Fact({ name, value, last = false }: { name: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.fact, !last && styles.line]} accessible accessibilityLabel={`${name}. ${value}`}>
      <Words kind="soft" style={styles.factName}>
        {name}
      </Words>
      <Words style={styles.factValue}>{value}</Words>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: space.xl, paddingTop: space.s, gap: space.m },
  art: { alignItems: 'center', paddingBottom: space.s, zIndex: 1 },
  name: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s },
  shrink: { flexShrink: 1, textAlign: 'center' },
  centre: { textAlign: 'center' },
  facts: { ...panel, marginTop: space.s, paddingHorizontal: space.xl, paddingVertical: space.xs },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: space.l, paddingVertical: 13 },
  line: { borderBottomWidth: hairline, borderBottomColor: colors.line },
  factName: { minWidth: 84 },
  factValue: { flexShrink: 1, textAlign: 'right' },
  section: { gap: space.s, marginTop: space.m },
  waiting: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: space.m },
  wide: { alignSelf: 'stretch' },
});
