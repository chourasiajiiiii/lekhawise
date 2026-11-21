# Architecture

## The shape of the app

```
Screen (src/app)
  └─ useQuery((db) => repo.listSomething(db, ...), [deps])
        └─ repo*.ts  ── plain SQL ──>  SQLite file on the phone (lekhawise.db, encrypted in installed builds)
  └─ on save: repo.saveSomething(db, ...)  →  notifyDataChanged()  →  every useQuery re-runs
```

There is no global state library. The database is the single source of truth, and because it is local, re-running
a query is fast enough to do on every change. This removes a whole category of "screen shows stale data" bugs.

Settings that must be known before the first render (theme, language, formats, app lock, currency) live in a
small synchronous key-value store (`expo-sqlite/kv-store`), wrapped by `useSetting()`. Secrets (the app PIN's
hash, the database key) live in the phone's secure storage (`expo-secure-store`).

## Rules worth keeping

1. **Money is an integer number of minor units.** 1/100 of the currency, or 1/1000 for the three-decimal
   currencies (Kuwaiti, Bahraini, Omani). `moneyScale(currency)` gives the unit. Never store or add floats; format
   only at the edge with `formatMoney()` or the `useMoney()` hook.
2. **Dates are `YYYY-MM-DD` strings in local time.** They sort and compare as text and never shift across time
   zones. Timestamps (`created_at`) are ISO strings.
3. **All SQL lives in the `repo*.ts` files.** Screens never write SQL.
4. **Every write calls `notifyDataChanged()`.**
5. **Ids are random UUIDs**, so data from different phones can be merged later without clashes.
6. **Archive, don't delete, anything history refers to** (accounts, categories, loans, goals, holdings).
7. **Pure logic goes in pure files** (`schedule.ts`, `budgetMath.ts`, `loanMath.ts`, `insights.ts`,
   `csvImport.ts`, `receiptParser.ts`, `backupFormat.ts`, `core/utils/*`) so it can be unit-tested without a
   phone.
8. **Text shown to people goes through `t()`** with the English text as the key. `npm run i18n:check` lists text
   without a translation, and a test fails if any is missing.
9. **Lists that can grow without limit are paged or virtualised.** The Transactions tab uses a `SectionList`;
   other screens show 50 items at a time with `useShowMore()` from `core/ui`. Rendering a few thousand rows at
   once takes over a minute on an ordinary phone.
10. **Never act on stale results.** While `useQuery` re-runs for new inputs it keeps the previous `data` (no
    flicker) and sets `stale`. Bulk actions are disabled while the list is stale, and only act on selected
    entries that are on screen.
11. **Queries used for whole-table checks need an index that fits them**, and date conditions written as ranges
    on the column (`date between ? and ?`), not as functions of it. Pages are decrypted as they are read in the
    installed app, so a full scan costs far more on the phone than in tests.

## Data model notes

- **Split transactions** keep their parts in `transaction_splits`. The view `tx_lines` gives one row per category
  amount (a split contributes one row per part, any other transaction one row); category reports and budgets read
  `tx_lines`, so splits are counted in the right categories.
- **Subcategories** have `parent_id`. Totals roll up into the main category; budgets are set on main categories.
- **Budgets** have a period (`month` or `week`) and limits in `budget_limits` with the period they start from; the
  latest limit at or before a period applies, so past periods keep the amount they had. Carry-forward is worked
  out from that history (`budgetMath.ts`), not stored.
- **Loans** are accounts of type `loan` plus a `loans` row. Borrowing, lending and repaying are transfers between a
  loan and a real account, so balances and net worth stay correct; the interest part of a payment is an ordinary
  expense or income entry linked by `loan_id`.
- **Bills** are recurring rules in `remind` mode: nothing is added until the user marks the bill paid.
- **Net worth history** is computed, not stored: account balances only change through income and expenses
  (transfers cancel out), and each investment's value at a date is its latest recorded value.

## Changing the database schema

Migrations are in `src/features/expenses/schema.ts`. The position in the `MIGRATIONS` array is the version number,
stored in SQLite's `PRAGMA user_version`. Each migration runs inside a transaction together with its version bump,
with foreign keys switched off so a table can be rebuilt; `foreign_key_check` must be clean before it commits.

To change the schema:

