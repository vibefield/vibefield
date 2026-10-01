// DS-5 (DS-D6) — the library and the system documents on the Loro-level host.
//   · a user-scope system document under a well-known id derived from the
//     ACCOUNT, merging per field so concurrent edits never lose one another;
//   · the catalog derived from it: seeded, adopted, renamed, tombstoned;
//   · two desktops (the shared in-process router): a canvas created on A
//     EXISTS on B, then OPENS on B; a rename, an intent and a delete converge;
//     the settings document merges across and its undo stays local.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DocLibraryEntry, DocRegistryEntry } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentService } from "../src/doc-service";
import { LibraryDocService, systemAccount, systemDocId } from "../src/library-doc";
import { SettingsDocService } from "../src/settings-doc";
import { Device, Mesh } from "./doc-mesh-harness";
import { Renderer, replay } from "./loro-renderer";

let dirs: string[] = [];
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 60));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
vi.setConfig({ testTimeout: 15_000 });

const tmp = (tag: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `vf-lib-${tag}-`));
  dirs.push(dir);
  return dir;
};

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const ACCOUNT = systemAccount("james@example.com", "fuid-a");

describe("system document ids", () => {
  it("derive from the account: stable, account-scoped, kind-scoped, uuid-shaped", () => {
    expect(systemDocId("library", ACCOUNT)).toBe(systemDocId("library", ACCOUNT));
    expect(systemDocId("library", ACCOUNT)).not.toBe(systemDocId("settings", ACCOUNT));
    expect(systemDocId("library", ACCOUNT)).not.toBe(
      systemDocId("library", systemAccount("someone@else.org", "fuid-a")),
    );
    // Two desktops of one login share it; an unlinked root has its own.
    expect(systemAccount("james@example.com", "fuid-b")).toBe(ACCOUNT);
    expect(systemAccount(null, "fuid-a")).toBe("local:fuid-a");
    const id = systemDocId("library", ACCOUNT);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(
      DocRegistryEntry.safeParse({
        docId: id,
        name: "x",
        updatedAt: 0,
        baseEpoch: 0,
        engineSchema: null,
        sizeBytes: 0,
      }).success,
    ).toBe(true);
  });
});

describe("the library document", () => {
  const row = (docId: string, name: string): DocLibraryEntry => ({
    docId,
    name,
    createdAt: 1_790_000_000_000,
    engineSchema: null,
    baseEpoch: 0,
  });
  const DOC = "6f1c2b0e-7c1a-4f0e-9d0b-2b8f5a1c3d4e";

  it("persists every write and reads it back on the next boot", async () => {
    const dataDir = tmp("persist");
    const id = systemDocId("library", ACCOUNT);
    const first = new LibraryDocService({ dataDir, docId: id });
    await first.upsert(row(DOC, "Studio board"), "test");
    await first.setSyncIntent(DOC, "local", "test");
    await first.rename(DOC, "Renamed", "test");
    const second = new LibraryDocService({ dataDir, docId: id });
    await second.ready();
    expect(second.get(DOC)).toMatchObject({ name: "Renamed", syncIntent: "local" });
    await second.tombstone(DOC, 42, "test");
    expect(second.entries()[0]?.tombstone).toBe(42);
  });

  it("merges per field: a rename on one desktop and an intent on another both survive", async () => {
    const id = systemDocId("library", ACCOUNT);
    const a = new LibraryDocService({ dataDir: tmp("a"), docId: id });
    const b = new LibraryDocService({ dataDir: tmp("b"), docId: id });
    await a.upsert(row(DOC, "Board"), "test");
    b.doc.import(a.doc.export({ mode: "snapshot" }));
    // Offline, concurrently.
    await a.rename(DOC, "Board, renamed on A", "test");
    await b.setSyncIntent(DOC, "local", "test");
    a.doc.import(b.doc.export({ mode: "update", from: a.doc.oplogVersion() }));
    b.doc.import(a.doc.export({ mode: "update", from: b.doc.oplogVersion() }));
    for (const lib of [a, b]) {
      expect(lib.get(DOC)).toMatchObject({ name: "Board, renamed on A", syncIntent: "local" });
    }
  });
});

