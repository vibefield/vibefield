#!/bin/bash
# No passwords or API keys live in the repo. Signing and upload authenticate with an
# App Store Connect API key (its IDs in the environment, the key itself in the login
# keychain; below), or, when asked explicitly, with Xcode's own Apple account.
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

Authentication (both archive and upload): an App Store Connect API key.
  ASC_KEY_ID      the key's ID
  ASC_ISSUER_ID   the team's issuer ID (App Store Connect > Users and Access >
                  Integrations > App Store Connect API)
  The key itself is read from the login keychain (service "vibefield-asc",
  account = the key ID; ASC_KEYCHAIN_SERVICE names another service). macOS asks
  you to allow each read: choose Allow, never Always Allow. It is decoded into a
  private temporary directory that is removed when the helper exits.
  ASC_KEY_PATH    optional: an AuthKey_<KEY ID>.p8 file instead of the keychain,
                  kept OUTSIDE this repository (every process running as you
                  can read it; see apps/ios/TESTFLIGHT.md).
They reach xcodebuild as -authenticationKeyPath / -authenticationKeyID /
-authenticationKeyIssuerID with -allowProvisioningUpdates. The helper prints only
the variables' names, and masks the key's path and IDs in xcodebuild's echo of
its own command line before the terminal and the logs see it. The key's contents
are never printed.
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

build_number="$2"
output="$ios_root/build/testflight"
archive="$output/VibeField-$build_number.xcarchive"
mkdir -p "$output"

# Every refusal that needs no key comes before the keychain is asked.
case "$action" in
  archive)
    if [[ -e "$archive" ]]; then
      echo "Archive already exists: $archive. Choose a new build number." >&2
      exit 1
    fi
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
    ;;
esac

