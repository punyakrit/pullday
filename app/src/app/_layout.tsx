import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { restore, useSession } from '../lib/session';
import { NavigationBar } from 'expo-navigation-bar';
import { useStage } from '../lib/stage';
import { colors, serif } from '../ui/theme';

void SplashScreen.preventAutoHideAsync();
void restore();

const TITLE = { fontFamily: serif, fontSize: 24 } as const;

export default function Layout() {
  const session = useSession();
  const dark = useStage();
  const ready = session.status !== 'loading';
  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);
  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.page }}>
      <SafeAreaProvider>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <NavigationBar style={dark ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page }, ...(Platform.OS === 'ios' && { statusBarStyle: dark ? 'light' : 'dark' }) }}>
          <Stack.Protected guard={session.status === 'in'}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="card/[id]"
              options={{
                animation: 'fade', // the card itself grows into place
                animationDuration: 180, // iOS. Any longer and the growing is over before it shows
                headerShown: true,
                title: '',
                headerShadowVisible: false,
                headerBackButtonDisplayMode: 'minimal',
                headerStyle: { backgroundColor: colors.page },
                headerTintColor: colors.ink,
                headerTitleStyle: TITLE,
              }}
            />
            <Stack.Screen
              name="streak"
              options={{
                headerShown: true,
                title: 'Streak',
                headerShadowVisible: false,
                headerBackButtonDisplayMode: 'minimal',
                headerStyle: { backgroundColor: colors.page },
                headerTintColor: colors.ink,
                headerTitleStyle: TITLE,
              }}
            />
            <Stack.Screen
              name="shop"
              options={{
                headerShown: true,
                title: 'Shop',
                headerShadowVisible: false,
                headerBackButtonDisplayMode: 'minimal',
                headerStyle: { backgroundColor: colors.page },
                headerTintColor: colors.ink,
                headerTitleStyle: TITLE,
              }}
            />
            <Stack.Screen
              name="account"
              options={{
                presentation: 'modal',
                headerShown: true,
                title: 'Account',
                headerStyle: { backgroundColor: colors.page },
                headerTintColor: colors.ink,
                headerTitleStyle: TITLE,
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
