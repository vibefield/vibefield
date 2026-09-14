import {
  AGENT_FIELD,
  type AgentFieldSlice,
  type AgentListResult,
  MESH_CONTROL_LIMITS,
  STORES,
} from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentFieldPublisher } from "../src/agent-field-publisher";
import { RpcCallError } from "../src/native-link";
import { managedSummary } from "./agent-field-summary";

interface CapturedLog {
  event: string;
  message: string;
  attrs?: LogFields | undefined;
}

function captureLogger(events: CapturedLog[]): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: (event, message, attrs) => events.push({ event, message, attrs }),
    debug: (event, message, attrs) => events.push({ event, message, attrs }),
    info: (event, message, attrs) => events.push({ event, message, attrs }),
    warn: (event, message, attrs) => events.push({ event, message, attrs }),
    error: (event, message, _error, attrs) => events.push({ event, message, attrs }),
    fatal: (event, message, _error, attrs) => events.push({ event, message, attrs }),
    isLevelEnabled: () => true,
  };
  return logger;
}

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

describe("MF-1h — nothing the publisher does can end the daemon", () => {
  // REAL timers: an unhandled rejection is something NODE reports, on its own
  // turn of the loop, and the fake clock cannot make that happen.
  //
  // What this guards is not hypothetical. Every call in a flush is an injected
  // live service — the fold mid-rebuild, DeviceService before it is ready —
  // and the flush runs from a timer with no caller to catch it. fieldd
  // installs no `unhandledRejection` handler, so Node's default TERMINATES the
  // process: an agent-field pass would take the whole daemon, its PTYs'
  // supervision and every open door with it.
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  beforeEach(() => {
    rejections.length = 0;
    process.on("unhandledRejection", onRejection);
  });
  afterEach(() => process.off("unhandledRejection", onRejection));

  /** let Node finish its own turn, which is when it decides a rejection was
   * never handled */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

  it("a fold that throws is logged, not fatal", async () => {
    const logs: CapturedLog[] = [];
    const publisher = new AgentFieldPublisher({
      mesh: { setSlice: async () => ({}) },
      deviceId: () => "dev-1",
      list: () => {
        throw new Error("the fold is mid-rebuild");
      },
      subscribe: () => () => undefined,
      serving: () => true,
      terminalPublished: () => true,
      minIntervalMs: 1,
      logger: captureLogger(logs),
    });
    publisher.start();
    await settle();
    expect(rejections, "the publisher escaped as an unhandled rejection").toEqual([]);
    expect(logs.filter((l) => l.event === "fieldd.agents.field_publish_failed")).toHaveLength(1);
    await publisher.dispose();
  });

  it("a deviceId that throws is logged, not fatal — in a publish and in a dispose", async () => {
    const logs: CapturedLog[] = [];
    const publisher = new AgentFieldPublisher({
      mesh: { setSlice: async () => ({}) },
      deviceId: () => {
        throw new Error("DeviceService is not ready");
      },
      list: () => ({ sessions: [managedSummary()] }),
      subscribe: () => () => undefined,
      serving: () => true,
      terminalPublished: () => true,
      minIntervalMs: 1,
      logger: captureLogger(logs),
    });
    publisher.start();
    await settle();
    expect(rejections).toEqual([]);
    // and a dispose that cannot name its device still resolves: a stop ladder
    // must not reject halfway through
    await expect(publisher.dispose()).resolves.toBeUndefined();
    await settle();
    expect(rejections).toEqual([]);
  });

  it("a `serving` that throws is logged, not fatal", async () => {
    const logs: CapturedLog[] = [];
    const publisher = new AgentFieldPublisher({
      mesh: { setSlice: async () => ({}) },
      deviceId: () => "dev-1",
      list: () => ({ sessions: [] }),
      subscribe: () => () => undefined,
      serving: () => {
        throw new Error("the mesh client is mid-reconcile");
      },
      terminalPublished: () => true,
      minIntervalMs: 1,
      logger: captureLogger(logs),
    });
    publisher.start();
    await settle();
    expect(rejections).toEqual([]);
    expect(logs.filter((l) => l.event === "fieldd.agents.field_publish_failed")).toHaveLength(1);
    await publisher.dispose();
  });
});

