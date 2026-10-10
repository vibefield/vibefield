import { AGENT_CATALOG, type AgentSessionSummary, type DeviceInfo } from "@vibefield/contracts";
import type { MonitorDoor } from "../godview/monitor/remote-door";
import { type CatalogPeer, catalogModelBoard } from "./godview-model-fixture";
import { profileTabRows, THIS_MAC } from "./godview-profiles-fixtures";

// DS-3 — the catalog's Godview on the MESH BOARD, on a fixture door: this
// desktop (a Mac, with the profile tabs' fold), a Linux desktop answering with
// two agents (one working with its reply line, one blocked on a question —
// the desk row's two content facts), a MacBook Air ASLEEP with its last board
// kept (DS-L8: its row stands, greyed), and a Windows tower the roster lists
// but whose board has not answered (stale, nothing invented for it). The
// agents are the catalog's own rows, so no agent id is written here (R23b).
// Examples, not anyone's desktops; nothing dials.

const HERE = "this-mac";
const STUDIO = "dev-studio";
const AIR = "dev-air";
const TOWER = "dev-tower";

const FIRST_AGENT = AGENT_CATALOG[0];
const SECOND_AGENT = AGENT_CATALOG[1] ?? FIRST_AGENT;

const capabilities = { terminalHost: true, terminalMesh: true, docHost: true, push: false };

/** The roster as `device.subscribe` answers it. */
export function meshRoster(nowMs: number): DeviceInfo[] {
  return [
    {
      deviceId: HERE,
      name: "MacBook Pro",
      platform: "darwin",
      self: true,
      online: true,
      lastSeenAt: nowMs,
      capabilities,
    },
    {
      deviceId: STUDIO,
      name: "studio",
      platform: "linux",
      self: false,
      online: true,
      lastSeenAt: nowMs,
      capabilities,
    },
    {
      deviceId: AIR,
      name: "air",
      platform: "darwin",
      self: false,
      online: false,
      lastSeenAt: nowMs - 2 * 60 * 60 * 1000,
      capabilities,
    },
    {
      deviceId: TOWER,
      name: "tower",
      platform: "win32",
      self: false,
      online: true,
      lastSeenAt: nowMs,
      capabilities,
    },
  ];
}

/**
 * Another desktop's run as ITS fold holds it: the peer's own backend
 * (`godview-model-fixture.ts`) cuts it for the board, so the window reads what a
 * peer sends — its reply line, its blocker's question, its cost (the desk row's
 * content facts, DS-D4) — and never a row this file worded itself.
 */
function peerRow(
  device: string,
  run: string,
  agent: (typeof AGENT_CATALOG)[number],
  folder: string,
  status: "working" | "blocked" | "idle",
  nowIso: string,
  content: { reply?: string; question?: string } = {},
): AgentSessionSummary {
  const cwd = `/Users/peer/src/${folder}`;
  return {
    sessionId: `${run}-native`,
    sessionIdBasis: "observed",
    kind: agent.id,
    label: agent.label,
    device,
    tier: "managed",
    runtimeRunId: run,
    runtimeEpoch: 1,
    terminal: { hosted: "none" },
    workspace: { mode: "direct", root: cwd, sourcePath: cwd, branch: "main" },
    monitor: {
      schemaVersion: 3,
      runtimeEpoch: 1,
      revision: 3,
      runtimeRunId: run,
      status,
      statusSince: nowIso,
      blockers:
        status === "blocked"
          ? [
              {
                id: `${run}-q`,
                kind: "question",
                since: nowIso,
                questions: content.question !== undefined ? [{ prompt: content.question }] : [],
              },
            ]
          : [],
      ...(content.reply !== undefined
        ? { lastAssistantMessage: { text: content.reply, at: nowIso, final: false } }
        : {}),
      usage: { cumulativeTokens: 182_400, costUsd: 3.1, costCoverage: "complete" },
      environment: { cwd, git: { branch: "main" }, worktrees: [] },
      session: { nativeSessionId: `${run}-native` },
      freshness: { lastEvidenceAt: nowIso, level: "native-hooks" },
      alive: true,
    },
    status,
    observationLevel: "native-hooks",
    createdAt: nowIso,
    stateChangedAt: nowIso,
    continuation: { persisted: true, resumable: false },
  };
}

/** The other desktops on the board: a Linux desktop live with two agents, a
 * MacBook Air asleep with its last board kept, a Windows tower stale with none. */
export function meshPeers(nowIso: string): CatalogPeer[] {
  return [
    {
      device: { id: STUDIO, name: "studio", platform: "linux" },
      state: "live",
      rows: [
        peerRow(STUDIO, "run-studio-index", FIRST_AGENT, "rosetta", "working", nowIso, {
          reply: "Rebuilding the session index; 1,204 of 3,310 transcripts read.",
        }),
        peerRow(STUDIO, "run-studio-grant", SECOND_AGENT, "rosetta", "blocked", nowIso, {
          question: "Should the grant expire with the session, or after an hour?",
        }),
      ],
    },
    {
      device: { id: AIR, name: "air", platform: "darwin" },
      state: "asleep",
      rows: [
        peerRow(AIR, "run-air-notes", FIRST_AGENT, "notes", "idle", nowIso, {
          reply: "Done — the outline is in notes/sync.md.",
        }),
      ],
    },
    { device: { id: TOWER, name: "tower", platform: "win32" }, state: "stale", rows: [] },
  ];
}

/** A door with this desktop's fold and three other desktops on its model board. */
export function meshBoardDoor(): MonitorDoor {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const rows = profileTabRows(nowIso);
  const board = catalogModelBoard({ device: THIS_MAC, rows, peers: meshPeers(nowIso) });
  return {
    model: board.port,
    devices: {
      subscribe: (listener) => {
        listener(meshRoster(now));
        return () => undefined;
      },
    },
    attach: async () => ({ state: "no-pane" }),
    createTerminal: async () => ({ state: "no-pane" }),
    mountLocal: async () => ({ state: "no-pane" }),
    history: {
      status: async () => ({
        reachable: false,
        detail: "no index in the catalog",
        checkedAt: nowIso,
      }),
      facts: async () => [],
      search: async () => ({
        status: { reachable: false, detail: "no index in the catalog", checkedAt: nowIso },
        answered: false,
        hits: [],
        clipped: false,
      }),
    },
    usage: {
      snapshot: async () => ({ refreshedAt: nowIso, entries: [] }),
      subscribe: () => () => undefined,
    },
  };
}

