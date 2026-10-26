import type { RowsDeviceState } from "@vibefield/contracts";
import type { MonitorReplicaLike } from "@vibefield/puppeteer-view-sdk/host";
import type { AgentView, MonitorModel } from "@vibefield/puppeteer-view-sdk/model";
import { agentViewFixture, fixtureModel } from "@vibefield/puppeteer-view-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import {
  createWindowRows,
  narrowToDevice,
  type WindowRowFacts,
} from "../src/godview/monitor/window-rows";
import { createWindowViewReplica } from "../src/godview/monitor/window-view";

// MV-4 / MV-8 — the window's model: order, device membership, peer standing
// and stable visual identity reach every SDK view without a legacy row bridge.
// A slip is visible as reordered rain columns, bright sleeping peers or a
// second swarm body during a launcher hand-off.

const HERE = "desk";
const PEER = "studio";

const local = (id: string, createdAt: number, partial: Partial<AgentView> = {}): AgentView =>
  agentViewFixture({ id, createdAt, project: { name: id, seq: createdAt }, ...partial });
const peer = (id: string, createdAt: number, partial: Partial<AgentView> = {}): AgentView =>
  agentViewFixture({
    id,
    createdAt,
    project: { name: id, seq: undefined },
    device: { id: PEER, name: "Studio", os: "linux", self: false },
    profileSet: "native",
    ...partial,
  });

/** A replica that publishes what it is told, and says so to its listeners. */
function handReplica(
  model: MonitorModel,
): MonitorReplicaLike & { publish(next: MonitorModel): void } {
  let snapshot = {
    model,
    changes: { added: [] as string[], updated: [] as string[], removed: [] as string[] },
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(next) {
      snapshot = { ...snapshot, model: next };
      for (const listener of [...listeners]) listener();
    },
  };
}

/** The window's reader as `useMonitorAgents` builds it: the window rows, narrowed. */
function windowReader(facts: { current: WindowRowFacts; device: string | null }) {
  const rows = createWindowRows();
  return (model: MonitorModel) =>
    narrowToDevice(rows.rowsFor(model, facts.current), facts.device, HERE);
}

function factsOf(order: readonly string[], standing: RowsDeviceState = "live"): WindowRowFacts {
  return {
    standing: new Map<string, RowsDeviceState>([
      [HERE, "live"],
      [PEER, standing],
    ]),
    order,
    sessionByRow: new Map(),
    visualIds: undefined,
  };
}

