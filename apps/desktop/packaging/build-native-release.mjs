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
//   - Cache: rustflags are part of every unit's fingerprint, so the first release build after this lands recompiles
//     the whole field-native release graph once; later builds with the same paths reuse it. A release build without
//     these flags in the same target directory (the shared one on James's Mac) and this one would rebuild each other —
//     which is why run-update-smoke.mjs now builds through this entry instead of its own `cargo build --release`.
//     CI's release job is cache-free by design (EDP §12.1), so it pays nothing extra.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cargoBinaries } from "../../../scripts/cargo-target.mjs";
import { BUILDER_PATH_MARKERS, builderPathsIn } from "../../../scripts/host-links.mjs";
import { FLOOR_BINARIES } from "../../../scripts/native-floor.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The release build's arguments. */
export const RELEASE_BUILD_ARGS = ["build", "--release", "--locked", "-p", "field-native"];

/** The neutral prefix each build-host directory is written as. */
export const REMAP_TARGETS = { repo: "/vibefield", cargoHome: "/cargo", rustupHome: "/rustup" };

function realpathOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** The `--remap-path-prefix` flags for this build host: the checkout, CARGO_HOME and RUSTUP_HOME (each as given and as
 * its real path, when that differs). rustc applies the LAST mapping that matches, so the list runs from the shortest
 * prefix to the longest: a directory nested in another is written by its own, more specific mapping. */
export function remapFlags({
  repo,
  env = process.env,
  home = homedir(),
  realpath = realpathOrNull,
}) {
  const sources = [
    [repo, REMAP_TARGETS.repo],
    [env.CARGO_HOME || join(home, ".cargo"), REMAP_TARGETS.cargoHome],
    [env.RUSTUP_HOME || join(home, ".rustup"), REMAP_TARGETS.rustupHome],
  ];
  const byPrefix = new Map();
  for (const [given, target] of sources) {
    for (const path of [given, realpath(given)]) {
      if (typeof path !== "string" || path === "" || path === "/") continue;
      const prefix = path.length > 1 ? path.replace(/\/+$/u, "") : path;
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, target);
    }
  }
  return [...byPrefix]
    .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1))
    .map(([prefix, target]) => `--remap-path-prefix=${prefix}=${target}`);
}

/** The build's environment: `flags` appended to the caller's own rustflags, carried as CARGO_ENCODED_RUSTFLAGS (which
 * cargo reads before RUSTFLAGS, so RUSTFLAGS is folded in, as cargo splits it, and dropped). */
export function releaseBuildEnv(env, flags) {
  const encoded = env.CARGO_ENCODED_RUSTFLAGS;
  const existing =
    encoded !== undefined
      ? encoded.split("\x1f").filter((flag) => flag !== "")
      : (env.RUSTFLAGS ?? "").split(/\s+/u).filter((flag) => flag !== "");
  const next = { ...env, CARGO_ENCODED_RUSTFLAGS: [...existing, ...flags].join("\x1f") };
  delete next.RUSTFLAGS;
  return next;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const flags = remapFlags({ repo: repoRoot });
  console.log(`build-native-release: cargo ${RELEASE_BUILD_ARGS.join(" ")}`);
  console.log(`build-native-release: rustflags += ${flags.join(" ")}`);
  const env = releaseBuildEnv(process.env, flags);
  const run = spawnSync("cargo", RELEASE_BUILD_ARGS, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (run.error !== undefined) {
    console.error(`build-native-release: cargo did not run (${run.error.message})`);
    process.exit(2);
  }
  if (run.status !== 0) process.exit(run.status ?? 1);
  // The scan the packaged app's gate runs (host-links.mjs), here on what this build just wrote.
  const leaks = [];
  for (const binary of cargoBinaries(repoRoot, "release", FLOOR_BINARIES, { env })) {
    const found = builderPathsIn(binary.path);
    if (found.length > 0) leaks.push(`${binary.name}: ${found.join(", ")}`);
  }
  if (leaks.length > 0) {
    console.error(
      `build-native-release: builder paths survived the remap (${BUILDER_PATH_MARKERS.join(", ")}):\n  ${leaks.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log(
    `build-native-release: ${FLOOR_BINARIES.join(", ")} carry no builder path (${BUILDER_PATH_MARKERS.join(", ")})`,
  );
}
