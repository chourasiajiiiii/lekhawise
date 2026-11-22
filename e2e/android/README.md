# Device testing on an Android emulator

Two tools:

- `run.sh` runs the [Maestro](https://maestro.mobile.dev) flows in `flows/` against the installed release app: the
  same ten feature areas as the iPhone flows in `e2e/ios/flows`, with Android's own photo picker, share sheet,
  folder and file pickers, screen lock and launcher.
- `driver.mjs` taps through the app step by step, using only `adb` and UI Automator from the Android SDK, for
  manual checks. It has no dependencies of its own.

## Automated flows (Maestro)

Setup on top of the one below: Maestro (unzip `maestro.zip` from its GitHub releases, e.g. to `D:\Android\maestro`)
and the release APK installed on a booted emulator (`adb install -r <apk>`). Then, in Git Bash:

```bash
export JAVA_HOME=D:/Android/jdk17 ANDROID_HOME=D:/Android/sdk MAESTRO=D:/Android/maestro/bin/maestro.bat
bash e2e/android/run.sh            # every flow, about 25 minutes
bash e2e/android/run.sh 02 07      # only flows whose names start with 02 or 07
```

Results (summary, screenshots per step, logcat) go to `e2e/android/results/`. The script makes the emulator screen
tall while it runs, because Android's UI tree only holds what is on screen; it sets the screen lock PIN to 1234 for
the phone-lock flow and removes it again. Differences from the iPhone flows: Android dialog buttons are in
capitals (`DELETE`, `REPLACE`), the keyboard is closed with Enter before tapping a button it covers, and backups
are saved through Android's folder picker into Documents.

## One-time setup (no Android Studio needed)

1. Java 17 or newer, and the Android command-line tools in a folder such as `D:\Android\sdk\cmdline-tools\latest`.
2. Install the emulator, platform tools and a system image:

   ```bash
   sdkmanager --sdk_root=D:\Android\sdk --licenses
   sdkmanager --sdk_root=D:\Android\sdk "platform-tools" "emulator" "system-images;android-35;google_apis;x86_64"
   avdmanager create avd -n lekhawise -k "system-images;android-35;google_apis;x86_64" -d pixel_7
   ```

3. Check hardware acceleration: `emulator -accel-check` should report WHPX (Windows) or KVM (Linux) as usable.

## Each session

```bash
emulator -avd lekhawise -no-snapshot -no-audio            # add -no-window to run headless
adb install Expo-Go-<version>.apk                          # once; `npx expo start --android` can also install it
adb reverse tcp:8081 tcp:8081
npx expo start --port 8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" host.exp.exponent
```

## Driving the app

```bash
node e2e/android/driver.mjs "tap:Add transaction" wait:Amount type:250 "tap:Food & dining" key:BACK \
  scroll:Save tap:Save shot:home-after-expense
```

Steps are listed at the top of `driver.mjs`. Quote any step that contains a space. Screenshots go to
`e2e/android/screenshots/` (ignored by git).

Useful device settings for checks:

| Check | Command |
|---|---|
| App lock with a passcode | `adb shell locksettings set-pin 1234`, then answer the prompt with `type:1234 key:ENTER` |
| Small phone, large text | `adb shell wm size 720x1280`, `adb shell wm density 320`, `adb shell settings put system font_scale 1.3` |
| Back to normal | `adb shell wm size reset`, `adb shell wm density reset`, `adb shell settings put system font_scale 1.0` |
| Large data | Generate a backup with thousands of transactions, `adb push` it to `/sdcard/Documents/`, restore it in the app |
| Gallery picture for receipt scanning | `adb push receipt.png /sdcard/Pictures/`, then `adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/receipt.png` |

Things that cost time:

- After a passcode is set, a freshly started emulator keeps its storage locked until the phone is unlocked once
  (`adb push` to `/sdcard` fails with "secure_mkdirs() failed"). Unlock it: `adb shell input text 1234`,
  `adb shell input keyevent ENTER`.
- In Git Bash, set `MSYS_NO_PATHCONV=1` before `adb` commands with device paths such as `/sdcard/...`, or they are
  rewritten into Windows paths. Unset it again for commands that take local paths like `/d/...`.
- Android dialog buttons are shown in capitals: `tap:CHOOSE FROM GALLERY`, not `tap:Choose from gallery`.
- Receipt reading on an emulator without a graphics card takes 5 to 10 seconds; add `pause:9000` before waiting
  for the result.

## Installed app on the emulator

Database encryption, receipt scanning and the widget need the installed app. Build it as described in the main
README, then:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.lekhawise.app/.MainActivity
```

To add the widget: long-press the home screen, Widgets, LekhaWise, tap the preview, Add.

Android blocks screenshots of its own passcode screen and, while the app lock is on, of the app itself. Those
screenshots come out black by design; read the screen with the `texts` step instead.

## Checklist covered on 2026-11-21, first phase (Android 15 emulator, Expo Go 58)

- Add, edit and delete expense, income and transfer; native date dialog; notes; repeat options
- Home totals, savings rate, category breakdown, 6-month chart, recent list, account balances
- Transactions: search (text and amount, across months), type, account and category filters, day totals
- Budgets: set, change, remove; progress colours; keyboard opens in the budget dialog
- Categories and accounts: create, edit, delete unused, archive used, credit card with opening debt
- Recurring: backdated monthly rule creates the missed entries once; pause and resume
- Currency change, dark theme, data kept after the app is closed and reopened
- App lock: turning on and off needs the device passcode, relock after 30 s, blank app-switcher preview
- Backup saved to Documents on the phone, shared through the share sheet, restored through the file picker, CSV saved
- 5,000-transaction backup restored and browsed; small screen with 130% text

## Checklist covered on 2026-11-21, all phases (Android 15 emulator)

In Expo Go:

- Upgrade of a version 1 database with 5,000 entries to version 2
- Split payment, tags, receipt photo from the camera; calendar
- Reports for a financial year; PDF report (41 pages) saved; Excel file with four sheets opened in Excel
- Encrypted backup saved, restored, and decrypted independently of the app
- Loan of 5,00,000 at 9.5% over 60 months: EMI 10,500.93; repayment split into principal and interest
- App PIN, relock after 30 s, hidden app-switcher preview; Hindi; small screen
- Bill reminder scheduled for 9 am and delivered; CSV bank statement imported; net worth
- No errors in the log; receipt scanning hidden

Release build (installed app):

- Existing unencrypted database converted to SQLCipher on first launch; the file no longer opens as plain SQLite
  and contains no readable text; data intact on later launches
- Receipt scanning from the gallery: total 871.50 (not the subtotal), date and shop name filled in, photo
  attached, entry saved and found by search
- Widget added to the home screen: spent today, month total and budget left match the app, and all three update
  as soon as an entry is saved
- Savings goal with a target date (monthly amount needed worked out), money added
- Investment with a gain, value updated, history kept; net worth equals accounts plus investments minus loans
- Template saved and used; duplicate warning on save; duplicates screen; bulk move to another category after a
  search (only entries on screen are changed)
- Weekly overall budget with carry-forward and an alert when exceeded
- Reconciliation with an adjustment entry; statement for the month with running balance; statement PDF saved
  with every entry
- Bill split equally with two people: own share counted as spending, the others listed as money owed
- Home cards hidden and reordered; Indian number format and day-first dates
- With 5,000 entries: duplicates screen, reports for a financial year and drill-down into a category each open in
  well under a second (measured on the emulator without a graphics card, driver time subtracted)

Not covered: iPhone (needs a Mac), and receipts photographed with a real camera.
