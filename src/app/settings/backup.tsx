import * as Crypto from 'expo-crypto';
import { useState } from 'react';

import { createBackup, parseBackup, restoreBackup, serializeBackup, summarizeBackup, type BackupFile } from '@/data/backup';
import { decryptBackup, encryptBackup, isEncryptedBackup } from '@/data/backupCrypto';
import { exportAccountsCsv, exportDebtsCsv, exportTransactionsCsv } from '@/data/exports';
import { formatDate, nowIso, today } from '@/domain/dates';
import { listAutoBackups, readAutoBackup } from '@/platform/autoBackup';
import { pickTextFile, shareTextFile, writeSafetyCopy } from '@/platform/files';
import { useApp, useQuery } from '@/state/app';
import { Button, Card, ListRow, Screen, Section, Stacked, T } from '@/ui/components/core';
import { useErrorMessage, useFeedback } from '@/ui/components/feedback';
import { useCategoryName } from '@/ui/components/finance';
import { Field, FieldError } from '@/ui/components/forms';

const backupName = (extension: string) => `masroufi-${today()}.${extension}`;

export default function Backup() {
  const { t, db, settings, updateSetting, reloadSettings } = useApp();
  const { confirm, ask, toast } = useFeedback();
  const errorMessage = useErrorMessage();
  const nameOf = useCategoryName();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: copies } = useQuery(() => listAutoBackups().catch(() => []), []);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  };

  const exportBackup = (encrypted: boolean) =>
    run(encrypted ? 'encrypted' : 'plain', async () => {
      if (encrypted && (password.length < 8 || password !== repeat)) {
        setError(t('backup.passwordRule'));
        return;
      }
      const text = serializeBackup(await createBackup(db));
      if (encrypted) {
        await shareTextFile(backupName('masroufi'), await encryptBackup(text, password, Crypto.getRandomBytes), 'application/octet-stream');
        setPassword('');
        setRepeat('');
      } else {
        await shareTextFile(backupName('json'), text, 'application/json');
      }
      await updateSetting('lastBackupAt', nowIso());
      toast({ message: t('backup.exported') });
    });

  const restore = (load: () => Promise<string | null> = pickTextFile) =>
    run('restore', async () => {
      const text = await load();
      if (text === null) return;

      let plain = text;
      if (isEncryptedBackup(text)) {
        const secret = await ask({ title: t('backup.enterPassword'), prompt: { placeholder: t('backup.password'), secure: true } });
        if (secret === null) return;
        plain = await decryptBackup(text, secret);
      }

      // Everything is validated before the question is even asked.
      const backup: BackupFile = parseBackup(plain);
      const summary = summarizeBackup(backup);
      const ok = await confirm({
        title: t('backup.restoreTitle'),
        message: t('backup.restoreBody', {
          date: formatDate(summary.createdAt.slice(0, 10), settings.language),
          accounts: summary.accounts,
          transactions: summary.transactions,
          debts: summary.debts,
        }),
        destructive: true,
        confirmLabel: t('backup.restoreConfirm'),
      });
      if (!ok) return;

      writeSafetyCopy('before-restore.json', serializeBackup(await createBackup(db)));
      await restoreBackup(db, backup);
      await reloadSettings();
      toast({ message: t('backup.restored') });
    });

  const exportCsv = (kind: 'transactions' | 'debts' | 'accounts') =>
    run(`csv-${kind}`, async () => {
      const content =
        kind === 'transactions'
          ? await exportTransactionsCsv(db, { type: (type) => t(`txType.${type}`), category: (tx) => (tx.categoryId ? nameOf({ key: tx.categoryKey, name: tx.categoryName }) : '') })
          : kind === 'debts'
            ? await exportDebtsCsv(db)
            : await exportAccountsCsv(db);
      await shareTextFile(`masroufi-${kind}-${today()}.csv`, content, 'text/csv');
    });

  return (
    <Screen title={t('backup.title')}>
      <Card>
        <T>{t('backup.intro')}</T>
        <T variant="small" tone="muted">
          {settings.lastBackupAt ? t('backup.last', { date: formatDate(settings.lastBackupAt.slice(0, 10), settings.language) }) : t('backup.never')}
        </T>
      </Card>

      <Section title={t('backup.encrypted')}>
        <T variant="small" tone="muted">
          {t('backup.encryptedHint')}
        </T>
        <Field label={t('backup.password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
        <Field label={t('backup.passwordRepeat')} value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" />
        <Button label={t('backup.exportEncrypted')} icon="lock-closed-outline" loading={busy === 'encrypted'} disabled={busy !== null} onPress={() => void exportBackup(true)} />
      </Section>

      <Section title={t('backup.plain')}>
        <T variant="small" tone="warning">
          {t('backup.plainWarning')}
        </T>
        <Button label={t('backup.exportPlain')} kind="secondary" icon="download-outline" loading={busy === 'plain'} disabled={busy !== null} onPress={() => void exportBackup(false)} />
      </Section>

      <Section title={t('backup.restore')}>
        <T variant="small" tone="muted">
          {t('backup.restoreHint')}
        </T>
        <Button label={t('backup.chooseFile')} kind="secondary" icon="cloud-upload-outline" loading={busy === 'restore'} disabled={busy !== null} onPress={() => void restore()} />
      </Section>

      {copies && copies.length > 0 ? (
        <Section title={t('backup.automatic')}>
          <T variant="small" tone="muted">
            {t('backup.automaticHint')}
          </T>
          <Card>
            {copies.map((date) => (
              <ListRow key={date} icon="time-outline" title={formatDate(date, settings.language)} onPress={() => void restore(() => readAutoBackup(date))} />
            ))}
          </Card>
        </Section>
      ) : null}

      <FieldError message={error} />

      <Section title={t('backup.csv')}>
        <Stacked>
          <Button label={t('backup.csvTransactions')} kind="secondary" compact loading={busy === 'csv-transactions'} disabled={busy !== null} onPress={() => void exportCsv('transactions')} />
          <Button label={t('backup.csvDebts')} kind="secondary" compact loading={busy === 'csv-debts'} disabled={busy !== null} onPress={() => void exportCsv('debts')} />
          <Button label={t('backup.csvAccounts')} kind="secondary" compact loading={busy === 'csv-accounts'} disabled={busy !== null} onPress={() => void exportCsv('accounts')} />
        </Stacked>
      </Section>

      <T variant="small" tone="muted">
        {t('backup.keepOutside')}
      </T>
    </Screen>
  );
}
