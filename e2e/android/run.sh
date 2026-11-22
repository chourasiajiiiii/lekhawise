#!/usr/bin/env bash
# Runs every Maestro flow in e2e/android/flows against the installed release app on an Android emulator
# (Android 15, see README.md here), and saves screenshots and logs in e2e/android/results.
#
#   bash e2e/android/run.sh            # every flow
#   bash e2e/android/run.sh 02 07      # only flows whose names start with 02 or 07
#
# Needs: the release APK installed (adb install -r ...), Maestro (MAESTRO, default "maestro"), Java 17
# (JAVA_HOME), ANDROID_HOME (default D:\Android\sdk).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/results"
SDK="${ANDROID_HOME:-D:/Android/sdk}"
ADB="$SDK/platform-tools/adb"
MAESTRO="${MAESTRO:-maestro}"
export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true MSYS_NO_PATHCONV=1
ONLY=("$@")
PIN=1234
FAILURES=0

wanted() {
  [ ${#ONLY[@]} -eq 0 ] && return 0
  for prefix in "${ONLY[@]}"; do [[ "$1" == "$prefix"* ]] && return 0; done
  return 1
}

rm -rf "$OUT"
mkdir -p "$OUT"
SUMMARY="$OUT/summary.md"
echo "# Android emulator results" > "$SUMMARY"
echo "" >> "$SUMMARY"
echo "Device: $("$ADB" shell getprop ro.product.model | tr -d '\r'), Android $("$ADB" shell getprop ro.build.version.release | tr -d '\r')" >> "$SUMMARY"
echo "App: $("$ADB" shell dumpsys package com.lekhawise.app | grep -m1 versionName | tr -d ' \r')" >> "$SUMMARY"
echo "" >> "$SUMMARY"

# A tall screen: Android's UI tree only holds what is on screen, so most of each form fits without scrolling.
"$ADB" shell wm size 1080x4000
"$ADB" shell locksettings clear --old "$PIN" > /dev/null 2>&1 || true
"$ADB" logcat -c

for flow in "$HERE"/flows/[0-9]*.yaml; do
  name=$(basename "$flow" .yaml)
  wanted "$name" || continue
  # The phone lock flow needs a screen lock on the device; the widget flow needs the real launcher size.
  [[ "$name" == 09-* ]] && "$ADB" shell locksettings set-pin "$PIN" > /dev/null
  [[ "$name" == 10-* ]] && "$ADB" shell wm size reset
  started=$SECONDS
  # Windows paths for Maestro under Git Bash (MSYS_NO_PATHCONV, needed for adb's device paths, stops conversion).
  flow_arg=$(cygpath -w "$flow" 2> /dev/null || echo "$flow")
  out_arg=$(cygpath -w "$OUT/$name" 2> /dev/null || echo "$OUT/$name")
  if "$MAESTRO" test "$flow_arg" --test-output-dir "$out_arg" > "$OUT/$name.log" 2>&1; then
    echo "- PASS $name ($((SECONDS - started)) s)" | tee -a "$SUMMARY"
  else
    echo "- FAIL $name ($((SECONDS - started)) s): $(grep -m1 -E 'FAILED|Assertion is false|not found' "$OUT/$name.log")" | tee -a "$SUMMARY"
    FAILURES=$((FAILURES + 1))
  fi
  [[ "$name" == 09-* ]] && "$ADB" shell locksettings clear --old "$PIN" > /dev/null
  [[ "$name" == 10-* ]] && "$ADB" shell wm size 1080x4000
done

"$ADB" shell wm size reset
"$ADB" logcat -d > "$OUT/logcat.txt"
if grep -E 'FATAL EXCEPTION|ReactNativeJS.*(Error|Exception)' "$OUT/logcat.txt" | grep -q .; then
  echo "- FAIL errors in the app log (see logcat.txt)" | tee -a "$SUMMARY"
  FAILURES=$((FAILURES + 1))
else
  echo "- PASS no crashes or JavaScript errors in the app log" | tee -a "$SUMMARY"
fi
echo "" >> "$SUMMARY"
echo "Failures: $FAILURES" | tee -a "$SUMMARY"
[ "$FAILURES" -eq 0 ]
