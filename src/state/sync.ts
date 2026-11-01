import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { createBackup, serializeBackup } from '../data/backup';
import { collectBudgetAlerts } from '../data/budgets';
import { getObligations } from '../data/finance';
import { postDueOccurrences } from '../data/recurring';
import { today } from '../domain/dates';
import { saveAutoBackup } from '../platform/autoBackup';
import { notifyNow, syncReminders } from '../platform/notifications';
import { useFeedback } from '../ui/components/feedback';
import { useApp } from './app';

const DEBOUNCE_MS = 1500;
const REMINDER_HORIZON_DAYS = 45;

/**
 * The app's housekeeping: records automatic payments that have come due, keeps a daily safety copy,
 * and keeps budget warnings and reminders in step with the books. Runs after writes settle and when
 * the app returns to the foreground, never on a timer, so it costs no battery while idle.
 * Budget warnings always appear in the app; notifications are the opt-in part.
 */
export function useBackgroundSync(): void {
  const { db, settings, t, updateSetting } = useApp();
  const { toast } = useFeedback();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const run = async () => {
      const posted = await postDueOccurrences(db);
      for (const { rule } of posted) {
        toast({
          message: t('recurring.autoPosted', { name: rule.name }),
        });
      }
      await keepDailyCopy();

      const alerts = await collectBudgetAlerts(db);
      for (const alert of alerts) {
        const message = t('reminder.budgetBody', { name: alert.budget.name, percent: alert.threshold });
        toast({ message });
        if (settings.remindersEnabled) await notifyNow(t('reminder.budgetTitle'), message);
      }
      if (!settings.remindersEnabled) return;
      await syncReminders(await getObligations(db, REMINDER_HORIZON_DAYS), {
        title: t('reminder.title'),
        body: (item) => t('reminder.body', { name: item.label }),
        daily: settings.dailyNudge ? { title: t('reminder.dailyTitle'), body: t('reminder.dailyBody') } : undefined,
      });
    };

    const keepDailyCopy = async () => {
      const date = today();
      if (settings.lastAutoBackupOn === date) return;
      await saveAutoBackup(date, serializeBackup(await createBackup(db)));
      await updateSetting('lastAutoBackupOn', date);
    };
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run().catch(() => undefined), DEBOUNCE_MS);
    };

    schedule();
    const unsubscribe = db.onChange(schedule);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') schedule();
    });
    return () => {
      unsubscribe();
      appState.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [db, settings.remindersEnabled, settings.dailyNudge, settings.lastAutoBackupOn, t, toast, updateSetting]);
}
