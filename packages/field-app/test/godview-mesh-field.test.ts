// @vitest-environment node
/**
 * THE MESH BOARD, READ — as pure functions (DS-3, DS-D4). It replaced GT-D17's
 * host poll (`remote-session-field.ts`, retired 2026-09-30); this file
 * replaced that poll's own, and keeps the rows of it that are still law (an
 * empty board is honest, the labels speak per source, the identity rule).
 *
 * What it holds:
 *   1. the reader: the open replaces, a device's reset replaces that device,
 *      a delta follows its owner's chain or is a gap, a state change keeps the
 *      board (DS-L8)
 *   2. the rows: this desktop's never drawn twice, what a desk row says, an
 *      asleep desktop's rows greyed and kept
 *   3. the composition: every row says where it lives
 *   4. the device filter's choices and its narrowing
 *   5. the labels, scoped per source — the remote one naming the desktop
 *   6. the re-ask backoff after a failure that may heal (S4; the hook's
 *      behaviour itself is mounted in godview-remote-door.test.tsx)
 */

import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { AgentFieldRow, AgentMeshOpen, DeviceInfo } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  localClaim,
  localUnavailableClaim,
  remoteClaim,
  remoteUnavailableClaim,
} from "../src/godview/GodviewMonitor";
import {
  assembleMonitorAgents,
  type MonitorColours,
  monitorAgentFromMesh,
  nextMonitorAgentForStatus,
} from "../src/godview/monitor/agents";
import {
  choiceNote,
  type DeviceChoice,
  deviceChoices,
  filterByDevice,
  standingChoice,
} from "../src/godview/monitor/device-filter";
import { osOf, rosterView } from "../src/godview/monitor/devices";
import {
  EMPTY_MESH_FIELD,
  MESH_RETRY_MAX_MS,
  MESH_RETRY_MIN_MS,
  type MeshFieldSnapshot,
  meshFieldAfterFailure,
  meshFieldAfterFrame,
  meshFieldFromOpen,
  meshRetryDelay,
} from "../src/godview/monitor/mesh-field";
import {
  classifyRemoteStatus,
  meshHere,
  meshRecords,
  remoteDetail,
} from "../src/godview/monitor/mesh-rows";
import type { MonitorSourceCounts } from "../src/godview/monitor/useMonitorAgents";

const COLOURS: MonitorColours = { tint: { l: 0.6, c: 0.15 }, neutral: "oklch(0.5 0 0)" };
const PURE = { colours: COLOURS, projectSeqs: new Map<string, number>() } as const;
const AT = "2026-09-30T21:00:00.000Z";

function row(
  device: string,
  runtimeRunId: string,
  overrides: Partial<AgentFieldRow> & Record<string, unknown> = {},
): AgentFieldRow {
  return {
    runtimeRunId,
    revision: 1,
    kind: "agent-a",
    label: "Agent A",
    tier: "managed",
    device,
    status: "working",
    statusSince: AT,
    stateChangedAt: AT,
    createdAt: AT,
    alive: true,
    blockers: [],
    project: { name: "rosetta", branch: "main" },
    ...overrides,
  } as AgentFieldRow;
}

const HERE = "dev-here";
const STUDIO = "dev-studio";

function open(): AgentMeshOpen {
  return {
    devices: [
      {
        device: HERE,
        state: "live",
        asOf: AT,
        snapshot: { epoch: "here.1", revision: 2, rows: [row(HERE, "run-here")] },
      },
      {
        device: STUDIO,
        state: "live",
        asOf: AT,
        snapshot: { epoch: "studio.3", revision: 40, rows: [row(STUDIO, "run-s1")] },
      },
      { device: "dev-air", state: "asleep", asOf: AT },
    ],
  };
}

const roster: DeviceInfo[] = [
  { deviceId: HERE, name: "pro", platform: "darwin", self: true, online: true, lastSeenAt: 0 },
  { deviceId: STUDIO, name: "studio", platform: "linux", self: false, online: true, lastSeenAt: 0 },
  {
    deviceId: "dev-air",
    name: "air",
    platform: "darwin",
    self: false,
    online: false,
    lastSeenAt: 0,
  },
];

