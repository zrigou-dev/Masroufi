# Build a Complete Personal Finance Management Mobile App

Act as a senior React Native engineer, mobile architect, financial software engineer, product designer, and QA engineer.

Your mission is to DESIGN, IMPLEMENT, TEST, and POLISH a complete personal finance management mobile application that I can use every day to manage my real personal finances.

Do not just give me a plan, a prototype, a mockup, or code snippets. Build the actual working application in the current project.

You have permission to inspect the existing project, create and modify files, install appropriate dependencies, implement the features, run tests, fix bugs, and improve the application until it is reliable and usable.

Do not stop after creating the initial UI. Complete the application end to end.

If the repository already contains a project, inspect it before making changes. Preserve useful existing work and avoid unnecessary rewrites. If the repository is empty, initialize the project using the requirements below.

---

# 1. PRODUCT VISION

Build a personal finance application called "Masroufi" (working name).

The application must help me understand and control my entire financial life.

I want to know, at any moment:

- How much money I have in each bank account.
- How much cash I have.
- How much money I have in total.
- Where every dirham goes.
- How much I spend on each category.
- How much money I earn.
- How much I owe other people.
- How much other people owe me.
- How much debt I have repaid.
- How much debt remains.
- Which payments are due soon or overdue.
- How much money I can safely spend.
- How much I can save.
- Whether my financial situation is improving or deteriorating.
- What I should prioritize to improve my financial situation.

The app should act as a practical financial control center, not merely an expense tracker.

The main goals are accuracy, simplicity, privacy, speed, beautiful design, and genuinely useful financial insights.

Do not make unrealistic promises about fixing my finances automatically. Instead, give me accurate information, clear priorities, actionable plans, and tools that help me make better financial decisions.

# 2. CORE TECHNICAL REQUIREMENTS

Use:

- React Native.
- Expo.
- TypeScript with strict type checking.
- Expo Router for navigation.
- SQLite using a compatible Expo SQLite implementation for persistent local storage.
- A lightweight, maintainable state-management approach.
- A lightweight charting solution only where necessary.
- Local notifications for reminders, where supported.
- A suitable icon library compatible with Expo.

Before choosing dependencies, check their current compatibility with the project's Expo SDK.

Prefer Expo-compatible libraries and use `npx expo install` for native dependencies when appropriate.

Do not use a backend, cloud database, external API, authentication server, or paid service for the core application.

All financial information must remain on the device by default.

The application must work offline, including creating transactions, editing transactions, managing debts, calculating balances, viewing reports, and using budgets.

Do not introduce unnecessary libraries, heavy dependencies, or complex infrastructure.

Optimize for a small application bundle, fast startup, smooth navigation, low memory usage, and reasonable battery consumption.

Do not add artificial intelligence APIs, analytics services, advertising SDKs, or tracking services.

Do not send personal financial information anywhere.

# 3. LANGUAGE, LOCALIZATION, AND DESIGN

The primary language is Arabic.

Requirements:

- Full Arabic interface.
- Correct right-to-left layout.
- Proper Arabic text rendering.
- Arabic-compatible typography.
- English and French localization should be supported through a maintainable translation system.
- Allow the user to select the language.
- Use Moroccan dirhams (MAD / DH) as the default currency.
- Format dates, numbers, and currencies correctly.
- Use the appropriate locale for each supported language.

The design must be modern, premium, minimal, friendly, and exceptionally easy to understand.

Avoid a generic, cluttered banking dashboard.

Design principles:

- Clear visual hierarchy.
- Generous but efficient spacing.
- Consistent typography.
- Beautiful cards and subtle borders.
- Restrained use of colors.
- Green for positive financial changes.
- Red for expenses and overdue items, with accessible contrast.
- Neutral backgrounds.
- Smooth but subtle animations.
- Consistent icons.
- Responsive layouts for different phone sizes.
- Accessible touch targets.
- Clear loading, empty, success, and error states.
- Dark mode and light mode.
- Respect system appearance settings.
- Avoid excessive gradients, excessive shadows, and decorative elements that reduce clarity.

