import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type ColorValue, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useApp } from '@/state/app';
import { fontFamily } from '@/ui/theme';

function AddButton() {
  const { colors, t } = useApp();
  const router = useRouter();
  return (
    <View style={styles.addSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tabs.add')}
        onPress={() => router.push('/transaction/new')}
        style={({ pressed }) => [styles.add, { backgroundColor: colors.primary }, pressed && { opacity: 0.8 }]}>
        <Ionicons name="add" size={30} color={colors.onPrimary} />
      </Pressable>
    </View>
  );
}

const SIDE_RAIL_FROM = 960;

export default function TabsLayout() {
  const { colors, t, settings } = useApp();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  if (!settings.onboarded) return <Redirect href="/onboarding" />;

  const icon = (name: keyof typeof Ionicons.glyphMap) =>
    function TabIcon({ color, size }: { color: ColorValue; size: number }) {
      return <Ionicons name={name} size={size} color={color as string} />;
    };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        // Arabic labels need more height than the default bar leaves them.
        tabBarPosition: width >= SIDE_RAIL_FROM ? 'left' : 'bottom',
        // The default active background on a side rail matches the active text, hiding it.
        tabBarActiveBackgroundColor: width >= SIDE_RAIL_FROM ? colors.primarySoft : undefined,
        tabBarStyle: width >= SIDE_RAIL_FROM
          ? { backgroundColor: colors.surface, borderColor: colors.border, width: 190, minWidth: 190 }
          : { backgroundColor: colors.surface, borderTopColor: colors.border, height: 66 + insets.bottom, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: 11, lineHeight: 16 },
      }}>
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="accounts" options={{ title: t('tabs.accounts'), tabBarIcon: icon('wallet-outline') }} />
      <Tabs.Screen name="add" options={{ title: t('tabs.add'), tabBarButton: () => <AddButton /> }} />
      <Tabs.Screen name="debts" options={{ title: t('tabs.debts'), tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="reports" options={{ title: t('tabs.reports'), tabBarIcon: icon('bar-chart-outline') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  add: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
