import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  ReduceMotion,
  type SharedValue,
  cancelAnimation,
  interpolate,
  makeMutable,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import type { Card, Challenge, Rarity } from '../core/types';
import { haptics } from '../lib/haptics';
import { CardImage, describeCard } from '../ui/CardImage';
import { Icon, Shape } from '../ui/Icons';
import { Words } from '../ui/Words';
import { CARD_RATIO, colors, rarityColor, rarityName, space } from '../ui/theme';
import { decide, liftSpeed, pull } from './swipe';

type Props = {
  challenge: Challenge;
  answers: Rarity[];
  onBegin: () => void;
  onAnswer: (index: number, rarity: Rarity) => void;
};

/** One card's place on the UI thread. Each has its own, so a card in flight never holds up the next. */
type Place = { x: SharedValue<number>; y: SharedValue<number>; verdict: SharedValue<number>; fade: SharedValue<number> };

const HOME = { stiffness: 420, damping: 32, mass: 0.9 } as const;
const STEP = { duration: 220, dampingRatio: 1 } as const;
const DIRECTIONS: { rarity: Rarity; way: 'left' | 'up' | 'right' }[] = [
  { rarity: 'common', way: 'left' },
  { rarity: 'holo', way: 'up' },
  { rarity: 'rare', way: 'right' },
];

type Size = { width: number; height: number };
const ACTIONS = DIRECTIONS.map(({ rarity }) => ({ name: rarity, label: rarityName[rarity] }));

