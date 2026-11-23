import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useIsFocused } from 'expo-router';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bannerFor } from '../core/banner';
import type { Engine, Snapshot } from '../core/engine';
import { GRACE_MS, type PaymentState, type View as DayView } from '../core/state';
import type { Rarity } from '../core/types';
import { setStage } from '../lib/stage';
import { useDayTimer, useEngine, useServerNow } from '../lib/useEngine';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icons';
import { LiveFlame } from '../ui/LiveFlame';
import { panel } from '../ui/Panel';
import { Words } from '../ui/Words';
import { hairline } from '../ui/hairline';
import { colors, space, stage } from '../ui/theme';
import { Deck } from './Deck';
import { Done, countdown } from './Done';
import { Reveal } from './Reveal';

/** iOS draws its tab bar over the screen. Android ends the screen above it. */
const EDGES = Platform.select<('top' | 'bottom')[]>({ ios: ['top', 'bottom'], default: ['top'] });

/** The last card needs a moment to leave the mat before the reveal takes over. */
function useLastCard(view: DayView, reduced: boolean): DayView {
  const [shown, setShown] = useState(view);
  const previous = useRef(view);
  useEffect(() => {
    const before = previous.current;
    previous.current = view;
    const finishing = before.kind === 'challenge' && view.kind === 'reveal' && before.challenge.id === view.reveal.challengeId;
    if (!finishing) {
      setShown(view);
      return;
    }
    const timer = setTimeout(() => setShown(previous.current), reduced ? 350 : 650);
    return () => clearTimeout(timer);
  }, [view, reduced]);
  // While the last card leaves, keep showing the deck. Otherwise always the newest.
  const leaving = shown.kind === 'challenge' && view.kind === 'reveal' && shown.challenge.id === view.reveal.challengeId;
  return leaving ? shown : view;
}

export function Today({ engine }: { engine: Engine }) {
  const snapshot = useEngine(engine);
  const reduced = useReducedMotion();
  useDayTimer(engine, snapshot);
  const view = useLastCard(snapshot.view, reduced);

  // A reveal that was waiting stays on screen until it is closed.
  const revealId = view.kind === 'reveal' ? view.reveal.challengeId : null;
  useEffect(() => {
    if (revealId) engine.showReveal(revealId);
  }, [engine, revealId]);

  // The reveal is on a dark stage. The light goes down and comes up again around it.
  const dark = view.kind === 'reveal';
  const focused = useIsFocused();
  useEffect(() => {
    setStage(dark && focused);
    return () => setStage(false);
  }, [dark, focused]);
  const dim = useSharedValue(dark ? 1 : 0);
  useEffect(() => {
    dim.value = withTiming(dark ? 1 : 0, { duration: 360, reduceMotion: ReduceMotion.Never });
  }, [dark, dim]);
  const dimmed = useAnimatedStyle(() => ({ opacity: dim.value }));

  return (
    <View style={styles.screen}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dark, dimmed]} />
      <SafeAreaView edges={EDGES} style={styles.fill}>
        <Header engine={engine} snapshot={snapshot} dark={dark} />
        <Line engine={engine} snapshot={snapshot} view={view} />
        {view.kind === 'challenge' && <Challenge key={view.challenge.id} engine={engine} view={view} />}
        {view.kind === 'reveal' && <RevealOf key={view.reveal.challengeId} engine={engine} snapshot={snapshot} view={view} />}
        {view.kind === 'done' && <Done engine={engine} snapshot={snapshot} view={view} />}
        {view.kind === 'empty' && <Empty engine={engine} snapshot={snapshot} />}
      </SafeAreaView>
    </View>
  );
}

function Challenge({ engine, view }: { engine: Engine; view: Extract<DayView, { kind: 'challenge' }> }) {
  const { challenge } = view;
  const begin = useCallback(() => engine.begin(challenge), [challenge, engine]);
  const answer = useCallback((index: number, rarity: Rarity) => engine.answer(challenge, index, rarity), [challenge, engine]);
  return <Deck challenge={challenge} answers={view.answers} onBegin={begin} onAnswer={answer} />;
}

function RevealOf({ engine, snapshot, view }: { engine: Engine; snapshot: Snapshot; view: Extract<DayView, { kind: 'reveal' }> }) {
  const { reveal } = view;
  const shown = useCallback(() => engine.revealShown(reveal.challengeId), [engine, reveal.challengeId]);
  const close = useCallback(() => engine.closeReveal(), [engine]);
  // The card can change until the server has answered. Reveal keeps the one it turns over.
  return <Reveal reveal={reveal} today={reveal.day === snapshot.today?.day} onShown={shown} onClose={close} />;
}