describe("the catalog derives from the library", () => {
  async function catalog(): Promise<{ docs: DocumentService; library: LibraryDocService }> {
    const dataDir = tmp("cat");
    const docs = new DocumentService({ dataDir });
    const library = new LibraryDocService({ dataDir, docId: systemDocId("library", ACCOUNT) });
    await library.ready();
    return { docs, library };
  }

  it("seeds canvases older than the library, and writes every catalog act through", async () => {
    const { docs, library } = await catalog();
    const old = await docs.create("made before the library");
    await docs.attachLibrary(library);
    expect(library.get(old.docId)?.name).toBe("made before the library");
    const made = await docs.create("made after");
    expect(library.get(made.docId)).toMatchObject({ name: "made after" });
    await docs.rename(made.docId, "renamed");
    await docs.setSyncIntent(made.docId, "local");
    expect(library.get(made.docId)).toMatchObject({ name: "renamed", syncIntent: "local" });
    const gone = await docs.delete(made.docId);
    expect(gone.deletedAt).toBeDefined();
    expect(library.get(made.docId)?.tombstone).toBe(gone.deletedAt);
    expect(docs.list().map((e) => e.docId)).toEqual([old.docId]);
    expect(() => docs.open(made.docId)).toThrow(/no such doc/);
  });

  it("adopts a sync canvas another desktop made, lists a local one elsewhere, takes renames and tombstones", async () => {
    const { docs, library } = await catalog();
    await docs.attachLibrary(library);
    docs.setHomes((docId) => (docId === "0b7e8a52-39c4-4b8e-8f3a-6d2e1c9a7b10" ? ["studio"] : []));
    const adopted: string[][] = [];
    docs.onCatalogChanged((change) => adopted.push(change.adopted));
    // Rows arriving from a peer desktop — merged into the library, then told.
    const peer = new LibraryDocService({ dataDir: tmp("peer"), docId: library.docId });
    await peer.upsert(
      {
        docId: "6f1c2b0e-7c1a-4f0e-9d0b-2b8f5a1c3d4e",
        name: "Shared",
        createdAt: 1,
        engineSchema: null,
        baseEpoch: 0,
      },
      "peer",
    );
    await peer.upsert(
      {
        docId: "0b7e8a52-39c4-4b8e-8f3a-6d2e1c9a7b10",
        name: "Studio only",
        createdAt: 2,
        engineSchema: null,
        baseEpoch: 0,
        syncIntent: "local",
      },
      "peer",
    );
    library.doc.import(peer.doc.export({ mode: "snapshot" }));
    library.hostOwner().merged?.();
    // Listeners hear of it once the derived registry is durable.
    await until(() => adopted.flat().length === 1, "the sync canvas to be adopted");
    expect(docs.list()[0]).toMatchObject({ name: "Shared", sizeBytes: 0 });
    expect(adopted.flat()).toEqual(["6f1c2b0e-7c1a-4f0e-9d0b-2b8f5a1c3d4e"]);
    expect(docs.elsewhere()).toEqual([
      { docId: "0b7e8a52-39c4-4b8e-8f3a-6d2e1c9a7b10", name: "Studio only", homes: ["studio"] },
    ]);
    // A rename and then a tombstone, from the peer.
    await peer.rename("6f1c2b0e-7c1a-4f0e-9d0b-2b8f5a1c3d4e", "Shared, renamed", "peer");
    library.doc.import(peer.doc.export({ mode: "update", from: library.doc.oplogVersion() }));
    library.hostOwner().merged?.();
    await until(() => docs.list()[0]?.name === "Shared, renamed", "the rename");
    await peer.tombstone("6f1c2b0e-7c1a-4f0e-9d0b-2b8f5a1c3d4e", 99, "peer");
    library.doc.import(peer.doc.export({ mode: "update", from: library.doc.oplogVersion() }));
    library.hostOwner().merged?.();
    await until(() => docs.list().length === 0, "the tombstone");
  });
});

