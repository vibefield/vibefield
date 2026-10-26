// @vitest-environment happy-dom
/**
 * MV-3d (M35, M47) — FIND'S JOIN (the find sheet's until P2; since then the
 * rows the monitor lends the frame's Peek for Live now, `find-door.ts`).
 *
 * The find sheet joins rosetta's hits by each run's provider-native session id
 * and scopes and dates them by the mirror's clocks — facts the model does not
 * carry (M19). It reads them off `agent.nativeSessionId` and `agent.monitor`
 * (`find-model.ts`: `monitor?.session.nativeSessionId`, `session.startedAt`,
 * `statusSince`, `freshness.lastEvidenceAt`) on EVERY render, open or closed.
 *
 * At 283cf3e9 the window joined those facts from the fold's `full` board, and an
 * observed local row the model board delivered before the full board did kept
 * the legacy shim's `agent.monitor` — the views' object, with no `session` and
 * no `freshness` — so `liveScope` threw in the stage's render and unmounted it
 * (build-mv M47: the bundle's `z$` ← `B$`, intermittent with the two
 * subscriptions' race). Since MV-3d the facts ride the run's own row of the
 * model board (`local`), and `findAgentsOf` never hands the sheet the shim's
 * monitor. The original regression ran red at 283cf3e9 and green after MV-3d.
 * The first block keeps that model-only arrival case after MV-8 removes the
 * old door; the second holds the join's rules.
 */

import type { AgentView } from "@vibefield/puppeteer-view-sdk/model";
import { agentViewFixture } from "@vibefield/puppeteer-view-sdk/testing";
import type { FindAgent } from "@vibefield/puppeteer-views";
import {
  buildFindRows,
  type HistoryPort,
  lastActiveMs,
  liveScope,
  useMonitorPalette,
} from "@vibefield/puppeteer-views";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createFindAgents, findJoinKey } from "../src/godview/monitor/find-agents";
import { GodviewAgentsProvider } from "../src/godview/monitor/GodviewAgentsProvider";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import { useMonitorAgents } from "../src/godview/monitor/useMonitorAgents";
import { chromeRunOf } from "./chrome-run-fixture";
import { managedSummary } from "./managed-session-fixture";
import { type ScriptedModelBoard, scriptedModelBoard } from "./model-board-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHECKED_AT = "2026-10-05T00:00:00.000Z";
const nothing: HistoryPort = {
  status: async () => ({ reachable: false, detail: "none", checkedAt: CHECKED_AT }),
  facts: async () => [],
  search: async () => ({
    status: { reachable: false, detail: "none", checkedAt: CHECKED_AT },
    answered: false,
    hits: [],
    clipped: false,
  }),
};

let root: Root | null = null;
let container: HTMLElement | null = null;
let board: ScriptedModelBoard | null = null;
let latest: readonly FindAgent[] | null = null;
let errors: unknown[] = [];

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  board?.dispose();
  board = null;
  latest = null;
  errors = [];
});

/** The stage's own path to Live now's rows: the window's rows and joins
 * (`useMonitorAgents`), read on every render as `GodviewMonitor` reads them
 * (and the find model run over them, as the Peek runs it — `liveScope`). */
function Probe({ door }: { door: MonitorDoor }): ReactElement | null {
  const palette = useMonitorPalette();
  const { findAgents } = useMonitorAgents({ palette, door, panes: { sessionIds: [] } });
  latest = findAgents;
  liveScope(findAgents);
  return null;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("M47 — the find sheet never reads the views' monitor", () => {
  it("an observed run on the model board, with the fold's full board never answering, draws and joins", async () => {
    board = scriptedModelBoard({
      rows: [managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a", kind: "claude" })],
    });
    const door: MonitorDoor = {
      model: board.port,
      attach: async () => ({ state: "no-pane" }),
      createTerminal: async () => ({ state: "no-pane" }),
      mountLocal: async () => ({ state: "no-pane" }),
      transcripts: nothing,
      usage: {
        snapshot: async () => ({ refreshedAt: CHECKED_AT, entries: [] }),
        subscribe: () => () => undefined,
      },
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container, {
      onUncaughtError: (error) => {
        errors.push(error);
      },
    });
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={door}>
          <Probe door={door} />
        </GodviewAgentsProvider>,
      );
    });
    await settle();
    expect(errors).toEqual([]);
    const rows = latest ?? [];
    expect(rows.filter((row) => row.agent !== undefined)).toHaveLength(1);
    // the sheet joins the run by its provider-native id, scoped from the mirror
    const scope = liveScope(rows);
    expect(scope.nativeSessionIds).toEqual(["run-a-native"]);
    expect(scope.afterMs).toBeTypeOf("number");
  });
});

/** A backend model row; its local transcript clocks live beside it. */
function modelRow(id: string, extra: Partial<AgentView> = {}): AgentView {
  return agentViewFixture({
    id,
    createdAt: Date.parse("2026-09-12T10:00:00.000Z"),
    status: "working",
    project: { name: "vibe-field" },
    provider: { id: "codex", label: "Codex" },
    ...extra,
  });
}