function Header({ engine, snapshot, dark }: { engine: Engine; snapshot: Snapshot; dark: boolean }) {
  const { ink, soft } = dark ? stage : colors;
  const { streak, streakOld } = snapshot;
  return (
    <View style={styles.header}>
      <Pressable
        style={({ pressed }) => [styles.streak, pressed && { opacity: 0.6 }]}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={streak === null ? 'Streak, not known yet' : `Streak, ${streak} days.${streakOld ? ' Last known, it may be old.' : ''}`}
        onPress={() => router.push('/streak')}
      >
        <LiveFlame size={22} streak={streak} old={streakOld} />
        <Words kind="heading" style={{ color: ink }}>
          {streak ?? '–'}
        </Words>
        {streak !== null && streakOld && (
          <Words kind="soft" numberOfLines={1} maxFontSizeMultiplier={1.1} style={[styles.small, { color: soft }]}>
            last known
          </Words>
        )}
      </Pressable>
      <View style={[styles.tag, dark && { borderColor: stage.line }]}>
        <Words kind="soft" maxFontSizeMultiplier={1.1} style={[styles.tagText, { color: soft }]}>
          Test app
        </Words>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Account, ${engine.user.email}`}
        hitSlop={12}
        onPress={() => router.push('/account')}
        style={({ pressed }) => [styles.account, pressed && { opacity: 0.6 }]}
      >
        <Icon name="person" size={24} weight={2} color={ink} />
      </Pressable>
    </View>
  );
}

const PAYMENT: Record<PaymentState, string> = {
  checking: 'Checking your payment',
  processing: 'Checking your payment',
  bank: 'Your bank has not approved your payment yet',
  declined: 'Your payment failed. No money was taken.',
  canceled: 'Your payment was closed. No money was taken.',
  unpaid: '',
};

function Line({ engine, snapshot, view }: { engine: Engine; snapshot: Snapshot; view: DayView }) {
  const now = useServerNow(engine, 1_000);
  const banner = bannerFor({ ...snapshot, view });
  switch (banner?.kind) {
    case 'full':
      return (
        <View style={[styles.banner, styles.notice]} accessibilityLiveRegion="polite">
          <Words style={styles.noticeText}>This phone can't save right now. It may be out of space. Free some and come back, or what you do now could be lost.</Words>
        </View>
      );
    case 'notice':
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${banner.text} Tap to dismiss.`}
          onPress={() => engine.dismissNotice(banner.id)}
          style={[styles.banner, styles.notice]}
        >
          <Words style={styles.noticeText}>{banner.text}</Words>
          <Icon name="cross" size={18} color={colors.soft} />
        </Pressable>
      );
    case 'payment':
    case 'winBack': {
      const text = banner.kind === 'winBack' ? `Your ${banner.lostStreak} day streak broke. Win it back` : PAYMENT[banner.state];
      return (
        <Pressable accessibilityRole="button" accessibilityLabel={text} onPress={() => router.push('/streak')} style={[styles.banner, styles.notice]}>
          {banner.kind === 'payment' && banner.state === 'checking' && <ActivityIndicator color={colors.ink} />}
          <Words style={[styles.noticeText, styles.grow]}>{text}</Words>
          <Icon name="right" size={18} color={colors.soft} />
        </Pressable>
      );
    }
    case 'late':
      return (
        <View style={styles.banner}>
          <Words kind="soft" style={styles.bannerText}>
            Finish the day you started. It still counts for another {countdown(Math.min(banner.until - now, GRACE_MS))}.
          </Words>
        </View>
      );
    case 'waiting':
      return (
        <Pressable accessibilityRole="button" onPress={() => engine.showReveal(banner.challengeId)} style={[styles.banner, styles.notice]}>
          <Words style={styles.noticeText}>You have a card waiting. See it now</Words>
          <Icon name="right" size={18} color={colors.soft} />
        </Pressable>
      );
    case 'offline':
      return (
        <View style={styles.banner}>
          <Icon name="offline" size={18} color={colors.soft} />
          <Words kind="soft" style={styles.bannerText}>
            {banner.unsent ? 'Offline. Your challenge is saved and will be sent.' : 'Offline. You can still play.'}
          </Words>
        </View>
      );
    case 'trouble':
      return (
        <View style={styles.banner}>
          <Words kind="soft" style={styles.bannerText}>
            Pullday is having trouble. {banner.unsent ? 'Your challenge is saved and will be sent.' : "We'll keep trying."}
          </Words>
        </View>
      );
    default:
      return null;
  }
}

/** Nothing on the phone covers today: the first open, or three days with no connection. */
function Empty({ engine, snapshot }: { engine: Engine; snapshot: Snapshot }) {
  const failed = snapshot.connection === 'offline' || snapshot.connection === 'trouble';
  if (!failed || snapshot.syncing) {
    return (
      <View style={styles.middle} accessibilityLabel="Getting today's challenge">
        <ActivityIndicator color={colors.soft} size="large" />
      </View>
    );
  }
  return (
    <View style={styles.middle}>
      <Words kind="heading" style={styles.centre}>
        {snapshot.connection === 'offline' ? "Connect to get today's challenge" : "Today's challenge isn't loading"}
      </Words>
      <Words kind="soft" style={styles.centre}>
        {snapshot.connection === 'offline' ? 'After that you can play today and tomorrow without a connection.' : 'Pullday is having trouble. Try again in a moment.'}
      </Words>
      <View style={styles.wide}>
        <Button title="Try again" onPress={() => void engine.sync()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  fill: { flex: 1 },
  dark: { backgroundColor: stage.page },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.l, height: 48 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 64 },
  tag: { borderRadius: 9, borderWidth: hairline, borderColor: '#C9C9C9', paddingHorizontal: 10, paddingVertical: 3 },
  small: { fontSize: 13, lineHeight: 18 },
  tagText: { fontSize: 13, lineHeight: 18 },
  account: { minWidth: 64, alignItems: 'flex-end' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    marginHorizontal: space.l,
    marginBottom: space.s,
    paddingHorizontal: space.m,
    paddingVertical: 10,
    borderRadius: 14,
  },
  bannerText: { flexShrink: 1 },
  notice: { ...panel, borderRadius: 14, paddingVertical: 13, justifyContent: 'space-between' },
  grow: { flex: 1 },
  noticeText: { flexShrink: 1, fontSize: 15, lineHeight: 20 },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m, paddingHorizontal: space.xl },
  centre: { textAlign: 'center' },
  wide: { alignSelf: 'stretch', marginTop: space.m },
});