describe("two desktops — the library and settings on the host", () => {
  async function pair(opts: { deferAttachOn?: "B" } = {}): Promise<{
    a: Device;
    b: Device;
    libraries: [LibraryDocService, LibraryDocService];
    settings: [SettingsDocService, SettingsDocService];
  }> {
    const mesh = new Mesh();
    const libraryId = systemDocId("library", ACCOUNT);
    const settingsId = systemDocId("settings", ACCOUNT);
    const made: Array<{
      device: Device;
      library: LibraryDocService;
      settings: SettingsDocService;
    }> = [];
    for (const name of ["A", "B"]) {
      const dataDir = tmp(name);
      const device = new Device(name, mesh, dataDir);
      const library = new LibraryDocService({ dataDir, docId: libraryId });
      await library.ready();
      const settings = new SettingsDocService({ dataDir });
      await settings.ready();
      device.docs.registerSystemDoc(libraryId, "Library", library.doc, library.hostOwner());
      // The DS-5b witness in waiting: the daemon does not register settings yet (B1).
      device.docs.registerSystemDoc(
        settingsId,
        "Settings",
        settings.hostDoc(),
        settings.hostOwner(),
      );
      // As the daemon wires it: an adopted canvas is fetched on adoption.
      device.docs.onCatalogChanged((change) => {
        if (change.adopted.length > 0) device.sync.replicate(change.adopted, { regreet: true });
      });
      if (opts.deferAttachOn !== name) await device.docs.attachLibrary(library);
      mesh.devices.set(name, device);
      made.push({ device, library, settings });
    }
    const [a, b] = made as [(typeof made)[0], (typeof made)[0]];
    await a.device.sync.start();
    await b.device.sync.start();
    return {
      a: a.device,
      b: b.device,
      libraries: [a.library, b.library],
      settings: [a.settings, b.settings],
    };
  }

  it("a canvas created on A EXISTS on B, then OPENS on B with A's content", async () => {
    const { a, b } = await pair();
    const created = await a.docs.create("Made on the laptop");
    await until(
      () => b.docs.list().some((e) => e.docId === created.docId),
      "the canvas to exist on B",
    );
    expect(b.docs.list().find((e) => e.docId === created.docId)?.name).toBe("Made on the laptop");
    const w = new Renderer(1n);
    w.edit("hello", "from A");
    await a.docs.writeDoc(created.docId, w.checkpoint(), {
      revisionId: crypto.randomUUID(),
      kind: "checkpoint",
      engineSchema: 2,
      savedAt: Date.now(),
      byteLength: w.checkpoint().byteLength,
    });
    await until(async () => {
      try {
        return (await replay(b.docs, created.docId)).board().hello === "from A";
      } catch {
        return false;
      }
    }, "A's content to open on B");
    // B's window can open it: a ticket is minted for a doc B now holds.
    expect(b.docs.open(created.docId).hasDoc).toBe(true);
  });

  it("EAGER (DS-D7): content that existed before B adopted the canvas opens on B with no new commit on A", async () => {
    const { a, b, libraries } = await pair({ deferAttachOn: "B" });
    const created = await a.docs.create("Written before B knew it");
    const w = new Renderer(1n);
    w.edit("early", "content");
    const checkpoint = w.checkpoint();
    await a.docs.writeDoc(created.docId, checkpoint, {
      revisionId: crypto.randomUUID(),
      kind: "checkpoint",
      engineSchema: 2,
      savedAt: Date.now(),
      byteLength: checkpoint.byteLength,
    });
    // B learns of the canvas only now — after its only commit on A.
    await until(() => libraries[1].get(created.docId) !== undefined, "B's library to hear of it");
    await b.docs.attachLibrary(libraries[1]);
    await until(async () => {
      try {
        return (await replay(b.docs, created.docId)).board().early === "content";
      } catch {
        return false;
      }
    }, "the content to arrive on B without another commit");
  });

  it("a rename on B, an intent on A and a delete converge across", async () => {
    const { a, b, libraries } = await pair();
    const created = await a.docs.create("Board");
    await until(() => b.docs.list().some((e) => e.docId === created.docId), "B to adopt");
    await b.docs.rename(created.docId, "Board, renamed on B");
    await until(
      () => a.docs.list().find((e) => e.docId === created.docId)?.name === "Board, renamed on B",
      "the rename to reach A",
    );
    await a.docs.setSyncIntent(created.docId, "local");
    await until(() => b.docs.syncIntentOf(created.docId) === "local", "the intent to reach B");
    expect(libraries[1].get(created.docId)?.syncIntent).toBe("local");
    await a.docs.delete(created.docId);
    await until(() => !b.docs.list().some((e) => e.docId === created.docId), "the delete");
    expect(() => b.docs.open(created.docId)).toThrow(/no such doc/);
  });

  it("settings merge across desktops, and B's undo cannot undo A's edit", async () => {
    const { settings } = await pair();
    const [onA, onB] = settings;
    const sections: string[] = [];
    onB.on("changed", (event: { section: string }) => sections.push(event.section));
    await onA.setAppValue("mesh.syncPosture", "opt-in", "test");
    await until(
      async () => (await onB.appValues())["mesh.syncPosture"] === "opt-in",
      "the posture to converge",
    );
    // The owner announces once the merge is persisted.
    await until(() => sections.includes("app"), "B's listeners to hear of it");
    expect(sections).toContain("installSet");
    expect(await onB.undo()).toEqual({ applied: false, reason: "empty-stack" });
  });
});
