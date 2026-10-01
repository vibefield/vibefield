import {
  AGENT_CATALOG,
  type AgentFieldRow,
  type AgentMeshOpen,
  type DeviceInfo,
} from "@vibefield/contracts";
import type { DeviceChoice } from "../godview/monitor/device-filter";
import type { MonitorDoor } from "../godview/monitor/remote-door";
import { profileTabRows } from "./godview-profiles-fixtures";

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

function deskRow(
  device: string,
  run: string,
  agent: (typeof AGENT_CATALOG)[number],
  folder: string,
  status: "working" | "blocked" | "idle",
  nowIso: string,
  content: { reply?: string; question?: string } = {},
): AgentFieldRow {
  return {
    runtimeRunId: run,
    revision: 3,
    kind: agent.id,
    label: agent.label,
    tier: "managed",
    device,
    status,
    statusSince: nowIso,
    stateChangedAt: nowIso,
    createdAt: nowIso,
    alive: true,
    blockers:
      status === "blocked"
        ? [
            {
              id: `${run}-q`,
              kind: "question",
              since: nowIso,
              ...(content.question !== undefined ? { question: content.question } : {}),
            },
          ]
        : [],
    usage: { cumulativeTokens: 182_400, costUsd: 3.1, costCoverage: "complete" },
    project: { name: folder, branch: "main" },
    ...(content.reply !== undefined
      ? { lastAssistantMessage: { text: content.reply, at: nowIso, final: false } }
      : {}),
  } as AgentFieldRow;
}

/** The board as fieldd's mesh open answers it: this desktop first. */
export function meshOpen(nowIso: string): AgentMeshOpen {
  return {
    devices: [
      {
        device: HERE,
        state: "live",
        asOf: nowIso,
        snapshot: { epoch: "here.1", revision: 1, rows: [] },
      },
      {
        device: STUDIO,
        state: "live",
        asOf: nowIso,
        snapshot: {
          epoch: "studio.4",
          revision: 18,
          rows: [
            deskRow(STUDIO, "run-studio-index", FIRST_AGENT, "rosetta", "working", nowIso, {
              reply: "Rebuilding the session index; 1,204 of 3,310 transcripts read.",
            }),
            deskRow(STUDIO, "run-studio-grant", SECOND_AGENT, "rosetta", "blocked", nowIso, {
              question: "Should the grant expire with the session, or after an hour?",
            }),
          ],
        },
      },
      {
        device: AIR,
        state: "asleep",
        asOf: nowIso,
        snapshot: {
          epoch: "air.2",
          revision: 7,
          rows: [
            deskRow(AIR, "run-air-notes", FIRST_AGENT, "notes", "idle", nowIso, {
              reply: "Done — the outline is in notes/sync.md.",
            }),
          ],
        },
      },
      { device: TOWER, state: "stale", asOf: nowIso },
    ],
  };
}

/** A door with this desktop's fold and three other desktops on its board. */
export function meshBoardDoor(): MonitorDoor {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const rows = profileTabRows(nowIso);
  return {
    observeMesh: ({ onOpen }) => {
      onOpen(meshOpen(nowIso));
      return () => undefined;
    },
    devices: {
      subscribe: (listener) => {
        listener(meshRoster(now));
        return () => undefined;
      },
    },
    attach: async () => ({ state: "no-pane" }),
    observe: ({ onFrame }) => {
      onFrame(rows);
      return () => undefined;
    },
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

/** The chip's choices as the stage would build them from the door above. */
export const MESH_DEVICE_CHOICES: readonly DeviceChoice[] = [
  { id: HERE, name: "MacBook Pro", os: "macos", here: true, state: "live", agents: 6 },
  { id: STUDIO, name: "studio", os: "linux", here: false, state: "live", agents: 2 },
  { id: AIR, name: "air", os: "macos", here: false, state: "asleep", agents: 1 },
  { id: TOWER, name: "tower", os: "windows", here: false, state: "stale", agents: 0 },
];
