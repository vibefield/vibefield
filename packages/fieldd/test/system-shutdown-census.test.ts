// Item 192 (RV #6, gap3-1) — fieldd's OWN stop has a census, over the REAL floor (agent-gateway-floor.ts: a
// field-native the test spawns, fieldd in this process, the scripted agent and nothing of any vendor's).
//
// A release that leaves field-native's bytes alone stops fieldd alone, and the floor's terminal sessions live on. Its
// agent runs do not all: an agent whose helper lives in fieldd's own process tree dies with fieldd (its adapter
// cannot release), so the run's pane is left a viewer of a dead agent. fieldd is the one authority on which runs
// those are — every live managed run of this boot whose catalog row claims no re-attach, read from the catalog with
// no vendor named (AR-L1, R23b) — and it says so on `system.shutdown.census` (the shell's alone). The person consents
// to that set, and fieldd re-checks it at the point of effect (`system.shutdown {agents: {runs}}`) with its launches
// closed: a run born since, or a birth in flight, refuses `PRECONDITION_FAILED {live, births}` — the floor's stop's
// own shape — and every refusal reopens the launches.
//
// The launch gate sits at the doors (spawn, resume, adopt) and at the head of an automatic replacement, NEVER inside
// a birth: a replacement whose old PTY is already gone must still birth its successor (AR-4b's hazard).
//
// The scripted row of THE table claims re-attach (`SCRIPTED_ROW`, `TYPED_CATALOG`): the counted runs here run under
// a catalog whose scripted row does not (`ENDS_WITH_FIELDD`), and the default catalog is the row that claims it.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentCatalogEntry,
  type AgentSessionSummary,
  SystemShutdownCensusResult,
} from "@vibefield/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AgentAdoptionInput } from "../src/agent-runtime";
import { born as birth } from "./agent-birth";
import { catalogWith } from "./agent-catalog-fixture";
import { TYPED_PROVIDER } from "./agent-gateway-fixture";
import {
  auditActs,
  END_OF_INPUT,
  FLOOR_BUDGET_MS,
  FLOOR_WAIT_MS,
  type Floor,
  floor,
  indexedSession,
  indexRequests,
  key,
  listedRow,
  poll,
  rowOf,
  teardownFloors,
} from "./agent-gateway-floor";
import { bundleAgentShim } from "./agent-shim-bundle";
import { helloAs, WsRpc } from "./ws-rpc";

/** The scripted row as an agent whose helper lives in fieldd's tree: it claims no re-attach, so fieldd's stop ends it. */
const ENDS_WITH_FIELDD: readonly AgentCatalogEntry[] = catalogWith(TYPED_PROVIDER, {
  offers: { invoke: true, reattach: false } as AgentCatalogEntry["offers"],
});

/** A loaded host takes seconds to start a process: no row here asserts speed. */
const PROCESS_BUDGET_MS = 60_000;

let bundleDir: string;
let shimScript: string;
beforeAll(async () => {
  bundleDir = mkdtempSync(join(tmpdir(), "vf-shim-"));
  shimScript = await bundleAgentShim(bundleDir);
}, PROCESS_BUDGET_MS);
afterAll(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

let sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets = [];
  await teardownFloors();
});

