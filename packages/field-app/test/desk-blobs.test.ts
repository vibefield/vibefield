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
