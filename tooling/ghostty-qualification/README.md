# Ghostty migration qualification

This harness runs Vibefield's production Swift terminal suites on an iPhone and
connects two independent Metal terminal views through the real Truffle sidecar,
Freeway door, routed client and PTY host. The approval service is the fixture;
transport, routing, terminal state and rendering use production code.

Keep baseline and candidate checkouts, Cargo targets, DerivedData, result bundles
and QA bundle IDs separate. Use the exact dependency revisions under review. A
baseline with a shared compatibility fix must be recorded as such.

Put the large build directories on the portable SSD when internal space is low.
Set `CARGO_TARGET_DIR` explicitly: Cargo's user configuration can override a
checkout's `target` symlink. Xcode's precompiled caches contain absolute paths;
after relocating DerivedData, clear its generated `Build`, `ModuleCache.noindex`
and `CompilationCache.noindex` directories and rebuild the QA app. Preserve the
source, result bundles and any baseline binaries needed for comparison.

## Build an isolated phone app

Build Ghosttea's local native frameworks first, then enable Vibefield's Ghosttea
sibling overlay. The local Swift link must target `apple/GhostteaKit`, whose
manifest consumes the freshly built frameworks. The repository-root Ghosttea
manifest consumes a published binary. Do not commit the overlay's nil release
line, Cargo patches or regenerated local lockfiles.

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export QA_ROOT=/private/tmp/vibefield-ghostty-qualification
mkdir -p "$QA_ROOT"
python3 tooling/ghostty-qualification/generate_device_host.py \
  "$PWD" "$QA_ROOT/device-candidate" candidate
xcodebuild build-for-testing \
  -project "$QA_ROOT/device-candidate/VibeField.xcodeproj" -scheme VibeField \
  -destination "platform=iOS,id=$DEVICE_UDID" \
  -derivedDataPath "$QA_ROOT/derived-candidate" \
  -clonedSourcePackagesDirPath "$QA_ROOT/swift-packages" \
  -parallel-testing-enabled NO -jobs 2
```

Set `DEVICE_UDID` to the connected, unlocked developer device. The generator
inherits the source project's signing team; `--team` overrides it. It records
the source revision, tracked diff hash, untracked Swift source hashes and QA source hash in a manifest beside
the generated project. Its baseline mode omits calls to the new selection API
so the same probe can compile against an older client.

Run the generated `.xctestrun` with `xcodebuild test-without-building` to run the
terminal, input, routed, Freeway and mesh suites. Without a transferred config,
the separate real-tailnet probe skips. Preserve the complete `.xcresult`.

## Start a real terminal host

The fixture uses only `TRUFFLE_TEST_AUTHKEY` from the selected env file. Use an
approved test key. It registers ephemeral nodes in a unique namespace, requires
the authenticated same-login identity and restricts admission to discovered
peers in that namespace. It does not use product sessions or product app data.

```sh
mkdir -p "$QA_ROOT/host-candidate"
export VF_GHOSTTY_PROBE_DIRECTORY="$QA_ROOT/host-candidate"
export TRUFFLE_TEST_DOTENV=/path/to/approved/test.env
export CARGO_TARGET_DIR="$QA_ROOT/target-candidate"
export FIELDD_NATIVE_BIN="$CARGO_TARGET_DIR/debug/field-native"
export FIELDD_ROSETTAD_BIN=/path/to/pinned/rosettad
cargo build -p field-native --locked
cargo test -p field-native --test ghostty_migration_fixture --locked -- \
  --ignored --nocapture
```

Wait for `ready.json`. The fixture stops when its directory contains a `stop`
file, or after 30 minutes. Always create that stop file after the phone tests.

## Run the phone against the host

```sh
python3 tooling/ghostty-qualification/run_phone_probe.py \
  --fixture "$QA_ROOT/host-candidate" \
  --app "$QA_ROOT/derived-candidate/Build/Products/Debug-iphoneos/VibeField.app" \
  --xctestrun /path/to/generated/device.xctestrun \
  --device "$DEVICE_UDID" \
  --bundle-id your.app.ghosttyqualification.candidate \
  --test-env-file /path/to/approved/test.env \
  --result "$QA_ROOT/candidate-client-candidate-host.xcresult"
touch "$QA_ROOT/host-candidate/stop"
```

The runner verifies the actual app's isolated bundle ID, installs it, transfers
only the approved test key in a mode-0600 temporary file, and removes the local
file immediately. The app consumes and deletes the configuration on startup.
The runner uninstalls the QA app in `finally`, including after launch failure,
so an unconsumed configuration cannot remain. It never uninstalls the shipping
app. Do not print the key or archive the configuration. Run one phone test at a
time; result paths must be new.

The probe verifies native font goldens, mirrored accepted **and rendered**
advances, input echo, geometry handoff/resize, park/resume and fresh-link redial.
Candidate clients also read Unicode selections from both views when supported,
and require an explicit unsupported result from older hosts. It temporarily
replaces the QA app's root view and pauses its background Metal views to avoid
a competing drawable loop blocking XCTest. This affects the QA host only.

Run all four baseline/candidate client-host pairings. Retain failed runs,
capability results, test summaries and screenshots. A passing mixed matrix does
not cover mobile network transitions, long-duration suspension, or every TUI.
The desktop companion is `pnpm perf:terminal pane-regression`; the candidate
requires real selection-copy, scrollback, alternate-screen and hidden-output
checks. Use separate profiles and explicitly select the host binary.