describe("the board, read (DS-D4)", () => {
  it("the open replaces everything held, one copy per device", () => {
    const field = meshFieldFromOpen(open());
    expect(field.state).toBe("serving");
    expect([...field.devices.keys()]).toEqual([HERE, STUDIO, "dev-air"]);
    expect(field.devices.get(STUDIO)?.board?.revision).toBe(40);
    // a device that has not answered is listed with nothing invented for it
    expect(field.devices.get("dev-air")?.board).toBeUndefined();
  });

  it("a delta follows its OWNER's chain — the owner's revisions, applied to that device alone", () => {
    const field = meshFieldFromOpen(open());
    const next = meshFieldAfterFrame(field, {
      device: STUDIO,
      delta: {
        epoch: "studio.3",
        since: 40,
        revision: 41,
        upserts: [row(STUDIO, "run-s2")],
        removed: ["run-s1"],
      },
    }) as MeshFieldSnapshot;
    expect([...(next.devices.get(STUDIO)?.board?.rows.keys() ?? [])]).toEqual(["run-s2"]);
    expect(next.devices.get(STUDIO)?.board?.revision).toBe(41);
    // the other copies are untouched — the same objects
    expect(next.devices.get(HERE)).toBe(field.devices.get(HERE));
  });

  it("a delta that does not continue the held chain is a GAP, never a repair", () => {
    const field = meshFieldFromOpen(open());
    const ahead = { epoch: "studio.3", since: 42, revision: 43, upserts: [], removed: [] };
    expect(meshFieldAfterFrame(field, { device: STUDIO, delta: ahead })).toBe("gap");
    const reborn = { epoch: "studio.4", since: 40, revision: 41, upserts: [], removed: [] };
    expect(meshFieldAfterFrame(field, { device: STUDIO, delta: reborn })).toBe("gap");
    const unheard = { epoch: "air.1", since: 0, revision: 1, upserts: [], removed: [] };
    expect(meshFieldAfterFrame(field, { device: "dev-air", delta: unheard })).toBe("gap");
  });

  it("a device's reset replaces that device's copy and nothing else", () => {
    const field = meshFieldFromOpen(open());
    const next = meshFieldAfterFrame(field, {
      device: STUDIO,
      snapshot: { epoch: "studio.4", revision: 1, rows: [] },
    }) as MeshFieldSnapshot;
    expect(next.devices.get(STUDIO)?.board).toEqual({
      epoch: "studio.4",
      revision: 1,
      rows: new Map(),
    });
    expect(next.devices.get(STUDIO)?.state).toBe("live");
  });

  it("asleep is a STATE: the board stays with the reader (DS-L8)", () => {
    const field = meshFieldFromOpen(open());
    const asleep = meshFieldAfterFrame(field, {
      device: STUDIO,
      state: "asleep",
      asOf: "2026-09-30T21:05:00.000Z",
    }) as MeshFieldSnapshot;
    expect(asleep.devices.get(STUDIO)?.state).toBe("asleep");
    expect(asleep.devices.get(STUDIO)?.board?.rows.size).toBe(1);
    // and a desktop the reader had not met arrives on its first frame
    const joined = meshFieldAfterFrame(asleep, { device: "dev-new", state: "stale", asOf: AT });
    expect((joined as MeshFieldSnapshot).devices.get("dev-new")).toEqual({
      device: "dev-new",
      state: "stale",
      asOf: AT,
    });
  });

  it("starts with nobody asked; a board that cannot be read is withdrawn and said, once", () => {
    expect(EMPTY_MESH_FIELD.state).toBe("no-door");
    const down = meshFieldAfterFailure(meshFieldFromOpen(open()), "FORBIDDEN_SCOPE: agent.observe");
    expect(down.state).toBe("unavailable");
    expect(down.devices.size).toBe(0);
    // GT-D15.3's identity rule: an unchanged state with an unchanged reason is the SAME object
    expect(meshFieldAfterFailure(down, "FORBIDDEN_SCOPE: agent.observe")).toBe(down);
    expect(meshFieldAfterFailure(down, "a new reason")).not.toBe(down);
  });
});