Create a consistent design system with reusable components, spacing tokens, typography, colors, and shared financial UI elements.

The app should feel polished, not like an unfinished developer tool.

# 4. PRIMARY NAVIGATION

Create a simple bottom navigation with these main sections:

1. Home.
2. Accounts.
3. Add Transaction.
4. Debts.
5. Reports.

Place settings, budgets, goals, recurring transactions, scheduled payments, and backup management in sensible secondary locations.

The Add Transaction action should be easy to access from anywhere.

Avoid unnecessary screens and duplicate navigation paths.

# 5. HOME DASHBOARD

Build a useful financial dashboard containing:

- Total available money across accounts.
- Total bank balances.
- Total cash.
- Other account balances.
- Total money owed to me.
- Total debt I owe.
- Estimated net financial position.
- Income for the current month.
- Expenses for the current month.
- Net monthly cash flow.
- Current budget usage.
- Upcoming bills and debt payments.
- Overdue debts and obligations.
- Savings goal progress.
- Recent transactions.
- A useful summary of financial activity.

Allow the user to switch between weekly, monthly, yearly, and custom date ranges where appropriate.

Provide a privacy option to hide monetary amounts from view.

Never confuse available cash with money owed to me.

Calculate net financial position consistently:

Net financial position = owned assets tracked by the application - outstanding liabilities.

For the initial implementation, define which account balances and receivables count as assets, and which debts count as liabilities. Avoid double-counting transfers or receivables.

# 6. ACCOUNTS AND WALLETS

Allow me to create and manage multiple accounts:

- Bank accounts.
- Cash wallets.
- Savings accounts.
- Other manually tracked financial accounts.

Each account must support:

- Name.
- Account type.
- Currency.
- Opening balance.
- Current calculated balance.
- Creation date.
- Optional description.
- Active or archived status.

Allow me to record:

- Deposits.
- Withdrawals.
- Transfers between accounts.
- Income.
- Expenses.
- Debt receipts and repayments.
- Opening-balance adjustments.
- Balance reconciliation.

Display each account's transaction history.

Support account filtering, search, editing, and archiving.

Never allow archiving an account to silently destroy transaction history.

Handle transfers correctly.

Example:

Starting bank balance: 5,000 MAD.

Transfer 1,000 MAD from bank to cash.

Bank balance: 4,000 MAD.

Cash balance: increases by 1,000 MAD.

Total owned money does not change.

If I subsequently spend 40 MAD from cash:

Cash decreases by 40 MAD.

Total owned money decreases by 40 MAD.

The transfer must never appear as income or expense in ordinary spending reports.

Represent transfers as one logically atomic operation with linked account entries.

Prevent partial transfers if one side fails.

# 7. TRANSACTION MANAGEMENT

Implement a complete transaction system.

Transaction types must distinguish at least:

- Income.
- Expense.
- Transfer.
- Debt borrowed.
- Debt lent.
- Debt repayment.
- Debt collection.
- Refund.
- Reversal or correction where appropriate.

Every transaction should support:

- Amount.
- Currency.
- Date and time.
- Account.
- Category.
- Optional description.
- Optional notes.
- Optional payee or payer.
- Optional debt reference.
- Optional tags.
- Creation and modification timestamps.

Support:

- Create.
- Edit.
- Search.
- Filter.
- View details.
- Delete with confirmation.
- Undo where safe.
- Duplicate transaction detection where appropriate.
- Transaction history by account and date range.

Deleting or editing a financial transaction must correctly update every affected balance, report, budget, and debt.

Never directly mutate a balance in a way that causes transaction history and calculated balances to diverge.

For financial corrections, prefer reversible operations or explicit adjustment entries where appropriate.

Use database transactions to keep related financial updates atomic.

# 8. CATEGORIES

Provide useful default categories in Arabic.

Income examples:

- Salary.
- Freelance income.
- Business income.
- Gifts received.
- Other income.

Expense examples:

