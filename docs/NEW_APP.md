# Starting the next app from LekhaWise

LekhaWise is split into `src/core` (nothing app-specific) and `src/features/expenses` (everything about money).
The next offline app reuses `core` unchanged.

## What you get for free

| Folder | Provides |
|---|---|
| `core/db` | Versioned migrations (with safe table rebuilds), `useQuery()` that refreshes on every write and says when its data is stale, and an in-memory test database |
| `core/settings` | Typed, synchronous settings with a React hook |
| `core/i18n` | `t()` translations keyed by the English text, plural helper, date and number format preferences |
| `core/theme` | Light and dark palettes, system/light/dark preference, navigation theming |
| `core/ui` | Screen, cards, buttons, text fields, segmented control, chips, list rows, switches, progress bar, empty state, prompt dialog, pick-from-list sheet, date field, month and period switchers, floating add button, "show more" paging for long lists |
| `core/lock` | App lock with the phone's lock or an app PIN, relock timer, hidden app-switcher preview |
| `core/crypto` | Password encryption for files (AES-256-GCM with an RFC 4880 key) |
| `core/files` | Save a file to a folder on the phone, share it, pick a file (text or binary) |
| `core/utils` | Integer money in any currency, local dates, weeks, financial years, recurring date maths, CSV reading and writing, Excel workbooks, ids |

Also reusable with small changes: `scripts/translatable-strings.mjs` (finds untranslated text),
`features/expenses/encryption.ts` (encrypted database on the phone), `features/expenses/notifications.ts`
(local reminders), `modules/receipt-ocr` (on-device text recognition) and `e2e/android/driver.mjs`.

## Steps

1. Copy the repository to a new folder (or, on GitHub, mark this repository as a template and use
   "Use this template").
2. Delete `src/features/expenses`, the screens in `src/app` except `_layout.tsx` and `(tabs)/_layout.tsx`, and the
   expense tests.
3. In `app.json` change `name`, `slug`, `scheme`, `ios.bundleIdentifier`, `android.package`; in `package.json`
   change `name`. Replace the icons in `assets/`.
4. Create `src/features/<your-app>/schema.ts` with a `MIGRATIONS` array and an `initDatabase()` that calls
   `migrate(db, MIGRATIONS)`.
5. In `src/app/_layout.tsx`, point the database at the new name and `initDatabase`, and list the new screens.
   Remove or replace the widget (`src/widgets`, the `expo-widgets` entry in `app.json`) and receipt scanning if
   the new app does not need them.
6. Write the feature's `repo.ts` (all SQL), screens in `src/app`, and backup format (copy `backupFormat.ts` and
   change the app id and tables).
7. Run `npm install` then `npm run check`.

## When to share `core` instead of copying it

Copying is the lowest-maintenance option for the first two or three apps: each app upgrades on its own schedule and
nothing breaks another app. Once three or more apps are maintained at the same time and the same fix keeps being
made in each, move `core` into a shared package (a small monorepo with npm workspaces, or a private package) and
depend on it. Doing that earlier adds tooling to maintain without saving much work.

## Ideas that fit the same template

Habit tracker, journal, inventory or stock register for a small shop, vehicle service log, medicine reminder,
study planner, recipe book, private notes. Anything whose data belongs to one person on one phone.
