import type { RowsDeviceState } from "@vibefield/contracts";
import type { AgentView } from "@vibefield/puppeteer-view-sdk/model";
import { agentViewFixture, fixtureModel } from "@vibefield/puppeteer-view-sdk/testing";
import { describe, expect, it } from "vitest";
import type { HeldModelRow } from "../src/godview/monitor/model-board";
import { peerJoins, peerKey } from "../src/godview/monitor/window-local";
import { createWindowRows, type WindowRowFacts } from "../src/godview/monitor/window-rows";

// Item 465 (2026-11-18) — a PEER desktop's hand-off draws ONE body in this
// window: a peer's session born in another's place says so on the peer's own
// remote cut (`terminal.succeeds`, item 464), and its row wears the body the
// other's row wore. Before this item a peer's launch drew two bodies here (its
// shell's and its agent's) until the shell's row left, and so did the phone,
// which draws this window's bodies one for one (Q-J1 (a)). The kit's
// `PeerLineageTests` (FieldProductTests, RemoteWindowRowsTests.swift) hold the
// phone to the same six cases, named alike; no shared fixture holds the two
// equal.

const HERE = "desk";
const PEER = "studio";
const OTHER = "loft";

const local = (id: string, createdAt: number, partial: Partial<AgentView> = {}): AgentView =>
  agentViewFixture({ id, createdAt, project: { name: id, seq: createdAt }, ...partial });
const peer = (id: string, createdAt: number, partial: Partial<AgentView> = {}): AgentView =>
  agentViewFixture({
    id,
    createdAt,
    project: { name: id, seq: undefined },
    device: { id: PEER, name: "Studio", os: "linux", self: false },
    ...partial,
  });

/** The peer's shell, its floor session its id, and the run its launch makes in the shell's place. */
const shell = (partial: Partial<AgentView> = {}) =>
  peer("pty-p1", 1, { kind: "terminal", ...partial });
const launch = () => peer("run-p-launch", 5, { kind: "agent" });

/** The window's facts with the peers' joins, each session keyed by the peer's desktop. */
function facts(
  order: readonly string[],
  sessions: Readonly<Record<string, string>>,
  claims: Readonly<Record<string, string>> = {},
  sessionByRow: ReadonlyMap<string, string> = new Map(),
): WindowRowFacts {
  return {
    standing: new Map<string, RowsDeviceState>([
      [HERE, "live"],
      [PEER, "live"],
    ]),
    order,
    sessionByRow,
    visualIds: undefined,
    peerSessionByRow: new Map(Object.entries(sessions).map(([row, s]) => [row, peerKey(PEER, s)])),
    peerSucceedsByRow: new Map(Object.entries(claims).map(([row, s]) => [row, peerKey(PEER, s)])),
  };
}

/** Each drawn row's body, by id. */
const bodies = (rows: readonly AgentView[]): Record<string, string> =>
  Object.fromEntries(rows.map((row) => [row.id, row.visualId ?? row.id]));

/** A held board row as the mesh board relays a peer's: only what the joins read is real. */
function held(
  device: string,
  id: string,
  terminal: Record<string, string> | undefined,
  kind?: "terminal",
): HeldModelRow {
  const board = {
    runtimeRunId: id,
    revision: 1,
    device,
    ...(kind === undefined ? {} : { kind }),
    ...(terminal === undefined ? {} : { terminal }),
    monitorRow: { id },
  };
  return { device, board, row: { id } } as unknown as HeldModelRow;
}

