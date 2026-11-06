// IL-D5 (a) (`draft/thinking-inventory-latency.md` §5; ruled 2026-10-19) — the
// agent runtime never acts on a run's PTY from an inventory older than its
// bound. A resume, and the replacement a resume of a pending run is, ask
// before anything is ended or born: a record whose PTY is listed in a stale
// cell, or listed nowhere while any cell is stale, is refused UNAVAILABLE
// {terminal, inventory_stale}, retryable — never PRECONDITION_FAILED
// `terminal-alive` from a row that may have gone, never a successor born
// beside a conversation that may still run. The boot sweep stamps no "exited
// unknown" while any cell is stale, and sweeps again on the observation that
// clears it. What the last run left (`agent.lastRun`) is not judged from a
// stale list either: a session a stale cell has not listed yet is not gone.
//
// The daemon runs over the mock floor (no cargo) with the contracts' two-cell
// fixtures; the records are staged through the product's own store, so they
// verify. A scripted agent counts its births. No cell answers behind the
// routes, so a birth or a terminate that goes ahead fails at the cell's paper
// socket: these rows read whether one was ASKED (spies on the terminal
// service), never what a cell would have answered.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SessionExitedEvent } from "@vibecook/ghosttea-client";
import {
  AgentLastRunResult,
  type AgentSessionRecord,
  LAYOUT,
  SOCKETS,
  TerminalInventoryStaleDetails,
} from "@vibefield/contracts";
import type { AgentAdapterBinding } from "@vibefield/puppeteer-core";
import type { AgentProvider, AgentProviderSessionOptions } from "@vibefield/puppeteer-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { LAST_RUN_SETTLE_MS } from "../src/agent-last-run";
import { ASKED_EXIT_GRACE_MS, EXIT_GRACE_MS } from "../src/agent-runtime";
import { bootstrap, type FielddConfig, type FielddDaemon, SessionRecordStore } from "../src/index";
import { RpcCallError } from "../src/native-link";
import type { SecretStore } from "../src/plugin-settings";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { SCRIPTED_CATALOG } from "./agent-catalog-fixture";
import {
  CELL_1,
  CELL_2_SINCE,
  CLAUDE,
  fixture,
  fixtureRoutes,
  floorStale,
  freshFloor,
  ZSH,
} from "./inventory-age-fixture";
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

/** Past the boot's grace for a record whose PTY the first inventory lacked:
 * EXIT_GRACE_MS (1.5 s) and the sweep 100 ms after it, with room for a loaded
 * host's late timer. */
const PAST_THE_BOOT_GRACE_MS = 3_000;

/** The scripted agent: it counts its births (the native id each resumes, or
 * "fresh") and asks the host for a PTY the way every adapter does. It never
 * returns a binding: the mock floor has no cell to birth in, so the host's
 * spawn refuses first. */
function countingAgent(births: string[]): AgentProvider {
  return {
    descriptor: { id: "scripted", label: "Scripted" },
    async createSession(options: AgentProviderSessionOptions): Promise<AgentAdapterBinding> {
      births.push(options.resume ?? "fresh");
      await options.host.spawnTerminal({
        command: "/bin/sh",
        args: ["-c", "exec /bin/cat"],
        cwd: options.cwd,
        env: {},
      });
      throw new Error("the scripted agent holds no binding: the mock floor births nothing");
    },
  };
}

/** AR-S4d — a keychain in a map: no row here writes the machine's. */
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

/** A record of the scripted agent's run as the runtime writes one: born in
 * `pty`, no exit stamped. */
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

interface AgentFloor {
  dataDir: string;
  mock: MockMgmtServer;
  daemon: FielddDaemon;
  rpc: WsRpc;
  /** the product's own record store over this root (the same key) */
  records: SessionRecordStore;
  /** the scripted agent's births, in order */
  births: string[];
}

/** What a row may hand the daemon beside its floor and its records. */
interface AgentDaemonSeams {
  /** the last run's picture of the board */
  lastBoard?: Array<Record<string, unknown>>;
  /** the process table a typed run is proven against (default: the kit's one `ps` read) */
  processTable?: NonNullable<FielddConfig["agentGateway"]>["processTable"];
}

/** A daemon over the mock floor answering `observedState` on the fixtures'
 * routes, its agent runtime composing the scripted agent, `staged(dataDir)`
 * written as signed records before it boots, and the seams it is handed (the
 * last run's picture of the board, the process table); and a connection that
 * may resume (`agent.spawn`) and read the fold. */
