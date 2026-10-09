// PT-2 — THE DESK'S LIVE SERVICE (surfaces/live/desk-live.ts): ICE's `LIVE` contract over the window's LSF pool, with a FAKE pool,
// presentation and writer — an arrival is one `arrived()`; `take()` presents the newest frame once into ICE's writer on the desk's
// device (labelled `<kind>/live <key>`, from the frame's `visibleRect`) and releases its lease; an UNSEEN face's frame is taken and
// closed, no redraw; the demand map; the state and the words; close; a remount's service makes its writers on its own device; the
// capability gate's refusal is a failed face with the words; the mint names the page and the durable key.
import type { LiveSurfaceFrameMetadataV1, LiveSurfaceRuntimeSummaryV1 } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createDeskLiveSources,
  type DeskLiveDeps,
  fpsBucket,
  liveDemandIntent,
} from "../src/surfaces/live/desk-live";
import type { LiveDemand, LiveTextureOptions, LiveWriter } from "../src/surfaces/live/ice-live";
import type {
  SurfaceAcquireOptions,
  SurfaceDemandRequest,
  SurfaceHandleState,
} from "../src/surfaces/pool";

const PAGE = {
  source: "browser",
  url: "http://127.0.0.1:4321/",
  viewport: [1280, 800],
  scheme: "light",
  label: "Browser",
};
const SEEN: LiveDemand = {
  mode: "live",
  fps: 30,
  raster: [1280, 800],
  viewport: [1280, 800],
  interactive: false,
};
const UNSEEN: LiveDemand = {
  mode: "paused",
  fps: 0,
  raster: [0, 0],
  viewport: [1280, 800],
  interactive: false,
};

function metadata(): LiveSurfaceFrameMetadataV1 {
  return {
    v: 1,
    surfaceId: "surface_0123456789abcdef",
    producerEpoch: 1,
    sequence: "1",
    geometry: {
      revision: 1,
      codedSize: { width: 2600, height: 1620 },
      visibleRect: { x: 4, y: 2, width: 2560, height: 1600 },
      logicalSize: { width: 1280, height: 800 },
      orientation: 0,
    },
    hostReceivedAtUs: "1",
    pixelFormat: "bgra",
    colorSpace: "srgb",
    alphaMode: "opaque",
    transport: "shared-texture",
  };
}

