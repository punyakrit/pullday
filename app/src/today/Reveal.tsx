import { Image } from 'expo-image';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Reveal as RevealData } from '../core/state';
import { SEALED, step, wordsFor } from '../core/turn';
import { haptics } from '../lib/haptics';
import { imageUrl } from '../lib/images';
import { usePicture } from '../lib/pictures';
import { useCardRef } from '../lib/useCardRef';
import { Button } from '../ui/Button';
import { CardText, describeCard } from '../ui/CardImage';
import { Icon, Shape } from '../ui/Icons';
import { Words } from '../ui/Words';
import { hairline } from '../ui/hairline';
import { CARD_RATIO, rarityBright, rarityName, space, stage as dark } from '../ui/theme';
import { Rays, Sheen, Sparks } from './Effects';
import { cardWidth, isShort } from './fit';
import { liftSpeed } from './swipe';

type Props = {
  reveal: RevealData;
  today: boolean;
  onShown: () => void;
  onClose: () => void;
};

const FLIP_MS = 620;
/** Long enough to have seen it. Until then, leaving means it plays again. */
const SEEN_MS = 900;

const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });

/**
 * Pull the card up out of its sleeve, and it turns over. The card is already saved before this
 * shows. Marked as seen only once it has been face up for a moment with the app in front.
 */
