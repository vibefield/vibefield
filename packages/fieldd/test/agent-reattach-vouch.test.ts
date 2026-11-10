// OB custody (CUSTODY-SPEC §8.1.0, rule 6) — WHO a run is after a fieldd restart. A run's record is signed under a key
// file an agent can read, so at `sealed` the next fieldd does not take the record's word: the floor outlives fieldd,
// only a holder of the pairing secret speaks to it, and it hands the next fieldd, in its hello ack, what the last one
// said each terminal was started for. `reattach` reads that table ONCE, joins it to the running rows of the inventory
// it was handed, and a run is VOUCHED iff the entry for its terminal names it. At `files` the record names the run, as
// it always did.
//
// GIVEN A MOCK FLOOR (`MockMgmtServer`): every row here boots the real `bootstrap` at the level it names, so the link,
// the runtime and what `daemon.ts` hands the runtime (§10: the level, `takeStartedFor`) are the real ones; what is
// scripted is the FLOOR's side of the wire, the ack's table and the inventory. The rows that prove the same chain
// against the real floor, where the table is one fieldd's own sayings handed to the next, are agent-session.test.ts's
// "a run launched at sealed is vouched after a fieldd restart" and agent-started-for.test.ts's typed row.
//
// The records are staged through the product's own store, so they verify; a record with no creation request cannot
// be attached to and is HELD, which is one of the two ways a re-attached run enters the fold. No cell answers behind
// the routes: nothing here is born or ended.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSessionRecord, LAYOUT, SOCKETS } from "@vibefield/contracts";
import type { AgentProvider } from "@vibefield/puppeteer-runtime";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type FielddConfig, type FielddDaemon, SessionRecordStore } from "../src/index";
import type { SecretStore } from "../src/plugin-settings";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { SCRIPTED_CATALOG } from "./agent-catalog-fixture";
import { bootAt, HANDED } from "./custody-harness";
import { CLAUDE, fixtureRoutes, freshFloor, ZSH } from "./inventory-age-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  const fns = cleanup.reverse();
  cleanup = [];
  for (const fn of fns) {
    try {
      await fn();
    } catch {
      /* already stopped */
    }
  }
});

const S = "sp-0000000s";
const V = "sp-0000000v";
/** A second PTY on the agent cell, beside the fixture's one. */
const OTHER = "0d9f1c2b-3a4e-5d6c-7b8a-000000000002";
/** The fixture's shell, as the floor lists it: its pid, and where a process table puts it. */
const SHELL_PID = 51207;
const STARTED = "2026-11-10T03:00:00.000Z";
const STARTED_MS = Date.parse(STARTED);
const VERB = "native.terminal.startedFor.set";

type ProcessTable = NonNullable<NonNullable<FielddConfig["agentGateway"]>["processTable"]>;

/** The scripted agent: composed so the catalog's row has a provider, and never asked to start anything here. */
const SCRIPTED: AgentProvider = {
  descriptor: { id: "scripted", label: "Scripted" },
  async createSession(): Promise<never> {
    throw new Error("nothing is born in these rows");
  },
};

/** AR-S4d — a keychain in a map: no row here reads or writes the machine's. */
function keychainInMemory(): SecretStore {
  const entries = new Map<string, string>();
  return {
    get: async (service, account) => entries.get(`${service}/${account}`) ?? null,
    set: async (service, account, value) => {
      entries.set(`${service}/${account}`, value);
    },
    delete: async (service, account) => {
      entries.delete(`${service}/${account}`);
    },
  };
}

/** A process of the row's own that sleeps: a typed agent's stand-in, alive for the watch a held typed run arms
 * (which asks the real system whether its pid lives). It is this test's child, and is ended with the row. */
function sleeper(): number {
  const child = spawn("/bin/sleep", ["600"], { stdio: "ignore" });
  cleanup.push(() => {
    child.kill("SIGKILL");
  });
  if (child.pid === undefined) throw new Error("the stand-in process did not start");
  return child.pid;
}

