import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Engine, Snapshot } from '../core/engine';
import { GRACE_MS, type View as DayView } from '../core/state';
import type { Rarity } from '../core/types';
import { useDayTimer, useEngine, useServerNow } from '../lib/useEngine';
import { Button } from '../ui/Button';
import { Flame, Icon } from '../ui/Icons';
import { Words } from '../ui/Words';
import { colors, space } from '../ui/theme';
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

  return (
    <SafeAreaView edges={EDGES} style={styles.screen}>
      <Header engine={engine} snapshot={snapshot} />
      <Banner engine={engine} snapshot={snapshot} view={view} />
      {view.kind === 'challenge' && <Challenge key={view.challenge.id} engine={engine} view={view} />}
      {view.kind === 'reveal' && <RevealOf key={view.reveal.challengeId} engine={engine} snapshot={snapshot} view={view} />}
      {view.kind === 'done' && <Done engine={engine} snapshot={snapshot} view={view} />}
      {view.kind === 'empty' && <Empty engine={engine} snapshot={snapshot} />}
    </SafeAreaView>
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

function Header({ engine, snapshot }: { engine: Engine; snapshot: Snapshot }) {
  const { streakKnown, today } = snapshot;
  return (
    <View style={styles.header}>
      <View
        style={styles.streak}
        accessible
        accessibilityLabel={streakKnown ? `Streak, ${today?.streak ?? 0} days` : 'Streak not known until you are online'}
      >
        <Flame size={22} color={streakKnown ? colors.rare : colors.line} />
        <Words kind="heading" style={styles.tabular}>
          {streakKnown ? today?.streak : ' '}
        </Words>
      </View>
      <View style={styles.tag}>
        <Words kind="soft" maxFontSizeMultiplier={1.1} style={styles.tagText}>
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
        <Icon name="person" size={24} weight={2} />
      </Pressable>
    </View>
  );
}

/** One line at a time, the most useful first. */
function Banner({ engine, snapshot, view }: { engine: Engine; snapshot: Snapshot; view: DayView }) {
  const now = useServerNow(engine, 1_000);
  const notice = snapshot.saved.notices[0];
  if (notice) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${notice.text} Tap to dismiss.`}
        onPress={() => engine.dismissNotice(notice.id)}
        style={[styles.banner, styles.notice]}
      >
        <Words style={styles.noticeText}>{notice.text}</Words>
        <Icon name="cross" size={18} color={colors.onLabel} />
      </Pressable>
    );
  }
  if (snapshot.unsaved) {
    return (
      <View style={[styles.banner, styles.notice]} accessibilityLiveRegion="polite">
        <Words style={styles.noticeText}>
          This phone can't save right now. It may be out of space. Free some and come back, or what you do now could be lost.
        </Words>
      </View>
    );
  }
  if (view.kind === 'challenge' && view.lateUntil) {
    return (
      <View style={styles.banner}>
        <Words kind="soft" style={styles.bannerText}>
          Finish the day you started. It still counts for another {countdown(Math.min(view.lateUntil - now, GRACE_MS))}.
        </Words>
      </View>
    );
  }
  if (view.kind === 'challenge' && view.waiting) {
    const { challengeId } = view.waiting;
    return (
      <Pressable accessibilityRole="button" onPress={() => engine.showReveal(challengeId)} style={[styles.banner, styles.notice]}>
        <Words style={styles.noticeText}>You have a card waiting. See it now</Words>
        <Icon name="right" size={18} color={colors.onLabel} />
      </Pressable>
    );
  }
  if (snapshot.connection === 'offline') {
    return (
      <View style={styles.banner}>
        <Icon name="offline" size={18} color={colors.soft} />
        <Words kind="soft" style={styles.bannerText}>
          {snapshot.unsent > 0 ? 'Offline. Your challenge is saved and will be sent.' : 'Offline. You can still play.'}
        </Words>
      </View>
    );
  }
  if (snapshot.connection === 'trouble') {
    return (
      <View style={styles.banner}>
        <Words kind="soft" style={styles.bannerText}>
          Pullday is having trouble. {snapshot.unsent > 0 ? 'Your challenge is saved and will be sent.' : "We'll keep trying."}
        </Words>
      </View>
    );
  }
  return null;
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
        {snapshot.connection === 'offline'
          ? 'After that you can play today and tomorrow without a connection.'
          : 'Pullday is having trouble. Try again in a moment.'}
      </Words>
      <View style={styles.wide}>
        <Button title="Try again" onPress={() => void engine.sync()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.mat },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.l, height: 48 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 64 },
  tabular: { fontVariant: ['tabular-nums'] },
  tag: { borderRadius: 6, backgroundColor: colors.deep, paddingHorizontal: 10, paddingVertical: 3 },
  tagText: { fontSize: 13, lineHeight: 18 },
  account: { minWidth: 64, alignItems: 'flex-end' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginHorizontal: space.l, marginBottom: space.s, paddingHorizontal: space.m, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.deep },
  bannerText: { flexShrink: 1 },
  notice: { backgroundColor: colors.label, justifyContent: 'space-between' },
  noticeText: { color: colors.onLabel, flexShrink: 1, fontSize: 15, lineHeight: 20 },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m, paddingHorizontal: space.xl },
  centre: { textAlign: 'center' },
  wide: { alignSelf: 'stretch', marginTop: space.m },
});