/** The local shell (`shell-main`, the shell's token, loopback): the one caller of the census door. */
async function shellOf(box: Floor): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${box.daemon.controlPort}`);
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, box.daemon.shellToken, "shell-main");
  return rpc;
}

interface Run {
  runId: string;
  /** the run's pane on the floor */
  sessionId: string;
  /** the agent's own conversation id, as the index files it */
  nativeId: string;
}

/** The window's spawn of the scripted agent in the row's work folder. */
const spawnOf = (box: Floor) => ({ provider: TYPED_PROVIDER, cwd: box.work });

/** A managed run born through the window's door, its pane listed. */
async function spawnRun(box: Floor): Promise<Run> {
  const born = (await birth(box.win, "agent.spawn", spawnOf(box))) as {
    session: AgentSessionSummary;
    terminal: { sessionId: string };
  };
  await poll(() => listedRow(box, born.terminal.sessionId), FLOOR_WAIT_MS, "the run's pane listed");
  return {
    runId: born.session.runtimeRunId,
    sessionId: born.terminal.sessionId,
    nativeId: born.session.sessionId,
  };
}

/** The census door's answer, once fieldd's re-attach has settled (it refuses `reattaching` until then); any other
 * refusal is the row's to read at once. */
async function censusOf(shell: WsRpc): Promise<SystemShutdownCensusResult> {
  return await poll(
    async (seen) => {
      const answer = await shell.attempt("system.shutdown.census", {});
      seen(answer);
      if (answer.ok) return SystemShutdownCensusResult.parse(answer.result);
      const details = answer.error.data?.details as { state?: unknown } | undefined;
      if (answer.error.data?.kind === "UNAVAILABLE" && details?.state === "reattaching")
        return undefined;
      throw new Error(`the census door refused: ${JSON.stringify(answer.error)}`);
    },
    FLOOR_WAIT_MS,
    "fieldd's census of its own stop",
  );
}

/** A launch refused because a stop holds the launches closed: retryable, in the adopt door's own words. */
const STOPPING = {
  kind: "UNAVAILABLE",
  retryable: true,
  details: { service: "agents", state: "stopping" },
};

/** A pending run: born on one fieldd, released by its stop, held by the next (the scripted adapter cannot attach). */
async function pendingRun(index?: { afterMs: number; pollMs: number }): Promise<{
  box: Floor;
  kept: Run;
}> {
  const first = await floor({
    bundle: shimScript,
    catalog: ENDS_WITH_FIELDD,
    ...(index ? { index } : {}),
  });
  const kept = await spawnRun(first);
  await first.daemon.stop();
  const box = await floor({
    bundle: shimScript,
    restartOf: first,
    catalog: ENDS_WITH_FIELDD,
    ...(index ? { index } : {}),
  });
  await poll(
    () => (rowOf(box, kept.runId)?.continuation?.reason === undefined ? undefined : true),
    FLOOR_WAIT_MS,
    "the run from the boot before held pending",
  );
  return { box, kept };
}

/** Wait, turn by turn of the event loop, for fieldd's census to count a birth in flight: a creation or a replacement
 * awaits the floor across many turns, so a turn-by-turn read sees it (a poll's 100 ms could step over it). */
async function birthInFlight(box: Floor): Promise<number> {
  const deadline = Date.now() + FLOOR_WAIT_MS;
  for (;;) {
    const census = box.daemon.agents.plainStopCensus();
    if (census.settled && census.births > 0) return census.births;
    if (Date.now() > deadline) throw new Error("no birth in flight was ever counted");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("system.shutdown.census — fieldd counts what its own stop ends (RV #6)", () => {
  it(
    "the door names the live run a fieldd-only stop ends, and the consented stop re-checks it at the point of effect: a mismatch refuses and reopens the launches, the exact set stops fieldd and the launches stay closed",
    async () => {
      const box = await floor({ bundle: shimScript, catalog: ENDS_WITH_FIELDD });
      let asked = 0;
      box.daemon.onShutdownRequest(() => {
        asked += 1;
      });
      const first = await spawnRun(box);
      const shell = await shellOf(box);

      // the run, by the id fieldd re-checks, with its agent's label and its pane
      const census = await censusOf(shell);
      expect(census.runs).toEqual([
        expect.objectContaining({
          runId: first.runId,
          sessionId: first.sessionId,
          agent: "Scripted",
        }),
      ]);

      // a consent that names nothing refuses in the floor's stop's own shape, and nothing stops
      const none = await shell.callErr("system.shutdown", {
        reason: "update",
        agents: { runs: [] },
      });
      expect(none.data).toMatchObject({
        kind: "PRECONDITION_FAILED",
        details: { live: [first.runId], births: 0 },
      });
      expect(asked).toBe(0);

      // the refusal reopened the launches: a later run is born, and a consent read before it refuses
      const second = await spawnRun(box);
      const stale = await shell.callErr("system.shutdown", {
        reason: "update",
        agents: { runs: [first.runId] },
      });
      expect(stale.data?.kind).toBe("PRECONDITION_FAILED");
      const staleDetails = stale.data?.details as { live?: string[] } | undefined;
      expect([...(staleDetails?.live ?? [])].sort()).toEqual([first.runId, second.runId].sort());
      expect(asked).toBe(0);

      // one stop names ONE census: the floor's and fieldd's together are malformed, refused before anything closes
      const both = await shell.callErr("system.shutdown", {
        reason: "update",
        native: { stop: true, sessions: [] },
        agents: { runs: [] },
      });
      expect(both.data?.kind).toBe("PRECONDITION_FAILED");
      // the malformed answer, not the floor's census refusing a consent that names no session
      expect(both.message).toContain("never both");
      expect(asked).toBe(0);
      // nothing was closed by the malformed ask: a third run is born
      const third = await spawnRun(box);

      // the exact set, read fresh: fieldd stops, and from then on nothing is launched
      const runs = (await censusOf(shell)).runs.map((run) => run.runId);
      expect([...runs].sort()).toEqual([first.runId, second.runId, third.runId].sort());
      const stopped = await shell.call("system.shutdown", { reason: "update", agents: { runs } });
      expect(stopped).toMatchObject({ stopping: true });
      await poll(() => (asked === 1 ? true : undefined), FLOOR_WAIT_MS, "the stop's owner asked");
      const closed = await box.win.callErr("agent.spawn", spawnOf(box));
      expect(closed.data).toMatchObject(STOPPING);
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "a run whose row claims re-attach is not counted: the census is empty, and the stop that names nothing goes",
    async () => {
      // THE table's scripted row claims re-attach (`TYPED_CATALOG`, the harness's default)
      const box = await floor({ bundle: shimScript });
      let asked = 0;
      box.daemon.onShutdownRequest(() => {
        asked += 1;
      });
      await spawnRun(box);
      const shell = await shellOf(box);
      expect((await censusOf(shell)).runs).toEqual([]);
      const stopped = await shell.call("system.shutdown", {
        reason: "update",
        agents: { runs: [] },
      });
      expect(stopped).toMatchObject({ stopping: true });
      await poll(() => (asked === 1 ? true : undefined), FLOOR_WAIT_MS, "the stop's owner asked");
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "the door is the local shell's alone: a window holding native.admin is refused",
    async () => {
      const box = await floor({ bundle: shimScript, catalog: ENDS_WITH_FIELDD });
      const admin = box.daemon.tokens.mint(["native.admin"], "census-test");
      const ws = new WebSocket(`ws://127.0.0.1:${box.daemon.controlPort}`);
      sockets.push(ws);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      const window = new WsRpc(ws);
      await helloAs(window, admin.token);
      const refused = await window.callErr("system.shutdown.census", {});
      expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
    },
    FLOOR_BUDGET_MS,
  );
});

