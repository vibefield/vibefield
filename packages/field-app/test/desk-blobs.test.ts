/**
 * DK-3 — the desk's byte store (DK-D21 ruled 2 Oct): renderer-local, CONTENT-ADDRESSED, kept in the
 * origin-private file system — a print's picture by the SHA-256 of its bytes (ICE `hashBytes`, the
 * name every desk store must give), its media type beside it; memory holds what the page met, OPFS
 * keeps it across launches; a hash this device does not hold is `undefined` (the desk then draws
 * that print's paper alone — the honest "elsewhere" face). And the seed lays its print only once the
 * picture is in the store, so the desk never meets a print before its bytes.
 */
import { defineQuery, Position, PrefabId } from "@vibecook/ice";
import { hashBytes } from "@vibecook/ice/desk/kit";
import { PHOTO_TYPE } from "@vibecook/ice/desk/objects";
import { describe, expect, it } from "vitest";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import { SAMPLE_PRINT } from "../src/field/desk/desk-sample-print";
import { buildRegistry, createFieldEngine, seedField } from "../src/field-engine";

/** An origin-private file system in memory: the handles' shapes the store uses, nothing more. */
function memoryOpfs(): {
  root: FileSystemDirectoryHandle;
  files: Map<string, Uint8Array | string>;
} {
  const files = new Map<string, Uint8Array | string>();
  const notFound = (): Error => Object.assign(new Error("not found"), { name: "NotFoundError" });
  const file = (path: string) => ({
    async getFile() {
      const data = files.get(path);
      if (data === undefined) throw notFound();
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      return {
        arrayBuffer: async () => bytes.slice().buffer,
        text: async () => new TextDecoder().decode(bytes),
      };
    },
    async createWritable() {
      let pending: Uint8Array | string = "";
      return {
        write: async (data: Uint8Array | string) => {
          pending = typeof data === "string" ? data : data.slice();
        },
        close: async () => {
          files.set(path, pending);
        },
      };
    },
  });
  const dir = (prefix: string) => ({
    async getDirectoryHandle(name: string) {
      return dir(`${prefix}${name}/`);
    },
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      const path = `${prefix}${name}`;
      if (!files.has(path) && opts?.create !== true) throw notFound();
      return file(path);
    },
    async removeEntry(name: string) {
      if (!files.delete(`${prefix}${name}`)) throw notFound();
    },
  });
  return { root: dir("") as unknown as FileSystemDirectoryHandle, files };
}

const bytesOf = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

