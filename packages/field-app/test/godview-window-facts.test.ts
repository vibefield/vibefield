// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { MonitorAgentRow } from "@vibecook/puppeteer-view-sdk/model";
import { AgentModelMeshOpen } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type HeldModelRow, ModelBoardFold } from "../src/godview/monitor/model-board";
import type { MonitorPaneFacts } from "../src/godview/monitor/useMonitorAgents";
import { boardJoins, windowKindsKey, windowLocal } from "../src/godview/monitor/window-local";
import { createRowOrder } from "../src/godview/monitor/window-rows";

const open = AgentModelMeshOpen.parse(
  JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../contracts/fixtures/agent-model-mesh-open.valid.json",
      ),
      "utf8",
    ),
  ),
);
const fold = new ModelBoardFold();
fold.open(open);
const HERE = fold.here;
const bases = fold.heldRows();
const agentBase = bases.find((entry) => entry.device === HERE && entry.row.kind === "agent");
const terminalBase = bases.find((entry) => entry.row.kind === "terminal");
const peerBase = bases.find((entry) => entry.device !== HERE);
if (agentBase === undefined || terminalBase === undefined || peerBase === undefined) {
  throw new Error("the golden must carry a local agent, terminal and peer");
}

function held(base: HeldModelRow, id: string, createdAt: number): HeldModelRow {
  return {
    ...base,
    row: { ...base.row, id, createdAt },
    board: {
      ...base.board,
      runtimeRunId: id,
      ...(base.board.monitorRow === undefined
        ? {}
        : { monitorRow: { ...base.board.monitorRow, id, createdAt } }),
    },
  };
}

function terminal(id: string, createdAt: number, session = id): HeldModelRow {
  const entry = held(terminalBase!, id, createdAt);
  return {
    ...entry,
    board: { ...entry.board, terminal: { hosted: "local", runtimeSessionId: session } },
  };
}

describe("window ordering depends on ordering facts", () => {
  it("keeps the order through usage ticks, then follows births, pane/floor order and peers", () => {
    const order = createRowOrder();
    const a = held(agentBase!, "a", 10);
    const b = held(agentBase!, "b", 20);
    const p = held(peerBase!, "p", 2);
    const q = held(peerBase!, "q", 1);
    const rows = [b, q, terminal("floor", 3), a, terminal("pane", 4), p, terminal("tail", 5)];
    const panes: MonitorPaneFacts = {
      sessionIds: ["pane"],
      floor: [{ sessionId: "floor", workloadClass: "interactive" }],
    };
    const first = order(rows, HERE, panes);
    expect(first).toEqual(["a", "b", "pane", "floor", "tail", "q", "p"]);
    expect(
      order(
        rows.map((entry) => ({ ...entry, row: { ...entry.row, status: "working" } })),
        HERE,
        { ...panes, sessionIds: [...panes.sessionIds], floor: [...(panes.floor ?? [])] },
      ),
    ).toBe(first);
    const earlier = [{ ...b, row: { ...b.row, createdAt: 1 } }, ...rows.slice(1)];
    expect(order(earlier, HERE, panes)).toEqual(["b", "a", "pane", "floor", "tail", "q", "p"]);
    expect(order(rows, HERE, { ...panes, sessionIds: ["tail", "pane"] })).toEqual([
      "a",
      "b",
      "tail",
      "pane",
      "floor",
      "q",
      "p",
    ]);
    expect(
      order(rows, HERE, {
        sessionIds: [],
        floor: [
          { sessionId: "tail", workloadClass: "interactive" },
          { sessionId: "floor", workloadClass: "interactive" },
        ],
      }),
    ).toEqual(["a", "b", "tail", "floor", "pane", "q", "p"]);
    expect(order([p, ...rows.filter((entry) => entry !== p)], HERE, panes).slice(-2)).toEqual([
      "p",
      "q",
    ]);
    expect(order(rows, peerBase!.device, panes).slice(0, 2)).toEqual(["q", "p"]);
  });

  it("invalidates same-sized replacements and terminal joins, and remembers input values", () => {
    const order = createRowOrder();
    const sessionIds = ["first", "second"];
    const rows = [terminal("a", 1, "first"), terminal("b", 2, "second")];
    const panes = { sessionIds };
    expect(order(rows, HERE, panes)).toEqual(["a", "b"]);
    // The deck may reuse its container while publishing a new pane order.
    sessionIds.reverse();
    expect(order(rows, HERE, panes)).toEqual(["b", "a"]);
    expect(order([terminal("c", 1, "first"), rows[1]!], HERE, panes)).toEqual(["b", "c"]);
    expect(order([terminal("a", 1, "second"), terminal("b", 2, "first")], HERE, panes)).toEqual([
      "a",
      "b",
    ]);
    expect(order([rows[0]!], HERE, panes)).toEqual(["a"]);
    expect(order([], HERE, panes)).toEqual([]);
    expect(order(rows, HERE, panes)).toEqual(["b", "a"]);
    expect(createRowOrder()(rows, HERE, { sessionIds: ["first", "second"] })).toEqual(["a", "b"]);
  });

  it("sees a terminal become an agent and a row move desktops without changing its id", () => {
    const order = createRowOrder();
    const a = held(agentBase!, "a", 10);
    const b = terminal("b", 1);
    expect(order([a, b], HERE, { sessionIds: [] })).toEqual(["a", "b"]);
    expect(order([a, held(agentBase!, "b", 1)], HERE, { sessionIds: [] })).toEqual(["b", "a"]);
    expect(order([{ ...a, device: peerBase!.device }, b], HERE, { sessionIds: [] })).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("the local join's row-kind key", () => {
  it("tracks activity and pending-spawn classification without invalidating on unrelated rows", () => {
    const a = held(agentBase!, "a", 10);
    const b = terminal("b", 1);
    const joins = boardJoins([a, b], HERE);
    const kinds = new Map<string, MonitorAgentRow["kind"]>([
      ["a", "agent"],
      ["b", "terminal"],
    ]);
    const panes: MonitorPaneFacts = {
      sessionIds: ["b"],
      sessions: [{ id: "b", activity: { kind: "foreground-job" } } as SessionSummary],
    };
    const input = {
      joins,
      kindOf: (id: string) => kinds.get(id),
      panes,
      spawnHints: new Map([["pending", { x: 3, y: 4 }]]),
      links: new Map<string, string>(),
      previewSelectedId: undefined,
      receded: undefined,
      visible: () => true,
    };
    const before = windowKindsKey(input);
    expect(windowLocal(input).activity?.get("b")).toEqual({ kind: "foreground-job" });
    expect(windowLocal(input).spawnHints.get("pending")).toEqual({ x: 3, y: 4 });
    kinds.set("unrelated", "terminal");
    expect(windowKindsKey({ ...input, kindOf: (id) => kinds.get(id) })).toBe(before);
    kinds.set("pending", "agent");
    const born = windowKindsKey(input);
    expect(born).not.toBe(before);
    expect(windowLocal(input).spawnHints.has("pending")).toBe(false);
    kinds.set("b", "agent");
    expect(windowKindsKey(input)).not.toBe(born);
    expect(windowLocal(input).activity?.has("b")).toBe(false);
    kinds.delete("b");
    kinds.delete("pending");
    expect(windowKindsKey(input)).not.toBe(before);
    expect(windowLocal(input).activity?.has("b")).toBe(false);
    expect(windowKindsKey({ ...input, panes: { sessionIds: [] }, spawnHints: new Map() })).toBe(
      "[]",
    );
  });
});
