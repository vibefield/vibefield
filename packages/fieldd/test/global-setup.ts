import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
}
