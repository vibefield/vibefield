import type { NativeDoorOpen, NativeDoorPane } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type DoorCaller, DoorService } from "../src/compose/door";
import { MCP_MODERN } from "../src/compose/mcp";

// CP-1b — fieldd's half of the door (the compose plane, version 2; CP-1a's `native.door.*` and its meshdata lanes).
// The floor moves raw chunks of at most 64 KiB and never frames a message, so fieldd splits on newlines; a snapshot is
// the whole truth; a spark's own session is served its tools, and anything else none.

const META = {
  "io.modelcontextprotocol/protocolVersion": MCP_MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
};
const enc = new TextEncoder();
const dec = new TextDecoder();

function harness(identify: (pane: NativeDoorPane | undefined) => DoorCaller) {
  let onEvent: ((payload: unknown, kind: "snapshot" | "delta") => void) | undefined;
  const handlers = new Map<number, (payload: Uint8Array) => void>();
  const sent = new Map<number, string>();
  const closed: unknown[] = [];
  const plain: string[] = [];
  let snapshot: unknown = { doors: [] };
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
    identify,
    serve: (caller) => ({
      serverInfo: { name: "vibefield", version: "0.1.0" },
      tools: () =>
        caller().kind === "spark"
          ? [
              {
                name: "agents_list",
                description: "List the sessions.",
                inputSchema: { type: "object" },
              },
            ]
          : [],
      call: async () => ({ text: "{}" }),
    }),
    onPlainCaller: (caller, open) => plain.push(`${open.connId}:${caller.kind}`),
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
    setSnapshot: (s: unknown) => {
      snapshot = s;
    },
    event: (payload: unknown, kind: "snapshot" | "delta") => onEvent?.(payload, kind),
  };
}

const list = (id: number) =>
  `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list", params: { _meta: META } })}\n`;
const SPARK: DoorCaller = { kind: "spark", sparkId: "sp-7k2m9q4x", runtimeRunId: "run-12" };

describe("the door, fieldd's half (CP-1b)", () => {
  it("claims the doors a snapshot names, and serves a spark's own session its tools", async () => {
    const h = harness((pane) =>
      pane?.terminalSessionId === "sess-spark" ? SPARK : { kind: "outside" },
    );
    h.setSnapshot({
      doors: [h.open("c1", 2 ** 32 + 1, { terminalSessionId: "sess-spark", depth: 1 })],
    });
    await h.door.ensureStarted();
    h.bytes(2 ** 32 + 1, list(1));
    await h.settle();
    expect(h.answers(2 ** 32 + 1)[0].result.tools.map((t: { name: string }) => t.name)).toEqual([
      "agents_list",
    ]);
    expect(h.plain).toEqual([]);
  });

  it("serves a plain agent, a bare pane and a caller outside every pane no tools, and records each once", async () => {
    const h = harness((pane) =>
      pane === undefined
        ? { kind: "outside" }
        : pane.terminalSessionId === "sess-plain"
          ? { kind: "run", runtimeRunId: "run-7" }
          : { kind: "pane", terminalSessionId: pane.terminalSessionId },
    );
    await h.door.ensureStarted();
    h.event(h.open("p1", 101, { terminalSessionId: "sess-plain", depth: 2 }), "delta");
    h.event(h.open("p2", 102, { terminalSessionId: "sess-shell", depth: 1 }), "delta");
    h.event(h.open("p3", 103), "delta");
    for (const lane of [101, 102, 103]) h.bytes(lane, list(1) + list(2));
    await h.settle();
    for (const lane of [101, 102, 103]) {
      expect(h.answers(lane).map((a) => a.result.tools)).toEqual([[], []]);
    }
    expect(h.plain.sort()).toEqual(["p1:run", "p2:pane", "p3:outside"]);
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

  it("serves a door that opened a moment before fieldd knew its spark, once it does", async () => {
    let known = false;
    const h = harness(() => (known ? SPARK : { kind: "run", runtimeRunId: "run-12" }));
    await h.door.ensureStarted();
    h.event(h.open("c1", 9, { terminalSessionId: "s", depth: 1 }), "delta");
    known = true;
    h.bytes(9, list(1));
    await h.settle();
    expect(h.answers(9)[0].result.tools).toHaveLength(1);
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
    });
    await expect(door.ensureStarted()).resolves.toBeUndefined();
    expect(door.doors().size).toBe(0);
  });
});
