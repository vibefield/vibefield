import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  type CustodyHandoff,
  type Scope,
  SOCKET_ALIAS_PARENT_ENV,
} from "@vibefield/contracts";
import { ProductApi } from "@vibefield/fieldd";
import type { FielddSupervisor, FielddSupervisorEvent } from "../src/index";

// Shared test harness for the supervisor suite. Every resource it hands out is
// tracked and torn down by `cleanup()` in afterEach: temp roots removed,
// ProductApis closed, supervisors disposed, and any leaked fixture child
// SIGKILLed. All temp roots are SHORT (`mkdtempSync(tmpdir()/vfsup-)`) so they
// stay well under the sun_path guard — the one over-long root is minted
// deliberately by `mkLongRoot()`.
//
// > Correction (2026-11-12, item 345): an over-long root is no longer refused by
// > itself. The endpoint law takes a root over the sun_path line through a short
// > alias (`<parent>/vf-<uid>/<scope>`), where every socket fits; the guard now
// > refuses only a home over budget EVEN through the alias, which a test makes
// > by naming a long alias parent (spawn.test.ts's guard rows).

const DEFAULT_TOKEN = "shell-token-0123456789abcdefghij";

/** OB custody — what a probe of a `files` daemon names: the bearer in `shell.token`. `tryAdopt` has no default
 * credential (the token file is the weaker of its two roads, and a caller that names nothing must not be put on it
 * in silence), so every row that probes by the file says so with this. */
export const BY_TOKEN_FILE = { credential: { kind: "token-file" } } as const;

/** The token-service slice ProductApi needs; the grant's scopes are irrelevant
 * to adoption (hello only), so an empty grant suffices for a live listener.
 * WIN-D5 tests grant `native.admin` to exercise the stop verb's happy path. */
function acceptOnly(token: string, scopes: readonly Scope[] = []) {
  return (t: string) =>
    t === token ? { tokenId: "tk-shell", scopes: [...scopes], label: "shell" } : null;
}

/** OB custody — what FIXTURE_SEALED writes to its OBSERVE_FILE: what it was handed and what it heard, with no
 * secret in it (a digest of the hand-off line, never the line). */
export interface SealedObserved {
  pid: number;
  /** FIELDD_CUSTODY as the child saw it, or null */
  custodyFlag: string | null;
  /** when the first byte of stdin arrived (the child's clock, ms) */
  stdinAtMs: number | null;
  /** sha256 of the hand-off line, without its newline */
  handoffSha256: string | null;
  /** the marks the spawner remembered, as the hand-off carried them */
  handoffExpect: Record<string, number> | null;
  /** whether any of the three secrets was in the child's argv or environment */
  secretInArgv: boolean | null;
  secretInEnv: boolean | null;
  /** every hello it heard: the kind claimed, the credential's type, and the hello's params as JSON */
  hellos: Array<{
    clientKind: string | null;
    credential: "string" | "object" | "none";
    raw: string;
  }>;
  /** how many times `system.custody.marks.subscribe` was opened */
  subscribes: number;
}

/** A FIXTURE_SEALED child the TEST started (an adoption row's incumbent, or a planted listener). */
export interface SealedDaemon {
  readonly pid: number;
  readonly port: number;
  readonly bootId: string;
  /** what it has observed so far */
  observed(): SealedObserved;
}

/** Where a supervisor-spawned FIXTURE_SEALED child writes what it observed, by convention of these tests. */
export function sealedObservePath(root: string): string {
  return join(root, "fx", "observed.json");
}

export function readSealedObserved(root: string): SealedObserved {
  return JSON.parse(readFileSync(sealedObservePath(root), "utf8")) as SealedObserved;
}

/** Item 345: the run's own socket alias parent, when this process has one, for a child a row starts from an
 * environment that is not this process's (fieldd's native-harness.ts `runAliasParentEnv`, which this package's tests
 * do not import). The sealed stand-in binds TCP alone today; it carries the parent as every such spawn does. */
function runAliasParentEnv(): Record<string, string> {
  const parent = process.env[SOCKET_ALIAS_PARENT_ENV];
  return parent === undefined ? {} : { [SOCKET_ALIAS_PARENT_ENV]: parent };
}

