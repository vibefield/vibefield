import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACTS_VERSION, type Scope } from "@vibefield/contracts";
import { ProductApi } from "@vibefield/fieldd";
import type { FielddSupervisor, FielddSupervisorEvent } from "../src/index";

// Shared test harness for the supervisor suite. Every resource it hands out is
// tracked and torn down by `cleanup()` in afterEach: temp roots removed,
// ProductApis closed, supervisors disposed, and any leaked fixture child
// SIGKILLed. All temp roots are SHORT (`mkdtempSync(tmpdir()/vfsup-)`) so they
// stay well under the sun_path guard — the one over-long root is minted
// deliberately by `mkLongRoot()`.

const DEFAULT_TOKEN = "shell-token-0123456789abcdefghij";

/** The token-service slice ProductApi needs; the grant's scopes are irrelevant
 * to adoption (hello only), so an empty grant suffices for a live listener.
 * WIN-D5 tests grant `native.admin` to exercise the stop verb's happy path. */
function acceptOnly(token: string, scopes: readonly Scope[] = []) {
  return (t: string) =>
    t === token ? { tokenId: "tk-shell", scopes: [...scopes], label: "shell" } : null;
}

export interface Harness {
  /** A short temp data root, tracked for removal. */
  mkRoot(): string;
  /** A data root nested deeply enough that native/run/mgmt.sock overflows the
   * sun_path safety margin (for the data-root-too-long guard). */
  mkLongRoot(): string;
  /** Boot a real product server on an ephemeral port. `verify` defaults to
   * accepting exactly `token`; pass `verify: () => null` for a foreign listener.
   * `health: "never"` (item 212, RV #67) leaves `system.health` unanswered: a
   * fieldd whose loop stopped answering after its hello, as the shell's
   * liveness watch meets one. */
  startProduct(opts?: {
    token?: string;
    scopes?: readonly Scope[];
    verify?: (t: string) => { tokenId: string; scopes: Scope[]; label: string } | null;
    health?: "answer" | "never";
  }): Promise<{ api: ProductApi; port: number; token: string }>;
  /** Item 212 (RV #30) — a busy fieldd: ONE port under ONE bootId whose kernel completes every dial while nothing
   * is read (`pauseOnConnect`), until `open()` pipes each held socket, and every later one, to the live ProductApi
   * on `targetPort`. A swap to another port would change the port under one bootId, which a busy fieldd never does. */
  startGatedProxy(targetPort: number): Promise<{ port: number; open(): void }>;
  /** Write the shell bootstrap run files (product.json + shell.token) that
   * fieldd would write — the adoption contract from daemon.ts:361. */
  writeRunFiles(
    root: string,
    o: {
      port: number;
      pid: number;
      token?: string;
      bootId?: string;
      nativePid?: number | null;
      buildId?: string | null;
      extra?: Record<string, unknown>;
    },
  ): void;
  /** Write a fixture .mjs into `dir` and return its absolute path. */
  writeFixture(dir: string, name: string, body: string): string;
  /** Track a supervisor for disposal in cleanup. */
  track(s: FielddSupervisor): FielddSupervisor;
  /** Track a pid to SIGKILL in cleanup (leaked fixtures under leave-running). */
  trackPid(pid: number | undefined): void;
  cleanup(): Promise<void>;
}

