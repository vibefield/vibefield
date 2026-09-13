import {
  AGENT_FIELD,
  type AgentFieldSlice,
  type AgentListResult,
  STORES,
} from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentFieldPublisher } from "../src/agent-field-publisher";
import { managedSummary } from "./agent-field-summary";

// MF-1 (§10.2) — the store carrier. What is under test is the publisher's
// three honesty rules: an unchanged board is not news, mesh-down is a normal
// state, and a desktop that stops (or loses consent) withdraws its rows
// instead of leaving a reader to age them out.

const board = (...ids: string[]): AgentListResult => ({
  sessions: ids.map((runtimeRunId) => managedSummary({ runtimeRunId })),
});

function meshSpy() {
  const writes: AgentFieldSlice[] = [];
  let fail: Error | null = null;
  return {
    writes,
    stores: [] as string[],
    breakWith(error: Error | null) {
      fail = error;
    },
    async setSlice(storeId: string, data: unknown) {
      this.stores.push(storeId);
      if (fail !== null) throw fail;
      writes.push(data as AgentFieldSlice);
      return {};
    },
  };
}

function fold(initial: AgentListResult) {
  let current = initial;
  const listeners = new Set<(rows: AgentListResult) => void>();
  return {
    list: () => current,
    subscribe: (fn: (rows: AgentListResult) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    publish(next: AgentListResult) {
      current = next;
      for (const fn of [...listeners]) fn(next);
    },
    get subscribers() {
      return listeners.size;
    },
  };
}

describe("AgentFieldPublisher (MF-1 §10.2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const build = (
    source: ReturnType<typeof fold>,
    mesh: ReturnType<typeof meshSpy>,
    serving: () => boolean = () => true,
  ) =>
    new AgentFieldPublisher({
      mesh,
      deviceId: () => "dev-1",
      list: source.list,
      subscribe: source.subscribe,
      serving,
      now: () => 1_000_000,
    });

  it("publishes the board into field.agents.v1, coalesced, with an expiry ahead of it", async () => {
    const source = fold(board("run-1"));
    const mesh = meshSpy();
    const publisher = build(source, mesh);
    publisher.start();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);

    expect(mesh.stores).toEqual([STORES.AGENT_FIELD]);
    expect(mesh.writes).toHaveLength(1);
    expect(mesh.writes[0]).toMatchObject({
      v: 1,
      deviceId: "dev-1",
      publishedAt: 1_000_000,
      expiresAt: 1_000_000 + AGENT_FIELD.STORE_EXPIRY_MS,
      revision: 1,
    });
    expect(mesh.writes[0]?.rows.map((row) => row.runtimeRunId)).toEqual(["run-1"]);
    // the rows are the PROJECTION, not the fold's
    expect(Object.keys(mesh.writes[0]?.rows[0] ?? {})).not.toContain("monitor");
    await publisher.dispose();
  });

  it("writes once for a burst, and not at all when the projection did not move", async () => {
    const source = fold(board("run-1"));
    const mesh = meshSpy();
    const publisher = build(source, mesh);
    publisher.start();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(mesh.writes).toHaveLength(1);

    // ten publishes of the same board: the mirror revised, the field did not
    for (let i = 0; i < 10; i += 1) source.publish(board("run-1"));
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS * 4);
    expect(mesh.writes).toHaveLength(1);

    // a real change is one more write, carrying both rows
    source.publish(board("run-1", "run-2"));
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(mesh.writes).toHaveLength(2);
    expect(mesh.writes[1]?.rows).toHaveLength(2);
    expect(mesh.writes[1]?.revision).toBe(2);
    await publisher.dispose();
  });

  it("heartbeats while it has rows, pushing the expiry forward without new news", async () => {
    const source = fold(board("run-1"));
    const mesh = meshSpy();
    let clock = 1_000_000;
    const publisher = new AgentFieldPublisher({
      mesh,
      deviceId: () => "dev-1",
      list: source.list,
      subscribe: source.subscribe,
      serving: () => true,
      now: () => clock,
    });
    publisher.start();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(mesh.writes).toHaveLength(1);

    clock += AGENT_FIELD.STORE_HEARTBEAT_MS;
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_HEARTBEAT_MS);
    expect(mesh.writes).toHaveLength(2);
    // same board, same revision — only the clock moved
    expect(mesh.writes[1]?.revision).toBe(mesh.writes[0]?.revision);
    expect(mesh.writes[1]?.rows.map((r) => r.runtimeRunId)).toEqual(["run-1"]);
    expect(mesh.writes[1]?.expiresAt).toBe(clock + AGENT_FIELD.STORE_EXPIRY_MS);
    expect(mesh.writes[1]?.expiresAt).toBeGreaterThan(mesh.writes[0]!.expiresAt);
    await publisher.dispose();
  });

  it("stops heartbeating once the board is empty — there is nothing to keep alive", async () => {
    const source = fold(board("run-1"));
    const mesh = meshSpy();
    const publisher = build(source, mesh);
    publisher.start();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);

    source.publish(board());
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(mesh.writes).toHaveLength(2);
    expect(mesh.writes[1]?.rows).toEqual([]);

    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_HEARTBEAT_MS * 3);
    expect(mesh.writes).toHaveLength(2);
    await publisher.dispose();
  });

  it("publishes nothing at all while the gate is shut", async () => {
    const source = fold(board("run-1"));
    const mesh = meshSpy();
    const publisher = build(source, mesh, () => false);
    publisher.start();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS * 10);
    source.publish(board("run-1", "run-2"));
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_HEARTBEAT_MS * 2);
    expect(mesh.stores).toEqual([]);
    // and a dispose with nothing published writes nothing either
    await publisher.dispose();
    expect(mesh.stores).toEqual([]);
  });

  it("publishes the CURRENT board the moment the gate opens, and withdraws when it shuts", async () => {
    const source = fold(board("run-1"));
    const mesh = meshSpy();
    let serving = false;
    const publisher = build(source, mesh, () => serving);
    publisher.start();
    // the fold moved on while consent was absent — nothing was sent, but the
    // projection kept folding
    source.publish(board("run-1", "run-2"));
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS * 2);
    expect(mesh.writes).toEqual([]);

    serving = true;
    publisher.notifyServingChanged();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(mesh.writes).toHaveLength(1);
    expect(mesh.writes[0]?.rows).toHaveLength(2);

    serving = false;
    publisher.notifyServingChanged();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    // the withdrawal: empty rows, and an expiry already in the past
    expect(mesh.writes).toHaveLength(2);
    expect(mesh.writes[1]?.rows).toEqual([]);
    expect(mesh.writes[1]?.expiresAt).toBeLessThanOrEqual(mesh.writes[1]!.publishedAt);
    // and it keeps quiet after
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_HEARTBEAT_MS * 2);
    expect(mesh.writes).toHaveLength(2);
    await publisher.dispose();
  });

  it("is quiet when the mesh is down, and publishes again when it returns", async () => {
    const source = fold(board("run-1"));
    const mesh = meshSpy();
    mesh.breakWith(new Error("mesh node is not running"));
    const publisher = build(source, mesh);
    publisher.start();
    // the claim is that nothing THROWS and nothing reaches a caller
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(mesh.stores).toHaveLength(1); // it tried
    expect(mesh.writes).toEqual([]); // and nothing landed, and nothing threw

    // the mesh returns: the NEXT change publishes the whole board, because a
    // failed write is not a published one
    mesh.breakWith(null);
    source.publish(board("run-1", "run-2"));
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(mesh.writes).toHaveLength(1);
    expect(mesh.writes[0]?.rows).toHaveLength(2);
    await publisher.dispose();
  });

  it("a graceful dispose withdraws the field and lets go of the fold", async () => {
    const source = fold(board("run-1"));
    const mesh = meshSpy();
    const publisher = build(source, mesh);
    publisher.start();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(source.subscribers).toBe(1);

    await publisher.dispose();
    expect(mesh.writes).toHaveLength(2);
    expect(mesh.writes[1]).toMatchObject({ rows: [], expiresAt: 1_000_000 });
    expect(source.subscribers).toBe(0);

    // nothing after a dispose, ever
    source.publish(board("run-9"));
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_HEARTBEAT_MS * 3);
    expect(mesh.writes).toHaveLength(2);
  });
});
