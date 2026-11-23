import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Engine, Snapshot } from '../core/engine';
import { dateText, money } from '../core/prices';
import { type Payment, isFor, isOver, mayCover } from '../core/state';
import { type DayStatus, type StreakDay, statusName, streakDays } from '../core/streakDays';
import type { Today, WinBack } from '../core/types';
import { useSession } from '../lib/session';
import { useEngine, useServerNow } from '../lib/useEngine';
import { payForWinBack } from '../lib/winBack';
import { countdown } from '../today/Done';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icons';
import { LiveFlame } from '../ui/LiveFlame';
import { Panel } from '../ui/Panel';
import { Opening, Pop, Rise } from '../ui/Rise';
import { Roll } from '../ui/Roll';
import { Words } from '../ui/Words';
import { colors, space } from '../ui/theme';

export default function StreakScreen() {
  const session = useSession();
  return session.status === 'in' ? <Streak engine={session.engine} /> : null;
}

function Streak({ engine }: { engine: Engine }) {
  const snapshot = useEngine(engine);
  const insets = useSafeAreaInsets();
  const { today, saved, streakOld, payment, offer } = snapshot;
  const days = useMemo(() => (today ? streakDays(today, saved) : []), [saved, today]);
  return (
    <Opening>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
        contentInsetAdjustmentBehavior="automatic"
        indicatorStyle="black"
      >
        {today === null ? (
          <View style={styles.empty}>
            <Words kind="heading" style={styles.centre}>
              {snapshot.connection === 'offline' ? 'Connect to see your streak' : 'Getting your streak'}
            </Words>
            {snapshot.connection === 'offline' || snapshot.connection === 'trouble' ? (
              <Button kind="quiet" title="Try again" onPress={() => void engine.sync()} />
            ) : (
              <ActivityIndicator color={colors.soft} />
            )}
          </View>
        ) : (
          <>
            <View style={styles.count} accessible accessibilityLabel={`${today.streak} day streak. ${streakOld ? 'Last known, it may be old.' : ''}`}>
              <LiveFlame size={44} streak={today.streak} old={streakOld} />
              <Roll text={String(today.streak)} size={84} />
              <Words kind="heading">{today.streak === 1 ? 'day' : 'days'}</Words>
            </View>
            {streakOld && <Old engine={engine} snapshot={snapshot} today={today} />}
            {snapshot.saved.notices.map((notice) => (
              <Panel key={notice.id}>
                <Words>{notice.text}</Words>
                <Button kind="quiet" title="OK" onPress={() => engine.dismissNotice(notice.id)} />
              </Panel>
            ))}
            {payment && (
              <Rise at={1}>
                <PaymentPanel engine={engine} payment={payment} offer={offer} />
              </Rise>
            )}
            {offer && (
              <Rise at={1}>
                <Offer
                  engine={engine}
                  offer={offer}
                  waiting={saved.purchases.some((one) => mayCover(one, offer))}
                  ready={today.paymentsReady}
                  again={isFor(payment, offer)}
                />
              </Rise>
            )}
            <Rise at={2}>
              <Days days={days} />
            </Rise>
            <Rise at={3}>
              <Panel>
                <View style={styles.row}>
                  <Icon name="freeze" size={22} color={colors.frozen} />
                  <Words kind="label" style={styles.grow}>
                    Freezes
                  </Words>
                  <Words kind="heading">{today.freezes} of 2</Words>
                </View>
                <Words kind="soft">A freeze is used by itself on a day you miss, and your streak stays.</Words>
                {saved.purchases.some((one) => one.id !== snapshot.buying && !isOver(one)) && <Words kind="soft">One you bought is not here yet. See the shop.</Words>}
                <Button kind="quiet" title="Shop" onPress={() => router.push('/shop')} />
              </Panel>
            </Rise>
          </>
        )}
      </ScrollView>
    </Opening>
  );
}