export function createHarness(): Harness {
  const roots: string[] = [];
  const apis: ProductApi[] = [];
  const supervisors: FielddSupervisor[] = [];
  const pids = new Set<number>();
  const servers: Server[] = [];
  const sockets = new Set<Socket>();

  return {
    mkRoot() {
      const root = mkdtempSync(join(tmpdir(), "vfsup-"));
      roots.push(root);
      return root;
    },

    mkLongRoot() {
      const base = mkdtempSync(join(tmpdir(), "vfsup-"));
      roots.push(base);
      let root = base;
      // grow the path until the derived native socket path passes 100 bytes
      while (Buffer.byteLength(join(root, "native", "run", "mgmt.sock"), "utf8") <= 100) {
        root = join(root, "nested-segment-padding");
      }
      mkdirSync(root, { recursive: true });
      return root;
    },

    async startProduct(opts) {
      const token = opts?.token ?? DEFAULT_TOKEN;
      const api = new ProductApi({
        port: 0,
        tokens: { verify: opts?.verify ?? acceptOnly(token, opts?.scopes) },
      });
      // a scope-null product method, so a hello'd client can request with no grant; `never` is a call that is never
      // answered (the ProductApi bounds no handler), while the hello and the door's tick still are
      api.register(
        "system.health",
        opts?.health === "never"
          ? () => new Promise<never>(() => {})
          : () => ({ ok: true, state: "READY" }),
      );
      const port = await api.listen();
      apis.push(api);
      return { api, port, token };
    },

    async startGatedProxy(targetPort) {
      const held: Socket[] = [];
      let opened = false;
      const pipeThrough = (socket: Socket): void => {
        const upstream = connect(targetPort, "127.0.0.1");
        sockets.add(upstream);
        const end = (): void => {
          socket.destroy();
          upstream.destroy();
        };
        upstream.on("error", end);
        socket.on("close", end);
        upstream.on("close", end);
        socket.pipe(upstream);
        upstream.pipe(socket);
      };
      const server = createServer({ pauseOnConnect: true }, (socket) => {
        sockets.add(socket);
        // a probe that gave up closes its end; a held socket must never throw that at the suite
        socket.on("error", () => socket.destroy());
        if (opened) pipeThrough(socket);
        else held.push(socket);
      });
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("the gated proxy has no TCP port");
      }
      return {
        port: address.port,
        open() {
          if (opened) return;
          opened = true;
          for (const socket of held.splice(0)) pipeThrough(socket);
        },
      };
    },

    writeRunFiles(root, o) {
      const dir = join(root, "fieldd", "run");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "shell.token"), o.token ?? DEFAULT_TOKEN);
      writeFileSync(
        join(dir, "product.json"),
        JSON.stringify({
          port: o.port,
          pid: o.pid,
          bootId: o.bootId ?? "boot-test",
          contractsVersion: CONTRACTS_VERSION,
          startedAt: Date.now(),
          nativePid: o.nativePid ?? null,
          buildId: o.buildId ?? null,
          ...(o.extra ?? {}),
        }),
      );
    },

    writeFixture(dir, name, body) {
      mkdirSync(dir, { recursive: true });
      const p = join(dir, name);
      writeFileSync(p, body);
      return p;
    },

    track(s) {
      supervisors.push(s);
      return s;
    },

    trackPid(pid) {
      if (pid !== undefined) pids.add(pid);
    },

    async cleanup() {
      for (const s of supervisors) {
        try {
          await s.dispose();
        } catch {
          /* dispose is idempotent; a test may have disposed already */
        }
      }
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      for (const socket of sockets) socket.destroy();
      for (const server of servers) server.close();
      for (const a of apis) {
        try {
          a.close();
        } catch {
          /* already closed */
        }
      }
      for (const r of roots) {
        try {
          rmSync(r, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    },
  };
}

/** Item 75 (2026-10-26) — waits, bounded, for an event the supervisor emits from the child's STDOUT. `ensure()` may
 * resolve first: it answers from the run-file probe, and a fixture writes its run files before it prints its line, an
 * order the product never promises. At the deadline it names the wait and the event kinds seen (never a line: in the
 * redaction row the lines are the subject). */
export async function waitForEvent(
  events: readonly FielddSupervisorEvent[],
  match: (event: FielddSupervisorEvent) => boolean,
  what: string,
  // inside vitest's default 5 s test budget (this package sets none), so it is THIS wait that says why
  ms = 2_000,
): Promise<void> {
  const end = Date.now() + ms;
  while (!events.some(match)) {
    if (Date.now() > end) {
      const kinds = events.map((event) => event.kind).join(", ");
      throw new Error(`${what} did not arrive within ${ms} ms; the events seen: [${kinds}]`);
    }
    await new Promise<void>((r) => setTimeout(r, 10));
  }
}

/** Poll (bounded) until `pid` is gone — signal delivery is asynchronous. */
export async function waitDead(pid: number, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise<void>((r) => setTimeout(r, 30));
  }
  return false;
}

// ---- fixture bodies (run by process.execPath as ESM) --------------------
//
// Each reads FIELDD_DATA_DIR (the supervisor injects it) and behaves as a
// fieldd stand-in. TEST_PRODUCT_PORT points them at the in-test ProductApi;
// SHELL_TOKEN is written to shell.token so the supervisor's adoption probe
// authenticates against that server. CV carries the contracts version for a
// schema-valid product.json.

/** Writes run files then idles — the ordinary "fieldd came up" fixture.
 * PID_OVERRIDE forces a product.json pid other than our own (the lost-race →
 * "adopted" branch). SPAWN_MARKER, if set, gets one appended line per process
 * start (proves single-spawn under concurrent ensure). PRINT_SECRET, if set,
 * is written to stdout before the files (redaction-through-spawn). NATIVE_PID,
 * if set, is the floor the record names (`nativePid`; null otherwise).
 * REMOVE_RECORD_ON_TERM, if set, removes product.json at SIGTERM and exits, as
 * fieldd's stop does: a read after the stop finds no record. GATE_FILE, if set,
 * holds the run files and the readiness line until that file exists (item 212:
 * a spawn whose record lands after the superseded incumbent answered late). */
export const FIXTURE_READY = `
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.FIELDD_DATA_DIR;
const port = Number(process.env.TEST_PRODUCT_PORT);
const token = process.env.SHELL_TOKEN ?? "shell-token";
const pid = process.env.PID_OVERRIDE ? Number(process.env.PID_OVERRIDE) : process.pid;
const nativePid = process.env.NATIVE_PID ? Number(process.env.NATIVE_PID) : null;
const gate = process.env.GATE_FILE;
if (process.env.SPAWN_MARKER) appendFileSync(process.env.SPAWN_MARKER, process.pid + "\\n");
if (process.env.PRINT_SECRET) process.stdout.write(process.env.PRINT_SECRET + "\\n");
const dir = join(root, "fieldd", "run");
function start() {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "shell.token"), token);
  writeFileSync(join(dir, "product.json"), JSON.stringify({
    port, pid, bootId: "boot-fixture",
    contractsVersion: process.env.CV, startedAt: Date.now(), nativePid,
    buildId: process.env.FIELDD_BUILD_ID ?? null,
  }));
  if (process.env.REMOVE_RECORD_ON_TERM) process.on("SIGTERM", () => {
    rmSync(join(dir, "product.json"), { force: true });
    process.exit(0);
  });
  process.stdout.write(JSON.stringify({ ready: true, port, bootId: "boot-fixture" }) + "\\n");
}
if (gate) {
  const waiting = setInterval(() => {
    if (!existsSync(gate)) return;
    clearInterval(waiting);
    start();
  }, 20);
} else start();
setInterval(() => {}, 1e6);
`;

/** Prints a stderr line, then exits non-zero before writing any run files. */
export const FIXTURE_EXIT_1 = `
process.stderr.write("boom: fieldd refused to start\\n");
setTimeout(() => process.exit(1), 40);
`;

/** Never writes run files; idles forever (readiness-timeout / abort fodder). */
export const FIXTURE_IDLE = `
setInterval(() => {}, 1e6);
`;
