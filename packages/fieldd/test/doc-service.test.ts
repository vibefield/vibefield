// B3 DocumentService + the :9411 doc lane, against the mock mgmt server (no cargo):
// the create/list/open catalog over the product WS, the ticketed binary lane
// (garbage/replay/expiry rejection, PUT→GET round-trips, the single-writer lock,
// truncated/non-ICE1 rejection), and THE restart test — the P0 exit criterion.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DocOpenResult,
  DocRegistryEntry,
  decodeJsonPayload,
  decodeLaneFrame,
  encodeJsonFrame,
  encodeLaneFrame,
  LANE_FRAME,
  LaneErr,
  type LaneFrame,
  LaneHelloOk,
  LanePutOk,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, DocumentService, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup(): Promise<{ dataDir: string; daemon: FielddDaemon }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-doc-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return { dataDir, daemon };
}

async function productRpc(daemon: FielddDaemon, token = daemon.shellToken): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, token);
  return rpc;
}

/** Raw lane client: sends frames, logs every reply in order, exposes close. */
class LaneProbe {
  log: LaneFrame[] = [];
  closed = false;
  closeCode: number | null = null;
  private cursor = 0;
  private waiters: Array<(f: LaneFrame) => void> = [];

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      let frame: LaneFrame;
      try {
        frame = decodeLaneFrame(toU8(data));
      } catch {
        return; // structural garbage never reaches a waiter
      }
      this.log.push(frame);
      const w = this.waiters.shift();
      if (w) w(frame);
    });
    ws.on("close", (code: number) => {
      this.closed = true;
      this.closeCode = code;
    });
  }

  send(frame: Uint8Array): void {
    this.ws.send(frame);
  }

  /** Next unconsumed reply frame (FIFO), or rejects on timeout. */
  next(timeoutMs = 2000): Promise<LaneFrame> {
    if (this.cursor < this.log.length) return Promise.resolve(this.log[this.cursor++]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("lane frame timeout")), timeoutMs);
      this.waiters.push((f) => {
        clearTimeout(timer);
        this.cursor++;
        resolve(f);
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

function toU8(data: unknown): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data as Buffer[]));
  return new Uint8Array(data as ArrayBuffer);
}

async function dialLane(laneUrl: string): Promise<LaneProbe> {
  const ws = new WebSocket(laneUrl);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new LaneProbe(ws);
}

/** doc.open, retrying while a just-closed writer's lane is still detaching. */
async function openDoc(rpc: WsRpc, docId: string): Promise<DocOpenResult> {
  for (let i = 0; i < 40; i++) {
    try {
      return (await rpc.call("doc.open", { docId })) as DocOpenResult;
    } catch (e) {
      if ((e as { rpc?: { data?: { kind?: string } } }).rpc?.data?.kind === "PRECONDITION_FAILED") {
        await sleep(25);
        continue;
      }
      throw e;
    }
  }
  throw new Error("doc.open never cleared the single-writer lock");
}

/** Open + dial + HELLO; asserts HELLO_OK and returns the parsed ack. */
async function attach(rpc: WsRpc, docId: string): Promise<{ probe: LaneProbe; ok: LaneHelloOk }> {
  const open = await openDoc(rpc, docId);
  const probe = await dialLane(open.laneUrl);
  probe.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: open.ticket }));
  const reply = await probe.next();
  expect(reply.kind).toBe(LANE_FRAME.HELLO_OK);
  return { probe, ok: LaneHelloOk.parse(decodeJsonPayload(reply.payload)) };
}

/** Synthetic ICE1 envelope: the "ICE1" magic + n random bytes fieldd never decodes. */
function ice1Envelope(n = 320): Uint8Array {
  const env = new Uint8Array(4 + n);
  env.set([0x49, 0x43, 0x45, 0x31], 0);
  env.set(randomBytes(n), 4);
  return env;
}

async function putEnvelope(
  probe: LaneProbe,
  env: Uint8Array,
  engineSchema = 7,
): Promise<LanePutOk> {
  probe.send(
    encodeJsonFrame(LANE_FRAME.PUT_META, 0, {
      engineSchema,
      savedAt: Date.now(),
      byteLength: env.byteLength,
    }),
  );
  probe.send(encodeLaneFrame(LANE_FRAME.PUT, 0, env));
  const reply = await probe.next();
  expect(reply.kind).toBe(LANE_FRAME.PUT_OK);
  return LanePutOk.parse(decodeJsonPayload(reply.payload));
}