export interface Harness {
  /** A short temp data root, tracked for removal. */
  mkRoot(): string;
  /** OB custody — start FIXTURE_SEALED as a child of the test, under `root`, and wait for its ready line. With
   * `handoff` it is a sealed fieldd (`mode: "prove"`, the default): the hand-off goes down its stdin under
   * FIELDD_CUSTODY=stdin, and it writes product.json (custody "sealed") and no shell.token. `mode: "accept"` is a
   * planted listener: it writes no run files, takes any hello and proves nothing. `marks` are the frames its marks
   * stream says (SEALED_MARKS_FRAMES): the first at the subscribe, the rest after it. Tracked and killed in cleanup. */
  startSealedDaemon(
    root: string,
    o?: {
      handoff?: CustodyHandoff;
      mode?: "prove" | "accept";
      bootId?: string;
      userId?: string;
      buildId?: string;
      marks?: ReadonlyArray<{ marks: Record<string, number> }>;
    },
  ): Promise<SealedDaemon>;
  /** A data root nested deeply enough that native/run/mgmt.sock overflows the
   * sun_path safety margin. *Corrected 2026-11-12 (item 345):* this said "for
   * the data-root-too-long guard"; such a root now binds through the short
   * alias and passes the guard, which refuses it only under a long alias parent. */
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

