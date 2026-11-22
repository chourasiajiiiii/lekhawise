#!/usr/bin/env bash
# Runs LekhaWise in the iPhone simulator (macOS with Xcode and Maestro): installs the app, taps through every
# flow in e2e/ios/flows, checks the files the app leaves on the phone, and saves screenshots, screen trees and
# the app log in e2e/ios/results.
#
#   bash e2e/ios/run.sh build/LekhaWise.app            # every flow
#   bash e2e/ios/run.sh build/LekhaWise.app 02 07      # only flows whose names start with 02 or 07
set -uo pipefail

APP="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
shift
ONLY=("$@")
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/results"
BUNDLE=com.lekhawise.app
GROUP=group.com.lekhawise.app
rm -rf "$OUT/flows" "$OUT/screens" "$OUT/hierarchy" "$OUT"/*.md "$OUT"/*.txt "$OUT"/*.log # keeps build/
mkdir -p "$OUT/flows" "$OUT/screens" "$OUT/hierarchy"
SUMMARY="$OUT/summary.md"
FAILURES=0

note() { echo "$*" | tee -a "$SUMMARY"; }
pass() { note "- PASS $*"; }
fail() { note "- FAIL $*"; FAILURES=$((FAILURES + 1)); }
wanted() {
  [ ${#ONLY[@]} -eq 0 ] && return 0
  for prefix in "${ONLY[@]}"; do [[ "$1" == "$prefix"* ]] && return 0; done
  return 1
}

# ------------------------------------------------------------------ simulator
# The newest iPhone (not SE) on the newest iOS runtime installed.
UDID=$(xcrun simctl list devices available -j | node -e '
  const { devices } = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const version = (key) => (key.match(/iOS-(\d+)-(\d+)/) || []).slice(1).map(Number);
  const runtimes = Object.keys(devices).filter((k) => k.includes("iOS")).sort((a, b) => {
    const [a1, a2] = version(a), [b1, b2] = version(b);
    return b1 - a1 || b2 - a2;
  });
  for (const runtime of runtimes) {
    const phones = devices[runtime].filter((d) => /^iPhone \d+/.test(d.name) && !/SE/.test(d.name));
    phones.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    const pick = phones.find((d) => / Pro$/.test(d.name)) || phones[0];
    if (pick) { console.log(pick.udid); process.exit(0); }
  }
  process.exit(1);')
if [ -z "$UDID" ]; then echo "No iPhone simulator found"; exit 1; fi
xcrun simctl list devices | grep "$UDID" | tee "$OUT/device.txt"
note "# iPhone simulator results"
note ""
note "Device: $(sed -E 's/^ +//' "$OUT/device.txt")"
note "Xcode: $(xcodebuild -version | tr '\n' ' ')"
note "Maestro: $(maestro --version 2>/dev/null | tail -1)"
note ""

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
# Face ID enrolled, so "Phone lock" can be tested (each prompt is answered by the matcher below).
xcrun simctl spawn "$UDID" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
xcrun simctl spawn "$UDID" notifyutil -p com.apple.BiometricKit.enrollmentChanged

xcrun simctl install "$UDID" "$APP"
xcrun simctl spawn "$UDID" log stream --level debug --style compact \
  --predicate 'process == "LekhaWise" OR process == "ExpoWidgetsTarget"' > "$OUT/app.log" 2>&1 &
LOGGER=$!

# ------------------------------------------------------------------ helpers
run_flow() {
  local file="$1" name
  name=$(basename "$file" .yaml)
  wanted "$name" || return 0
  local dir="$OUT/flows/$name"
  mkdir -p "$dir"
  local started=$SECONDS
  if (cd "$dir" && maestro --device "$UDID" test "$file" --format junit --output "$dir/report.xml" \
      --test-output-dir "$dir" --debug-output "$dir/debug" > "$dir/maestro.txt" 2>&1); then
    pass "flow $name ($((SECONDS - started)) s)"
  else
    fail "flow $name ($((SECONDS - started)) s): $(grep -E 'FAILED|Element not found|Assertion is false|not found' "$dir/maestro.txt" | head -3 | tr '\n' ' ')"
    # What was on screen when it failed (a row is one element on iOS, so this shows the full labels to match).
    maestro --device "$UDID" hierarchy > "$dir/failure-hierarchy.json" 2> /dev/null
  fi
  find "$dir" -name '*.png' -exec cp {} "$OUT/screens/" \; 2>/dev/null
}

dump_screen() {
  local name="$1"
  maestro --device "$UDID" hierarchy > "$OUT/hierarchy/$name.json" 2> /dev/null
  xcrun simctl io "$UDID" screenshot "$OUT/screens/screen-$name.png" > /dev/null 2>&1
}

open_screen() {
  xcrun simctl openurl "$UDID" "lekhawise://$1"
  sleep 3
}

# What the app leaves on the phone: the database must be encrypted, and the widget's data must be current.
device_checks() {
  wanted "device" || return 0
  note ""
  note "## Files on the phone"
  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null
  sleep 2
  local data db group plist
  data=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)
  find "$data" -type f \( -name '*.db*' -o -name '*.sqlite*' \) -exec ls -l {} \; > "$OUT/database-files.txt"
  db=$(find "$data" -type f -name '*.db' | head -1)
  if [ -z "$db" ]; then
    fail "no database file found"
  else
    if [ "$(head -c 15 "$db")" = "SQLite format 3" ]; then fail "database is NOT encrypted ($db)"; else pass "database file is encrypted (no SQLite header)"; fi
    if cat "$db"* 2>/dev/null | LC_ALL=C grep -q -a "Streaming"; then fail "a note typed in the app is readable in the database files"; else pass "no readable text from the entries in the database files"; fi
  fi
  group=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" "$GROUP" 2>/dev/null)
  plist="$group/Library/Preferences/$GROUP.plist"
  if [ -f "$plist" ]; then
    plutil -p "$plist" > "$OUT/widget-data.txt" 2>&1
    if grep -q 'Spent today' "$OUT/widget-data.txt" && grep -q '1,115.00' "$OUT/widget-data.txt"; then
      pass "widget data in the shared app group is current (spent today \$1,115.00)"
    else
      fail "widget data is not current (see widget-data.txt)"
    fi
    if grep -q '100.00 over budget' "$OUT/widget-data.txt"; then pass "widget budget line: \$100.00 over budget"; else fail "widget budget line wrong (see widget-data.txt)"; fi
  else
    ls -R "$group" > "$OUT/widget-data.txt" 2>&1
    fail "no widget data in the app group container ($plist)"
  fi
}

# ------------------------------------------------------------------ flows
note "## Flows"
F="$HERE/flows"
run_flow "$F/01-entries.yaml"
run_flow "$F/02-receipt-scan.yaml"
run_flow "$F/03-receipt-rotated.yaml"
run_flow "$F/04-budgets-recurring.yaml"
device_checks
note ""
note "## Flows (continued)"
run_flow "$F/10-widget.yaml"
run_flow "$F/05-wealth.yaml"
run_flow "$F/06-form-extras.yaml"
run_flow "$F/07-reports-backup.yaml"

# Screen trees and screenshots of the main screens (with the data from 07), for checking layouts and labels.
if wanted "screens"; then
  xcrun simctl launch "$UDID" "$BUNDLE" > /dev/null; sleep 4
  for path in "" transactions budgets reports settings transaction/new accounts categories loans goals networth calendar explore backup security formats; do
    open_screen "$path"
    name="${path:-home}"
    dump_screen "${name//\//-}"
  done
  # Largest accessibility text size
  xcrun simctl ui "$UDID" content_size accessibility-extra-extra-extra-large
  for path in "" transaction/new budgets; do open_screen "$path"; xcrun simctl io "$UDID" screenshot "$OUT/screens/large-text-${path//\//-}.png" > /dev/null 2>&1; done
  xcrun simctl ui "$UDID" content_size large
fi

run_flow "$F/08-preferences-pin.yaml"
# Face ID: answer every prompt with a matching face while the phone-lock flow runs.
( while true; do xcrun simctl spawn "$UDID" notifyutil -p com.apple.BiometricKit_Sim.pearl.match > /dev/null 2>&1; sleep 2; done ) &
MATCHER=$!
run_flow "$F/09-phone-lock.yaml"
kill $MATCHER 2>/dev/null

# ------------------------------------------------------------------ app log
kill $LOGGER 2>/dev/null
note ""
note "## App log"
ERRORS=$(grep -E -i 'Unhandled JS Exception|RCTFatal|TypeError|ReferenceError|Invariant Violation|\[error\]|EXC_|SIGABRT' "$OUT/app.log" | grep -v -i 'nw_\|CoreData\|LaunchServices' | head -40)
if [ -n "$ERRORS" ]; then
  fail "errors in the app log:"
  echo '```' >> "$SUMMARY"; echo "$ERRORS" >> "$SUMMARY"; echo '```' >> "$SUMMARY"
else
  pass "no JavaScript errors or crashes in the app log"
fi
CRASHES=$(ls ~/Library/Logs/DiagnosticReports 2>/dev/null | grep -i lekhawise)
if [ -n "$CRASHES" ]; then fail "crash reports: $CRASHES"; cp ~/Library/Logs/DiagnosticReports/*LekhaWise* "$OUT/" 2>/dev/null; fi

note ""
note "Failures: $FAILURES"
[ "$FAILURES" -eq 0 ]