describe("the re-ask backoff (S4, 2026-10-01)", () => {
  it("waits 250 ms after the first failure, doubling, never longer than 8 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 12].map(meshRetryDelay)).toEqual([
      250, 500, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000,
    ]);
    expect(MESH_RETRY_MIN_MS).toBe(250);
    expect(MESH_RETRY_MAX_MS).toBe(8_000);
  });
});

describe("another desktop's runs, as rows", () => {
  const field = meshFieldFromOpen(open());
  const view = rosterView(roster);

  it("draws this desktop's own board ONCE — the fold's — and every other desktop's runs", () => {
    expect(meshHere(field, view)).toBe(HERE);
    const records = meshRecords(field, view);
    expect(records.map((record) => [record.device.id, record.row.runtimeRunId])).toEqual([
      [STUDIO, "run-s1"],
    ]);
    expect(records[0]?.device).toEqual({ id: STUDIO, name: "studio", os: "linux", here: false });
    // with no roster, the board's first entry is here (fieldd lists itself first)
    expect(meshHere(field, rosterView([]))).toBe(HERE);
    expect(meshRecords(field, rosterView([]))[0]?.device).toEqual({
      id: STUDIO,
      name: STUDIO,
      os: "unknown",
      here: false,
    });
  });

  it("reads the owner's status the fold's way: not alive is no row, pending is idle", () => {
    expect(classifyRemoteStatus(row(STUDIO, "r", { alive: false }))).toBeUndefined();
    expect(classifyRemoteStatus(row(STUDIO, "r", { pending: "resume-when-idle" }))).toBe("idle");
    expect(classifyRemoteStatus(row(STUDIO, "r", { status: "blocked" }))).toBe("blocked");
    expect(classifyRemoteStatus(row(STUDIO, "r", { status: "unknown" }))).toBe("working");
  });

  it("says what a desk row carries — the question, the reply — and tolerates a field row", () => {
    const asking = row(STUDIO, "r", {
      status: "blocked",
      blockers: [{ id: "q", kind: "question", since: AT, question: "Keep it greyed?" }],
    });
    expect(remoteDetail(asking, "blocked")).toBe("Keep it greyed?");
    const permission = row(STUDIO, "r", {
      status: "blocked",
      blockers: [{ id: "p", kind: "permission", since: AT, tool: "Bash" }],
    });
    expect(remoteDetail(permission, "blocked")).toBe("permission · Bash");
    const replying = row(STUDIO, "r", { lastAssistantMessage: { text: "  Done.  ", final: true } });
    expect(remoteDetail(replying, "working")).toBe("Done.");
    // a field row (no desk extras) and a malformed extra both fall to the status
    expect(remoteDetail(row(STUDIO, "r"), "working")).toBe("working");
    expect(remoteDetail(row(STUDIO, "r", { lastAssistantMessage: 7 }), "idle")).toBe("idle");
  });

  it("is an agent row of its owner's, honest about what this desktop cannot do yet (DS-4)", () => {
    const [record] = meshRecords(field, view);
    if (record === undefined) throw new Error("no record");
    const agent = monitorAgentFromMesh(record, COLOURS);
    expect(agent).toMatchObject({
      id: `remote:${STUDIO}:run-s1`,
      tier: "remote",
      status: "working",
      project: "rosetta",
      color: COLOURS.neutral,
      remote: {
        deviceId: STUDIO,
        deviceName: "studio",
        attachable: false,
        hostWritable: false,
        cwdLabel: "rosetta",
      },
      device: { id: STUDIO, os: "linux", here: false },
      agent: { kind: "agent-a", runtimeRunId: "run-s1", branch: "main", recency: "unknown" },
    });
    // the two things a desktop never gave us are absent, not guessed
    // the desktop's name leads the detail line until the views draw it (pu-device's pin)
    expect(agent?.detail).toBe("studio · working");
    expect(agent?.session).toBeUndefined();
    expect(agent?.cwd).toBeUndefined();
    expect(agent?.agent?.monitor).toBeUndefined();
    expect(agent?.agent?.remoteRow).toBe(record.row);
    expect(agent?.stale).toBeUndefined();
  });

  it("SV — carries the owner's estimated total, and no steps it never sent", () => {
    const [record] = meshRecords(field, view);
    if (record === undefined) throw new Error("no record");
    const priced = (usage: Record<string, unknown> | undefined) =>
      monitorAgentFromMesh(
        { ...record, row: { ...record.row, usage } as typeof record.row },
        COLOURS,
      );
    expect(priced({ costUsd: 4.2, costCoverage: "partial" })?.agent?.usage).toEqual({
      total: 4.2,
      coverage: "partial",
      steps: [],
      stepMs: 30_000,
    });
    expect(priced({ costUsd: 1 })?.agent?.usage?.coverage).toBe("complete");
    // a run its owner could not price, or no price at all: no usage, never $0
    expect(priced({ costUsd: 0, costCoverage: "unavailable" })?.agent?.usage).toBeUndefined();
    expect(priced(undefined)?.agent?.usage).toBeUndefined();
  });

  it("a desktop that is not answering greys its rows and keeps them (DS-L8)", () => {
    const [record] = meshRecords(field, view);
    if (record === undefined) throw new Error("no record");
    const greyed = monitorAgentFromMesh({ ...record, state: "asleep" }, COLOURS);
    expect(greyed?.stale).toBe(true);
    expect(greyed?.agent?.recency).toBe("stale");
  });

  it("a ring cycles only what a pane here can take: another desktop's runs wait for DS-4", () => {
    const [record] = meshRecords(field, view);
    if (record === undefined) throw new Error("no record");
    const remote = monitorAgentFromMesh(record, COLOURS);
    if (remote === undefined) throw new Error("no row");
    expect(nextMonitorAgentForStatus([remote], "working", undefined)).toBeUndefined();
  });
});