export function Deck({ challenge, answers: saved, onBegin, onAnswer }: Props) {
  // Fixed for as long as this challenge is on screen. A refresh in the background brings a new copy
  // of the same challenge, and must not touch a card that is under a finger.
  const [{ cards, rarities, places }] = useState(() => ({
    cards: challenge.cards,
    rarities: challenge.cards.map((card) => card.rarity),
    // Cards sorted before this opened, or before the app was killed, start out gone.
    places: challenge.cards.map(
      (_, i): Place => ({ x: makeMutable(0), y: makeMutable(0), verdict: makeMutable(0), fade: makeMutable(i < saved.length ? 0 : 1) }),
    ),
  }));
  const latest = useRef({ onBegin, onAnswer });
  useLayoutEffect(() => {
    latest.current = { onBegin, onAnswer };
  });

  const reduced = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();
  const [answers, setAnswers] = useState(saved);
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });
  const top = useSharedValue(saved.length); // the card a finger moves. Decided on the UI thread only
  const size = useSharedValue<Size>({ width: 1, height: 1 });
  const index = answers.length;

  // The ones a finger can reach first, the rest straight after, all before the first swipe is done.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 350);
    return () => clearTimeout(timer);
  }, []);

  const begin = useCallback(() => latest.current.onBegin(), []);
  const answered = useCallback(
    (i: number, rarity: Rarity) => {
      const card = cards[i]!;
      const right = card.rarity === rarity;
      latest.current.onAnswer(i, rarity); // saved first
      setAnswers((before) => (before.length === i ? [...before, rarity] : before));
      if (right) haptics.right();
      else haptics.wrong();
      const left = cards.length - i - 1;
      AccessibilityInfo.announceForAccessibility(
        `${right ? 'Right' : 'Not quite'}. ${card.name} is ${card.rarity}. ${left === 0 ? 'All done.' : `${left} to go.`}`,
      );
    },
    [cards],
  );

  /** Everything that happens when a card is let go, in one frame, without waiting for React. */
  const throwCard = useCallback(
    (i: number, rarity: Rarity, vx: number, vy: number) => {
      'worklet';
      const place = places[i];
      if (!place || i !== top.value) return; // already thrown
      top.value = i + 1;
      place.verdict.value = rarities[i] === rarity ? 1 : 2;
      const { width, height } = size.value;
      if (reduced) {
        place.fade.value = withTiming(0, { duration: 180, reduceMotion: ReduceMotion.Never });
      } else {
        const across = rarity === 'common' ? -width * 1.35 : rarity === 'rare' ? width * 1.35 : place.x.value + vx * 0.12;
        const along = rarity === 'holo' ? -height - windowHeight * 0.6 : place.y.value + vy * 0.12;
        const distance = Math.hypot(across - place.x.value, along - place.y.value);
        const speed = Math.max(Math.hypot(vx, vy), 1500);
        const duration = Math.min(Math.max((distance / speed) * 1000, 150), 330);
        const flight = { duration, easing: Easing.out(Easing.quad) };
        place.x.value = withTiming(across, flight);
        place.y.value = withTiming(along, flight);
      }
      scheduleOnRN(answered, i, rarity);
    },
    [answered, places, rarities, reduced, size, top, windowHeight],
  );

  const press = useCallback(
    (rarity: Rarity) => {
      begin();
      scheduleOnUI(() => {
        'worklet';
        throwCard(top.value, rarity, 0, 0);
      });
    },
    [begin, throwCard, top],
  );

  const cardWidth = Math.floor(Math.min(area.width * 0.82, (area.height - 34) / CARD_RATIO));
  const cardHeight = Math.floor(cardWidth * CARD_RATIO);
  const last = index > 0 ? { card: cards[index - 1]!, right: answers[index - 1] === cards[index - 1]!.rarity } : null;
  const current = cards[index];

  useEffect(() => {
    if (current && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(describeCard(current));
  }, [current]);

  return (
    <View style={styles.fill}>
      <Pips cards={cards} answers={answers} />
      <View style={styles.verdict} accessibilityLiveRegion="polite">
        {last ? (
          <>
            <Icon name={last.right ? 'check' : 'cross'} size={20} color={last.right ? colors.green : colors.red} weight={3} />
            <Words kind="label" numberOfLines={2} style={styles.shrink}>
              {last.right ? 'Right, ' : 'Not quite, '}
              {last.card.name} is {rarityName[last.card.rarity].toLowerCase()}
            </Words>
          </>
        ) : (
          <Words kind="label" style={{ color: colors.soft }}>
            Which pile does it go in?
          </Words>
        )}
      </View>

      <View
        style={styles.fill}
        onLayout={({ nativeEvent: { layout } }) => {
          setArea({ width: layout.width, height: layout.height });
          size.value = { width: layout.width, height: layout.height };
        }}
        accessible={Boolean(current)}
        accessibilityLabel={current ? `Card ${index + 1} of ${cards.length}. ${describeCard(current)}` : undefined}
        accessibilityHint="Swipe left for common, right for rare, up for holo, or use the buttons below"
        accessibilityActions={ACTIONS}
        onAccessibilityAction={({ nativeEvent }) => press(nativeEvent.actionName as Rarity)}
      >
        <View style={styles.deck} pointerEvents="none">
          {cardWidth > 0 &&
            cards
              .map((card, i) => ({ card, i }))
              .filter(({ i }) => settled || (i >= index && i <= index + 2))
              .reverse()
              .map(({ card, i }) => (
                <DeckCard key={card.id} card={card} i={i} top={top} place={places[i]!} size={size} width={cardWidth} height={cardHeight} />
              ))}
          {cardWidth > 0 && <Overlay places={places} top={top} size={size} width={cardWidth} height={cardHeight} />}
        </View>
        <Surface places={places} top={top} size={size} throwCard={throwCard} begin={begin} />
      </View>

      <View style={styles.piles}>
        {DIRECTIONS.map(({ rarity, way }) => (
          <Pile key={rarity} rarity={rarity} way={way} places={places} top={top} size={size} onPress={press} disabled={!current} />
        ))}
      </View>
    </View>
  );
}

type SurfaceProps = {
  places: Place[];
  top: SharedValue<number>;
  size: SharedValue<Size>;
  throwCard: (i: number, rarity: Rarity, vx: number, vy: number) => void;
  begin: () => void;
};

/**
 * What the finger touches. Its props never change during a challenge, so it is never rendered
 * again, so an answer being saved cannot drop the next swipe.
 */
