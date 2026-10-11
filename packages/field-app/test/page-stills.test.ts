// @vitest-environment node
/**
 * PT-5b (ruling 1) — THE PAGES' LAST STILLS, KEPT (surfaces/live/page-stills.ts) on the desk's byte store's keyed shelf, and
 * the shelf's INDEX they are bounded by (field/desk/desk-blobs.ts `list`): a still is ONE container — the picture behind a
 * header that says what it is a photograph of (its address, its logical size) — named by its document and its object, kept
 * in place of the last, read back whole or not at all; a device keeps a bounded weight of them, the oldest forgotten first;
 * and a document's stills are forgotten with it. Never anywhere but the shelf.
 */
import { describe, expect, it, vi } from "vitest";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import {
  createPageStills,
  docStillPrefix,
  PAGE_STILL_MAX_PX,
  PAGE_STILL_PREFIX,
  PAGE_STILL_TYPE,
  PAGE_STILLS_MAX_BYTES,
  type PageStill,
  packStill,
  pageStillName,
  unpackStill,
} from "../src/surfaces/live/page-stills";

/** An origin-private file system in memory whose directories can be LISTED: each file with its size and when it was written. */
function memoryOpfs(clock: { now: number }) {
  const files = new Map<string, { data: Uint8Array | string; at: number }>();
  const notFound = (): Error => Object.assign(new Error("not found"), { name: "NotFoundError" });
  const sizeOf = (data: Uint8Array | string): number =>
    typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
  const file = (path: string) => ({
    kind: "file" as const,
    async getFile() {
      const f = files.get(path);
      if (f === undefined) throw notFound();
      const bytes = typeof f.data === "string" ? new TextEncoder().encode(f.data) : f.data;
      return {
        size: sizeOf(f.data),
        lastModified: f.at,
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
          files.set(path, { data: pending, at: clock.now });
        },
      };
    },
  });
  const dir = (prefix: string) => ({
    kind: "directory" as const,
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
    async *entries() {
      for (const path of [...files.keys()]) {
        if (!path.startsWith(prefix)) continue;
        const name = path.slice(prefix.length);
        if (!name.includes("/")) yield [name, file(path)] as const;
      }
    },
  });
  return { root: dir("") as unknown as FileSystemDirectoryHandle, files };
}

const DOC = "0b9e7a52-6c1d-4a5f-9a1e-3f6f0a7d9c11";
const OTHER = "7d2c1f00-aaaa-4bbb-8ccc-000000000001";
const KEY = "13918995204487956201-1";
const still = (over: Partial<PageStill> = {}): PageStill => ({
  address: "https://example.org/reader?page=2",
  logical: [1280, 800],
  size: [1600, 1000],
  type: "image/webp",
  image: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]),
  takenAt: 1_760_000_000_000,
  ...over,
});
const shelfOf = (clock = { now: 1_000 }) => {
  const opfs = memoryOpfs(clock);
  const store = createDeskBlobStore({ root: async () => opfs.root });
  return { store, opfs, clock };
};

describe("the keyed shelf's index (PT-5b)", () => {
  it("lists what it keeps under a prefix — each key, its bytes and when it was written — off the directory itself, never a `.type` beside it", async () => {
    const { store, clock } = shelfOf();
    await store.keep("page.a.1", new Uint8Array(10), "x/y");
    clock.now = 2_000;
    await store.keep("page.a.2", new Uint8Array(30), "x/y");
    await store.keep("still-doc", new Uint8Array(5), "image/png");
    expect([...(await store.list("page."))].sort((a, b) => a.modified - b.modified)).toEqual([
      { key: "page.a.1", bytes: 10, modified: 1_000 },
      { key: "page.a.2", bytes: 30, modified: 2_000 },
    ]);
    expect(await store.list("page.a.2")).toEqual([{ key: "page.a.2", bytes: 30, modified: 2_000 }]);
    expect(await store.list("nothing-")).toEqual([]);
    // a replaced key is one entry, the newer
    clock.now = 3_000;
    await store.keep("page.a.1", new Uint8Array(12), "x/y");
    expect((await store.list("page.a.1"))[0]).toEqual({
      key: "page.a.1",
      bytes: 12,
      modified: 3_000,
    });
    // forgotten: gone from the index
    await store.forget("page.a.2");
    expect((await store.list("page.")).map((e) => e.key)).toEqual(["page.a.1"]);
    // a new store over the same file system reads the same index (a former launch's)
    const { opfs } = shelfOf();
    expect(opfs.files.size).toBe(0);
    await expect(store.list("../etc")).rejects.toThrow(/begins no key/);
  });

  it("with no file system it lists what it holds in memory, stamped when it was kept", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const store = createDeskBlobStore({ root: async () => undefined });
    await store.keep("page.m.1", new Uint8Array(7), "x/y");
    expect(await store.list("page.")).toEqual([{ key: "page.m.1", bytes: 7, modified: 5_000 }]);
    await store.forget("page.m.1");
    expect(await store.list("page.")).toEqual([]);
    vi.useRealTimers();
  });
});