describe("the composition: every row says where it lives", () => {
  const here = { id: HERE, name: "pro", os: "macos" as const, here: true };

  function localTerminal(id: string): { session: SessionSummary } {
    return {
      session: { id, exited: false, createdAtMs: 0, cwd: "/p/vibe-field" } as SessionSummary,
    };
  }

  it("this desktop's rows carry `here`; another desktop's carry its owner; remotes come last", () => {
    const [record] = meshRecords(meshFieldFromOpen(open()), rosterView(roster));
    if (record === undefined) throw new Error("no record");
    const agents = assembleMonitorAgents({
      managed: [],
      terminals: [localTerminal("local-1")],
      mesh: [record],
      here,
      ...PURE,
    });
    expect(agents.map((agent) => [agent.id, agent.device?.id])).toEqual([
      ["local-1", HERE],
      [`remote:${STUDIO}:run-s1`, STUDIO],
    ]);
  });

  it("answers EMPTY on a desktop alone — no placeholder peers — and no device before anyone said", () => {
    const agents = assembleMonitorAgents({
      managed: [],
      terminals: [localTerminal("local-1")],
      mesh: [],
      ...PURE,
    });
    expect(agents).toHaveLength(1);
    expect(agents[0]?.device).toBeUndefined();
  });

  it("lights PaneAttachment from the replica a row landed in (DS-4's join, kept)", () => {
    const [record] = meshRecords(meshFieldFromOpen(open()), rosterView(roster));
    if (record === undefined) throw new Error("no record");
    const attachment = { primaryPaneId: "pane-3", paneIds: ["pane-3"], color: "#a3" };
    const linked = assembleMonitorAgents({
      managed: [],
      terminals: [],
      mesh: [{ ...record, localSessionId: "replica-9" }],
      ...PURE,
      attachments: new Map([["replica-9", attachment]]),
      activeSessionId: "replica-9",
    });
    expect(linked[0]?.attachment).toEqual(attachment);
    expect(linked[0]?.active).toBe(true);
  });
});