/** A presentation as the pool hands it: frames LAND (`land`), a consumer takes the newest, its lease always released. */
function fakePresentation(summaryState: LiveSurfaceRuntimeSummaryV1["state"] = "live") {
  const listeners = new Set<() => void>();
  const pending: { close: ReturnType<typeof vi.fn> }[] = [];
  const closed: unknown[] = [];
  const p = {
    closed: false,
    summary: { state: summaryState, transport: "shared-texture" } as LiveSurfaceRuntimeSummaryV1,
    onFrame(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    presentLatestVia(consumer: (frame: unknown, metadata: LiveSurfaceFrameMetadataV1) => boolean) {
      const frame = pending.pop();
      for (const older of pending.splice(0)) older.close();
      if (frame === undefined) return { kind: "idle" as const };
      try {
        const ok = consumer(frame, metadata());
        return ok
          ? { kind: "consumed" as const, metadata: metadata() }
          : { kind: "dropped" as const, reason: "consumer-rejected" as const };
      } finally {
        frame.close(); // the lease, released on every path
        closed.push(frame);
      }
    },
    land() {
      const frame = { close: vi.fn() };
      pending.push(frame);
      for (const l of [...listeners]) l();
      return frame;
    },
    listeners: () => listeners.size,
    closed_: closed,
  };
  return p;
}

/** A pool handle under the test's hand: its state set, its demand and release recorded. */
function fakeHandle(key: string, opts: SurfaceAcquireOptions) {
  const listeners = new Set<(s: SurfaceHandleState<never>) => void>();
  let state = {
    status: "attaching",
    presentation: null,
    browser: null,
    error: null,
  } as unknown as SurfaceHandleState<never>;
  const h = {
    key,
    opts,
    demands: [] as SurfaceDemandRequest[],
    /** What the pool's snapshot says it last wrote to the wire for this key. */
    wire: null as unknown,
    released: 0,
    retried: 0,
    get state() {
      return state;
    },
    get presentation() {
      return state.presentation;
    },
    get status() {
      return state.status;
    },
    get browser() {
      return state.browser;
    },
    get error() {
      return state.error;
    },
    onState(listener: (s: SurfaceHandleState<never>) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    setDemand(d: SurfaceDemandRequest) {
      h.demands.push(d);
    },
    sendInput: () => false,
    navigate: () => false,
    retry() {
      h.retried += 1;
    },
    release() {
      h.released += 1;
    },
    set(next: Partial<SurfaceHandleState<never>>) {
      state = { ...state, ...next } as SurfaceHandleState<never>;
      for (const l of [...listeners]) l(state);
    },
  };
  return h;
}

function setup(over: Partial<DeskLiveDeps> = {}) {
  const handles: ReturnType<typeof fakeHandle>[] = [];
  const writers: {
    device: unknown;
    o: LiveTextureOptions;
    presented: unknown[];
    destroyed: number;
  }[] = [];
  const device = { id: "desk-device" } as unknown as GPUDevice;
  const requests: { method: string; params: unknown }[] = [];
  const deps: DeskLiveDeps = {
    pool: () =>
      ({
        disposed: false,
        acquire(key: string, opts: SurfaceAcquireOptions) {
          const h = fakeHandle(key, opts);
          handles.push(h);
          return h as never;
        },
        snapshot: () =>
          ({ entries: handles.map((h) => ({ key: h.key, demand: h.wire })) }) as never,
        dispose: () => {},
      }) as never,
    mintClient: () => ({
      async request(method: string, params?: unknown) {
        requests.push({ method, params });
        return {
          surfaceId: "surface_0123456789abcdef",
          ticket: { v: 1, token: "abcdefghijklmnopqrstuvwxyz_0123456789-ABCDE" },
        };
      },
    }),
    gate: () => ({ type: "vibefield.browser-pane" }),
    device: () => device,
    writer: (d, o) => {
      const w = { device: d, o, presented: [] as unknown[], destroyed: 0 };
      writers.push(w);
      const face = {
        width: o.width,
        height: o.height,
        format: "rgba8unorm-srgb" as const,
        revision: 0,
        epoch: 0,
        view: () => ({}) as never,
        prepare: () => {},
        bytes: 0,
      };
      const writer: LiveWriter = {
        face,
        present: (frame, rect) => {
          face.revision += 1;
          w.presented.push({ frame, rect });
        },
        presentBytes: () => {},
        presentTexture: () => {},
        resize: () => {},
        destroy: () => {
          w.destroyed += 1;
        },
      };
      return writer;
    },
    ...over,
  };
  const live = createDeskLiveSources(deps);
  return { live, handles, writers, device, requests };
}

/** A face opened and attached live, its presentation in hand. */
function attached(over: Partial<DeskLiveDeps> = {}) {
  const t = setup(over);
  const arrived = vi.fn();
  const face = t.live.open("13918995204487956201-1", PAGE, arrived);
  const handle = t.handles[0];
  if (handle === undefined) throw new Error("no handle");
  const presentation = fakePresentation();
  handle.set({ status: "live", presentation: presentation as never });
  return { ...t, face, handle, presentation, arrived };
}

describe("the desk's LIVE service — a face over the window's pool", () => {
  it("opens the page's pool key apart from any panel's, paused at the page's viewport until the kind's law has seen it", () => {
    const t = setup();
    t.live.open("13918995204487956201-1", PAGE, () => {});
    expect(t.handles[0]?.key).toBe("desk:13918995204487956201-1");
    expect(t.handles[0]?.opts.initialDemand).toEqual({
      mode: "paused",
      targetFps: 0,
      priority: 0,
      interactive: false,
      logicalViewport: { width: 1280, height: 800 },
    });
  });

  it("mints the page on the WINDOW's client: a browser source in a memory profile of its own, the durable key as reuseKey", async () => {
    const t = setup();
    t.live.open("13918995204487956201-1", PAGE, () => {});
    const grant = await t.handles[0]?.opts.tickets.mint();
    expect(grant?.surfaceId).toBe("surface_0123456789abcdef");
    expect(t.requests).toEqual([
      {
        method: "surface.open",
        params: {
          source: {
            kind: "browser",
            initialUrl: "http://127.0.0.1:4321/",
            profile: { mode: "memory", ref: "desk:13918995204487956201-1" },
            logicalViewport: { width: 1280, height: 800 },
          },
          reuseKey: "13918995204487956201-1",
        },
      },
    ]);
    await t.handles[0]?.opts.tickets.close?.("surface_0123456789abcdef");
    expect(t.requests[1]).toEqual({
      method: "surface.close",
      params: { surfaceId: "surface_0123456789abcdef" },
    });
  });

  it("an ARRIVAL is one arrived(): a frame landing, the state or the page's words moving — never at the open itself", () => {
    const { face, handle, presentation, arrived } = attached();
    // the attach moved the state: one word
    expect(arrived).toHaveBeenCalledTimes(1);
    expect(face.take()).toBe(true); // the words moved
    presentation.land();
    expect(arrived).toHaveBeenCalledTimes(2);
    handle.set({
      browser: {
        url: "http://127.0.0.1:4321/",
        title: "Fixture",
        loading: false,
        canGoBack: false,
        canGoForward: false,
      },
    });
    expect(arrived).toHaveBeenCalledTimes(3);
    // a publish that says nothing new is not an arrival
    handle.set({});
    expect(arrived).toHaveBeenCalledTimes(3);
  });

  it("TAKE presents the newest frame ONCE into ICE's writer on the desk's device — from the frame's visibleRect, its lease released", () => {
    const { face, presentation, writers, device } = attached();
    face.take();
    face.demand(SEEN);
    const older = presentation.land();
    const newest = presentation.land();
    expect(face.take()).toBe(true);
    expect(writers).toHaveLength(1);
    expect(writers[0]?.device).toBe(device);
    expect(writers[0]?.o).toEqual({
      label: "vibefield.browser-pane/live 13918995204487956201-1",
      width: 2560,
      height: 1600,
    });
    expect(writers[0]?.presented).toEqual([
      { frame: newest, rect: { x: 4, y: 2, width: 2560, height: 1600 } },
    ]);
    // the older one was closed on arrival of the newer, the newest after its copy: no lease outlives a take
    expect(older.close).toHaveBeenCalled();
    expect(newest.close).toHaveBeenCalledTimes(1);
    expect(face.texture()?.width).toBe(2560);
    // nothing new: nothing taken, no redraw
    expect(face.take()).toBe(false);
  });

  it("an UNSEEN face's frame is taken and closed, drawn nowhere, no redraw (ruling 6) — and so is one before the desk's device", () => {
    const { face, presentation, writers, live } = attached();
    face.take();
    face.demand(UNSEEN);
    const frame = presentation.land();
    expect(face.take()).toBe(false);
    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(writers).toHaveLength(0);
    expect(live.stats().dropped).toBe(1);

    const t = attached({ device: () => undefined });
    t.face.take();
    t.face.demand(SEEN);
    const early = t.presentation.land();
    expect(t.face.take()).toBe(false);
    expect(early.close).toHaveBeenCalledTimes(1);
    expect(t.writers).toHaveLength(0);
  });

  it("the face's STATE reads the pool's handle and the producer's summary; its WORDS the producer's navigation truth", () => {
    const t = setup();
    const face = t.live.open("k-1", PAGE, () => {});
    const handle = t.handles[0];
    if (handle === undefined) throw new Error("no handle");
    expect(face.state()).toEqual({ is: "starting" });
    handle.set({ status: "live", presentation: fakePresentation("live") as never });
    expect(face.state()).toEqual({ is: "live" });
    handle.set({ presentation: fakePresentation("paused") as never });
    expect(face.state()).toEqual({ is: "paused" });
    handle.set({ status: "lost", presentation: null, error: new Error("the window went away") });
    const lost = face.state();
    expect(lost).toMatchObject({ is: "failed", reason: "the window went away" });
    if (lost.is === "failed") lost.retry?.();
    expect(handle.retried).toBe(1);

    expect(face.info()).toEqual({});
    handle.set({
      status: "live",
      presentation: fakePresentation("live") as never,
      browser: {
        url: "http://127.0.0.1:4321/page",
        title: "Fixture",
        loading: true,
        canGoBack: true,
        canGoForward: false,
      },
    });
    expect(face.info()).toEqual({
      address: "http://127.0.0.1:4321/page",
      title: "Fixture",
      loading: 0.5,
      back: true,
      forward: false,
    });
  });

  it("CLOSE releases the holder, destroys the writer and frees the key; a key opened twice is a host error, said", () => {
    const { face, handle, presentation, writers, live } = attached();
    expect(() => live.open("13918995204487956201-1", PAGE, () => {})).toThrow(/open twice/);
    face.demand(SEEN);
    presentation.land();
    face.take();
    face.close();
    face.close();
    expect(handle.released).toBe(1);
    expect(writers[0]?.destroyed).toBe(1);
    expect(presentation.listeners()).toBe(0);
    expect(face.state()).toEqual({ is: "closed" });
    expect(face.take()).toBe(false);
    expect(live.stats().open).toBe(0);
    // the key is free again
    live.open("13918995204487956201-1", PAGE, () => {});
    expect(live.stats().open).toBe(1);
  });

  it("a REMOUNT's service makes its writers on ITS device — the pool's page is the same key", () => {
    const first = attached();
    first.face.demand(SEEN);
    first.presentation.land();
    first.face.take();
    first.live.dispose();
    expect(first.handles[0]?.released).toBe(1);
    const other = { id: "remounted-device" } as unknown as GPUDevice;
    const second = attached({ device: () => other });
    second.face.demand(SEEN);
    second.presentation.land();
    second.face.take();
    expect(second.handles[0]?.key).toBe(first.handles[0]?.key);
    expect(second.writers[0]?.device).toBe(other);
  });

  it("a face's ROW is what a smoke reads: the kind's ask, LSF's wire demand for its page, its arrivals, presents and drops, its texture; the stats count the writers made", () => {
    const { face, handle, presentation, live } = attached();
    face.take();
    expect(live.faces()).toEqual([
      {
        key: "13918995204487956201-1",
        demand: undefined,
        wire: null,
        state: { is: "live" },
        arrivals: 0,
        presented: 0,
        dropped: 0,
        texture: undefined,
      },
    ]);
    face.demand(UNSEEN);
    presentation.land();
    face.take();
    face.demand(SEEN);
    handle.wire = { revision: 2, mode: "live", targetFps: 30 };
    presentation.land();
    presentation.land();
    face.take();
    expect(live.faces()).toEqual([
      {
        key: "13918995204487956201-1",
        demand: SEEN,
        wire: { revision: 2, mode: "live", targetFps: 30 },
        state: { is: "live" },
        arrivals: 3,
        presented: 1,
        dropped: 1,
        texture: { width: 2560, height: 1600, revision: 1, epoch: 0 },
      },
    ]);
    expect(live.stats()).toMatchObject({ presented: 1, dropped: 1, writers: 1 });
    // a refused face is a row too: its state says why, and it counts nothing
    const refused = setup({ gate: () => ({ refused: "no object on this board holds this face" }) });
    refused.live.open("k-2", PAGE, () => {});
    expect(refused.live.faces()).toEqual([
      {
        key: "k-2",
        demand: undefined,
        wire: null,
        state: { is: "failed", reason: "no object on this board holds this face" },
        arrivals: 0,
        presented: 0,
        dropped: 0,
        texture: undefined,
      },
    ]);
  });

  it("the GATE's refusal is a failed face with the words — no page, no pool, nothing taken", () => {
    const t = setup({
      gate: () => ({
        refused: "FORBIDDEN_SCOPE: plugin acme.tools is not granted surface.browser",
      }),
    });
    const face = t.live.open("k-1", PAGE, () => {});
    expect(t.handles).toHaveLength(0);
    expect(face.state()).toEqual({
      is: "failed",
      reason: "FORBIDDEN_SCOPE: plugin acme.tools is not granted surface.browser",
    });
    expect(face.take()).toBe(false);
    expect(face.texture()).toBeUndefined();
    face.close();
    expect(t.live.stats()).toMatchObject({ refused: 1, open: 0 });
  });

  it("refuses a spec it cannot read, and a window with no live surfaces — each a failed face, said", () => {
    const unread = setup().live.open("k-1", { ...PAGE, viewport: "wide" }, () => {});
    expect(unread.state()).toEqual({ is: "failed", reason: "not a page this desk can open" });
    const none = setup({ pool: () => null }).live.open("k-1", PAGE, () => {});
    expect(none.state()).toEqual({
      is: "failed",
      reason: "live pages are unavailable in this window",
    });
  });
});

describe("the demand map — the kind's LiveDemand in the pool's words (ruling 5)", () => {
  it("fps to the nearest LSF bucket not above — a live ask never under 2; paused is 0", () => {
    expect([60, 45, 30, 29, 15, 12, 10, 5, 3, 2, 1, 0].map((f) => fpsBucket(f, true))).toEqual([
      60, 30, 30, 15, 15, 10, 10, 5, 2, 2, 2, 2,
    ]);
    expect(fpsBucket(30, false)).toBe(0);
  });

  it("at rest: live at the bucket, the raster and the logical viewport, priority 50", () => {
    expect(liveDemandIntent(SEEN)).toEqual({
      mode: "live",
      targetFps: 30,
      targetRasterSize: { width: 1280, height: 800 },
      logicalViewport: { width: 1280, height: 800 },
      priority: 50,
      interactive: false,
    });
  });

  it("held: interactive at priority 80; unseen: paused at 0 fps, its layout kept", () => {
    expect(
      liveDemandIntent({ ...SEEN, fps: 60, raster: [2560, 1600], interactive: true }),
    ).toMatchObject({
      mode: "live",
      targetFps: 60,
      targetRasterSize: { width: 2560, height: 1600 },
      priority: 80,
      interactive: true,
    });
    expect(liveDemandIntent(UNSEEN)).toEqual({
      mode: "paused",
      targetFps: 0,
      priority: 0,
      interactive: false,
      logicalViewport: { width: 1280, height: 800 },
    });
  });

  it("a demand reaches the pool's handle as the map says, each one sent", () => {
    const { face, handle } = attached();
    face.demand(SEEN);
    face.demand(UNSEEN);
    expect(handle.demands).toEqual([liveDemandIntent(SEEN), liveDemandIntent(UNSEEN)]);
  });
});
