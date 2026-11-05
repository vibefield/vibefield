import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallerContext, Principal } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { AgentInputQueues, type DeliveryReceipt, markedText } from "../src/agent-input-queue";
import { RpcCallError } from "../src/native-link";
import {
  admitSparkActor,
  admitSparkReader,
  type DesktopAsk,
  mergeAtHome,
  SAY_RECEIPTS_KEPT,
  SayReceipts,
} from "../src/tool-plane/spark-doors";

// IOS-12a (PC-D7 A, PC-L2; the design page Chat in a Pocket, ruled 2026-11-04) — who the spark doors and the needs-you
// queue's doors answer (DS-L4, DS-L7), the home's merge of every self desktop, and your words' receipts (PC-D3 A).

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ctx = (
  principal: Principal,
  more: Partial<Omit<CallerContext, "principal">> = {},
): CallerContext => ({ principal, transport: "ws-loopback", receivedAt: 0, ...more });

const WINDOW = ctx({ kind: "local-token", tokenId: "t1", scopes: ["sparks.use"] } as Principal, {
  clientKind: "renderer",
});
const SHELL = ctx({ kind: "shell-main" } as Principal);
const PHONE = ctx({ kind: "tailnet", login: "me@example.com", self: true } as Principal, {
  clientKind: "ios",
});
const PRE_CAPTURE = ctx({ kind: "tailnet", login: "me@example.com" } as Principal);
const PEER = (onBehalfOf?: CallerContext["onBehalfOf"]) =>
  ctx({ kind: "peer-fieldd", deviceId: "dev-b" } as Principal, {
    ...(onBehalfOf !== undefined ? { onBehalfOf } : {}),
  });
const STRANGERS: Array<[string, CallerContext]> = [
  ["a plugin", ctx({ kind: "plugin", pluginId: "p", scopes: [] } as unknown as Principal)],
  ["an agent", ctx({ kind: "mcp-agent", sessionId: "run-1", scopes: [] } as Principal)],
  ["a guest", ctx({ kind: "tailnet-guest", login: "x@y.z" } as Principal)],
  [
    "a debug client with a copied token",
    ctx({ kind: "local-token", tokenId: "t2", scopes: ["sparks.use"] } as Principal, {
      clientKind: "plugin-worker",
    }),
  ],
  ["a tailnet login this desktop has not matched", PRE_CAPTURE],
];

const refusedKind = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof RpcCallError ? error.kind : "thrown";
  }
  return undefined;
};

describe("who the spark doors answer (DS-L4, DS-L7)", () => {
  it("the person's screens read the home's answer; a peer daemon its own rows; no one else", () => {
    for (const screen of [WINDOW, SHELL, PHONE])
      expect(admitSparkReader(screen, "compose.sparks.list")).toBe("home");
    expect(admitSparkReader(PEER(), "compose.sparks.list")).toBe("own");
    for (const [who, stranger] of STRANGERS)
      expect(
        refusedKind(() => admitSparkReader(stranger, "needs.list")),
        who,
      ).toBe("FORBIDDEN_SCOPE");
  });

  it("the person's screens act here; a peer daemon only as the carrier of a person's forwarded act", () => {
    for (const screen of [WINDOW, SHELL, PHONE])
      expect(refusedKind(() => admitSparkActor(screen, "compose.sparks.say"))).toBeUndefined();
    for (const clientKind of ["renderer", "ios", "shell-main"] as const)
      expect(
        refusedKind(() => admitSparkActor(PEER({ clientKind, deviceId: "dev-a" }), "needs.answer")),
        clientKind,
      ).toBeUndefined();
    // a daemon acting for itself, or for another daemon, carries no person's act
    expect(refusedKind(() => admitSparkActor(PEER(), "compose.sparks.open"))).toBe(
      "FORBIDDEN_SCOPE",
    );
    expect(
      refusedKind(() =>
        admitSparkActor(
          PEER({ clientKind: "peer-fieldd", deviceId: "dev-c" }),
          "compose.sparks.say",
        ),
      ),
    ).toBe("FORBIDDEN_SCOPE");
    for (const [who, stranger] of STRANGERS)
      expect(
        refusedKind(() => admitSparkActor(stranger, "compose.sparks.say")),
        who,
      ).toBe("FORBIDDEN_SCOPE");
  });
});

