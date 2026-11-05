#!/usr/bin/env node
// BP-1b (2026-10-26; LANDED "BP-1b"; VF-PM 03:48Z): THE release build of field-native: the floor, its terminal cell and
// every other binary of the crate. It is the one entry: `package:stage` runs it before the SEA build, which needs
// field-native too. release.yml's build job reaches it through `package:stage`, on both its signed and its unsigned path.
// No other site builds a shipped field-native, and the stage's verify refuses one built anywhere else that links a host
// library (scripts/host-links.mjs).
//
// `--locked`: a release never resolves a new lock.
//
// It carried `HARFBUZZ_SYS_NO_PKG_CONFIG=1` in its own environment from BP-1b until the EL8 to ghosttea 0.13.5
// (2026-10-26): ghosttea-text 0.13.1–0.13.4 shaped through harfbuzz_rs 2.0.1 → harfbuzz-sys 0.5.0, whose build.rs links the
// HOST's harfbuzz through pkg-config whenever it finds one (Homebrew on a developer's Mac) — a package built that way
// started nowhere else (on the Mac mini, dyld could not load `/opt/homebrew/opt/harfbuzz/lib/libharfbuzz.0.dylib`). 0.13.5
// shapes with harfrust (pure Rust; ghosttea #89), so no harfbuzz-sys is in the graph and the switch is dead. The
// host-links gate (scripts/host-links.mjs) stays as the defense: a release links nothing outside /usr/lib, /System and the
// bundle, whatever a future dependency's build script prefers.
//
// LP-6 (2026-11-05): no builder path in a shipped binary. rustc writes the source path of every panic location and
// `file!()` into the binary, and a dependency's is its checkout under `$CARGO_HOME/registry/src` — the builder's home
// directory, a person's name on a developer's Mac, `/Users/runner` on CI (the measurement is in scripts/host-links.mjs).
// So the build remaps the checkout, CARGO_HOME (its registry and its git checkouts) and RUSTUP_HOME (the toolchain) to
// neutral prefixes (`--remap-path-prefix`), appended to whatever flags the caller's environment already carries, and
// afterwards scans the three binaries it built for the markers host-links.mjs's gate fails on, so a remap that stops
// working fails here rather than in the packaged app.
//   - The flags ride CARGO_ENCODED_RUSTFLAGS (0x1f-separated), never RUSTFLAGS (whitespace-split), so a home directory
//     with a space survives. An existing RUSTFLAGS is carried into it, as cargo would have split it; an existing
//     CARGO_ENCODED_RUSTFLAGS is appended to. Like any RUSTFLAGS, it overrides a config file's `build.rustflags` and
//     `target.<triple>.rustflags`; neither the repo nor James's `~/.cargo/config.toml` sets any (read 2026-11-05).
//     *(Corrected 2026-11-05, LP-6b: only when the environment already carries rustflags; otherwise the flags ride
//     `--config build.rustflags`, which cargo JOINS with a config file's instead of overriding it — and only under the
//     release switch, below.)*
//   - Cache: rustflags are part of every unit's fingerprint, so the first release build after this lands recompiles
//     the whole field-native release graph once; later builds with the same paths reuse it. A release build without
//     these flags in the same target directory (the shared one on James's Mac) and this one would rebuild each other —
//     which is why run-update-smoke.mjs now builds through this entry instead of its own `cargo build --release`.
//     CI's release job is cache-free by design (EDP §12.1), so it pays nothing extra.
//
// LP-6b (item 170, 2026-11-05): the remap moved to scripts/build-paths.mjs, where rosettad's and mille's builds take it
// too, and it runs only under THE release switch (`VIBEFIELD_REMAP_BUILD_PATHS=1`, release.yml's build job). The paths
// LP-6 remapped name the checkout, so in the shared target directory every lane's release build would have rebuilt the
// graph over every other's; unset, this entry builds as it did before LP-6 and says the gate would refuse the result.
// It now remaps the workspace's TARGET directory too (→ /target: a build script's OUT_DIR, which the shared target puts
// outside the checkout), and takes the door that appends: flags already in the environment are appended to there, else
// `--config build.rustflags=[…]`, which cargo joins after any config file's own (scripts/build-paths.mjs says why). The
// scan after the build counts every marker the packaged app's gate fails on, this host's target directories among them.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cargoRemap,
  REMAP_SWITCH,
  REMAP_TARGETS,
  readConfigRustflags,
  remapFlags,
  remapRequested,
} from "../../../scripts/build-paths.mjs";
import { cargoBinaries, workspaceTargetDir } from "../../../scripts/cargo-target.mjs";
import {
  BUILDER_PATH_MARKERS,
  builderPathCounts,
  hostTargetMarkers,
} from "../../../scripts/host-links.mjs";
import { FLOOR_BINARIES } from "../../../scripts/native-floor.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The release build's arguments. */
export const RELEASE_BUILD_ARGS = ["build", "--release", "--locked", "-p", "field-native"];

