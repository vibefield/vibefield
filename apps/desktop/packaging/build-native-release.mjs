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
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The release build's arguments. */
export const RELEASE_BUILD_ARGS = ["build", "--release", "--locked", "-p", "field-native"];

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  console.log(`build-native-release: cargo ${RELEASE_BUILD_ARGS.join(" ")}`);
  const run = spawnSync("cargo", RELEASE_BUILD_ARGS, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (run.error !== undefined) {
    console.error(`build-native-release: cargo did not run (${run.error.message})`);
    process.exit(2);
  }
  process.exit(run.status ?? 1);
}