describe("doc.* catalog (product WS)", () => {
  it("create → list → open returns a valid entry, ticket, and the real bound laneUrl", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);

    const created = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    const parsed = DocRegistryEntry.safeParse(created);
    expect(parsed.success).toBe(true);
    expect(created.name).toBe("Board");
    expect(created.baseEpoch).toBe(0);
    expect(created.engineSchema).toBeNull();
    expect(created.sizeBytes).toBe(0);
    expect(Number.isInteger(created.updatedAt)).toBe(true);

    const listed = (await rpc.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    expect(listed.docs.map((d) => d.docId)).toContain(created.docId);

    const open = (await rpc.call("doc.open", { docId: created.docId })) as DocOpenResult;
    expect(open.docId).toBe(created.docId);
    expect(open.laneUrl).toBe(`ws://127.0.0.1:${daemon.dataPort}`);
    expect(typeof open.ticket).toBe("string");
    expect(open.ticket.length).toBeGreaterThan(20);
    expect(open.hasDoc).toBe(false);
  });

  it("health carries a docs row that tracks docCount", async () => {
    const { daemon } = await setup();
    expect(daemon.health().docs).toEqual({ state: "ready", docCount: 0 });
    const rpc = await productRpc(daemon);
    await rpc.call("doc.create", { name: "One" });
    await rpc.call("doc.create", { name: "Two" });
    expect(daemon.health().docs).toEqual({ state: "ready", docCount: 2 });
  });
});

describe("doc.* scope enforcement (EL7)", () => {
  it("doc.create needs doc.write and doc.list needs doc.read", async () => {
    const { daemon } = await setup();

    const reader = await productRpc(daemon, daemon.tokens.mint(["doc.read"], "reader").token);
    const createDenied = await reader.callErr("doc.create", { name: "nope" });
    expect(createDenied.data?.kind).toBe("FORBIDDEN_SCOPE");

    const writer = await productRpc(daemon, daemon.tokens.mint(["doc.write"], "writer").token);
    const listDenied = await writer.callErr("doc.list", {});
    expect(listDenied.data?.kind).toBe("FORBIDDEN_SCOPE");
    // …but the writer can create + open (positive control for the scope gate)
    const made = (await writer.call("doc.create", { name: "ok" })) as DocRegistryEntry;
    expect((await writer.call("doc.open", { docId: made.docId })) as DocOpenResult).toBeTruthy();
  });
});