export function Reveal({ reveal, today, onShown, onClose }: Props) {
  const reduced = useReducedMotion();
  const [turned, send] = useReducer(step, SEALED);
  const { stage } = turned;
  // Once it starts to turn over, whatever the server says next, this is the card on the screen.
  const { card, saved } = turned.drawn ?? reveal;
  const shown = useRef(false);

  // The window may change in the middle of it. The words above and below count as they are while sealed.
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [words, setWords] = useState({ above: 0, below: 0 });
  const short = isShort(area);
  const column = short ? { width: Math.round(area.width * 0.56) } : null;
  const width = cardWidth(area, words);
  const height = Math.floor(width * CARD_RATIO);
  const measure = (which: 'above' | 'below') => (event: LayoutChangeEvent) => {
    const { height: now } = event.nativeEvent.layout;
    if (!short) setWords((before) => (before[which] === now || (stage !== 'sealed' && before[which] > 0) ? before : { ...before, [which]: now }));
  };
  const picture = useCardRef(card?.id ?? null, width, saved);
  const why = usePicture(card?.id ?? '', card ? imageUrl(card.id, 400) : '').state === 'none' ? 'none' : 'failed';
  // 45 of the pictures are shorter than a slab.
  const faceHeight = picture.state === 'ready' ? Math.min(height, Math.round((width * picture.image.height) / picture.image.width)) : height;

  const lift = useSharedValue(0); // how far the finger has pulled the card out
  const sleeve = useSharedValue(0); // 0 around the card, 1 gone
  const flip = useSharedValue(0); // 0 back, 1 face
  const glow = useSharedValue(0);
  const turn = useSharedValue(0);
  const sweep = useSharedValue(0);
  const burst = useSharedValue(0);
  const tilt = useSharedValue(0);
  const hint = useSharedValue(0);
  const sealed = useSharedValue(true);
  const touch = useSharedValue({ x: 0, y: 0, at: 0 });

  // A small nudge up now and then, only until it is touched.
  useEffect(() => {
    if (reduced || stage !== 'sealed') return;
    hint.value = withRepeat(
      withSequence(withDelay(900, withTiming(1, { duration: 420 })), withTiming(0, { duration: 520, easing: Easing.out(Easing.bounce) })),
      5, // then it waits quietly
    );
    return () => {
      hint.value = withTiming(0, { duration: 120 });
    };
  }, [hint, reduced, stage]);

  const reset = useCallback(() => {
    for (const value of [lift, sleeve, flip, glow, turn, sweep, burst, tilt]) value.value = 0;
    sealed.value = true;
    send({ kind: 'reset' });
  }, [burst, flip, glow, lift, sealed, sleeve, sweep, tilt, turn]);

  // A call, the home button, another app: if it was not seen yet, it starts over.
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !shown.current) reset();
    });
    return () => listener.remove();
  }, [reset]);

  const openSleeve = useCallback(() => {
    send({ kind: 'pull' });
    haptics.pull();
  }, []);

  const letGo = useCallback(() => {
    'worklet';
    if (!sealed.value) return;
    sealed.value = false;
    sleeve.value = withTiming(1, { duration: 380, easing: Easing.in(Easing.quad) });
    lift.value = withSpring(0, { duration: 420, dampingRatio: 0.85 });
    scheduleOnRN(openSleeve);
  }, [lift, openSleeve, sealed, sleeve]);

  const pan = usePanGesture({
    maxPointers: 1,
    minDistance: 2,
    shouldCancelWhenOutside: false,
    onBegin: (event) => {
      'worklet';
      touch.value = { x: event.absoluteX, y: event.absoluteY, at: performance.now() };
    },
    onUpdate: (event) => {
      'worklet';
      if (sealed.value) {
        // Follows the finger up. Going down there is nowhere to go.
        lift.value = Math.max(touch.value.y - event.absoluteY, -14);
      } else {
        tilt.value = Math.max(-1, Math.min(1, (event.absoluteX - touch.value.x) / (width * 0.6)));
      }
    },
    onDeactivate: (event) => {
      'worklet';
      const up = touch.value.y - event.absoluteY;
      const speed = liftSpeed(event.velocityY, -up, performance.now() - touch.value.at);
      if (!sealed.value) {
        tilt.value = withSpring(0, { duration: 500, dampingRatio: 0.6 });
      } else if (!event.canceled && (up > height * 0.25 || (speed < -500 && up > 12))) {
        letGo();
      } else {
        lift.value = withSpring(0, { duration: 320, dampingRatio: 0.9 });
      }
    },
  });

  // Turn it over only once the picture is decoded, so nothing pops in afterwards.
  const ready = stage === 'pulled' && picture.state !== 'loading';
  useEffect(() => {
    if (ready && reveal.card) send({ kind: 'ready', reveal: { ...reveal, card: reveal.card } });
  }, [ready, reveal]);

  // Once for each turn. Nothing it depends on changes while the card is turning.
  useEffect(() => {
    if (turned.stage !== 'turning') return;
    const { card } = turned.drawn;
    const { rarity } = card;
    const special = rarity !== 'common';
    if (reduced) {
      flip.value = withTiming(1, { duration: 260, reduceMotion: ReduceMotion.Never });
      glow.value = special ? 0.6 : 0;
    } else {
      flip.value = withDelay(160, withTiming(1, { duration: FLIP_MS, easing: Easing.inOut(Easing.cubic) }));
      const landed = 160 + FLIP_MS * 0.62;
      sweep.value = withDelay(landed, withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
      if (special) {
        glow.value = withDelay(landed - 120, withTiming(1, { duration: 480, easing: Easing.out(Easing.quad) }));
        turn.value = withDelay(landed, withTiming(1, { duration: 9_000, easing: Easing.out(Easing.quad) }));
        burst.value = withDelay(landed - 60, withTiming(1, { duration: 1_000, easing: Easing.out(Easing.cubic) }));
      }
      if (rarity === 'holo') {
        tilt.value = withDelay(landed, withSequence(withTiming(0.9, { duration: 700 }), withTiming(-0.7, { duration: 900 }), withTiming(0, { duration: 700 })));
      }
    }
    const face = setTimeout(
      () => {
        if (special) haptics.special();
        else haptics.common();
        send({ kind: 'face' });
        AccessibilityInfo.announceForAccessibility(`Your card. ${describeCard(card)}. ${rarityName[card.rarity]}.`);
      },
      reduced ? 120 : 160 + FLIP_MS * 0.6,
    );
    return () => clearTimeout(face);
  }, [burst, flip, glow, reduced, sweep, tilt, turn, turned]);

  useEffect(() => {
    if (stage !== 'open') return;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active' || shown.current) return;
      shown.current = true;
      onShown();
    }, SEEN_MS);
    return () => clearInterval(timer);
  }, [onShown, stage]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { translateY: -lift.value - hint.value * 12 * (1 - sleeve.value) },
      { rotateY: `${tilt.value * 14}deg` },
    ],
  }));
  const backStyle = useAnimatedStyle(() => ({
    opacity: flip.value < 0.5 ? 1 : 0,
    transform: [{ perspective: 900 }, { rotateY: reduced ? '0deg' : `${interpolate(flip.value, [0, 1], [0, 180])}deg` }],
  }));
  const faceStyle = useAnimatedStyle(() => ({
    opacity: flip.value < 0.5 ? 0 : 1,
    transform: [
      { perspective: 900 },
      { rotateY: reduced ? '0deg' : `${interpolate(flip.value, [0, 1], [-180, 0])}deg` },
      { scale: interpolate(flip.value, [0.5, 0.8, 1], [1, 1.05, 1], Extrapolation.CLAMP) },
    ],
  }));
  // The card is pulled up over the title, so the title makes way.
  const titleStyle = useAnimatedStyle(() => ({ opacity: interpolate(lift.value, [4, 44], [1, 0], Extrapolation.CLAMP) }));
  const sleeveStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sleeve.value, [0, 0.8, 1], [1, 1, 0]),
    transform: [{ translateY: sleeve.value * height * 0.7 }],
  }));

  if (card === null) {
    return (
      <View style={[styles.screen, styles.middle]}>
        <Shape rarity="holo" size={72} bright />
        <Words kind="title" style={styles.centre}>
          You own every card
        </Words>
        <Words kind="soft" style={styles.quiet}>
          There is nothing left to pull. Today still counts for your streak.
        </Words>
        <Button
          title="Done"
          kind="light"
          onPress={() => {
            onShown();
            onClose();
          }}
        />
      </View>
    );
  }

  const says =
    stage === 'open'
      ? wordsFor(card, reveal)
      : {
          title: today ? "Today's card" : `${dayName(reveal.day)}'s card`,
          line: reveal.score !== null && today ? `You sorted ${reveal.score} of 8 right` : ' ',
        };

  return (
    <View style={styles.screen} onLayout={({ nativeEvent: { layout } }) => setArea({ width: layout.width, height: layout.height })}>
      <Animated.View style={[styles.top, short && styles.topBeside, column, !short && titleStyle]} onLayout={measure('above')}>
        <Words kind={short ? 'label' : 'title'} style={styles.centre} numberOfLines={short ? 1 : undefined} accessibilityRole="header">
          {says.title}
        </Words>
        <Words kind="soft" style={styles.quiet}>
          {says.line}
        </Words>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <View style={[styles.stage, column && { marginRight: column.width }]} collapsable={false}>
          {card.rarity !== 'common' && <Rays rarity={card.rarity} size={Math.round(width * 2.1)} glow={glow} turn={turn} />}
          {card.rarity !== 'common' && !reduced && <Sparks rarity={card.rarity} radius={width * 0.95} burst={burst} />}
          <Animated.View style={[{ width, height }, cardStyle]}>
            <Animated.View style={[StyleSheet.absoluteFill, backStyle]}>
              <Back width={width} height={height} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, faceStyle]}>
              <View style={{ marginTop: (height - faceHeight) / 2, width, height: faceHeight }}>
                {picture.state === 'ready' ? (
                  <Image source={picture.image} contentFit="cover" style={{ width, height: faceHeight, borderRadius: width * 0.05 }} accessible={false} />
                ) : (
                  <CardText card={card} width={width} height={height} why={why} />
                )}
                <Sheen rarity={card.rarity} width={width} height={faceHeight} sweep={sweep} tilt={tilt} />
              </View>
            </Animated.View>
          </Animated.View>

          {stage !== 'open' && (
            <View pointerEvents="none" style={{ position: 'absolute', width: width + 18, height }}>
              <Animated.View style={[styles.sleeve, { top: height * 0.4, height: height * 0.63 }, sleeveStyle]}>
                <Words kind="title" style={styles.onSleeve} maxFontSizeMultiplier={1}>
                  Pullday
                </Words>
                <Words kind="label" style={styles.onSleeve} maxFontSizeMultiplier={1}>
                  {dayName(reveal.day)}
                </Words>
                <View style={styles.sleeveShapes}>
                  <Shape rarity="common" size={18} color="#9A9A9A" />
                  <Shape rarity="holo" size={18} color="#9A9A9A" />
                  <Shape rarity="rare" size={18} color="#9A9A9A" />
                </View>
              </Animated.View>
            </View>
          )}
          {stage === 'pulled' && !ready && <ActivityIndicator color={dark.ink} style={styles.spinner} />}
        </View>
      </GestureDetector>

      <View style={[styles.bottom, short && styles.bottomBeside, column]} onLayout={measure('below')}>
        {stage === 'open' ? (
          <>
            <View style={styles.name}>
              <Shape rarity={card.rarity} size={22} bright />
              <Words kind="heading" numberOfLines={short ? 1 : 2} style={{ flexShrink: 1, color: dark.ink }}>
                {card.name}
              </Words>
            </View>
            <Words kind="soft" style={styles.quiet} numberOfLines={2}>
              <Words kind="soft" style={{ color: rarityBright[card.rarity] }}>
                {rarityName[card.rarity]}
              </Words>
              , {card.set}, {card.year}
            </Words>
            <Button title="Done" kind="light" onPress={onClose} />
          </>
        ) : (
          <>
            <View style={styles.name}>
              <Icon name="up" size={20} color={dark.soft} />
              <Words kind="label" style={{ color: dark.soft }}>
                Pull the card up
              </Words>
            </View>
            <Button title="Pull it for me" kind="dark" onPress={letGo} disabled={stage !== 'sealed'} />
          </>
        )}
      </View>
    </View>
  );
}

