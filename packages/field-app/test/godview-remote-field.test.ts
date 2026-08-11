// @vitest-environment node
/**
 * THE REMOTE SOURCE, as a pure function (GT-4, GT-D17).
 *
 * Everything here runs without a renderer, a runtime or a mesh — which is the
 * point of the seam: the projection, the field's honesty rules and the stage's
 * two claims are all pure, so the parts that CANNOT be tested without Electron
 * (the door's mount, the smoke's peer) are as small as they can be.
 *
 * What it holds:
 *   1. the mesh flattened into rows — who counts as a citizen and who does not
 *   2. a peer's session as a monitor row: host carried, LOCAL fields absent
 *   3. the composition: mock + remote in one array, neither disturbing the other
 *   4. the field's honest states, including the tolerance rule
 *   5. the label claims, scoped per source
 */

import type {
  RemoteHostSummary,
  SessionActivity,
  SessionSummary,
  SharedSessionSummary,
} from "@vibecook/ghosttea-protocol";
import { describe, expect, it } from "vitest";
import {
  MOCK_LABEL,
  mockClaim,
  remoteClaim,
  remoteUnavailableClaim,
} from "../src/godview/GodviewMonitor";
import {
  assembleMonitorAgents,
  type MonitorRemoteRecord,
  monitorAgentFromRemote,
} from "../src/godview/monitor/agents";
import { remoteRowId, remoteSessionRows } from "../src/godview/monitor/remote-door";
import {
  EMPTY_REMOTE_FIELD,
  REMOTE_FAILURE_TOLERANCE,
  remoteFieldAfterFailure,
  remoteFieldFromHosts,
} from "../src/godview/monitor/remote-session-field";
import type { MonitorSourceCounts } from "../src/godview/monitor/useMonitorAgents";

const ACCENTS = ["#a1", "#a2", "#a3", "#a4", "#a5", "#a6", "#a7", "#a8"] as const;

/** A session with something in the foreground. The wire type carries five more
 * fields (source, confidence, two process groups, a timestamp) that only the
 * classifier's `kind` branch reads — the reference's own idiom for a shape this
 * big, and the one place this file leans on a cast. */
const busy = { kind: "foreground-job" } as SessionActivity;

function shared(
  sessionId: string,
  overrides: Partial<SharedSessionSummary> = {},
): SharedSessionSummary {
  return {
    sessionId,
    title: "zsh",
    cwdLabel: "/Users/peer/src/truffle",
    running: true,
    attachable: true,
    readWrite: true,
    createdAtMs: 10,
    activity: { kind: "shell-idle" },
    ...overrides,
  } as SharedSessionSummary;
}

function host(
  deviceId: string,
  sessions: SharedSessionSummary[],
  overrides: Partial<RemoteHostSummary> = {},
): RemoteHostSummary {
  return {
    deviceId,
    deviceName: deviceId.toUpperCase(),
    online: true,
    protocolMajor: 1,
    protocolMinor: 13,
    hostInstanceId: `${deviceId}-instance`,
    sessions,
    ...overrides,
  } as RemoteHostSummary;
}

describe("the mesh, flattened into monitor rows", () => {
  it("takes the running sessions of online peers", () => {
    const rows = remoteSessionRows([
      host("mini", [shared("s1"), shared("s2")]),
      host("studio", [shared("s3")]),
    ]);
    expect(rows.map((row) => `${row.host.deviceId}/${row.session.sessionId}`)).toEqual([
      "mini/s1",
      "mini/s2",
      "studio/s3",
    ]);
  });

  it("drops an OFFLINE peer's sessions rather than showing what cannot be opened", () => {
    // A bubble the user cannot attach is a control that does nothing, and the
    // peer's list is a claim about a machine we currently cannot reach.
    const rows = remoteSessionRows([host("mini", [shared("s1")], { online: false })]);
    expect(rows).toEqual([]);
  });

  it("drops a session that has stopped running, and KEEPS an unshared one", () => {
    // The difference is what each fact is about: a stopped session is gone, an
    // unattachable one is a live session its owner is deliberately not sharing
    // — which the row states and the select refuses honestly.
    const rows = remoteSessionRows([
      host("mini", [shared("dead", { running: false }), shared("private", { attachable: false })]),
    ]);
    expect(rows.map((row) => row.session.sessionId)).toEqual(["private"]);
  });

  it("qualifies a row id by its device, so two peers may hold the same id", () => {
    const rows = remoteSessionRows([host("mini", [shared("1")]), host("studio", [shared("1")])]);
    const ids = rows.map((row) => remoteRowId(row.host.deviceId, row.session.sessionId));
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id.startsWith("remote:")).toBe(true);
  });
});