describe("the home's merge of every self desktop (PC-L2, PC-L4)", () => {
  type Row = { id: string; device?: string | undefined };
  const rows = (value: unknown) => {
    const list = (value as { rows?: unknown } | null)?.rows;
    return Array.isArray(list)
      ? list.map((row) =>
          typeof (row as Row).id === "string" ? ({ id: (row as Row).id } as Row) : undefined,
        )
      : undefined;
  };
  const ask = (answers: Record<string, Awaited<ReturnType<DesktopAsk["ask"]>>>): DesktopAsk => ({
    self: "dev-a",
    peers: () => Object.keys(answers),
    ask: async (device) => answers[device]!,
  });

  it("stamps every row with the desktop the home asked, and says how each desktop answered", async () => {
    const merged = await mergeAtHome<Row>({
      own: [{ id: "mine" }],
      method: "compose.sparks.list",
      ask: ask({
        "dev-b": {
          answered: true,
          // a peer names a desktop of its own choosing: the home stamps the one it asked
          value: { rows: [{ id: "b1", device: "dev-z" }, { nope: true }, { id: "b2" }] },
        },
        "dev-c": { answered: false, source: { device: "dev-c", state: "asleep" } },
        "dev-d": { answered: false, source: { device: "dev-d", state: "timeout" } },
        "dev-e": { answered: false, source: { device: "dev-e", state: "incompatible" } },
        "dev-f": { answered: false, source: { device: "dev-f", state: "building" } },
        "dev-g": { answered: true, value: { nothing: "here" } },
      }),
      rows,
    });
    expect(merged.rows).toEqual([
      { id: "mine", device: "dev-a" },
      { id: "b1", device: "dev-b" },
      { id: "b2", device: "dev-b" },
    ]);
    expect(merged.desktops).toEqual([
      { device: "dev-a", state: "answered" },
      { device: "dev-b", state: "answered" },
      { device: "dev-c", state: "asleep" },
      { device: "dev-d", state: "timeout" },
      { device: "dev-e", state: "incompatible" },
      { device: "dev-f", state: "unreachable" },
      { device: "dev-g", state: "incompatible" },
    ]);
  });

  it("never asks itself, and answers alone when it knows no peer", async () => {
    const asked: string[] = [];
    const merged = await mergeAtHome<Row>({
      own: [],
      method: "needs.list",
      ask: {
        self: "dev-a",
        peers: () => ["dev-a"],
        ask: async (device) => {
          asked.push(device);
          return { answered: true, value: { rows: [] } };
        },
      },
      rows,
    });
    expect(asked).toEqual([]);
    expect(merged).toEqual({ rows: [], desktops: [{ device: "dev-a", state: "answered" }] });
  });
});

function queues(receipts: DeliveryReceipt[] = []) {
  const root = mkdtempSync(join(tmpdir(), "vf-say-"));
  dirs.push(root);
  const idle = new Set<string>();
  const delivered: string[] = [];
  const said: SayReceipts[] = [];
  const inputs = new AgentInputQueues({
    dir: join(root, "inputs"),
    keyPath: join(root, "inputs.key"),
    deliver: async (_run, text) => {
      delivered.push(text);
      return receipts.shift() ?? { status: "confirmed" };
    },
    isIdle: (run) => idle.has(run),
    onOutcome: (_run, input, outcome) => said[0]?.heard(input, outcome),
  });
  const receiptsOf = new SayReceipts(inputs);
  said.push(receiptsOf);
  return { inputs, receipts: receiptsOf, idle, delivered, root };
}

describe("your words to a spark (PC-D3 A, CP2-D2)", () => {
  const VELA = "sp-vela00000000";
  const KIWI = "sp-kiwi00000000";

  it("land unmarked, as yours, and keep the say's request id", () => {
    const { inputs } = queues();
    const { id, position } = inputs.enqueue("run-1", "Push it", { kind: "you" }, "say-01JC4M8Q2V");
    expect(position).toBe(1);
    const [kept] = inputs.pending("run-1");
    expect(kept).toMatchObject({ id, from: { kind: "you" }, requestId: "say-01JC4M8Q2V" });
    expect(markedText(kept!)).toBe("Push it");
    expect(inputs.findRequest("say-01JC4M8Q2V")).toMatchObject({
      runtimeRunId: "run-1",
      position: 1,
    });
    expect(inputs.findRequest("say-elsewhere1")).toBeUndefined();
  });

  it("answer a receipt by request id: queued with its place, waiting when turned away, then how it ended", async () => {
    const { inputs, receipts, idle } = queues([{ status: "rejected", reason: "a dialog" }]);
    const { id } = inputs.enqueue("run-1", "Push it", { kind: "you" }, "say-01JC4M8Q2V");
    receipts.queued("say-01JC4M8Q2V", VELA, "run-1", id);
    expect(receipts.receipt(VELA, "say-01JC4M8Q2V")).toEqual({ state: "queued", position: 1 });
    idle.add("run-1");
    await inputs.poke("run-1");
    expect(receipts.receipt(VELA, "say-01JC4M8Q2V")).toEqual({ state: "waiting", position: 1 });
    await inputs.poke("run-1");
    expect(receipts.receipt(VELA, "say-01JC4M8Q2V")).toEqual({ state: "delivered" });
    // never queued here: no receipt
    expect(receipts.receipt(VELA, "say-neverseen1")).toBeUndefined();
    // a request id is one send's: another spark's say with it is refused
    expect(refusedKind(() => receipts.receipt(KIWI, "say-01JC4M8Q2V"))).toBe("PRECONDITION_FAILED");
  });

  it("say uncertain and dropped as they are, and a send its session forgot as dropped", async () => {
    const { inputs, receipts, idle } = queues([{ status: "uncertain" }]);
    const first = inputs.enqueue("run-1", "one", { kind: "you" }, "say-uncertain1");
    receipts.queued("say-uncertain1", VELA, "run-1", first.id);
    idle.add("run-1");
    await inputs.poke("run-1");
    expect(receipts.receipt(VELA, "say-uncertain1")).toEqual({ state: "uncertain" });
    const second = inputs.enqueue("run-2", "two", { kind: "you" }, "say-dropped001");
    receipts.queued("say-dropped001", VELA, "run-2", second.id);
    inputs.forget("run-2");
    expect(receipts.receipt(VELA, "say-dropped001")).toEqual({ state: "dropped" });
  });

  it("find a send still waiting after a restart, by the request id its kept input carries", () => {
    const { inputs, root } = queues();
    inputs.enqueue("run-1", "Push it", { kind: "you" }, "say-restart001");
    const again = new AgentInputQueues({
      dir: join(root, "inputs"),
      keyPath: join(root, "inputs.key"),
      deliver: async () => ({ status: "confirmed" }),
      isIdle: () => false,
    });
    expect(again.restore()).toBe(1);
    expect(new SayReceipts(again).receipt(VELA, "say-restart001")).toEqual({
      state: "queued",
      position: 1,
    });
  });

  it("keep the newest receipts only", () => {
    const { inputs, receipts } = queues();
    for (let i = 0; i <= SAY_RECEIPTS_KEPT; i++) {
      const requestId = `say-${String(i).padStart(8, "0")}`;
      const { id } = inputs.enqueue("run-1", `n${i}`, { kind: "you" }, requestId);
      receipts.queued(requestId, VELA, "run-1", id);
    }
    // the oldest is no longer kept here, but its input still waits in the queue, so it is found there
    expect(receipts.receipt(VELA, "say-00000000")).toEqual({ state: "queued", position: 1 });
  });
});

