# Masroufi (مصروفي)

A private personal finance app for Android, iOS and the browser: accounts, transactions, debts, budgets,
recurring income and bills, savings goals, reports and planning. Arabic first (full RTL), with French and
English. Moroccan dirham by default. Everything stays on the device: no account, no server, no analytics.

## Everyday use

- **Spending:** tap a quick button on Home and it is recorded, with Undo on screen. Quick buttons appear by
  themselves from what you repeat, and you can pin your own (Home → Manage). Press and hold one to change the
  details first.
- **Withdrawing cash:** the "Withdraw cash" button on Home opens Bank → Cash ready to go. A transfer never counts as
  spending, and an ATM fee can be added under More details.
- **Salary and bills:** add them once under Income and bills. They record themselves on their date, and you can
  edit, pause or delete any of them. A payment you delete stays deleted and waits for review.
- **Splitting a bill:** More details → "Someone owes me part of this". Only your share counts as spending.
- **Forgot something:** choose Yesterday or another date. If cash no longer matches, count your wallet (Account →
  Reconcile) and book the difference as spending.
- **One-off costs:** mark an expense as one-off, or make a temporary category for a trip or wedding. It leaves your
  lists after its date, and its history stays.

## Requirements

- Node.js 22.13 or newer (`nvm use` picks it up from `.nvmrc`). Expo SDK 58 does not run on Node 20.
- For a phone build: a free [Expo account](https://expo.dev/signup).

## Run it

```bash
npm install
npx expo start
```

Then press `a` for an Android emulator, or scan the QR code with a development build.

To use it in a browser, run `npm run web` and open `http://localhost:8081`. Data stays in that browser's storage:
it survives restarts, but it belongs to that one browser, and clearing site data erases it. Export a backup to move
to another browser or device.

## Install it on your phone

The cloud build needs no Android Studio:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

When it finishes, open the link on your phone and install the APK (Android asks you to allow installing from
that source). For iPhone, use `--platform ios`, which needs a paid Apple Developer account.

To build locally instead, install Android Studio and run `npx expo run:android --variant release`.

## Test it

```bash
npm run verify     # type check, lint, all Jest tests
npm test           # Jest only
npm run e2e        # builds for web, then drives the real UI in Chrome
```

The finance tests run real SQL: Node's built-in SQLite sits behind the same interface `expo-sqlite` implements
in the app, so migrations, constraints and views are exercised without mocks. The e2e journeys need Google
Chrome installed.

## Back up and restore

Your data exists only on your phone. If the phone is lost and you have no backup, it is gone.

**Back up:** More → Backup and export. Choose an encrypted backup, set a password of at least 8 characters, and
save the file somewhere off the phone: your computer, a USB drive, or a cloud drive. There is no password
recovery, so keep the password safe. Unencrypted backups are readable by anyone who has the file.

**Restore:** More → Backup and export → Choose a backup file. The file is fully checked first, and you see what
it contains before anything changes. Restoring replaces everything in the app, and it is all-or-nothing: a
damaged file changes nothing. Just before replacing, the app keeps a `before-restore.json` copy in its private
storage.

The app also keeps a copy of your data each day for the last 7 days (same screen). These undo a big mistake, but they
live on the same device, so they do not replace a backup kept elsewhere.

CSV exports (transactions, debts, accounts) open in Excel with Arabic intact. They are for reading, and cannot
be restored from.

## Limits worth knowing

- **Native builds have not been run yet.** See "Verification status" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **The database is not encrypted by the app.** The app lock stops someone opening the app; it does not encrypt
  the file. Protection at rest comes from your device, so keep a device passcode on.
- **Currencies are never converted.** Each currency has its own totals. A transfer between currencies records
  what you actually sent and received.
- **A forgotten PIN cannot be reset.** If device authentication is not set up either, the only way back in is
  reinstalling and restoring a backup.
- **Debt interest is not added automatically.** The rate is only used to compare repayment plans. Fees you enter
  do increase the balance, but they are not counted as spending.
- **Future-dated transactions are refused,** so nothing planned can pass for something paid. Use recurring rules.
- **Automatic items are recorded when the app opens.** Nothing runs in the background, so a salary due while the app
  is closed appears, correctly dated, the next time you open it.
- **Reminders** are scheduled while the app is in use, up to 50 ahead. Open the app now and then to keep them
  current. They never show amounts, because they appear on the lock screen.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the accounting model and the reasoning behind it.
# Masroufi