describe("plainStopCensus — this boot's live runs, and the births in flight (RV #6)", () => {
  it(
    "a pending run from the boot before is not counted, nor a run that ended; a run born this boot is, and a creation in flight is a birth",
    async () => {
      const { box, kept } = await pendingRun();
      const shell = await shellOf(box);
      // the plain stop ends nothing more of a run this fieldd never attached
      expect((await censusOf(shell)).runs).toEqual([]);
      expect(rowOf(box, kept.runId)).toBeDefined();

      const fresh = await spawnRun(box);
      expect(box.daemon.agents.plainStopCensus()).toEqual({
        settled: true,
        runs: [
          { runtimeRunId: fresh.runId, terminalSessionId: fresh.sessionId, agent: "Scripted" },
        ],
        births: 0,
      });

      // a birth the door has not answered yet is counted while it is in flight, and is a run once it is born
      const spawning = birth(box.win, "agent.spawn", spawnOf(box));
      expect(await birthInFlight(box)).toBeGreaterThan(0);
      const later = (await spawning) as { session: AgentSessionSummary };
      const counted = await poll(
        () => {
          const now = box.daemon.agents.plainStopCensus();
          return now.settled && now.births === 0 && now.runs.length === 2 ? now : undefined;
        },
        FLOOR_WAIT_MS,
        "the birth counted as a run",
      );
      expect(counted.runs.map((run) => run.runtimeRunId).sort()).toEqual(
        [fresh.runId, later.session.runtimeRunId].sort(),
      );

      // an ended run leaves the census though its pane may stay
      await key(box, { sessionId: fresh.sessionId, pid: 0 }, END_OF_INPUT);
      await poll(
        () => {
          const now = box.daemon.agents.plainStopCensus();
          return now.settled && !now.runs.some((run) => run.runtimeRunId === fresh.runId)
            ? true
            : undefined;
        },
        FLOOR_WAIT_MS,
        "the ended run leaving the census",
      );
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "while a stop holds the launches closed, spawn, resume and adopt refuse UNAVAILABLE {agents, stopping}; reopened, a spawn is born and the pending run is resumed",
    async () => {
      const { box, kept } = await pendingRun();
      box.daemon.agents.closeLaunchesForStop();

      const spawned = await box.win.callErr("agent.spawn", spawnOf(box));
      expect(spawned.data).toMatchObject(STOPPING);
      const resumedClosed = await box.win.callErr("agent.resume", { runtimeRunId: kept.runId });
      expect(resumedClosed.data).toMatchObject(STOPPING);
      // the typed run's door: refused before the fold is touched (the gateway undoes the adoption in puppeteer)
      const adoption = {
        info: { runtimeRunId: "run-typed", terminalSessionId: "pane-typed" },
        cwd: box.work,
        process: { pid: process.pid, startedAt: new Date().toISOString() },
        launched: { creationRequestId: "creation-typed" },
      } as unknown as AgentAdoptionInput;
      await expect(box.daemon.agents.adopt(adoption)).rejects.toMatchObject(STOPPING);
      // the pending run's PTY was never touched
      expect(listedRow(box, kept.sessionId)).toBeDefined();

      box.daemon.agents.reopenLaunches();
      await spawnRun(box);
      const resumed = (await birth(box.win, "agent.resume", { runtimeRunId: kept.runId })) as {
        session: AgentSessionSummary;
      };
      expect(resumed.session.terminal?.replaced).toBe(kept.sessionId);
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "a resume still awaiting the index when a stop closes the launches is refused at its birth, and nothing is born: the gate is asked again where the door awaited",
    async () => {
      const box = await floor({ bundle: shimScript, catalog: ENDS_WITH_FIELDD });
      await poll(
        () => (box.daemon.agents.plainStopCensus().settled ? true : undefined),
        FLOOR_WAIT_MS,
        "the boot's re-attach settled",
      );
      // the index's round trip held open: the native resume has passed its door's gate and waits outside `creating`,
      // where the census counts no birth for it
      let reached!: () => void;
      const waiting = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let answer!: () => void;
      const held = new Promise<void>((resolve) => {
        answer = resolve;
      });
      const asked = vi.spyOn(box.daemon.index, "nativeSessionAgent");
      asked.mockImplementation(async () => {
        reached();
        await held;
        return { provider: TYPED_PROVIDER, cwd: box.work };
      });
      const resuming = box.win.callErr("agent.resume", {
        provider: TYPED_PROVIDER,
        nativeSessionId: "held-conversation",
      });
      await waiting;

      // the stop closes the launches and compares: nothing is live and nothing is being born, so it would go
      box.daemon.agents.closeLaunchesForStop();
      expect(box.daemon.agents.plainStopCensus()).toEqual({ settled: true, runs: [], births: 0 });

      // answered now, the resume is refused before its birth starts, and no run is born behind the stop
      answer();
      expect((await resuming).data).toMatchObject(STOPPING);
      expect(asked).toHaveBeenCalledTimes(1);
      expect(box.daemon.agents.plainStopCensus()).toEqual({ settled: true, runs: [], births: 0 });
      asked.mockRestore();
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "the gate sits at an automatic replacement's start: closed launches leave the idle pending run's PTY alone, and the idle poll replaces it once they reopen",
    async () => {
      // the index answers nothing of the conversation yet: not idle, so nothing is replaced while the row sets up
      const { box, kept } = await pendingRun({ afterMs: 1_000, pollMs: 200 });
      const asks = (): number =>
        indexRequests(box).filter((line) => line.includes(kept.nativeId)).length;
      box.daemon.agents.closeLaunchesForStop();
      const before = asks();
      writeFileSync(box.sessionsFile, JSON.stringify([indexedSession(kept.nativeId, 60_000)]));

      // the poller asks, finds the run idle, and the gate refuses before the old PTY is ended; the refusal re-arms the
      // poll, so it keeps asking while the launches are closed. A poll that stopped asks at most twice more: one in
      // flight when `before` was read, and the one the gate refused — so five more asks are only a re-armed poll's
      await poll(
        () => (asks() > before + 4 ? true : undefined),
        FLOOR_WAIT_MS,
        "the refused idle poll asking again while the launches are closed",
      );
      expect(listedRow(box, kept.sessionId)).toBeDefined();
      expect(rowOf(box, kept.runId)?.continuation?.reason).toBeDefined();
      expect(auditActs(box.dataDir, "agent.session.resume")).toEqual([]);

      box.daemon.agents.reopenLaunches();
      await poll(
        () =>
          auditActs(box.dataDir, "agent.session.resume").find(
            (act) => act.attempt.target.id === kept.runId && act.outcome?.outcome === "succeeded",
          ),
        FLOOR_WAIT_MS,
        "the idle run replaced once the launches reopened",
      );
      await poll(
        () => (listedRow(box, kept.sessionId) === undefined ? true : undefined),
        FLOOR_WAIT_MS,
        "the replaced PTY gone",
      );
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "a replacement in flight is a birth, and once past its point of no return it births its successor under closed launches: the gate is never inside the birth itself",
    async () => {
      const { box, kept } = await pendingRun({ afterMs: 1_000, pollMs: 200 });
      writeFileSync(box.sessionsFile, JSON.stringify([indexedSession(kept.nativeId, 60_000)]));
      // the replacement is tracked only once its head (where the gate is) has passed, so the stop closes the launches
      // behind it — the successor's birth, after the old PTY is ended, must not be refused
      expect(await birthInFlight(box)).toBeGreaterThan(0);
      box.daemon.agents.closeLaunchesForStop();
      const successor = await poll(
        () =>
          box.daemon.agents
            .list()
            .sessions.find(
              (row) => row.terminal?.replaced === kept.sessionId && row.runtimeRunId !== kept.runId,
            ),
        FLOOR_WAIT_MS,
        "the successor born under closed launches",
      );
      expect(listedRow(box, kept.sessionId)).toBeUndefined();
      // the successor is a live run this boot: fieldd's stop would end it, and nothing is in flight now
      const settled = await poll(
        () => {
          const now = box.daemon.agents.plainStopCensus();
          return now.settled && now.births === 0 ? now : undefined;
        },
        FLOOR_WAIT_MS,
        "the replacement settled",
      );
      expect(settled.runs.map((run) => run.runtimeRunId)).toEqual([successor.runtimeRunId]);
      // and the doors stay closed until a refusal reopens them
      const closed = await box.win.callErr("agent.spawn", spawnOf(box));
      expect(closed.data).toMatchObject(STOPPING);
    },
    FLOOR_BUDGET_MS,
  );
});
