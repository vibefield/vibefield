// WIN-4 — the platform-honest half of the native-backed harnesses: where the
// binary is, where a temp data root may live, and how a suite knows the floor
// is up. Five suites spawn the real field-native and each had all three of
// those facts inlined as a unix constant; this is the one authority. Test-local
// — not shipped.
//
// Every helper takes `platform` explicitly (defaulting to the real one) so the
// win32 branch is reachable from a unit test on a mac rather than only from a
// Windows box.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";

/** The cargo artifact for `-p field-native`. The PACKAGE name never carries a
 * suffix — only the built file does, and only on win32. */
export function nativeBinPath(root: string, platform: NodeJS.Platform = process.platform): string {
  return join(root, "target", "debug", platform === "win32" ? "field-native.exe" : "field-native");
}

/** A temp data root short enough for whatever will be bound underneath it.
 *
 * unix: `/tmp`, deliberately NOT `tmpdir()`. macOS hands out
 * `/var/folders/<2>/<~30>/T/` — ~50 bytes spent before our own tree — and the
 * ghosttea endpoints land at `<root>/native/run/termframe.sock`, over the
 * ~104-byte sun_path ceiling. field-native then cannot bind at all, so the
 * short root is a precondition of the suite, not a tidiness preference.
 *
 * win32: `tmpdir()`, because there is no `/tmp` and no budget to protect —
 * endpoints are named pipes in the flat `\\.\pipe\` namespace (WIN-D1) and the
 * data root contributes only a scope hash to their names, never a path.
 */
export function shortTmpRoot(prefix: string, platform: NodeJS.Platform = process.platform): string {
  return mkdtempSync(join(platform === "win32" ? tmpdir() : "/tmp", prefix));
}

/** The endpoint field-native binds for one of the `SOCKETS` names under
 * `dataDir` — the WIN-D1 law, from the test side: the LAYOUT path joined under
 * the root on unix, a root-scoped named pipe on win32. */
export function nativeEndpoint(
  dataDir: string,
  socketFile: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? pipeEndpointFor(dataDir, socketFile)
    : join(dataDir, ...LAYOUT.NATIVE_RUN_DIR, socketFile);
}

/** Wait until `endpoint` accepts a connection, or throw at the deadline.
 *
 * The old gate was `existsSync(<dataDir>/native/run/mgmt.sock)`, which asks the
 * filesystem a question a named pipe cannot answer — a win32 endpoint has no
 * path presence, so the poll could only ever time out. Connecting is the honest
 * test on both planes, and it is strictly stronger than presence even on unix:
 * the socket file exists between `bind` and `listen`, so a suite that raced
 * that window saw the file and then got ECONNREFUSED from its first real dial.
 *
 * Every dial error counts as not-yet (ENOENT/ECONNREFUSED before the bind,
 * EBUSY/EPIPE mid-bind on win32); the last one is reported if the deadline
 * wins, because "never came up" without an errno is a wasted failure.
 */
export async function waitForEndpoint(endpoint: string, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let last = "no attempt completed";
  for (;;) {
    const failure = await dialOnce(endpoint);
    if (failure === null) return;
    last = failure;
    if (Date.now() > deadline) {
      throw new Error(`${endpoint} never accepted a connection in ${deadlineMs}ms (last: ${last})`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Terminate a spawned daemon AND EVERY DESCENDANT, resolving once it is gone.
 *
 * `child.kill("SIGKILL")` is TerminateProcess on win32 and reaches exactly ONE
 * process — but field-native spawns children of its own (the truffle sidecar),
 * and an orphan keeps HANDLES OPEN inside the suite's temp data root. Windows
 * refuses to remove a directory anything still holds open, so the teardown
 * `rmSync` threw `EPERM` and reddened the whole file even though every
 * assertion had passed. It is the harness twin of the production defect
 * `killPlan` fixes (process-service.ts), and it is why these suites passed in
 * isolation and failed under a full parallel run: more load, more of the tree
 * still alive when the directory removal came around.
 *
 * `/T` walks the tree from a LIVING parent, so it must run BEFORE the parent is
 * reaped — hence taskkill instead of a kill-then-sweep. */
export async function killDaemonTree(child: ChildProcess): Promise<void> {
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 3_000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
  const pid = child.pid;
  if (process.platform === "win32" && pid !== undefined) {
    await new Promise<void>((resolve) => {
      const taskkill = spawn(
        join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      // exit 128 = "no such pid", the race we asked for; an error to LAUNCH it
      // is equally not fatal here — the exit wait below still bounds us.
      taskkill.once("error", () => resolve());
      taskkill.once("exit", () => resolve());
    });
  } else {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  await exited;
}

/** Remove a suite's temp data root, tolerating Windows' slow handle release.
 *
 * The strictness lives one line earlier, in `killDaemonTree`: that AWAITS the
 * real exit, so "did the daemon die" is still answered hard. What this softens
 * is only "did Windows finish releasing its handles before we asked", which is
 * not a claim any test here is making. Windows drops a dead process's handles
 * asynchronously, and Defender or the indexer can hold a just-written file for
 * longer still, so `rmSync` can read EPERM on a directory whose owner is gone.
 *
 * That was reddening the gate on HOUSEKEEPING: every assertion passed, then the
 * `afterEach` threw and took the file with it — a different row each run, all
 * green in isolation. A leaked directory under %TEMP% is not a product defect
 * and the OS reclaims it; a false red teaches people to re-run until green,
 * which is how a true failure gets waved through. So: a generous budget, and
 * then a reported surrender rather than a thrown one. */
export function removeTempRoot(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    // Deliberately not rethrown — see above. Named on stderr so a LEAK is still
    // visible if one ever becomes systematic rather than incidental.
    process.stderr.write(
      `[native-harness] left ${dir} behind: ${(error as NodeJS.ErrnoException).code ?? error}\n`,
    );
  }
}

/** `waitForEndpoint` for the management plane — the gate every native suite
 * opens with, since fieldd's first act is to pair over it. */
export function waitForMgmtEndpoint(
  dataDir: string,
  deadlineMs: number,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  return waitForEndpoint(nativeEndpoint(dataDir, SOCKETS.MGMT, platform), deadlineMs);
}

/** One connect attempt: `null` when the endpoint accepted, else the error code
 * (or message) that says why not. The connection is dropped immediately —
 * field-native sees a client that opened and left, which is a no-op to it. */
function dialOnce(endpoint: string): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createConnection(endpoint);
    let settled = false;
    const settle = (failure: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(failure);
    };
    // `on`, not `once`, and never removed: an error arriving AFTER we settled
    // (a reset racing our own destroy) with no listener left is an uncaught
    // exception, which would take the whole vitest worker down rather than fail
    // one poll. Swallowing it is correct — the probe already has its answer.
    socket.on("error", (error: NodeJS.ErrnoException) =>
      settle(error.code ?? error.message ?? "unknown"),
    );
    socket.once("connect", () => settle(null));
  });
}