describe("a peer's session as a monitor row", () => {
  const record: MonitorRemoteRecord = {
    row: { host: { deviceId: "mini", deviceName: "mini" }, session: shared("s1") },
  };

  it("carries the host identity and reads its status from the peer's activity", () => {
    const agent = monitorAgentFromRemote(record, ACCENTS);
    expect(agent.remote?.deviceName).toBe("mini");
    expect(agent.remote?.remoteSessionId).toBe("s1");
    expect(agent.id).toBe("remote:mini:s1");
    expect(agent.status).toBe("idle");
    expect(agent.detail).toContain("mini");
    expect(
      monitorAgentFromRemote(
        { row: { ...record.row, session: shared("s1", { activity: busy }) } },
        ACCENTS,
      ).status,
    ).toBe("working");
  });

  it("has NO local session and NO cwd — the two things a peer never gave us", () => {
    const agent = monitorAgentFromRemote(record, ACCENTS);
    // The honesty of the whole slice in two assertions. A synthesized
    // `SessionSummary` would carry an executable, a pid and a persistence
    // class the peer never reported; a `cwd` would be a peer's path in the
    // field that means "a path on this machine" (the GT-3 finding).
    expect(agent.session).toBeUndefined();
    expect(agent.cwd).toBeUndefined();
    // The path is still SHOWN — under a name that cannot be mistaken for one.
    expect(agent.remote?.cwdLabel).toBe("/Users/peer/src/truffle");
  });

  it("carries the HOST's write policy as a fact rather than dropping the row", () => {
    // Renamed with the field (GT-5c): what the peer advertises is one boolean
    // for the whole host, and the per-viewer answer is not decided until the
    // attach. The projection carries the advertisement under a name that says
    // which of the two it is.
    const agent = monitorAgentFromRemote(
      { row: { ...record.row, session: shared("s1", { readWrite: false }) } },
      ACCENTS,
    );
    expect(agent.remote?.hostWritable).toBe(false);
    expect(agent.status).toBe("idle");
    expect(monitorAgentFromRemote(record, ACCENTS).remote?.hostWritable).toBe(true);
  });

  it("never claims an agent facet — a peer sends terminal facts, not semantics", () => {
    expect(monitorAgentFromRemote(record, ACCENTS).agent).toBeUndefined();
  });
});

