/**
 * DK-4 — THE EXPLORER'S STILLS (DK-D27, the orchestrator's ruling on DK-3's q3): a board's picture is
 * a still of its desk through ICE's capture door — a quarter of the view — taken at the
 * board's CLOSE and ONCE on the desk's idle after an edit settles — never per frame — its PNG bytes
 * kept on the renderer's byte store's keyed shelf under the document id, and shown in the explorer as
 * a `blob:` URL. A board never captured has no URL (the placeholder tile). PF6: an owed still waits
 * out a hidden window at the source.
 */
import { createCanvasEngine } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";
import { DESK_ENGINE } from "@vibecook/ice/desk/objects";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocManager, DocSessionPending } from "../src/doc-manager";
import { DocStillShelf, stillKey } from "../src/doc-stills";
import { createDeskBlobStore } from "../src/field/desk/desk-blobs";
import {
  CLOSE_BUDGET_MS,
  createDeskStills,
  deskStillPng,
  REST_PATIENCE_MS,
  REST_POLL_MS,
  STILL_SCALE,
} from "../src/field/desk/desk-stills";
import { bindPersistence } from "../src/field/persistence-controller";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** The engine's frame loop as the stills read it: asleep or parked is the desk at rest. */
function frame(rest = false) {
  const state = { asleep: rest, parked: false };
  return {
    state,
    engine: {
      frame: {
        sleepStats: () => ({ asleep: state.asleep, sleeps: 0, wakes: {}, timed: 0, steps: 0 }),
        isParked: () => state.parked,
      },
    } as unknown as Parameters<typeof createDeskStills>[0]["engine"],
  };
}

/** The capture door, counted: a still each time, or none (a desk that cannot draw); its last frame at `dpr`. */
function desk(answers = true, dpr = 2) {
  const asks: unknown[] = [];
  let closed = 0;
  const handle = {
    lastInputs: () => ({ view: { dpr } }) as unknown as ReturnType<DeskLayerHandle["lastInputs"]>,
    capture: async (opts?: unknown) => {
      asks.push(opts);
      return answers
        ? ({ width: 4, height: 2, close: () => (closed += 1) } as ImageBitmap)
        : undefined;
    },
  };
  return { handle, asks, closed: () => closed };
}

function visibility(hiddenAtStart: boolean) {
  let hidden = hiddenAtStart;
  let listener: ((hidden: boolean) => void) | null = null;
  return {
    seam: {
      isHidden: () => hidden,
      onVisibilityChange: (fn: (hidden: boolean) => void) => {
        listener = fn;
        return () => {
          listener = null;
        };
      },
    },
    set(next: boolean) {
      hidden = next;
      listener?.(next);
    },
  };
}

function stills(opts: { rest?: boolean; answers?: boolean; hidden?: boolean } = {}) {
  const f = frame(opts.rest ?? false);
  const d = desk(opts.answers ?? true);
  const v = visibility(opts.hidden ?? false);
  const kept: Uint8Array[] = [];
  const s = createDeskStills({
    engine: f.engine,
    desk: () => d.handle,
    keep: (png) => {
      kept.push(png);
    },
    encode: async () => PNG.slice(),
    visibility: v.seam,
  });
  return { s, f, d, v, kept };
}