/** THE release build's invocation: `{ args, env, flags, door }`. Without the switch it is the plain build (no flags, no
 * door); with it, the checkout and its target directory join CARGO_HOME and RUSTUP_HOME in the remap, through the door
 * that appends (`cargoRemap`). `targetDir` may be null (cargo could not say): the build then remaps the rest. */
export function releaseInvocation({
  repo = repoRoot,
  env = process.env,
  targetDir = null,
  configs = [],
  home,
  realpath,
} = {}) {
  if (!remapRequested(env))
    return { args: [...RELEASE_BUILD_ARGS], env: { ...env }, flags: [], door: null };
  const flags = remapFlags({
    roots: [
      [repo, REMAP_TARGETS.repo],
      [targetDir, REMAP_TARGETS.target],
    ],
    env,
    ...(home === undefined ? {} : { home }),
    ...(realpath === undefined ? {} : { realpath }),
  });
  return { ...cargoRemap({ args: RELEASE_BUILD_ARGS, env, flags, configs }), flags };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  let targetDir = null;
  try {
    targetDir = workspaceTargetDir(repoRoot, process.env);
  } catch {
    // cargo says the same, and louder, when it runs
  }
  let invocation;
  try {
    invocation = releaseInvocation({
      env: process.env,
      targetDir,
      configs: remapRequested(process.env) ? readConfigRustflags(repoRoot) : [],
    });
  } catch (error) {
    console.error(
      `build-native-release: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
  const { args, env, flags, door } = invocation;
  console.log(`build-native-release: cargo ${args.join(" ")}`);
  console.log(
    door === null
      ? `build-native-release: ${REMAP_SWITCH} unset — a development build, its paths NOT remapped (\`host-links.mjs --app\` refuses them; a local release exports ${REMAP_SWITCH}=1 for this build, siblings:build and build-js mille)`
      : `build-native-release: ${REMAP_SWITCH}=1 — rustflags += ${flags.join(" ")} (through ${door})`,
  );
  const run = spawnSync("cargo", args, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (run.error !== undefined) {
    console.error(`build-native-release: cargo did not run (${run.error.message})`);
    process.exit(2);
  }
  if (run.status !== 0) process.exit(run.status ?? 1);
  // The scan the packaged app's gate runs (host-links.mjs), here on what this build just wrote: it fails a remapped
  // build, and says what an unremapped one carries.
  const markers = [...new Set([...BUILDER_PATH_MARKERS, ...hostTargetMarkers()])];
  const leaks = [];
  for (const binary of cargoBinaries(repoRoot, "release", FLOOR_BINARIES, { env })) {
    const counts = builderPathCounts(binary.path, markers);
    const found = markers.filter((marker) => counts[marker] > 0);
    if (found.length > 0)
      leaks.push(`${binary.name}: ${found.map((m) => `${m} ×${counts[m]}`).join(", ")}`);
  }
  if (leaks.length > 0 && door !== null) {
    console.error(
      `build-native-release: builder paths survived the remap:\n  ${leaks.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log(
    leaks.length > 0
      ? `build-native-release: not remapped, as asked — ${leaks.join("; ")}`
      : `build-native-release: ${FLOOR_BINARIES.join(", ")} carry no builder path (${markers.join(", ")})`,
  );
}
