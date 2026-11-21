# LekhaWise

A private, offline money manager for Android and iPhone. Track spending and income, budgets, bills, loans,
savings goals, investments and net worth. Everything stays on the phone: no account, no server, no internet
connection, no ads, no tracking.

Built with React Native, Expo SDK 58, Expo Router and SQLite.

## Principles

| Goal | How it is met |
|---|---|
| Zero recurring infrastructure cost | No backend, database server, push service, analytics or crash-reporting service. The app talks to nothing. |
| Zero operational dependency | Nothing to keep running. Reminders are scheduled on the phone, receipt text is read on the phone, backups are files the user keeps. If every company involved disappeared tomorrow, installed copies keep working. |
| Minimum maintenance | First-party Expo modules almost everywhere (upgraded together with one command), no state library, no chart library, no ORM. Charts are plain views; SQL is plain SQL. Native folders are generated, not kept. |
| User owns the data | Backups are ordinary files (optionally password-protected) the user saves wherever they like and can restore on either platform. |

## Features

**Home**
- Total balance, this month's income, expenses, amount saved and savings rate.
- Insights: spending compared with the same days of last month, categories that grew, budgets heading over the
  limit at the current pace, savings rate.
- Upcoming and overdue bills, budget progress, where the money went, six-month trend, savings goals, net worth,
  recent entries, account balances.
- Choose which cards appear and in what order.
- A home-screen widget (installed app) with today's spending, the month so far and what is left of the budget.

**Transactions**
- Expenses, income and transfers; notes; date; tags; receipt photos (camera or gallery, stored on the phone).
- Split one payment across several categories.
- Split a bill with other people: your share is spending, the rest is tracked as money owed to you.
- Templates for entries you make often; copy an entry as a new one.
- Scan a receipt (installed app): the photo is read on the phone and the total, date and shop are filled in.
- Search across all months by note, category, account, tag or exact amount; filter by type, account, category and
  tag; daily totals; a calendar with each day's spending.
- Select several entries to delete them, move them to another category or account, or tag them.
- A warning before saving a likely duplicate, and a screen that finds duplicates.

**Accounts and categories**
- Cash, bank, credit card, wallet and other accounts; starting balance or debt; live balances.
- Reconcile an account against the balance your bank shows; the difference is recorded as an adjustment.
- Account statements for any period with a running balance, as a PDF.
- Default and custom categories with icons and colours, subcategories (reports add them into the main category),
  archiving instead of deleting.

**Budgets**
- Monthly or weekly; per category or for all spending.
- History: a changed amount applies from that period on, earlier periods keep theirs.
- Optional carry-forward of unspent money.
- Alerts at 80% and when exceeded.

**Recurring entries and bills**
- Daily, weekly, monthly or yearly; added automatically (missed ones are filled in) or kept as bills that wait to be
  marked paid with the actual amount.
- Reminders on the phone a chosen number of days before the due date; overdue bills on the home screen; payment
  history; pause, resume, skip, edit, end date.

**Reports**
- Month or financial year (April to March by default for rupees; any starting month).
- Comparison with the previous period and the same period a year ago, biggest changes per category, average,
  highest and lowest month, savings rate by month, income and expenses by category and tag.
- Tap any figure to see the entries behind it.
- PDF report for the period.

**Wealth**
- Loans and debts: money borrowed (with EMI worked out from rate and tenure, repayment schedule, interest split of
  each payment) and money lent; repayments move real account balances.
- Savings goals with target date, monthly amount needed, contributions or a linked account.
- Investments (stocks, mutual funds, gold, deposits, retirement funds, bonds, crypto) and assets (property,
  vehicles, jewellery), with values updated by hand and kept as history.
- Net worth now and for the last twelve months, worked out from the records.

**Your data**
- Backup and restore of everything including photos; optional password (AES-256); restore shows what the file
  contains first and is all-or-nothing; backups from older versions restore.
- Export to Excel (four sheets), CSV and PDF; save to the phone or share.
- Import bank statements and spreadsheets from CSV: columns are recognised, dates and amounts in common formats,
  likely duplicates are left out.

**Security and preferences**
- App lock with the phone's lock (fingerprint, face, passcode) or an app PIN (with optional fingerprint or face);
  lock again immediately or after 30 seconds, 1 or 5 minutes; the app-switcher preview is hidden.
- The database file on the phone is encrypted (SQLCipher, AES-256) in installed builds; the key is kept in the
  phone's secure storage.
- English and Hindi; date formats; number formats (Indian lakh and crore, international, European, spaced);
  first day of the week; light, dark or system theme; 39 currencies, including those without decimals (yen) or
  with three (Kuwaiti dinar).