describe("a board's still — at its close, and once on the desk's idle", () => {
  it("an owed still is taken ONCE, at the desk's next rest — never per frame", async () => {
    vi.useFakeTimers();
    const h = stills();
    h.s.owe();
    await vi.advanceTimersByTimeAsync(REST_POLL_MS * 5);
    expect(h.d.asks).toHaveLength(0); // the desk is drawing: no still
    h.f.state.asleep = true;
    await vi.advanceTimersByTimeAsync(REST_POLL_MS);
    expect(h.d.asks).toEqual([{ scale: STILL_SCALE }]); // a quarter of the view
    expect(h.kept).toEqual([PNG]);
    expect(h.d.closed()).toBe(1); // the bitmap let go once encoded
    await vi.advanceTimersByTimeAsync(REST_POLL_MS * 20);
    expect(h.d.asks).toHaveLength(1); // rest without a new edit takes nothing
    h.s.owe(); // the next edit settles
    await vi.advanceTimersByTimeAsync(REST_POLL_MS);
    expect(h.d.asks).toHaveLength(2);
    h.s.dispose();
  });

  it("looks for a rest only while a still is owed — no timer at rest otherwise (idle-zero)", async () => {
    vi.useFakeTimers();
    const h = stills({ rest: true });
    expect(vi.getTimerCount()).toBe(0);
    h.s.owe();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(REST_POLL_MS);
    expect(h.kept).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    h.s.dispose();
  });

  it("a desk parked under a cover is at rest too: its parked frame is the still", async () => {
    vi.useFakeTimers();
    const h = stills();
    h.f.state.parked = true;
    h.s.owe();
    await vi.advanceTimersByTimeAsync(REST_POLL_MS);
    expect(h.kept).toHaveLength(1);
    h.s.dispose();
  });

  it("a desk with no still to give (failed, before its first frame) keeps the still owed", async () => {
    vi.useFakeTimers();
    const h = stills({ rest: true, answers: false });
    h.s.owe();
    await vi.advanceTimersByTimeAsync(REST_POLL_MS);
    expect(h.d.asks).toHaveLength(1);
    expect(h.kept).toHaveLength(0);
    expect(h.s.owed()).toBe(true);
    // …within its patience: a desk that never rests or never draws leaves it to the board's close
    await vi.advanceTimersByTimeAsync(REST_PATIENCE_MS + REST_POLL_MS * 2);
    expect(h.s.owed()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    h.s.dispose();
  });

  it("the board's close takes its still at once — owed or not — and drops the wait", async () => {
    vi.useFakeTimers();
    const h = stills();
    h.s.owe(); // owed, the desk drawing on
    await h.s.close();
    expect(h.d.asks).toEqual([{ scale: STILL_SCALE }]);
    expect(h.kept).toEqual([PNG]);
    expect(h.s.owed()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    h.s.dispose();
  });

  it("a close that the desk cannot answer is let go within its budget", async () => {
    vi.useFakeTimers();
    const kept: Uint8Array[] = [];
    const s = createDeskStills({
      engine: frame(true).engine,
      // a device that never answers
      desk: () => ({ capture: () => new Promise<undefined>(() => {}), lastInputs: () => null }),
      keep: (png) => {
        kept.push(png);
      },
      encode: async () => PNG.slice(),
      visibility: visibility(false).seam,
    });
    let done = false;
    void s.close().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(CLOSE_BUDGET_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(kept).toHaveLength(0);
    s.dispose();
  });
});

describe("the still's size: a quarter of the view, every kind in it", () => {
  // DK-6: ICE 0.15.0-desk.2 draws every kind at every scale, so the door is asked the quarter ITSELF at
  // every device ratio and the encoder keeps the still as captured — DK-4's `max(0.25, 1 / dpr)` ask
  // and its encode-time reduction retired with the pin (smoke:canvas's quarter row holds the pixels).
  it("asks the capture door for the quarter at every device ratio, and encodes the still at its own size", async () => {
    for (const dpr of [1, 2, 3, 4]) {
      const d = desk(true, dpr);
      const encoded: ImageBitmap[] = [];
      const png = await deskStillPng(d.handle, async (bitmap) => {
        encoded.push(bitmap);
        return PNG.slice();
      });
      expect(d.asks, `dpr ${dpr}`).toEqual([{ scale: STILL_SCALE }]);
      expect(encoded, `dpr ${dpr}`).toHaveLength(1); // the bitmap the door gave, as it gave it
      expect(png).toEqual(PNG);
      expect(d.closed(), `dpr ${dpr}`).toBe(1);
    }
    expect(STILL_SCALE).toBe(0.25);
  });
});

describe("an owed still waits out a hidden window at the source (PF6)", () => {
  it("hidden: nothing looks for a rest, nothing is taken; visible: the wait resumes", async () => {
    vi.useFakeTimers();
    const h = stills({ rest: true, hidden: true });
    h.s.owe();
    expect(vi.getTimerCount()).toBe(0); // parked on the visibility seam, not a timer
    await vi.advanceTimersByTimeAsync(REST_POLL_MS * 10);
    expect(h.d.asks).toHaveLength(0);
    h.v.set(false);
    await vi.advanceTimersByTimeAsync(REST_POLL_MS);
    expect(h.kept).toHaveLength(1);
    h.s.dispose();
  });
});

describe("the explorer's shelf — one still per board, a blob: URL", () => {
  /** The origin's file system in memory — the handles' shapes the store uses (DK-3's double). */
  function memoryOpfs() {
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

  function urls() {
    let n = 0;
    const revoked: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:still-${++n}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
      revoked.push(url);
    });
    return { revoked };
  }

  it("keeps a board's still under its id, in place of the last, and shows it as a blob: URL", async () => {
    const u = urls();
    const opfs = memoryOpfs();
    const store = createDeskBlobStore({ root: async () => opfs.root });
    const shown: Array<[string, string]> = [];
    const shelf = new DocStillShelf(
      (docId, url) => shown.push([docId, url]),
      () => store,
    );
    await shelf.keep("doc-a", PNG.slice());
    expect(shown).toEqual([["doc-a", "blob:still-1"]]);
    expect(opfs.files.get(`vibefield-desk-blobs/keyed/${stillKey("doc-a")}`)).toEqual(PNG);
    expect(opfs.files.get(`vibefield-desk-blobs/keyed/${stillKey("doc-a")}.type`)).toBe(
      "image/png",
    );
    const next = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]);
    await shelf.keep("doc-a", next);
    expect(shown.at(-1)).toEqual(["doc-a", "blob:still-2"]);
    expect(u.revoked).toEqual(["blob:still-1"]); // the last picture's URL let go
    expect(opfs.files.get(`vibefield-desk-blobs/keyed/${stillKey("doc-a")}`)).toEqual(next);
  });

  it("DK-5: forgets a deleted board's still — its URL let go and withdrawn, its bytes removed, never read back", async () => {
    const u = urls();
    const opfs = memoryOpfs();
    const store = createDeskBlobStore({ root: async () => opfs.root });
    const shown: Array<[string, string]> = [];
    const withdrawn: string[] = [];
    const shelf = new DocStillShelf(
      (docId, url) => shown.push([docId, url]),
      () => store,
      (docId) => withdrawn.push(docId),
    );
    await shelf.keep("doc-a", PNG.slice());
    await shelf.forget("doc-a");
    expect(withdrawn).toEqual(["doc-a"]);
    expect(u.revoked).toEqual(["blob:still-1"]);
    expect(opfs.files.has(`vibefield-desk-blobs/keyed/${stillKey("doc-a")}`)).toBe(false);
    expect(opfs.files.has(`vibefield-desk-blobs/keyed/${stillKey("doc-a")}.type`)).toBe(false);
    await shelf.hydrate(["doc-a"]);
    expect(shown).toEqual([["doc-a", "blob:still-1"]]); // nothing shown again
    await shelf.forget("doc-never-pictured"); // no URL to withdraw, nothing kept to remove
    expect(withdrawn).toEqual(["doc-a"]);
  });

  it("finds the stills a former launch kept; a board never captured shows none (the placeholder)", async () => {
    urls();
    const opfs = memoryOpfs();
    const store = createDeskBlobStore({ root: async () => opfs.root });
    await new DocStillShelf(
      () => {},
      () => store,
    ).keep("doc-a", PNG.slice());
    const relaunched = createDeskBlobStore({ root: async () => opfs.root });
    const shown: Array<[string, string]> = [];
    await new DocStillShelf(
      (docId, url) => shown.push([docId, url]),
      () => relaunched,
    ).hydrate(["doc-a", "doc-never-pictured"]);
    expect(shown.map(([docId]) => docId)).toEqual(["doc-a"]);
    expect(shown[0]?.[1]).toMatch(/^blob:/);
  });
});

