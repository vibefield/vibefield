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
import type { AgentAdapterBinding } from "@vibecook/puppeteer-core";
import type { AgentProvider, AgentProviderSessionOptions } from "@vibecook/puppeteer-runtime";
import {
  AgentLastRunResult,
  type AgentSessionRecord,
  LAYOUT,
  SOCKETS,
  TerminalInventoryStaleDetails,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { LAST_RUN_SETTLE_MS } from "../src/agent-last-run";
import { bootstrap, type FielddDaemon, SessionRecordStore } from "../src/index";
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

/** A daemon over the mock floor answering `observedState` on the fixtures'
 * routes, its agent runtime composing the scripted agent, `staged(dataDir)`
 * written as signed records before it boots, and `lastBoard`, when given, as
 * the last run's picture of the board; and a connection that may resume
 * (`agent.spawn`) and read the fold. */
async function agentDaemonOn(
  observedState: unknown,
  staged: (dataDir: string) => AgentSessionRecord[],
  lastBoard?: Array<Record<string, unknown>>,
): Promise<AgentFloor> {
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
    agentGateway: { enabled: false },
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
      [shellRow(late), shellRow(gone)],
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
