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
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { cargoBinaries } from "../../../scripts/cargo-target.mjs";
import type { NativeLink } from "../src/native-link";

/** The cargo artifact for `-p field-native`: where the suites' build under
 * `nativeBuildEnv` lands, ASKED of cargo (`scripts/cargo-target.mjs`, tooling
 * (a) — the stage asks the same way). It was the literal
 * `<root>/target/debug/field-native`, which a CARGO_TARGET_DIR with no `target`
 * link beside it made a binary the build never wrote. The PACKAGE name never
 * carries a suffix — only the built file does, and only on win32. */
export function nativeBinPath(
  root: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const [floor] = cargoBinaries(root, "debug", ["field-native"], {
    env: nativeBuildEnv(root, env),
    platform,
  });
  if (floor === undefined) throw new Error("cargoBinaries answered no field-native");
  return floor.path;
}

/** Where the suites' `cargo build -p field-native` lands: where `nativeBinPath`
 * looks. A target directory the caller named stands (`CARGO_TARGET_DIR`, or
 * cargo's other spelling `CARGO_BUILD_TARGET_DIR`); with neither, the
 * checkout's OWN `target` — the real path behind its link when it has one.
 * Without this a user-wide `build.target-dir` wins over the link, and a lane's
 * run builds into another checkout's target and tests a binary it never built
 * (2026-10-17: a lane's vitest overwrote the main checkout's field-native). */
export function nativeBuildEnv(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (env["CARGO_TARGET_DIR"] || env["CARGO_BUILD_TARGET_DIR"]) return env;
  const own = join(root, "target");
  return { ...env, CARGO_TARGET_DIR: existsSync(own) ? realpathSync(own) : own };
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

/** The attributes of a log event that a row's evidence carries. Nothing else: the events beside them hold socket
 * paths, endpoints, boot ids and session tokens, and a cell's stderr `line` can carry its door URLs. The floor's
 * (class … error) and, since item 68, fieldd's (sessionId, profileId, how, outcome, terminated). */
const EVIDENCE_ATTRS = [
  "class",
  "role",
  "instance",
  "detail",
  "attribution",
  "evidence",
  "state",
  "reason",
  "error",
  "sessionId",
  "profileId",
  "how",
  "outcome",
  "terminated",
  // item 87 — how long a run's exit cleanup had been pending when it was warned
  "pendingMs",
  // item 121 — the class of the cell a refused re-attach's terminal was on (`fieldd.agents.reattach_refused_cell`)
  "workloadClass",
] as const;

/** The streams a real-floor row's evidence reads, under `<dataDir>/logs/system/`: the floor's (the suites set
 * FIELD_LOG_DIR to `<dataDir>/logs`) and fieldd's (the suites' `bootstrap({ logRoot: <dataDir>/logs })`, item 68 —
 * before it, fieldd logged nowhere in these suites). */
const EVIDENCE_STREAMS = [
  { tag: "floor", file: "field-native.ndjson" },
  { tag: "fieldd", file: "fieldd.ndjson" },
] as const;

/** Item 68 — what a real-floor row's evidence is read from: its floor's data dir (both logs live under it), when
 * the row spawned that floor (undefined for a restart's floor, spawned earlier), and the daemon's link to it. */
export interface FloorScene {
  dataDir: string;
  spawnedAt: number | undefined;
  link: Pick<NativeLink, "connected" | "terminalRoutes">;
}

/** Item 63 → item 68 (2026-10-26) — what a real floor and its daemon did, for the error a wait that gave up throws.
 *
 * A real-floor row's wait that timed out used to say only that it had ("poll timed out after 15000ms"), and the
 * logs that would have said why were deleted with the row's temp root. Four different rows cost a CI run that way
 * on 2026-10-26. This reads the floor's log and fieldd's own (merged by time, each line tagged with its source) and
 * fieldd's view of the link, so the error names the stalled step: a cell killed at its hello deadline
 * (`terminal.cell_ended`), a route snapshot never heard, a login pane's reap that never answered
 * (`fieldd.agents.login_started` with no `husk_reaped`), a re-read that failed (`login_finished … outcome`).
 * Times are ms since the spawn (since the logs' first event for a restart's floor); the last `limit` are shown. */
export function floorEvidence(scene: FloorScene, limit = 40): string {
  const routes = scene.link.terminalRoutes;
  const linkLine = `fieldd's link: ${scene.link.connected ? "connected" : "NOT connected"}; ${
    routes === undefined
      ? "no route snapshot heard (neither the hello nor a routes stream carried one)"
      : `routes heard at revision ${routes.revision}, ${routes.cells.length} cell(s)${
          routes.cells.length === 0
            ? ""
            : ` (${routes.cells
                .map(
                  (cell) =>
                    `${cell.cellInstanceId} ${cell.workloadClass ?? "?"}/${cell.role ?? "?"}`,
                )
                .join(", ")})`
        }`
  }`;
  const dir = join(scene.dataDir, "logs", "system");
  const events: Array<{ time: number; text: string }> = [];
  const missing: string[] = [];
  for (const stream of EVIDENCE_STREAMS) {
    const file = join(dir, stream.file);
    if (!existsSync(file)) {
      missing.push(stream.tag);
      continue;
    }
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      let record: {
        time?: unknown;
        event?: unknown;
        level?: unknown;
        attrs?: Record<string, unknown>;
      };
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof record.time !== "number" || typeof record.event !== "string") continue;
      const attrs = EVIDENCE_ATTRS.flatMap((key) =>
        record.attrs?.[key] === undefined ? [] : [`${key}=${JSON.stringify(record.attrs[key])}`],
      );
      const level =
        typeof record.level === "number" && record.level >= 40 ? ` [level ${record.level}]` : "";
      events.push({
        time: record.time,
        text: `${stream.tag} ${record.event}${level}${attrs.length ? ` ${attrs.join(" ")}` : ""}`,
      });
    }
  }
  const absent = missing.length === 0 ? "" : ` (no ${missing.join(" or ")} log at ${dir})`;
  if (events.length === 0) return `${linkLine}\nthe logs hold no event${absent}`;
  events.sort((a, b) => a.time - b.time);
  const base = scene.spawnedAt ?? events[0]?.time ?? 0;
  const shown = events.slice(-limit);
  return [
    linkLine,
    `the logs (${events.length} event(s)${shown.length < events.length ? `, the last ${shown.length}` : ""}; ms since ${scene.spawnedAt === undefined ? "their first event" : "the spawn"})${absent}:`,
    ...shown.map((event) => `  +${event.time - base} ${event.text}`),
  ].join("\n");
}

