import { type ComponentRef, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TEST_ACCOUNTS } from '../lib/config';
import { explain, logIn, signUp, useSession } from '../lib/session';
import { Button } from '../ui/Button';
import { Shape } from '../ui/Icons';
import { Words } from '../ui/Words';
import { hairline } from '../ui/hairline';
import { colors, space } from '../ui/theme';

export default function Login() {
  const session = useSession();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState(session.status === 'out' ? session.email : '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(session.status === 'out' ? session.message : null);
  const passwordField = useRef<ComponentRef<typeof TextInput>>(null);
  const making = mode === 'signup';

  async function submit() {
    if (busy) return;
    const address = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) return setProblem('Type your email address.');
    if (password.length < 8) return setProblem(making ? 'Use a password of at least 8 characters.' : 'Type your password.');
    setBusy(true);
    setProblem(null);
    try {
      await (making ? signUp(address, password) : logIn(address, password));
    } catch (err) {
      setProblem(explain(err));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.fill}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.mark}>
            <Shape rarity="common" size={26} />
            <Shape rarity="holo" size={40} />
            <Shape rarity="rare" size={26} />
          </View>
          <Words kind="title" style={styles.brand} accessibilityRole="header">
            Pullday
          </Words>
          <Words kind="soft">A card a day. This is a test app.</Words>

          <View style={styles.form}>
            <Words kind="label">Email</Words>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordField.current?.focus()}
              submitBehavior="submit"
              editable={!busy}
              accessibilityLabel="Email"
              selectionColor={colors.ink}
              style={styles.field}
            />
            <Words kind="label">Password</Words>
            <TextInput
              ref={passwordField}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={making ? 'new-password' : 'current-password'}
              textContentType={making ? 'newPassword' : 'password'}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              editable={!busy}
              accessibilityLabel="Password"
              selectionColor={colors.ink}
              style={styles.field}
            />
            {problem && (
              <Words style={styles.problem} accessibilityLiveRegion="polite" accessibilityRole="alert">
                {problem}
              </Words>
            )}
            <Button title={making ? 'Sign up' : 'Log in'} busy={busy} onPress={() => void submit()} />
            <Button
              kind="quiet"
              title={making ? 'I have an account' : 'Make an account'}
              disabled={busy}
              onPress={() => {
                setMode(making ? 'login' : 'signup');
                setProblem(null);
              }}
            />
          </View>

          {!making && (
            <View style={styles.tests}>
              <Words kind="soft">Test accounts fill in with a tap</Words>
              <View style={styles.chips}>
                {TEST_ACCOUNTS.map((account) => (
                  <Pressable
                    key={account}
                    accessibilityRole="button"
                    accessibilityLabel={`Fill in ${account}`}
                    disabled={busy}
                    onPress={() => {
                      setEmail(account);
                      setPassword('pullday123');
                      setProblem(null);
                    }}
                    style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
                  >
                    <Words kind="label">{account.split('@')[0]}</Words>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  fill: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.xs },
  mark: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginBottom: space.m },
  brand: { fontSize: 54, lineHeight: 60, letterSpacing: -1.6 },
  form: { gap: space.s, marginTop: space.xl },
  field: { minHeight: 52, borderRadius: 14, paddingHorizontal: 16, fontSize: 17, color: colors.ink, backgroundColor: colors.panel, borderWidth: hairline, borderColor: '#BDBDBD', marginBottom: space.s },
  problem: { color: colors.red, marginBottom: space.s },
  tests: { marginTop: space.xl, gap: space.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.panel, borderWidth: hairline, borderColor: colors.line },
});
