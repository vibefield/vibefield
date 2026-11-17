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
Usage: bash apps/ios/scripts/testflight.sh archive BUILD_NUMBER review|testflight
       bash apps/ios/scripts/testflight.sh upload BUILD_NUMBER [internal|store]

  archive 7 review      Build a signed Release archive for App Review: it draws
                        no TestFlight-only row (Notifications, Developer), as
                        James ruled (the Settings page, 2026-11-12; RB-2).
  archive 8 testflight  The same code with VF_TESTFLIGHT set, so TestFlight's
                        own rows are compiled in: its app must carry every one of
                        them. Each archive has its own number.
  upload 7 store        Upload a review archive, or one made before kinds, for
                        the App Store and external TestFlight
                        (ExportOptions-AppStore.plist). It refuses a testflight
                        archive, and any archive whose app carries a
                        TestFlight-only page: the app's bytes decide.
  upload 8              Upload an archive for internal TestFlight only
                        (ExportOptions.plist: testFlightInternalTestingOnly).
                        Either kind; an archive made before kinds too.

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

Archive and upload refuse sources or an app carrying one of the owner's real strings
(item 367) or another account's home in a binary (item 374). Every count names its
path; none is printed.

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
archive_kind=""
if [[ "$action" == archive ]]; then
  if [[ $# -ne 3 ]]; then
    echo "archive takes a build number and a kind: review (for App Review) or testflight (TestFlight's own rows)." >&2
    echo "The export (internal or store) is chosen at upload." >&2
    exit 2
  fi
  archive_kind="$3"
  case "$archive_kind" in
    review | testflight) ;;
    *)
      echo "Choose the archive's kind: review (for App Review) or testflight (TestFlight's own rows)." >&2
      exit 2
      ;;
  esac
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
# The archive's kind, written once beside it when the archive succeeds (RB-1).
kind_file="$output/VibeField-$build_number.kind"
mkdir -p "$output"

# What a review archive must not carry, and a TestFlight archive must carry every one of
# (RB-1's Notifications, RB-2's Developer): each TestFlight-only page's type name, which
# Swift's reflection metadata keeps in a Release build, and one literal of its words,
# longer than Swift's 15-byte inline strings so it is a C string. Until RB-2's gate widens
# (its §1C), a TestFlight app carries Developer's two while This phone does not draw the
# row: the page is compiled in and unreachable. The count says the code is in the app,
# never that the page can be reached.
markers=(
  "NotificationsPage"
  "A title and nothing more: what your agents said stays on your desktop."
  "DeveloperPage"
  "For testing. TestFlight and development builds show this page; the build in the App Store does not."
)
# Prints "<total> <absent> (<marker> <count>; ...)" for the archive's app, every file in it
# read: absent is how many markers it carries none of.
count_markers() {
  local app m n total=0 absent=0 each=""
  app="$(find "$1/Products/Applications" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null)"
  if [[ -z "$app" ]]; then
    echo "unread (no app in the archive)"
    return 1
  fi
  for m in "${markers[@]}"; do
    # grep finds nothing in a clean app and exits 1; under pipefail that must not end the helper.
    n="$({ LC_ALL=C grep -raoF -- "$m" "$app" || true; } | wc -l | tr -d ' ')"
    each+="${each:+; }${m:0:24} $n"
    total=$((total + n))
    if [[ "$n" == 0 ]]; then
      absent=$((absent + 1))
    fi
  done
  echo "$total $absent ($each)"
}