/** What a row reported it saw, rendered for an error: JSON, cut at 800 characters. */
function rendered(value: unknown): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  text ??= String(value);
  return text.length > 800 ? `${text.slice(0, 800)}… (${text.length} characters)` : text;
}

/** Item 68 — a real-floor row's wait that carries its evidence at its deadline. `fn` is asked every `intervalMs`
 * until it answers a value; it may call `seen(value)` with what it last observed (the persona, the row, the
 * screen — never a credential), and at the deadline the error says what was awaited, what the row last saw, and
 * `floorEvidence` of the row's `scene` (read at the deadline, so a row that re-booted its floor is read where it now
 * runs). The budget is the caller's; nothing here changes how long anything waits. Item 97 — `witness`, when
 * given, is asked ONCE, at the deadline, and its word follows what the row saw: what only the deadline may ask
 * (an `lsof`, a cell's own list), never asked per poll on the loaded hosts these waits fail on. */
export async function waitWithEvidence<T>(
  what: string,
  fn: (seen: (value: unknown) => void) => T | undefined | Promise<T | undefined>,
  ms: number,
  scene: () => FloorScene | undefined,
  intervalMs = 100,
  witness?: () => Promise<string>,
): Promise<T> {
  const deadline = Date.now() + ms;
  let last: unknown;
  let saw = false;
  const seen = (value: unknown): void => {
    last = value;
    saw = true;
  };
  for (;;) {
    const value = await fn(seen);
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      const witnessed =
        witness === undefined
          ? []
          : [
              await witness().catch(
                (error: unknown) =>
                  `the row's witness failed: ${error instanceof Error ? error.message : String(error)}`,
              ),
            ];
      const now = scene();
      throw new Error(
        [
          `${what} did not hold within ${ms} ms`,
          saw ? `the row last saw: ${rendered(last)}` : "the row reported nothing it saw",
          ...witnessed,
          now === undefined ? "no floor scene was recorded for this row" : floorEvidence(now),
        ].join("\n"),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
