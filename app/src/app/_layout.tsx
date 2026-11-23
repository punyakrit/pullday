import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { restore, useSession } from '../lib/session';
import { colors } from '../ui/theme';

void SplashScreen.preventAutoHideAsync();
void restore();

export default function Layout() {
  const session = useSession();
  const ready = session.status !== 'loading';
  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);
  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.mat }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.mat } }}>
          <Stack.Protected guard={session.status === 'in'}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="card/[id]"
              options={{
                headerShown: true,
                title: '',
                headerShadowVisible: false,
                headerBackButtonDisplayMode: 'minimal',
                headerStyle: { backgroundColor: colors.mat },
                headerTintColor: colors.ink,
              }}
            />
            <Stack.Screen
              name="streak"
              options={{
                headerShown: true,
                title: 'Streak',
                headerShadowVisible: false,
                headerBackButtonDisplayMode: 'minimal',
                headerStyle: { backgroundColor: colors.mat },
                headerTintColor: colors.ink,
              }}
            />
            <Stack.Screen
              name="shop"
              options={{
                headerShown: true,
                title: 'Shop',
                headerShadowVisible: false,
                headerBackButtonDisplayMode: 'minimal',
                headerStyle: { backgroundColor: colors.mat },
                headerTintColor: colors.ink,
              }}
            />
            <Stack.Screen
              name="account"
              options={{
                presentation: 'modal',
                headerShown: true,
                title: 'Account',
                headerStyle: { backgroundColor: colors.deep },
                headerTintColor: colors.ink,
              }}
            />
          </Stack.Protected>
          <Stack.Protected guard={session.status === 'out'}>
            <Stack.Screen name="login" options={{ animation: 'fade' }} />
          </Stack.Protected>
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
