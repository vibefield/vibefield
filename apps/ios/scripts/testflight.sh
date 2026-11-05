#!/bin/bash
# No passwords or API keys live in the repo. The archive signs with Xcode's own Apple
# account; the upload authenticates with an App Store Connect API key (its IDs in the
# environment, the key itself in the login keychain; below), or, when asked
# explicitly, with Xcode's account too. The archive takes the key only on
# ASC_ARCHIVE_KEY=1.
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

Authentication: `archive` signs with Xcode's signed-in account (as archives 1-5
did); `upload` uses an App Store Connect API key.
  ASC_KEY_ID      the key's ID
  ASC_ISSUER_ID   the team's issuer ID (App Store Connect > Users and Access >
                  Integrations > App Store Connect API)
  The key itself is read from the login keychain (service "vibefield-asc",
  account = the key ID; ASC_KEYCHAIN_SERVICE names another service). macOS asks
  you to allow each read: choose Allow, never Always Allow. It is decoded into a
  temporary file for xcodebuild and removed when the helper exits. WHILE
  xcodebuild runs, any process running as you can read that file without a
  prompt, at the path `ps` shows in xcodebuild's arguments: run it with no
  agent running as you, and revoke the key if one was (apps/ios/TESTFLIGHT.md).
  ASC_KEY_PATH    optional: an AuthKey_<KEY ID>.p8 file instead of the keychain,
                  kept OUTSIDE this repository (every process running as you
                  can read it; see apps/ios/TESTFLIGHT.md).
  ASC_ARCHIVE_KEY optional: 1 makes `archive` use the key too, for an archive
                  Xcode's account cannot sign. The key is then decoded for the
                  whole Release build, not only for the export.
They reach xcodebuild as -authenticationKeyPath / -authenticationKeyID /
-authenticationKeyIssuerID with -allowProvisioningUpdates. The helper prints only
the variables' names (and the guard's counts, below), and masks the key's path
and IDs in xcodebuild's echo of its own command line before the terminal and
the logs see it. The key's contents are never printed.
Without them, `upload` refuses, since xcodebuild's account lookup is what failed
as "Failed to Use Accounts" for builds 2-4. ASC_AUTH=xcode makes `upload` try
Xcode's account anyway.

The accident guard: before it reads the key (`upload`, and `archive` with
ASC_ARCHIVE_KEY=1), the helper counts your processes named claude, codex and
fieldd, prints the three counts (never a process ID or a command line), and
refuses while any runs. It prevents ACCIDENTS and is NO BOUNDARY: a process
running as you can rename itself.
  VIBEFIELD_ASC_AGENTS_RUNNING=revoke-the-key-afterwards
                  reads the key with agents running anyway. Then revoke the key
                  in App Store Connect when the run ends. Any other value is
                  refused.
Releases run in your own macOS account (James, 2026-11-05). For the length of the
upload, quit every agent CLI (claude, codex, and any other you run; the guard's
three names are a sample, not the set), quit VibeField (Cmd-Q, which stops its
daemons) and stop any pnpm dev (Ctrl-C in its terminal, which reaps its pair), or
upload from Xcode's Organizer by hand
(apps/ios/TESTFLIGHT.md).

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
agents_override="revoke-the-key-afterwards"
case "${VIBEFIELD_ASC_AGENTS_RUNNING:-}" in
  "" | "$agents_override") ;;
  *)
    echo "VIBEFIELD_ASC_AGENTS_RUNNING is $agents_override (read the key with agents running, then revoke it) or unset." >&2
    exit 2
    ;;