# The App Store Connect API key. This helper prints only the variables' NAMES;
# xcodebuild's own echo of its command line is masked by `redact_key` below.
#
# EL7 (same-uid agents are the adversary): a .p8 at rest in a plain file is
# readable by every process of this user, whatever its mode, and this is a
# team-wide Admin key. So by default it lives in the login keychain, stored as
# one base64 line with an empty trusted-application list (`-T ""`), so every read
# asks the person at the Mac. It is decoded into a private temporary directory
# for xcodebuild alone and removed on exit. ASC_KEY_PATH is the file override.
key_mode=""
key_path=""
key_tmp=""
cleanup() {
  if [[ -n "$key_tmp" ]]; then rm -rf "$key_tmp"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

ids_set=0
for name in ASC_KEY_ID ASC_ISSUER_ID; do
  if [[ -n "${!name:-}" ]]; then ids_set=$((ids_set + 1)); fi
done
if [[ $ids_set -eq 1 || ($ids_set -eq 0 && -n "${ASC_KEY_PATH:-}") ]]; then
  missing=()
  for name in ASC_KEY_ID ASC_ISSUER_ID; do
    if [[ -z "${!name:-}" ]]; then missing+=("$name"); fi
  done
  echo "The App Store Connect API key needs ASC_KEY_ID and ASC_ISSUER_ID; missing: ${missing[*]}." >&2
  exit 1
elif [[ $ids_set -eq 2 && -n "${ASC_KEY_PATH:-}" ]]; then
  if [[ ! -f "$ASC_KEY_PATH" || ! -r "$ASC_KEY_PATH" ]]; then
    echo "ASC_KEY_PATH does not name a readable file." >&2
    exit 1
  fi
  key_real="$(cd "$(dirname "$ASC_KEY_PATH")" && pwd -P)/$(basename "$ASC_KEY_PATH")"
  repo_real="$(cd "$ios_root/../.." && pwd -P)"
  if [[ "$key_real" == "$repo_real"/* ]]; then
    echo "ASC_KEY_PATH is inside the repository. Keep the .p8 key outside it, or in the login keychain." >&2
    exit 1
  fi
  key_mode="file"
  key_path="$ASC_KEY_PATH"
  echo "Authenticating with the App Store Connect API key file named by ASC_KEY_PATH."
elif [[ $ids_set -eq 2 ]]; then
  # The ID names the item and the temporary file, so it must be a plain key ID.
  if [[ ! "$ASC_KEY_ID" =~ ^[A-Za-z0-9]{1,64}$ ]]; then
    echo "ASC_KEY_ID is not an App Store Connect key ID (letters and digits only)." >&2
    exit 1
  fi
  keychain_service="${ASC_KEYCHAIN_SERVICE:-vibefield-asc}"
  key_tmp="$(mktemp -d "${TMPDIR:-/tmp}/vibefield-asc.XXXXXX")"
  chmod 700 "$key_tmp"
  key_path="$key_tmp/AuthKey_$ASC_KEY_ID.p8"
  echo "Reading the App Store Connect API key for ASC_KEY_ID from the login keychain (service \"$keychain_service\")."
  echo "macOS asks to let 'security' use it: choose Allow, never Always Allow."
  if ! (umask 077 && security find-generic-password -s "$keychain_service" -a "$ASC_KEY_ID" -w |
    base64 -D >"$key_path"); then
    echo "The login keychain gave no key for ASC_KEY_ID under service \"$keychain_service\" (not stored, or not allowed)." >&2
    echo "Store it as apps/ios/TESTFLIGHT.md says, or set ASC_KEY_PATH to the .p8 file." >&2
    exit 1
  fi
  first_line=""
  IFS= read -r first_line <"$key_path" || true
  if [[ "$first_line" != "-----BEGIN PRIVATE KEY-----" ]]; then
    echo "The keychain item for ASC_KEY_ID is not a base64-encoded .p8 key. Store it again as apps/ios/TESTFLIGHT.md says." >&2
    exit 1
  fi
  key_mode="keychain"
  echo "Authenticating with the App Store Connect API key from the login keychain."
elif [[ "$action" == upload && "${ASC_AUTH:-}" != xcode ]]; then
  echo "Set ASC_KEY_ID and ASC_ISSUER_ID to upload with an App Store Connect API key (the key in the" >&2
  echo "login keychain, or ASC_KEY_PATH); xcodebuild's Apple-account lookup failed with \"Failed to Use Accounts\"" >&2
  echo "for builds 2-4. Or set ASC_AUTH=xcode to try Xcode's signed-in account. See apps/ios/TESTFLIGHT.md." >&2
  exit 1
else
  echo "No App Store Connect API key set: using Xcode's signed-in Apple account."
fi

auth=()
if [[ -n "$key_mode" ]]; then
  auth=(
    -authenticationKeyPath "$key_path"
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
  )
fi

# xcodebuild opens its output with "Command line invocation:" and its whole argv,
# key flags included. This masks the key's path (as given and as resolved) and its
# two IDs, path first since a key file's name carries its ID, before `tee` writes
# the terminal and the log. The values reach awk through its environment, never
# its argv. A path with spaces that xcodebuild escapes in that echo is not matched
# whole; the keychain's temporary path has none.
redact_key() {
  if [[ -z "$key_mode" ]]; then
    cat
    return
  fi
  VF_REDACT_ASC_KEY_PATH="$key_path" \
    VF_REDACT_ASC_KEY_REAL="${key_real:-}" \
    VF_REDACT_ASC_ISSUER_ID="$ASC_ISSUER_ID" \
    VF_REDACT_ASC_KEY_ID="$ASC_KEY_ID" \
    awk '
      BEGIN {
        n = split("ASC_KEY_PATH ASC_KEY_REAL ASC_ISSUER_ID ASC_KEY_ID", names, " ")
      }
      {
        line = $0
        for (k = 1; k <= n; k++) {
          v = ENVIRON["VF_REDACT_" names[k]]
          if (v == "") continue
          label = (names[k] == "ASC_KEY_REAL") ? "<ASC_KEY_PATH>" : "<" names[k] ">"
          out = ""
          while ((i = index(line, v)) > 0) {
            out = out substr(line, 1, i - 1) label
            line = substr(line, i + length(v))
          }
          line = out line
        }
        print line
        fflush()
      }'
}

case "$action" in
  archive)
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
      2>&1 | redact_key | tee "$output/archive-$build_number.log"
    echo "Archive ready: $archive"
    echo "Upload: bash $ios_root/scripts/testflight.sh upload $build_number [internal|store]"
    ;;
  upload)
    # The internal export keeps its historical paths (upload-N); the store export is named.
    suffix=""
    if [[ "$export_kind" == store ]]; then suffix="-store"; fi
    echo "Exporting build $build_number for $export_kind ($(basename "$export_options"))."
    xcodebuild -exportArchive -archivePath "$archive" \
      -exportPath "$output/upload-$build_number$suffix" \
      -exportOptionsPlist "$export_options" \
      -allowProvisioningUpdates \
      ${auth[@]+"${auth[@]}"} \
      2>&1 | redact_key | tee "$output/upload-$build_number$suffix.log"
    if [[ "$export_kind" == store ]]; then
      echo "Upload completed. Check processing and export compliance in App Store Connect; the build can go to external TestFlight or App Review."
    else
      echo "Upload completed. Check processing and export compliance in App Store Connect > TestFlight."
    fi
    ;;
esac