## Two ways to run it

| | Expo Go | Installed app (development or release build) |
|---|---|---|
| Use | Quick changes while developing | Daily use, and testing everything |
| Database encryption | No (stays readable) | Yes |
| Receipt scanning | No (button hidden) | Yes |
| Home-screen widget | No | Yes |
| Everything else | Yes | Yes |

### Expo Go

Requirements: Node.js 22.5 or newer, and the Expo Go app on the phone.

```bash
npm install
npm start
```

Scan the QR code with the camera (iPhone) or the Expo Go app (Android). The phone and computer must be on the same
Wi-Fi network; if they are not, run `npx expo start --tunnel`.

### Installed app

```bash
npm run android      # builds, installs and starts the app on a connected Android phone or emulator
npm run ios          # the same for iPhone (needs a Mac with Xcode)
```

These generate the native `android/` and `ios/` folders from `app.json` (they are not committed) and need the
Android SDK or Xcode. A release APK can be built with `npx eas-cli@latest build -p android --profile preview`
(cloud, free tier) or locally:

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

On Windows, two limits of the native build tools apply:

- **No spaces in the path.** Copy the project to a short folder without spaces and run `npm install` there, for
  example:

  ```bat
  robocopy "D:\Open Source\offline-expense-manager" D:\w /MIR /XD node_modules .git "D:\Open Source\offline-expense-manager\android"
  ```

  Exclude the top-level `android` folder by its full path: a bare `/XD android` also skips
  `modules\receipt-ocr\android`, and the build then uses an old copy of that module. Mapping a drive letter with
  `subst` does not work: the tools resolve it back to the real path.
- **260-character path limit.** If long paths are not enabled in Windows (it needs administrator rights), the C++
  build of the native modules fails with "Filename longer than 260 characters". After `npx expo prebuild`, add a
  short staging folder to `android/app/build.gradle`, inside `android { }`:

  ```gradle
  externalNativeBuild { cmake { buildStagingDirectory = file("D:/c") } }
  ```

  Add `-PreactNativeArchitectures=x86_64` (emulator) or `arm64-v8a` (phone) to the Gradle command to build one
  architecture only, which is much faster.

### Testing on a real iPhone (free, no Mac)