esac
case "$action" in
  archive)
    if [[ -e "$archive" ]]; then
      echo "Archive already exists: $archive. Choose a new build number." >&2
      exit 1
    fi
    case "${ASC_ARCHIVE_KEY:-}" in
      "" | 0 | 1) ;;
      *)
        echo "ASC_ARCHIVE_KEY is 1 (archive with the API key) or unset (archive with Xcode's account)." >&2
        exit 2
        ;;
    esac
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
# asks the person at the Mac. ASC_KEY_PATH is the file override.
#
# The prompt guards the READ, not what follows it: xcodebuild takes the key only
# as a file, so it is decoded into a temporary directory (700, umask 077) and
# removed on exit, and WHILE xcodebuild runs any process of this uid can read it
# without a prompt, at the path xcodebuild's argv shows to `ps`. Modes stop other
# users, not this one. So the key is decoded only where it is needed: for the
# export (`upload`), which "Failed to Use Accounts" without it (builds 2-4).
# `archive` signs with Xcode's account, as archives 1-5 did, and takes the key
# only on ASC_ARCHIVE_KEY=1, since that holds it decoded for a whole Release
# build.
key_mode=""
key_path=""
key_tmp=""
cleanup() {
  if [[ -n "$key_tmp" ]]; then rm -rf "$key_tmp"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

# The accident guard (VF-PM's ruling on LP-4's signing review, 2026-11-05). Before the
# key is read, count this user's processes by exact name and refuse while an agent
# runs. It prevents ACCIDENTS (an upload started from, or beside, an agent) and is NO
# BOUNDARY: macOS's pgrep matches the name a process gives itself (its argv[0]'s last
# component), and a process running as you can rename itself. `-a` counts pgrep's own
# ancestors too, so an agent that runs this helper counts itself. `fieldd` is the
# packaged app's daemon by its executable's name. Only the counts are printed, never a
# process ID or a command line; a pgrep that cannot answer refuses, it never passes.
refuse_while_agents_run() {
  local name pids status count total=0 counts=""
  for name in claude codex fieldd; do
    status=0
    pids="$(pgrep -a -x -U "$UID" "$name")" || status=$?
    case "$status" in
      0) count="$(printf '%s\n' "$pids" | wc -l | tr -d ' ')" ;;
      1) count=0 ;;
      *)
        echo "Could not count the processes running as you (pgrep exited $status), so the key is not read." >&2
        exit 1
        ;;
    esac
    counts+="${counts:+, }$name $count"
    total=$((total + count))
  done
  echo "Processes running as you, by name: $counts."
  if [[ $total -eq 0 ]]; then
    return 0
  fi
  if [[ "${VIBEFIELD_ASC_AGENTS_RUNNING:-}" == "$agents_override" ]]; then
    echo "VIBEFIELD_ASC_AGENTS_RUNNING=$agents_override: reading the key with agents running." >&2
    echo "Treat the key as exposed: revoke it in App Store Connect when this run ends (apps/ios/TESTFLIGHT.md, step 4)." >&2
    return 0
  fi
  echo "Refusing to read the App Store Connect API key while an agent runs as you. Stop them," >&2
  echo "or release from an account with none (apps/ios/TESTFLIGHT.md). This guard prevents accidents;" >&2
  echo "it is no boundary. To go on anyway: VIBEFIELD_ASC_AGENTS_RUNNING=$agents_override, then revoke the key." >&2
  exit 1
}

ids_set=0
for name in ASC_KEY_ID ASC_ISSUER_ID; do
  if [[ -n "${!name:-}" ]]; then ids_set=$((ids_set + 1)); fi
done
if [[ "$action" == archive && "${ASC_ARCHIVE_KEY:-}" != 1 ]]; then
  # The key is never asked for here, so neither is the keychain.
  if [[ $ids_set -gt 0 || -n "${ASC_KEY_PATH:-}" ]]; then
    echo "Archiving with Xcode's signed-in Apple account: the API key is read at upload only (ASC_ARCHIVE_KEY=1 archives with it)."
  else
    echo "No App Store Connect API key set: archiving with Xcode's signed-in Apple account."
  fi
elif [[ $ids_set -eq 1 || ($ids_set -eq 0 && -n "${ASC_KEY_PATH:-}") ]]; then
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
  refuse_while_agents_run
  key_mode="file"
  key_path="$ASC_KEY_PATH"
  echo "Authenticating with the App Store Connect API key file named by ASC_KEY_PATH."
elif [[ $ids_set -eq 2 ]]; then
  # The ID names the item and the temporary file, so it must be a plain key ID.
  if [[ ! "$ASC_KEY_ID" =~ ^[A-Za-z0-9]{1,64}$ ]]; then
    echo "ASC_KEY_ID is not an App Store Connect key ID (letters and digits only)." >&2
    exit 1
  fi
  refuse_while_agents_run
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
  # the key's last non-empty line too: a key cut short (a 128-character prompt keeps no more) begins right and ends wrong
  last_line="$(awk 'NF { line = $0 } END { sub(/\r$/, "", line); print line }' "$key_path")"
  if [[ "${first_line%$'\r'}" != "-----BEGIN PRIVATE KEY-----" || "$last_line" != "-----END PRIVATE KEY-----" ]]; then
    echo "The keychain item for ASC_KEY_ID is not a whole base64-encoded .p8 key. Store it again as apps/ios/TESTFLIGHT.md says." >&2
    exit 1
  fi
  key_mode="keychain"
  echo "Authenticating with the App Store Connect API key from the login keychain."
elif [[ "$action" == upload && "${ASC_AUTH:-}" != xcode ]]; then
  echo "Set ASC_KEY_ID and ASC_ISSUER_ID to upload with an App Store Connect API key (the key in the" >&2
  echo "login keychain, or ASC_KEY_PATH); xcodebuild's Apple-account lookup failed with \"Failed to Use Accounts\"" >&2
  echo "for builds 2-4. Or set ASC_AUTH=xcode to try Xcode's signed-in account. See apps/ios/TESTFLIGHT.md." >&2
  exit 1
elif [[ "$action" == archive ]]; then
  echo "ASC_ARCHIVE_KEY=1 asks to archive with the App Store Connect API key, but ASC_KEY_ID and ASC_ISSUER_ID are not set." >&2
  exit 1
else
  echo "No App Store Connect API key set: ASC_AUTH=xcode, using Xcode's signed-in Apple account."
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
