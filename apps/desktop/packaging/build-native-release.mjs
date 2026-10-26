#!/usr/bin/env node
// BP-1b (2026-10-26; LANDED "BP-1b"; VF-PM 03:48Z): THE release build of field-native: the floor, its terminal cell and
// every other binary of the crate. It is the one entry: `package:stage` runs it before the SEA build, which needs
// field-native too. release.yml's build job reaches it through `package:stage`, on both its signed and its unsigned path.
// No other site builds a shipped field-native, and the stage's verify refuses one built anywhere else that links a host
// library (scripts/host-links.mjs).
//
// `--locked`: a release never resolves a new lock.
//
// `HARFBUZZ_SYS_NO_PKG_CONFIG=1`, in this invocation's own environment: ghosttea-text 0.13.1 → harfbuzz_rs 2.0.1 →
// harfbuzz-sys 0.5.0. That crate's build.rs links the HOST's harfbuzz through pkg-config whenever it finds one (Homebrew
// on a developer's Mac), and compiles its embedded copy only when it finds none or when this variable is set. 0.5.0 has no
// `bundled` feature to ask for instead. A package built with the host's harfbuzz started nowhere else: on the Mac mini,
// fieldd never got ready, because dyld could not load `/opt/homebrew/opt/harfbuzz/lib/libharfbuzz.0.dylib`. A static
// choice in ghosttea-text is upstream's (a ghosttea docket item). Dev builds stay as they are: they never ship.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The release build's environment: the caller's, plus the one switch a shipped harfbuzz needs. */
export function releaseBuildEnv(base) {
  return { ...base, HARFBUZZ_SYS_NO_PKG_CONFIG: "1" };
}

/** The release build's arguments. */
export const RELEASE_BUILD_ARGS = ["build", "--release", "--locked", "-p", "field-native"];

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  console.log(
    `build-native-release: cargo ${RELEASE_BUILD_ARGS.join(" ")} (HARFBUZZ_SYS_NO_PKG_CONFIG=1)`,
  );
  const run = spawnSync("cargo", RELEASE_BUILD_ARGS, {
    cwd: repoRoot,
    env: releaseBuildEnv(process.env),
    stdio: "inherit",
  });
  if (run.error !== undefined) {
    console.error(`build-native-release: cargo did not run (${run.error.message})`);
    process.exit(2);
  }
  process.exit(run.status ?? 1);
}
