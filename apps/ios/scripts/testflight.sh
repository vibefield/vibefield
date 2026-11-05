#!/bin/bash
# No passwords or API keys live in the repo. Signing and upload authenticate with an
# App Store Connect API key named by environment variables (below), or, when asked
# explicitly, with Xcode's own Apple account and Keychain.
set -euo pipefail

ios_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
action="${1:-help}"

usage() {
  cat <<'USAGE'
Usage: bash apps/ios/scripts/testflight.sh archive BUILD_NUMBER
       bash apps/ios/scripts/testflight.sh upload BUILD_NUMBER [internal|store]

  archive 6          Build a signed Release archive for a physical iPhone/iPad.
  upload 6           Upload that archive for internal TestFlight only
                     (ExportOptions.plist: testFlightInternalTestingOnly).
  upload 6 store     Upload it for the App Store and external TestFlight
                     (ExportOptions-AppStore.plist). Same archive, other export.

Authentication (both archive and upload): an App Store Connect API key, from
  ASC_KEY_PATH    the AuthKey_<KEY ID>.p8 file, kept OUTSIDE this repository
  ASC_KEY_ID      the key's ID
  ASC_ISSUER_ID   the team's issuer ID (App Store Connect > Users and Access >
                  Integrations > App Store Connect API)
They are passed to xcodebuild as -authenticationKeyPath / -authenticationKeyID /
-authenticationKeyIssuerID with -allowProvisioningUpdates, and never printed.
Without them, `archive` uses Xcode's signed-in account; `upload` refuses, since
xcodebuild's account lookup is what failed as "Failed to Use Accounts" for builds
2-4. ASC_AUTH=xcode makes `upload` try Xcode's account anyway.

Archives and logs are in apps/ios/build/testflight/. Choose a new build number
for each archive: an existing archive is never overwritten. Xcode also manages
the uploaded build number to avoid clashes with previous uploads.

Set DEVELOPER_DIR to use an Xcode installation other than /Applications/Xcode.app.
USAGE
}

case "$action" in
  help|-h|--help) usage; exit 0 ;;
  archive|upload) ;;
  *) usage >&2; exit 2 ;;
esac