# Real strings (item 367, asked for 2026-11-13: every real string gives way to a made-up name before build 6 goes to
# App Review). No archive leaves this Mac carrying a real string: the census's literals (each also in
# main-tracked test data, never in a kit Source) and this Mac's own paths. Two reads, because each sees what the other
# cannot:
# - the SOURCE read, before xcodebuild, over the sources this archive is about to build: a string literal of 15 bytes
#   or fewer can compile in Release to immediates in the instruction stream, which the bytes read cannot see;
# - the BYTES read, after the build, over every file of the app: a resource or library a dependency bundles, and a
#   build path the toolchain embeds, are in no source this script reads.
# 0 wanted in each, for every kind. Derived paths are named, never printed.
census_markers=(jamesyong42 SamsungRed project100 /p008/ /Users/james/ tail3f2a8c acme.dev)
shipped_sources=(apps/ios/VibeFieldKit/Sources apps/ios/App)
# The source read: prints "<total> (<literal> <files>; ...)" over the working tree, untracked files included, and up to
# five repo-relative files a literal.
count_real_sources() {
  local repo m n total=0 each="" where="" f d
  repo="$(cd "$ios_root/../.." && pwd -P)" || {
    echo "unread (no checkout)"
    return 1
  }
  for d in "${shipped_sources[@]}"; do
    if [[ ! -d "$repo/$d" ]]; then
      echo "unread ($d is not there)"
      return 1
    fi
  done
  for m in "${census_markers[@]}"; do
    n="$(cd "$repo" && { LC_ALL=C grep -rlF -- "$m" "${shipped_sources[@]}" || true; } | wc -l | tr -d ' ')"
    each+="${each:+; }$m $n"
    total=$((total + n))
    if [[ "$n" != 0 ]]; then
      while IFS= read -r f; do
        where+="  $m: $f"$'\n'
      done < <(cd "$repo" && { LC_ALL=C grep -rlF -- "$m" "${shipped_sources[@]}" || true; } | awk 'NR <= 5')
    fi
  done
  echo "$total ($each)"
  printf '%s' "$where"
}
# The source read's check: refuses before xcodebuild, naming the files; else one line.
real_sources_check() {
  local found
  found="$(count_real_sources)" || {
    echo "The sources this archive would build could not be read for real strings: $found" >&2
    return 1
  }
  if [[ "${found%% *}" != 0 ]]; then
    echo "The sources this archive would build carry a real string: ${found%%$'\n'*}" >&2
    printf '%s\n' "${found#*$'\n'}" >&2
    echo "Nothing is archived with one (item 367). Replace it as DESIGN.md's made-up names say." >&2
    return 1
  fi
  echo "Real strings in the sources: $found"
}
# The bytes read: prints "<total> (<label> <count>; ...)" over every file of the archive's app and, for each string
# found, up to five of the app's files that hold it.
count_real() {
  local app m n i total=0 each="" where="" f
  app="$(find "$1/Products/Applications" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null)"
  if [[ -z "$app" ]]; then
    echo "unread (no app in the archive)"
    return 1
  fi
  local strings=("${census_markers[@]}" "$HOME/" "$(cd "$ios_root/../.." && pwd -P)/")
  local labels=("${census_markers[@]}" "this Mac's home" "this checkout")
  i=0
  for m in "${strings[@]}"; do
    n="$({ LC_ALL=C grep -raoF -- "$m" "$app" || true; } | wc -l | tr -d ' ')"
    each+="${each:+; }${labels[$i]} $n"
    total=$((total + n))
    if [[ "$n" != 0 ]]; then
      while IFS= read -r f; do
        where+="  ${labels[$i]}: ${f#"$app"/}"$'\n'
      done < <({ LC_ALL=C grep -rlF -- "$m" "$app" || true; } | awk 'NR <= 5')
    fi
    i=$((i + 1))
  done
  echo "$total ($each)"
  printf '%s' "$where"
}
# Other machines' builds (item 374): a prebuilt library carries its builder's paths (Rust panic locations, its debug
# map). A CI runner's home (/Users/runner/, GitHub's hosted macOS account) names nobody: a notice with its count. Any
# other account's home in a Mach-O names a person: refused, with the file and its class, the name never printed
# (asked for 2026-11-13). The made-up names are DESIGN.md's table's, which the fixtures carry by design; add one only
# by a dated line here. This Mac's own home is the bytes read's own label.
made_up_users=(me you test kim ada)
# Prints "<runner> <other>" and, for each other account's path, "<count> <file in the app> (<class>)", at most ten.
count_other_machines() {
  local app f name cls mine runner=0 other=0 where=""
  app="$(find "$1/Products/Applications" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null)"
  if [[ -z "$app" ]]; then
    echo "unread (no app in the archive)"
    return 1
  fi
  mine="$(basename "$HOME")"
  while IFS= read -r f; do
    # Mach-O files only: the fixtures' JSON holds the made-up names by design.
    case "$(LC_ALL=C head -c 4 "$f" | od -An -tx1 | tr -d ' \n')" in
      cffaedfe | cafebabe) ;;
      *) continue ;;
    esac
    while IFS=$'\t' read -r name cls; do
      case " runner $mine ${made_up_users[*]} " in
        *" $name "*)
          if [[ "$name" == runner ]]; then
            runner=$((runner + 1))
          fi
          ;;
        *)
          other=$((other + 1))
          where+="${f#"$app"/} ($cls)"$'\n'
          ;;
      esac
    done < <({ LC_ALL=C grep -aoE '/Users/[A-Za-z0-9._-]+/[[:graph:]]{0,160}' "$f" || true; } |
      awk -F/ '{ c = ($4 != "" ? $4 : "(top)"); if ($5 != "") c = c "/" $5
        x = ($NF ~ /\.[A-Za-z0-9]+$/ ? "*." substr($NF, match($NF, /\.[A-Za-z0-9]+$/) + 1) : "(no extension)")
        print $3 "\t" c " " x }')
  done < <(find "$app" -type f)
  echo "$runner $other"
  printf '%s' "$where" | LC_ALL=C sort | uniq -c | awk 'NR <= 10 { $1 = $1; print "  another account'"'"'s home: " $0 }'
}
# The bytes read's check, on one archive: refuses while its app carries a real string or another account's home,
# naming the files; else one line, and a notice for a CI runner's paths.
real_strings_check() {
  local found other runner others
  found="$(count_real "$1")" || {
    echo "The archive's app could not be read for real strings: $found" >&2
    return 1
  }
  other="$(count_other_machines "$1")" || {
    echo "The archive's app could not be read for other machines' builds: $other" >&2
    return 1
  }
  read -r runner others <<<"${other%%$'\n'*}"
  if [[ "${found%% *}" != 0 ]]; then
    echo "This archive's app carries a real string: ${found%%$'\n'*}" >&2
    printf '%s\n' "${found#*$'\n'}" >&2
    echo "Nothing goes to TestFlight or App Review with one (item 367)." \
      "Replace it as DESIGN.md's made-up names say." >&2
    return 1
  fi
  if [[ "$others" != 0 ]]; then
    echo "This archive's app carries another account's home in a binary: $others (the names are never printed):" >&2
    printf '%s\n' "${other#*$'\n'}" >&2
    echo "A person's account name in a shipped binary is a person's name in the build (item 374)." \
      "The library that carries it is fixed in its own release." >&2
    return 1
  fi
  echo "Real strings in its app: $found"
  if [[ "$runner" != 0 ]]; then
    echo "Notice: other machines' builds: a CI runner's home (/Users/runner/) $runner (a prebuilt library's own paths)."
  fi
}
# The dSYM notice (item 374; James on the board, 2026-11-13 23:55:16Z: "As is, with the notice, for build 6"):
# uploadSymbols sends the archive's dSYMs to Apple for crash reports. They hold this Mac's build paths by design (the
# debug info), they are never in the app, and no tester or reviewer sees them. One line at upload, never a refusal; its
# counts name the paths, never print them.
dsym_notice() {
  local up home=0 here=0 repo
  up="$(/usr/libexec/PlistBuddy -c 'Print :uploadSymbols' "$export_options" 2>/dev/null || echo unset)"
  if [[ "$up" != true ]]; then
    echo "Notice: uploadSymbols is $up: this upload sends no dSYM to Apple."
    return 0
  fi
  repo="$(cd "$ios_root/../.." && pwd -P)"
  if [[ -d "$1/dSYMs" ]]; then
    home="$({ LC_ALL=C grep -raoF -- "$HOME/" "$1/dSYMs" || true; } | wc -l | tr -d ' ')"
    here="$({ LC_ALL=C grep -raoF -- "$repo/" "$1/dSYMs" || true; } | wc -l | tr -d ' ')"
  fi
  if [[ "$home$here" == 00 ]]; then
    echo "Notice: this upload sends the archive's dSYMs to Apple for crash reports (uploadSymbols);" \
      "they name none of this Mac's build folders."
  else
    echo "Notice: this upload sends the archive's dSYMs to Apple for crash reports (uploadSymbols)." \
      "They name this Mac's build folders (this Mac's home $home, this checkout $here). They are not in the app," \
      "and no tester or reviewer sees them."
  fi
}

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
    if [[ -e "$archive" || -e "$kind_file" ]]; then
      echo "Archive already exists: $archive. Choose a new build number." >&2
      exit 1
    fi
    # The source read (item 367), before the minutes of archiving.
    real_sources_check || exit 1
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
    # The store gate (RB-1): App Review gets a review archive, or one made before kinds, and either way its
    # app's bytes decide. A testflight archive never goes to the store. (Build 6 is a review archive: it was not
    # archived before kinds landed, TESTFLIGHT.md's correction of 2026-11-12.)
    if [[ "$export_kind" == store ]]; then
      recorded_kind="$(cat "$kind_file" 2>/dev/null || true)"
      case "$recorded_kind" in
        review) ;;
        "") echo "Build $build_number's archive was made before archive kinds: its app's bytes decide." ;;
        *)
          echo "upload $build_number store takes a review archive;" \
            "build $build_number's kind is $recorded_kind." >&2
          echo "Make a review archive under a build number not used yet, and upload that one." >&2
          exit 1
          ;;
      esac
      found="$(count_markers "$archive")" || {
        echo "The archive's app could not be read for TestFlight-only pages: $found" >&2
        exit 1
      }
      if [[ "${found%% *}" != 0 ]]; then
        echo "This ${recorded_kind:+review }archive carries a TestFlight-only page: $found." \
          "It is not sent to App Review." >&2
        exit 1
      fi
      echo "The ${recorded_kind:+review }archive carries no TestFlight-only page: $found."
    fi
    # The bytes read (items 367, 374), for both exports: internal TestFlight reaches devices too.
    real_strings_check "$archive" || exit 1
    # For both exports: internal TestFlight uploads its dSYMs too.
    dsym_notice "$archive"
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
    if [[ "$archive_kind" == testflight ]]; then
      # RB-1: the one build condition TestFlight's own rows are compiled under (SettingsBuild.swift).
      swift_flags+=' -DVF_TESTFLIGHT'
      echo "Archiving for TestFlight: VF_TESTFLIGHT is set, so TestFlight's own rows are compiled in."
    else
      echo "Archiving for App Review: no TestFlight-only row is compiled in."
    fi
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
    printf '%s\n' "$archive_kind" >"$kind_file"
    found="$(count_markers "$archive")" || {
      echo "Archive ready: $archive ($archive_kind), but its app could not be read for TestFlight-only pages: $found" >&2
      exit 1
    }
    echo "Archive ready: $archive ($archive_kind). TestFlight-only pages in its app: $found."
    if [[ "$archive_kind" == review && "${found%% *}" != 0 ]]; then
      echo "This review archive carries a TestFlight-only page, so upload store will refuse it." >&2
      exit 1
    fi
    absent="${found#* }"
    absent="${absent%% *}"
    if [[ "$archive_kind" == testflight && "$absent" != 0 ]]; then
      echo "This TestFlight archive lacks $absent of the ${#markers[@]} TestFlight-only page markers: $found." \
        "VF_TESTFLIGHT did not reach every TestFlight-only page." >&2
      exit 1
    fi
    real_strings_check "$archive" || exit 1
    if [[ "$archive_kind" == review ]]; then
      echo "Upload: bash $ios_root/scripts/testflight.sh upload $build_number store"
    else
      echo "Upload: bash $ios_root/scripts/testflight.sh upload $build_number internal"
    fi
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
