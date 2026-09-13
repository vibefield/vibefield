#!/bin/bash
# Uses Xcode's Apple account and Keychain; no passwords or API keys in the repo.
set -euo pipefail

ios_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
action="${1:-help}"

usage() {
  cat <<'USAGE'
Usage: bash apps/ios/scripts/testflight.sh <archive|upload> BUILD_NUMBER

  archive 1   Build a signed Release archive for a physical iPhone/iPad.
  upload 1    Upload that archive to internal TestFlight using Xcode's account.

Archives and logs are in apps/ios/build/testflight/. Choose a new build number
for each archive. Xcode also manages the uploaded build number to avoid clashes
with previous uploads. Sign in to Xcode > Settings > Apple Accounts first.

Set DEVELOPER_DIR to use an Xcode installation other than /Applications/Xcode.app.
USAGE
}

case "$action" in
  help|-h|--help) usage; exit 0 ;;
  archive|upload) ;;
  *) usage >&2; exit 2 ;;
esac

if [[ $# -ne 2 || ! "$2" =~ ^[1-9][0-9]{0,3}(\.[0-9]{1,2}){0,2}$ ]]; then
  echo "Supply a build number such as 1, 2, or 1.0.1 (at most 4.2.2 digits)." >&2
  exit 2
fi

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
if [[ ! -x "$DEVELOPER_DIR/usr/bin/xcodebuild" ]]; then
  echo "Full Xcode is required. Set DEVELOPER_DIR to its Contents/Developer directory." >&2
  exit 1
fi

build_number="$2"
output="$ios_root/build/testflight"
archive="$output/VibeField-$build_number.xcarchive"
mkdir -p "$output"

case "$action" in
  archive)
    if [[ -e "$archive" ]]; then
      echo "Archive already exists: $archive. Choose a new build number." >&2
      exit 1
    fi
    # Respect the committed lockfile; dependency upgrades are a separate action.
    # Ghosttea's pinned Metal build plugin requires this existing CLI trust flag.
    swift_flags='$(inherited)'
    if [[ "$(xcodebuild -version)" == *"Build version 17F113"* ]]; then
      # Swift 6.3.3 crashes in LoadableByAddress when optimizing GhostteaTruffle.
      # Disable only its reg2mem transform; keep -O, WMO, and the public ABI.
      # Scope this workaround to the Xcode build it was verified against.
      swift_flags+=' -Xfrontend -disable-large-loadable-types-reg2mem'
      echo "Applying the Xcode 26.6 (17F113) Swift compiler workaround."
    fi
    xcodebuild -project "$ios_root/VibeField.xcodeproj" -scheme VibeField \
      -configuration Release -destination 'generic/platform=iOS' \
      -archivePath "$archive" \
      -onlyUsePackageVersionsFromResolvedFile \
      -skipPackagePluginValidation -allowProvisioningUpdates \
      "CURRENT_PROJECT_VERSION=$build_number" "OTHER_SWIFT_FLAGS=$swift_flags" archive \
      2>&1 | tee "$output/archive-$build_number.log"
    echo "Archive ready: $archive"
    echo "Upload: bash $ios_root/scripts/testflight.sh upload $build_number"
    ;;
  upload)
    if [[ ! -f "$archive/Info.plist" ]]; then
      echo "Archive missing: run 'bash $ios_root/scripts/testflight.sh archive $build_number'." >&2
      exit 1
    fi
    # Verify the identity before sending an archive to the configured Apple team.
    archive_id=$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleIdentifier' "$archive/Info.plist")
    archive_team=$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:Team' "$archive/Info.plist")
    if [[ "$archive_id" != com.jamesyong.vibefield.ios || "$archive_team" != 9F79X9D26S ]]; then
      echo "The archive's bundle ID or signing team does not match VibeField." >&2
      exit 1
    fi
    xcodebuild -exportArchive -archivePath "$archive" \
      -exportPath "$output/upload-$build_number" \
      -exportOptionsPlist "$ios_root/ExportOptions.plist" \
      -allowProvisioningUpdates \
      2>&1 | tee "$output/upload-$build_number.log"
    echo "Upload completed. Check processing and export compliance in App Store Connect > TestFlight."
    ;;
esac
