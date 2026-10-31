import type { NativeDoorOpen, NativeDoorPane } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type DoorCaller, DoorService, isSettled, REASK_MS } from "../src/tool-plane/door";
import { MCP_MODERN } from "../src/tool-plane/mcp";

// CP-1b, the tool plane's door since MT-0 — fieldd's half of the door (CP-1a's `native.door.*` and its meshdata lanes).
// The floor moves raw chunks of at most 64 KiB and never frames a message, so fieldd splits on newlines; a snapshot is
// the whole truth. Who is served what is the service's (tool-plane-service.test.ts); this file holds the door's own
// part of MT-0's settle rule: a caller settles only on positive evidence, an unsettled one is asked again at most once
// per REASK_MS, and a door whose caller holds nothing leaves one plain line.

const META = {
  "io.modelcontextprotocol/protocolVersion": MCP_MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
};
const enc = new TextEncoder();
const dec = new TextDecoder();

/** The service's lists, stubbed: a spark two rows, a settled run one, anything else none. */
const toolsOf = (caller: DoorCaller) =>
  caller.kind === "spark"
    ? ["agents_list", "history_search"]
    : caller.kind === "run" && isSettled(caller)
      ? ["history_search"]
      : [];

function harness(identify: (pane: NativeDoorPane | undefined) => DoorCaller) {
  let onEvent: ((payload: unknown, kind: "snapshot" | "delta") => void) | undefined;
  const handlers = new Map<number, (payload: Uint8Array) => void>();
  const sent = new Map<number, string>();
  const closed: unknown[] = [];
  const plain: string[] = [];
  let snapshot: unknown = { doors: [] };
  let asked = 0;
  const clock = { t: 1_793_270_000_000 };
  const door = new DoorService({
    native: {
      subscribe: async (method, _params, cb) => {
        expect(method).toBe("native.door.subscribe");
        onEvent = cb;
        return { snapshot, dispose: () => undefined };
      },
      request: async (method, params) => {
        closed.push({ method, params });
        return { closed: true };
      },
    },
    lanes: {
      onLane: (laneId, handler) => handlers.set(laneId, handler),
      offLane: (laneId) => handlers.delete(laneId),
      send: (laneId, payload) => {
        sent.set(laneId, (sent.get(laneId) ?? "") + dec.decode(payload));
        return true;
      },
      flush: async () => undefined,
    },
    identify: (pane) => {
      asked++;
      return identify(pane);
    },
    serve: (caller) => ({
      serverInfo: { name: "vibefield", version: "0.1.0" },
      tools: () =>
        toolsOf(caller()).map((name) => ({
          name,
          description: "A row.",
          inputSchema: { type: "object" },
        })),
      listTtlMs: () => (isSettled(caller()) ? undefined : 0),
      call: async () => ({ text: "{}" }),
    }),
    holdsTools: (caller) => toolsOf(caller).length > 0,
    onPlainCaller: (caller, open) =>
      plain.push(
        `${open.connId}:${caller.kind}${caller.kind === "run" && caller.unsettled ? `:${caller.unsettled}` : ""}`,
      ),
    now: () => clock.t,
    maxLineBytes: 1024,
  });
  const open = (connId: string, laneId: number, pane?: NativeDoorPane): NativeDoorOpen => ({
    connId,
    laneId,
    state: "open",
    caller: { pid: 4242, startedAtMs: 1793270000000 },
    ...(pane ? { pane } : {}),
  });
  const bytes = (laneId: number, text: string) => handlers.get(laneId)?.(enc.encode(text));
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const answers = (laneId: number) =>
    (sent.get(laneId) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  return {
    door,
    open,
    bytes,
    settle,
    answers,
    handlers,
    closed,
    plain,
    clock,
    asked: () => asked,
    setSnapshot: (s: unknown) => {
      snapshot = s;
    },
    event: (payload: unknown, kind: "snapshot" | "delta") => onEvent?.(payload, kind),
  };
}

const list = (id: number) =>
  `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list", params: { _meta: META } })}\n`;
const SPARK: DoorCaller = {
  kind: "spark",
  sparkId: "sp-7k2m9q4x",
  runtimeRunId: "run-12",
  profiles: ["native"],
};
const RUN: DoorCaller = { kind: "run", runtimeRunId: "run-7", profiles: ["native"] };
const names = (answer: { result: { tools: { name: string }[] } }) =>
  answer.result.tools.map((t) => t.name);

describe("the door, fieldd's half (CP-1b; MT-0's settle rule)", () => {
  it("claims the doors a snapshot names, and serves a spark's own session its rows", async () => {
    const h = harness((pane) =>
      pane?.terminalSessionId === "sess-spark" ? SPARK : { kind: "outside" },
    );
    h.setSnapshot({
      doors: [h.open("c1", 2 ** 32 + 1, { terminalSessionId: "sess-spark", depth: 1 })],
    });
    await h.door.ensureStarted();
    h.bytes(2 ** 32 + 1, list(1));
    await h.settle();
    expect(names(h.answers(2 ** 32 + 1)[0])).toEqual(["agents_list", "history_search"]);
    expect(h.plain).toEqual([]);
  });

  it("serves a settled plain run its rows, and a bare pane and a caller outside every pane none, each recorded once", async () => {
    const h = harness((pane) =>
      pane === undefined
        ? { kind: "outside" }
        : pane.terminalSessionId === "sess-plain"
          ? RUN
          : { kind: "pane", terminalSessionId: pane.terminalSessionId },
    );
    await h.door.ensureStarted();
    h.event(h.open("p1", 101, { terminalSessionId: "sess-plain", depth: 2 }), "delta");
    h.event(h.open("p2", 102, { terminalSessionId: "sess-shell", depth: 1 }), "delta");
    h.event(h.open("p3", 103), "delta");
    for (const lane of [101, 102, 103]) h.bytes(lane, list(1) + list(2));
    await h.settle();
    expect(h.answers(101).map(names)).toEqual([["history_search"], ["history_search"]]);
    for (const lane of [102, 103]) expect(h.answers(lane).map(names)).toEqual([[], []]);
    expect(h.plain.sort()).toEqual(["p2:pane", "p3:outside"]);
  });

  it("splits the floor's raw chunks on newlines, whatever their cut, and answers each line in order", async () => {
    const h = harness(() => SPARK);
    await h.door.ensureStarted();
    h.event(h.open("c1", 7, { terminalSessionId: "s", depth: 0 }), "delta");
    const two = list(1) + list(2);
    for (const chunk of [two.slice(0, 5), two.slice(5, 60), two.slice(60)]) h.bytes(7, chunk);
    await h.settle();
    expect(h.answers(7).map((a) => a.id)).toEqual([1, 2]);
  });

  // The window this keeps: after a fieldd restart the floor re-announces the doors it held before the session records
  // and the spark store are read back, so a spark's run is first named by a record whose spark does not verify yet.
  it("serves a door that opened a moment before fieldd knew its spark, once it does, and nothing before", async () => {
    let known = false;
    const h = harness(() =>
      known
        ? SPARK
        : { kind: "run", runtimeRunId: "run-12", profiles: [], unsettled: "spark-unverified" },
    );
    await h.door.ensureStarted();
    h.event(h.open("c1", 9, { terminalSessionId: "s", depth: 1 }), "delta");
    h.bytes(9, list(1));
    await h.settle();
    expect(names(h.answers(9)[0])).toEqual([]);
    expect(h.answers(9)[0].result.ttlMs).toBe(0);
    known = true;
    h.clock.t += REASK_MS;
    h.bytes(9, list(2));
    await h.settle();
    expect(names(h.answers(9)[1])).toEqual(["agents_list", "history_search"]);
    expect(h.answers(9)[1].result.ttlMs).toBeGreaterThan(0);
    expect(h.plain).toEqual(["c1:run:spark-unverified"]);
  });

  it("serves a run naming a spark that never verifies nothing, however often it asks, and records it once", async () => {
    const h = harness(() => ({
      kind: "run",
      runtimeRunId: "run-13",
      profiles: [],
      unsettled: "spark-unverified",
    }));
    await h.door.ensureStarted();
    h.event(h.open("f1", 31, { terminalSessionId: "s", depth: 1 }), "delta");
    for (let i = 1; i <= 5; i++) {
      h.clock.t += REASK_MS;
      h.bytes(31, list(i));
      await h.settle();
    }
    expect(h.answers(31).map(names)).toEqual([[], [], [], [], []]);
    expect(h.plain).toEqual(["f1:run:spark-unverified"]);
  });

  it("asks an unsettled door again at most once per REASK_MS, and a settled one never", async () => {
    const unsettled = harness(() => ({ kind: "pane", terminalSessionId: "s" }));
    await unsettled.door.ensureStarted();
    unsettled.event(unsettled.open("u1", 41, { terminalSessionId: "s", depth: 0 }), "delta");
    for (let i = 1; i <= 20; i++) unsettled.bytes(41, list(i));
    await unsettled.settle();
    expect(unsettled.asked()).toBe(1);
    unsettled.clock.t += REASK_MS;
    unsettled.bytes(41, list(21));
    await unsettled.settle();
    expect(unsettled.asked()).toBe(2);

    const settled = harness(() => RUN);
    await settled.door.ensureStarted();
    settled.event(settled.open("s1", 42, { terminalSessionId: "s", depth: 0 }), "delta");
    for (let i = 1; i <= 5; i++) {
      settled.clock.t += REASK_MS;
      settled.bytes(42, list(i));
    }
    await settled.settle();
    expect(settled.asked()).toBe(1);
  });

  it("lets go of a closed door's lane, and a later snapshot is the whole truth", async () => {
    const h = harness(() => SPARK);
    await h.door.ensureStarted();
    h.event(h.open("c1", 11, { terminalSessionId: "s", depth: 0 }), "delta");
    h.event(h.open("c2", 12, { terminalSessionId: "s", depth: 0 }), "delta");
    h.event({ connId: "c1", state: "closed", reason: "eof" }, "delta");
    expect([...h.handlers.keys()]).toEqual([12]);
    h.event({ doors: [h.open("c3", 13, { terminalSessionId: "s", depth: 0 })] }, "snapshot");
    expect([...h.handlers.keys()]).toEqual([13]);
    expect([...h.door.doors().keys()]).toEqual(["c3"]);
  });

  it("closes a door whose line runs past the bound, and stays quiet on a delta it cannot read", async () => {
    const h = harness(() => SPARK);
    await h.door.ensureStarted();
    h.event(h.open("c1", 21, { terminalSessionId: "s", depth: 0 }), "delta");
    h.bytes(21, "x".repeat(2048));
    expect(h.closed).toEqual([
      { method: "native.door.close", params: { connId: "c1", reason: "line-too-long" } },
    ]);
    expect(h.handlers.has(21)).toBe(false);
    h.event({ connId: "c9", state: "half-open" }, "delta");
    expect(h.door.doors().size).toBe(0);
  });

  it("is quiet when the floor has no door (a floor before CP-1a): the plane waits for the next connect", async () => {
    const door = new DoorService({
      native: {
        subscribe: async () => {
          throw new Error("method not found: native.door.subscribe");
        },
        request: async () => undefined,
      },
      lanes: {
        onLane: () => undefined,
        offLane: () => undefined,
        send: () => true,
        flush: async () => undefined,
      },
      identify: () => ({ kind: "outside" }),
      serve: () => ({
        serverInfo: { name: "vibefield", version: "0" },
        tools: () => [],
        call: async () => ({ text: "" }),
      }),
      holdsTools: () => false,
    });
    await expect(door.ensureStarted()).resolves.toBeUndefined();
    expect(door.doors().size).toBe(0);
  });
});