async function agentDaemonOn(
  observedState: unknown,
  staged: (dataDir: string) => AgentSessionRecord[],
  seams: AgentDaemonSeams = {},
): Promise<AgentFloor> {
  const { lastBoard, processTable } = seams;
  const dataDir = mkdtempSync(join(tmpdir(), "vf-agent-age-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const records = new SessionRecordStore({
    dir: join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR),
    keyPath: join(dataDir, ...LAYOUT.AGENT_SESSIONS_KEY_FILE),
    now: () => new Date(),
  });
  for (const record of staged(dataDir)) records.write(record);
  if (lastBoard !== undefined) {
    const path = join(dataDir, ...LAYOUT.AGENT_LAST_BOARD_FILE);
    mkdirSync(dirname(path), { recursive: true });
    const picture = {
      v: 1,
      asOf: "2026-10-19T18:00:00.000Z",
      board: { revision: 7, rows: lastBoard },
    };
    writeFileSync(path, `${JSON.stringify(picture)}\n`);
  }
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.observedState = observedState;
  mock.terminalRoutes = fixtureRoutes();
  await mock.start();
  cleanup.push(() => mock.stop());
  const births: string[] = [];
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    secretStore: keychainInMemory(),
    agentCatalog: SCRIPTED_CATALOG,
    // the scripted agent alone: no built-in agent's readers run on this machine
    agentProviders: () => [countingAgent(births)],
    // no gateway; a typed run's record is proven against the row's process table, when it hands one
    agentGateway: { enabled: false, ...(processTable !== undefined ? { processTable } : {}) },
    // a pending run's idle poll never fires inside a row: the door is the subject
    agentResumeWhenIdle: { afterMs: 600_000, pollMs: 600_000 },
  });
  cleanup.push(() => daemon.stop());
  const grant = daemon.tokens.mint(["agent.spawn", "agent.observe"], "agent-age");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, grant.token);
  return { dataDir, mock, daemon, rpc, records, births };
}

/** What a door answered, in the EL9 fixture's terms. */
function answerOf(err: { data?: { kind?: string; retryable?: boolean; details?: unknown } }) {
  return { kind: err.data?.kind, retryable: err.data?.retryable, details: err.data?.details };
}