describe("the composition (mock + remote, one array)", () => {
  function localTerminal(id: string, createdAtMs = 0): { session: SessionSummary } {
    return {
      session: { id, exited: false, createdAtMs, cwd: "/project/vibe-field" } as SessionSummary,
    };
  }

  it("merges both sources and keeps every row distinguishable by its facet", () => {
    const agents = assembleMonitorAgents({
      agents: [],
      terminals: [localTerminal("local-1")],
      remotes: [{ row: { host: { deviceId: "mini", deviceName: "mini" }, session: shared("s1") } }],
      accents: ACCENTS,
    });
    expect(agents.map((agent) => agent.id)).toEqual(["local-1", "remote:mini:s1"]);
    expect(agents[0]?.remote).toBeUndefined();
    expect(agents[0]?.session?.id).toBe("local-1");
    expect(agents[1]?.remote?.deviceName).toBe("mini");
    expect(agents[1]?.session).toBeUndefined();
  });

  it("answers EMPTY with no floor serving — no placeholder peers", () => {
    // The state this ships in until GT-4's native half lands, and the one the
    // honest-states law is about: nothing invented to fill the space.
    const agents = assembleMonitorAgents({
      agents: [],
      terminals: [localTerminal("local-1")],
      remotes: [],
      accents: ACCENTS,
    });
    expect(agents).toHaveLength(1);
    expect(agents.every((agent) => agent.remote === undefined)).toBe(true);
  });

  it("lights PaneAttachment from the pane a row was actually mounted in", () => {
    // GT-3m ported this field and could not feed it; here is the first thing
    // that ever does. It is present only when the source is holding a live
    // pane fact, which is what keeps it a state and not a memory.
    const row = { host: { deviceId: "mini", deviceName: "mini" }, session: shared("s1") };
    const unlinked = assembleMonitorAgents({
      agents: [],
      terminals: [],
      remotes: [{ row }],
      accents: ACCENTS,
    });
    expect(unlinked[0]?.attachment).toBeUndefined();

    const linked = assembleMonitorAgents({
      agents: [],
      terminals: [],
      remotes: [{ row, localSessionId: "replica-9", paneColor: "#a3" }],
      accents: ACCENTS,
      activeSessionId: "replica-9",
    });
    expect(linked[0]?.attachment).toEqual({ primary: "#a3", mirrors: [] });
    // …and the row is "active" because the pane the user is in shows ITS
    // replica — the same question asked of the id that exists.
    expect(linked[0]?.active).toBe(true);
  });

  it("keeps the preview's selection separate from a real mount", () => {
    // GT-D17's split, reaching the projection: an invented agent is mounted
    // nowhere, so "the user pointed at it" is all the mock may claim.
    const agents = assembleMonitorAgents({
      agents: [],
      terminals: [localTerminal("local-1")],
      remotes: [{ row: { host: { deviceId: "mini", deviceName: "mini" }, session: shared("s1") } }],
      accents: ACCENTS,
      previewSelectedId: "local-1",
    });
    expect(agents[0]?.active).toBe(true);
    expect(agents[1]?.active).toBe(false);
  });
});

describe("the field's honest states", () => {
  it("starts with nobody asked — which is not the same as an empty mesh", () => {
    expect(EMPTY_REMOTE_FIELD.state).toBe("no-door");
    expect(EMPTY_REMOTE_FIELD.rows).toEqual([]);
  });

  it("counts only ONLINE peers behind the rows it serves", () => {
    const field = remoteFieldFromHosts([
      host("mini", [shared("s1")]),
      host("studio", [shared("s2")], { online: false }),
    ]);
    expect(field.state).toBe("serving");
    expect(field.hosts).toBe(1);
    expect(field.rows).toHaveLength(1);
  });

  it("an answered ask with no peers is SERVING and empty, never unavailable", () => {
    const field = remoteFieldFromHosts([]);
    expect(field.state).toBe("serving");
    expect(field.rows).toEqual([]);
  });

  it("keeps the last answer through one failure and withdraws it on the next", () => {
    // One failure is a round trip, not a verdict; two in a row is a standing
    // condition, and standing conditions get told the truth about.
    const serving = remoteFieldFromHosts([host("mini", [shared("s1")])]);
    const once = remoteFieldAfterFailure(serving, "no mesh");
    expect(once.state).toBe("serving");
    expect(once.rows).toHaveLength(1);
    expect(once.failures).toBe(1);

    const twice = remoteFieldAfterFailure(once, "no mesh");
    expect(twice.state).toBe("unavailable");
    expect(twice.rows).toEqual([]);
    expect(twice.reason).toBe("no mesh");
    expect(twice.failures).toBe(REMOTE_FAILURE_TOLERANCE);
  });

  it("a floor that never answered at all is unavailable on the FIRST failure", () => {
    // Nothing is being withdrawn, so there is nothing to be patient about.
    const first = remoteFieldAfterFailure(EMPTY_REMOTE_FIELD, "unknown command");
    expect(first.state).toBe("unavailable");
    expect(first.reason).toBe("unknown command");
  });

  it("a good answer clears the failure count", () => {
    const failed = remoteFieldAfterFailure(EMPTY_REMOTE_FIELD, "no mesh");
    expect(remoteFieldFromHosts([host("mini", [shared("s1")])]).failures).toBe(0);
    expect(failed.failures).toBe(1);
  });

  it("returns the SAME OBJECT once settled, so a stock machine stops re-rendering", () => {
    // The review's finding 8, as an identity assertion. With the mesh flag off
    // — the default — this poll fails every 2s forever, and a fresh object each
    // time meant a new snapshot, a new agents array, a re-render of every view
    // and an `updateAgents` posted to the swarm, bypassing GT-3p's damage gate
    // for the life of the open overlay. Twice a minute, to say nothing new.
    const settled = remoteFieldAfterFailure(EMPTY_REMOTE_FIELD, "this floor serves no mesh");
    expect(settled.state).toBe("unavailable");
    for (let poll = 0; poll < 30; poll += 1) {
      expect(remoteFieldAfterFailure(settled, "this floor serves no mesh")).toBe(settled);
    }
    // The counter stops climbing with it: a number that only ever grew would be
    // the one field keeping the object churning.
    expect(remoteFieldAfterFailure(settled, "this floor serves no mesh").failures).toBe(
      settled.failures,
    );
  });

  it("still moves when the REASON changes — a new outage is news", () => {
    const settled = remoteFieldAfterFailure(EMPTY_REMOTE_FIELD, "this floor serves no mesh");
    const changed = remoteFieldAfterFailure(settled, "gateway is down");
    expect(changed).not.toBe(settled);
    expect(changed.reason).toBe("gateway is down");
  });
});