describe("item 158 — a say a restart broke into answers its retry uncertain, never queued again", () => {
  const VELA = "sp-vela00000000";
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Two fieldds on one root: the first killed with `kill`'s say in flight (its delivery never answers), the second
   * restored over the same files, its receipts hearing its queue's outcomes as the daemon wires them. */
  async function restarted(kill: { run: string; requestId: string } | undefined, waiting = false) {
    const root = mkdtempSync(join(tmpdir(), "vf-say-158-"));
    dirs.push(root);
    const paths = { dir: join(root, "inputs"), keyPath: join(root, "inputs.key") };
    const killed = new AgentInputQueues({
      ...paths,
      deliver: () => new Promise<DeliveryReceipt>(() => undefined),
      isIdle: () => !waiting,
    });
    if (kill !== undefined) killed.enqueue(kill.run, "Push it", { kind: "you" }, kill.requestId);
    await flush();
    const delivered: string[] = [];
    const idle = new Set<string>();
    const heard: { receipts?: SayReceipts } = {};
    const inputs = new AgentInputQueues({
      ...paths,
      deliver: async (_run, text) => {
        delivered.push(text);
        return { status: "confirmed" };
      },
      isIdle: (run) => idle.has(run),
      onOutcome: (_run, input, outcome) => heard.receipts?.heard(input, outcome),
    });
    const receipts = new SayReceipts(inputs);
    heard.receipts = receipts;
    const restored = inputs.restore();
    return { inputs, receipts, delivered, idle, restored };
  }

  it("S1 · before its head is said, the retry of a say whose kept input is a stamped head answers uncertain, never queued", async () => {
    const h = await restarted({ run: "run-1", requestId: "say-broken0001" });
    // the stamped head is no input waiting
    expect(h.restored).toBe(0);
    // the say door answers a kept receipt and queues nothing (daemon.ts, compose.sparks.say)
    expect(h.receipts.receipt(VELA, "say-broken0001")).toEqual({ state: "uncertain" });
    expect(h.inputs.pending("run-1")).toHaveLength(1);
    expect(h.delivered).toEqual([]);
  });

  it("S2 · after its head is said at its run's first monitor row, the retry still answers uncertain, and nothing was sent", async () => {
    const h = await restarted({ run: "run-1", requestId: "say-broken0002" });
    h.idle.add("run-1");
    await h.inputs.poke("run-1");
    expect(h.inputs.pending("run-1")).toEqual([]);
    expect(h.receipts.receipt(VELA, "say-broken0002")).toEqual({ state: "uncertain" });
    expect(h.delivered).toEqual([]);
  });

  it("S3 · heard() keeps a restored say's outcome by its own request id when this boot never queued it", async () => {
    // the first fieldd kept the say waiting (its session was busy) and stopped; the next one delivers it
    const h = await restarted({ run: "run-1", requestId: "say-waited0001" }, true);
    expect(h.restored).toBe(1);
    h.idle.add("run-1");
    await h.inputs.poke("run-1");
    expect(h.delivered).toEqual(["Push it"]);
    // a retry reads its receipt, never queues the words a second time
    expect(h.receipts.receipt(VELA, "say-waited0001")).toEqual({ state: "delivered" });
  });
});
