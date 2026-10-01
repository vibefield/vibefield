// DS-5 (§1.2 defect 2) — an open window is PUSHED what a peer merged. Real
// DocumentService, real DocLane on a loopback socket, a raw lane client; the
// window is a Loro renderer that, like strata, refuses any pending import.
//   · a push-capable window gets DOC_PUSH frames it applies with nothing pending;
//   · its echo (ICE re-journals applied remote updates) is absorbed AND proves
//     what it holds, so the next push is exported from there;
//   · a window that did not declare `push`, or has proven nothing, gets none.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOC_SYNC_RECORD,
  decodeJsonPayload,
  decodeLaneFrame,
  encodeJsonFrame,
  encodeLaneFrame,
  LANE_FRAME,
  type LaneFrame,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { DocLane } from "../src/doc-lane";
import { DocumentService } from "../src/doc-service";
import { liftIce1 } from "../src/ice1-envelope";
import { Renderer } from "./loro-renderer";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

class Probe {
  readonly frames: LaneFrame[] = [];
  #waiters: Array<() => void> = [];
  constructor(readonly ws: WebSocket) {
    ws.on("message", (data: Buffer) => {
      this.frames.push(decodeLaneFrame(new Uint8Array(data)));
      for (const w of this.#waiters.splice(0)) w();
    });
  }
  send(frame: Uint8Array): void {
    this.ws.send(frame);
  }
  async until(pred: (frames: LaneFrame[]) => boolean, label: string, ms = 3_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!pred(this.frames)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await new Promise<void>((resolve) => {
        this.#waiters.push(resolve);
        setTimeout(resolve, 20);
      });
    }
  }
  pushes(): Uint8Array[] {
    return this.frames.filter((f) => f.kind === LANE_FRAME.DOC_PUSH).map((f) => f.payload);
  }
}

async function stack(): Promise<{ docs: DocumentService; port: number }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-push-"));
  const docs = new DocumentService({ dataDir });
  const lane = new DocLane({ dataPort: 0, docs });
  const port = await lane.listen();
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  cleanup.push(() => lane.close());
  return { docs, port };
}

async function attach(
  port: number,
  docs: DocumentService,
  docId: string,
  hello: Record<string, unknown> = { accepts: ["push"] },
): Promise<Probe> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const probe = new Probe(ws);
  const { ticket } = docs.open(docId);
  probe.send(encodeJsonFrame(LANE_FRAME.HELLO, 0, { ticket, ...hello }));
  await probe.until((f) => f.some((x) => x.kind === LANE_FRAME.HELLO_OK), "HELLO_OK");
  return probe;
}

/** GET, and open the window from what came back — as the renderer does. */
async function open(probe: Probe, peer: bigint): Promise<Renderer> {
  const before = probe.frames.length;
  probe.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
  await probe.until((f) => f.slice(before).some((x) => x.kind === LANE_FRAME.DOC), "DOC");
  await new Promise((r) => setTimeout(r, 30)); // the journal frames trail the DOC frame
  const got = probe.frames.slice(before);
  const doc = got.find((f) => f.kind === LANE_FRAME.DOC);
  const lifted = liftIce1(doc?.payload ?? new Uint8Array());
  if (!lifted.ok) throw new Error("GET returned no envelope");
  const window = new Renderer(peer);
  window.apply(lifted.payload);
  for (const update of got.filter((f) => f.kind === LANE_FRAME.DOC_UPDATE)) {
    window.apply(update.payload);
  }
  return window;
}

/** GET, read EXACTLY as fieldd-client reads it (`doGetSnapshot`): the DOC frame
 * and then as many DOC_UPDATE frames as HELLO_OK's `journalEntries` counted —
 * the client's `initialUpdateCount`. A DOC_UPDATE beyond the count has no
 * reply waiter on the client and is dropped there; it is dropped here too. */