- Housing.
- Food.
- Groceries.
- Restaurants.
- Transportation.
- Fuel.
- Utilities.
- Internet and telephone.
- Health.
- Clothing.
- Shopping.
- Family.
- Education.
- Entertainment.
- Subscriptions.
- Travel.
- Gifts.
- Fees.
- Other expenses.

Allow custom categories, category colors or icons, and category management.

Support category-specific reports and budgets.

Use sensible default categories without forcing the user to use all of them.

# 9. DEBT MANAGEMENT

This is one of the most important modules.

Support both directions of debt.

A. Money I owe other people.

B. Money other people owe me.

Each debt must contain:

- Person or organization.
- Original principal.
- Currency.
- Date the debt began.
- Optional due date.
- Optional interest or fees, disabled by default.
- Optional installments.
- Optional description.
- Optional evidence or reference notes.
- Status.
- Total repaid or collected.
- Remaining balance.
- Complete repayment history.

Support these states:

- Open.
- Partially repaid.
- Fully settled.
- Overdue.
- Cancelled or written off, with explicit handling and history.

Allow multiple partial payments.

Allow an installment plan with customizable amounts and dates.

Show:

- Original debt.
- Amount already repaid or collected.
- Remaining balance.
- Next payment date.
- Overdue amount.
- Payment progress.
- Full payment history.

Example:

I owe a person 2,000 MAD.

I repay 500 MAD.

Outstanding debt becomes 1,500 MAD.

My selected cash or bank account decreases by 500 MAD.

The repayment must not also be counted as an ordinary purchase expense in a way that double-counts the original borrowed principal.

Similarly, if someone owes me 2,000 MAD and returns 500 MAD:

The receivable decreases by 500 MAD.

The selected account increases by 500 MAD.

The app must preserve the distinction between receiving money I previously lent and earning new income.

Support debt payments made from different accounts.

Allow changing an installment schedule without corrupting previous payment history.

Prevent payments exceeding the outstanding debt unless the user explicitly records an overpayment or correction.

Support multiple debts with the same person without accidentally merging them.

Provide debt details, payment reminders, payment receipts or printable summaries if feasible without introducing heavy dependencies.

# 10. BUDGETS AND SPENDING CONTROL

Implement monthly and custom-period budgets.

Allow budgets for:

- Total spending.
- Individual categories.
- Optional account-specific limits.

Show:

- Budget amount.
- Amount spent.
- Remaining budget.
- Percentage used.
- Expected spending pace.
- Over-budget status.

Allow configurable warnings, such as 70%, 85%, and 100%.

Avoid unnecessary notifications.

A budget should be based on actual expenses, refunds, and the selected period, not on account transfers.

If an expense is edited or reversed, recalculate the relevant budget.

Make it easy to identify the categories that consume the most money.

# 11. INCOME, RECURRING TRANSACTIONS, AND BILLS

Support recurring financial activity such as:

- Monthly salary.
- Rent.
- Internet and telephone bills.
- Subscriptions.
- Installment payments.
- Regular family contributions.

Each recurring rule should support:

- Amount.
- Frequency.
- Start date.
- Optional end date.
- Next expected occurrence.
- Linked account where appropriate.
- Category.
- Reminder settings.
- Active or paused state.

Do not silently create duplicate transactions when the application is opened repeatedly.

Use reliable occurrence identifiers and database constraints where appropriate.

Distinguish between:

- A planned bill.
- A due debt installment.
- A transaction that has actually been paid.

Never treat a planned payment as already paid.

Allow confirmation before recording an actual payment.

Provide a calendar or timeline of upcoming financial obligations.

# 12. SAVINGS GOALS

Allow me to create savings goals, such as:

- Emergency fund.
- New computer.
- Education.
- Travel.
- Personal purchases.

Each goal should contain:

- Goal name.
- Target amount.
- Current progress.
- Optional target date.
- Priority.
- Notes.

Show:

- Amount remaining.
- Progress percentage.
- Suggested monthly contribution based on the remaining time.
- Whether the target date appears realistic given available information.

