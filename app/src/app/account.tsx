import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Engine } from '../core/engine';
import type { Outcome } from '../core/store';
import type { User } from '../core/types';
import { API_URL } from '../lib/config';
import { api, explain, isTestAccount, logOut, useSession } from '../lib/session';
import { store } from '../lib/store';
import { useEngine, useServerNow } from '../lib/useEngine';
import { Button } from '../ui/Button';
import { Words } from '../ui/Words';
import { colors, space } from '../ui/theme';

export default function Account() {
  const session = useSession();
  if (session.status !== 'in') return null;
  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Words kind="heading">{session.user.email}</Words>
        <LogOut engine={session.engine} />
        {isTestAccount(session.user) && <DevMenu engine={session.engine} user={session.user} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function LogOut({ engine }: { engine: Engine }) {
  const { unsent } = useEngine(engine);
  const [busy, setBusy] = useState(false);

  async function leave() {
    setBusy(true);
    await logOut();
  }
  function ask() {
    if (unsent === 0) return void leave();
    Alert.alert(
      'A challenge is not sent yet',
      'It stays on this phone and is sent when you log in to this account here again.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Log out', style: 'destructive', onPress: () => void leave() },
      ],
    );
  }
  return <Button kind="quiet" title="Log out" busy={busy} onPress={ask} />;
}