describe("an agent's run over an old inventory (IL-D5 (a); the mock floor)", () => {
  it("a pending run is never replaced over its stale cell: nothing is ended or born, and the refusal is retryable; once the cell is fresh the replacement ends the old PTY first, as before", async () => {
    const run = "run-pending-on-cell-2";
    const { mock, daemon, rpc, records, births } = await agentDaemonOn(
      fixture("observed-state.stale-cell.json"),
      (dataDir) => [runRecord(run, CLAUDE, dataDir)],
    );
    // the first inventory lists its PTY on the agent cell; the record predates
    // the durable identity, so it is held pending
    await until(
      () => daemon.agents.list().sessions.some((row) => row.runtimeRunId === run),
      5_000,
      "held pending",
    );
    const terminate = vi.spyOn(daemon.terminals, "terminate");
    const spawn = vi.spyOn(daemon.terminals, "spawn");

    const refused = await rpc.callErr("agent.resume", { runtimeRunId: run });
    expect(answerOf(refused), "the stale cell it lists the PTY in").toEqual(
      fixture("error-data.terminal-inventory-stale.json"),
    );
    expect(TerminalInventoryStaleDetails.safeParse(refused.data?.details).success).toBe(true);
    expect(terminate, "nothing is ended").not.toHaveBeenCalled();
    expect(spawn, "nothing is born").not.toHaveBeenCalled();
    expect(births).toEqual([]);
    expect(records.read(run)?.reattach?.state, "the record is as the hold left it").toBe("failed");
    expect(records.read(run)?.exited).toBeUndefined();
    expect(daemon.agents.list().sessions.map((row) => row.runtimeRunId)).toEqual([run]);

    mock.pushObserved(freshFloor());
    await until(() => daemon.terminals.staleCells().length === 0, 5_000, "fresh");
    const asked = await rpc.callErr("agent.resume", { runtimeRunId: run });
    expect(terminate, "the old PTY is ended first, as before").toHaveBeenCalledWith(CLAUDE);
    expect(answerOf(asked).details, "the paper cell's socket answers nothing").toMatchObject({
      service: "terminal",
      state: "unreachable",
    });
    expect(spawn, "a PTY that did not end is never replaced").not.toHaveBeenCalled();
    expect(births).toEqual([]);
  });

  it("a run listed in a stale cell is refused retryably, never terminal-alive; listed in a fresh cell it is terminal-alive as before", async () => {
    const run = "run-listed-on-cell-1";
    const { mock, daemon, rpc, births } = await agentDaemonOn(
      fixture("observed-state.stale-cell.json"),
      // a record naming the shell on the interactive cell: the re-attach
      // neither attaches nor holds it, and nothing stamps it — a run its record
      // says is running, whose PTY the inventory lists
      (dataDir) => [runRecord(run, ZSH, dataDir)],
    );
    await until(() => daemon.agents.reattachSettled(), 5_000, "the re-attach ran");
    const spawn = vi.spyOn(daemon.terminals, "spawn");

    const alive = await rpc.callErr("agent.resume", { runtimeRunId: run });
    expect(alive.data?.kind, "cell 1 is fresh: its row is the truth").toBe("PRECONDITION_FAILED");
    expect(alive.data?.details).toMatchObject({ runtimeRunId: run, state: "terminal-alive" });

    mock.pushObserved(floorStale([CELL_1]));
    await until(
      () => daemon.terminals.staleCells().some((cell) => cell.cellInstanceId === 1),
      5_000,
      "cell 1 stale",
    );
    const refused = await rpc.callErr("agent.resume", { runtimeRunId: run });
    expect(answerOf(refused), "a row that may have gone is not the truth").toEqual({
      kind: "UNAVAILABLE",
      retryable: true,
      details: {
        service: "terminal",
        state: "inventory_stale",
        cells: [{ ...CELL_1, since: CELL_2_SINCE }],
      },
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(births).toEqual([]);
  });

  it("a run no inventory lists while a cell is stale: the boot sweep stamps nothing and resume births nothing; the observation that clears it stamps the records, and the resume goes on", async () => {
    const unplaced = "run-unlisted";
    const underPersona = "run-unlisted-under-persona";
    const { mock, daemon, rpc, records, births } = await agentDaemonOn(
      fixture("observed-state.stale-cell.json"),
      (dataDir) => [
        runRecord(unplaced, "pty-not-listed-1", dataDir),
        runRecord(underPersona, "pty-not-listed-2", dataDir, { profileId: "persona-x" }),
      ],
    );
    await new Promise((resolve) => setTimeout(resolve, PAST_THE_BOOT_GRACE_MS));
    expect(records.read(unplaced)?.exited, "past the grace, and not stamped").toBeUndefined();
    expect(records.read(underPersona)?.exited).toBeUndefined();
    expect(daemon.agents.reattachSettled(), "the records are still held").toBe(false);
    const held = daemon.agents.liveUnder(new Set(["persona-x"]));
    expect(held, "and the persona's still counts as running").toBe(1);
    const spawn = vi.spyOn(daemon.terminals, "spawn");

    const refused = await rpc.callErr("agent.resume", { runtimeRunId: unplaced });
    expect(answerOf(refused), "every stale cell, where its PTY may run").toEqual(
      fixture("error-data.terminal-inventory-stale.json"),
    );
    expect(spawn, "no successor beside a conversation that may run").not.toHaveBeenCalled();
    expect(births).toEqual([]);

    mock.pushObserved(freshFloor());
    await until(
      () =>
        records.read(unplaced)?.exited !== undefined &&
        records.read(underPersona)?.exited !== undefined,
      5_000,
      "stamped on the clearing observation",
    );
    expect(records.read(unplaced)?.exited?.reason).toBe("unknown");
    expect(daemon.agents.reattachSettled()).toBe(true);
    expect(daemon.agents.liveUnder(new Set(["persona-x"]))).toBe(0);

    const asked = await rpc.callErr("agent.resume", { runtimeRunId: unplaced });
    expect(births, "the stamped run resumes into a new birth, as before").toEqual([
      `native-${unplaced}`,
    ]);
    expect(spawn).toHaveBeenCalledTimes(1);
    // the birth reached the floor, whose paper cell answers nothing: refused in
    // the floor's own words, which are no longer the inventory's age
    expect(asked.data?.kind).toBe("UNAVAILABLE");
    expect((asked.data?.details as { state?: unknown } | undefined)?.state).not.toBe(
      "inventory_stale",
    );
  });
});

/** The last run's picture of a bare shell (agent-last-run.left.json's terminal
 * row), as the pane of `sessionId`. */
function shellRow(sessionId: string): Record<string, unknown> {
  const board = fixture("agent-last-run.left.json")["board"] as {
    rows: Array<Record<string, unknown>>;
  };
  const shell = board.rows.find((row) => row["kind"] === "terminal") ?? {};
  return {
    ...shell,
    runtimeRunId: sessionId,
    terminal: { ...(shell["terminal"] as Record<string, unknown>), runtimeSessionId: sessionId },
    monitorRow: { ...(shell["monitorRow"] as Record<string, unknown>), id: sessionId },
  };
}

describe("what the last run left, over an old inventory (IL-D5 (a); the mock floor)", () => {
  it("agent.lastRun waits while a cell is stale — a session it has not listed yet is not gone — and once fresh names only what is", async () => {
    const late = "pty-born-before-the-cell-last-reconciled";
    const gone = "pty-that-did-not-survive";
    const { mock, daemon, rpc } = await agentDaemonOn(
      fixture("observed-state.stale-cell.json"),
      () => [],
      { lastBoard: [shellRow(late), shellRow(gone)] },
    );
    await until(() => daemon.agents.reattachSettled(), 5_000, "the re-attach ran");
    // past the picture's settle, so only the inventory's age can hold the answer
    await new Promise((resolve) => setTimeout(resolve, LAST_RUN_SETTLE_MS + 500));

    const waiting = await rpc.callErr("agent.lastRun", {});
    expect(answerOf(waiting), "an old list is an unobserved one").toEqual({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "agent-last-run", state: "starting" },
    });

    // the cell answers again, and its list holds the session born late
    const fresh = freshFloor();
    const rows = fresh["terminals"] as Array<Record<string, unknown>>;
    const agentCellRow = rows.find((row) => row["sessionId"] === CLAUDE);
    mock.pushObserved({
      ...fresh,
      terminals: [...rows, { ...agentCellRow, sessionId: late, pid: 50_001 }],
    });
    await until(() => daemon.terminals.staleCells().length === 0, 5_000, "fresh");
    const read = AgentLastRunResult.parse(await rpc.call("agent.lastRun", {}));
    expect(read.state).toBe("left");
    if (read.state === "left")
      expect(read.gone, "the late session lives; only the one that did not is left").toEqual([
        { id: gone, kind: "terminal", sessionId: gone },
      ]);
  });
});

// Item 59 — a run's exit after a termination fieldd asked for. ghosttea's
// terminate path "removes the entry at once and reports `exited` when the
// session concludes" (its service.rs), so the floor's inventory can drop a
// terminated PTY a whole ladder before its `session-exited`: an interactive sh
// ignores SIGTERM and concludes at the ladder's SIGKILL, some 4 s in. The
// runtime's backstop waits that out for a termination fieldd asked for
// (`TerminalService.terminationAskedAt`, whose own rows are terminal-service's)
// and keeps its ordinary grace for a PTY that left on its own. These rows hold
// the PENDING arm on the mock floor (a run re-attached at boot that its adapter
// cannot attach is held pending); agent-gateway's row 3 holds the managed arm on
// the real floor. The mock floor has no cell to take a real terminate, so the
// ask is the terminal service's answer (spied), and the exit is the floor's
// own event handed to the runtime as daemon.ts wires it. Real time: the daemon's
// sockets ride the same clock, and each gap below is generous against the
// constants (EXIT_GRACE_MS 1.5 s, ASKED_EXIT_GRACE_MS 6.5 s), never equal.
// The held run and the floor's words below are item 59's, and item 201's rows
// after them read the same run.
const RUN = "run-terminated";
/** freshFloor() without CLAUDE's row: the floor has stopped listing the PTY */
const withoutClaude = (): Record<string, unknown> => {
  const floor = freshFloor();
  const terminals = (floor["terminals"] as Array<{ sessionId: string }>).filter(
    (row) => row.sessionId !== CLAUDE,
  );
  return { ...floor, generation: Number(floor["generation"]) + 1, terminals };
};
/** the run re-attached at boot over a fresh floor that lists its PTY, held pending */
const heldRun = async () => {
  const box = await agentDaemonOn(freshFloor(), (dataDir) => [runRecord(RUN, CLAUDE, dataDir)]);
  await until(
    () => box.records.read(RUN)?.reattach !== undefined,
    10_000,
    "the run held pending at boot",
  );
  expect(box.records.read(RUN)?.exited, "held, not stamped").toBeUndefined();
  return box;
};
/** the floor's own `session-exited` for the PTY, as a terminate fieldd asked for ends it */
const exited = (): SessionExitedEvent => ({
  requestId: 0,
  type: "session-exited",
  sessionId: CLAUDE,
  exitCode: null,
  exitSignal: "SIGKILL",
  requestedTermination: "application",
  exitOutcome: "application-terminated",
});

describe("item 59 — a run's exit after a termination fieldd asked for (the mock floor)", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("asked: the floor drops the PTY first and its exit comes 3 s later — the record carries the terminal's word", async () => {
    const { mock, daemon, records } = await heldRun();
    const askedAt = Date.now();
    vi.spyOn(daemon.terminals, "terminationAskedAt").mockImplementation((id) =>
      id === CLAUDE ? askedAt : undefined,
    );
    mock.pushObserved(withoutClaude());
    // twice the ordinary grace: the old backstop would have stamped "unknown" by now
    await sleep(3_000);
    expect(
      records.read(RUN)?.exited,
      "nothing stamped while the asked exit is owed",
    ).toBeUndefined();
    const exitAt = Date.now();
    await daemon.agents.handleTerminalExit(exited());
    await until(() => records.read(RUN)?.exited !== undefined, 5_000, "the exit stamping the run");
    // the measured gaps, against EXIT_GRACE_MS 1.5 s and ASKED_EXIT_GRACE_MS 6.5 s
    console.log(
      `ITEM59_GAP ${JSON.stringify({ row: "asked", askToExitMs: exitAt - askedAt, askToStampMs: Date.now() - askedAt })}`,
    );
    expect(records.read(RUN)?.exited?.reason).toBe("application-terminated");
    // and the backstop's later turn changes nothing
    await sleep(4_500);
    expect(records.read(RUN)?.exited?.reason).toBe("application-terminated");
  }, 30_000);

  it("unasked: a PTY that left on its own is closed unknown after the ordinary grace, as before, and a late exit changes nothing", async () => {
    const { mock, daemon, records } = await heldRun();
    const droppedAt = Date.now();
    mock.pushObserved(withoutClaude());
    await until(
      () => records.read(RUN)?.exited !== undefined,
      10_000,
      "the backstop stamping the run",
    );
    console.log(
      `ITEM59_GAP ${JSON.stringify({ row: "unasked", dropToStampMs: Date.now() - droppedAt })}`,
    );
    expect(Date.now() - droppedAt, "never before the ordinary grace").toBeGreaterThanOrEqual(1_400);
    expect(Date.now() - droppedAt, "and not held for an ask nobody made").toBeLessThan(6_000);
    expect(records.read(RUN)?.exited?.reason).toBe("unknown");
    await daemon.agents.handleTerminalExit(exited());
    expect(records.read(RUN)?.exited?.reason).toBe("unknown");
  }, 30_000);

  it("asked, and the exit never comes: closed unknown only past the asked bound, counted from the ask", async () => {
    const { mock, daemon, records } = await heldRun();
    const askedAt = Date.now();
    vi.spyOn(daemon.terminals, "terminationAskedAt").mockImplementation((id) =>
      id === CLAUDE ? askedAt : undefined,
    );
    mock.pushObserved(withoutClaude());
    await sleep(4_500);
    expect(records.read(RUN)?.exited, "still owed well past the ordinary grace").toBeUndefined();
    await until(
      () => records.read(RUN)?.exited !== undefined,
      15_000,
      "the asked bound stamping the run",
    );
    console.log(
      `ITEM59_GAP ${JSON.stringify({ row: "asked-no-exit", askToStampMs: Date.now() - askedAt })}`,
    );
    expect(Date.now() - askedAt, "never before the asked bound").toBeGreaterThanOrEqual(6_000);
    expect(records.read(RUN)?.exited?.reason).toBe("unknown");
  }, 30_000);

  // Item 201 (RV #43, vf-runtime-3) — the replacement a resume of a held run is: the old PTY has EXITED, by the
  // floor's own `session-exited`, before its successor is born. Its leaving the inventory is not that word: the floor
  // drops a row whose termination fieldd asked for at once, and reports the exit when the session concludes, a ladder
  // later (the rows above). Past the asked bound the replacement refuses retryably, and an exit it heard while it held
  // the row closes the row with the floor's outcome. The terminate is the floor's answer (spied), as above.
  it("a replacement waits for the floor's exit, not the inventory's absence: nothing is born while the asked exit is owed, and the birth follows the exit", async () => {
    const { mock, daemon, rpc, births } = await heldRun();
    const askedAt = Date.now();
    vi.spyOn(daemon.terminals, "terminationAskedAt").mockImplementation((id) =>
      id === CLAUDE ? askedAt : undefined,
    );
    // the terminate the floor takes: the PTY leaves the inventory at once, and its exit is owed
    vi.spyOn(daemon.terminals, "terminate").mockImplementation(async () => {
      mock.pushObserved(withoutClaude());
      return { terminated: true };
    });
    const spawnedAt: number[] = [];
    const spawn = daemon.terminals.spawn.bind(daemon.terminals);
    vi.spyOn(daemon.terminals, "spawn").mockImplementation((spec) => {
      spawnedAt.push(Date.now());
      return spawn(spec);
    });
    const asked = rpc.callErr("agent.resume", { runtimeRunId: RUN });
    await until(
      () => daemon.terminals.get(CLAUDE) === undefined,
      5_000,
      "the PTY left the inventory",
    );
    // the old process's ladder, while its exit is owed: an idle TUI outlives the first ^C until SIGTERM at 2 s
    await sleep(1_500);
    expect(births, "nothing born while the asked exit is owed").toEqual([]);
    const exitAt = Date.now();
    await daemon.agents.handleTerminalExit(exited());
    await asked;
    expect(births, "the birth follows the floor's exit").toEqual([`native-${RUN}`]);
    expect(spawnedAt[0], "the successor asked for after it").toBeGreaterThanOrEqual(exitAt);
  }, 30_000);

  it("a replacement whose asked exit never comes refuses retryably at the asked bound and births nothing; the backstop closes the row unknown, with no inventory after the drop", async () => {
    const { mock, daemon, rpc, records, births } = await heldRun();
    const askedAt = Date.now();
    vi.spyOn(daemon.terminals, "terminationAskedAt").mockImplementation((id) =>
      id === CLAUDE ? askedAt : undefined,
    );
    vi.spyOn(daemon.terminals, "terminate").mockImplementation(async () => {
      mock.pushObserved(withoutClaude());
      return { terminated: true };
    });
    const spawn = vi.spyOn(daemon.terminals, "spawn");
    const refused = await rpc.callErr("agent.resume", { runtimeRunId: RUN });
    const refusedAfterMs = Date.now() - askedAt;
    expect(births, "nothing born without the floor's word").toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
    expect(answerOf(refused), "the replacement's own refusal, at the asked bound").toEqual({
      kind: "PRECONDITION_FAILED",
      retryable: true,
      details: {
        runtimeRunId: RUN,
        sessionId: CLAUDE,
        state: "terminal-alive",
        graceMs: ASKED_EXIT_GRACE_MS,
      },
    });
    // as item 59's row reads its bound: a timer's ms rounding never decides it
    expect(refusedAfterMs, "at the asked bound").toBeGreaterThanOrEqual(ASKED_EXIT_GRACE_MS - 500);
    // the refusal judges the backstop again (the replacement had held it off), and no inventory comes to arm it
    await until(
      () => records.read(RUN)?.exited?.reason === "unknown",
      5_000,
      "the backstop closing the row after the refusal",
    );
    expect(births).toEqual([]);
  }, 30_000);

  it("an exit heard during a replacement that is then refused closes the row with the floor's own outcome, and nothing is born", async () => {
    const { daemon, rpc, records, births } = await heldRun();
    // the floor's exit comes in the terminate's own read, and its connection dies before the answer
    vi.spyOn(daemon.terminals, "terminate").mockImplementation(async () => {
      await daemon.agents.handleTerminalExit(exited());
      throw new RpcCallError("UNAVAILABLE", "the terminal floor died mid-terminate", true, {
        service: "terminal",
        state: "unreachable",
      });
    });
    const refused = await rpc.callErr("agent.resume", { runtimeRunId: RUN });
    expect(refused.data?.kind).toBe("UNAVAILABLE");
    expect(records.read(RUN)?.exited?.reason, "the floor's word").toBe("application-terminated");
    expect(births).toEqual([]);
  }, 30_000);
});

