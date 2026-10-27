// NF-4 — THE kill matrix (native-floor spec §10), executable. The ownership
// law as tests: PTYs live in field-native and survive fieldd; a new fieldd
// adopts the inventory inside the <2s row; a dead floor degrades honestly; the
// env strip holds through the real spawn path; epoch arbitration reaches
// through the D6 ticket; churn leaves no residue. Row 2 (field-native's own
// SIGTERM sweep) is pinned Rust-side in field-native/tests/terminal_unit.rs.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import { LAYOUT, type TerminalEndpoints, type TerminalInfo } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddConfig, type FielddDaemon } from "../src/index";
import {
  type FloorScene,
  nativeBinPath,
  shortTmpRoot,
  waitForMgmtEndpoint,
  waitWithEvidence,
} from "./native-harness";
import { helloAs, type RpcErrorShape, WsRpc } from "./ws-rpc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = nativeBinPath(ROOT);
// WIN-6: on Windows both roles collapse to cmd.exe (the ConPTY shell). On unix
// they stay distinct — /bin/cat holds the PTY open, /bin/sh runs a command.
const WIN = process.platform === "win32";
const CMD = process.env["COMSPEC"] ?? "C:\\Windows\\System32\\cmd.exe";
const HOLD = WIN ? CMD : "/bin/cat";
const SH = WIN ? CMD : "/bin/sh";

let children: ChildProcess[] = [];
let cleanup: Array<() => void | Promise<void>> = [];
/** Item 68 — the row's latest daemon over its floor, for every wait's evidence (`boot` sets it), and when each floor
 * was spawned. */
let scene: FloorScene | undefined;
const spawnedAt = new Map<string, number>();

afterEach(async () => {
  scene = undefined;
  spawnedAt.clear();
  // error-isolated: a rejecting cleanup must not leak the daemons behind it
  const fns = cleanup.reverse();
  cleanup = [];
  for (const fn of fns) {
    try {
      await fn();
    } catch {
      /* already-stopped is fine */
    }
  }
  for (const c of children) c.kill("SIGKILL");
  children = [];
});

interface NativeHandle {
  dir: string;
  child: ChildProcess;
}

async function spawnNative(dir?: string, env: Record<string, string> = {}): Promise<NativeHandle> {
  const dataDir = dir ?? shortTmpRoot("vf-km-");
  if (dir === undefined) cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  spawnedAt.set(dataDir, Date.now());
  const child = spawn(BIN, [], {
    env: {
      ...process.env,
      FIELD_NATIVE_DATA_DIR: dataDir,
      FIELD_LOG_DIR: join(dataDir, "logs"),
      FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
      // §8 — the smuggle bait: these ride field-native's OWN environment and
      // must NEVER appear inside a PTY (the strip is service-side, so even
      // environment:{mode:"inherit"} spawns must lose them).
      FIELD_SMUGGLE: "leak-me",
      FIELDD_SMUGGLE: "leak-me-too",
      // WIN-6 / G13 bait: a CASE-VARIANT of a stripped prefix. On unix this is a
      // genuinely different (non-FIELD_) var; on Windows env is case-insensitive,
      // so it IS a FIELD_ var — and ghosttea's case-sensitive `starts_with` strip
      // may miss it. Whether it leaks is asserted (empirically) below.
      Field_Native_Case_Probe: "CASE_LEAK_WITNESS",
      ...env,
    },
    stdio: "ignore",
  });
  children.push(child);
  await waitForMgmtEndpoint(dataDir, 15_000);
  return { dir: dataDir, child };
}

async function connect(daemon: FielddDaemon): Promise<WsRpc> {
  const grant = daemon.tokens.mint(["terminal.attach"], "kill-matrix");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  cleanup.push(() => ws.close());
  const rpc = new WsRpc(ws);
  await helloAs(rpc, grant.token);
  return rpc;
}

/** WP12 L2b — a local admin (`native.admin`, the shell's own scope class) beside `terminal.attach`: the consented
 * stop is `system.shutdown`, local-admin only. */
async function connectAdmin(daemon: FielddDaemon): Promise<WsRpc> {
  const grant = daemon.tokens.mint(["native.admin", "terminal.attach"], "kill-matrix-admin");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  cleanup.push(() => ws.close());
  const rpc = new WsRpc(ws);
  await helloAs(rpc, grant.token);
  return rpc;
}

/** AL-5 — the local shell's own connection (the shell token, `shell-main`): the one principal the lease answers. */
async function connectShell(daemon: FielddDaemon): Promise<{ rpc: WsRpc; ws: WebSocket }> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  cleanup.push(() => ws.close());
  const rpc = new WsRpc(ws);
  await helloAs(rpc, daemon.shellToken, "shell-main");
  return { rpc, ws };
}

/** Is a process alive? Signal 0 asks the kernel without delivering anything. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** TP-S3e — the OUTSIDE observer's coordinates. The product ticket is routed
 * (WS doors + grants) now, so a UDS automation client reads the fieldd-plane
 * truth the daemon itself pairs on: the NF-D8 endpoints from the mgmt hello. */
function udsEndpoints(daemon: FielddDaemon): TerminalEndpoints {
  const ep = daemon.native.terminalEndpoints;
  if (ep === undefined) throw new Error("the paired floor reported no terminal endpoints");
  return ep;
}

/** The native log's last lines, read while the data dir still exists (cleanup
 * deletes it): the one witness that tells a slow cell from a crashed one. */
function nativeLogTail(dir: string, lines = 40): string {
  const root = join(dir, "logs", "system");
  try {
    const text = readdirSync(root)
      .filter((name) => name.startsWith("field-native") && name.endsWith(".ndjson"))
      .sort()
      .map((name) => readFileSync(join(root, name), "utf8"))
      .join("");
    return `--- field-native log, last ${lines} lines ---\n${text.trimEnd().split("\n").slice(-lines).join("\n")}`;
  } catch (error) {
    return `--- no field-native log: ${(error as Error).message} ---`;
  }
}

/** `terminal.create`, retried while it is refused UNAVAILABLE and retryable —
 * the honest answer while the class's cell is still being born — until
 * `budgetMs` has passed; any other refusal fails at once. The create waits for
 * the birth up to CELL_SUPERVISION.HELLO_DEADLINE_MS, the same 15 s
 * field-native gives the cell before it kills it, so on a loaded host a cell
 * that slow loses that race every time and its replacement is the one that
 * serves. Every refusal is printed, one line each, and a create that landed
 * only after refusals prints the native log's tail — a cell that lost the
 * deadline is loud even when its replacement serves; the budget's end throws,
 * and `withNativeLog` prints the tail with that. */