describe("the desk's byte store", () => {
  it("names bytes by their SHA-256 and keeps them, with their type, in the origin's file system", async () => {
    const opfs = memoryOpfs();
    const store = createDeskBlobStore({ root: async () => opfs.root });
    const bytes = bytesOf("a picture");
    const hash = await store.put(bytes, "image/png");
    expect(hash).toBe(await hashBytes(bytes));
    expect(await store.persistence()).toBe("opfs");
    expect(opfs.files.has(`vibefield-desk-blobs/${hash}`)).toBe(true);
    expect(opfs.files.get(`vibefield-desk-blobs/${hash}.type`)).toBe("image/png");
    // idempotent by content
    expect(await store.put(bytesOf("a picture"), "image/png")).toBe(hash);
    expect(store.size()).toBe(1);
  });

  it("finds a print's bytes after a relaunch — a new store over the same file system", async () => {
    const opfs = memoryOpfs();
    const hash = await createDeskBlobStore({ root: async () => opfs.root }).put(
      bytesOf("kept"),
      "image/webp",
    );
    const relaunched = createDeskBlobStore({ root: async () => opfs.root });
    const found = await relaunched.get(hash);
    expect(found?.type).toBe("image/webp");
    expect(new TextDecoder().decode(found?.bytes)).toBe("kept");
  });

  it("answers undefined for a hash it does not hold, and for a name that is not a hash", async () => {
    const store = createDeskBlobStore({ root: async () => memoryOpfs().root });
    expect(await store.get("0".repeat(64))).toBeUndefined();
    expect(await store.get("../escape")).toBeUndefined();
  });

  it("DK-4: keeps bytes on its KEYED shelf in place of what the key held — never by content", async () => {
    const opfs = memoryOpfs();
    const store = createDeskBlobStore({ root: async () => opfs.root });
    await store.keep("still-doc-a", bytesOf("first picture"), "image/png");
    await store.keep("still-doc-a", bytesOf("second picture"), "image/png");
    // one file per key, replaced: a board holds one picture, not every one it ever was
    expect(
      new TextDecoder().decode(
        opfs.files.get("vibefield-desk-blobs/keyed/still-doc-a") as Uint8Array,
      ),
    ).toBe("second picture");
    expect([...opfs.files.keys()].filter((path) => path.includes("/keyed/"))).toHaveLength(2);
    expect(store.size()).toBe(0); // the content-addressed side holds none of it
    const relaunched = createDeskBlobStore({ root: async () => opfs.root });
    const kept = await relaunched.kept("still-doc-a");
    expect(kept?.type).toBe("image/png");
    expect(new TextDecoder().decode(kept?.bytes)).toBe("second picture");
    expect(await relaunched.kept("still-never")).toBeUndefined();
    await expect(store.keep("../escape", bytesOf("x"), "image/png")).rejects.toThrow(/not a key/);
  });

  it("DK-5: forgets what a key keeps — its bytes and its type, from the file system and from memory", async () => {
    const opfs = memoryOpfs();
    const store = createDeskBlobStore({ root: async () => opfs.root });
    await store.keep("still-doc-a", bytesOf("a picture"), "image/png");
    await store.keep("still-doc-b", bytesOf("its neighbour"), "image/png");
    await store.forget("still-doc-a");
    expect(opfs.files.has("vibefield-desk-blobs/keyed/still-doc-a")).toBe(false);
    expect(opfs.files.has("vibefield-desk-blobs/keyed/still-doc-a.type")).toBe(false);
    expect(await store.kept("still-doc-a")).toBeUndefined();
    expect(await createDeskBlobStore({ root: async () => opfs.root }).kept("still-doc-a")).toBe(
      undefined,
    );
    expect(new TextDecoder().decode((await store.kept("still-doc-b"))?.bytes)).toBe(
      "its neighbour",
    );
    await store.forget("still-never-kept"); // nothing kept is nothing to forget
    await expect(store.forget("../escape")).rejects.toThrow(/not a key/);

    const memoryOnly = createDeskBlobStore({ root: async () => undefined });
    await memoryOnly.keep("still-doc-c", bytesOf("held for the page"), "image/png");
    await memoryOnly.forget("still-doc-c");
    expect(await memoryOnly.kept("still-doc-c")).toBeUndefined();
  });

  it("keeps prints in memory alone where the origin has no file system", async () => {
    const store = createDeskBlobStore({
      root: async () => {
        throw new Error("SecurityError: no origin-private file system");
      },
    });
    const hash = await store.put(bytesOf("held here"), "image/png");
    expect(await store.persistence()).toBe("memory");
    expect((await store.get(hash))?.type).toBe("image/png");
  });

  it("DK-4: holds a kept picture in memory only where the origin has no file system", async () => {
    const store = createDeskBlobStore({
      root: async () => {
        throw new Error("SecurityError: no origin-private file system");
      },
    });
    await store.keep("still-doc-b", bytesOf("held for the page"), "image/png");
    const kept = await store.kept("still-doc-b");
    expect(kept?.type).toBe("image/png");
    expect(new TextDecoder().decode(kept?.bytes)).toBe("held for the page");
  });

  it("lays the seed's print only once its picture is in the store, naming the picture's hash", async () => {
    const opfs = memoryOpfs();
    const store = createDeskBlobStore({ root: async () => opfs.root });
    const ce = createFieldEngine(buildRegistry());
    await seedField(ce, ce.docs.create(), store);
    const photo = ce.catalog.widget(PHOTO_TYPE);
    const group = photo?.groups.find((g) => "blob" in g.fields);
    expect(group).toBeDefined();
    const blobs: string[] = [];
    ce.world.query(defineQuery([Position, PrefabId])).each((batch) => {
      for (const row of batch) {
        const e = batch.entity(row);
        if (ce.world.get(e, PrefabId)?.id !== PHOTO_TYPE || group === undefined) continue;
        blobs.push(String((ce.world.get(e, group.component) as { blob?: unknown }).blob));
      }
    });
    expect(blobs).toEqual([SAMPLE_PRINT.sha256]);
    expect((await store.get(SAMPLE_PRINT.sha256))?.type).toBe(SAMPLE_PRINT.type);
    expect(opfs.files.has(`vibefield-desk-blobs/${SAMPLE_PRINT.sha256}`)).toBe(true);
    ce.dispose();
  });
});