function Old({ engine, snapshot, today }: { engine: Engine; snapshot: Snapshot; today: Today }) {
  const from = new Date(today.now).toLocaleString(undefined, { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  return (
    <View style={styles.old}>
      <Words kind="soft" style={styles.centre}>
        The last we knew, from {from}. It may be old.
        {snapshot.unsent > 0 ? ' A challenge on this phone is not sent yet.' : ''}
      </Words>
      <Button kind="quiet" title="Try again" busy={snapshot.syncing} onPress={() => void engine.sync()} />
    </View>
  );
}

function usePay(engine: Engine) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pay = async () => {
    setBusy(true);
    setProblem(null);
    setProblem(await payForWinBack(engine));
    setBusy(false);
  };
  return { busy, problem, pay: () => void pay() };
}

function Offer({ engine, offer, waiting, ready, again }: { engine: Engine; offer: WinBack; waiting: boolean; ready: boolean; again: boolean }) {
  const now = useServerNow(engine, 1_000);
  const { busy, problem, pay } = usePay(engine);
  const left = Date.parse(offer.closesAt) - now;
  if (left <= 0) return null;
  return (
    <Panel>
      <Words kind="heading">
        Your {offer.lostStreak} day streak broke on {dateText(offer.missedDay)}
      </Words>
      {waiting && <Words>A freeze you began to buy before that is not here yet. If it is approved, it covers that day, and that costs nothing more.</Words>}
      {ready ? (
        <>
          <Words>Win it back and go on from {offer.lostStreak}.</Words>
          <Words kind="soft" style={styles.tabular} accessibilityLabel={`${countdown(left)} left`}>
            {countdown(left)} left. Test mode, no real money.
          </Words>
          <Button title={`${again ? 'Try again for' : 'Win it back for'} ${money(offer.priceCents)}`} busy={busy} onPress={pay} />
        </>
      ) : (
        <Words>Payments are not set up on this server, so it can&apos;t be won back here.</Words>
      )}
      {problem && (
        <Words style={styles.problem} accessibilityLiveRegion="polite">
          {problem}
        </Words>
      )}
    </Panel>
  );
}

/** What Stripe has said about a payment that was begun. Nothing here is guessed. */
function PaymentPanel({ engine, payment, offer }: { engine: Engine; payment: Payment; offer: WinBack | null }) {
  const { busy, problem, pay } = usePay(engine);
  if (payment.state === 'checking' || payment.state === 'processing') {
    return (
      <Panel>
        <View style={styles.row} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.ink} />
          <Words kind="heading" style={styles.grow}>
            Checking your payment
          </Words>
        </View>
        <Words kind="soft">This can take a moment. You can leave, it goes on by itself, and you can never pay twice.</Words>
      </Panel>
    );
  }
  if (payment.state === 'bank') {
    return (
      <Panel>
        <Words kind="heading">Your bank has not approved it yet</Words>
        <Words>No money was taken so far.</Words>
        <Button title="Go on with the payment" busy={busy} onPress={pay} />
        <Button kind="quiet" title="Not now" onPress={() => engine.dismissPayment()} />
        {problem && <Words style={styles.problem}>{problem}</Words>}
      </Panel>
    );
  }
  const declined = payment.state === 'declined';
  const current = isFor(payment, offer); // then the offer is the way on
  return (
    <Panel>
      <Words kind="heading">{declined ? 'The payment failed' : payment.state === 'canceled' ? 'This payment was closed' : 'Not paid'}</Words>
      {declined && payment.problem && <Words>{payment.problem}</Words>}
      <Words>No money was taken.</Words>
      {offer && !current && <Words kind="soft">It was for the streak that broke on {dateText(payment.missedDay)}.</Words>}
      {!current && <Button kind="quiet" title="OK" onPress={() => engine.dismissPayment()} />}
    </Panel>
  );
}

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const LOOK: Record<DayStatus, { icon: 'check' | 'cross' | 'freeze' | 'back' | null; color: string; fill: string; ring: string }> = {
  done: { icon: 'check', color: colors.onInk, fill: colors.ink, ring: colors.ink },
  unsent: { icon: 'check', color: colors.ink, fill: 'transparent', ring: colors.ink },
  frozen: { icon: 'freeze', color: colors.frozen, fill: colors.frozenFill, ring: colors.frozenFill },
  won_back: { icon: 'back', color: colors.ink, fill: '#FBD9B5', ring: '#FBD9B5' },
  missed: { icon: 'cross', color: colors.red, fill: 'transparent', ring: colors.red },
  today: { icon: null, color: colors.ink, fill: 'transparent', ring: colors.ink },
  late: { icon: null, color: colors.ink, fill: 'transparent', ring: colors.soft },
  before: { icon: null, color: '#8A8A8A', fill: 'transparent', ring: 'transparent' },
};
const LEGEND: [DayStatus, string][] = [
  ['done', 'Done'],
  ['unsent', 'Not sent yet'],
  ['frozen', 'Freeze'],
  ['missed', 'Missed'],
  ['won_back', 'Won back'],
];

function Days({ days }: { days: StreakDay[] }) {
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const used = new Set(days.map((one) => one.status));
  return (
    <Panel>
      <Words kind="label" accessibilityRole="header">
        Recent days
      </Words>
      <View style={styles.week} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {LETTERS.map((letter, i) => (
          <Words key={i} kind="soft" style={styles.cell} maxFontSizeMultiplier={1.1}>
            {letter}
          </Words>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={week[0]!.day} style={styles.week}>
          {Array.from({ length: 7 }, (_, i) => (week[i] ? <Day key={i} one={week[i]} after={180 + (w * 7 + i) * 18} /> : <View key={i} style={styles.cell} />))}
        </View>
      ))}
      <View style={styles.legend}>
        {LEGEND.filter(([status]) => used.has(status)).map(([status, text]) => (
          <View key={status} style={styles.key}>
            <Mark status={status} size={18} />
            <Words kind="soft" style={styles.small}>
              {text}
            </Words>
          </View>
        ))}
      </View>
    </Panel>
  );
}

function Day({ one, after }: { one: StreakDay; after: number }) {
  return (
    <View style={styles.cell} accessible={one.status !== 'before'} accessibilityLabel={`${dateText(one.day)}, ${statusName[one.status]}`}>
      {one.status === 'before' ? (
        <Mark status={one.status} size={30} day={one.day} />
      ) : (
        <Pop after={after}>
          <Mark status={one.status} size={30} day={one.day} />
        </Pop>
      )}
    </View>
  );
}

/** A shape in every one, never colour alone. */
function Mark({ status, size, day }: { status: DayStatus; size: number; day?: string }) {
  const { icon, color, fill, ring } = LOOK[status];
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size / 2, backgroundColor: fill, borderColor: ring }, status === 'unsent' && styles.dashed]}>
      {icon ? (
        <Icon name={icon} size={size * 0.6} color={color} weight={3} />
      ) : day ? (
        <Words kind="soft" style={[styles.small, { color }]} maxFontSizeMultiplier={1}>
          {Number(day.slice(8))}
        </Words>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: space.l, paddingTop: space.s, gap: space.m },
  empty: { minHeight: 300, justifyContent: 'center', gap: space.l },
  centre: { textAlign: 'center' },
  count: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.m, paddingVertical: space.s },
  old: { gap: space.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  grow: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  problem: { color: colors.red },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', textAlign: 'center', paddingVertical: 3 },
  mark: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  dashed: { borderStyle: 'dashed' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.l, rowGap: space.s, marginTop: space.s },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  small: { fontSize: 13, lineHeight: 17 },
});