const Surface = memo(function Surface({ places, top, size, throwCard, begin }: SurfaceProps) {
  const held = useSharedValue(-1);
  const start = useSharedValue({ x: 0, y: 0 }); // where the card was
  const touch = useSharedValue({ x: 0, y: 0, at: 0 }); // where the finger went down
  const armed = useSharedValue<Rarity | ''>('');
  const moved = useSharedValue(false);

  const pan = usePanGesture({
    maxPointers: 1,
    minDistance: 2,
    shouldCancelWhenOutside: false,
    onBegin: (event) => {
      'worklet';
      touch.value = { x: event.absoluteX, y: event.absoluteY, at: performance.now() };
      moved.value = false;
      scheduleOnRN(begin);
    },
    onActivate: () => {
      'worklet';
      moved.value = true;
      const place = places[top.value];
      held.value = -1;
      // A touch that began on another deck, or before this one was here, moves nothing.
      if (!place || touch.value.at === 0) return;
      held.value = top.value;
      cancelAnimation(place.x); // catch it, even on its way home
      cancelAnimation(place.y);
      start.value = { x: place.x.value, y: place.y.value };
      armed.value = '';
    },
    onUpdate: (event) => {
      'worklet';
      const place = places[held.value];
      if (!place || held.value !== top.value) return; // a button threw it meanwhile
      // From where the finger went down, so the card is under it from the first pixel.
      place.x.value = start.value.x + event.absoluteX - touch.value.x;
      place.y.value = start.value.y + event.absoluteY - touch.value.y;
      const { width, height } = size.value;
      const now = decide(place.x.value, place.y.value, 0, 0, width, height) ?? '';
      if (now !== armed.value) {
        armed.value = now;
        if (now !== '') scheduleOnRN(haptics.armed);
      }
    },
    onDeactivate: (event) => {
      'worklet';
      const i = held.value;
      held.value = -1;
      armed.value = '';
      const place = places[i];
      if (!place || i !== top.value) return;
      const { width, height } = size.value;
      // The end of a fast flick is only in this event. The last update may be from before it.
      const movedX = event.absoluteX - touch.value.x;
      const movedY = event.absoluteY - touch.value.y;
      const elapsed = performance.now() - touch.value.at;
      const vx = liftSpeed(event.velocityX, movedX, elapsed);
      const vy = liftSpeed(event.velocityY, movedY, elapsed);
      const going = event.canceled ? null : decide(start.value.x + movedX, start.value.y + movedY, vx, vy, width, height);
      if (going) {
        throwCard(i, going, vx, vy);
      } else {
        place.x.value = withSpring(0, { ...HOME, velocity: event.velocityX });
        place.y.value = withSpring(0, { ...HOME, velocity: event.velocityY });
      }
    },
    onFinalize: (event) => {
      'worklet';
      const { at } = touch.value;
      const here = { x: touch.value.x, y: touch.value.y };
      touch.value = { x: 0, y: 0, at: 0 };
      if (moved.value || at === 0) return;
      // It lifted before a single move was seen. Somewhere else means a flick on a busy phone.
      const movedX = event.absoluteX - here.x;
      const movedY = event.absoluteY - here.y;
      const elapsed = performance.now() - at;
      const vx = liftSpeed(0, movedX, elapsed);
      const vy = liftSpeed(0, movedY, elapsed);
      const { width, height } = size.value;
      const going = vx !== 0 || vy !== 0 ? decide(movedX, movedY, vx, vy, width, height) : null;
      if (going) throwCard(top.value, going, vx, vy);
    },
  });

  return (
    <GestureDetector gesture={pan}>
      <View style={StyleSheet.absoluteFill} collapsable={false} importantForAccessibility="no" />
    </GestureDetector>
  );
});

type DeckCardProps = {
  card: Card;
  i: number;
  top: SharedValue<number>;
  place: Place;
  size: SharedValue<Size>;
  width: number;
  height: number;
};

