import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { today } from '../domain/dates';
import { planReminders, type Obligation } from '../domain/planning';

export const remindersSupported = Platform.OS !== 'web';

const CHANNEL = 'reminders';
/** iOS keeps at most 64 pending; staying well under leaves room for budget warnings. */
const MAX_SCHEDULED = 50;
const REMIND_AT_HOUR = 9;

export async function requestReminderPermission(): Promise<boolean> {
  if (!remindersSupported) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Reminders', importance: AndroidImportance.DEFAULT });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export function configureNotificationDisplay(): void {
  if (!remindersSupported) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export type ReminderText = {
  title: string;
  body: (obligation: Obligation) => string;
  /** A gentle evening prompt, so a busy day's expenses do not go unrecorded. */
  daily?: { title: string; body: string };
};

const DAILY_HOUR = 21;
const DAILY_MINUTE = 0;

/**
 * Local reminders only, rebuilt from the current obligations each time. Amounts are left out on
 * purpose, since notifications show on the lock screen.
 */
export async function syncReminders(obligations: Obligation[], text: ReminderText): Promise<void> {
  if (!remindersSupported) return;
  await Notifications.cancelAllScheduledNotificationsAsync();

  for (const { obligation, on } of planReminders(obligations, today(), MAX_SCHEDULED)) {
    const [year, month, day] = on.split('-').map(Number);
    const when = new Date(year, month - 1, day, REMIND_AT_HOUR);
    if (when.getTime() <= Date.now()) continue;
    await Notifications.scheduleNotificationAsync({
      content: { title: text.title, body: text.body(obligation) },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: CHANNEL },
    });
  }

  if (text.daily) {
    await Notifications.scheduleNotificationAsync({
      content: text.daily,
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: DAILY_HOUR, minute: DAILY_MINUTE, channelId: CHANNEL },
    });
  }
}

export async function notifyNow(title: string, body: string): Promise<void> {
  if (!remindersSupported) return;
  await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
}