Support manually allocated savings and account-linked savings without double-counting money.

Moving money to a savings account is a transfer, not an expense.

Do not claim that money allocated to a goal is legally or physically separated unless it actually is.

# 13. FINANCIAL INSIGHTS

Create a local financial analysis engine using the application's own data.

Do not require an external AI API.

Provide clear insights such as:

- Highest spending categories.
- Spending increases compared with previous periods.
- Monthly income versus expenses.
- Recurring obligations.
- Outstanding debts.
- Upcoming payments.
- Potential savings opportunities.
- Unusual transactions.
- Categories exceeding their budgets.
- Trends in account balances.

Use understandable language, not financial jargon.

Clearly distinguish measured facts from estimates.

Never invent missing information.

For example:

"You spent 450 MAD on restaurants this month, compared with 300 MAD last month."

Only display such a comparison if the underlying data supports it.

Where useful, show an actionable suggestion with a transparent explanation.

Avoid shame, guilt, or judgmental language.

# 14. PERSONAL FINANCIAL PLANNING

Implement practical planning tools.

Include:

- Monthly financial overview.
- Essential versus discretionary spending.
- Upcoming obligations.
- Debt repayment planning.
- Emergency fund tracking.
- Savings planning.
- A simple available-to-spend estimate.

Calculate available-to-spend carefully.

Start with the money currently available in selected liquid accounts.

Subtract explicitly reserved near-term obligations and other user-defined allocations, while avoiding double-counting debt installments, budgets, and savings allocations.

Explain what is included in the calculation.

Do not present this estimate as a guarantee that spending is safe.

Support debt prioritization by due date, outstanding amount, and user-defined priority.

Allow comparing repayment plans without pretending that a mathematical estimate is professional financial advice.

Do not assume a specific income, debt level, lifestyle, or financial objective for the user.

# 15. REPORTS AND HISTORY

Implement reports with useful date filters:

- Income by period.
- Expenses by period.
- Net cash flow.
- Spending by category.
- Spending by account.
- Transfers.
- Debt repayments.
- Debt collections.
- Outstanding debts.
- Monthly balance trends.
- Budget performance.
- Savings goal progress.
- Recurring obligations.

Charts must be lightweight, readable, and accessible.

Reports must use the same financial calculation rules as the dashboard.

Provide CSV export and a backup/restore mechanism.

If PDF reports can be implemented reliably with a lightweight compatible library, add them as a secondary feature. Do not compromise core functionality for PDF generation.

Ensure exported financial data uses correct amounts, dates, currencies, and character encoding.

# 16. DATA MODEL AND FINANCIAL CORRECTNESS

Design the local SQLite schema carefully.

Create normalized, maintainable tables as needed, such as:

- accounts
- transactions
- categories
- debts
- debt_payments
- installments
- recurring_rules
- budgets
- savings_goals
- settings
- transaction_links or ledger_entries, if appropriate
- schema_migrations

Adapt the exact schema to a coherent and reliable accounting design.

Important rules:

1. Store monetary amounts using integer minor units whenever appropriate, rather than binary floating-point arithmetic.

2. Store currencies explicitly.

3. Do not add amounts in different currencies without a valid conversion mechanism.

4. Keep transaction history and derived balances consistent.

5. Use atomic database transactions for related changes.

6. Use foreign keys and appropriate indexes.

7. Enforce valid amounts and referential integrity.

8. Use stable identifiers.

9. Support database schema migrations.

10. Handle application restarts and interrupted writes safely.

11. Prevent duplicate transaction creation from repeated user actions.

12. Use one authoritative financial calculation layer.

13. Avoid having separate, inconsistent balance formulas in different screens.

14. Distinguish opening balances, adjustments, income, expenses, transfers, receivables, liabilities, and repayments.

15. Ensure reports never double-count a financial event.

16. Never silently discard user financial data.

17. Validate all user input.

18. Use correct local date handling and avoid timezone-related reporting errors.

19. Use a clear strategy for refunds, reversals, corrections, and deleted transactions.