async function openAsClient(
  probe: Probe,
  peer: bigint,
): Promise<{ window: Renderer; served: number; counted: number }> {
  const hello = decodeJsonPayload(
    probe.frames.find((f) => f.kind === LANE_FRAME.HELLO_OK)?.payload ?? new Uint8Array(),
  ) as { meta?: { journalEntries?: number } };
  const counted = hello.meta?.journalEntries ?? 0;
  const before = probe.frames.length;
  probe.send(encodeLaneFrame(LANE_FRAME.GET, 0, new Uint8Array()));
  await probe.until((f) => f.slice(before).some((x) => x.kind === LANE_FRAME.DOC), "DOC");
  await probe.until(
    (f) => f.slice(before).filter((x) => x.kind === LANE_FRAME.DOC_UPDATE).length >= counted,
    "the counted journal",
  );
  await new Promise((r) => setTimeout(r, 50)); // anything trailing the counted frames
  const got = probe.frames.slice(before);
  const at = got.findIndex((f) => f.kind === LANE_FRAME.DOC);
  const lifted = liftIce1(got[at]?.payload ?? new Uint8Array());
  if (!lifted.ok) throw new Error("GET returned no envelope");
  const window = new Renderer(peer);
  window.apply(lifted.payload);
  let taken = 0;
  for (const frame of got.slice(at + 1)) {
    if (frame.kind !== LANE_FRAME.DOC_UPDATE || taken >= counted) continue;
    window.apply(frame.payload);
    taken += 1;
  }
  const served = got.filter((f) => f.kind === LANE_FRAME.DOC_UPDATE).length;
  return { window, served, counted };
}

async function putUpdate(probe: Probe, docs: DocumentService, docId: string, bytes: Uint8Array) {
  const before = probe.frames.length;
  probe.send(
    encodeJsonFrame(LANE_FRAME.PUT_META, 0, {
      revisionId: randomUUID(),
      kind: "update",
      baseRevisionId: (await docs.readDocMeta(docId))?.revisionId,
      engineSchema: 2,
      savedAt: Date.now(),
      byteLength: bytes.byteLength,
    }),
  );
  probe.send(encodeLaneFrame(LANE_FRAME.PUT, 0, bytes));
  await probe.until(
    (f) => f.slice(before).some((x) => x.kind === LANE_FRAME.PUT_OK || x.kind === LANE_FRAME.ERR),
    "PUT reply",
  );
}

/** A canvas held on this desktop, and a peer desktop bootstrapped from it. */
async function seeded(docs: DocumentService): Promise<{ docId: string; peer: Renderer }> {
  const { docId } = await docs.create("board");
  const base = new Renderer(1n);
  base.edit("base", "here");
  await docs.writeDoc(docId, base.checkpoint(), {
    revisionId: randomUUID(),
    kind: "checkpoint",
    engineSchema: 2,
    savedAt: 1,
    byteLength: base.checkpoint().byteLength,
  });
  const peer = new Renderer(7n);
  peer.apply(base.doc.export({ mode: "snapshot" }));
  return { docId, peer };
}

const META = { baseEpoch: 0, engineSchema: 2, savedAt: 1 };