// Item 201 (RV #17, gap2-6) — a held run's end reaches the run-ended listeners (`onRunEnded`) as a managed run's
// does. daemon.ts hangs the crews, the waker, the needs and the input queues there, and a pending run that ended
// told none of them: its kept words, held sends, crew member and watch stood until the next restart's settle
// reconcile. A held run ends through `closePending` (the floor's exit, the inventory's backstop, a typed run's
// watch, a withdrawal, a supersession) or through its replacement, at the point of no return. Each end is heard
// once, and a replacement's before its successor is born. The listener writes into the scripted agent's births, so
// one list orders the two.
describe("gap2-6 — a held run's end reaches its listeners (item 201; the mock floor)", () => {
  it("the floor's exit: the run is stamped, and its end is heard once", async () => {
    const { daemon, records, births: events } = await heldRun();
    daemon.agents.onRunEnded((id) => events.push(`ended:${id}`));
    await daemon.agents.handleTerminalExit(exited());
    expect(records.read(RUN)?.exited?.reason).toBe("application-terminated");
    expect(events, "heard once, and nothing born").toEqual([`ended:${RUN}`]);
  });

  it("its replacement: a person's resume ends the held run once, heard before its successor is born", async () => {
    const { mock, daemon, rpc, records, births: events } = await heldRun();
    daemon.agents.onRunEnded((id) => events.push(`ended:${id}`));
    // the terminate the floor would take: the ask stands from its call (item 59), and the PTY leaves the inventory
    let askedAt: number | undefined;
    vi.spyOn(daemon.terminals, "terminationAskedAt").mockImplementation((id) =>
      id === CLAUDE ? askedAt : undefined,
    );
    vi.spyOn(daemon.terminals, "terminate").mockImplementation(async () => {
      askedAt = Date.now();
      mock.pushObserved(withoutClaude());
      return { terminated: true };
    });
    const asked = rpc.callErr("agent.resume", { runtimeRunId: RUN });
    await until(
      () => daemon.terminals.get(CLAUDE) === undefined,
      5_000,
      "the PTY left the inventory",
    );
    // and the floor's exit for it, which the replacement holds: it closes nothing on its own
    await daemon.agents.handleTerminalExit(exited());
    await asked;
    expect(
      records.read(RUN)?.exited?.reason,
      "past the point of no return: the paper cell refused the successor's birth",
    ).toBe("replace-failed");
    expect(events, "the end, once, then the successor's birth").toEqual([
      `ended:${RUN}`,
      `native-${RUN}`,
    ]);
  }, 30_000);

  it("the inventory's backstop: a PTY that left on its own ends the run once, and the floor's late exit tells no one again", async () => {
    const { mock, daemon, records, births: events } = await heldRun();
    daemon.agents.onRunEnded((id) => events.push(`ended:${id}`));
    mock.pushObserved(withoutClaude());
    await until(
      () => records.read(RUN)?.exited !== undefined,
      10_000,
      "the backstop stamping the run",
    );
    expect(records.read(RUN)?.exited?.reason).toBe("unknown");
    expect(events, "heard once, at the backstop").toEqual([`ended:${RUN}`]);
    await daemon.agents.handleTerminalExit(exited());
    await daemon.agents.handleTerminalExit(exited());
    expect(records.read(RUN)?.exited?.reason, "the late exit changes nothing").toBe("unknown");
    expect(events, "and nobody hears it").toEqual([`ended:${RUN}`]);
  }, 30_000);
});