/** For the six test accounts, in every build. The server refuses it for anyone else. */
function DevMenu({ engine, user }: { engine: Engine; user: User }) {
  const snapshot = useEngine(engine);
  const now = useServerNow(engine, 1_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ group: string; text: string } | null>(null); // under the button that said it
  const [offline, setOffline] = useState(api.pretendOffline);

  async function run(group: string, title: string, work: () => Promise<string>) {
    if (busy) return;
    setBusy(title);
    setSaid(null);
    try {
      setSaid({ group, text: await work() });
    } catch (err) {
      setSaid({ group, text: explain(err) });
    } finally {
      setBusy(null);
    }
  }

  const move = (title: string, minutes: () => number) => ({
    title,
    work: async () => {
      const sentAt = Date.now();
      const reply = (await engine.dev('/dev/move-time', { minutes: Math.max(1, Math.round(minutes())) })) as { now: string };
      engine.clock.sync(reply.now, sentAt, Date.now());
      engine.refreshView();
      await engine.sync();
      return `It is now ${new Date(reply.now).toLocaleString()} on the server.`;
    },
  });
  const grant = (title: string, count: number) => ({
    title,
    work: async () => {
      const { granted } = (await engine.dev('/dev/grant-card', { count })) as { granted: string[] };
      await engine.sync();
      return `${granted.length} card${granted.length === 1 ? '' : 's'} added.`;
    },
  });
  /** Begins a real test payment, then Stripe's own test card does the rest, without the sheet. */
  const pay = (title: string, then: (paymentId: string) => Promise<string>) => ({
    title,
    work: async () => {
      await engine.beginPayment();
      const id = engine.getSnapshot().saved.payment?.id;
      if (!id) return 'There is nothing to pay for.';
      try {
        return await then(id);
      } catch (err) {
        void engine.sheetClosed(false);
        throw err;
      }
    },
  });
  /** The whole purchase, with the store told how to answer, so without its sheet. */
  const buy = (title: string, outcome: Outcome, said: string) => ({
    title,
    work: async () => {
      const answer = await engine.buyFreeze(outcome);
      return answer === 'refunded' ? 'One too many: the money goes back.' : said;
    },
  });
  const decide = (title: string, approved: boolean) => ({
    title,
    work: async () => {
      const count = store.decide(user.id, approved);
      return count === 0 ? 'Nothing is pending.' : `${count} ${approved ? 'approved' : 'declined'}.`;
    },
  });
  const dayEnd = () => (snapshot.today ? Date.parse(snapshot.today.endsAt) : now);

  const groups = [
    {
      name: 'Move time forward',
      actions: [
        move('To 11:58pm', () => (dayEnd() - engine.clock.now()) / 60_000 - 2),
        move('To just after midnight', () => (dayEnd() - engine.clock.now()) / 60_000 + 1),
        move('1 hour', () => 60),
        move('1 day', () => 24 * 60),
        move('2 days', () => 48 * 60),
      ],
    },
    {
      name: 'Win back, with a payment',
      actions: [
        pay('Paid, connection lost', async (paymentId) => {
          api.pretendOffline = true; // from here the phone hears nothing
          setOffline(true);
          await engine.dev('/dev/pay', { paymentId, card: 'visa' });
          await engine.sheetClosed(false);
          return 'Paid, and the phone did not hear it. It checks until the connection is back: turn the switch off.';
        }),
        pay('Killed while paying', async (paymentId) => {
          await engine.dev('/dev/pay', { paymentId, card: 'visa', afterMs: 3_000 });
          setTimeout(() => {
            throw new Error('Killed on purpose from the dev menu');
          }, 800);
          return 'The app dies now. Open it again: the payment goes through in the meantime.';
        }),
        pay('Declined', async (paymentId) => {
          await engine.dev('/dev/pay', { paymentId, card: 'declined' });
          await engine.sheetClosed(false);
          return 'The card was declined.';
        }),
      ],
    },
    {
      name: 'Buy a freeze',
      actions: [
        buy('Goes through', 'purchased', 'Bought.'),
        buy('Pending', 'pending', 'It waits for approval.'),
        decide('Approve pending', true),
        decide('Decline pending', false),
        buy('Fails', 'failed', 'It failed. The shop says so.'),
        buy('Cancelled', 'canceled', 'It was cancelled. The shop says so.'),
        {
          title: 'Killed while buying',
          work: async () => {
            const run = engine.buyFreeze('purchased');
            // Once the store is at it, which is after the server has heard that it began.
            const working = () => engine.getSnapshot().saved.purchases.some((one) => one.state === 'processing');
            const stop = engine.subscribe(() => {
              if (!working()) return;
              stop();
              setTimeout(() => {
                throw new Error('Killed on purpose from the dev menu');
              }, 500);
            });
            await run.finally(stop);
            return 'The app dies now. Open it again: the store has charged in the meantime.';
          },
        },
      ],
    },
    { name: 'Grant cards', actions: [grant('1 card', 1), grant('25 cards', 25), grant('Every card', 2000)] },
    {
      name: 'Start over',
      actions: [
        {
          title: 'Reset this account',
          work: async () => {
            await engine.dev('/dev/reset', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
            engine.forget();
            await engine.sync();
            return `${user.email} is back to its starting state.`;
          },
        },
      ],
    },
  ];

  return (
    <View style={styles.dev}>
      <Words kind="heading" accessibilityRole="header">
        Dev menu
      </Words>
      <Words kind="soft">
        Server time {new Date(now).toLocaleString()}. {API_URL.replace(/^https?:\/\//, '')}
      </Words>
      <View style={styles.row}>
        <Words style={styles.shrink}>Pretend there is no connection</Words>
        <Switch
          accessibilityLabel="Pretend there is no connection"
          value={offline}
          trackColor={{ true: colors.rare, false: colors.line }}
          thumbColor={colors.ink}
          onValueChange={(on) => {
            api.pretendOffline = on;
            setOffline(on);
            void engine.sync();
          }}
        />
      </View>
      {groups.map((group) => (
        <View key={group.name} style={styles.group}>
          <Words kind="label">{group.name}</Words>
          <View style={styles.actions}>
            {group.actions.map(({ title, work }) => (
              <View key={title} style={styles.action}>
                <Button kind="quiet" title={title} busy={busy === title} disabled={busy !== null && busy !== title} onPress={() => void run(group.name, title, work)} />
              </View>
            ))}
          </View>
          {said?.group === group.name && (
            <Words style={styles.said} accessibilityLiveRegion="polite">
              {said.text}
            </Words>
          )}
        </View>
      ))}
      <Button title="Back to Today" onPress={() => router.dismissTo('/')} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.mat },
  content: { padding: space.xl, gap: space.l },
  dev: { gap: space.m, marginTop: space.m, paddingTop: space.l, borderTopWidth: 1, borderTopColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m, minHeight: 48 },
  shrink: { flexShrink: 1 },
  said: { color: colors.rare },
  group: { gap: space.s },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  action: { flexGrow: 1, flexBasis: '46%' },
});
