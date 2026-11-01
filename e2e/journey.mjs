// Drives the real app (web build, real SQLite) through the spec's scenarios via the UI only.
// Usage: npx expo export --platform web --output-dir dist && node e2e/journey.mjs [dist] [screenshotDir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

import { serve } from './serve.mjs';

const root = process.argv[2] ?? 'dist';
const shots = process.argv[3] ?? 'e2e/screenshots';
mkdirSync(shots, { recursive: true });

const PORT = 4174;
const BASE = `http://localhost:${PORT}`;
const server = await serve(root, PORT);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await context.newPage();

const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message.slice(0, 300)}`));
page.on('console', (message) => {
  const text = message.text();
  if (message.type() === 'error' && !/favicon/.test(text)) problems.push(`console: ${text.slice(0, 300)}`);
});

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failures.push(`${name} ${detail}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
};

const settle = (ms = 500) => page.waitForTimeout(ms);
const clean = (text) => text.replace(/[⁦⁩]/g, '').replace(/\s+/g, ' ');
// Only the focused route: the stack keeps earlier screens mounted but hidden.
const visible = async () => clean(await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[aria-hidden="true"]')];
  const hidden = nodes.map((n) => [n, n.style.display]);
  hidden.forEach(([n]) => { n.style.display = 'none'; });
  const text = document.body.innerText;
  hidden.forEach(([n, d]) => { n.style.display = d; });
  return text;
}));
const shows = async (text) => (await visible()).includes(text);
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });

const tap = async (label) => {
  await page.getByLabel(label, { exact: true }).last().click({ timeout: 5000 });
  await settle();
};
const tapText = async (text) => {
  await page.getByText(text, { exact: true }).last().click({ timeout: 5000 });
  await settle();
};
const fill = async (label, value) => {
  await page.getByLabel(label, { exact: true }).last().fill(value);
};
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
const goHome = async () => {
  await page.goto(`${BASE}/`);
  await ready();
};
const pick = async (label, option) => {
  await page.getByRole('button', { name: new RegExp(`^${label}:`) }).last().click();
  await settle(400);
  await page.getByLabel(option, { exact: true }).last().click();
  await settle(400);
};

await page.goto(`${BASE}/`);
await page.waitForSelector('text=ابدأ');

// ---- Onboarding with real data, Arabic numerals included
await fill('في البنك (درهم)', '٥٠٠٠');
await tapText('ابدأ');
await settle(1200);
await shot('02-home-empty');
check('onboarding lands on home', await shows('مجموع ما أملك'));
check('Arabic digits parsed: 5,000.00 total', await shows('5,000.00 درهم'));
check('no demo data on a clean start', !(await shows('الراتب الشهري')) && !(await shows('أحمد')));

// ---- Scenario A: transfer then spend
await tap('إضافة عملية');
await tapText('تحويل');
await fill('المبلغ', '1000');
await tapText('سحب نقدي');
await shot('03-transfer-form');
await tapText('حفظ');
await settle(1000);
check('A: total unchanged by transfer', await shows('مجموع ما أملك 5,000.00'), await visible());
check('A: transfer is not spending', await shows('المصاريف 0.00'));

await tap('إضافة عملية');
await fill('المبلغ', '40');
await shot('04-expense-form');
await tap('الطعام');
await tapText('حفظ');
await settle(1000);
check('A: total owned 4,960.00', await shows('مجموع ما أملك 4,960.00'));
check('A: bank 4,000.00', await shows('البنك 4,000.00'));
check('A: cash 960.00', await shows('النقد 960.00'));
check('A: expense 40.00', await shows('المصاريف 40.00'));
await shot('05-home-after-A');

// ---- Duplicate warning, double-submit, invalid input
await tap('إضافة عملية');
await tapText('حفظ');
check('H: empty amount rejected', await shows('أدخل مبلغًا صحيحًا'));
await fill('المبلغ', '40');
await tap('الطعام');
await tapText('حفظ');
await settle(500);
check('duplicate warning appears', await shows('قد تكون مكررة'));
await shot('06-duplicate-warning');
await tapText('إلغاء');
await page.getByLabel('Close', { exact: true }).count();
await goHome();
check('cancelling the duplicate saved nothing', await shows('مجموع ما أملك 4,960.00'));

// ---- Scenario B: borrow
await page.getByRole('tab', { name: /الديون/ }).click();
await settle(800);
await shot('07-debts-empty');
await tap('إضافة دين');
await fill('المبلغ', '2000');
await fill('الشخص أو الجهة', 'علي');
await shot('08-debt-form');
await pick('استُلم في', 'البنك');
await tapText('حفظ');
await settle(1000);
await goHome();
check('B: bank +2,000', await shows('البنك 6,000.00'));
check('B: liability 2,000', await shows('عليّ للآخرين 2,000.00'));
check('B: not income', await shows('الدخل 0.00'));
check('B: net unchanged', await shows('صافي الوضع المالي 4,960.00'));