describe("AgentFieldPublisher (MF-1 §10.2)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const build = (
    source: ReturnType<typeof fold>,
    mesh: ReturnType<typeof meshSpy>,
    serving: () => boolean = () => true,
    terminalPublished: () => boolean = () => true,
  ) =>
    new AgentFieldPublisher({
      mesh,
      deviceId: () => "dev-1",
      list: source.list,
      subscribe: source.subscribe,
      serving,
      terminalPublished,
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
      terminalPublished: () => true,
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

  it("caps an oversized board instead of letting the floor refuse the whole write", async () => {
    // MF-1h — a populated row measures ≈725 B against the 64 KiB cap, so a
    // board of roughly ninety agents reaches it. An UNCAPPED write is refused
    // by the floor, which the catch reads as mesh-down and retries forever:
    // the desktop would vanish from every phone rather than arrive short.
    const populated = (runtimeRunId: string) =>
      managedSummary({
        runtimeRunId,
        status: "working",
        permissionTool: "Bash",
        cumulativeTokens: 902_140,
        contextPercent: 72,
        effort: { value: "high", intent: "observed" },
        git: { branch: "mf/fd1" },
        lastAssistantText: "a reply that never travels",
      });
    const source = fold({ sessions: Array.from({ length: 120 }, (_, i) => populated(`run-${i}`)) });
    const mesh = meshSpy();
    const logs: CapturedLog[] = [];
    const publisher = new AgentFieldPublisher({
      mesh,
      deviceId: () => "dev-1",
      list: source.list,
      subscribe: source.subscribe,
      serving: () => true,
      terminalPublished: () => true,
      now: () => 1_000_000,
      logger: captureLogger(logs),
    });
    publisher.start();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);

    const slice = mesh.writes[0]!;
    expect(Buffer.byteLength(JSON.stringify(slice), "utf8")).toBeLessThanOrEqual(
      MESH_CONTROL_LIMITS.AGENT_FIELD_SLICE_BYTES,
    );
    expect(slice.rows.length).toBeLessThan(120);
    expect(slice.omitted).toBe(120 - slice.rows.length);
    // the board's END is what a reader loses: the fold's order is oldest
    // first, so the newest runs are the ones left out
    expect(slice.rows[0]?.runtimeRunId).toBe("run-0");
    // ONE warning for the crossing, not one per flush
    const crossings = () => logs.filter((l) => l.event === "fieldd.agents.field_slice_capped");
    expect(crossings()).toHaveLength(1);
    source.publish({ sessions: Array.from({ length: 121 }, (_, i) => populated(`run-${i}`)) });
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(crossings(), "the crossing was logged twice").toHaveLength(1);

    // and coming back under says so, once
    source.publish({ sessions: [populated("run-0")] });
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(mesh.writes.at(-1)?.omitted).toBeUndefined();
    expect(logs.filter((l) => l.event === "fieldd.agents.field_slice_whole")).toHaveLength(1);
    await publisher.dispose();
  });

  it("tells the floor's refusal from the mesh being down", async () => {
    const source = fold(board("run-1"));
    const mesh = meshSpy();
    const logs: CapturedLog[] = [];
    const publisher = new AgentFieldPublisher({
      mesh,
      deviceId: () => "dev-1",
      list: source.list,
      subscribe: source.subscribe,
      serving: () => true,
      terminalPublished: () => true,
      now: () => 1_000_000,
      logger: captureLogger(logs),
    });
    mesh.breakWith(
      new RpcCallError("RESOURCE_EXHAUSTED", "store slice exceeds its transport limit", false, {
        resource: "store-slice",
        storeId: STORES.AGENT_FIELD,
        limit: MESH_CONTROL_LIMITS.AGENT_FIELD_SLICE_BYTES,
      }),
    );
    publisher.start();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    // the floor's own words, at WARN — retrying this unchanged never succeeds
    const refused = logs.filter((l) => l.event === "fieldd.agents.field_slice_refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.attrs?.["reason"]).toContain("transport limit");
    expect(logs.filter((l) => l.event === "fieldd.agents.field_slice_unpublished")).toEqual([]);

    // an ordinary mesh-down stays the quiet DEBUG it always was
    mesh.breakWith(new Error("mesh node is not running"));
    source.publish(board("run-1", "run-2"));
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(logs.filter((l) => l.event === "fieldd.agents.field_slice_unpublished")).toHaveLength(1);
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

  // TM-2 (MF-1l) — the false positive MF-1h named and owed, closed.
  it("withholds the attach JOIN while the doors are not published, and keeps the row", async () => {
    const source = fold(board("run-1"));
    const mesh = meshSpy();
    let published = false;
    const publisher = build(
      source,
      mesh,
      () => true,
      () => published,
    );
    publisher.start();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);

    // the row is there — the agent is real and working, and dropping it for a
    // transport reason would lose a live agent off a phone
    expect(mesh.writes[0]?.rows.map((r) => r.runtimeRunId)).toEqual(["run-1"]);
    // …but nothing on it says "tap me": the join is what a card attaches
    // THROUGH, and an attach would answer doors_not_published
    expect(mesh.writes[0]?.rows[0]?.terminal).toBeUndefined();
    // and `alive` is computed BEFORE the join is withheld, so a hosted run
    // does not read as gone because the mesh is off
    expect(mesh.writes[0]?.rows[0]?.alive).toBe(true);

    // the doors come up: the BOARD has not moved, but what its rows promise
    // has, so this is news
    published = true;
    publisher.notifyServingChanged();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(mesh.writes).toHaveLength(2);
    expect(mesh.writes[1]?.rows[0]?.terminal).toMatchObject({ hosted: "local" });
    expect(mesh.writes[1]?.revision).toBe(mesh.writes[0]?.revision);

    // …and going quiet again withdraws it
    published = false;
    publisher.notifyServingChanged();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(mesh.writes).toHaveLength(3);
    expect(mesh.writes[2]?.rows[0]?.terminal).toBeUndefined();

    // an unchanged board with an unchanged gate is still not news
    publisher.notifyServingChanged();
    await vi.advanceTimersByTimeAsync(AGENT_FIELD.STORE_MIN_INTERVAL_MS);
    expect(mesh.writes).toHaveLength(3);
    await publisher.dispose();
  });
});
