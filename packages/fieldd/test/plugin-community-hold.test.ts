import { EventEmitter } from "node:events";
import type { PluginRecord } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { RpcCallError } from "../src/native-link";
import { CommunityHold, communityGate } from "../src/plugin-community-hold";
import { type CapturedLog, captureLogger } from "./drive-fakes";

// MK-O3, O3-C — the hold on code already running, and the registry's gate (`mk-o3/PLAN-O3C.md`,
// accepted by VF-PM 2026-11-12 08:31:12Z). The registry here is the test's own stand-in: rows it
// sets, a held set it sets, and a `changed` it emits when told to refresh. No daemon, no file, no
// child. Each failure carries a path in its text, and the log says its code alone.

/** The registry as the hold reads it: its rows, its own held set, a refresh that says `changed`. */
class FakeRegistry extends EventEmitter {
  rows: Array<{ id: string; enabled: boolean; held?: "community-off" }> = [];
  held = new Set<string>();
  refreshes = 0;
  /** runs inside each refresh, before `changed` (a test's moment to hold one open, or to fail it)
   */
  onRefresh: () => void | Promise<void> = () => undefined;

  list(): PluginRecord[] {
    return this.rows as unknown as PluginRecord[];
  }

  isHeld(id: string): boolean {
    return this.held.has(id);
  }

  async refresh(): Promise<void> {
    this.refreshes += 1;
    await this.onRefresh();
    this.emit("changed");
  }
}

const said = (logs: CapturedLog[], event: string) =>
  logs.filter((l) => l.event === event).map((l) => l.attrs);

function hold(registry: FakeRegistry, opts: { allowed?: () => Promise<boolean> } = {}) {
  const torn: string[] = [];
  const restarted: string[] = [];
  const logs: CapturedLog[] = [];
  const community = new CommunityHold({
    plugins: registry,
    allowed: opts.allowed ?? (async () => false),
    teardown: async (id) => {
      torn.push(id);
    },
    restart: (id) => {
      restarted.push(id);
    },
    logger: captureLogger(logs),
  });
  return { community, torn, restarted, logs };
}