/** The fixture's two rows, and one more PTY on the agent cell for each id in `more`. */
function floorWith(more: readonly string[] = []): Record<string, unknown> {
  const state = freshFloor();
  const rows = state["terminals"] as Array<Record<string, unknown>>;
  const agent = rows.find((row) => row["sessionId"] === CLAUDE);
  const extra = more.map((sessionId, n) => ({ ...agent, sessionId, pid: 48300 + n }));
  return { ...state, terminals: [...rows, ...extra] };
}

/** A record of the scripted agent's run as the runtime writes one: born in `pty`, no exit stamped, and no creation
 * request unless a row gives it one (so the boot HOLDS it). */
function runRecord(
  runtimeRunId: string,
  pty: string,
  cwd: string,
  extra: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  const at = new Date().toISOString();
  return {
    format: 1,
    runtimeRunId,
    runtimeEpoch: 1,
    provider: "scripted",
    cwd,
    terminalSessionId: pty,
    continuation: { providerId: "scripted", nativeSessionId: `native-${runtimeRunId}` },
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

interface World {
  dataDir: string;
  mock: MockMgmtServer;
  daemon: FielddDaemon;
  records: SessionRecordStore;
  rpc: WsRpc;
}

interface Seams {
  /** the hello ack's `startedFor`, as it stands (absent: the mock floor says none) */
  table?: unknown;
  /** the floor's inventory at boot (default: the fixture's two rows); `null`: none until a row gives one */
  observed?: unknown;
  processTable?: ProcessTable;
}

/** The real daemon at `level`, over the mock floor, with `staged` written as signed records before it boots, and a
 * connection that may read the fold and the terminals. */
async function world(
  level: "sealed" | "files",
  staged: (dataDir: string) => AgentSessionRecord[],
  seams: Seams = {},
): Promise<World> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-vouch-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  // the file a `files` floor keeps its pairing in; a sealed fieldd never reads it
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const records = new SessionRecordStore({
    dir: join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR),
    keyPath: join(dataDir, ...LAYOUT.AGENT_SESSIONS_KEY_FILE),
    now: () => new Date(),
  });
  for (const record of staged(dataDir)) records.write(record);
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.observedState = seams.observed === undefined ? freshFloor() : seams.observed;
  mock.terminalRoutes = fixtureRoutes();
  if (seams.table !== undefined) mock.helloStartedFor = { said: seams.table };
  await mock.start();
  cleanup.push(() => mock.stop());
  const { processTable } = seams;
  const config: FielddConfig = {
    dataDir,
    logRoot: join(dataDir, "logs"),
    controlPort: 0,
    dataPort: 0,
    secretStore: keychainInMemory(),
    agentCatalog: SCRIPTED_CATALOG,
    // the scripted agent alone: no built-in agent's readers run on this machine
    agentProviders: () => [SCRIPTED],
    agentGateway: { enabled: false, ...(processTable !== undefined ? { processTable } : {}) },
    // a held run's idle poll never fires inside a row
    agentResumeWhenIdle: { afterMs: 600_000, pollMs: 600_000 },
  };
  const daemon = await bootAt(config, level === "sealed" ? HANDED : undefined);
  cleanup.push(() => daemon.stop());
  const grant = daemon.tokens.mint(["agent.observe", "terminal.attach"], "vouch");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, grant.token);
  return { dataDir, mock, daemon, records, rpc };
}

/** The fold's row for a run, once the boot has re-attached to it or holds it. */
async function inTheFold(daemon: FielddDaemon, run: string) {
  const row = () => daemon.agents.list().sessions.find((each) => each.runtimeRunId === run);
  await until(() => row() !== undefined, 8_000, `${run} in the fold`);
  return row();
}

