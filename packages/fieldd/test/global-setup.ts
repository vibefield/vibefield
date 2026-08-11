import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeBinPath } from "./native-harness";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

// ONE build for the whole run, before any worker starts.
//
// Five suites spawn the real field-native binary, and each used to build it in
// its own 180s `beforeAll`. Those builds serialize on the cargo target-dir
// lock, so the budget is not per-suite at all: the last one in the queue waits
// out every predecessor. That is survivable only while a repeat build is a
// no-op — and it is not. `ghosttea-vt-sys` declares its OUT_DIR tarball
// `cargo:rerun-if-changed` and then writes that same file during its own run
// (petition G12), so cargo holds the whole ghosttea chain permanently stale
// and EVERY `cargo build -p field-native` pays full price. Five suites × that
// price overruns the budget, and whoever queued last dies — by lottery, with a
// different victim each run.
//
// globalSetup runs once in the vitest host process before the first worker, so
// the binary is on disk when the suites open: the same guarantee the hooks
// were making, minus the queue. When G12 lands upstream this stays correct and
// simply gets cheaper.
export async function setup(): Promise<void> {
  await new Promise<void>((resolveBuild, reject) => {
    // the cargo PACKAGE name — never `.exe`, on any platform. Only the artifact
    // this produces carries the suffix, and only nativeBinPath knows that.
    const build = spawn("cargo", ["build", "-p", "field-native"], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "pipe"],
    });
    // A failure here kills the entire run, so it must say why — cargo's
    // diagnosis lives on stderr and is worthless discarded.
    let diagnosis = "";
    build.stderr?.on("data", (chunk: Buffer) => {
      diagnosis += chunk.toString();
    });
    build.once("error", reject);
    build.once("exit", (code) =>
      code === 0
        ? resolveBuild()
        : reject(
            new Error(`cargo build -p field-native exited ${code}\n${diagnosis.trimEnd()}`.trim()),
          ),
    );
  });
  // A green cargo whose artifact is not where the suites will look for it is a
  // naming assumption, not a build failure — say so once here rather than five
  // times as an opaque spawn ENOENT inside the suites.
  const bin = nativeBinPath(ROOT);
  if (!existsSync(bin)) {
    throw new Error(`cargo build -p field-native succeeded but ${bin} does not exist`);
  }
}