describe("item 465 — a peer desktop's hand-off in this window", () => {
  it("P1 — a peer's claims are joined beside its sessions, keyed by its desktop", () => {
    const rows = [
      held(
        HERE,
        "pty-h2",
        { hosted: "local", runtimeSessionId: "pty-h2", succeeds: "pty-h0" },
        "terminal",
      ),
      held(
        PEER,
        "pty-p1",
        { hosted: "local", runtimeSessionId: "pty-p1", succeeds: "pty-p0" },
        "terminal",
      ),
      held(PEER, "pty-p3", { hosted: "local", runtimeSessionId: "pty-p3", succeeds: "pty-p1" }),
      held(PEER, "run-p-done", { hosted: "none", succeeds: "pty-p1" }),
      held(
        PEER,
        "pty-p4",
        { hosted: "local", runtimeSessionId: "pty-p4", succeeds: "pty-p4" },
        "terminal",
      ),
      held(
        PEER,
        "pty-p5",
        { hosted: "local", runtimeSessionId: "pty-p5", succeeds: "" },
        "terminal",
      ),
      held(
        OTHER,
        "pty-l1",
        { hosted: "local", runtimeSessionId: "pty-l1", succeeds: "pty-p1" },
        "terminal",
      ),
    ];
    const joins = peerJoins(rows, HERE);
    expect(Object.fromEntries(joins.succeedsByRow)).toEqual({
      "pty-p1": peerKey(PEER, "pty-p0"),
      "pty-p3": peerKey(PEER, "pty-p1"),
      "pty-l1": peerKey(OTHER, "pty-p1"),
    });
    expect(Object.fromEntries(joins.sessionByRow)).toEqual({
      "pty-p1": peerKey(PEER, "pty-p1"),
      "pty-p3": peerKey(PEER, "pty-p3"),
      "pty-p4": peerKey(PEER, "pty-p4"),
      "pty-p5": peerKey(PEER, "pty-p5"),
      "pty-l1": peerKey(OTHER, "pty-l1"),
    });
    expect(peerKey(PEER, "pty-p1")).not.toBe(peerKey(OTHER, "pty-p1"));
    expect(peerJoins(rows, undefined).succeedsByRow.size).toBe(0);
  });

  it("P2 — a peer's launch takes its shell's body, and keeps it after the shell's row and the claim go", () => {
    const window = createWindowRows();
    const before = window.rowsFor(
      fixtureModel([shell()]),
      facts(["pty-p1"], { "pty-p1": "pty-p1" }),
    );
    expect(bodies(before)).toEqual({ "pty-p1": "pty-p1" });

    const run = launch();
    const sessions = { "pty-p1": "pty-p1", "run-p-launch": "pty-p9" };
    const claim = { "run-p-launch": "pty-p1" };
    const launched = window.rowsFor(
      fixtureModel([shell(), run], 2),
      facts(["pty-p1", "run-p-launch"], sessions, claim),
    );
    // only the drawing yields: the model still holds the shell
    expect(bodies(launched)).toEqual({ "run-p-launch": "pty-p1" });

    const released = window.rowsFor(
      fixtureModel([run], 3),
      facts(["run-p-launch"], { "run-p-launch": "pty-p9" }, claim),
    );
    expect(bodies(released)).toEqual({ "run-p-launch": "pty-p1" });
    const settled = window.rowsFor(
      fixtureModel([run], 4),
      facts(["run-p-launch"], { "run-p-launch": "pty-p9" }),
    );
    expect(bodies(settled)).toEqual({ "run-p-launch": "pty-p1" });
  });

  it("P3 — a peer's claim of another desktop's session changes nothing", () => {
    const window = createWindowRows();
    const home = local("pty-h2", 1, { kind: "terminal" });
    const homeSessions = new Map([["pty-h2", "pty-h2"]]);
    window.rowsFor(fixtureModel([home]), facts(["pty-h2"], {}, {}, homeSessions));
    const run = launch();
    const drawn = window.rowsFor(
      fixtureModel([home, run], 2),
      facts(
        ["pty-h2", "run-p-launch"],
        { "run-p-launch": "pty-p9" },
        { "run-p-launch": "pty-h2" },
        homeSessions,
      ),
    );
    expect(bodies(drawn)).toEqual({ "pty-h2": "pty-h2", "run-p-launch": "run-p-launch" });
  });

  it("P4 — a peer's shell typed into is retained on a body of its own", () => {
    const window = createWindowRows();
    const typed = shell({ inputUsed: true });
    window.rowsFor(fixtureModel([typed]), facts(["pty-p1"], { "pty-p1": "pty-p1" }));
    const launched = window.rowsFor(
      fixtureModel([typed, launch()], 2),
      facts(
        ["pty-p1", "run-p-launch"],
        { "pty-p1": "pty-p1", "run-p-launch": "pty-p9" },
        { "run-p-launch": "pty-p1" },
      ),
    );
    expect(bodies(launched)).toEqual({
      "pty-p1": "retained:pty-p1",
      "run-p-launch": "pty-p1",
    });
  });

  it("P5 — a peer's lapsed claim gives its shell its body back", () => {
    const window = createWindowRows();
    const sessions = { "pty-p1": "pty-p1", "run-p-launch": "pty-p9" };
    const order = ["pty-p1", "run-p-launch"];
    window.rowsFor(fixtureModel([shell()]), facts(["pty-p1"], { "pty-p1": "pty-p1" }));
    const launched = window.rowsFor(
      fixtureModel([shell(), launch()], 2),
      facts(order, sessions, { "run-p-launch": "pty-p1" }),
    );
    expect(bodies(launched)).toEqual({ "run-p-launch": "pty-p1" });
    const lapsed = window.rowsFor(fixtureModel([shell(), launch()], 3), facts(order, sessions));
    expect(bodies(lapsed)).toEqual({ "pty-p1": "pty-p1", "run-p-launch": "run-p-launch" });
    // and it stays so
    const again = window.rowsFor(fixtureModel([shell(), launch()], 4), facts(order, sessions));
    expect(bodies(again)).toEqual(bodies(lapsed));
  });

  it("P6 — a peer's successor a frame late still takes the body", () => {
    const window = createWindowRows();
    window.rowsFor(fixtureModel([shell()]), facts(["pty-p1"], { "pty-p1": "pty-p1" }));
    const left = window.rowsFor(fixtureModel([], 2), facts([], {}));
    expect(left).toHaveLength(0);
    const arrived = window.rowsFor(
      fixtureModel([launch()], 3),
      facts(["run-p-launch"], { "run-p-launch": "pty-p9" }, { "run-p-launch": "pty-p1" }),
    );
    expect(bodies(arrived)).toEqual({ "run-p-launch": "pty-p1" });
  });
});