/** The transform of a card lying at its place. Shared with what is drawn over it. */
function lie(place: Place, depth: number, across: number) {
  'worklet';
  const tilt = interpolate(place.x.value, [-across, 0, across], [-14, 0, 14], Extrapolation.CLAMP);
  return [
    { translateX: place.x.value },
    { translateY: place.y.value + depth * 19 },
    { rotate: `${tilt}deg` },
    { scale: 1 - depth * 0.045 },
  ];
}

/** Three views and no more. All eight are here before the first swipe, so a swipe mounts nothing. */
const DeckCard = memo(function DeckCard({ card, i, top, place, size, width, height }: DeckCardProps) {
  // 0 on top, 1 next, 2 behind it. Moves up by itself the moment the top card is let go.
  const depth = useDerivedValue(() => withSpring(Math.max(0, i - top.value), STEP));
  const style = useAnimatedStyle(() => ({
    opacity: place.fade.value * interpolate(depth.value, [2, 3], [1, 0], Extrapolation.CLAMP),
    transform: lie(place, depth.value, size.value.width),
  }));
  const shade = useAnimatedStyle(() => ({ opacity: Math.min(depth.value * 0.28, 0.5) }));

  return (
    <Animated.View style={[styles.card, { width, height, borderRadius: width * 0.05 }, style]}>
      <CardImage card={card} width={width} height={height} priority={i < 3 ? 'high' : 'normal'} fade={false} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.deep, borderRadius: width * 0.05 }, shade]} />
    </Animated.View>
  );
});

type OverlayProps = { places: Place[]; top: SharedValue<number>; size: SharedValue<Size>; width: number; height: number };

/** One set of stamps that follows the card on top, and one mark that flies off with the last one. */
const Overlay = memo(function Overlay({ places, top, size, width, height }: OverlayProps) {
  const onTop = useAnimatedStyle(() => {
    const place = places[top.value];
    return place ? { opacity: 1, transform: lie(place, 0, size.value.width) } : { opacity: 0, transform: [] };
  });
  const thrown = useAnimatedStyle(() => {
    const place = places[top.value - 1];
    const here = place !== undefined && place.verdict.value !== 0;
    return here ? { opacity: place.fade.value, transform: lie(place, 0, size.value.width) } : { opacity: 0, transform: [] };
  });
  const right = useAnimatedStyle(() => ({ opacity: places[top.value - 1]?.verdict.value === 1 ? 1 : 0 }));
  const wrong = useAnimatedStyle(() => ({ opacity: places[top.value - 1]?.verdict.value === 2 ? 1 : 0 }));

  return (
    <>
      <Animated.View style={[styles.card, { width, height }, onTop]}>
        {DIRECTIONS.map(({ rarity, way }) => (
          <Stamp key={rarity} rarity={rarity} way={way} places={places} top={top} size={size} />
        ))}
      </Animated.View>
      <Animated.View style={[styles.card, { width, height }, thrown]}>
        <Animated.View style={[styles.mark, { backgroundColor: colors.green }, right]}>
          <Icon name="check" size={46} color={colors.onLabel} weight={3} />
        </Animated.View>
        <Animated.View style={[styles.mark, { backgroundColor: colors.red }, wrong]}>
          <Icon name="cross" size={46} color={colors.onLabel} weight={3} />
        </Animated.View>
      </Animated.View>
    </>
  );
});

type StampProps = { rarity: Rarity; way: 'left' | 'up' | 'right'; places: Place[]; top: SharedValue<number>; size: SharedValue<Size> };