describe("the join's rules (`createFindAgents`)", () => {
  const findAgentsOf = createFindAgents();
  const spoken = managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a" });
  const spokenRun = {
    ...chromeRunOf({
      ...spoken,
      monitor: {
        ...(spoken.monitor as NonNullable<typeof spoken.monitor>),
        session: { nativeSessionId: "run-a-native", startedAt: "2026-09-12T09:58:00.000Z" },
        freshness: { lastEvidenceAt: "2026-09-12T10:04:00.000Z", level: "native-hooks" },
      },
    }),
  };
  const unspokenRun = chromeRunOf(
    managedSummary({ runtimeRunId: "run-b", terminalSessionId: "pty-b", monitor: false }),
  );

  it("a run the provider has spoken for: its native id, and the mirror's three clocks in the mirror's shape — never the shim's", () => {
    const [row] = findAgentsOf([modelRow("row-a")], new Map([["row-a", "run-a"]]), [spokenRun]);
    expect(row?.agent?.nativeSessionId).toBe("run-a-native");
    expect(row?.agent?.monitor).toEqual({
      statusSince: "2026-09-12T10:00:00.000Z",
      session: { startedAt: "2026-09-12T09:58:00.000Z" },
      freshness: { lastEvidenceAt: "2026-09-12T10:04:00.000Z" },
    });
    // what the sheet does with it: scoped from the session's start, dated by the newest evidence
    expect(liveScope(row === undefined ? [] : [row])).toEqual({
      nativeSessionIds: ["run-a-native"],
      afterMs: Date.parse("2026-09-12T09:58:00.000Z") - 5 * 60_000,
    });
    expect(row === undefined ? 0 : lastActiveMs(row, Date.parse("2026-09-12T11:00:00.000Z"))).toBe(
      Date.parse("2026-09-12T10:04:00.000Z"),
    );
  });

  it("a run before its first state, and a row the chrome holds no run for, carry no monitor at all", () => {
    const rows = findAgentsOf(
      [modelRow("row-b"), modelRow("row-orphan")],
      new Map([
        ["row-b", "run-b"],
        ["row-orphan", "run-gone"],
      ]),
      [unspokenRun],
    );
    expect(rows[0]?.agent?.nativeSessionId).toBe("run-b-native");
    expect(rows[0]?.agent?.monitor).toBeUndefined();
    expect(rows[1]?.agent?.nativeSessionId).toBeUndefined();
    expect(rows[1]?.agent?.monitor).toBeUndefined();
    // the sheet reads them without throwing: scope from the birth, dated by it
    expect(() => liveScope(rows)).not.toThrow();
    expect(() =>
      buildFindRows({ agents: rows, facts: new Map(), hits: [], query: "", nowMs: 0 }),
    ).not.toThrow();
    expect(liveScope(rows).nativeSessionIds).toEqual(["run-b-native"]);
  });

  it("keeps peers searchable without joining local transcript clocks or accounts", () => {
    const peer = modelRow("peer-1", {
      device: { id: "desk-peer", name: "Loft", self: false },
      model: "peer-model",
      account: "peer-secret",
      project: { name: "rosetta", branch: "mesh" },
      reply: { text: "Ready for review" },
    });
    const terminal = modelRow("pty-c", { kind: "terminal", detail: "running" });
    const rows = findAgentsOf([peer, terminal], new Map([[peer.id, spokenRun.runtimeRunId]]), [
      spokenRun,
    ]);
    expect(rows[0]).toMatchObject({
      project: "rosetta",
      detail: "Loft · Ready for review",
      agent: { model: "peer-model", branch: "mesh" },
    });
    expect(rows[0]?.agent?.account).toBeUndefined();
    expect(rows[0]?.agent?.nativeSessionId).toBeUndefined();
    expect(rows[0]?.agent?.monitor).toBeUndefined();
    expect(rows[1]?.agent).toBeUndefined();
    expect(rows[1]?.detail).toBe("running");
    expect(liveScope(rows).nativeSessionIds).toEqual([]);
    expect(
      buildFindRows({ agents: rows, facts: new Map(), hits: [], query: "review", nowMs: 0 }).map(
        (row) => row.agent.id,
      ),
    ).toEqual([peer.id]);
  });

  it("says where each run runs, and names this desktop's floor session — never a peer's (P2)", () => {
    const project = createFindAgents();
    const own = modelRow("row-a", {
      device: { id: "here", name: "MacBook Pro", os: "mac", self: true },
    });
    const peer = modelRow("peer", {
      device: { id: "away", name: "Loft", os: "linux", self: false },
    });
    const sessions = new Map([
      [own.id, "pty-a"],
      [peer.id, "pty-peer"],
    ]);
    const [ownRow, peerRow] = project(
      [own, peer],
      new Map([[own.id, "run-a"]]),
      [spokenRun],
      sessions,
    );
    expect(ownRow?.desk).toEqual({ id: "here", name: "MacBook Pro", os: "macos", self: true });
    expect(ownRow?.floorSessionId).toBe("pty-a");
    expect(peerRow?.desk).toEqual({ id: "away", name: "Loft", os: "linux", self: false });
    expect(peerRow?.floorSessionId).toBeUndefined();
    // a floor session that moves (a resume into a new PTY) is a new row
    const moved = project(
      [own, peer],
      new Map([[own.id, "run-a"]]),
      [spokenRun],
      new Map([[own.id, "pty-b"]]),
    );
    expect(moved[0]).not.toBe(ownRow);
    expect(moved[0]?.floorSessionId).toBe("pty-b");
    expect(moved[1]).toBe(peerRow);
  });

  it("reuses unchanged rows and lists, preserving input order and local-only joins", () => {
    const project = createFindAgents();
    const own = modelRow("row-a");
    const other = modelRow("row-other");
    const peer = modelRow("peer", { device: { id: "away", name: "Loft", self: false } });
    const terminal = modelRow("terminal", { kind: "terminal" });
    const joins = new Map([
      [own.id, "run-a"],
      [peer.id, "run-a"],
      [terminal.id, "run-a"],
    ]);
    const input = [own, other, peer, terminal];
    const first = project(input, joins, [spokenRun]);
    // A republished chrome row moved a fact Find does not read.
    const unrelated = { ...spokenRun, local: { ...spokenRun.local, cwd: "/elsewhere" } };
    expect(project([...input], new Map(joins), [unrelated])).toBe(first);
    const changed = project([own, { ...other, status: "blocked" }, peer, terminal], joins, [
      unrelated,
    ]);
    expect(changed).not.toBe(first);
    expect(changed[0]).toBe(first[0]);
    expect(changed[1]?.status).toBe("blocked");
    expect(changed[2]).toBe(first[2]);
    expect(changed[3]).toBe(first[3]);
    const reordered = project([terminal, peer, own], joins, [spokenRun]);
    expect(reordered).toEqual([first[3], first[2], first[0]]);
    expect(reordered[0]).toBe(first[3]);
    expect(reordered[1]?.agent?.nativeSessionId).toBeUndefined();
    expect(reordered[1]?.agent?.monitor).toBeUndefined();
    expect(reordered[0]?.agent).toBeUndefined();
  });

  it("refreshes every joined native/clock fact and removes facts that disappear", () => {
    const project = createFindAgents();
    const own = modelRow("row-a");
    const input = [own];
    const joins = new Map([[own.id, "run-a"]]);
    const local = spokenRun.local;
    if (local?.mirror === undefined) throw new Error("fixture must have an observed local run");
    const first = project(input, joins, [spokenRun]);
    const evidence = {
      ...spokenRun,
      local: { ...local, mirror: { ...local.mirror, lastEvidenceAt: "2026-09-12T10:05:00.000Z" } },
    };
    // M19 does not subscribe to evidence ticks, but any subsequent join must
    // read their latest value even when this model row kept its identity.
    expect(findJoinKey([evidence])).toBe(findJoinKey([spokenRun]));
    const second = project(input, joins, [evidence]);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]?.agent?.monitor?.freshness?.lastEvidenceAt).toBe("2026-09-12T10:05:00.000Z");
    const started = {
      ...evidence,
      local: {
        ...evidence.local,
        mirror: { ...evidence.local.mirror, startedAt: "2026-09-12T09:50:00.000Z" },
      },
    };
    const third = project(input, joins, [started]);
    expect(third[0]).not.toBe(second[0]);
    expect(third[0]?.agent?.monitor?.session?.startedAt).toBe("2026-09-12T09:50:00.000Z");
    const status = { ...started, statusSince: "2026-09-12T10:03:00.000Z" };
    const fourth = project(input, joins, [status]);
    expect(fourth[0]).not.toBe(third[0]);
    expect(fourth[0]?.agent?.monitor?.statusSince).toBe(status.statusSince);
    const native = { ...status, local: { ...status.local, nativeSessionId: "resumed-native" } };
    const fifth = project(input, joins, [native]);
    expect(fifth[0]).not.toBe(fourth[0]);
    expect(liveScope(fifth).nativeSessionIds).toEqual(["resumed-native"]);
    const noClocks = { ...native, local: { ...native.local, mirror: { alive: true } } };
    const sixth = project(input, joins, [noClocks]);
    expect(sixth[0]?.agent?.monitor).toEqual({
      statusSince: status.statusSince,
      session: {},
      freshness: {},
    });
    const noMirror = { ...native, local: { nativeSessionId: "resumed-native" } };
    expect(project(input, joins, [noMirror])[0]?.agent?.monitor).toBeUndefined();
    const missing = project(input, joins, []);
    expect(missing[0]?.agent?.nativeSessionId).toBeUndefined();
    expect(missing[0]?.agent?.monitor).toBeUndefined();
    expect(project(input, new Map([[own.id, "run-gone"]]), [native])).toBe(missing);
    expect(project(input, joins, [spokenRun])[0]).toEqual(first[0]);
    // A different window cannot inherit this one's local facts.
    expect(createFindAgents()(input, joins, [noMirror])[0]?.agent?.monitor).toBeUndefined();
  });
});