/** The same for every card, so it gives nothing away. */
function Back({ width, height }: { width: number; height: number }) {
  return (
    <View style={[styles.back, { width, height, borderRadius: width * 0.05 }]}>
      <View style={[styles.backInner, { borderRadius: width * 0.035 }]}>
        <Shape rarity="common" size={width * 0.16} color={dark.line} />
        <Shape rarity="holo" size={width * 0.34} color={dark.line} />
        <Shape rarity="rare" size={width * 0.16} color={dark.line} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  middle: { alignItems: 'center', justifyContent: 'center', gap: space.l, paddingHorizontal: space.xl },
  centre: { textAlign: 'center', color: dark.ink },
  quiet: { textAlign: 'center', color: dark.soft },
  onSleeve: { color: '#1A1A1A' },
  top: { paddingTop: space.m, paddingHorizontal: space.l, gap: 2, zIndex: 1 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // A short window: the card on the left, everything that is written on the right.
  topBeside: { position: 'absolute', right: 0, top: 0, paddingHorizontal: space.m, paddingTop: space.s },
  bottomBeside: { position: 'absolute', right: 0, bottom: 0, paddingHorizontal: space.m, paddingBottom: space.s, minHeight: 0 },
  sleeve: { position: 'absolute', left: 0, right: 0, backgroundColor: '#FFFFFF', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sleeveShapes: { flexDirection: 'row', gap: 8, marginTop: space.m },
  spinner: { position: 'absolute' },
  bottom: { zIndex: 1, paddingHorizontal: space.xl, paddingBottom: space.l, gap: space.s, minHeight: 150, justifyContent: 'flex-end' },
  name: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s },
  back: { backgroundColor: '#1E1E1E', borderWidth: hairline, borderColor: dark.line, padding: 10 },
  backInner: { flex: 1, borderWidth: 2, borderColor: dark.line, backgroundColor: dark.panel, alignItems: 'center', justifyContent: 'center', gap: 10 },
});