describe("the hold on code already running (MK-O3, O3-C)", () => {
  it("a plugin newly held is torn down once; one held when the hold starts never ran here, so it is not", async () => {
    const registry = new FakeRegistry();
    registry.rows = [
      { id: "acme.burndown", enabled: false },
      { id: "acme.clock", enabled: true },
    ];
    registry.held = new Set(["acme.burndown"]);
    const { community, torn, logs } = hold(registry);
    registry.held = new Set(["acme.burndown", "acme.clock"]);
    registry.rows = [
      { id: "acme.burndown", enabled: false },
      { id: "acme.clock", enabled: false },
    ];
    await registry.refresh();
    await registry.refresh();
    await community.settled();
    expect(torn).toEqual(["acme.clock"]);
    expect(said(logs, "fieldd.plugin_registry.community_hold")).toEqual([
      { pluginId: "acme.clock", held: true },
    ]);
  });

  it("one let go that the person wants on starts fresh; one the person turned off does not", async () => {
    const registry = new FakeRegistry();
    registry.rows = [
      { id: "acme.burndown", enabled: false },
      { id: "acme.clock", enabled: false },
    ];
    registry.held = new Set(["acme.burndown", "acme.clock"]);
    const { community, restarted, torn } = hold(registry);
    registry.held = new Set();
    registry.rows = [
      { id: "acme.burndown", enabled: true },
      { id: "acme.clock", enabled: false },
    ];
    await registry.refresh();
    await community.settled();
    expect(restarted).toEqual(["acme.burndown"]);
    expect(torn).toEqual([]);
  });

  it("decides by the registry's own set, never by the row's `held`", async () => {
    const registry = new FakeRegistry();
    registry.rows = [
      { id: "acme.burndown", enabled: true, held: "community-off" },
      { id: "acme.clock", enabled: false },
    ];
    const { community, torn, restarted } = hold(registry);
    registry.held = new Set(["acme.clock"]);
    await registry.refresh();
    await community.settled();
    expect([torn, restarted]).toEqual([["acme.clock"], []]);
  });

  it("its refreshes take turns", async () => {
    const registry = new FakeRegistry();
    const { community } = hold(registry);
    const order: string[] = [];
    let release: () => void = () => undefined;
    registry.onRefresh = () =>
      new Promise<void>((resolve) => {
        const n = registry.refreshes;
        order.push(`start ${n}`);
        release = () => {
          order.push(`end ${n}`);
          resolve();
        };
      });
    const first = community.refresh();
    const second = community.refresh();
    await vi.waitFor(() => expect(order).toEqual(["start 1"]));
    release();
    await first;
    await vi.waitFor(() => expect(order).toEqual(["start 1", "end 1", "start 2"]));
    release();
    await second;
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });

  it("a refresh that fails never rejects: it is said by its code, and the rows stand as they were", async () => {
    const registry = new FakeRegistry();
    const { community, logs } = hold(registry);
    registry.onRefresh = () => {
      throw new RpcCallError("UNAVAILABLE", "no records at /secret/path", false);
    };
    await expect(community.refresh()).resolves.toBeUndefined();
    expect(said(logs, "fieldd.plugin_registry.community_refresh_failed")).toEqual([
      { reason: "UNAVAILABLE" },
    ]);
  });

  it("the switch moving reads the registry again only when the answer moved", async () => {
    const registry = new FakeRegistry();
    let allowed = false;
    const { community } = hold(registry, { allowed: async () => allowed });
    await community.switchMoved();
    expect(registry.refreshes).toBe(1);
    await community.switchMoved();
    expect(registry.refreshes).toBe(1);
    allowed = true;
    await community.switchMoved();
    expect(registry.refreshes).toBe(2);
    await community.switchMoved();
    expect(registry.refreshes).toBe(2);
  });

  it("a teardown that fails is said by its code, and the next act still runs", async () => {
    const registry = new FakeRegistry();
    registry.rows = [
      { id: "acme.burndown", enabled: true },
      { id: "acme.clock", enabled: true },
    ];
    const logs: CapturedLog[] = [];
    const torn: string[] = [];
    const community = new CommunityHold({
      plugins: registry,
      allowed: async () => false,
      teardown: async (id) => {
        torn.push(id);
        if (id === "acme.burndown") throw new RpcCallError("UNAVAILABLE", "a path /secret", false);
      },
      restart: () => undefined,
      logger: captureLogger(logs),
    });
    registry.held = new Set(["acme.burndown", "acme.clock"]);
    await registry.refresh();
    await community.settled();
    expect(torn).toEqual(["acme.burndown", "acme.clock"]);
    expect(said(logs, "fieldd.plugin_registry.community_hold_failed")).toEqual([
      { pluginId: "acme.burndown", held: true, reason: "UNAVAILABLE" },
    ]);
  });
});

describe("the registry's gate (MK-O3, O3-C)", () => {
  it("allowed, it answers so without reading the plugin list", async () => {
    let reads = 0;
    const gate = communityGate({
      allowed: async () => true,
      listedAs: async () => {
        reads += 1;
        return () => "community";
      },
    });
    expect(await gate()).toEqual({ allowed: true });
    expect(reads).toBe(0);
  });

  it("not allowed, it reads the plugin list once and answers its lookup", async () => {
    let reads = 0;
    const gate = communityGate({
      allowed: async () => false,
      listedAs: async () => {
        reads += 1;
        return (id) => (id === "vibefield.desk-things" ? "vibefield" : "community");
      },
    });
    const verdict = await gate();
    expect(reads).toBe(1);
    if (verdict.allowed) throw new Error("the gate allowed community plugins");
    const { listedAs } = verdict;
    const ids = ["vibefield.desk-things", "acme.burndown"];
    expect(ids.map((id) => listedAs(id))).toEqual(["vibefield", "community"]);
  });

  it("a read that fails is said by its code alone and thrown on, so the registry holds every one", async () => {
    const logs: CapturedLog[] = [];
    const gate = communityGate({
      allowed: async () => {
        throw new RpcCallError("UNAVAILABLE", "no settings at /secret/path", false);
      },
      listedAs: async () => () => "community",
      logger: captureLogger(logs),
    });
    await expect(gate()).rejects.toBeInstanceOf(RpcCallError);
    expect(said(logs, "fieldd.plugin_registry.community_gate_failed")).toEqual([
      { reason: "UNAVAILABLE" },
    ]);
  });
});
