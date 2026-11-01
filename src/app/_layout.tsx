import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadSettings, type AppSettings } from '@/data/settings';
import type { DbWithEvents } from '@/data/sql';
import { requestDurableStorage } from '@/platform/autoBackup';
import { openDatabase } from '@/platform/database';
import { configureNotificationDisplay } from '@/platform/notifications';
import { AppProvider, useApp } from '@/state/app';
import { useBackgroundSync } from '@/state/sync';
import { FeedbackProvider } from '@/ui/components/feedback';
import { LockGate } from '@/ui/components/lock';
import { fontFamily, space } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync();
configureNotificationDisplay();

/** Lives inside FeedbackProvider so that budget warnings can reach the screen. */
function BackgroundSync() {
  useBackgroundSync();
  return null;
}

function Navigator() {
  const { colors, isDark, t } = useApp();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  const navigationTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, primary: colors.primary },
    };
  }, [isDark, colors]);

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <FeedbackProvider>
        <BackgroundSync />
        <LockGate>
          <Stack
            screenOptions={{
              headerTitleStyle: { fontFamily: fontFamily.semibold, fontSize: 17 },
              headerShadowVisible: false,
              headerBackTitle: t('common.back'),
              contentStyle: { backgroundColor: colors.background },
            }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="transaction/new" options={{ presentation: 'modal' }} />
          </Stack>
        </LockGate>
      </FeedbackProvider>
    </ThemeProvider>
  );
}

type Boot = { db: DbWithEvents; settings: AppSettings };

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });
  const [boot, setBoot] = useState<Boot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void requestDurableStorage().catch(() => undefined);
    openDatabase()
      .then(async (db) => setBoot({ db, settings: await loadSettings(db) }))
      .catch(() => setFailed(true));
  }, []);

  const ready = (fontsLoaded || fontError) && boot;

  useEffect(() => {
    if (ready || failed) void SplashScreen.hideAsync();
  }, [ready, failed]);

  if (failed) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: '#F6F7F5' }}>
        <BootFailure />
      </View>
    );
  }
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <AppProvider db={boot.db} initialSettings={boot.settings}>
        <Navigator />
      </AppProvider>
    </SafeAreaProvider>
  );
}

/** Rendered outside AppProvider, so it must not depend on settings or translations being loaded. */
function BootFailure() {
  return (
    <>
      <Text style={{ textAlign: 'center', fontSize: 16, marginBottom: space.md }}>تعذّر فتح قاعدة البيانات. لم تُحذف أي بيانات. أغلق التطبيق وأعد فتحه.</Text>
      <Text style={{ textAlign: 'center', fontSize: 16 }}>Could not open the database. No data was deleted. Close and reopen the app.</Text>
    </>
  );
}
