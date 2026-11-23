#!/usr/bin/env bash
# Low-memory checks: the app is killed in the background (as Android does when memory runs out) and reopened,
# and then used with "Don't keep activities" on (every screen is destroyed when the app leaves the foreground).
# Saved data must survive, and nothing may crash. Screenshots go to e2e/android/tour/lowmem/.
set -uo pipefail
export MSYS_NO_PATHCONV=1
SDK="${ANDROID_HOME:-D:/Android/sdk}"
ADB="$SDK/platform-tools/adb"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/tour/lowmem"
rm -rf "$OUT"; mkdir -p "$OUT"
APP=com.lekhawise.app
shot() { "$ADB" exec-out screencap -p > "$OUT/$1.png"; }
open() { "$ADB" shell am start -a android.intent.action.VIEW -d "lekhawise://$1" "$APP" > /dev/null 2>&1; sleep 4; }
entries() { "$ADB" shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1; "$ADB" shell cat /sdcard/ui.xml | grep -o '[0-9]* entr[a-z]*' | head -1; }
"$ADB" logcat -c

# 1. Killed in the background while a new entry is half typed
"$ADB" shell monkey -p "$APP" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1; sleep 8
open transactions; BEFORE=$(entries); shot 1-before
open transaction/new; "$ADB" shell input text 77; sleep 1; shot 2-typing
"$ADB" shell input keyevent KEYCODE_HOME; sleep 2
"$ADB" shell am kill "$APP"; sleep 2
echo "process after kill: $("$ADB" shell pidof "$APP" || echo none)"
"$ADB" shell monkey -p "$APP" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1; sleep 8; shot 3-reopened
open transactions; AFTER=$(entries); shot 4-after
echo "entries before: ${BEFORE:-?}, after kill and reopen: ${AFTER:-?}"

# 2. Don't keep activities: leave and come back several times, on a few screens
"$ADB" shell settings put global always_finish_activities 1
for path in "" transactions reports transaction/new backup; do
  open "$path"; "$ADB" shell input keyevent KEYCODE_HOME; sleep 2
  "$ADB" shell monkey -p "$APP" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1; sleep 5
done
shot 5-dont-keep-activities
open transactions; echo "entries with don't-keep-activities: $(entries)"
"$ADB" shell settings put global always_finish_activities 0

# 3. Memory pressure signals while open
open ""; for level in RUNNING_LOW RUNNING_CRITICAL; do "$ADB" shell am send-trim-memory "$APP" "$level"; sleep 2; done; shot 6-trim-memory

"$ADB" logcat -d | grep -E 'FATAL EXCEPTION|ANR in|ReactNativeJS.*(Error|Exception)' > "$OUT/errors.txt"
echo "error lines: $(wc -l < "$OUT/errors.txt")"