// Item 97 — a kept pane whose process ended stays listed (MF-1g), so its leaving the inventory is not how its end is
// told: the floor lists it `exited` (the contracts' husk fixture, ObservedTerminal.exited). The mock floor has no cell,
// so no `session-exited` exists here at all: the row is the only word. A run's record held pending (it predates the
// durable identity) is stamped from it, after the grace the floor's own exit would get to carry the outcome first.
describe("a husk the floor lists exited (item 97; the mock floor)", () => {
  /** observed-state.exited-husk.json's kept pane, on the agent cell */
  const HUSK = "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9";
  /** the husk fixture as its floor said it before the process ended: no row says `exited` */
  const beforeTheExit = () => {
    const husk = fixture("observed-state.exited-husk.json");
    const rows = husk["terminals"] as Array<Record<string, unknown>>;
    return { ...husk, terminals: rows.map(({ exited: _exited, ...row }) => row) };
  };
  /** the husk fixture once a terminate has removed the kept pane: the floor drops a husk's entry at once (ghosttea's
   * `Command::Terminate`), and the exit it told when the process ended is not told again */
  const withoutHusk = (): Record<string, unknown> => {
    const husk = fixture("observed-state.exited-husk.json");
    const rows = husk["terminals"] as Array<{ sessionId: string }>;
    return {
      ...husk,
      generation: Number(husk["generation"]) + 1,
      terminals: rows.filter((row) => row.sessionId !== HUSK),
    };
  };
  /** The grace, and the 5 s every row here gives an observation to land. */
  const STAMPED_WITHIN_MS = EXIT_GRACE_MS + 5_000;

  it("a pending run whose PTY is listed exited is stamped exited after the grace, with no exit event, and its row stays over the kept pane", async () => {
    const run = "run-pending-husk";
    const { mock, daemon, records } = await agentDaemonOn(beforeTheExit(), (dataDir) => [
      runRecord(run, HUSK, dataDir),
    ]);
    await until(
      () => daemon.agents.list().sessions.some((row) => row.runtimeRunId === run),
      5_000,
      "held pending",
    );
    expect(
      records.read(run)?.reattach?.state,
      "held: its record predates the durable identity",
    ).toBe("failed");
    expect(records.read(run)?.exited).toBeUndefined();

    mock.pushObserved(fixture("observed-state.exited-husk.json"));
    await until(() => daemon.terminals.get(HUSK)?.exited === true, 5_000, "the husk's row heard");
    await until(
      () => records.read(run)?.exited !== undefined,
      STAMPED_WITHIN_MS,
      "stamped exited from the husk's row",
    );
    expect(records.read(run)?.exited).toMatchObject({
      exitCode: null,
      signal: null,
      reason: "unknown",
    });
    // MF-1f — the pane is kept, so the row stays over it, exited (`closePending`'s hold)
    const row = daemon.agents.list().sessions.find((r) => r.runtimeRunId === run);
    expect(row?.continuation?.exited).toBe(true);
  });

  // Item 201 (RV #43, vf-runtime-3) — a replacement waits for the floor's word that the PTY it ended has exited, and
  // a husk's row is that word, said before the replacement asked: the floor told the exit when the process ended,
  // and a terminate of the kept pane does not tell it again. A guard: green on the inventory's absence before item
  // 201 (the terminate removes the pane), and on the husk's row after it.
  it("a person's resume of a pending run whose PTY is listed exited replaces it at once: the floor's row is its word that the process ended, and no exit is waited for", async () => {
    const run = "run-pending-husk-resumed";
    const { mock, daemon, rpc, records, births } = await agentDaemonOn(
      beforeTheExit(),
      (dataDir) => [runRecord(run, HUSK, dataDir)],
    );
    await until(
      () => daemon.agents.list().sessions.some((row) => row.runtimeRunId === run),
      5_000,
      "held pending",
    );
    // the terminate the floor takes on a kept pane: the ask stands from its call (item 59), the pane leaves the
    // inventory at once, and the answer is Ok
    let askedAt: number | undefined;
    vi.spyOn(daemon.terminals, "terminationAskedAt").mockImplementation((id) =>
      id === HUSK ? askedAt : undefined,
    );
    vi.spyOn(daemon.terminals, "terminate").mockImplementation(async () => {
      askedAt = Date.now();
      mock.pushObserved(withoutHusk());
      return { terminated: true };
    });
    mock.pushObserved(fixture("observed-state.exited-husk.json"));
    await until(() => daemon.terminals.get(HUSK)?.exited === true, 5_000, "the husk's row heard");
    // asked within the husk's grace (EXIT_GRACE_MS), before the backstop it arms could close the row
    const asked = await rpc.callErr("agent.resume", { runtimeRunId: run });
    expect(
      (asked.data?.details as { state?: unknown } | undefined)?.state,
      "never refused as alive: the husk's process has ended",
    ).not.toBe("terminal-alive");
    expect(births, "the successor is born, with no wait for an exit already told").toEqual([
      `native-${run}`,
    ]);
    expect(
      records.read(run)?.exited?.reason,
      "past the point of no return: the paper cell refused the successor's birth",
    ).toBe("replace-failed");
  }, 30_000);

  it("a restart across the exit: a record whose pane the FIRST inventory lists exited is stamped after the boot's grace, never held as running", async () => {
    // fieldd was down while the agent ended; the floor kept its pane, listed `exited`, and has no exit event to give
    const run = "run-ended-while-fieldd-was-down";
    const { daemon, records } = await agentDaemonOn(
      fixture("observed-state.exited-husk.json"),
      (dataDir) => [runRecord(run, HUSK, dataDir)],
    );
    await until(
      () => records.read(run)?.exited !== undefined,
      STAMPED_WITHIN_MS,
      "stamped by the boot sweep",
    );
    expect(records.read(run)?.exited).toMatchObject({
      exitCode: null,
      signal: null,
      reason: "unknown",
    });
    expect(records.read(run)?.reattach, "never held: no attach was tried").toBeUndefined();
    await until(() => daemon.agents.reattachSettled(), 5_000, "the re-attach settled");
    // MF-1f — on THIS boot, the row is back over the kept pane, exited (never a blank until the next)
    const row = daemon.agents.list().sessions.find((r) => r.runtimeRunId === run);
    expect(row?.continuation?.exited).toBe(true);
  });
});