/** Says where the card will go while it is dragged. Filled in once letting go will throw it. */
const Stamp = memo(function Stamp({ rarity, way, places, top, size }: StampProps) {
  const strength = useDerivedValue(() => {
    const place = places[top.value];
    return place ? pull(place.x.value, place.y.value, size.value.width, size.value.height)[way] : 0;
  });
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(strength.value, [0.12, 0.6], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: strength.value >= 1 ? 1.12 : interpolate(strength.value, [0, 1], [0.86, 1], Extrapolation.CLAMP) }],
    backgroundColor: strength.value >= 1 ? rarityColor[rarity] : colors.deep,
  }));
  const ink = useAnimatedStyle(() => ({ opacity: strength.value >= 1 ? 0 : 1 }));
  const armedInk = useAnimatedStyle(() => ({ opacity: strength.value >= 1 ? 1 : 0 }));

  return (
    <Animated.View style={[styles.stamp, styles[way], { borderColor: rarityColor[rarity] }, style]}>
      <Animated.View style={[styles.row, ink]}>
        <Shape rarity={rarity} size={18} />
        <Words kind="label" style={{ color: rarityColor[rarity] }} maxFontSizeMultiplier={1}>
          {rarityName[rarity]}
        </Words>
      </Animated.View>
      <Animated.View style={[styles.row, styles.over, armedInk]}>
        <Shape rarity={rarity} size={18} color={colors.onLabel} />
        <Words kind="label" style={{ color: colors.onLabel }} maxFontSizeMultiplier={1}>
          {rarityName[rarity]}
        </Words>
      </Animated.View>
    </Animated.View>
  );
});

type PileProps = {
  rarity: Rarity;
  way: 'left' | 'up' | 'right';
  places: Place[];
  top: SharedValue<number>;
  size: SharedValue<{ width: number; height: number }>;
  onPress: (rarity: Rarity) => void;
  disabled: boolean;
};

/** A button for each pile. Also shows which one the card is heading for. */
const Pile = memo(function Pile({ rarity, way, places, top, size, onPress, disabled }: PileProps) {
  const style = useAnimatedStyle(() => {
    const place = places[top.value];
    const strength = place ? pull(place.x.value, place.y.value, size.value.width, size.value.height)[way] : 0;
    return {
      borderColor: strength >= 1 ? rarityColor[rarity] : colors.line,
      transform: [{ scale: interpolate(strength, [0, 1], [1, 1.07], Extrapolation.CLAMP) }],
    };
  });
  return (
    <Animated.View style={[styles.pile, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={rarityName[rarity]}
        accessibilityHint={`Puts this card in the ${rarity} pile`}
        android_ripple={{ color: '#FFFFFF22' }}
        disabled={disabled}
        onPress={() => onPress(rarity)}
        style={styles.pileButton}
      >
        <View style={styles.row}>
          {way === 'left' && <Icon name="left" size={16} color={colors.soft} />}
          <Shape rarity={rarity} size={20} />
          {way !== 'left' && <Icon name={way} size={16} color={colors.soft} />}
        </View>
        <Words kind="label" maxFontSizeMultiplier={1.15}>
          {rarityName[rarity]}
        </Words>
      </Pressable>
    </Animated.View>
  );
});

const Pips = memo(function Pips({ cards, answers }: { cards: Card[]; answers: Rarity[] }) {
  return (
    <View
      style={styles.pips}
      accessible
      accessibilityLabel={`${answers.length} of ${cards.length} sorted, ${answers.filter((answer, i) => answer === cards[i]!.rarity).length} right`}
    >
      {cards.map((card, i) => {
        const answer = answers[i];
        const right = answer === card.rarity;
        return (
          <View key={card.id} style={[styles.pip, i === answers.length && styles.pipNow]}>
            {answer !== undefined && <Icon name={right ? 'check' : 'cross'} size={16} weight={3.4} color={right ? colors.green : colors.red} />}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  deck: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 18 },
  card: { position: 'absolute' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  over: { position: 'absolute' },
  stamp: { position: 'absolute', borderWidth: 2.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
  left: { top: 18, right: 14 },
  right: { top: 18, left: 14 },
  up: { bottom: 26, alignSelf: 'center' },
  mark: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 88,
    height: 88,
    marginLeft: -44,
    marginTop: -44,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verdict: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s, paddingHorizontal: space.l },
  pips: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingTop: space.xs, paddingBottom: space.s },
  pip: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.deep, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.deep },
  pipNow: { borderColor: colors.ink },
  piles: { flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.m },
  pile: { flex: 1, borderRadius: 10, borderWidth: 2, backgroundColor: colors.raised, overflow: 'hidden' },
  pileButton: { minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 6 },
});
