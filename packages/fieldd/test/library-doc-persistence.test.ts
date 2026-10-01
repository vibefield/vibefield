// DS-5c — a SYSTEM document's file (the library today; the settings document
// once DS-5b registers it): the review's item "system-doc persistence is
// neither fsync'd nor serialized against merge persists (a torn file reads as
// first boot → unsynced tombstones and renames lost)".
//   · a local persist and a merge persist never interleave, and neither loses
//     the other's change (the write that waited exports when it RUNS);
//   · the bytes reach `<file>.<pid>.tmp`, are fsync'd, and are renamed in —
//     the previous good file kept beside;
//   · a torn file falls back to the last good one, never to an empty library.
//
// The interleaving is forced, not hoped for: the FIRST content write of a
// library file is parked until the test releases it — whether it is made by
// `writeFile` or through a FileHandle, so the rows read the same against any
// implementation.
import { mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocLibraryEntry } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryDocService, systemAccount, systemDocId } from "../src/library-doc";

const gate = vi.hoisted(() => ({
  armed: false,
  release: null as null | (() => void),
  opened: [] as Array<{ path: string; flags: string }>,
  synced: [] as string[],
}));

/** Park the first armed content write of a library file; pass the rest. */
function held<T>(path: string, write: () => Promise<T>): Promise<T> {
  if (!gate.armed || gate.release !== null || !path.includes(".library")) return write();
  return new Promise<T>((resolve, reject) => {
    gate.release = () => {
      write().then(resolve, reject);
    };
  });
}

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const writeFile = ((path: Parameters<typeof actual.writeFile>[0], ...rest: unknown[]) =>
    held(String(path), () =>
      (actual.writeFile as (...a: unknown[]) => Promise<void>)(path, ...rest),
    )) as typeof actual.writeFile;
  const open = (async (
    path: Parameters<typeof actual.open>[0],
    flags?: unknown,
    mode?: unknown,
  ) => {
    const handle = await (actual.open as (...a: unknown[]) => Promise<FsPromises.FileHandle>)(
      path,
      flags,
      mode,
    );
    gate.opened.push({ path: String(path), flags: String(flags) });
    const writeHandle = handle.writeFile.bind(handle);
    const syncHandle = handle.sync.bind(handle);
    handle.writeFile = ((...args: Parameters<typeof handle.writeFile>) =>
      held(String(path), () => writeHandle(...args))) as typeof handle.writeFile;
    handle.sync = () => {
      gate.synced.push(String(path));
      return syncHandle();
    };
    return handle;
  }) as typeof actual.open;
  return { ...actual, writeFile, open, default: { ...actual, writeFile, open } };
});

let dirs: string[] = [];
afterEach(() => {
  gate.armed = false;
  gate.release = null;
  gate.opened = [];
  gate.synced = [];
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "vf-libfile-"));
  dirs.push(dir);
  return dir;
};

const ID = systemDocId("library", systemAccount("james@example.com", "fuid-a"));
const row = (docId: string, name: string): DocLibraryEntry => ({
  docId,
  name,
  createdAt: 1_790_000_000_000,
  engineSchema: null,
  baseEpoch: 0,
});
const LOCAL = "6f1c2b0e-7c1a-4f0e-9d0b-2b8f5a1c3d4e";
const MERGED = "0b7e8a52-39c4-4b8e-8f3a-6d2e1c9a7b10";
const libraryDir = (dataDir: string): string => join(dataDir, "docs", ".library");

async function until(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("DS-5c — the library's file: one writer, fsync'd, the last good copy kept", () => {
  it("a local persist interleaved with a merge persist loses neither", async () => {
    const dataDir = tmp();
    const library = new LibraryDocService({ dataDir, docId: ID });
    await library.ready();
    await library.upsert(row(LOCAL, "Before"), "test"); // the file exists

    // A peer desktop's row, merged as the host merges one.
    const peer = new LibraryDocService({ dataDir: tmp(), docId: ID });
    await peer.upsert(row(MERGED, "From the studio"), "peer");

    gate.armed = true;
    // 1. A LOCAL write: its commit lands in memory, its file write is parked.
    const local = library.rename(LOCAL, "Renamed here", "test");
    await until(() => gate.release !== null, "the local write to be parked");
    // 2. A peer's update MERGES meanwhile, and the host persists it.
    library.doc.import(peer.doc.export({ mode: "update", from: library.doc.oplogVersion() }));
    const merge = library.hostOwner().persist();
    await Promise.race([merge.catch(() => undefined), new Promise((r) => setTimeout(r, 150))]);
    // 3. The parked write goes through.
    gate.release?.();
    const settled = await Promise.allSettled([local, merge]);
    expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);

    // What a restart reads holds BOTH: the rename and the merged row.
    const reloaded = new LibraryDocService({ dataDir, docId: ID });
    await reloaded.ready();
    expect(reloaded.get(LOCAL)?.name).toBe("Renamed here");
    expect(reloaded.get(MERGED)?.name).toBe("From the studio");
  });

  it("writes `<file>.<pid>.tmp`, fsyncs it, renames it in, and keeps the previous file beside", async () => {
    const dataDir = tmp();
    const library = new LibraryDocService({ dataDir, docId: ID });
    await library.upsert(row(LOCAL, "First"), "test");
    await library.rename(LOCAL, "Second", "test");
    const tmpPath = join(libraryDir(dataDir), `${ID}.loro.${process.pid}.tmp`);
    expect(gate.opened).toContainEqual({ path: tmpPath, flags: "w" });
    expect(gate.synced).toContain(tmpPath);
    const files = readdirSync(libraryDir(dataDir)).sort();
    expect(files).toEqual([`${ID}.loro`, `${ID}.loro.last-good`]);
    // the last good copy is the previous version: "First", not "Second"
    const previous = new LibraryDocService({ dataDir: tmp(), docId: ID });
    previous.doc.import(
      new Uint8Array(readFileSync(join(libraryDir(dataDir), `${ID}.loro.last-good`))),
    );
    expect(previous.get(LOCAL)?.name).toBe("First");
  });

  it("a torn file falls back to the last good copy — never to an empty library", async () => {
    const dataDir = tmp();
    const library = new LibraryDocService({ dataDir, docId: ID });
    await library.upsert(row(LOCAL, "Board"), "test");
    await library.tombstone(LOCAL, 42, "test"); // an unsynced tombstone, the review's loss
    await library.rename(MERGED, "Another", "test");
    const file = join(libraryDir(dataDir), `${ID}.loro`);
    truncateSync(file, Math.floor(readFileSync(file).byteLength / 2));

    const reloaded = new LibraryDocService({ dataDir, docId: ID });
    await reloaded.ready();
    // the last good copy: everything but the newest write
    expect(reloaded.get(LOCAL)).toMatchObject({ name: "Board", tombstone: 42 });
    // the torn file is kept as evidence, out of the rotation
    expect(readdirSync(libraryDir(dataDir)).some((f) => f.startsWith(`${ID}.loro.torn-`))).toBe(
      true,
    );
  });
});
