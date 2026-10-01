// DS-5c (DS-D7) — "a `local` canvas is listed elsewhere as living on its
// desktop and is not openable there" (design-06 §4). The review: a `local`
// canvas ALREADY HELD elsewhere — adopted by B while it synced, then kept home
// by A — stayed openable on B, so two desktops edited two copies that no
// longer meet. The library now records the canvas's HOME (the desktop whose
// person kept it there); everywhere else it is listed, and `doc.open` answers
// `UNAVAILABLE {service: "docs", state: "held-elsewhere", device}`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentService } from "../src/doc-service";
import { LibraryDocService, systemAccount, systemDocId } from "../src/library-doc";
import { RpcCallError } from "../src/native-link";
import { Device, Mesh } from "./doc-mesh-harness";

let dirs: string[] = [];
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 60));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
vi.setConfig({ testTimeout: 15_000 });

const tmp = (tag: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `vf-away-${tag}-`));
  dirs.push(dir);
  return dir;
};

async function until(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const LIBRARY = systemDocId("library", systemAccount("james@example.com", "fuid-a"));

/** The refusal `doc.open` gives, or null when it opened. */
function openRefusal(docs: DocumentService, docId: string): RpcCallError | null {
  try {
    docs.open(docId);
    return null;
  } catch (error) {
    if (error instanceof RpcCallError) return error;
    throw error;
  }
}

/** Two desktops sharing the library over the in-process router, each knowing
 * its own roster id (`dev-A`, `dev-B`). */
async function pair(): Promise<{ a: Device; b: Device }> {
  const mesh = new Mesh();
  const made: Device[] = [];
  for (const name of ["A", "B"]) {
    const dataDir = tmp(name);
    const device = new Device(name, mesh, dataDir, {}, { selfDevice: () => `dev-${name}` });
    const library = new LibraryDocService({ dataDir, docId: LIBRARY });
    await library.ready();
    device.docs.registerSystemDoc(LIBRARY, "Library", library.doc, library.hostOwner());
    device.docs.onCatalogChanged((change) => {
      if (change.adopted.length > 0) device.sync.replicate(change.adopted, { regreet: true });
    });
    await device.docs.attachLibrary(library);
    mesh.devices.set(name, device);
    made.push(device);
  }
  const [a, b] = made as [Device, Device];
  await a.sync.start();
  await b.sync.start();
  return { a, b };
}

describe("DS-5c (DS-D7) — a local canvas held elsewhere is listed, not openable there", () => {
  it("adopted by B while it synced, then kept home by A: listed on B as living on A, refused by doc.open", async () => {
    const { a, b } = await pair();
    const { docId } = await a.docs.create("Studio board");
    await until(() => b.docs.list().some((e) => e.docId === docId), "B to adopt the canvas");
    expect(openRefusal(b.docs, docId)).toBeNull(); // the CONTROL: while it syncs, B opens it

    await a.docs.setSyncIntent(docId, "local"); // A's person keeps it on A
    await until(
      () => !b.docs.list().some((e) => e.docId === docId),
      "the canvas to leave B's list",
    );
    expect(b.docs.elsewhere()).toEqual([{ docId, name: "Studio board", homes: ["dev-A"] }]);
    const refusal = openRefusal(b.docs, docId);
    expect(refusal?.kind).toBe("UNAVAILABLE");
    expect(refusal?.details).toEqual({ service: "docs", state: "held-elsewhere", device: "dev-A" });
    // Its home opens it.
    expect(openRefusal(a.docs, docId)).toBeNull();
    expect(a.docs.elsewhere()).toEqual([]);

    await a.docs.setSyncIntent(docId, "sync"); // and travels again
    await until(() => b.docs.list().some((e) => e.docId === docId), "the canvas back on B");
    expect(openRefusal(b.docs, docId)).toBeNull();
  });

  it("a library canvas this desktop never held answers held-elsewhere, not NOT_FOUND", async () => {
    const dataDir = tmp("solo");
    const docs = new DocumentService({ dataDir, selfDevice: () => "dev-B" });
    const library = new LibraryDocService({ dataDir, docId: LIBRARY });
    await docs.attachLibrary(library);
    const peer = new LibraryDocService({ dataDir: tmp("peer"), docId: LIBRARY });
    const docId = "0b7e8a52-39c4-4b8e-8f3a-6d2e1c9a7b10";
    await peer.upsert(
      { docId, name: "Only on A", createdAt: 2, engineSchema: null, baseEpoch: 0 },
      "peer",
    );
    await peer.setSyncIntent(docId, "local", "peer", "dev-A");
    library.doc.import(peer.doc.export({ mode: "snapshot" }));
    library.hostOwner().merged?.();
    await until(() => docs.elsewhere().length === 1, "the canvas to be listed elsewhere");
    const refusal = openRefusal(docs, docId);
    expect(refusal?.kind).toBe("UNAVAILABLE");
    expect(refusal?.details).toEqual({ service: "docs", state: "held-elsewhere", device: "dev-A" });
    // An id the library never held is still simply not found.
    expect(openRefusal(docs, "6f1c2b0e-7c1a-4f0e-9d0b-2b8f5a1c3d4e")?.kind).toBe("NOT_FOUND");
    docs.dispose();
  });
});
