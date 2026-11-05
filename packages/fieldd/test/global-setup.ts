import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { nativeBinPath, nativeBuildEnv } from "./native-harness";

declare module "vitest" {
  export interface ProvidedContext {
    /** Item 153 (2026-11-02): one directory for the whole run, removed at its teardown, for what a file's rows
     * share and no single row owns (the files-host bundle, `files-host-bundle.ts`). A row's own root is the row's
     * to remove (its afterEach); a root here outlives every row of a file but never the run. */
    fielddRunRoot: string;
  }
}

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
// *Corrected 2026-11-05 (G12, measured; the CO lane, VF-PM's ruling):* at
// ghosttea 0.14.0 a repeat build is a no-op. a9 on the Mac mini (M4) ran
// `cargo build -p field-native` twice more after a build: 0.06 s each, no
// Compiling line, no stale fingerprint (CARGO_LOG fingerprint=info). A switch
// of build env (verify's CARGO_INCREMENTAL=0 and no debuginfo against
// vitest's) recompiles the field-native crate alone, in about 4 s. So this
// setup still runs cargo on every run, and cargo compiles only when
// field-native's inputs changed: a first build, a Rust or gen change, a
// rebase. The one build above stands for that case, and a lane cannot cheaply
// know its binary is fresh, which is why a fieldd suite still takes the Mac's
// HOLD. Logs: /Volumes/SamsungRed/lanes/ts6/logs/mini/co-th-a2/a2-8474c3aef/
// field-native-repeat2.log and field-native-repeat3.log.
//
// globalSetup runs once in the vitest host process before the first worker, so
// the binary is on disk when the suites open: the same guarantee the hooks
// were making, minus the queue. When G12 lands upstream this stays correct and
// simply gets cheaper.
export async function setup(project: TestProject): Promise<() => void> {
  await new Promise<void>((resolveBuild, reject) => {
    // the cargo PACKAGE name — never `.exe`, on any platform. Only the artifact
    // this produces carries the suffix, and only nativeBinPath knows that.
    // into this checkout's own target, where the suites look (`nativeBuildEnv`)
    const build = spawn("cargo", ["build", "-p", "field-native"], {
      cwd: ROOT,
      env: nativeBuildEnv(ROOT),
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
  // Made only once the build is green, so a red setup leaves nothing behind.
  const runRoot = mkdtempSync(join(tmpdir(), "vf-fieldd-run-"));
  project.provide("fielddRunRoot", runRoot);
  return () => rmSync(runRoot, { recursive: true, force: true, maxRetries: 3 });
}