describe("the device filter (a dropdown, never tabs)", () => {
  const field = meshFieldFromOpen(open());
  const choicesOf = (): readonly DeviceChoice[] => {
    const [record] = meshRecords(field, rosterView(roster));
    if (record === undefined) throw new Error("no record");
    const remote = monitorAgentFromMesh(record, COLOURS);
    if (remote === undefined) throw new Error("no row");
    const local = {
      ...remote,
      id: "run-here",
      remote: undefined,
      device: { id: HERE, name: "pro", os: "macos" as const, here: true },
    };
    return deviceChoices(field, rosterView(roster), [local, remote]);
  };

  it("offers every desktop on the board, here first, each with its standing and its agents", () => {
    expect(choicesOf()).toEqual([
      { id: HERE, name: "pro", os: "macos", here: true, state: "live", agents: 1 },
      { id: STUDIO, name: "studio", os: "linux", here: false, state: "live", agents: 1 },
      { id: "dev-air", name: "air", os: "macos", here: false, state: "asleep", agents: 0 },
    ]);
    expect(choicesOf().map(choiceNote)).toEqual(["1 agent", "1 agent", "asleep"]);
  });

  it("narrows the rows to one desktop, and falls back to all when that desktop leaves", () => {
    const rows = [
      { id: "a", device: { id: HERE } },
      { id: "b", device: { id: STUDIO } },
    ] as unknown as Parameters<typeof filterByDevice>[0];
    expect(filterByDevice(rows, STUDIO).map((r) => r.id)).toEqual(["b"]);
    expect(filterByDevice(rows, null)).toBe(rows);
    expect(standingChoice(choicesOf(), STUDIO)).toBe(STUDIO);
    expect(standingChoice(choicesOf(), "dev-gone")).toBeNull();
  });

  it("maps a roster platform to a mark, and never guesses one", () => {
    expect([
      osOf("darwin"),
      osOf("win32"),
      osOf("linux"),
      osOf("freebsd"),
      osOf(undefined),
    ]).toEqual(["macos", "windows", "linux", "unknown", "unknown"]);
  });
});

describe("the labels, scoped per source (GT-D17, AR-3, DS-3)", () => {
  function counts(overrides: Partial<MonitorSourceCounts> = {}): MonitorSourceCounts {
    return {
      local: 0,
      terminals: 1,
      remote: 0,
      hosts: 0,
      localState: "live",
      remoteState: "serving",
      ...overrides,
    };
  }
  const studio: DeviceChoice = {
    id: STUDIO,
    name: "studio",
    os: "linux",
    here: false,
    state: "live",
    agents: 2,
  };
  const air: DeviceChoice = { ...studio, id: "dev-air", name: "air", os: "macos", agents: 1 };

  it("says nothing about local agents while there are none, and counts them when there are", () => {
    expect(localClaim(counts())).toBeNull();
    expect(localClaim(counts({ local: 1 }))).toBe("1 managed agent");
    expect(localClaim(counts({ local: 3 }))).toBe("3 managed agents");
    expect(remoteClaim(counts())).toBeNull();
  });

  it("names the other desktop — DS §11's witness: the chip reads a device name", () => {
    expect(remoteClaim(counts({ remote: 2, hosts: 1 }), [studio])).toBe("2 agents on studio");
    expect(remoteClaim(counts({ remote: 1, hosts: 1 }), [{ ...studio, agents: 1 }])).toBe(
      "1 agent on studio",
    );
    expect(remoteClaim(counts({ remote: 3, hosts: 2 }), [studio, air])).toBe(
      "3 agents on 2 desktops",
    );
  });

  it("SAYS UNAVAILABLE for the fold, with fieldd's reason, and nothing while nobody asked", () => {
    const down = counts({ localState: "unavailable", localReason: "FORBIDDEN_SCOPE" });
    expect(localClaim(down)).toBeNull();
    expect(localUnavailableClaim(down)).toBe("agents unavailable · FORBIDDEN_SCOPE");
    expect(localUnavailableClaim(counts({ localState: "no-door" }))).toBeNull();
  });

  it("says UNAVAILABLE only when the board could not be read, with the reason", () => {
    const down = counts({ remoteState: "unavailable", remoteReason: "FORBIDDEN_SCOPE" });
    expect(remoteClaim(down)).toBeNull();
    expect(remoteUnavailableClaim(down)).toBe("mesh unavailable · FORBIDDEN_SCOPE");
    // a desktop alone is a board that answered: nothing to say
    expect(remoteUnavailableClaim(counts())).toBeNull();
    expect(remoteUnavailableClaim(counts({ remoteState: "no-door" }))).toBeNull();
  });
});