// Item 201 (RV #49, vf-runtime-8) — a record whose PTY the first inventory lacked waits the boot's grace, then is
// stamped as a PTY that did not survive (AR-4b). The re-attach holds such records one at a time, and between two of
// them it awaits a listed record's attach (a claim, the audit, puppeteer's attach, a typed run's read of the process
// table), so one batch's records are held at different moments, each with its own deadline. field-native publishes
// only on a change: on a quiet floor no inventory comes to sweep a record the boot's own timer does not, and one left
// unswept keeps the re-attach unsettled, its persona counted as running and a husk without its exited row. The await
// here is a typed run's proof, slowed by the row's process table, which then says its process is gone.
describe("the boot's grace, per record (item 201, vf-runtime-8; the mock floor)", () => {
  /** B is held this long after A: past the moment A's grace began, and well before A's sweep fires (EXIT_GRACE_MS
   * after A, and 100 ms more before item 201), some 700 ms from either edge. */
  const SLOW_PROOF_MS = (EXIT_GRACE_MS + 100) / 2;
  /** The grace, and the 5 s every row here gives an observation to land. */
  const STAMPED_WITHIN_MS = EXIT_GRACE_MS + 5_000;

  it("two records no inventory lists, held either side of a slow typed proof, are each stamped at their own grace, with no inventory after the first", async () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    const { daemon, records } = await agentDaemonOn(
      freshFloor(),
      // newest first (`SessionRecordStore.list`): A, the typed run on the listed shell, then B
      (dataDir) => [
        runRecord("run-a", "pty-not-listed-a", dataDir, { updatedAt: ago(1_000) }),
        runRecord("run-t", ZSH, dataDir, {
          spawnedBy: "user-shell",
          process: { pid: 999_999, startedAt: ago(60_000) },
          updatedAt: ago(2_000),
        }),
        runRecord("run-b", "pty-not-listed-b", dataDir, {
          profileId: "persona-b",
          updatedAt: ago(3_000),
        }),
      ],
      {
        // the typed run's proof reads the table late and finds its process gone (read, so not retried)
        processTable: async () => {
          await new Promise((resolve) => setTimeout(resolve, SLOW_PROOF_MS));
          return new Map();
        },
      },
    );
    await until(
      () => records.read("run-a")?.exited !== undefined,
      STAMPED_WITHIN_MS,
      "A stamped by its sweep",
    );
    expect(
      records.read("run-t")?.exited?.reason,
      "the typed run's slow proof ran, so B was held after it",
    ).toBe("unknown");
    // no inventory is pushed: B's own grace is the only thing that can end its wait
    await until(
      () => records.read("run-b")?.exited !== undefined,
      STAMPED_WITHIN_MS,
      "B stamped by its own grace",
    );
    expect(records.read("run-b")?.exited?.reason).toBe("unknown");
    expect(daemon.agents.reattachSettled(), "no record is held past its grace").toBe(true);
    expect(
      daemon.agents.liveUnder(new Set(["persona-b"])),
      "and no phantom counts under B's persona",
    ).toBe(0);
  });
});