describe("an acknowledged save owes the board a still", () => {
  it("each save the lane acknowledges owes one — the persistence path, not a frame", async () => {
    const ce = createCanvasEngine(DESK_ENGINE);
    ce.docs.create();
    const owed: string[] = [];
    let release: (() => void) | null = null;
    const lane = {
      lastPutAt: null,
      put: () =>
        new Promise((resolve) => {
          release = () => resolve({ revisionId: "r1" });
        }),
      putUpdate: async () => ({ revisionId: "r2" }),
      onPush: () => () => undefined,
    } as unknown as DocLaneClient;
    const manager = {
      registerPersistence: () => () => undefined,
      stillOwed: (docId: string) => owed.push(docId),
    } as unknown as DocManager;
    const pending = { generation: 1, docId: "doc-saved" } as DocSessionPending;
    const unbind = bindPersistence({ ce, manager, pending, lane });
    const autosave = ce.docs.current();
    expect(autosave).toBeDefined();
    await vi.waitFor(() => expect(release).not.toBeNull(), { timeout: 3_000 }); // autosave starts dirty
    expect(owed).toEqual([]); // not before fieldd says the bytes are kept
    (release as unknown as () => void)();
    await vi.waitFor(() => expect(owed).toEqual(["doc-saved"]));
    unbind();
    ce.dispose();
  });
});