20. Test calculations against independently calculated expected results.

If a ledger-based approach is appropriate, use balanced entries and enforce the necessary invariants. Otherwise, document and enforce another coherent accounting model.

# 17. PRIVACY AND SECURITY

All data should remain local by default.

Implement:

- No analytics or tracking.
- No network calls for financial operations.
- No external API dependency.
- Optional application lock with PIN or device authentication where supported.
- Secure handling of sensitive settings.
- Encrypted backup exports if feasible using a vetted, maintained encryption library.
- A clear backup and restore workflow.
- Destructive-action confirmations.
- Privacy-conscious logs that never print sensitive financial information.

Do not invent your own cryptographic algorithms.

Do not hardcode encryption keys.

Explain the limitations of local application security.

If using device authentication, do not claim that the SQLite database itself is encrypted merely because the app is protected by a PIN.

If full database encryption is not implemented, state that limitation clearly and do not misrepresent the security level.

Do not introduce biometric or cryptographic dependencies without checking Expo compatibility.

# 18. BACKUP, RESTORE, AND DATA PORTABILITY

This functionality is essential.

Implement:

- Export all user data to a backup file.
- Restore from a valid backup.
- Validate the backup before modifying existing data.
- Include a schema version.
- Handle incompatible versions safely.
- Detect corrupted or incomplete backups.
- Prevent accidental overwriting without confirmation.
- Use atomic restoration or a safe staging-and-replacement process.
- Support CSV export of relevant financial records.

If encryption is supported, use a standard authenticated encryption mechanism with a securely derived key and an appropriate password-based key derivation function.

Never store the backup password in plain text.

Provide clear instructions for keeping a backup outside the device.

Test the backup and restore process with realistic datasets.

# 19. USABILITY AND ACCESSIBILITY

Make common actions exceptionally fast.

The user should be able to:

- Add an expense in a few seconds.
- Record a withdrawal quickly.
- Transfer money between accounts easily.
- Create a debt without filling unnecessary fields.
- Record a partial repayment with minimal steps.
- See remaining debt immediately.
- Find a transaction quickly.
- Correct an incorrect entry safely.

Use sensible defaults.

Support optional notes rather than forcing them.

Use clear validation messages.

Prevent accidental double taps from recording duplicate transactions.

Provide helpful empty states for first-time users.

Allow the user to edit or delete incorrect entries with appropriate safeguards.

Use accessible labels and touch targets.

Ensure Arabic right-to-left layouts work correctly in forms, numbers, charts, dialogs, and navigation.

# 20. TESTING REQUIREMENTS

Testing is mandatory.

Write automated tests for:

- Core financial calculations.
- Account balance calculations.
- Transfers.
- Income and expenses.
- Debt creation.
- Partial and complete repayments.
- Debt collection.
- Installment schedules.
- Budget calculations.
- Recurring transaction deduplication.
- Refunds and reversals.
- Currency handling.
- Date boundaries.
- Editing transactions.
- Deleting or reversing transactions.
- Backup and restore.
- Database migrations.
- Invalid input.
- Concurrent or repeated financial actions where applicable.

Include integration tests for important SQLite workflows.

Add UI tests or practical automated interaction checks for critical user journeys where the project's tooling permits.

Use realistic test data and independently verified expected results.

At minimum, test these scenarios:

Scenario A:
Bank balance = 5,000 MAD.
Cash balance = 0 MAD.
Transfer 1,000 MAD from bank to cash.
Spend 40 MAD from cash.
Expected bank = 4,000 MAD.
Expected cash = 960 MAD.
Expected total owned money = 4,960 MAD.
Expected actual expense = 40 MAD.

Scenario B:
Borrow 2,000 MAD and receive the money into the bank.
Expected bank increases by 2,000 MAD.
Expected outstanding liability increases by 2,000 MAD.
Expected ordinary earned income does not increase by 2,000 MAD.

