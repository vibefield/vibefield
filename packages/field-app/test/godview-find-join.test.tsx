// @vitest-environment happy-dom
/**
 * MV-3d (M35, M47) — THE FIND SHEET'S JOIN.
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
 * monitor. The first block here is the regression, written against what both
 * trees export so it can be run at 283cf3e9 (red) and here (green); the second
 * holds the join's rules.
 */

import {
  buildFindRows,
  FindSheet,
  type HistoryPort,
  lastActiveMs,
  liveScope,
  useMonitorPalette,
} from "@vibecook/puppeteer-views";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GodviewAgentsProvider } from "../src/godview/monitor/GodviewAgentsProvider";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import type { MonitorAgent } from "../src/godview/monitor/types";
import { findAgentsOf, useMonitorAgents } from "../src/godview/monitor/useMonitorAgents";
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
let latest: readonly MonitorAgent[] | null = null;
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

/** The stage's own path to the sheet: the window's rows and joins
 * (`useMonitorAgents`), the sheet mounted closed, as `GodviewMonitor` mounts it. */
function Probe({ door }: { door: MonitorDoor }): ReactElement {
  const palette = useMonitorPalette();
  const { findAgents } = useMonitorAgents({ palette, door, panes: { sessionIds: [] } });
  latest = findAgents;
  return (
    <FindSheet
      open={false}
      agents={findAgents}
      history={nothing}
      onClose={() => undefined}
      onSelect={() => undefined}
    />
  );
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
      // the fold's `full` board: asked by the window at 283cf3e9, never answered
      // here, so a join from it finds nothing — the race M47 lost
      observe: () => () => undefined,
      observeMesh: () => () => undefined,
      attach: async () => ({ state: "no-pane" }),
      createTerminal: async () => ({ state: "no-pane" }),
      mountLocal: async () => ({ state: "no-pane" }),
      history: nothing,
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

/** A window row as the legacy shim gives it for an OBSERVED local run: an agent
 * facet whose `monitor` is the views' object (no `session`, no `freshness`). */
function shimRow(id: string, extra: Partial<MonitorAgent> = {}): MonitorAgent {
  return {
    id,
    createdAtMs: Date.parse("2026-09-12T10:00:00.000Z"),
    status: "working",
    project: "vibe-field",
    detail: "",
    color: "#000000",
    active: false,
    agent: {
      provider: { id: "codex", label: "Codex" },
      monitor: { statusSince: "2026-09-12T10:00:00.000Z", blockers: [], usage: {} },
    },
    ...extra,
  } as unknown as MonitorAgent;
}

describe("the join's rules (`findAgentsOf`)", () => {
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
    const [row] = findAgentsOf([shimRow("row-a")], new Map([["row-a", "run-a"]]), [spokenRun]);
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
      [shimRow("row-b"), shimRow("row-orphan")],
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

  it("leaves a peer's row and a terminal exactly as they are", () => {
    const peer = shimRow("peer-1", {
      remote: {
        deviceId: "desk-peer",
        deviceName: "Loft",
        attachable: true,
        hostWritable: true,
        cwdLabel: null,
      },
    } as Partial<MonitorAgent>);
    const { agent: _none, ...bare } = shimRow("pty-c");
    const terminal = bare as MonitorAgent;
    const rows = findAgentsOf([peer, terminal], new Map(), [spokenRun]);
    expect(rows[0]).toBe(peer);
    expect(rows[1]).toBe(terminal);
  });
});