describe("a page's last still, kept (PT-5b ruling 1)", () => {
  it("is ONE container: the picture behind a header that says its address, its logical size, its own size and type, when it was taken — read back whole", () => {
    const s = still();
    const packed = packStill(s);
    expect([...packed.subarray(0, 4)]).toEqual([0x56, 0x46, 0x50, 0x53]);
    expect(unpackStill(packed)).toEqual(s);
    // an address with anything in it survives
    const odd = still({ address: "https://例え.jp/パス?q=“quoted”&x=1#frag" });
    expect(unpackStill(packStill(odd))?.address).toBe(odd.address);
    // fractional logical sizes are kept as they are (CSS px may be)
    expect(unpackStill(packStill(still({ logical: [401.5, 873.25] })))?.logical).toEqual([
      401.5, 873.25,
    ]);
  });

  it("is read back whole or NOT AT ALL: a torn file, another version, a header that lies — never half a still", () => {
    const packed = packStill(still());
    expect(unpackStill(packed.subarray(0, 8))).toBeUndefined();
    expect(unpackStill(packed.subarray(0, packed.byteLength - 8))).toBeUndefined();
    expect(unpackStill(new Uint8Array([1, 2, 3]))).toBeUndefined();
    const version = packed.slice();
    version[4] = 2;
    expect(unpackStill(version)).toBeUndefined();
    const magic = packed.slice();
    magic[0] = 0;
    expect(unpackStill(magic)).toBeUndefined();
    for (const bad of [
      { address: "" },
      { logical: [0, 800] },
      { logical: [1280] },
      { size: [1600, Number.NaN] },
      { type: "text/html" },
      { takenAt: "yesterday" },
    ])
      expect(unpackStill(packStill(still(bad as never))), JSON.stringify(bad)).toBeUndefined();
    // a subarray of a larger buffer (a file read into a pool) is read where it stands
    const pooled = new Uint8Array(packed.byteLength + 16);
    pooled.set(packed, 16);
    expect(unpackStill(pooled.subarray(16))).toEqual(still());
  });

  it("is NAMED by its document and its object — plain where each is a plain name, a digest where it is not — and a document's stills share a prefix", () => {
    expect(pageStillName(DOC, KEY)).toBe(`page.${DOC}.${KEY}`);
    expect(docStillPrefix(DOC)).toBe(`page.${DOC}.`);
    expect(pageStillName(DOC, KEY).startsWith(PAGE_STILL_PREFIX)).toBe(true);
    // a key the shelf could not name is digested — stable, distinct, and still under its document's prefix
    const odd = pageStillName(DOC, "a key / with: things");
    expect(odd).toMatch(new RegExp(`^page\\.${DOC}\\.x[0-9a-f]{32}$`));
    expect(pageStillName(DOC, "a key / with: things")).toBe(odd);
    expect(pageStillName(DOC, "a key / with: thing")).not.toBe(odd);
    expect(pageStillName("a/doc", KEY)).toMatch(/^page\.x[0-9a-f]{32}\.13918995204487956201-1$/);
    // every name is one the shelf can name, within its length
    for (const name of [odd, pageStillName("x".repeat(400), "y".repeat(400))]) {
      expect(name).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
    }
  });

  it("is kept on the shelf in place of the last, under its container's type, and found again by a new page over the same file system", async () => {
    const { store, opfs } = shelfOf();
    const stills = createPageStills(() => store);
    expect(await stills.kept(DOC, KEY)).toBeUndefined();
    expect(await stills.keptAt(DOC, KEY)).toBeUndefined();
    await stills.keep(DOC, KEY, still());
    expect(opfs.files.get(`vibefield-desk-blobs/keyed/page.${DOC}.${KEY}.type`)?.data).toBe(
      PAGE_STILL_TYPE,
    );
    expect(await stills.kept(DOC, KEY)).toEqual(still());
    expect(await stills.keptAt(DOC, KEY)).toBe(1_000);
    // a new one takes its place
    await stills.keep(DOC, KEY, still({ address: "https://example.org/elsewhere", takenAt: 2 }));
    expect((await stills.kept(DOC, KEY))?.address).toBe("https://example.org/elsewhere");
    expect(await stills.usage()).toMatchObject({ stills: 1 });
    // a former launch's
    const relaunch = createPageStills(() => createDeskBlobStore({ root: async () => opfs.root }));
    expect((await relaunch.kept(DOC, KEY))?.address).toBe("https://example.org/elsewhere");
    // bytes on the shelf that are no still (a torn write) read as none
    await store.keep(pageStillName(DOC, "torn"), new Uint8Array([1, 2, 3]), PAGE_STILL_TYPE);
    expect(await stills.kept(DOC, "torn")).toBeUndefined();
    await stills.forget(DOC, KEY);
    expect(await stills.kept(DOC, KEY)).toBeUndefined();
  });

  it("is BOUNDED: past the device's weight the OLDEST stills are forgotten first — never the one just kept — and nothing else on the shelf is touched", async () => {
    const { store, clock } = shelfOf();
    const big = (n: number): PageStill => still({ image: new Uint8Array(n) });
    const one = packStill(big(1_000)).byteLength;
    // room for three of them, not four
    const stills = createPageStills(() => store, { maxBytes: one * 3 + 10 });
    await store.keep("still-a-board", new Uint8Array(9_999), "image/png");
    for (const [i, key] of ["k1", "k2", "k3"].entries()) {
      clock.now = 1_000 + i;
      await stills.keep(DOC, key, big(1_000));
    }
    expect((await stills.usage()).stills).toBe(3);
    clock.now = 2_000;
    await stills.keep(OTHER, "k4", big(1_000));
    // the oldest went; the newest three stand
    expect(await stills.kept(DOC, "k1")).toBeUndefined();
    expect(await stills.kept(DOC, "k2")).toBeDefined();
    expect(await stills.kept(OTHER, "k4")).toBeDefined();
    expect(await stills.usage()).toEqual({ bytes: one * 3, stills: 3 });
    // one still heavier than the whole bound is still kept (never the one just kept) — everything older goes
    clock.now = 3_000;
    await stills.keep(DOC, "huge", big(10_000));
    expect(await stills.kept(DOC, "huge")).toBeDefined();
    expect((await stills.usage()).stills).toBe(1);
    // the explorer's still of a board is not a page's: untouched
    expect(await store.kept("still-a-board")).toBeDefined();
    expect(PAGE_STILLS_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(PAGE_STILL_MAX_PX).toBe(1600);
  });

  it("a document's stills are forgotten with it — every pane's, and no other document's", async () => {
    const { store } = shelfOf();
    const stills = createPageStills(() => store);
    await stills.keep(DOC, "a-1", still());
    await stills.keep(DOC, "a-2", still());
    await stills.keep(OTHER, "b-1", still());
    expect(await stills.forgetDocument(DOC)).toBe(2);
    expect(await stills.kept(DOC, "a-1")).toBeUndefined();
    expect(await stills.kept(DOC, "a-2")).toBeUndefined();
    expect(await stills.kept(OTHER, "b-1")).toBeDefined();
    expect(await stills.forgetDocument(DOC)).toBe(0);
  });
});