Scenario C:
Repay 500 MAD of that debt from the bank.
Expected bank decreases by 500 MAD.
Expected outstanding liability becomes 1,500 MAD.
Expected repayment is not double-counted as an ordinary purchase expense.

Scenario D:
Lend 2,000 MAD to another person from cash.
Expected cash decreases by 2,000 MAD.
Expected receivable increases by 2,000 MAD.
Expected ordinary expenses do not incorrectly increase by 2,000 MAD.

Scenario E:
Collect 500 MAD of the loan.
Expected selected account increases by 500 MAD.
Expected receivable becomes 1,500 MAD.
Expected the collection is not counted as new earned income.

Scenario F:
Edit an existing expense.
Expected all relevant account balances, reports, and budgets update correctly.

Scenario G:
Export a backup, reset a test database, and restore the backup.
Expected all supported financial data and relationships are restored accurately.

Scenario H:
Attempt to record an invalid repayment, duplicate transfer, invalid amount, or inconsistent transaction.
Expected the application rejects or safely handles the operation without corrupting balances.

Run the existing checks and all new relevant tests.

Fix failures caused by your implementation.

Do not hide failing tests, weaken assertions, or silently skip important tests.

Report external environment limitations honestly.

# 21. DEVELOPMENT WORKFLOW

Work in the following order:

Phase 1: Inspect the repository, environment, existing dependencies, and project structure.

Phase 2: Establish the application architecture, navigation, design system, and database schema.

Phase 3: Implement the financial data layer and calculation engine first.

Phase 4: Test financial calculations before relying on them in the UI.

Phase 5: Implement accounts, transactions, transfers, debts, and repayments.

Phase 6: Implement the home dashboard, budgets, reports, recurring payments, and savings goals.

Phase 7: Implement localization, RTL layouts, themes, notifications, and backup/restore.

Phase 8: Add and run tests, fix issues, and validate critical workflows.

Phase 9: Polish performance, remove unnecessary dependencies, and improve the overall experience.

Phase 10: Document how to run, test, build, back up, and restore the application.

Do not generate the entire application as one enormous component.

Keep modules small, cohesive, strongly typed, and maintainable.

Use clear folder structure and reusable components.

Avoid `any` unless there is a documented and justified reason.

Avoid placeholder screens, fake data in production UI, dead buttons, and TODO-only implementations.

Demo data may be provided through an explicit optional onboarding action, but the actual application must work with real user-entered data from a clean installation.

Do not delete or overwrite existing project work without inspecting it first.

Do not perform destructive operations outside the project.

If you encounter a genuine blocker, explain it, complete the independent work that remains possible, and document the blocker instead of pretending the task is finished.

# 22. DEFINITION OF DONE

The project is not complete merely because it compiles.

The application is complete when:

- It launches successfully in the supported development environment.
- The main navigation works.
- All primary screens are implemented.
- All critical financial operations persist correctly.
- Account balances are accurate.
- Transfers are not counted as expenses or income.
- Debt principal and repayments are accounted for correctly.
- Reports agree with the underlying transactions.
- Data remains available after restarting the application.
- Offline workflows function.
- Backup and restore work, or any remaining limitation is explicitly documented.
- Arabic RTL works across all main screens.
- There are no known critical financial calculation bugs.
- All relevant tests pass, or remaining environment-related failures are clearly documented.
- The application has no known broken primary buttons or placeholder workflows.
- The project includes clear setup and usage instructions.

# 23. FINAL REPORT

When finished, provide a concise but useful report containing:

1. What was implemented.
2. The application architecture and key dependencies.
3. The database schema and financial calculation approach.
4. The main features that work.
5. Tests executed and their actual results.
6. Build or runtime verification results.
7. Any remaining limitations.
8. Exact commands to run the application.
9. Exact commands to run the tests.
10. How to build and install the application on my phone.
11. How to back up and restore my data.

Be honest about what you actually ran and verified.

Start by inspecting the current project, then proceed with implementation. Do not stop at planning or asking me to approve every small technical decision. Make sensible engineering decisions, document important assumptions, and deliver the most complete, reliable application possible within the environment.