describe("the model a ported view draws in this window (MV-4)", () => {
  it("a window that patches nothing is handed the replica's own model", () => {
    const model = fixtureModel([local("a", 1), local("b", 2)]);
    const facts = { current: factsOf(["a", "b"]), device: null };
    const view = createWindowViewReplica(handReplica(model), windowReader(facts));
    expect(view.getSnapshot().model).toBe(model);
  });

  it("takes the stage's order — the rain claims its columns in it — with the replica's own rows", () => {
    const a = local("a", 1);
    const b = local("b", 2);
    const c = local("c", 3);
    const model = fixtureModel([a, b, c]);
    const facts = { current: factsOf(["c", "a", "b"]), device: null };
    const view = createWindowViewReplica(handReplica(model), windowReader(facts));
    const drawn = view.getSnapshot().model;
    expect(drawn.agents.map((row) => row.id)).toEqual(["c", "a", "b"]);
    expect(drawn.agents[0]).toBe(c);
    expect(drawn.byId.get("a")).toBe(a);
    // the same facts and the same model: the same snapshot, so the slot updates nothing
    expect(view.getSnapshot()).toBe(view.getSnapshot());
  });

  it("narrows to the chosen desktop (DS-3) and widens back", () => {
    const model = fixtureModel([local("a", 1), peer("p", 2), local("b", 3)]);
    const facts: { current: WindowRowFacts; device: string | null } = {
      current: factsOf(["a", "b", "p"]),
      device: PEER,
    };
    const view = createWindowViewReplica(handReplica(model), windowReader(facts));
    expect(view.getSnapshot().model.agents.map((row) => row.id)).toEqual(["p"]);
    facts.device = HERE;
    expect(view.getSnapshot().model.agents.map((row) => row.id)).toEqual(["a", "b"]);
    facts.device = null;
    expect(view.getSnapshot().model.agents.map((row) => row.id)).toEqual(["a", "b", "p"]);
  });

  it("greys a peer by its desktop's standing (DS-L8), under none of its owner's profiles", () => {
    const owner = peer("p", 2, { stale: false });
    const model = fixtureModel([local("a", 1), owner]);
    const facts = { current: factsOf(["a", "p"], "asleep"), device: null };
    const view = createWindowViewReplica(handReplica(model), windowReader(facts));
    const asleep = view.getSnapshot().model.byId.get("p");
    expect(asleep).toMatchObject({ id: "p", stale: true });
    expect(asleep?.profileSet).toBeUndefined();
    // the patched row is the same object while its standing holds (MV-D21)
    facts.current = factsOf(["a", "p"], "asleep");
    expect(view.getSnapshot().model.byId.get("p")).toBe(asleep);
    // live again: not stale, still under none of the owner's profiles
    facts.current = factsOf(["a", "p"], "live");
    const live = view.getSnapshot().model.byId.get("p");
    expect(live).toMatchObject({ stale: false });
    expect(live?.profileSet).toBeUndefined();
    // this desktop's rows are the replica's own, whatever a peer's standing
    expect(view.getSnapshot().model.byId.get("a")).toBe(model.byId.get("a"));
  });

  it("hands a peer's facts on whole — its context share, its account, its wait, reply and effort (M9)", () => {
    // The legacy shim dropped a peer's core facts (`peerMonitor: "omit"`); a
    // ported view draws the model uniformly, so the cut passes them as the
    // peer's backend computed them. Only the standing and the profile are the
    // window's (above).
    const owner = peer("p", 2, {
      context: { usedPercent: 41 },
      account: "team",
      status: "blocked",
      wait: { kind: "question", since: 3, question: "Ship it?" },
      reply: { text: "Ready when you are." },
      effort: { value: "high", intent: "observed" },
      writable: false,
    });
    const model = fixtureModel([local("a", 1), owner]);
    const facts = { current: factsOf(["a", "p"]), device: null };
    const view = createWindowViewReplica(handReplica(model), windowReader(facts));
    expect(view.getSnapshot().model.byId.get("p")).toMatchObject({
      context: { usedPercent: 41 },
      account: "team",
      wait: { kind: "question", question: "Ship it?" },
      reply: { text: "Ready when you are." },
      effort: { value: "high" },
      writable: false,
      stale: false,
    });
  });

  it("says what moved since its last publication, by id", () => {
    const a = local("a", 1);
    const b = local("b", 2);
    const replica = handReplica(fixtureModel([a, b]));
    const facts = { current: factsOf(["b", "a"]), device: null };
    const view = createWindowViewReplica(replica, windowReader(facts));
    expect(view.getSnapshot().changes).toEqual({ added: ["b", "a"], updated: [], removed: [] });
    const b2 = { ...b, status: "working" as const };
    const c = local("c", 3);
    replica.publish(fixtureModel([a, b2, c], 2));
    facts.current = factsOf(["b", "a", "c"]);
    expect(view.getSnapshot().changes).toEqual({ added: ["c"], updated: ["b"], removed: [] });
    replica.publish(fixtureModel([b2, c], 3));
    expect(view.getSnapshot().changes).toEqual({ added: [], updated: [], removed: ["a"] });
  });

  it("refresh() is heard only when the rows the view would be handed moved", () => {
    const model = fixtureModel([local("a", 1), peer("p", 2)]);
    const facts: { current: WindowRowFacts; device: string | null } = {
      current: factsOf(["a", "p"]),
      device: null,
    };
    const view = createWindowViewReplica(handReplica(model), windowReader(facts));
    const heard = vi.fn();
    view.subscribe(heard);
    // nothing handed out yet: nothing to tell
    view.refresh();
    expect(heard).not.toHaveBeenCalled();
    view.getSnapshot();
    view.refresh();
    expect(heard).not.toHaveBeenCalled();
    facts.device = PEER;
    view.refresh();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(view.getSnapshot().model.agents.map((row) => row.id)).toEqual(["p"]);
    view.refresh();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("window row identity across a launcher hand-off", () => {
  it("keeps one body, carries its identity forward and forgets it after removal", () => {
    const window = createWindowRows();
    const agent = local("agent", 2);
    const shell = local("shell", 1, { kind: "terminal" });
    const facts: WindowRowFacts = {
      ...factsOf(["agent", "shell"]),
      sessionByRow: new Map([
        ["agent", "pty"],
        ["shell", "pty"],
      ]),
      visualIds: new Map([["pty", "launcher-body"]]),
    };
    const first = window.rowsFor(fixtureModel([shell, agent]), facts);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: "agent", visualId: "launcher-body" });
    // The hand-off map is transient. The same row keeps the same drawn body.
    const after = window.rowsFor(fixtureModel([agent], 2), { ...facts, visualIds: undefined });
    expect(after).toBe(first);
    expect(after[0]).toBe(first[0]);
    // A removed run cannot lend its old body to a later row reusing the id.
    window.rowsFor(fixtureModel([], 3), factsOf([]));
    const reborn = local("agent", 3);
    const fresh = window.rowsFor(fixtureModel([reborn], 4), factsOf(["agent"]));
    expect(fresh[0]).toBe(reborn);
    expect(fresh[0]?.visualId).toBeUndefined();
  });

  it("keeps untouched row identities and the list across equivalent facts", () => {
    const window = createWindowRows();
    const a = local("a", 1);
    const p = peer("p", 2);
    const model = fixtureModel([a, p]);
    const first = window.rowsFor(model, factsOf(["a", "p"], "asleep"));
    expect(first[0]).toBe(a);
    expect(first[1]).not.toBe(p);
    expect(window.rowsFor(model, factsOf(["a", "p"], "asleep"))).toBe(first);
    const changed = window.rowsFor(
      fixtureModel([{ ...a, status: "blocked" }, p], 2),
      factsOf(["a", "p"], "asleep"),
    );
    expect(changed[0]).not.toBe(first[0]);
    expect(changed[1]).toBe(first[1]);
  });
});