// ---- Scenario C: repay
await page.getByRole('tab', { name: /الديون/ }).click();
await settle(800);
await page.getByLabel('علي', { exact: true }).last().click();
await settle(800);
await tap('تسجيل سداد');
await fill('المبلغ', '2500');
await tapText('حفظ');
check('H: repayment above the debt refused', await shows('هذا أكثر من الرصيد المتبقي'));
await fill('المبلغ', '500');
await shot('09-repayment-form');
await tapText('حفظ');
await settle(1000);
await shot('10-debt-detail');
check('C: remaining 1,500', await shows('1,500.00'));
await goHome();
check('C: bank 5,500', await shows('البنك 5,500.00'));
check('C: liability 1,500', await shows('عليّ للآخرين 1,500.00'));
check('C: repayment is not spending', await shows('المصاريف 40.00'));

// ---- Scenario D and E: lend, collect
await page.getByRole('tab', { name: /الديون/ }).click();
await settle(800);
await tap('إضافة دين');
await tapText('أقرضتُ');
await fill('المبلغ', '300');
await fill('الشخص أو الجهة', 'سارة');
await pick('دُفع من', 'النقد');
await tapText('حفظ');
await settle(1000);
await goHome();
check('D: cash -300', await shows('النقد 660.00'));
check('D: receivable 300', await shows('لي عند الآخرين 300.00'));
check('D: lending is not spending', await shows('المصاريف 40.00'));

await page.getByRole('tab', { name: /الديون/ }).click();
await settle(800);
await tapText('لي');
await settle(500);
await page.getByLabel('سارة', { exact: true }).last().click();
await settle(800);
await tap('تسجيل تحصيل');
await fill('المبلغ', '100');
await pick('استُلم في', 'البنك');
await tapText('حفظ');
await settle(1000);
await goHome();
check('E: bank +100', await shows('البنك 5,600.00'));
check('E: receivable 200', await shows('لي عند الآخرين 200.00'));
check('E: collection is not income', await shows('الدخل 0.00'));

// ---- Scenario F: edit an expense through the UI
await page.goto(`${BASE}/transactions`);
await ready();
await page.getByRole('button', { name: /^الطعام/ }).first().click();
await settle(800);
await shot('11-transaction-detail');
await tapText('تعديل');
await settle(600);
await fill('المبلغ', '100');
await tapText('حفظ');
await settle(1000);
await goHome();
check('F: expense edited to 100', await shows('المصاريف 100.00'));
check('F: cash follows the edit', await shows('النقد 600.00'));

// ---- Delete and undo
await page.goto(`${BASE}/transactions`);
await ready();
await page.getByRole('button', { name: /^الطعام/ }).first().click();
await settle(800);
await page.getByRole('button', { name: 'حذف' }).last().click();
await settle(400);
await shot('12-delete-confirm');
await page.getByRole('button', { name: 'حذف' }).last().click();
await settle(900);
await shot('13-undo-toast');
check('delete offers undo', await shows('تراجع'));
await tapText('تراجع');
await settle(900);
await goHome();
check('undo restores the expense', await shows('المصاريف 100.00'));

// ---- Persistence
await page.reload();
await page.waitForSelector('text=مجموع ما أملك');
await settle(900);
check('data survives a restart', await shows('مجموع ما أملك 6,200.00'), await visible());
await page.getByRole('button', { name: 'إخفاء المبالغ' }).click();
await settle(600);
await shot('14-amounts-hidden');
check('privacy mode hides amounts', !(await shows('6,200.00')));
await page.getByRole('button', { name: 'إظهار المبالغ' }).click();
await settle(400);

// ---- Tabs keep their labels while active
for (const [route, label] of [['/', 'الرئيسية'], ['/accounts', 'الحسابات'], ['/debts', 'الديون'], ['/reports', 'التقارير']]) {
  await page.goto(`${BASE}${route}`);
  await ready();
  const active = await page.evaluate(() => document.querySelector('a[aria-selected="true"]')?.innerText ?? '');
  check(`active tab shows its label: ${label}`, active.includes(label), active);
}

// ---- Every route renders
const routes = ['/accounts', '/debts', '/reports', '/more', '/transactions', '/budgets', '/budget/edit', '/goals', '/goal/edit', '/recurring', '/recurring/edit', '/calendar', '/planning', '/insights', '/settings', '/settings/categories', '/settings/category-edit', '/settings/backup', '/settings/security', '/account/edit', '/debt/edit'];
for (const route of routes) {
  await page.goto(`${BASE}${route}`);
  await ready();
  const blank = (await visible()).trim().length < 5;
  const broken = await shows('تعذّر التحميل');
  check(`route ${route}`, !blank && !broken);
  await shot(`route${route.replace(/\//g, '-')}`);
}

await browser.close();
server.close();

console.log(`\n${passed} checks passed, ${failures.length} failed, ${problems.length} runtime errors`);
failures.forEach((f) => console.log(`  FAILED: ${f.slice(0, 400)}`));
[...new Set(problems)].forEach((p) => console.log(`  ${p}`));
process.exit(failures.length || problems.length ? 1 : 0);
