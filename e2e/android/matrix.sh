#!/usr/bin/env bash
# Runs the whole Android suite on one emulator per Android version, one after another.
#   bash e2e/android/matrix.sh 24 26 28 ...      # API levels (default: 24 26 28 29 30 31 33 34 35 36)
# Results: e2e/android/matrix/api<N>/ (the run.sh results) and e2e/android/matrix/summary.md
set -uo pipefail
export MSYS_NO_PATHCONV=1
SDK="${ANDROID_HOME:-D:/Android/sdk}"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator.exe"
AVDM="$SDK/cmdline-tools/latest/bin/avdmanager.bat"
HERE="$(cd "$(dirname "$0")" && pwd)"
APK="${APK:-D:/lw/android/app/build/outputs/apk/release/app-release.apk}"
LEVELS=("$@"); [ ${#LEVELS[@]} -eq 0 ] && LEVELS=(24 26 28 29 30 31 33 34 35 36)
MATRIX="$HERE/matrix"; mkdir -p "$MATRIX"
SUMMARY="$MATRIX/summary.md"
[ -f "$SUMMARY" ] || printf '# Android version matrix\n\n' > "$SUMMARY"

for api in "${LEVELS[@]}"; do
  name="lw-api$api"
  [ "$api" = 35 ] && name=lekhawise
  if ! "$EMU" -list-avds | tr -d '\r' | grep -qx "$name"; then
    echo no | "$AVDM" create avd -n "$name" -k "system-images;android-$api;google_apis;x86_64" -d pixel_4 --force > /dev/null 2>&1
  fi
  echo "== API $api: booting $name"
  "$EMU" -avd "$name" -no-window -no-snapshot -no-audio -no-boot-anim -memory 3072 -wipe-data > "$MATRIX/emulator-api$api.log" 2>&1 &
  started=$SECONDS
  "$ADB" wait-for-device
  until [ "$("$ADB" shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = "1" ]; do
    sleep 10
    if [ $((SECONDS - started)) -gt 2400 ]; then echo "API $api did not boot in 40 min"; break; fi
  done
  if [ "$("$ADB" shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" != "1" ]; then
    echo "- API $api: FAIL emulator did not boot" | tee -a "$SUMMARY"
    "$ADB" emu kill > /dev/null 2>&1; sleep 20; continue
  fi
  sleep 30 # let the launcher and system apps settle
  release=$("$ADB" shell getprop ro.build.version.release | tr -d '\r')
  echo "== API $api (Android $release) booted in $((SECONDS - started)) s; installing"
  "$ADB" shell settings put global window_animation_scale 0
  "$ADB" shell settings put global transition_animation_scale 0
  "$ADB" shell settings put global animator_duration_scale 0
  if ! "$ADB" install -r "$APK" | grep -q Success; then
    echo "- API $api (Android $release): FAIL could not install the APK" | tee -a "$SUMMARY"
  else
    bash "$HERE/run.sh" > "$MATRIX/run-api$api.txt" 2>&1
    rm -rf "$MATRIX/api$api"; cp -r "$HERE/results" "$MATRIX/api$api"
    failed=$(grep -c "^- FAIL" "$HERE/results/summary.md")
    echo "- API $api (Android $release): $((10 - $(grep -c '^- FAIL [0-9]' "$HERE/results/summary.md"))) of 10 flows pass, $failed failures" | tee -a "$SUMMARY"
    grep "^- FAIL" "$HERE/results/summary.md" | sed 's/^/    /' | tee -a "$SUMMARY"
  fi
  "$ADB" emu kill > /dev/null 2>&1
  sleep 20
done
echo "matrix done"
