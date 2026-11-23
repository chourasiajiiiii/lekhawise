#!/usr/bin/env bash
# Screenshot tour: opens every main screen through its link and saves a screenshot, for checking layouts by eye.
#   bash e2e/android/tour.sh <name>      # screenshots go to e2e/android/tour/<name>/
# Set the screen size, density, font scale or language before running it.
set -uo pipefail
export MSYS_NO_PATHCONV=1
SDK="${ANDROID_HOME:-D:/Android/sdk}"
ADB="$SDK/platform-tools/adb"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/tour/$1"
rm -rf "$OUT"; mkdir -p "$OUT"

"$ADB" shell am force-stop com.lekhawise.app
"$ADB" shell monkey -p com.lekhawise.app -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1
sleep 8
for path in "" transactions budgets reports settings transaction/new accounts categories loans loans/new goals networth \
  calendar explore backup security formats recurring currency language notifications tags templates import duplicates home-layout; do
  "$ADB" shell am start -a android.intent.action.VIEW -d "lekhawise://$path" com.lekhawise.app > /dev/null 2>&1
  sleep 4
  name="${path:-home}"
  "$ADB" exec-out screencap -p > "$OUT/${name//\//-}.png"
done
"$ADB" logcat -d | grep -E 'FATAL EXCEPTION|ReactNativeJS.*(Error|Exception)' > "$OUT/errors.txt"
echo "tour $1: $(ls "$OUT"/*.png | wc -l) screens, $(wc -l < "$OUT/errors.txt") error lines"
