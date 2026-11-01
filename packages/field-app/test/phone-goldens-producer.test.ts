import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentFieldSnapshot,
  AgentRemoteMeshFrame,
  AgentRemoteMeshOpen,
  AgentRemoteRow,
  AgentSessionSummary,
  TerminalInfo,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { projectFieldRow } from "../../fieldd/src/agent-field";
import { managedSummary } from "./managed-session-fixture";
import { type ScriptedModelBoard, scriptedModelBoard } from "./model-board-fixture";

// PG-3a (EL9's producer side) — THE WITNESS GOLDENS ARE FIELDD'S CUT. The remote goldens
// (`contracts/fixtures/agent-remote-mesh-{open,frames}.witness.json`) are hand-written, as every
// remote golden is; their risk is a hand fact the owner never makes: a key that is not its id, the
// name a run with no cwd goes by. So the home's rows are cut here by fieldd's real backend and
// remote projection (`model-board-fixture.ts`: `createAgentMonitorService`, `RemoteProjection`),
// the home stood up as another desktop's board, and every golden row is held to the cut on its
// identity and joins: the key, the model id, the kind, the project's name and branch, the
// terminal join, and nothing of this desktop's own (`project.seq`, `local`). Clocks, revisions,
// texts and cost numbers are the hand's and are not compared. The field cut's pair is
// `projectFieldRow`'s.

const CONTRACTS = join(import.meta.dirname, "..", "..", "contracts", "fixtures");
const golden = <T>(name: string): T => JSON.parse(readFileSync(join(CONTRACTS, name), "utf8")) as T;
const OPEN = golden<AgentRemoteMeshOpen>("agent-remote-mesh-open.witness.json");
const FRAMES = golden<AgentRemoteMeshFrame[]>("agent-remote-mesh-frames.witness.json");
const HOME = "dev-01HQ9S7UD1";

/** A PTY as the floor lists it. */
function floorPty(sessionId: string, cwd: string): TerminalInfo {
  return {
    sessionId,
    createdAt: 1_790_800_000_000,
    cwd,
    title: "zsh",
    cell: { cellInstanceId: 1, cellBootId: "cell-1", workloadClass: "interactive" },
  } as TerminalInfo;
}

/** A run fieldd's fold reports with no observed cwd, and a workspace (or none). */
function withoutCwd(
  summary: AgentSessionSummary,
  workspace: AgentSessionSummary["workspace"] | undefined,
): AgentSessionSummary {
  const next = structuredClone(summary) as AgentSessionSummary & Record<string, unknown>;
  const monitor = next.monitor as { environment?: Record<string, unknown> } | undefined;
  if (monitor?.environment !== undefined) delete monitor.environment["cwd"];
  if (workspace === undefined) delete next.workspace;
  else next.workspace = workspace;
  return next;
}

const claude = { kind: "claude", label: "Claude Code" } as const;
const codex = { kind: "codex", label: "Codex" } as const;
const HOME_ROWS: readonly AgentSessionSummary[] = [
  managedSummary({
    ...claude,
    runtimeRunId: "run-h-turn",
    terminalSessionId: "pty-h1",
    status: "idle",
    cwd: "/Users/me/Projects/vibe-field",
    gitObserved: true,
    branch: "pg/3a",
  }),
  managedSummary({
    ...codex,
    runtimeRunId: "run-h-partial",
    terminalSessionId: null,
    status: "working",
    cwd: "/Users/me/Projects/puppeteer",
    gitObserved: true,
    branch: "views/body",
  }),
  withoutCwd(
    managedSummary({ ...claude, runtimeRunId: "run-h-nocwd", terminalSessionId: null }),
    undefined,
  ),
  withoutCwd(managedSummary({ ...claude, runtimeRunId: "run-h-root", terminalSessionId: null }), {
    mode: "direct",
    root: "/Users/me/Projects/vibe-field",
  } as AgentSessionSummary["workspace"]),
  managedSummary({
    ...codex,
    runtimeRunId: "run-h-quiet",
    terminalSessionId: null,
    status: "working",
    cwd: "/Users/me/Projects/rosetta",
    gitObserved: true,
    branch: "main",
  }),
];
const HOME_FLOOR = [
  floorPty("pty-h1", "/Users/me/Projects/vibe-field"),
  floorPty("pty-h2", "/Users/me/notes"),
];

let board: ScriptedModelBoard | null = null;
afterEach(() => {
  board?.dispose();
  board = null;
});

/** The home's rows as fieldd cuts them for another screen, after `rows` over `floor`. */
async function homeCut(
  rows: readonly AgentSessionSummary[],
  floor: readonly TerminalInfo[] = HOME_FLOOR,
): Promise<AgentRemoteRow[]> {
  board ??= scriptedModelBoard();
  board.peer({ device: HOME, name: "Studio", platform: "darwin", rows, terminals: floor });
  const subscription = await board.port.subscribe(() => undefined);
  subscription.unsubscribe();
  const open = subscription.snapshot as AgentRemoteMeshOpen;
  return open.devices.find((entry) => entry.device === HOME)?.snapshot?.rows ?? [];
}