describe("DS-5 — the open window is pushed what a peer merged", () => {
  it("THE WITNESS: a peer's edit reaches the open window, applies with nothing pending, and its echo is absorbed", async () => {
    const { docs, port } = await stack();
    const { docId, peer } = await seeded(docs);
    const probe = await attach(port, docs, docId);
    const helloOk = decodeJsonPayload(
      probe.frames.find((f) => f.kind === LANE_FRAME.HELLO_OK)?.payload ?? new Uint8Array(),
    ) as { pushes?: boolean };
    expect(helloOk.pushes).toBe(true);
    const window = await open(probe, 2n);

    await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: peer.edit("fromPeer", "one"),
    });
    await probe.until((f) => f.some((x) => x.kind === LANE_FRAME.DOC_PUSH), "the first push");
    const [first] = probe.pushes();
    window.apply(first as Uint8Array); // throws on a pending import, as strata would
    expect(window.board()).toEqual({ base: "here", fromPeer: "one" });

    // ICE's autosave journals the applied remote update as the window's own
    // append: absorbed (no journal growth) — and proof of what it now holds.
    const journal = (await docs.readDoc(docId))?.updates.length;
    await putUpdate(probe, docs, docId, first as Uint8Array);
    expect((await docs.readDoc(docId))?.updates.length).toBe(journal);

    await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: peer.edit("fromPeer2", "two"),
    });
    await probe.until(
      (f) => f.filter((x) => x.kind === LANE_FRAME.DOC_PUSH).length === 2,
      "push 2",
    );
    const second = probe.pushes()[1] as Uint8Array;
    window.apply(second);
    expect(window.board()).toEqual({ base: "here", fromPeer: "one", fromPeer2: "two" });
    // Exported from the PROVEN version: the first edit is not sent again.
    const lone = new Renderer(9n);
    expect(() => lone.apply(second)).toThrow(/pending/);
  });

  it("DS-5c — a peer merge between HELLO_OK and GET: GET serves what HELLO_OK counted, and no push omits a record", async () => {
    // The review's HELLO/GET race: the proof was the host's version AT GET while
    // the client reads only HELLO_OK's journal count, so a merge landing between
    // the two frames was proven and never read — the next push omitted it and a
    // strata store quarantined on the pending import, until reopen.
    const { docs, port } = await stack();
    const { docId, peer } = await seeded(docs);
    await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: peer.edit("before", "journaled"),
    });
    const probe = await attach(port, docs, docId);
    // A peer desktop's edit lands BETWEEN HELLO_OK and GET.
    await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: peer.edit("between", "the frames"),
    });
    const { window, served, counted } = await openAsClient(probe, 2n);
    // GET's journal is exactly the one HELLO_OK counted — no frame the client drops.
    expect(served).toBe(counted);
    // And a later edit's push applies with nothing pending, carrying the record
    // the window never read.
    await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: peer.edit("after", "GET"),
    });
    await probe.until(() => {
      const probeWindow = new Renderer(5n);
      probeWindow.apply(window.doc.export({ mode: "snapshot" }));
      try {
        for (const push of probe.pushes()) probeWindow.apply(push);
      } catch {
        return false;
      }
      return probeWindow.board()["after"] === "GET";
    }, "a push that reaches the latest edit");
    for (const push of probe.pushes()) window.apply(push); // throws on a pending import, as strata would
    expect(window.board()).toEqual({
      base: "here",
      before: "journaled",
      between: "the frames",
      after: "GET",
    });
  });

  it("a window that did not declare push is never pushed — a pre-DS-5 client's waiter stays its own", async () => {
    const { docs, port } = await stack();
    const { docId, peer } = await seeded(docs);
    const probe = await attach(port, docs, docId, {});
    await open(probe, 2n);
    await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: peer.edit("x", "y"),
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(probe.pushes()).toHaveLength(0);
  });

  it("a window that has proven nothing yet (no GET, no PUT) is not pushed — and is from its first PUT on", async () => {
    const { docs, port } = await stack();
    const { docId, peer } = await seeded(docs);
    const probe = await attach(port, docs, docId);
    await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: peer.edit("early", "unpushed"),
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(probe.pushes()).toHaveLength(0);
    // The window saves a checkpoint: its WHOLE version is now proven.
    const window = new Renderer(3n);
    window.apply(peer.doc.export({ mode: "snapshot" }));
    window.edit("mine", "saved");
    const checkpoint = window.checkpoint();
    const before = probe.frames.length;
    probe.send(
      encodeJsonFrame(LANE_FRAME.PUT_META, 0, {
        revisionId: randomUUID(),
        kind: "checkpoint",
        engineSchema: 2,
        savedAt: Date.now(),
        byteLength: checkpoint.byteLength,
      }),
    );
    probe.send(encodeLaneFrame(LANE_FRAME.PUT, 0, checkpoint));
    await probe.until((f) => f.slice(before).some((x) => x.kind === LANE_FRAME.PUT_OK), "PUT_OK");
    await docs.applyRemoteRecord(docId, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: META,
      payload: peer.edit("late", "pushed"),
    });
    await probe.until((f) => f.some((x) => x.kind === LANE_FRAME.DOC_PUSH), "the push after proof");
    window.apply(probe.pushes()[0] as Uint8Array);
    expect(window.board()).toMatchObject({ early: "unpushed", late: "pushed", mine: "saved" });
  });
});