describe("the labels, scoped per source (GT-D17)", () => {
  function counts(overrides: Partial<MonitorSourceCounts> = {}): MonitorSourceCounts {
    return { mock: 9, remote: 0, hosts: 0, remoteState: "serving", ...overrides };
  }

  it("claims the stage while the stage IS the mock field", () => {
    expect(mockClaim(counts())).toBe(MOCK_LABEL);
    expect(remoteClaim(counts())).toBeNull();
  });

  it("NARROWS to a count the moment a real session stands beside it", () => {
    // The law this slice is about: a real remote session must never sit under
    // a label calling it invented.
    const withRemotes = counts({ remote: 2, hosts: 1 });
    expect(mockClaim(withRemotes)).toBe("preview — 9 mock agents");
    expect(mockClaim(withRemotes)).not.toBe(MOCK_LABEL);
    expect(remoteClaim(withRemotes)).toBe("2 remote sessions · 1 peer");
  });

  it("says one of a thing in the singular", () => {
    expect(remoteClaim(counts({ remote: 1, hosts: 1 }))).toBe("1 remote session · 1 peer");
    expect(remoteClaim(counts({ remote: 3, hosts: 2 }))).toBe("3 remote sessions · 2 peers");
  });

  it("SAYS UNAVAILABLE, with the floor's reason — the state that never reached the screen", () => {
    // The review's 2d: `remoteClaim` is null whenever there are no rows, which
    // includes "there are no rows because the mesh could not be asked" — so a
    // mesh that was ON with its gateway down drew exactly what a healthy empty
    // mesh draws, at the surface GT-D17 declared to BE the door.
    const down = counts({ remoteState: "unavailable", remoteReason: "gateway is down" });
    expect(remoteClaim(down)).toBeNull();
    expect(remoteUnavailableClaim(down)).toBe("mesh unavailable · gateway is down");
    // With no reason offered, the state alone is still said.
    expect(remoteUnavailableClaim(counts({ remoteState: "unavailable" }))).toBe("mesh unavailable");
  });

  it("says nothing while nobody has been asked, and nothing while serving", () => {
    // `no-door` is a deck that has not finished coming up, which is not a mesh
    // that is down; `serving` with zero rows is an honest empty mesh.
    expect(remoteUnavailableClaim(counts({ remoteState: "no-door" }))).toBeNull();
    expect(remoteUnavailableClaim(counts())).toBeNull();
  });
});