    async startSealedDaemon(root, o = {}) {
      const fx = join(root, "fx");
      mkdirSync(fx, { recursive: true });
      const script = join(fx, "sealed.mjs");
      writeFileSync(script, FIXTURE_SEALED);
      const child = spawn(process.execPath, [script], {
        env: {
          CV: CONTRACTS_VERSION,
          FIELDD_DATA_DIR: root,
          OBSERVE_FILE: sealedObservePath(root),
          ...runAliasParentEnv(),
          SEALED_MODE: o.mode ?? "prove",
          ...(o.handoff !== undefined ? { FIELDD_CUSTODY: "stdin" } : {}),
          ...(o.bootId !== undefined ? { SEALED_BOOT_ID: o.bootId } : {}),
          ...(o.userId !== undefined ? { FIELDD_USER_ID: o.userId } : {}),
          ...(o.buildId !== undefined ? { FIELDD_BUILD_ID: o.buildId } : {}),
          ...(o.marks !== undefined ? { SEALED_MARKS_FRAMES: JSON.stringify(o.marks) } : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const pid = child.pid;
      if (pid === undefined) throw new Error("the sealed fixture did not start");
      pids.add(pid);
      // a child that exits before it reads must not throw EPIPE at the suite
      child.stdin.on("error", () => undefined);
      child.stdin.end(o.handoff !== undefined ? `${JSON.stringify(o.handoff)}\n` : "");
      const ready = await new Promise<{ port: number; bootId: string }>((resolve, reject) => {
        let out = "";
        let err = "";
        const fail = (why: string): void => {
          clearTimeout(timer);
          reject(new Error(`the sealed fixture ${why}; its stderr: ${err.trim()}`));
        };
        const timer = setTimeout(() => fail("printed no ready line within 3 s"), 3_000);
        child.stderr.on("data", (chunk: Buffer) => {
          err += chunk.toString("utf8");
        });
        child.stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString("utf8");
          const end = out.indexOf("\n");
          if (end === -1) return;
          clearTimeout(timer);
          try {
            resolve(JSON.parse(out.slice(0, end)) as { port: number; bootId: string });
          } catch {
            fail("printed a first line that is not JSON");
          }
        });
        child.once("exit", (code) => fail(`exited with code ${code} before its ready line`));
      });
      return {
        pid,
        port: ready.port,
        bootId: ready.bootId,
        observed: () => readSealedObserved(root),
      };
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

/** OB custody — a child that will never read its line: it shuts its own stdin at once, says so by writing its pid to
 * MARK_FILE, and idles. A write to it fails, because the pipe has no reader: what a write to a child that already
 * left looks like to its spawner, without the race of an exit. */
export const FIXTURE_DEAF = `
import { closeSync, writeFileSync } from "node:fs";
closeSync(0);
writeFileSync(process.env.MARK_FILE, String(process.pid));
setInterval(() => {}, 1e6);
`;

/** OB custody — a fieldd stand-in that speaks the SEALED side by itself: no in-test ProductApi answers for it, because
 * the door's own sealed hello is fieldd's half and is not in this package's reach. It is a whole listener: a minimal
 * WebSocket server (text frames under 64 KiB, which is every frame these rows send) answering JSON-RPC, with the
 * pairing recipe spelled a second time in plain node:crypto, so a row that pairs with it checks the maker against an
 * independent verifier.
 *
 * Under FIELDD_CUSTODY=stdin it reads ONE line from stdin and exits 2, with a stderr line and no ready line, when the
 * line is absent or is no hand-off. SEALED_MODE:
 *  - "prove" (the default): a sealed fieldd. It needs the hand-off, verifies a shell-main hello's PairingMac against
 *    its own port, boot and user and the hand-off's shell secret, answers `serverMac`, refuses anything else
 *    UNAUTHORIZED and closes 1008. It writes product.json with custody "sealed" and NEVER a shell.token.
 *  - "accept": a planted listener. It writes no run files, takes any hello and proves nothing.
 * Then, both modes: the ready line. SEALED_BOOT_ID names its boot (default "boot-sealed"); FIELDD_USER_ID its user.
 * SEALED_MARKS_FRAMES is a JSON array of `{marks}` frames: the first answers `system.custody.marks.subscribe`,
 * the rest follow as snapshots 30 ms apart. OBSERVE_FILE, if set, is rewritten with a SealedObserved whenever what
 * it has seen changes: never a secret, only a digest of the line and whether a secret was in argv or env. */
export const FIXTURE_SEALED = `
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const root = process.env.FIELDD_DATA_DIR;
const bootId = process.env.SEALED_BOOT_ID ?? "boot-sealed";
const userId = process.env.FIELDD_USER_ID ?? "";
const mode = process.env.SEALED_MODE ?? "prove";
const frames = JSON.parse(process.env.SEALED_MARKS_FRAMES ?? "[]");
const dir = join(root, "fieldd", "run");
const HEX64 = /^[0-9a-f]{64}$/;
const NONCE = /^[0-9a-f]{32}$/;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const observed = {
  pid: process.pid,
  custodyFlag: process.env.FIELDD_CUSTODY ?? null,
  stdinAtMs: null,
  handoffSha256: null,
  handoffExpect: null,
  secretInArgv: null,
  secretInEnv: null,
  hellos: [],
  subscribes: 0,
};
function note() {
  if (process.env.OBSERVE_FILE) writeFileSync(process.env.OBSERVE_FILE, JSON.stringify(observed));
}

function readLine() {
  return new Promise((resolve) => {
    let text = "";
    const timer = setTimeout(() => resolve(null), 5000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      if (observed.stdinAtMs === null) observed.stdinAtMs = Date.now();
      text += chunk;
      const end = text.indexOf("\\n");
      if (end === -1) return;
      clearTimeout(timer);
      resolve(text.slice(0, end));
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

let shell = null;
if (process.env.FIELDD_CUSTODY === "stdin") {
  const line = await readLine();
  let handoff = null;
  try {
    handoff = line === null ? null : JSON.parse(line);
  } catch {
    handoff = null;
  }
  const secrets = handoff === null ? [] : [handoff.shell, handoff.pairing, handoff.records];
  const valid =
    handoff !== null &&
    typeof handoff === "object" &&
    handoff.v === 1 &&
    secrets.every((secret) => typeof secret === "string" && HEX64.test(secret));
  if (!valid) {
    process.stderr.write("fieldd: custody was flagged and no valid hand-off arrived\\n");
    process.exit(2);
  }
  shell = handoff.shell;
  observed.handoffSha256 = createHash("sha256").update(line, "utf8").digest("hex");
  observed.handoffExpect = handoff.expect ?? null;
  observed.secretInArgv = secrets.some((secret) => process.argv.some((arg) => arg.includes(secret)));
  observed.secretInEnv = secrets.some((secret) =>
    Object.values(process.env).some((value) => typeof value === "string" && value.includes(secret)),
  );
}
note();
if (mode === "prove" && shell === null) {
  process.stderr.write("fieldd: a sealed boot needs FIELDD_CUSTODY=stdin and its hand-off\\n");
  process.exit(2);
}

const mac = (parts) =>
  createHmac("sha256", Buffer.from(shell, "hex")).update(parts.join("\\0"), "utf8").digest("hex");
const same = (a, b) => {
  if (typeof a !== "string") return false;
  const mine = Buffer.from(a, "utf8");
  const theirs = Buffer.from(b, "utf8");
  return mine.length === theirs.length && timingSafeEqual(mine, theirs);
};

function frame(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const head = Buffer.alloc(4);
  head[0] = 0x81;
  head[1] = 126;
  head.writeUInt16BE(payload.length, 2);
  return Buffer.concat([head, payload]);
}

function serve(socket, port) {
  let buffered = Buffer.alloc(0);
  let authed = false;
  const send = (value) => socket.write(frame(value));
  const answer = (id, result) => send({ jsonrpc: "2.0", id, result });
  const refuse = (id, kind, message) =>
    send({ jsonrpc: "2.0", id, error: { code: -32001, message, data: { kind, retryable: false } } });
  const onMessage = (msg) => {
    const id = msg.id;
    const params = msg.params ?? {};
    if (msg.method === "system.hello") {
      const credential = params.credential;
      observed.hellos.push({
        clientKind: typeof params.clientKind === "string" ? params.clientKind : null,
        credential:
          typeof credential === "string" ? "string" : credential === undefined ? "none" : "object",
        raw: JSON.stringify(params),
      });
      note();
      const ack = {
        contractsVersion: process.env.CV,
        serverKind: "fieldd",
        grantedScopes: ["tokens.mint", "native.admin"],
        userId: userId === "" ? null : userId,
      };
      if (mode === "accept") {
        authed = true;
        answer(id, ack);
        return;
      }
      const paired =
        credential !== null &&
        typeof credential === "object" &&
        params.clientKind === "shell-main" &&
        credential.bootId === bootId &&
        typeof credential.nonce === "string" &&
        NONCE.test(credential.nonce) &&
        Number.isInteger(credential.ts) &&
        same(credential.mac, mac(["vf-shell", port, bootId, userId, credential.nonce, credential.ts]));
      if (!paired) {
        refuse(id, "UNAUTHORIZED", "invalid token");
        // a close frame, code 1008, as the door closes a bad token's socket
        socket.end(Buffer.from([0x88, 0x02, 0x03, 0xf0]));
        return;
      }
      authed = true;
      answer(id, { ...ack, serverMac: mac(["vf-shell-ack", credential.nonce, bootId, port]) });
      return;
    }
    if (!authed) {
      refuse(id, "UNAUTHORIZED", "hello required first");
      return;
    }
    if (msg.method === "system.health") {
      answer(id, { ok: true, state: "READY" });
      return;
    }
    if (msg.method === "system.unsubscribe") {
      answer(id, {});
      return;
    }
    if (msg.method === "system.custody.marks.subscribe") {
      observed.subscribes += 1;
      note();
      const subId = "marks-" + observed.subscribes;
      answer(id, { subId, snapshot: frames[0] ?? { marks: {} } });
      frames.slice(1).forEach((payload, index) => {
        const later = { jsonrpc: "2.0", method: "system.custody.marks.snapshot", params: { subId, payload } };
        setTimeout(() => send(later), 30 * (index + 1));
      });
      return;
    }
    if (msg.method === "system.shutdown") {
      answer(id, {});
      rmSync(join(dir, "product.json"), { force: true });
      setTimeout(() => process.exit(0), 20);
      return;
    }
    refuse(id, "NOT_FOUND", "no such method");
  };
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (;;) {
      if (buffered.length < 2) return;
      const opcode = buffered[0] & 0x0f;
      const masked = (buffered[1] & 0x80) !== 0;
      let length = buffered[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        socket.destroy();
        return;
      }
      const maskAt = offset;
      if (masked) offset += 4;
      if (buffered.length < offset + length) return;
      const payload = Buffer.from(buffered.subarray(offset, offset + length));
      if (masked) {
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= buffered[maskAt + (i % 4)];
      }
      buffered = buffered.subarray(offset + length);
      if (opcode === 0x8) {
        socket.end(Buffer.from([0x88, 0x00]));
        return;
      }
      if (opcode === 0x9) {
        socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        continue;
      }
      if (opcode !== 0x1) continue;
      let msg;
      try {
        msg = JSON.parse(payload.toString("utf8"));
      } catch {
        continue;
      }
      onMessage(msg);
    }
  });
}

const server = createServer((request, response) => {
  response.writeHead(426);
  response.end();
});
server.on("upgrade", (request, socket, head) => {
  const key = request.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\\r\\n" +
      "Upgrade: websocket\\r\\n" +
      "Connection: Upgrade\\r\\n" +
      "Sec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n",
  );
  serve(socket, server.address().port);
  if (head.length > 0) socket.emit("data", head);
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  if (mode === "prove") {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "product.json"), JSON.stringify({
      port, pid: process.pid, bootId,
      contractsVersion: process.env.CV, startedAt: Date.now(), nativePid: null,
      buildId: process.env.FIELDD_BUILD_ID ?? null,
      ...(userId === "" ? {} : { userId }),
      custody: "sealed",
    }));
  }
  process.stdout.write(JSON.stringify({ ready: true, port, bootId }) + "\\n");
});
`;