The [iPhone sideload build](.github/workflows/iphone-sideload.yml) workflow builds the full app on a GitHub-hosted
Mac and publishes it as `LekhaWise.ipa` on the `iphone-latest` release. Start it from the Actions tab ("Run
workflow") or with `gh workflow run iphone-sideload.yml`; pushing a `v*` tag also runs it. To build it on a Mac
instead: `bash scripts/ios-sideload-build.sh`.

Install it with [AltStore](https://altstore.io) (open source) and a free Apple ID, from Windows:

1. Install **iTunes** and **iCloud** from apple.com (not the Microsoft Store versions), then **AltServer** for
   Windows from altstore.io.
2. Connect the iPhone by USB and trust the computer. In iTunes, tick "Sync with this iPhone over Wi-Fi".
3. Click the AltServer tray icon → Install AltStore → your iPhone, and sign in with your Apple ID.
4. On the iPhone: Settings → General → VPN & Device Management → trust your Apple ID; then Settings → Privacy &
   Security → Developer Mode → on (the phone restarts).
5. On the iPhone, open the `iphone-latest` release in Safari, download `LekhaWise.ipa`, and open it with AltStore
   (or AltStore → My Apps → +).

Limits of a free Apple ID: apps stop opening after 7 days until refreshed (data is kept; AltStore refreshes
automatically while AltServer is running on the same Wi-Fi), at most 3 sideloaded apps including AltStore, and no
push notifications (the app's reminders are local and still work). The sideloading app renames the app group the
widget reads, so the widget may show no data in this build. [SideStore](https://sidestore.io) (open source) is an
alternative that refreshes on the phone without a computer, after a one-time setup from the PC.

The [iPhone](.github/workflows/iphone.yml) workflow also runs every push to `main` in the iPhone simulator with
Maestro and attaches screenshots and the app log to the run.

## Checks

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint (Expo config)
npm test            # unit, database and screen tests
npm run i18n:check  # lists any text without a Hindi translation
npm run doctor      # Expo dependency health check
npm run check       # typecheck + lint + tests
```

What the tests cover:

| Suite | What it proves |
|---|---|
| `src/core/utils/__tests__` | Money (currencies with 0, 2 and 3 decimals, number formats), dates, weeks, financial years, CSV, Excel files, password encryption, app PIN, translations |
| `src/features/expenses/__tests__/schedule.test.ts` | Recurring dates, month ends, leap years, catch-up limits |
| `src/features/expenses/__tests__/math.test.ts` | Budget history and carry-forward, EMI and repayment schedules, insights, comparisons, net worth history |
| `src/features/expenses/__tests__/import.test.ts` | Bank statement CSV reading: columns, dates, amounts |
| `src/features/expenses/__tests__/receipt.test.ts`, `textRows.test.ts` | Reading the total, date and shop from receipt text; joining recognised pieces into printed rows |
| `src/features/expenses/__tests__/backupFormat.test.ts` | Backup validation, upgrading old backups, rejecting damaged files |
| `src/features/expenses/__tests__/repo.test.ts` | Real migrations (including from version 1 with data) and SQL on Node's built-in SQLite: balances, splits, subcategories, tags, budgets, bills, loans, goals, net worth, import, backup round trips, encrypted backups, currency changes |
| `src/features/expenses/__tests__/translations.test.ts` | Every text has a Hindi translation with the same placeholders |
| `src/__tests__/app.test.tsx`, `features.test.tsx` | The whole app rendered with real navigation and a real database, tapping through every feature |

Device testing on an Android emulator is described in [e2e/android/README.md](e2e/android/README.md).

## Build and publish

| Route | Cost | Notes |
|---|---|---|
| Android APK, shared directly or via GitHub Releases | Free | The [Android APK](.github/workflows/android-apk.yml) workflow (Actions tab → Run workflow, or `gh workflow run android-apk.yml`) publishes `LekhaWise.apk` on the `android-latest` release, signed with Expo's test key. Or EAS Build (cloud, free tier), or a local Gradle build. |
| Google Play Store | 25 USD once | One-time developer registration. |
| iPhone test build, sideloaded | Free | GitHub-hosted Mac build, installed with AltStore or SideStore and a free Apple ID; refreshed every 7 days. |
| Apple App Store / TestFlight | 99 USD per year | Apple's developer programme is the only unavoidable recurring cost, and only if you publish for iPhone. |
| Cloud builds (EAS Build) | Free tier | Limited number of builds per month on the free plan; enough for a hobby release cadence. Local builds are always free (iOS local builds need a Mac). |

Before the first store release, change `ios.bundleIdentifier` and `android.package` in `app.json` if
`com.lekhawise.app` is not yours to use, set a signing key for release builds, and replace the icons in `assets/`.

## Maintenance

Expect one routine task per year: upgrade Expo and rebuild, because both stores require apps to target recent
OS versions.

```bash
npx expo install expo@latest --fix
npm run check
```

Then rebuild and submit. Read the Expo upgrade notes for the SDK you are moving to. The libraries outside Expo's
own set are small: `fflate` (zip for Excel files), `@noble/hashes` (reading PIN and backups made by early
versions). Receipt reading is a small module in this repository (`modules/receipt-ocr`) on top of ML Kit
(Android) and Apple Vision (iPhone).

## Project structure

```
src/
  app/                    Screens. Every file is a route (Expo Router).
    (tabs)/               Home, Transactions, Budgets, Reports, More
    transaction/[id].tsx  Add / edit transaction (id "new" to add)
    account/, category/, budget/, recurring/, loans/, goals/, holding/, holdings/, statement/
    calendar, explore, networth, import, duplicates, tags, templates, backup, security, formats, ...
  core/                   App-agnostic building blocks, reusable in future apps
    crypto/               Password encryption for files
    db/                   Migration runner, useQuery hook, change events, test database
    files/                Save, share and pick files
    i18n/                 Translations and date/number format preferences
    lock/                 App lock: phone lock or app PIN
    settings/             Typed key-value settings
    theme/                Light and dark colours, navigation theme
    ui/                   Buttons, fields, cards, lists, pickers, period switcher, prompt
    utils/                Money, dates, CSV, Excel, ids
  features/expenses/      Everything specific to this app
    schema.ts             Database migrations
    repo*.ts              All SQL: transactions, budgets, loans, wealth, tags/templates/photos
    *Math.ts, insights.ts Pure calculations
    backup*.ts, exports.ts, importer.ts, csvImport.ts, receiptParser.ts
    encryption.ts, notifications.ts, attachments.ts, ocr.ts, widget.ts
    i18n/                 Translations (Hindi)
    components/           Charts, transaction row, money fields, category picker
  widgets/                Home-screen widget layouts (Android and iPhone)
modules/receipt-ocr/      On-device text recognition (Android and iPhone)
docs/
  ARCHITECTURE.md         How the pieces fit and how to change the schema safely
  ROADMAP.md              What was built in which phase, and what could come next
  NEW_APP.md              Starting the next app from this one
```

## Licence

MIT