/** Every file under `dir`, as text. */
function everyFile(dir: string): Array<{ path: string; text: string }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return everyFile(path);
    return entry.isFile() ? [{ path, text: readFileSync(path, "latin1") }] : [];
  });
}

describe("OB custody §8.1 — who a run is after a restart: the floor's entry at sealed, the record at files", () => {
  it("sealed: a held run is vouched by its terminal's ENTRY and named by it: a record naming V under an entry naming S is S's; a plain entry makes it plain although the record names a spark; a malformed entry beside them is skipped alone", async () => {
    const { daemon } = await world(
      "sealed",
      (dataDir) => [
        runRecord("run-s", CLAUDE, dataDir, { spark: V }),
        runRecord("run-plain", OTHER, dataDir, { spark: V }),
      ],
      {
        observed: floorWith([OTHER]),
        table: [
          { sessionId: CLAUDE, run: "run-s", spark: S },
          { sessionId: "", run: "nobody" },
          { sessionId: OTHER, run: "run-plain" },
        ],
      },
    );
    const sparks = await inTheFold(daemon, "run-s");
    const plain = await inTheFold(daemon, "run-plain");
    expect(daemon.agents.bornFor("run-s")).toEqual({ spark: S });
    expect(daemon.agents.bornFor("run-plain")).toEqual({});
    // and this life holds each as its entry names it: the row's spark is the entry's, never the record's V
    expect(sparks?.spark).toBe(S);
    expect(plain?.spark).toBeUndefined();
  });

  it("Q1, both levels: a record that names a spark with NO entry is held and unvouched at sealed (`bornFor` undefined, and nothing falls back to the record); at files the same record names the run", async () => {
    const staged = (dataDir: string) => [runRecord("run-q1", CLAUDE, dataDir, { spark: V })];
    // sealed, on a floor that sends no table at all
    const sealed = await world("sealed", staged);
    expect(await inTheFold(sealed.daemon, "run-q1")).toBeDefined();
    expect(sealed.daemon.agents.bornFor("run-q1")).toBeUndefined();

    // sealed, with an entry for its terminal that names ANOTHER run
    const other = await world("sealed", staged, {
      table: [{ sessionId: CLAUDE, run: "run-somebody-else", spark: S }],
    });
    expect(await inTheFold(other.daemon, "run-q1")).toBeDefined();
    expect(other.daemon.agents.bornFor("run-q1")).toBeUndefined();
    expect(other.daemon.agents.bornFor("run-somebody-else")).toBeUndefined();

    // files: the record's word, and a table on the ack is ignored; the verb is never sent
    const files = await world("files", staged, {
      table: [{ sessionId: CLAUDE, run: "run-q1", spark: S }],
    });
    expect((await inTheFold(files.daemon, "run-q1"))?.spark).toBe(V);
    expect(files.daemon.agents.bornFor("run-q1")).toEqual({ spark: V });
    expect(files.mock.startedForAsks).toEqual([]);
    expect(files.mock.requestLog.map((request) => request.method)).not.toContain(VERB);
  });

  it("the join is to the running rows of THAT inventory: an entry for a terminal the first inventory does not list is dropped, and is not used when the terminal appears later", async () => {
    const { daemon, mock } = await world(
      "sealed",
      (dataDir) => [runRecord("run-late", OTHER, dataDir, { spark: S })],
      { table: [{ sessionId: OTHER, run: "run-late", spark: S }] },
    );
    // the first inventory lacks the PTY: the record waits the boot's grace, and its entry is gone already
    expect(daemon.agents.bornFor("run-late")).toBeUndefined();
    mock.pushObserved(floorWith([OTHER]));
    expect(await inTheFold(daemon, "run-late")).toBeDefined();
    expect(daemon.agents.bornFor("run-late")).toBeUndefined();
  });

  it("the pair used is the ack and the inventory of the connection that is paired when the first inventory comes; a reconnect later in the same life changes nothing this life believes", async () => {
    const { daemon, mock } = await world(
      "sealed",
      (dataDir) => [runRecord("run-pair", CLAUDE, dataDir)],
      // the first connection is answered a table and NO inventory
      { observed: null, table: [{ sessionId: CLAUDE, run: "run-pair", spark: V }] },
    );
    expect(daemon.agents.list().sessions).toEqual([]);
    // it drops; the second connection's ack says S, and its inventory lists the PTY
    mock.helloStartedFor = { said: [{ sessionId: CLAUDE, run: "run-pair", spark: S }] };
    mock.observedState = freshFloor();
    const first = mock.connections;
    mock.killClients();
    await until(() => mock.connections > first, 15_000, "the link paired again");
    expect(await inTheFold(daemon, "run-pair")).toBeDefined();
    expect(daemon.agents.bornFor("run-pair")).toEqual({ spark: S });

    // a later reconnect is answered another table: it is dropped unread
    mock.helloStartedFor = { said: [{ sessionId: CLAUDE, run: "run-pair", spark: V }] };
    const second = mock.connections;
    mock.killClients();
    await until(() => mock.connections > second, 15_000, "the link paired a third time");
    mock.pushObserved(freshFloor());
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(daemon.agents.bornFor("run-pair")).toEqual({ spark: S });
  });

  it("a typed run is proven by the ENTRY's process, never the record's: vouched and plain while that process lives in the shell; a record that says typed under an entry with no process is unvouched; a stale typed entry vouches nothing and is cleared", async () => {
    // two stand-in agents that really live (a held typed run's watch asks the system), and a pid no table lists
    const byEntry = sleeper();
    const byRecord = sleeper();
    const GONE = 999_999;
    const typedRecord = (dataDir: string, pid: number) =>
      runRecord("run-typed", ZSH, dataDir, {
        spawnedBy: "user-shell",
        process: { pid, startedAt: STARTED },
        spark: V,
      });
    // the process table as the proof reads it: the shell the floor lists, and both agents beneath it
    const table: ProcessTable = async () =>
      new Map([
        [SHELL_PID, { pid: SHELL_PID, parentPid: 1, startedAt: "2026-11-10T02:00:00.000Z" }],
        [byEntry, { pid: byEntry, parentPid: SHELL_PID, startedAt: STARTED }],
        [byRecord, { pid: byRecord, parentPid: SHELL_PID, startedAt: STARTED }],
      ]);
    const entryWith = (pid: number) => ({
      sessionId: ZSH,
      run: "run-typed",
      process: { pid, startedAtMs: STARTED_MS },
    });

    // the entry's process lives in the shell; the record names one that is gone: the ENTRY's is what is proven
    const lives = await world("sealed", (dataDir) => [typedRecord(dataDir, GONE)], {
      processTable: table,
      table: [entryWith(byEntry)],
    });
    const row = await inTheFold(lives.daemon, "run-typed");
    expect(row?.spawnedBy).toBe("user-shell");
    expect(lives.daemon.agents.bornFor("run-typed")).toEqual({});
    expect(row?.spark).toBeUndefined();

    // the record says typed, and its process lives; the entry names the run and NO process: held as the record
    // says, and unvouched
    const bare = await world("sealed", (dataDir) => [typedRecord(dataDir, byRecord)], {
      processTable: table,
      table: [{ sessionId: ZSH, run: "run-typed" }],
    });
    expect(await inTheFold(bare.daemon, "run-typed")).toBeDefined();
    expect(bare.daemon.agents.bornFor("run-typed")).toBeUndefined();

    // a stale entry: its process is gone while the shell lives on, though the record's own lives. Nothing is held,
    // nothing is vouched, the record is stamped, and the floor is asked to forget the entry
    const stale = await world("sealed", (dataDir) => [typedRecord(dataDir, byRecord)], {
      processTable: table,
      table: [entryWith(GONE)],
    });
    await until(
      () => stale.records.read("run-typed")?.exited !== undefined,
      8_000,
      "the unproven typed run stamped",
    );
    expect(stale.daemon.agents.list().sessions).toEqual([]);
    expect(stale.daemon.agents.bornFor("run-typed")).toBeUndefined();
    await until(() => stale.mock.startedForAsks.length > 0, 8_000, "the stale entry's clear");
    expect(stale.mock.startedForAsks).toEqual([{ sessionId: ZSH }]);
  });

  it("a helper-rooted run answers the door again after a restart: at sealed by the root its ENTRY names, at files by its record's creation request", async () => {
    const staged = (dataDir: string) => [
      runRecord("run-helped", CLAUDE, dataDir, { creationRequestId: "request-on-the-record" }),
    ];
    const sealed = await world("sealed", staged, {
      table: [{ sessionId: CLAUDE, run: "run-helped", root: "request-on-the-entry" }],
    });
    await inTheFold(sealed.daemon, "run-helped");
    expect(sealed.daemon.agents.runForRoot("request-on-the-entry")).toMatchObject({
      runtimeRunId: "run-helped",
    });
    expect(sealed.daemon.agents.runForRoot("request-on-the-record")).toBeUndefined();

    // sealed and unvouched: no root is named again, by anybody's word
    const unvouched = await world("sealed", staged);
    await inTheFold(unvouched.daemon, "run-helped");
    expect(unvouched.daemon.agents.runForRoot("request-on-the-record")).toBeUndefined();

    const files = await world("files", staged);
    await inTheFold(files.daemon, "run-helped");
    expect(files.daemon.agents.runForRoot("request-on-the-record")).toMatchObject({
      runtimeRunId: "run-helped",
    });
  });

  it("the canary: a string planted as a vouching entry's `root`, and a PATH under the test's root planted as another's, are in no terminal or agent door's answer, no log line at any level, and no file fieldd wrote", async () => {
    const CANARY = "canary-root-7f3a9c";
    const staged = (dataDir: string) => [
      runRecord("run-canary", CLAUDE, dataDir),
      runRecord("run-path", OTHER, dataDir),
    ];
    // a path under the OS temp root, which on this host sits under the person's own folders; it is never created
    const planted = join(tmpdir(), "vf-vouch-canary", "home", "planted-path");
    const { daemon, rpc, dataDir } = await world("sealed", staged, {
      observed: floorWith([OTHER]),
      table: [
        { sessionId: CLAUDE, run: "run-canary", spark: S, root: CANARY },
        { sessionId: OTHER, run: "run-path", root: planted },
      ],
    });
    await inTheFold(daemon, "run-canary");
    await inTheFold(daemon, "run-path");
    // both entries were USED: each run is vouched, and each root names its run at the door
    expect(daemon.agents.bornFor("run-canary")).toEqual({ spark: S });
    expect(daemon.agents.runForRoot(CANARY)).toMatchObject({ runtimeRunId: "run-canary" });
    expect(daemon.agents.runForRoot(planted)).toMatchObject({ runtimeRunId: "run-path" });

    const answers = [
      await rpc.call("terminal.list", {}),
      await rpc.call("terminal.get", { sessionId: CLAUDE }),
      await rpc.call("agent.list", {}),
      daemon.agents.list(),
      daemon.terminals.list(),
    ];
    // fieldd's log is written behind the call: give its lines a beat to land before the files are read
    await new Promise((resolve) => setTimeout(resolve, 500));
    const files = everyFile(dataDir);
    expect(files.some((file) => file.path.endsWith("fieldd.ndjson"))).toBe(true);
    for (const needle of [CANARY, planted]) {
      expect(JSON.stringify(answers)).not.toContain(needle);
      const holding = files.filter((file) => file.text.includes(needle));
      const paths = holding.map((file) => file.path);
      expect(paths, `no file under the data root holds ${needle}`).toEqual([]);
    }
  });
});
