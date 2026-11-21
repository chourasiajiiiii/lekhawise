# Roadmap

All seven phases are built. This page records what each phase contains, what was deliberately left out, and
ideas for later.

**Expo Go** = works in the Expo Go app. **Installed app** = needs a development or release build of the app,
because the feature uses native code that Expo Go does not include.

## Phase 1: foundations

| Module | Included |
|---|---|
| Dashboard | Total balance, monthly income, expenses, savings and savings rate, category breakdown, 6-month trend, budget progress, recent transactions, account balances |
| Transactions | Income, expenses, transfers; create, edit, delete; search; filters; notes |
| Accounts | Cash, bank, credit card, wallet, other; transfers; starting balance and debt |
| Categories | Default and custom categories with icons and colours; archive |
| Budgets | Monthly category budgets |
| Recurring | Daily, weekly, monthly, yearly; automatic catch-up; pause, resume, delete |
| Backup | Full backup, validated restore with preview, all-or-nothing |
| Security | Device lock (fingerprint, face, passcode), relock after 30 s, hidden app-switcher preview |

## Phase 2: everyday power features (Expo Go)

| Feature | How |
|---|---|
| Tags | `tags` and `transaction_tags`; tag chips in the form and the list filter; tag report; bulk tagging |
| Subcategories | `categories.parent_id`; reports and budgets roll up into the main category |
| Templates | `templates`; save from the form, one tap fills the form |
| Split transactions | `transaction_splits` and the `tx_lines` view used by reports and budgets |
| Split a bill with people | Your share is an expense; each other share is money lent to that person (Loans & debts) |
| Bulk operations | Select in the list: delete, change category, change account, add tag |
| Calendar | Month grid with daily spending; add an entry on a chosen day |
| Receipt photos | Camera or gallery, resized to 1600 px JPEG, kept in the app's folder, included in backups |
| Weekly and overall budgets | `budgets.period`, `category_id` null for all spending |
| Budget history and carry-forward | Limits with a start period; carry-forward of unspent money computed from history |
| Budget alerts | At 80% and when exceeded, after saving and for automatic entries |
| Bills, reminders, due dates | Recurring rules in reminder mode; mark paid with the actual amount; skip; local notifications; payment history |
| Duplicate detection | Warning before saving; duplicates screen; flagged on import |
| Account reconciliation and statements | Adjustment entry for the difference; statement with running balance, PDF |

## Phase 3: analytics (Expo Go)

| Feature | How |
|---|---|
| Monthly and yearly reports | Reports tab, month or financial year |
| Financial year | First month is a setting (April for rupees by default) |
| Comparisons | Previous period and the same period a year ago; a period in progress is compared with the same days |
| Trends and savings rate | 12-month bars, savings rate by month, average, highest and lowest month |
| Drill-down | Any total opens the entries behind it, with subcategories |
| Insights | Pace towards budgets, change against last month, fastest-growing category, savings rate, biggest category |

## Phase 4: wealth (Expo Go)

| Feature | How |
|---|---|
| Loans and debts | Loan accounts; EMI from rate and tenure; repayment schedule; interest split of each payment; borrowed and lent |
| Savings goals | Target, date, monthly amount needed, contributions or a linked account |
| Investments and assets | Holdings with invested amount and value history entered by hand; sold items kept |
| Net worth | Assets minus liabilities now, and for the last 12 months computed from history |

## Phase 5: data and security

| Feature | How | Runs in |
|---|---|---|
| PDF export | Phone's print engine; reports and account statements | Expo Go |
| Excel export | Real `.xlsx` with four sheets, written by `core/utils/xlsx.ts` | Expo Go |
| Encrypted backup | AES-256-GCM, key from an RFC 4880 S2K over SHA-256 | Expo Go |
| App PIN | 4 to 6 digits, salted slow hash in secure storage, growing pause after wrong attempts, optional fingerprint or face | Expo Go |
| CSV import | Column recognition, date and amount formats, preview, duplicates left out | Expo Go |
| Encrypted database | SQLCipher; random key in secure storage; existing databases converted once | Installed app |

## Phase 6: customisation (Expo Go)

| Feature | How |
|---|---|
| Languages | English and Hindi; `t()` with English keys; built-in names follow the language |
| Date formats | Phone setting or five fixed formats |
| Number formats | Phone setting, Indian, international, European, spaced |
| Customisable home | Show, hide and reorder cards |
| Currency precision | 1/1000 units for three-decimal currencies, whole numbers for yen and won; amounts rescaled when switching |

## Phase 7: device extras (installed app)

| Feature | How |
|---|---|
| Receipt scanner with on-device OCR | Android: ML Kit with its model bundled in the app (`modules/receipt-ocr`). iPhone: Apple Vision. The total, date and shop are suggested; the user checks them |
| Home-screen widget | `expo-widgets`: spent today, this month, budget left; refreshed whenever data changes |

## Known limits

- **iPhone builds have not been compiled or run.** They need a Mac with Xcode (or a cloud build). The iPhone
  widget layout, receipt reading through Apple Vision, Face ID and SQLCipher on iOS are written and configured
  but unverified.
- **Widget taps do not open the app.** `expo-widgets` does not offer an "open the app" action for home-screen
  widgets yet; the widget shows figures only.
- **Receipt reading suggests, it does not decide.** Unusual layouts can give a wrong total; the form always shows
  what was read before saving. Only Latin-script receipts are read (the ML Kit model bundled is the Latin one).
- **The small settings store is not encrypted.** It holds preferences (theme, language, currency, lock choice),
  not financial data.
- **Excel import** is not supported directly; save the sheet as CSV first.

## Ideas for later

- More languages (the dictionary approach makes each one a single file).
- A widget for quick entry once widgets can open the app at a chosen screen.
- Hindi and other scripts for receipt reading (ML Kit has a Devanagari model; it adds about 4 MB).
- Optional sync between the user's own devices through a file they control (no server).
