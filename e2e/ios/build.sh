#!/usr/bin/env bash
# Builds the release app for the iPhone simulator (macOS with Xcode). No Apple account is needed: simulator
# builds are signed locally ("Sign to Run Locally"), which keeps the app group the widget shares data through.
# Result: build/LekhaWise.app
set -euo pipefail
cd "$(dirname "$0")/../.."
export CI=1
mkdir -p build e2e/ios/results/build
xcodebuild -version

npx expo prebuild --platform ios --clean

WORKSPACE=$(ls -d ios/*.xcworkspace | head -1)
SCHEME=$(basename "$WORKSPACE" .xcworkspace)
started=$SECONDS
if ! xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build/derived \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO COMPILER_INDEX_STORE_ENABLE=NO \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES \
  build > e2e/ios/results/build/xcodebuild.log 2>&1; then
  grep -E 'error:|BUILD FAILED|The following build commands failed' -A4 e2e/ios/results/build/xcodebuild.log | head -150
  tail -40 e2e/ios/results/build/xcodebuild.log
  exit 1
fi
echo "Built in $((SECONDS - started)) s"
grep -E 'warning: .*(ReceiptOcr|ExpoWidgets)' e2e/ios/results/build/xcodebuild.log | head -20 || true

rm -rf build/LekhaWise.app
cp -R "build/derived/Build/Products/Release-iphonesimulator/$SCHEME.app" build/LekhaWise.app
# The widget extension and its entitlements must be inside the app.
ls build/LekhaWise.app/PlugIns
codesign -d --entitlements - build/LekhaWise.app 2>&1 | tee e2e/ios/results/build/app-entitlements.txt
codesign -d --entitlements - build/LekhaWise.app/PlugIns/*.appex 2>&1 | tee e2e/ios/results/build/widget-entitlements.txt