describe("lane ticket security", () => {
  it("a garbage ticket HELLO is dropped without a HELLO_OK", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    const open = (await rpc.call("doc.open", { docId: made.docId })) as DocOpenResult;

    const probe = await dialLane(open.laneUrl);
    probe.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: "not-a-real-ticket" }));
    await until(() => probe.closed);
    expect(probe.log.some((f) => f.kind === LANE_FRAME.HELLO_OK)).toBe(false);
  });

  it("a ticket is one-shot — a second socket with the same ticket is dropped", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    const open = (await rpc.call("doc.open", { docId: made.docId })) as DocOpenResult;

    const a = await dialLane(open.laneUrl);
    a.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: open.ticket }));
    expect((await a.next()).kind).toBe(LANE_FRAME.HELLO_OK);

    const b = await dialLane(open.laneUrl);
    b.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: open.ticket }));
    await until(() => b.closed);
    expect(b.log.some((f) => f.kind === LANE_FRAME.HELLO_OK)).toBe(false);
  });

  it("a busy writer's second ticket is refused with LaneErr PRECONDITION_FAILED", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    // two live tickets minted before either redeems (no writer yet)
    const open1 = (await rpc.call("doc.open", { docId: made.docId })) as DocOpenResult;
    const open2 = (await rpc.call("doc.open", { docId: made.docId })) as DocOpenResult;

    const a = await dialLane(open1.laneUrl);
    a.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: open1.ticket }));
    expect((await a.next()).kind).toBe(LANE_FRAME.HELLO_OK);

    const b = await dialLane(open2.laneUrl);
    b.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket: open2.ticket }));
    const reply = await b.next();
    expect(reply.kind).toBe(LANE_FRAME.ERR);
    expect(LaneErr.parse(decodeJsonPayload(reply.payload)).kind).toBe("PRECONDITION_FAILED");
    await until(() => b.closed);
  });

  it("expired and replayed tickets fail at the service (injected clock)", () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-doc-unit-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    let clock = 1_000_000;
    const svc = new DocumentService({ dataDir: dir, now: () => clock, ticketTtlMs: 30_000 });
    cleanup.push(() => svc.dispose());
    const doc = await svc.create("Unit");

    const expiring = svc.open(doc.docId).ticket;
    clock += 30_001; // past TTL
    expect(svc.redeemTicket(expiring)).toEqual({ ok: false, reason: "invalid" });

    const fresh = svc.open(doc.docId).ticket;
    expect(svc.redeemTicket(fresh)).toEqual({ ok: true, docId: doc.docId });
    expect(svc.redeemTicket(fresh)).toEqual({ ok: false, reason: "invalid" }); // one-shot
    expect(svc.redeemTicket("garbage")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("lane PUT / GET", () => {
  it("PUT then GET on a fresh lane returns byte-identical bytes; registry updates", async () => {
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const env = ice1Envelope();
    const w = await attach(rpc, made.docId);
    expect(w.ok.hasDoc).toBe(false);
    const putOk = await putEnvelope(w.probe, env, 11);
    expect(putOk.byteLength).toBe(env.byteLength);
    w.probe.close();

    // a genuinely fresh lane (writer detached) sees hasDoc + returns the bytes
    const r = await attach(rpc, made.docId);
    expect(r.ok.hasDoc).toBe(true);
    r.probe.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
    const doc = await r.probe.next();
    expect(doc.kind).toBe(LANE_FRAME.DOC);
    expect(Buffer.from(doc.payload).equals(Buffer.from(env))).toBe(true);

    const listed = (await rpc.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    const entry = listed.docs.find((d) => d.docId === made.docId)!;
    expect(entry.sizeBytes).toBe(env.byteLength);
    expect(entry.engineSchema).toBe(11);
    expect(entry.updatedAt).toBeGreaterThanOrEqual(made.updatedAt);

    const currentPath = join(dataDir, "docs", made.docId, "current.json");
    const current = JSON.parse(readFileSync(currentPath, "utf8")) as {
      revisionId: string;
      file: string;
      byteLength: number;
    };
    expect(current.file).toBe(`${current.revisionId}.ice1`);
    expect(current.byteLength).toBe(env.byteLength);
    expect(existsSync(join(dataDir, "docs", made.docId, "revisions", current.file))).toBe(true);
  });

  it("RESTART: put → stop → re-bootstrap same dataDir → list + GET survive", async () => {
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    const env = ice1Envelope(512);
    const w = await attach(rpc, made.docId);
    await putEnvelope(w.probe, env);
    w.probe.close();

    await daemon.stop();

    const daemon2 = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon2.stop());
    const rpc2 = await productRpc(daemon2);

    const listed = (await rpc2.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    const survivor = listed.docs.find((d) => d.docId === made.docId);
    expect(survivor).toBeTruthy();
    expect(survivor!.sizeBytes).toBe(env.byteLength);

    const r = await attach(rpc2, made.docId);
    expect(r.ok.hasDoc).toBe(true);
    r.probe.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
    const doc = await r.probe.next();
    expect(doc.kind).toBe(LANE_FRAME.DOC);
    expect(Buffer.from(doc.payload).equals(Buffer.from(env))).toBe(true);
  });
});

describe("lane single-writer lock", () => {
  it("doc.open is refused while a writer holds the lane, then succeeds after it closes", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const held = await attach(rpc, made.docId);
    const denied = await rpc.callErr("doc.open", { docId: made.docId });
    expect(denied.data?.kind).toBe("PRECONDITION_FAILED");

    held.probe.close();
    // after the writer detaches, a fresh open is admitted again
    const reopened = await openDoc(rpc, made.docId);
    expect(reopened.docId).toBe(made.docId);
  });
});

describe("lane write validation (leaves prior bytes untouched)", () => {
  it("a byteLength-mismatched PUT is rejected and the prior snapshot is intact", async () => {
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const good = ice1Envelope(256);
    const w = await attach(rpc, made.docId);
    await putEnvelope(w.probe, good);

    // PUT_META claims one length; the PUT body is a different length → rejected
    w.probe.send(
      encodeJsonFrame(LANE_FRAME.PUT_META, 0, {
        engineSchema: 1,
        savedAt: Date.now(),
        byteLength: good.byteLength,
      }),
    );
    w.probe.send(encodeLaneFrame(LANE_FRAME.PUT, 0, ice1Envelope(64)));
    const err = await w.probe.next();
    expect(err.kind).toBe(LANE_FRAME.ERR);
    expect(LaneErr.parse(decodeJsonPayload(err.payload)).kind).toBe("PRECONDITION_FAILED");

    // GET still returns the earlier good bytes; no tmp debris was left behind
    w.probe.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
    const doc = await w.probe.next();
    expect(doc.kind).toBe(LANE_FRAME.DOC);
    expect(Buffer.from(doc.payload).equals(Buffer.from(good))).toBe(true);

    const debris = readdirSync(join(dataDir, "docs", made.docId)).filter((n) =>
      n.startsWith("snapshot.ice1.tmp"),
    );
    expect(debris).toEqual([]);
  });

  it("a payload without the ICE1 magic is rejected and nothing is persisted", async () => {
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const notIce1 = new Uint8Array(128); // all zeros, byteLength matches the meta
    const w = await attach(rpc, made.docId);
    w.probe.send(
      encodeJsonFrame(LANE_FRAME.PUT_META, 0, {
        engineSchema: null,
        savedAt: Date.now(),
        byteLength: notIce1.byteLength,
      }),
    );
    w.probe.send(encodeLaneFrame(LANE_FRAME.PUT, 0, notIce1));
    const err = await w.probe.next();
    expect(err.kind).toBe(LANE_FRAME.ERR);
    expect(LaneErr.parse(decodeJsonPayload(err.payload)).kind).toBe("PRECONDITION_FAILED");

    w.probe.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
    const reply = await w.probe.next();
    expect(reply.kind).toBe(LANE_FRAME.ERR);
    expect(LaneErr.parse(decodeJsonPayload(reply.payload)).kind).toBe("NOT_FOUND");
    expect(existsSync(join(dataDir, "docs", made.docId, "snapshot.ice1"))).toBe(false);
    expect(await daemon.docs.readDoc(made.docId)).toBeNull();
  });
});

describe("doc.rename (product WS)", () => {
  it("renames a doc and doc.list reflects the new name", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const renamed = (await rpc.call("doc.rename", {
      docId: made.docId,
      name: "Field Notes",
    })) as DocRegistryEntry;
    expect(DocRegistryEntry.safeParse(renamed).success).toBe(true);
    expect(renamed.name).toBe("Field Notes");

    const listed = (await rpc.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    expect(listed.docs.find((d) => d.docId === made.docId)!.name).toBe("Field Notes");
  });

  it("does NOT bump updatedAt (recency is content, not the label)", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const renamed = (await rpc.call("doc.rename", {
      docId: made.docId,
      name: "Renamed",
    })) as DocRegistryEntry;
    expect(renamed.updatedAt).toBe(made.updatedAt);
  });

  it("an unknown docId is NOT_FOUND", async () => {
    const { daemon } = await setup();
    const rpc = await productRpc(daemon);
    const err = await rpc.callErr("doc.rename", { docId: randomUUID(), name: "ghost" });
    expect(err.data?.kind).toBe("NOT_FOUND");
  });

  it("a token without doc.write is FORBIDDEN_SCOPE", async () => {
    const { daemon } = await setup();
    const owner = await productRpc(daemon);
    const made = (await owner.call("doc.create", { name: "Board" })) as DocRegistryEntry;

    const reader = await productRpc(daemon, daemon.tokens.mint(["doc.read"], "reader").token);
    const denied = await reader.callErr("doc.rename", { docId: made.docId, name: "nope" });
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("RESTART: a renamed name survives stop + re-bootstrap on the same dataDir", async () => {
    const { dataDir, daemon } = await setup();
    const rpc = await productRpc(daemon);
    const made = (await rpc.call("doc.create", { name: "Board" })) as DocRegistryEntry;
    await rpc.call("doc.rename", { docId: made.docId, name: "Persisted" });

    await daemon.stop();

    const daemon2 = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon2.stop());
    const rpc2 = await productRpc(daemon2);
    const listed = (await rpc2.call("doc.list", {})) as { docs: DocRegistryEntry[] };
    expect(listed.docs.find((d) => d.docId === made.docId)?.name).toBe("Persisted");
  });
});
