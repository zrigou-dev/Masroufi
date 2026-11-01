// Second journey: every secondary feature, operated through its real forms.
// Usage: node e2e/features.mjs [dist] [screenshotDir]
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

import { serve } from './serve.mjs';

const root = process.argv[2] ?? 'dist';
const shots = process.argv[3] ?? 'e2e/screenshots';
mkdirSync(shots, { recursive: true });

const PORT = 4175;
const BASE = `http://localhost:${PORT}`;
const server = await serve(root, PORT);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await context.newPage();

const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 300)}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !/favicon/.test(message.text())) problems.push(`console: ${message.text().slice(0, 300)}`);
});

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failures.push(`${name} ${String(detail).slice(0, 500)}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
};

const settle = (ms = 500) => page.waitForTimeout(ms);
const clean = (text) => text.replace(/[⁦⁩]/g, '').replace(/\s+/g, ' ');
const visible = async () => clean(await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[aria-hidden="true"]')];
  const saved = nodes.map((n) => [n, n.style.display]);
  saved.forEach(([n]) => { n.style.display = 'none'; });
  const text = document.body.innerText;
  saved.forEach(([n, d]) => { n.style.display = d; });
  return text;
}));
const shows = async (text) => (await visible()).includes(text);
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
// A full page load takes over a second, so waits are on the screen itself, never on a fixed delay.
const ready = async () => {
  let last = '';
  let steady = 0;
  for (let i = 0; i < 60 && steady < 3; i += 1) {
    await page.waitForTimeout(200);
    const text = await page.evaluate(() => (document.querySelector('[role="progressbar"]:not([aria-valuenow])') ? '' : document.body.innerText));
    steady = text.length > 40 && text === last ? steady + 1 : 0;
    last = text;
  }
};
const open = async (route) => {
  await page.goto(`${BASE}${route}`);
  await ready();
};
const tapText = async (text) => {
  await page.getByText(text, { exact: true }).last().click({ timeout: 5000 });
  await settle();
};
const tap = async (label) => {
  await page.getByLabel(label, { exact: true }).last().click({ timeout: 5000 });
  await settle();
};
const fill = (label, value) => page.getByLabel(label, { exact: true }).last().fill(value);
const pick = async (label, option) => {
  await page.getByRole('button', { name: new RegExp(`^${label}:`) }).last().click();
  await settle(400);
  await page.getByLabel(option, { exact: true }).last().click();
  await settle(400);
};

await page.goto(`${BASE}/`);
await page.waitForSelector('text=ابدأ');
await tapText('استكشف ببيانات تجريبية بدلًا من ذلك');
await settle(2500);
await shot('20-demo-home');
const demoHome = await visible();
check('demo loads through its explicit button', demoHome.includes('مجموع ما أملك') && demoHome.includes('البنك'), demoHome);
await page.mouse.wheel(0, 1500);
await settle(400);
await shot('21-demo-home-lower');

// ---- The fast paths: this is what daily use feels like
const amountOf = (label, text) => {
  const found = text.match(new RegExp(`${label} (-?[\\d,.]+)`));
  return found ? Number(found[1].replace(/,/g, '')) : NaN;
};
await open('/');
const startText = await visible();
const startTotal = amountOf('مجموع ما أملك', startText);
const startBank = amountOf('البنك', startText);
const startCash = amountOf('نقدًا', startText);
check('home shows learned quick buttons', startText.includes('إضافة سريعة') && startText.includes('قهوة'), startText);
await page.getByRole('button', { name: /^قهوة,/ }).first().click();
await settle(900);
await shot('20b-quick-tap');
check('one tap records the coffee', amountOf('مجموع ما أملك', await visible()) === startTotal - 15, await visible());
await page.getByText('تراجع', { exact: true }).last().click();
await settle(900);
check('undo takes the one-tap entry back', amountOf('مجموع ما أملك', await visible()) === startTotal);

await page.getByRole('button', { name: 'سحب نقدي' }).first().click();
await settle(900);
await shot('20c-withdraw');
check('the withdraw button opens a bank-to-cash transfer', await shows('ليس مصروفًا'));
await fill('المبلغ', '500');
await tapText('حفظ');
await settle(1000);
await open('/');
const afterWithdraw = await visible();
check('withdrawal moves money from bank to cash', amountOf('البنك', afterWithdraw) === startBank - 500 && amountOf('نقدًا', afterWithdraw) === startCash + 500, afterWithdraw);
check('withdrawal leaves the total alone', amountOf('مجموع ما أملك', afterWithdraw) === startTotal);

await page.getByRole('button', { name: 'مصروف' }).first().click();
await settle(900);
await shot('20d-expense-form');
await tap('المطاعم');
await settle(300);
await fill('المبلغ', '300');
await tapText('تفاصيل أكثر');
await page.getByLabel('شخص مدين لي بجزء من هذا', { exact: true }).click();
await settle(300);
await fill('الشخص أو الجهة', 'كريم');
await fill('حصته', '100');
await shot('20e-split');
await tapText('حفظ');
await settle(1000);
await open('/debts');
await tapText('لي');
await settle(500);
check('a split bill creates the debt owed to me', await shows('كريم') && await shows('100.00'));
await open('/');
check('the account paid the full bill', amountOf('نقدًا', await visible()) === startCash + 500 - 300, await visible());

// ---- Budget
await open('/budget/edit');
await fill('مبلغ الميزانية', '1000');
await fill('اسم الميزانية', 'البقالة الشهرية');
await pick('الفئة', 'البقالة');
await shot('22-budget-form');
await tapText('حفظ');
await settle(900);
await open('/budgets');
await shot('23-budgets');
check('budget saved and shows spending', await shows('البقالة الشهرية'));
check('budget shows a pace status', /على المسار|أقل من الوتيرة|أسرع من الوتيرة|تجاوزت الميزانية/.test(await visible()));

// ---- Goal, manual allocation
await open('/goal/edit');
await fill('المبلغ المستهدف', '5000');
await fill('اسم الهدف', 'سفر الصيف');
await tapText('حفظ');
await settle(900);
await open('/goals');
await shot('24-goals');
await page.getByLabel('سفر الصيف', { exact: true }).last().click();
await settle(900);
await fill('المبلغ', '1250');
await tapText('تخصيص');
await settle(900);
check('allocation adds progress', await shows('1,250.00'));
await shot('25-goal-detail');
await fill('المبلغ', '9999');
await tapText('استرداد');
await settle(500);
check('cannot take back more than set aside', await shows('لا يمكنك استرداد أكثر'));

// ---- Recurring: plan, confirm, no duplicate
await open('/recurring/edit');
await fill('المبلغ', '120');
await fill('الاسم', 'اشتراك الإنترنت');
await pick('الحساب', 'البنك');
await pick('الفئة', 'الاشتراكات');
await shot('26-recurring-form');
await page.getByLabel('تسجيل تلقائي', { exact: true }).click();
await settle(300);
await tapText('حفظ');
await settle(900);
await open('/recurring');
await shot('27-recurring');
check('new rule awaits confirmation, not paid', await shows('اشتراك الإنترنت') && await shows('بانتظار التأكيد'));
const pendingBefore = await page.getByText('تأكيد الدفع', { exact: true }).count();
await page.getByText('تأكيد الدفع', { exact: true }).last().click();
await settle(500);
await shot('28-recurring-confirm');
check('payment requires confirmation', await shows('تسجيل هذه الدفعة؟'));
await page.getByRole('button', { name: 'تأكيد' }).last().click();
await settle(1000);
const pendingAfter = await page.getByText('تأكيد الدفع', { exact: true }).count();
check('confirmed occurrence leaves the queue', pendingAfter === pendingBefore - 1, `${pendingBefore} -> ${pendingAfter}`);
await open('/transactions');
await fill('البحث في العمليات', 'اشتراك الإنترنت');
await settle(800);
const matches = await page.getByRole('button', { name: /^اشتراك الإنترنت/ }).count();
check('confirmed once means exactly one transaction', matches === 1, matches);

// ---- Reconcile, archive
await open('/accounts');
await shot('29-accounts');
await page.getByRole('button', { name: /^نقدًا/ }).first().click();
await settle(900);
await shot('30-account-detail');
const balanceText = await visible();
await tapText('مطابقة الرصيد');
await fill('الرصيد الفعلي', '1');
await settle(400);
await shot('31-reconcile');
await tapText('تسجيل التسوية');
await settle(1000);
check('reconcile brings the balance to the actual figure', await shows('1.00 درهم'), balanceText);
check('adjustment appears in history', await shows('تسوية رصيد'));

// ---- Installment schedule on the demo debt
await open('/debts');
await page.getByLabel('أحمد', { exact: true }).last().click();
await settle(900);
await shot('32-debt-with-schedule');
await page.getByText('تعديل', { exact: true }).last().click();
await settle(900);
await fill('عدد الأقساط', '3');
await tapText('إنشاء أقساط شهرية متساوية');
await shot('33-schedule-editor');
await tapText('حفظ');
await settle(1000);
check('schedule rewritten to 3 installments of 1,000', await shows('1,000.00'));

// ---- Write off, reopen
await open('/debts');
await tapText('لي');
await page.getByLabel('سارة', { exact: true }).last().click();
await settle(900);
await tapText('شطب الدين');
await page.getByPlaceholder('السبب').fill('تسامح');
await settle(300);
await page.getByRole('button', { name: 'تأكيد' }).last().click();
await settle(1000);
check('written-off debt shows its status', await shows('مشطوب'));
await tapText('إعادة فتح الدين');
await settle(900);
check('reopened debt returns', await shows('1,000.00'));

// ---- Categories
await open('/settings/category-edit');
await fill('الاسم', 'حيوانات أليفة');
await tapText('حفظ');
await settle(900);
await open('/settings/categories');
check('custom category listed', await shows('حيوانات أليفة'));

// ---- Reports, planning, insights, calendar have real content
await open('/planning');
await shot('34-planning');
check('planning explains the estimate', await shows('ليس ضمانًا'));
await fill('المبلغ الشهري للديون', '500');
await settle(600);
await page.mouse.wheel(0, 2000);
await settle(400);
await shot('35-repayment-compare');
check('repayment plans compare', await shows('الأصغر أولًا') && await shows('ليس استشارة مالية'));
await open('/insights');
await shot('36-insights');
check('insights separate fact from estimate', (await shows('قياس فعلي')));
await open('/calendar');
await shot('37-calendar');
await open('/reports');
await page.mouse.wheel(0, 900);
await settle(400);
await shot('38-reports-charts');

// ---- Backup: plain export, erase, wrong file, restore
await open('/settings/backup');
await shot('39-backup');
const totalBefore = async () => {
  await open('/');
  return (await visible()).match(/مجموع ما أملك ([\d,.]+)/)?.[1];
};
const owned = await totalBefore();
await open('/settings/backup');
const [download] = await Promise.all([page.waitForEvent('download'), page.getByText('تصدير نسخة غير مشفرة', { exact: true }).last().click()]);
const plainPath = `${shots}/backup-plain.json`;
await download.saveAs(plainPath);
await settle(600);
const backup = JSON.parse(readFileSync(plainPath, 'utf8'));
check('backup file is valid and complete', backup.format === 'masroufi-backup' && backup.tables.transactions.length > 20, backup.format);

await open('/settings/backup');
await fill('كلمة مرور النسخة', 'short');
await fill('أعد إدخال كلمة المرور', 'short');
await tapText('تصدير نسخة مشفرة');
await settle(500);
check('weak backup password refused', await shows('8 أحرف على الأقل'));
await fill('كلمة مرور النسخة', 'كلمة-سر-طويلة');
await fill('أعد إدخال كلمة المرور', 'كلمة-سر-طويلة');
const [sealed] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByText('تصدير نسخة مشفرة', { exact: true }).last().click()]);
const sealedPath = `${shots}/backup.masroufi`;
await sealed.saveAs(sealedPath);
await settle(600);
const sealedText = readFileSync(sealedPath, 'utf8');
check('encrypted backup hides the contents', !sealedText.includes('الراتب') && JSON.parse(sealedText).cipher === 'aes-256-gcm');

await open('/settings');
await tapText('مسح كل البيانات');
await page.getByPlaceholder('مسح').fill('خطأ');
await page.getByRole('button', { name: 'مسح كل شيء' }).last().click();
await settle(600);
check('wrong confirmation word erases nothing', await totalBefore() === owned);
await open('/settings');
await tapText('مسح كل البيانات');
await page.getByPlaceholder('مسح').fill('مسح');
await page.getByRole('button', { name: 'مسح كل شيء' }).last().click();
await settle(500);
await page.getByRole('button', { name: 'مسح كل شيء' }).last().click();
await settle(1500);
check('erase returns to onboarding', page.url().includes('onboarding'), page.url());

const dayNow = String(new Date().getDate());
await fill('الراتب الشهري (اختياري)', '9000');
await settle(300);
await fill('يوم الصرف من الشهر', dayNow);
await tapText('ابدأ');
await settle(3500);
await shot('39b-salary-auto');
check('salary set at onboarding reaches the balance by itself', await shows('مجموع ما أملك 9,000.00'), await visible());
await page.reload();
await ready();
check('reopening the app does not pay the salary twice', await shows('مجموع ما أملك 9,000.00'), await visible());
await open('/settings/backup');
const restoreFrom = async (path) => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('اختيار ملف نسخة', { exact: true }).last().click()]);
  await chooser.setFiles(path);
  await settle(1200);
};
writeJunk();
await restoreFrom(`${shots}/junk.json`);
check('a non-backup file is refused', await shows('هذه النسخة تالفة') || await shows('ليس ملف نسخة'));
await restoreFrom(sealedPath);
await page.getByPlaceholder('كلمة مرور النسخة').fill('خطأ');
await page.getByRole('button', { name: 'تأكيد' }).last().click();
await settle(5000);
check('wrong password refused', await shows('كلمة المرور خاطئة'));
await restoreFrom(sealedPath);
await page.getByPlaceholder('كلمة مرور النسخة').fill('كلمة-سر-طويلة');
await page.getByRole('button', { name: 'تأكيد' }).last().click();
await page.waitForSelector('text=استبدال كل البيانات الحالية؟', { timeout: 30000 });
await shot('40-restore-confirm');
check('restore summarises before replacing', await shows('سيُستبدل كل ما في التطبيق'));
await page.getByRole('button', { name: 'استبدال بياناتي' }).last().click();
await settle(2000);
check('encrypted restore brings every dirham back', await totalBefore() === owned, await visible());

// ---- CSV
await open('/settings/backup');
const [csv] = await Promise.all([page.waitForEvent('download'), page.getByText('العمليات', { exact: true }).last().click()]);
const csvPath = `${shots}/transactions.csv`;
await csv.saveAs(csvPath);
const csvText = readFileSync(csvPath, 'utf8');
check('csv is UTF-8 with BOM and Arabic labels', csvText.charCodeAt(0) === 0xfeff && csvText.includes('مصروف'));

// ---- Languages and themes
await open('/settings');
await shot('41-settings');
await page.getByRole('tab', { name: 'داكن' }).click();
await settle(600);
await open('/');
await shot('42-home-dark-ar');
await open('/reports');
await shot('43-reports-dark');
await open('/debts');
await shot('44-debts-dark');
await open('/settings');
await page.getByRole('tab', { name: 'Français' }).click();
await settle(800);
check('layout turns LTR for French', (await page.evaluate(() => document.documentElement.dir)) === 'ltr');
await open('/');
await shot('45-home-fr');
check('French money format', await shows('DH'));
await open('/settings');
await page.getByRole('tab', { name: 'English' }).click();
await settle(800);
await page.getByRole('tab', { name: 'Light' }).click();
await settle(600);
await open('/');
await shot('46-home-en');
check('English money format', await shows('MAD'));
await open('/settings');
await page.getByRole('tab', { name: 'العربية' }).click();
await settle(800);
check('back to RTL for Arabic', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');

// ---- Temporary category and subcategory
await open('/settings/category-edit');
await fill('الاسم', 'رحلة مراكش');
await page.getByLabel('مؤقتة', { exact: true }).click();
await settle(300);
await shot('48-category-temporary');
await tapText('حفظ');
await settle(900);

// ---- Large screen: the same app, using the room
await page.setViewportSize({ width: 1280, height: 800 });
await open('/');
await settle(800);
await shot('49-desktop-home');
await open('/reports');
await settle(800);
await shot('50-desktop-reports');
for (const route of ['/', '/reports', '/transaction/new']) {
  await open(route);
  check(`no sideways scroll at 1280px: ${route}`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
}

// ---- Narrow phone: no horizontal overflow
await page.setViewportSize({ width: 320, height: 640 });
for (const route of ['/', '/reports', '/debts', '/planning', '/transaction/new']) {
  await open(route);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(`no sideways scroll at 320px: ${route}`, !overflow);
}
await open('/');
await shot('47-small-phone');

await browser.close();
server.close();

function writeJunk() {
  const { writeFileSync } = process.getBuiltinModule('node:fs');
  writeFileSync(`${shots}/junk.json`, '{"hello":"world"}');
}

console.log(`\n${passed} checks passed, ${failures.length} failed, ${problems.length} runtime errors`);
failures.forEach((f) => console.log(`  FAILED: ${f}`));
[...new Set(problems)].forEach((p) => console.log(`  ${p}`));
process.exit(failures.length || problems.length ? 1 : 0);
