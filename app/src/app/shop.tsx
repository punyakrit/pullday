import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Refused, Unreachable } from '../core/api';
import type { Bought, Engine, Snapshot } from '../core/engine';
import { type Purchase, isOver } from '../core/state';
import { PRODUCT } from '../core/store';
import { haptics } from '../lib/haptics';
import { useSession } from '../lib/session';
import { useEngine } from '../lib/useEngine';
import { StoreSheet } from '../shop/StoreSheet';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icons';
import { Panel } from '../ui/Panel';
import { Opening, Rise } from '../ui/Rise';
import { Roll } from '../ui/Roll';
import { Words } from '../ui/Words';
import { colors, space } from '../ui/theme';

const MOST = 2;

export default function ShopScreen() {
  const session = useSession();
  return session.status === 'in' ? <Shop engine={session.engine} /> : null;
}

function Shop({ engine }: { engine: Engine }) {
  const snapshot = useEngine(engine);
  const insets = useSafeAreaInsets();
  const { today, saved, buying, connection } = snapshot;
  const cut = connection === 'offline' || connection === 'trouble';
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
              {cut ? 'Connect to see the shop' : 'Opening the shop'}
            </Words>
            {cut ? <Button kind="quiet" title="Try again" onPress={() => void engine.sync()} /> : <ActivityIndicator color={colors.soft} />}
          </View>
        ) : (
          <>
            <Rise>
              <Owned count={today.freezes} old={snapshot.streakOld} />
            </Rise>
            {saved.notices.map((notice) => (
              <Panel key={notice.id}>
                <Words>{notice.text}</Words>
                <Button kind="quiet" title="OK" onPress={() => engine.dismissNotice(notice.id)} />
              </Panel>
            ))}
            {saved.purchases.map((purchase) => (purchase.id === buying ? null : <PurchasePanel key={purchase.id} engine={engine} purchase={purchase} cut={cut} />))}
            <Rise at={1}>
              <Freeze engine={engine} snapshot={snapshot} full={today.freezes >= MOST} />
            </Rise>
          </>
        )}
        <StoreSheet />
      </ScrollView>
    </Opening>
  );
}

/** Two places, filled or not. */
function Owned({ count, old }: { count: number; old: boolean }) {
  return (
    <View style={styles.owned} accessible accessibilityLabel={`You have ${count} of ${MOST} freezes.${old ? ' Last known, it may be old.' : ''}`}>
      <View style={styles.places}>
        {Array.from({ length: MOST }, (_, i) => (
          <View key={`${i}-${i < count}`} style={[styles.place, i < count ? styles.filled : styles.free]}>
            {i < count && <Icon name="freeze" size={40} color={colors.frozen} />}
          </View>
        ))}
      </View>
      <Words kind="heading" style={styles.full}>
        You have {count} of {MOST}
      </Words>
      {old && <Words kind="soft">The last we knew. It may be old.</Words>}
    </View>
  );
}

const WORDS: Record<Purchase['state'], { title: string; text: string }> = {
  buying: { title: 'Checking your purchase', text: '' },
  processing: { title: 'Checking your purchase', text: 'The store is still working on it. You can leave, it goes on by itself.' },
  pending: {
    title: 'Waiting for approval',
    text: 'Nothing to do here. Once it is approved it counts from when you began to buy, so a day you miss until then is still covered.',
  },
  paid: { title: 'Paid. Adding your freeze', text: 'It counts from when you began to buy. You cannot be charged for it again.' },
  declined: { title: 'Not approved', text: 'No money was taken.' },
  failed: { title: 'The purchase failed', text: 'No money was taken. You can try again.' },
  canceled: { title: 'Cancelled', text: 'No money was taken.' },
  unpaid: { title: 'Not bought', text: 'The app was closed before you paid. No money was taken.' },
};

function PurchasePanel({ engine, purchase, cut }: { engine: Engine; purchase: Purchase; cut: boolean }) {
  const { title, text } = WORDS[purchase.state];
  const over = isOver(purchase);
  const working = purchase.state === 'processing' || purchase.state === 'paid';
  return (
    <Panel>
      <View style={styles.row} accessibilityLiveRegion="polite">
        {working && <ActivityIndicator color={colors.ink} />}
        {purchase.state === 'pending' && <Icon name="clock" size={22} color={colors.flame} />}
        <Words kind="heading" style={styles.grow}>
          {title}
        </Words>
      </View>
      <Words kind={over ? 'body' : 'soft'}>{purchase.state === 'paid' && cut ? `Waiting for a connection. ${text}` : text}</Words>
      {over && <Button kind="quiet" title="OK" onPress={() => engine.dismissPurchase(purchase.id)} />}
    </Panel>
  );
}

function Freeze({ engine, snapshot, full }: { engine: Engine; snapshot: Snapshot; full: boolean }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [bought, setBought] = useState<Bought | null>(null);
  const buy = async () => {
    setProblem(null);
    setBought(null);
    try {
      const answer = await engine.buyFreeze();
      setBought(answer);
      if (answer === 'granted') haptics.right();
    } catch (err) {
      setProblem(why(engine, err));
    }
  };
  const said = problem ?? (bought === 'granted' ? 'Bought. Your freeze is ready.' : null);
  return (
    <Panel>
      <View style={styles.row}>
        <Words kind="heading" style={styles.grow}>
          {PRODUCT.name}
        </Words>
        <Roll text={PRODUCT.price} size={27} />
      </View>
      <Words>Miss a day, and a freeze is used by itself. Your streak stays. The missed day adds nothing to it.</Words>
      <Words kind="soft">It covers days that end after you buy it. You can hold {MOST}. Test store, no real money.</Words>
      {full ? (
        <View style={styles.row}>
          <Icon name="check" size={22} color={colors.green} />
          <Words kind="label" style={styles.grow}>
            You have {MOST}, the most you can hold. When one is used you can buy another.
          </Words>
        </View>
      ) : (
        <Button title={`Buy for ${PRODUCT.price}`} busy={snapshot.buying !== null} onPress={() => void buy()} />
      )}
      {said && (
        <Words style={{ color: problem ? colors.red : colors.green }} accessibilityLiveRegion="polite">
          {said}
        </Words>
      )}
    </Panel>
  );
}

function why(engine: Engine, err: unknown): string {
  if (err instanceof Refused) return `${err.message} Nothing was charged.`;
  if (engine.waitsFor() === 'finish') return 'Finish the challenge you started first. Nothing was charged.';
  if (err instanceof Unreachable)
    return err.kind === 'server' ? 'Pullday is having trouble. Nothing was charged. Try again in a moment.' : 'Connect to buy a freeze. Nothing was charged.';
  return "This phone can't save right now, so nothing was bought. It may be out of space.";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: space.l, paddingTop: space.s, gap: space.m },
  empty: { minHeight: 300, justifyContent: 'center', gap: space.l },
  centre: { textAlign: 'center' },
  full: { alignSelf: 'stretch', textAlign: 'center' },
  owned: { alignItems: 'center', gap: space.s, paddingVertical: space.m },
  places: { flexDirection: 'row', gap: space.m },
  place: { width: 76, height: 96, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  filled: { backgroundColor: colors.frozenFill, borderColor: colors.frozenFill, borderStyle: 'solid' },
  free: { borderColor: '#C9C9C9', borderStyle: 'dashed' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  grow: { flex: 1 },
});