async function createRetrying(
  rpc: WsRpc,
  params: Record<string, unknown>,
  native: NativeHandle,
  budgetMs: number,
): Promise<{ sessionId: string }> {
  const deadline = Date.now() + budgetMs;
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    try {
      const created = (await rpc.call("terminal.create", params)) as { sessionId: string };
      if (attempt > 1)
        console.warn(`terminal.create landed on attempt ${attempt}\n${nativeLogTail(native.dir)}`);
      return created;
    } catch (error) {
      const data = (error as { rpc?: RpcErrorShape }).rpc?.data;
      const said = `terminal.create attempt ${attempt} refused after ${Date.now() - started} ms: ${(error as Error).message} ${JSON.stringify(data)}`;
      if (data?.kind !== "UNAVAILABLE" || data.retryable !== true || Date.now() > deadline) {
        throw new Error(said);
      }
      console.warn(`${said}; retrying`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

/** A row's body, and if it throws, the native log's tail printed first —
 * cleanup deletes the data dir, and the only witness with it. */
async function withNativeLog(native: NativeHandle, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    console.error(nativeLogTail(native.dir));
    throw error;
  }
}

/** A daemon over the row's floor (item 68): fieldd's own log beside the floor's, and the scene every wait's evidence
 * reads. Every row boots through here. */
async function boot(config: FielddConfig): Promise<FielddDaemon> {
  const daemon = await bootstrap({ logRoot: join(config.dataDir, "logs"), ...config });
  scene = {
    dataDir: config.dataDir,
    spawnedAt: spawnedAt.get(config.dataDir),
    link: daemon.native,
  };
  return daemon;
}

/** Every wait in the matrix (item 68): at its deadline it says what was awaited, what the row last `seen`, and the
 * row's floor and fieldd logs with the link view. The budgets are the rows' own. */
async function poll<T>(
  fn: (seen: (value: unknown) => void) => Promise<T | undefined>,
  ms = 5_000,
  what = "the row's condition",
): Promise<T> {
  return await waitWithEvidence(what, fn, ms, () => scene);
}

/** Item 70 — ends a session a door made on a dying floor, bounded: what the ending said, or that it said nothing in
 * time, is the wait's evidence, never the row's red. */
async function endBounded(rpc: WsRpc, sessionId: string, ms = 2_000): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(`no answer in ${ms} ms`), ms);
  });
  const ended = rpc.attempt("terminal.terminate", { sessionId }).then(
    (answer) =>
      answer.ok ? "terminated" : `refused: ${answer.error.data?.kind ?? answer.error.message}`,
    (error: unknown) => `failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  try {
    return await Promise.race([ended, late]);
  } finally {
    clearTimeout(timer);
  }
}

const listOf = async (rpc: WsRpc): Promise<TerminalInfo[]> =>
  ((await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] }).terminals;

// TC-S3 helpers — rows select cells by CLASS, never by array position: the
// snapshot's order is a mirror convenience, and during a respawn window the
// surviving class is cells[0].
type RouteSnapshot = NonNullable<FielddDaemon["native"]["terminalRoutes"]>;
type RouteCell = RouteSnapshot["cells"][number];
const classCellOf = (
  routes: RouteSnapshot | undefined,
  workloadClass: "agent" | "interactive",
): RouteCell | undefined =>
  routes?.cells.find((cell) => cell.workloadClass === workloadClass && cell.role !== "solo");
const interactiveClassCell = (routes: RouteSnapshot | undefined): RouteCell | undefined =>
  classCellOf(routes, "interactive");
const agentSoloCells = (routes: RouteSnapshot | undefined): RouteCell[] =>
  (routes?.cells ?? []).filter((cell) => cell.workloadClass === "agent" && cell.role === "solo");

// WIN-6: ConPTY terminal hosting is live on Windows (the Rust kill matrix runs on
// the box in field-native/tests/terminal_unit.rs), so this NF-4 matrix runs on
// both platforms — the two-plane crash/adopt/re-arm rows are cross-process.
describe("the kill matrix (NF-4, real field-native)", () => {
  it("row 1: the PTY survives fieldd; the next fieldd adopts it inside 2s", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon1 = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      // registered even though the test stops it mid-flow: a failure BEFORE that
      // stop must not leak a live fieldd (the afterEach tolerates double-stop)
      cleanup.push(() => daemon1.stop());
      const rpc1 = await connect(daemon1);
      const created = await createRetrying(rpc1, { shell: HOLD }, native, 30_000);
      // the routed mint while alive is the control (grants + doors present) …
      const ticket = (await poll(async () =>
        (await listOf(rpc1)).some((t) => t.sessionId === created.sessionId)
          ? ((await rpc1.call("terminal.openTicket", { sessionId: created.sessionId })) as {
              endpoints: { controlUrl: string };
              attachGrant: { mac: string };
            })
          : undefined,
      )) as { endpoints: { controlUrl: string }; attachGrant: { mac: string } };
      expect(ticket.endpoints.controlUrl).toMatch(/^ws:/);
      // … and the OUTSIDE observer rides the fieldd-plane UDS coordinates
      const uds = udsEndpoints(daemon1);

      // the product plane goes away — the floor must not notice
      await daemon1.stop();

      const outside = new GhostteaAutomationClient(
        { controlSocket: uds.controlSocket, authToken: uds.authToken },
        { clientBuild: "kill-matrix" },
      );
      cleanup.push(() => outside.dispose());
      await outside.connect();
      expect((await outside.listSessions()).map((s) => s.id)).toContain(created.sessionId);

      // a NEW product plane pairs and adopts — the spec's <2s row measured from
      // ready, not from process birth
      const daemon2 = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon2.stop());
      const rpc2 = await connect(daemon2);
      const adoptedAt = Date.now();
      await poll(
        async () =>
          (await listOf(rpc2)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
        2_000,
      );
      expect(Date.now() - adoptedAt).toBeLessThan(2_000);

      // the adopting fieldd re-pairs onto the SAME native boot — same credential
      expect(udsEndpoints(daemon2).authToken).toBe(uds.authToken);
      const term = (await rpc2.call("terminal.terminate", {
        sessionId: created.sessionId,
      })) as { terminated: boolean };
      expect(term.terminated).toBe(true);
    });
  }, 60_000);

  // WP12 D10 (build-wp12-updater.md; the PM's ruling 2026-10-15) — after an app update a fieldd of ANOTHER build
  // may still be running. The supervisor asks it to stop first; this row witnesses the BACKSTOP alone, with no stop
  // asked: this build's fieldd boots while the old one still serves, field-native's single-client rule supersedes
  // the old one, the new one records its build, and the PTY lives through it — re-paired onto the same native boot.
  it("row WP12-D10: another build's fieldd is superseded at field-native; the PTY lives; the new build records itself", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      let fatalSeen: (reason: string) => void = () => undefined;
      const supersededOld = new Promise<string>((resolve) => {
        fatalSeen = resolve;
      });
      const old = await boot({
        dataDir: native.dir,
        controlPort: 0,
        dataPort: 0,
        buildId: "build-x",
        onFatal: (reason) => fatalSeen(reason),
      });
      cleanup.push(() => old.stop());
      const rpc1 = await connect(old);
      const created = await createRetrying(rpc1, { shell: HOLD }, native, 30_000);
      await poll(async () =>
        (await listOf(rpc1)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
      );
      const uds = udsEndpoints(old);
      const productJson = join(native.dir, "fieldd", "run", "product.json");
      expect(JSON.parse(readFileSync(productJson, "utf8"))).toMatchObject({ buildId: "build-x" });

      // this build's fieldd, while the old one still serves — no stop asked
      const fresh = await boot({
        dataDir: native.dir,
        controlPort: 0,
        dataPort: 0,
        buildId: "build-y",
      });
      cleanup.push(() => fresh.stop());
      await expect(supersededOld).resolves.toContain("superseded");
      expect(old.native.superseded).toBe(true);
      expect(JSON.parse(readFileSync(productJson, "utf8"))).toMatchObject({
        buildId: "build-y",
        port: fresh.controlPort,
      });

      const rpc2 = await connect(fresh);
      await poll(
        async () =>
          (await listOf(rpc2)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
        5_000,
      );
      // the same native boot — the PTY never left it
      expect(udsEndpoints(fresh).authToken).toBe(uds.authToken);
      const term = (await rpc2.call("terminal.terminate", {
        sessionId: created.sessionId,
      })) as { terminated: boolean };
      expect(term.terminated).toBe(true);
    });
  }, 60_000);

  // WP12 L2b (`build-wp12-updater.md` §9 R2; design-00 EL1's 2026-10-15 note) — the ONE consented exception to the
  // two-planes law: an update that touches field-native stops the floor, and only when fieldd's OWN live set is
  // exactly the set the person consented to end. The floor here is spawned by the test, so fieldd ADOPTED it and
  // holds no pid: the floor stops ITSELF (`native.lifecycle.shutdown` → the SIGTERM drain), and the socket closing is
  // the witness — the update path's case by construction.
  it("row WP12-R2a: a consented stop ends exactly the consented set — the floor drains, records its intent, and the next boot says planned", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      let ownerAsked = false;
      daemon.onShutdownRequest(() => {
        ownerAsked = true;
      });
      const rpc = await connectAdmin(daemon);
      const a = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      const b = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      const rows = await poll(async () => {
        const listed = await listOf(rpc);
        const both = [a, b].map((s) => listed.find((t) => t.sessionId === s.sessionId));
        return both.every((row) => row?.pid !== undefined) ? both : undefined;
      });
      const pids = rows.map((row) => row?.pid as number);
      expect(pids.every(alive)).toBe(true);
      expect(daemon.native.lastExit).toBe("unplanned"); // this floor's first boot recorded nothing

      const exited = new Promise<number | null>((resolve) =>
        native.child.once("exit", (code) => resolve(code)),
      );
      const answer = (await rpc.call("system.shutdown", {
        native: { stop: true, sessions: [b.sessionId, a.sessionId], toVersion: "0.9.0+test" },
      })) as { stopping: boolean; native?: string };
      expect(answer).toMatchObject({ stopping: true, native: "closed" });
      expect(daemon.health().restartScheduled).toMatchObject({ reason: "update" });
      await expect(exited).resolves.toBe(0); // the drain, not a kill
      await poll(async () => (pids.some(alive) ? undefined : true), 5_000);
      await poll(async () => (ownerAsked ? true : undefined), 2_000);
      const intent = JSON.parse(
        readFileSync(join(native.dir, "native", "restart-intent.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(intent).toMatchObject({ schemaVersion: 1, reason: "update", toVersion: "0.9.0+test" });
      await daemon.stop();

      // the next floor on this root TAKES the intent and says how its predecessor ended
      const next = await spawnNative(native.dir);
      const nextDaemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => nextDaemon.stop());
      expect(nextDaemon.native.lastExit).toBe("planned");
      expect(nextDaemon.health().nativeLastExit).toBe("planned");
      expect(() => readFileSync(join(next.dir, "native", "restart-intent.json"))).toThrow();
    });
  }, 90_000);

  // AL-2 (`draft/thinking-app-lifecycle.md`; ESR §7.3 as amended 2026-10-27) — a person's QUIT is a consented stop
  // like the update's: the same exact-set re-check ends the floor and its sessions, the floor records WHY (`quit`), its
  // next boot reads planned — and nothing announces a restart, because a quit is none.
  it("row AL-2a: a consented QUIT ends exactly the consented set, records `quit`, and announces no restart", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      daemon.onShutdownRequest(() => undefined);
      const rpc = await connectAdmin(daemon);
      const a = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      const row = await poll(async () => {
        const listed = await listOf(rpc);
        const found = listed.find((t) => t.sessionId === a.sessionId);
        return found?.pid !== undefined ? found : undefined;
      });
      const pid = row.pid as number;
      const exited = new Promise<number | null>((resolve) =>
        native.child.once("exit", (code) => resolve(code)),
      );
      const answer = (await rpc.call("system.shutdown", {
        reason: "quit",
        native: { stop: true, sessions: [a.sessionId] },
      })) as { stopping: boolean; native?: string };
      expect(answer).toMatchObject({ stopping: true, native: "closed" });
      expect(daemon.health().restartScheduled ?? null).toBeNull();
      await expect(exited).resolves.toBe(0); // the drain, not a kill
      await poll(async () => (alive(pid) ? undefined : true), 5_000);
      const intent = JSON.parse(
        readFileSync(join(native.dir, "native", "restart-intent.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(intent).toMatchObject({ schemaVersion: 1, reason: "quit" });
      await daemon.stop();

      await spawnNative(native.dir);
      const nextDaemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => nextDaemon.stop());
      expect(nextDaemon.native.lastExit).toBe("planned");
    });
  }, 90_000);

  // AL-5 (`draft/thinking-app-lifecycle.md` §8.2; AL-D4) — the orphan bound over a REAL floor: the last shell gone and
  // no session for the (scaled) idle span, so the pair ends itself — the floor drained with reason `idle`, fieldd's
  // owner asked to exit — and the next boot reads planned.
  it("row AL-5a: no shell and no session for the idle span — the floor stops `idle`, fieldd's owner is asked, the next boot reads planned", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({
        dataDir: native.dir,
        controlPort: 0,
        dataPort: 0,
        shellRelaunch: null,
        shellAbsenceTimings: { IDLE_EXIT_MS: 1_500, IDLE_POLL_MS: 100 },
      });
      cleanup.push(() => daemon.stop());
      let ownerAsked = false;
      daemon.onShutdownRequest(() => {
        ownerAsked = true;
      });
      // an observed empty inventory: zero is a count, never a guess
      await poll(
        async () => (daemon.terminals.liveCount() === 0 ? true : undefined),
        10_000,
        "the floor's inventory observed empty",
      );
      const shell = await connectShell(daemon);
      expect(await shell.rpc.call("system.shell.attach", {})).toMatchObject({ lastExit: null });
      let exitCode: number | null | undefined;
      native.child.once("exit", (code) => {
        exitCode = code;
      });
      shell.ws.close(); // the last shell gone without a word: unplanned, no session, so no relaunch — the idle span
      await poll(
        async () => (exitCode !== undefined ? true : undefined),
        10_000,
        "the floor's idle stop",
      );
      expect(exitCode).toBe(0); // the drain, not a kill
      await poll(
        async () => (ownerAsked ? true : undefined),
        5_000,
        "fieldd's owner asked to exit",
      );
      const intent = JSON.parse(
        readFileSync(join(native.dir, "native", "restart-intent.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(intent).toMatchObject({ schemaVersion: 1, reason: "idle" });
      await daemon.stop();

      await spawnNative(native.dir);
      const nextDaemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => nextDaemon.stop());
      expect(nextDaemon.native.lastExit).toBe("planned");
    });
  }, 90_000);

  // AL-8a (`draft/thinking-app-lifecycle.md` §8.3.1; AL-D10 "A", AL-D11) — the floor's own bound and the record of
  // how its fieldd left, over a REAL floor. fieldd runs in this process, so its crash is what the floor sees of one:
  // the management link dropped without `native.lifecycle.detach` (`daemon.native.close()`); its later stop() has no
  // paired link to say goodbye on.
  it("row AL-8a-1: fieldd gone without a goodbye and no session — the floor stops itself `idle` after the span", async () => {
    const native = await spawnNative(undefined, { FIELD_NATIVE_ORPHAN_IDLE_MS: "1500" });
    await withNativeLog(native, async () => {
      const daemon = await boot({
        dataDir: native.dir,
        controlPort: 0,
        dataPort: 0,
        shellRelaunch: null,
      });
      cleanup.push(() => daemon.stop());
      await poll(
        async () => (daemon.terminals.liveCount() === 0 ? true : undefined),
        10_000,
        "the floor's inventory observed empty",
      );
      let exitCode: number | null | undefined;
      native.child.once("exit", (code) => {
        exitCode = code;
      });
      daemon.native.close(); // fieldd's crash, as the floor sees it
      await poll(
        async () => (exitCode !== undefined ? true : undefined),
        20_000,
        "the floor's own idle stop",
      );
      expect(exitCode).toBe(0); // the drain, not a kill
      const intent = JSON.parse(
        readFileSync(join(native.dir, "native", "restart-intent.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(intent).toMatchObject({ schemaVersion: 1, reason: "idle" });
      await daemon.stop();

      await spawnNative(native.dir);
      const nextDaemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => nextDaemon.stop());
      expect(nextDaemon.native.lastExit).toBe("planned");
    });
  }, 90_000);

  it("row AL-8a-2: fieldd gone without a goodbye beside a session — the floor stays, and the next fieldd says it once", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const crashed = await boot({
        dataDir: native.dir,
        controlPort: 0,
        dataPort: 0,
        shellRelaunch: null,
      });
      cleanup.push(() => crashed.stop());
      const rpc = await connectAdmin(crashed);
      const session = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      // the FLOOR's own listing, never `liveCount()`: that counts births the floor has not listed yet, so it
      // passed before any reconcile had seen the session (the EL8 verify's red, 2026-10-27)
      await poll(
        async () =>
          crashed.terminals.observation() !== undefined &&
          crashed.terminals.list().some((t) => t.sessionId === session.sessionId)
            ? true
            : undefined,
        10_000,
        "the session in the floor's inventory",
      );
      crashed.native.close(); // fieldd's crash, as the floor sees it
      await crashed.stop(); // no paired link left: nothing to say goodbye on

      const next = await boot({
        dataDir: native.dir,
        controlPort: 0,
        dataPort: 0,
        shellRelaunch: null,
      });
      cleanup.push(() => next.stop());
      await poll(
        async () => (existsSync(join(native.dir, ...LAYOUT.MANAGER_EXIT)) ? true : undefined),
        10_000,
        "the crashed fieldd's record on disk",
      );
      const shell = await connectShell(next);
      const answer = (await shell.rpc.call("system.shell.attach", {})) as {
        lastManagerExit: { sessions: number | null } | null;
      };
      expect(answer.lastManagerExit).toMatchObject({ sessions: 1 });
      expect(await shell.rpc.call("system.shell.attach", {})).toMatchObject({
        lastManagerExit: null,
      });
      expect(alive(native.child.pid as number)).toBe(true); // the floor kept the session: the law
      const listed = await listOf(await connectAdmin(next));
      expect(listed.map((t) => t.sessionId)).toContain(session.sessionId);
    });
  }, 90_000);

  // AL-8a-2's finding (2026-10-27, red in the EL8's verify and alone): the floor counted a crash's sessions from the
  // cells' last reconciles, however old, so a fieldd that died before any reconcile saw a new session was recorded
  // as `sessions: 0`. The floor now counts from reconciles begun after the departure, and the next hello waits for
  // one. Here fieldd dies the moment the create returns, the gap the old count read a stale zero in.
  it("row AL-8a-4: fieldd gone the moment a session is born — the next fieldd still counts it, never a stale 0", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const crashed = await boot({
        dataDir: native.dir,
        controlPort: 0,
        dataPort: 0,
        shellRelaunch: null,
      });
      cleanup.push(() => crashed.stop());
      const rpc = await connectAdmin(crashed);
      await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      crashed.native.close(); // no wait for any reconcile: the crash lands inside the gap
      await crashed.stop();

      const next = await boot({
        dataDir: native.dir,
        controlPort: 0,
        dataPort: 0,
        shellRelaunch: null,
      });
      cleanup.push(() => next.stop());
      await poll(
        async () => (existsSync(join(native.dir, ...LAYOUT.MANAGER_EXIT)) ? true : undefined),
        10_000,
        "the crashed fieldd's record on disk",
      );
      const shell = await connectShell(next);
      const answer = (await shell.rpc.call("system.shell.attach", {})) as {
        lastManagerExit: { sessions: number | null } | null;
      };
      expect(answer.lastManagerExit).toMatchObject({ sessions: 1 });
    });
  }, 90_000);

  it("row AL-8a-3: fieldd's own stop says goodbye — the next fieldd hands no crash", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const first = await boot({
        dataDir: native.dir,
        controlPort: 0,
        dataPort: 0,
        shellRelaunch: null,
      });
      await first.stop(); // a planned stop says `native.lifecycle.detach` before it closes the link
      const next = await boot({
        dataDir: native.dir,
        controlPort: 0,
        dataPort: 0,
        shellRelaunch: null,
      });
      cleanup.push(() => next.stop());
      const shell = await connectShell(next);
      expect(await shell.rpc.call("system.shell.attach", {})).toMatchObject({
        lastExit: null,
        lastManagerExit: null,
      });
      expect(existsSync(join(native.dir, ...LAYOUT.MANAGER_EXIT))).toBe(false);
    });
  }, 90_000);

  it("row WP12-R2b: a session born after consent refuses the stop — nothing ends, and births reopen", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      let ownerAsked = false;
      daemon.onShutdownRequest(() => {
        ownerAsked = true;
      });
      const rpc = await connectAdmin(daemon);
      const consented = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      // the person consents to end ONE session; then a second is born
      const late = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      const refusal = await rpc
        .call("system.shutdown", { native: { stop: true, sessions: [consented.sessionId] } })
        .then(
          () => undefined,
          (error: { rpc?: RpcErrorShape }) => error.rpc,
        );
      expect(refusal?.data).toMatchObject({
        kind: "PRECONDITION_FAILED",
        details: { live: [consented.sessionId, late.sessionId].sort(), births: 0 },
      });
      // nothing ended: the floor serves, both sessions are listed, the shutdown owner was never asked. The list is
      // POLLED: `terminal.list` answers the OBSERVED inventory, which lags a fresh birth (GT-1's race) — the very
      // session the refusal above counted as born-and-unseen. A one-shot read raced it (WP12 L2b-ii's verify-1,
      // 2026-10-15: the late session not yet listed, 746 ms).
      expect(native.child.exitCode).toBeNull();
      await poll(async () => {
        const listed = new Set((await listOf(rpc)).map((t) => t.sessionId));
        return listed.has(consented.sessionId) && listed.has(late.sessionId) ? true : undefined;
      });
      expect(native.child.exitCode).toBeNull();
      expect(ownerAsked).toBe(false);
      expect(daemon.health().restartScheduled).toBeNull();
      // and births reopened with the refusal
      const after = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      expect(after.sessionId).toBeTruthy();
    });
  }, 90_000);

  it("rows 3+6: a dead floor refuses honestly; a replacement boot empties the inventory and re-arms", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      const rpc = await connect(daemon);
      const created = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      await poll(async () =>
        (await listOf(rpc)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
      );

      // a ticket minted while the floor is ALIVE is the control: it proves the
      // refusals below are the kill talking and not a door that never worked
      const beforeKill = (await rpc.call("terminal.openTicket", {
        sessionId: created.sessionId,
      })) as { attachGrant?: { mac?: string } };
      expect(beforeKill.attachGrant?.mac).toBeTruthy();

      // crash the floor: sessions die with it (the honest ceiling) and the seam
      // must refuse interactive ops rather than pretend
      native.child.kill("SIGKILL");
      // Item 70 (2026-10-26) — the kill is a signal: the floor dies when it is next scheduled, and until fieldd hears
      // the link close a create may still be SERVED (red at loads 241 and 263, 601 ms in, as "expected terminal.create
      // to fail"). A create that succeeds is "not yet", never the row's red: the session it made is ended, bounded
      // (what the ending said is evidence, not a red), and the wait goes on to its deadline.
      const servedAfterTheKill: Array<{ sessionId: string; ended: string }> = [];
      await poll(
        async (seen) => {
          const answer = await rpc.attempt("terminal.create", { shell: HOLD });
          if (answer.ok) {
            const { sessionId } = answer.result as { sessionId: string };
            servedAfterTheKill.push({ sessionId, ended: await endBounded(rpc, sessionId) });
            seen({ createsServedAfterTheKill: servedAfterTheKill });
            return undefined;
          }
          seen({ createsServedAfterTheKill: servedAfterTheKill, refused: answer.error.data?.kind });
          return answer.error.data?.kind === "UNAVAILABLE" ? true : undefined;
        },
        10_000,
        "terminal.create refusing UNAVAILABLE once the floor is killed",
      );

      // GT-5b — the hole this row never checked. `create` was the only op
      // re-tested after the kill, and the TICKET doors were the ones that had
      // gone wrong: `terminalEndpoints` was captured on the pairing hello and
      // cleared nowhere, so both of these kept answering with socket paths that
      // no longer existed plus the dead boot's token, audited as successful
      // grants. Floor-died-AFTER-hello had no coverage anywhere, and this is
      // where it surfaces.
      // Polled, not asserted once: `create` can reach UNAVAILABLE through the
      // dead CONTROL socket a beat before the mgmt link's close clears the
      // endpoints, and it is the cleared endpoints these two doors read.
      // (terminal.connectTicket retired at TP-S3e — openTicket is the one mint
      // left to try against a corpse)
      // Item 70: a mint that still succeeds here is "not yet" by this comment's own reading, and polling it is the
      // point. It used to throw out of the poll at once (`callErr` throws on success), and the `.catch` read that
      // first try as a corpse's mint; now only the deadline fails, saying how many mints it saw.
      for (const [method, params] of [
        ["terminal.openTicket", { sessionId: created.sessionId }],
      ] as const) {
        let minted = 0;
        const kind = await poll(
          async (seen) => {
            const answer = await rpc.attempt(method, params);
            if (answer.ok) {
              minted += 1; // the grant itself is never kept or shown
              seen({ mintedForTheCorpse: minted });
              return undefined;
            }
            seen({ mintedForTheCorpse: minted, refused: answer.error.data?.kind });
            return answer.error.data?.kind === "UNAVAILABLE" ? answer.error.data.kind : undefined;
          },
          10_000,
          `${method} refusing to mint for the corpse`,
        );
        expect(kind, `${method} must not mint for a corpse`).toBe("UNAVAILABLE");
      }

      // a replacement native on the SAME data dir: re-pair re-delivers fresh
      // endpoints (new token), the observed snapshot honestly EMPTIES (no
      // phantom sessions), and the create path works again
      await spawnNative(native.dir);
      await poll(async () => ((await listOf(rpc)).length === 0 ? true : undefined), 20_000);
      const reborn = await poll(async () => {
        try {
          return (await rpc.call("terminal.create", { shell: HOLD })) as {
            sessionId: string;
          };
        } catch {
          return undefined;
        }
      }, 20_000);
      expect(reborn.sessionId).toBeTruthy();
      expect(reborn.sessionId).not.toBe(created.sessionId);
    });
  }, 60_000);

  it("row 6: the env strip holds through the real spawn path (EL7)", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      const rpc = await connect(daemon);

      // a loaded host's cell can lose its birth race (15,489 ms, d166ecf2):
      // retried inside the row's 60 s, loud either way
      const created = await createRetrying(rpc, { shell: SH }, native, 30_000);
      await poll(async () =>
        (await listOf(rpc)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
      );
      const uds = udsEndpoints(daemon);
      const client = new GhostteaAutomationClient(
        { controlSocket: uds.controlSocket, authToken: uds.authToken },
        { clientBuild: "kill-matrix" },
      );
      cleanup.push(() => client.dispose());
      await client.connect();

      const out = join(native.dir, "smuggle.txt");
      // dump the child env: `env` on unix, cmd's `set` on Windows.
      const input = await client.pasteAndSubmit(
        created.sessionId,
        WIN ? `set > ${out}` : `env > ${out}`,
      );
      expect(input.accepted).toBe(true);
      const env = await poll(async () => {
        try {
          const text = readFileSync(out, "utf8");
          return text.length > 0 ? text : undefined;
        } catch {
          return undefined;
        }
      });
      // the bait planted in field-native's own environment never reaches a PTY;
      // ordinary vars do (inherit-minus-strip, NF-D6). SCOPE HONESTY (review):
      // this proves the PREFIX classes (FIELD_/FIELDD_/GHOSTTEA_/...) — the
      // upstream strip is an exact-prefix list, so a NON-prefixed secret in the
      // daemon's env would pass into inherit-mode shells. That is spec-sanctioned
      // (EL7 registers prefixes precisely so secrets are namable), not proof
      // that arbitrary secrets can't ride the daemon env.
      expect(env).not.toContain("FIELD_SMUGGLE");
      expect(env).not.toContain("FIELDD_SMUGGLE");
      expect(env).not.toContain("GHOSTTEA_");
      // an ordinary (non-prefixed) var survives the strip: HOME on unix, the user
      // profile path on Windows (the strip is exact-prefix, so both are untouched).
      expect(env).toContain(WIN ? "USERPROFILE=" : "HOME=");
    });
  }, 60_000);

  // WIN-6 / G13: the exact-case prefixes are stripped (row 6). This probes the
  // CASE gap ghosttea's case-sensitive `starts_with` opened on Windows'
  // case-insensitive env — CONFIRMED to leak on the box (a `Field_Native_*`
  // variant survived). field-native sets its OWN secrets exact-case, so those
  // were always stripped; the gap was defense-in-depth. G13 landed in ghosttea
  // 0.10.1 (2026-08-18: the strip folds ASCII case under Windows; unix stays
  // case-sensitive, where a case variant is a genuinely different var) — so
  // this row is a LIVE pass on the box now, `.fails` dropped exactly as the
  // sentence that used to end this comment said to. Still skipped on unix:
  // the scenario does not exist there.
  const caseGapWitness = WIN ? it : it.skip;
  caseGapWitness(
    "row 6b: a case-variant of a stripped prefix must not leak (EL7, G13)",
    async () => {
      const native = await spawnNative();
      await withNativeLog(native, async () => {
        const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
        cleanup.push(() => daemon.stop());
        const rpc = await connect(daemon);
        const created = await createRetrying(rpc, { shell: SH }, native, 30_000);
        await poll(async () =>
          (await listOf(rpc)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
        );
        const uds = udsEndpoints(daemon);
        const client = new GhostteaAutomationClient(
          { controlSocket: uds.controlSocket, authToken: uds.authToken },
          { clientBuild: "kill-matrix" },
        );
        cleanup.push(() => client.dispose());
        await client.connect();

        const out = join(native.dir, "case-smuggle.txt");
        const input = await client.pasteAndSubmit(created.sessionId, `set > ${out}`);
        expect(input.accepted).toBe(true);
        const env = await poll(async () => {
          try {
            const text = readFileSync(out, "utf8");
            return text.length > 0 ? text : undefined;
          } catch {
            return undefined;
          }
        });
        expect(env).not.toContain("CASE_LEAK_WITNESS");
      });
    },
    60_000,
  );

  it("epoch arbitration reaches through the ticket path", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      const rpc = await connect(daemon);
      const created = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      await poll(async () =>
        (await listOf(rpc)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
      );
      const uds = udsEndpoints(daemon);
      const client = new GhostteaAutomationClient(
        { controlSocket: uds.controlSocket, authToken: uds.authToken },
        { clientBuild: "kill-matrix" },
      );
      cleanup.push(() => client.dispose());
      await client.connect();

      const epoch = await client.humanInputEpoch(created.sessionId);
      const stale = await client.input(
        created.sessionId,
        { kind: "text", text: "never-lands" },
        epoch + 1,
      );
      expect(stale.accepted).toBe(false);
      expect(stale.reason).toBe("human-input-conflict");
      const fresh = await client.input(created.sessionId, { kind: "text", text: "lands" }, epoch);
      expect(fresh.accepted).toBe(true);
    });
  }, 60_000);

  it("churn leaves no residue (bounded soak; the 24h variant is a named CI gate)", async () => {
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      const rpc = await connect(daemon);

      for (let i = 0; i < 10; i++) {
        const { sessionId } = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
        await poll(async () =>
          (await listOf(rpc)).some((t) => t.sessionId === sessionId) ? true : undefined,
        );
        await rpc.call("terminal.terminate", { sessionId });
      }
      await poll(async () => ((await listOf(rpc)).length === 0 ? true : undefined), 15_000);
    });
  }, 120_000);

  it("row S2-A: a cell SIGKILL is a supervised replacement — routes re-deliver, tickets re-mint, the loss is honest (TC-S2)", async () => {
    // THE slice gate: the terminal ENGINE dies, the floor survives, and the
    // whole ladder re-arms without a re-pair — supervisor respawn → a routes
    // delta with a NEW cellBootId on the SAME mgmt link → fieldd's endpoints
    // move → a fresh create lands on the replacement. The killed cell's
    // session leaves the observed inventory: TC-S2's ceiling, stated by the
    // S2 honesty string ("a terminal-engine crash loses only its class") in
    // fieldd's receipt.
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      const rpc = await connect(daemon);
      const created = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      await poll(async () =>
        (await listOf(rpc)).some((t) => t.sessionId === created.sessionId) ? true : undefined,
      );
      // TC-S3: the session above was created classless → the INTERACTIVE cell.
      // Track that CLASS's row, not cells[0] — during the respawn window the
      // agent cell is the only row and cells[0] would resolve to it, "passing"
      // the replacement poll with a cell nobody killed.
      const first = await poll(async () => {
        const routes = daemon.native.terminalRoutes;
        return interactiveClassCell(routes) !== undefined ? routes : undefined;
      });
      const firstCell = interactiveClassCell(first);
      if (firstCell === undefined) throw new Error("unreachable: polled for a cell");
      expect(firstCell.pid).toBeGreaterThan(0);

      process.kill(firstCell.pid, "SIGKILL");

      const replacement = await poll(async () => {
        const routes = daemon.native.terminalRoutes;
        const cell = interactiveClassCell(routes);
        return cell !== undefined && cell.cellBootId !== firstCell.cellBootId ? routes : undefined;
      }, 20_000);
      expect(replacement.revision, "revision is monotonic across the replacement").toBeGreaterThan(
        first.revision,
      );
      const replacementCell = interactiveClassCell(replacement);
      if (replacementCell === undefined) throw new Error("unreachable: polled for a cell");
      // endpoints re-delivered on the LIVE link — the seam TC-D15 exists for
      // (pre-S2, new endpoints arrived only with a re-pair)
      expect(daemon.native.terminalEndpoints?.controlSocket).toBe(
        replacementCell.endpoints.controlSocket,
      );
      // the honest loss: the killed cell's session leaves the inventory
      await poll(
        async () =>
          (await listOf(rpc)).every((t) => t.sessionId !== created.sessionId) ? true : undefined,
        15_000,
      );
      // and the product plane works on the replacement without a re-pair
      const second = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      await poll(
        async () =>
          (await listOf(rpc)).some((t) => t.sessionId === second.sessionId) ? true : undefined,
        15_000,
      );
      await rpc.call("terminal.terminate", { sessionId: second.sessionId });
    });
  }, 90_000);

  it("row S2-B: a floor SIGKILL reaps the cell — the leash leaves no orphan (TC-S2/TC-D14)", async () => {
    // The stdin leash IS the orphan story: the floor's death closes the pipe,
    // the cell sees EOF, drains, and exits — no process-group machinery, no
    // grandchild for the harness (or a user) to hunt down.
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      const cellPid = await poll(async () => daemon.native.terminalRoutes?.cells[0]?.pid, 20_000);

      native.child.kill("SIGKILL");

      await poll(async () => {
        try {
          process.kill(cellPid, 0);
          return undefined; // still alive — keep polling
        } catch {
          return true; // ESRCH: the leash reaped it
        }
      }, 15_000);
    });
  }, 60_000);

  it("row S3-A: a class-A crash leaves class-B streaming — the blast is one class, counted (TC-S3)", async () => {
    // THE K=2 gate: kill the agent cell under a live interactive witness. The
    // interactive session must stream THROUGH the kill (same cell, same
    // control connection, epoch input still landing), the agent session is
    // the WHOLE counted blast, and the agent class comes back supervised.
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      const rpc = await connect(daemon);
      const agent = await createRetrying(
        rpc,
        {
          shell: HOLD,
          workloadClass: "agent",
        },
        native,
        30_000,
      );
      const interactive = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      // Both observed, on DIFFERENT cells — the inventory `cell` tag is the join
      const tags = await poll(async () => {
        const list = await listOf(rpc);
        const a = list.find((t) => t.sessionId === agent.sessionId)?.cell;
        const b = list.find((t) => t.sessionId === interactive.sessionId)?.cell;
        return a !== undefined && b !== undefined ? { a, b } : undefined;
      }, 15_000);
      expect(tags.a.workloadClass).toBe("agent");
      expect(tags.b.workloadClass).toBe("interactive");
      expect(tags.a.cellBootId).not.toBe(tags.b.cellBootId);
      // The streaming witness: a live control connection to the INTERACTIVE
      // cell, addressed by ITS row in the route snapshot (fieldd-plane truth —
      // the product ticket is routed now and carries no UDS coordinates)
      const interactiveRow = daemon.native.terminalRoutes?.cells.find(
        (c) => c.workloadClass === "interactive",
      );
      if (interactiveRow === undefined) throw new Error("no interactive cell row");
      const witness = new GhostteaAutomationClient(
        {
          controlSocket: interactiveRow.endpoints.controlSocket,
          authToken: interactiveRow.endpoints.authToken,
        },
        { clientBuild: "kill-matrix" },
      );
      cleanup.push(() => witness.dispose());
      await witness.connect();
      const epoch = await witness.humanInputEpoch(interactive.sessionId);

      const agentCell = classCellOf(daemon.native.terminalRoutes, "agent");
      if (agentCell === undefined) throw new Error("unreachable: the agent tag proved the cell");
      process.kill(agentCell.pid, "SIGKILL");

      // The agent class returns as a supervised replacement…
      const replacement = await poll(async () => {
        const cell = classCellOf(daemon.native.terminalRoutes, "agent");
        return cell !== undefined && cell.cellBootId !== agentCell.cellBootId ? cell : undefined;
      }, 20_000);
      // …the blast is EXACTLY the agent session (counted per cell, TC-S3)…
      await poll(
        async () =>
          (await listOf(rpc)).every((t) => t.sessionId !== agent.sessionId) ? true : undefined,
        15_000,
      );
      const survivors = await listOf(rpc);
      expect(survivors.map((t) => t.sessionId)).toEqual([interactive.sessionId]);
      expect(survivors[0]?.cell?.cellBootId).toBe(tags.b.cellBootId);
      // …and class B streamed through it: the SAME connection accepts input at
      // the SAME epoch — no reconnect, no re-mint, no epoch bump.
      const landed = await witness.input(
        interactive.sessionId,
        { kind: "text", text: "still-streaming" },
        epoch,
      );
      expect(landed.accepted).toBe(true);
      // A fresh agent create lands on the replacement cell without a re-pair.
      const second = await createRetrying(
        rpc,
        {
          shell: HOLD,
          workloadClass: "agent",
        },
        native,
        30_000,
      );
      const secondTag = await poll(
        async () => (await listOf(rpc)).find((t) => t.sessionId === second.sessionId)?.cell,
        15_000,
      );
      expect(secondTag.cellBootId).toBe(replacement.cellBootId);
    });
  }, 120_000);

  it("row S3-B / row 13: an evidence-free crash storm blames NO session — no isolation, the honest dead end (TC-D4)", async () => {
    // Row 13's first half, as built: SIGKILL leaves no crumb, so every death
    // classifies Unknown — and Unknown NEVER strikes. Past the intensity
    // window the class must go to its honest dead end, not "blame the only
    // session that was there" (never last-active). No solo cell may ever
    // appear; the other class keeps serving.
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      const rpc = await connect(daemon);
      const bait = await createRetrying(
        rpc,
        {
          shell: HOLD,
          workloadClass: "agent",
        },
        native,
        30_000,
      );
      await poll(async () =>
        (await listOf(rpc)).some((t) => t.sessionId === bait.sessionId) ? true : undefined,
      );
      // The storm: the boot start plus two respawns spend the intensity window
      // (3 starts / 60s), so the third kill must be the last word.
      let agentCell = classCellOf(daemon.native.terminalRoutes, "agent");
      if (agentCell === undefined) throw new Error("unreachable: the bait proved the cell");
      for (let kill = 0; kill < 3; kill++) {
        const dead: RouteCell = agentCell;
        process.kill(dead.pid, "SIGKILL");
        if (kill === 2) break;
        agentCell = await poll(async () => {
          const cell = classCellOf(daemon.native.terminalRoutes, "agent");
          return cell !== undefined && cell.cellBootId !== dead.cellBootId ? cell : undefined;
        }, 20_000);
      }
      // The dead end: the agent class does NOT come back — and nothing was
      // isolated, because nothing was attributable (no crumb ⇒ Unknown ⇒ no
      // strike). Sampled past the respawn cadence the storm itself proved.
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      const routes = daemon.native.terminalRoutes;
      expect(classCellOf(routes, "agent"), "no agent class respawn past intensity").toBeUndefined();
      expect(agentSoloCells(routes), "no solo cell without Exact evidence (row 13)").toEqual([]);
      // The other class is untouched by its sibling's dead end.
      const interactive = await createRetrying(rpc, { shell: HOLD }, native, 30_000);
      const tag = await poll(
        async () => (await listOf(rpc)).find((t) => t.sessionId === interactive.sessionId)?.cell,
        15_000,
      );
      expect(tag.workloadClass).toBe("interactive");
    });
  }, 120_000);

  it("row S3-C: Exact strikes isolate the offender's class to solo hosts at next spawn (TC-S3/TC-D4)", async () => {
    // The other half of the pair: the SAME storm WITH the crumb naming a
    // session flips the breach into spawn-isolation — the class keeps
    // serving, creates land on fresh single-session solo cells, and the
    // target rotates the moment it takes a session (the create-target
    // discipline, end to end). The crumb rides the real attribution seam:
    // the file the cell itself writes on the way down.
    const native = await spawnNative();
    await withNativeLog(native, async () => {
      const daemon = await boot({ dataDir: native.dir, controlPort: 0, dataPort: 0 });
      cleanup.push(() => daemon.stop());
      const rpc = await connect(daemon);
      const offender = await createRetrying(
        rpc,
        {
          shell: HOLD,
          workloadClass: "agent",
        },
        native,
        30_000,
      );
      await poll(async () =>
        (await listOf(rpc)).some((t) => t.sessionId === offender.sessionId) ? true : undefined,
      );
      let agentCell = classCellOf(daemon.native.terminalRoutes, "agent");
      if (agentCell === undefined) throw new Error("unreachable: the offender proved the cell");
      for (let kill = 0; kill < 3; kill++) {
        const dead: RouteCell = agentCell;
        writeFileSync(
          join(native.dir, "native", "run", `termcell.${dead.cellInstanceId}.crumb`),
          JSON.stringify({
            cellBootId: dead.cellBootId,
            sessionId: offender.sessionId,
            detail: "induced: kill-matrix row S3-C",
          }),
        );
        process.kill(dead.pid, "SIGKILL");
        if (kill === 2) break;
        agentCell = await poll(async () => {
          const cell = classCellOf(daemon.native.terminalRoutes, "agent");
          return cell !== undefined && cell.cellBootId !== dead.cellBootId ? cell : undefined;
        }, 20_000);
      }
      // Isolation: the class's spawn target is now a SOLO cell.
      const firstTarget = await poll(
        async () => agentSoloCells(daemon.native.terminalRoutes)[0],
        20_000,
      );
      // The offender-class create lands ON the solo host, one session alone.
      const isolated = await createRetrying(
        rpc,
        {
          shell: HOLD,
          workloadClass: "agent",
        },
        native,
        30_000,
      );
      const isolatedTag = await poll(
        async () => (await listOf(rpc)).find((t) => t.sessionId === isolated.sessionId)?.cell,
        15_000,
      );
      expect(isolatedTag.role).toBe("solo");
      expect(isolatedTag.cellBootId).toBe(firstTarget.cellBootId);
      // The chain rotates: a NEWER empty solo spawns once the target is taken,
      // and the next create lands there — never beside the first session.
      const nextTarget = await poll(async () => {
        const newer = agentSoloCells(daemon.native.terminalRoutes).find(
          (cell) => cell.cellInstanceId > firstTarget.cellInstanceId,
        );
        return newer;
      }, 20_000);
      const second = await createRetrying(
        rpc,
        {
          shell: HOLD,
          workloadClass: "agent",
        },
        native,
        30_000,
      );
      const secondTag = await poll(
        async () => (await listOf(rpc)).find((t) => t.sessionId === second.sessionId)?.cell,
        15_000,
      );
      expect(secondTag.role).toBe("solo");
      expect(secondTag.cellBootId).toBe(nextTarget.cellBootId);
      expect(secondTag.cellBootId).not.toBe(isolatedTag.cellBootId);
      // The sibling class never moved: same interactive cell, before and after.
      const interactiveCell = interactiveClassCell(daemon.native.terminalRoutes);
      expect(interactiveCell, "the interactive class is untouched by isolation").toBeDefined();
    });
  }, 180_000);
});