/** A row's identity and joins: what the golden must say as the owner cuts it. */
function identity(row: AgentRemoteRow) {
  return {
    runtimeRunId: row.runtimeRunId,
    kind: row.kind,
    terminal:
      row.terminal === undefined
        ? undefined
        : { hosted: row.terminal.hosted, runtimeSessionId: row.terminal.runtimeSessionId },
    monitorRow: {
      id: row.monitorRow.id,
      kind: row.monitorRow.kind,
      project: { name: row.monitorRow.project.name, branch: row.monitorRow.project.branch },
      device: row.monitorRow.device.id,
    },
  };
}
const byKey = (rows: readonly AgentRemoteRow[]) =>
  new Map(rows.map((row) => [row.runtimeRunId, identity(row)]));

describe("PG-3a — the witness goldens' home rows are fieldd's own cut (EL9's producer side)", () => {
  it("every home row of the open: the key, the id, the kind, the project and the terminal join", async () => {
    const cut = await homeCut(HOME_ROWS);
    const hand = OPEN.devices[0]?.snapshot?.rows ?? [];
    expect(hand.length).toBe(6);
    expect([...byKey(cut).keys()].sort()).toEqual(hand.map((row) => row.runtimeRunId).sort());
    // every row at once, so one wrong hand fact does not hide the next
    const cutBy = byKey(cut);
    expect(
      Object.fromEntries(hand.map((row) => [row.runtimeRunId, cutBy.get(row.runtimeRunId)])),
    ).toEqual(Object.fromEntries(hand.map((row) => [row.runtimeRunId, identity(row)])));
    // M22 — the run whose shell the floor lists carries the shell's id, and the shell is no row of its own
    expect(byKey(cut).get("run-h-turn")?.monitorRow.id).toBe("pty-h1");
    expect(byKey(cut).has("pty-h1")).toBe(false);
    // M16, EL7 B1 — nothing of the owner's own desktop rides the cut
    for (const row of cut) {
      expect(row.monitorRow.project.seq, row.runtimeRunId).toBeUndefined();
      expect("local" in row, row.runtimeRunId).toBe(false);
      expect(JSON.stringify(row), row.runtimeRunId).not.toMatch(/\/Users\//);
    }
  });

  it("the promotion of frame 0: the run that claims the shell carries its id, and the shell's key leaves", async () => {
    await homeCut(HOME_ROWS);
    const typed = managedSummary({
      ...claude,
      runtimeRunId: "run-h-typed",
      terminalSessionId: "pty-h2",
      status: "working",
      cwd: "/Users/me/notes",
    });
    const cut = byKey(await homeCut([...HOME_ROWS, typed]));
    const frame = FRAMES[0];
    if (frame === undefined || !("delta" in frame)) throw new Error("frame 0 is the home's delta");
    const [upsert] = frame.delta.upserts;
    if (upsert === undefined) throw new Error("frame 0 upserts the promoted run");
    expect(cut.get("run-h-typed")).toEqual(identity(upsert));
    for (const key of frame.delta.removed) expect(cut.has(key), key).toBe(false);
  });

  it("the unread mark of frame 1 is the owner's: a turn that ends with no screen showing it", async () => {
    await homeCut(HOME_ROWS);
    // the turn ends after the backend first saw the run (its seen-at is the first fold's clock)
    const ended = new Date(Date.now() + 60_000).toISOString();
    const rows = HOME_ROWS.map((row) =>
      row.runtimeRunId === "run-h-partial"
        ? managedSummary({
            ...codex,
            runtimeRunId: "run-h-partial",
            terminalSessionId: null,
            status: "idle",
            cwd: "/Users/me/Projects/puppeteer",
            gitObserved: true,
            branch: "views/body",
            createdAt: ended,
          })
        : row,
    );
    const cut = await homeCut(rows);
    const frame = FRAMES[1];
    if (frame === undefined || !("delta" in frame)) throw new Error("frame 1 is the home's delta");
    const partial = cut.find((row) => row.runtimeRunId === "run-h-partial");
    expect(partial?.monitorRow).toMatchObject({ status: "idle", unread: true });
    expect(frame.delta.upserts[0]?.monitorRow).toMatchObject({ status: "idle", unread: true });
  });

  it("the field cut's pair is projectFieldRow's: neither run is named, so the kit keys both by the label", () => {
    const field = golden<AgentFieldSnapshot>("agent-field-snapshot.project-keys.json");
    for (const hand of field.rows) {
      const summary = HOME_ROWS.find((row) => row.runtimeRunId === hand.runtimeRunId);
      if (summary === undefined) throw new Error(`${hand.runtimeRunId} is a home row`);
      const cut = projectFieldRow(summary);
      expect(cut.project, hand.runtimeRunId).toBeUndefined();
      expect(hand.project, hand.runtimeRunId).toBeUndefined();
      expect(cut.label).toBe(hand.label);
      expect(cut.kind).toBe(hand.kind);
      expect(cut.terminal).toEqual(hand.terminal);
    }
  });
});
