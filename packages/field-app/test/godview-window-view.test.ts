import type { MonitorReplicaLike } from "@vibecook/puppeteer-view-sdk/host";
import type { AgentView, MonitorModel } from "@vibecook/puppeteer-view-sdk/model";
import { agentViewFixture, fixtureModel } from "@vibecook/puppeteer-view-sdk/testing";
import type { RowsDeviceState } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createWindowRows,
  narrowToDevice,
  type WindowRowFacts,
} from "../src/godview/monitor/window-rows";
import { createWindowViewReplica } from "../src/godview/monitor/window-view";

// MV-4 — THE MODEL A PORTED VIEW DRAWS (`window-view.ts`). List and rain read
// the model alone, so the window's own facts reach them as the model: the
// rows the legacy bridge hands a legacy view (the same reader, `window-rows.ts`
// then `narrowToDevice`), in the same order, as the replica's own `AgentView`s.
// What a person would see if any of these slipped: the device filter not
// narrowing the list or the rain, the rain claiming its columns in another
// order, a sleeping desktop's agents drawn bright.

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

/** The bridge's reader as `useMonitorAgents` builds it: the window rows, narrowed. */
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