1. Append a new function to `MIGRATIONS`. Never edit or reorder one that has shipped.
2. Prefer additive changes: `alter table ... add column ... default ...`, new tables, new indexes. To change a
   column constraint, rebuild the table (create new, copy, drop old, rename), as migration 2 does for `accounts`.
3. Update `TABLE_COLUMNS` in `backupFormat.ts` if a backed-up table changed, and `MONEY_COLUMNS` for money.
4. Add a step to `upgradeBackup()` so backups made by older versions still restore.
5. Add or extend a test in `src/features/expenses/__tests__/repo.test.ts`, including an upgrade from the previous
   version with data in it.

## Work that would need a server elsewhere

There are no background jobs or servers. On start-up and each time the app returns to the foreground:

- `processRecurring()` creates recurring entries that fell due. The next date is calculated from the start date
  and a counter, never from the previous date, so monthly rules on the 29th to 31st never drift. Concurrent calls
  share one run.
- Budget alerts are checked for those new entries.
- Bill reminders are rescheduled as local notifications (at 9 am, the chosen number of days before the due date).
- The home-screen widget is refreshed.

## Backups

A backup is a JSON file with every table (`TABLE_COLUMNS` is the whitelist), the settings that should travel
with it, and receipt photos as base64. With a password, that JSON is encrypted with AES-256-GCM using a key made
with the OpenPGP iterated and salted S2K (RFC 4880), SHA-256 over 32 MB: one native hash call, so it takes
milliseconds on the phone while costing an attacker as much per guess as about 250,000 rounds of PBKDF2.

Restore is two steps: pick the file (and give the password), which validates structure, ids, amounts, dates and
references and returns a summary; then replace all data inside one transaction (foreign keys checked at commit),
so a failure leaves the existing data untouched.

## Encryption on the phone

Installed builds include SQLCipher (`useSQLCipher` in the expo-sqlite config plugin). Before the database opens,
`prepareDatabaseEncryption()` gets the 256-bit key from secure storage (creating it on first launch) and, if it
finds an existing unencrypted database, copies it into an encrypted file with `sqlcipher_export` and swaps the
files. `PRAGMA key` is then the first statement on the connection. Expo Go has no SQLCipher; there the key is
skipped and the database stays unencrypted. The small settings store is not encrypted and holds no financial data.

## Native pieces

- `modules/receipt-ocr`: on-device text recognition. Android uses ML Kit's bundled model (no download, no Google
  Play services), iPhone uses Apple's Vision framework, and the photo's orientation is respected on both. Each
  returns recognised pieces with their positions; `features/expenses/textRows.ts` joins pieces on the same printed
  row (so "TOTAL" stays next to its amount) once, for both platforms, and is unit-tested.
- `src/widgets/`: the home-screen widget, with one layout per platform (`expo-widgets`: Jetpack Compose on
  Android, SwiftUI on iPhone). A function marked `'widget'` is compiled into its own bundle and may only use its
  props, so the app passes everything already formatted (`features/expenses/widget.ts`).
- The `android/` and `ios/` folders are generated by `npx expo prebuild` from `app.json` and are not committed.

## Testing

- `src/core/utils/__tests__` and `src/features/expenses/__tests__`: pure logic, and real migrations and SQL on
  Node's built-in SQLite through a small adapter (`src/core/db/testing/nodeSqlite.ts`) that mimics the parts of
  the expo-sqlite API the app uses.
- `src/__tests__`: the whole `src/app` folder rendered with Expo Router's test renderer. Phone-only modules are
  replaced in `jest.setup.ts` (the database by the Node SQLite adapter, AES by Node's own AES-GCM, so encryption
  is tested for real). Queries ignore hidden elements, because tabs keep earlier screens mounted. Wait for things
  on screen rather than with asynchronous `waitFor` callbacks that query the database, which overlap React's
  `act()` under fake timers.
- `e2e/android/`: a small adb + UI Automator driver for checks on an emulator or phone.

In development, `useQuery` warns in the console about any query slower than 50 ms.

## iOS 26 header note

Native stack headers on iOS 26 are transparent by default. `Screen` sets
`contentInsetAdjustmentBehavior="automatic"` on its scroll view so content starts below the header; lists that
render their own `FlatList`/`SectionList` set the same prop.