if [[ $# -lt 2 || ! "$2" =~ ^[1-9][0-9]{0,3}(\.[0-9]{1,2}){0,2}$ ]]; then
  echo "Supply a build number such as 1, 2, or 1.0.1 (at most 4.2.2 digits)." >&2
  exit 2
fi

export_kind="internal"
export_options="$ios_root/ExportOptions.plist"
if [[ "$action" == archive && $# -ne 2 ]]; then
  echo "archive takes only a build number; the export (internal or store) is chosen at upload." >&2
  exit 2
fi
if [[ "$action" == upload ]]; then
  if [[ $# -gt 3 ]]; then
    usage >&2
    exit 2
  fi
  export_kind="${3:-internal}"
  case "$export_kind" in
    internal) export_options="$ios_root/ExportOptions.plist" ;;
    store) export_options="$ios_root/ExportOptions-AppStore.plist" ;;
    *)
      echo "Choose the export: internal (TestFlight internal only) or store (App Store and external TestFlight)." >&2
      exit 2
      ;;
  esac
fi

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
if [[ ! -x "$DEVELOPER_DIR/usr/bin/xcodebuild" ]]; then
  echo "Full Xcode is required. Set DEVELOPER_DIR to its Contents/Developer directory." >&2
  exit 1
fi

# The App Store Connect API key. Only the variables' NAMES are ever printed.
auth=()
key_vars_set=0
for name in ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID; do
  if [[ -n "${!name:-}" ]]; then key_vars_set=$((key_vars_set + 1)); fi
done
if [[ $key_vars_set -eq 3 ]]; then
  if [[ ! -f "$ASC_KEY_PATH" || ! -r "$ASC_KEY_PATH" ]]; then
    echo "ASC_KEY_PATH does not name a readable file." >&2
    exit 1
  fi
  key_real="$(cd "$(dirname "$ASC_KEY_PATH")" && pwd -P)/$(basename "$ASC_KEY_PATH")"
  repo_real="$(cd "$ios_root/../.." && pwd -P)"
  if [[ "$key_real" == "$repo_real"/* ]]; then
    echo "ASC_KEY_PATH is inside the repository. Keep the .p8 key outside it (e.g. ~/.appstoreconnect/private_keys/)." >&2
    exit 1
  fi
  auth=(
    -authenticationKeyPath "$ASC_KEY_PATH"
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
  )
  echo "Authenticating with the App Store Connect API key named by ASC_KEY_ID."
elif [[ $key_vars_set -gt 0 ]]; then
  missing=()
  for name in ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID; do
    if [[ -z "${!name:-}" ]]; then missing+=("$name"); fi
  done
  echo "The App Store Connect API key needs all three variables; missing: ${missing[*]}." >&2
  exit 1
elif [[ "$action" == upload && "${ASC_AUTH:-}" != xcode ]]; then
  echo "Set ASC_KEY_PATH, ASC_KEY_ID and ASC_ISSUER_ID to upload with an App Store Connect API key" >&2
  echo "(xcodebuild's Apple-account lookup failed with \"Failed to Use Accounts\" for builds 2-4)," >&2
  echo "or set ASC_AUTH=xcode to try Xcode's signed-in account. See apps/ios/TESTFLIGHT.md." >&2
  exit 1
else
  echo "No App Store Connect API key set: using Xcode's signed-in Apple account."
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
    # shellcheck disable=SC2016 # `$(inherited)` is Xcode's build-setting syntax, kept literal.
    swift_flags='$(inherited)'
    if [[ "$(xcodebuild -version)" == *"Build version 17F113"* ]]; then
      # Swift 6.3.3 crashes in LoadableByAddress when optimizing GhostteaTruffle.
      # Disable only its reg2mem transform; keep -O, WMO, and the public ABI.
      # Scope this workaround to the Xcode build it was verified against.
      swift_flags+=' -Xfrontend -disable-large-loadable-types-reg2mem'
      echo "Applying the Xcode 26.6 (17F113) Swift compiler workaround."
    fi
    # `${auth[@]+...}`: macOS's bash 3.2 treats an empty array as unbound under `set -u`.
    xcodebuild -project "$ios_root/VibeField.xcodeproj" -scheme VibeField \
      -configuration Release -destination 'generic/platform=iOS' \
      -archivePath "$archive" \
      -onlyUsePackageVersionsFromResolvedFile \
      -skipPackagePluginValidation -allowProvisioningUpdates \
      ${auth[@]+"${auth[@]}"} \
      "CURRENT_PROJECT_VERSION=$build_number" "OTHER_SWIFT_FLAGS=$swift_flags" archive \
      2>&1 | tee "$output/archive-$build_number.log"
    echo "Archive ready: $archive"
    echo "Upload: bash $ios_root/scripts/testflight.sh upload $build_number [internal|store]"
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
    # The internal export keeps its historical paths (upload-N); the store export is named.
    suffix=""
    if [[ "$export_kind" == store ]]; then suffix="-store"; fi
    echo "Exporting build $build_number for $export_kind ($(basename "$export_options"))."
    xcodebuild -exportArchive -archivePath "$archive" \
      -exportPath "$output/upload-$build_number$suffix" \
      -exportOptionsPlist "$export_options" \
      -allowProvisioningUpdates \
      ${auth[@]+"${auth[@]}"} \
      2>&1 | tee "$output/upload-$build_number$suffix.log"
    if [[ "$export_kind" == store ]]; then
      echo "Upload completed. Check processing and export compliance in App Store Connect; the build can go to external TestFlight or App Review."
    else
      echo "Upload completed. Check processing and export compliance in App Store Connect > TestFlight."
    fi
    ;;
esac
