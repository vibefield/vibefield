// THE DESK'S LIVE SERVICE under a test's hand (desk-live.test.ts, desk-live-stills.test.ts, desk-live-cap.test.ts): a FAKE pool
// (each acquire a handle whose state the test sets; its snapshot says each key's holders, as the window's pool does), a fake
// presentation (frames LAND), a fake writer (ICE's, its presents recorded) — and, PT-5b, a clock with its timers, a shelf of
// stills, and the host's two hands on a page's pixels as fakes.
import type { LiveTextureOptions, LiveWriter } from "@vibecook/ice/desk";
import type { LiveDemand } from "@vibecook/ice/desk/kit";
import type { LiveSurfaceFrameMetadataV1, LiveSurfaceRuntimeSummaryV1 } from "@vibefield/contracts";
import { vi } from "vitest";
import { createDeskLiveSources, type DeskLiveDeps } from "../src/surfaces/live/desk-live";
import type { PageStill } from "../src/surfaces/live/page-stills";
import type {
  SurfaceAcquireOptions,
  SurfaceDemandRequest,
  SurfaceHandleState,
} from "../src/surfaces/pool";

export const PAGE = {
  source: "browser",
  url: "http://127.0.0.1:4321/",
  viewport: [1280, 800],
  deviceScaleFactor: 2,
  scheme: "light",
  label: "Browser",
};
/** What PAGE's device is in LSF's words: the engine's own (no agent), a pointer device, the spec's scheme. */
export const LAPTOP_TOLD = {
  deviceScaleFactor: 2,
  mobile: false,
  touchPoints: 0,
  colorScheme: "light",
};
export const IPHONE = {
  mobile: true,
  touchPoints: 5,
  agent: {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    navigatorPlatform: "iPhone",
    platform: "iOS",
    platformVersion: "26.0",
    model: "iPhone",
  },
};
export const PHONE_PAGE = {
  ...PAGE,
  viewport: [402, 874],
  deviceScaleFactor: 3,
  scheme: "dark",
  device: IPHONE,
};
export const PHONE_TOLD = {
  deviceScaleFactor: 3,
  mobile: true,
  touchPoints: 5,
  agent: {
    userAgent: IPHONE.agent.userAgent,
    navigatorPlatform: "iPhone",
    hints: {
      platform: "iOS",
      platformVersion: "26.0",
      architecture: "",
      model: "iPhone",
      mobile: true,
    },
  },
  colorScheme: "dark",
};
export const SEEN: LiveDemand = {
  mode: "live",
  fps: 30,
  raster: [1280, 800],
  viewport: [1280, 800],
  interactive: false,
};
export const UNSEEN: LiveDemand = {
  mode: "paused",
  fps: 0,
  raster: [0, 0],
  viewport: [1280, 800],
  interactive: false,
};

export function metadata(
  logicalSize: { width: number; height: number } = { width: 1280, height: 800 },
): LiveSurfaceFrameMetadataV1 {
  return {
    v: 1,
    surfaceId: "surface_0123456789abcdef",
    producerEpoch: 1,
    sequence: "1",
    geometry: {
      revision: 1,
      codedSize: { width: 2600, height: 1620 },
      visibleRect: { x: 4, y: 2, width: 2560, height: 1600 },
      logicalSize,
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
export function fakePresentation(
  summaryState: LiveSurfaceRuntimeSummaryV1["state"] = "live",
  logicalSize?: { width: number; height: number },
) {
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
        const ok = consumer(frame, metadata(logicalSize));
        return ok
          ? { kind: "consumed" as const, metadata: metadata(logicalSize) }
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
export function fakeHandle(key: string, opts: SurfaceAcquireOptions) {
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
      h.order.push("demand");
    },
    /** What the face sent down the page's lane, with the revision it was stamped with; and its navigations. */
    inputs: [] as { event: unknown; revision: number | undefined }[],
    navigations: [] as unknown[],
    /** PT-4: the emulations told down the lane (the `emulate` commands), apart from the chrome's navigations. */
    emulations: [] as unknown[],
    /** Every send in the order it went: "demand" and "emulate". */
    order: [] as string[],
    lane: true,
    sendInput(event: unknown, revision?: number) {
      if (!h.lane) return false;
      h.inputs.push({ event, revision });
      return true;
    },
    navigate(command: { action: string; emulation?: unknown }) {
      if (!h.lane || state.status !== "live") return false;
      if (command.action === "emulate") {
        h.emulations.push(command.emulation);
        h.order.push("emulate");
      } else h.navigations.push(command);
      return true;
    },
    retry() {
      h.retried += 1;
    },
    /** PT-5a: how many times a favicon's bytes arrived on the page's attachment (the pool's word). */
    faviconArrivals: 0,
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

export function setup(over: Partial<DeskLiveDeps> = {}) {
  const handles: ReturnType<typeof fakeHandle>[] = [];
  const writers: {
    device: unknown;
    o: LiveTextureOptions;
    presented: unknown[];
    destroyed: number;
  }[] = [];
  const device = { id: "desk-device" } as unknown as GPUDevice;
  const requests: { method: string; params: unknown }[] = [];
  /** When the grace of a page nobody holds lapses, as the pool's snapshot says it (a test sets it; none by default). */
  const graceAt = { at: null as number | null };
  /** A test's word on each handle the pool hands out. */
  const hooks: { acquired?: (handle: ReturnType<typeof fakeHandle>) => void } = {};
  const deps: DeskLiveDeps = {
    pool: () =>
      ({
        disposed: false,
        acquire(key: string, opts: SurfaceAcquireOptions) {
          const prior = handles.filter((x) => x.key === key).at(-1);
          const h = fakeHandle(key, opts);
          handles.push(h);
          // the key's lane stands (the pool's grace kept it): a new holder sees it as it is, at once
          if (prior !== undefined && prior.status === "live") h.set(prior.state);
          hooks.acquired?.(h);
          return h as never;
        },
        // each key once, as the window's pool says it: its wire (the first handle's — a test sets it there), who holds
        // it, its lane's status, and — held by nobody — when its grace lapses
        snapshot: () =>
          ({
            entries: [...new Set(handles.map((h) => h.key))].map((key) => {
              const of = handles.filter((h) => h.key === key);
              const holders = of.filter((h) => h.released === 0).length;
              return {
                key,
                demand: of[0]?.wire ?? null,
                holders,
                status: of[of.length - 1]?.status,
                graceDeadlineAt: holders === 0 ? graceAt.at : null,
              };
            }),
          }) as never,
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
        logical: [o.width, o.height] as readonly [number, number],
        view: () => ({}) as never,
        prepare: () => {},
        bytes: 0,
      };
      const writer: LiveWriter = {
        face,
        present: (frame, rect, logical) => {
          face.revision += 1;
          // (ICE's writer: the frame's logical size is the texture's from this present on)
          if (logical !== undefined) face.logical = logical;
          w.presented.push({ frame, rect, logical });
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
  return { live, handles, writers, device, requests, graceAt, hooks };
}

/** A face opened and attached live, its presentation in hand. */
export function attached(over: Partial<DeskLiveDeps> = {}) {
  const t = setup(over);
  const arrived = vi.fn();
  const face = t.live.open("13918995204487956201-1", PAGE, arrived);
  const handle = t.handles[0];
  if (handle === undefined) throw new Error("no handle");
  const presentation = fakePresentation();
  handle.set({ status: "live", presentation: presentation as never });
  return { ...t, face, handle, presentation, arrived };
}

/** PT-5b — a clock under the test's hand, and its timers: `advance` runs what came due, in order. */
export function fakeClock(start = 1_000_000) {
  let t = start;
  let serial = 0;
  const pending: { at: number; fn: () => void; id: number }[] = [];
  return {
    now: () => t,
    timers: {
      set(fn: () => void, ms: number): unknown {
        const timer = { at: t + ms, fn, id: ++serial };
        pending.push(timer);
        return timer;
      },
      clear(handle: unknown): void {
        const at = pending.indexOf(handle as (typeof pending)[number]);
        if (at >= 0) pending.splice(at, 1);
      },
    },
    advance(ms: number): void {
      const until = t + ms;
      for (;;) {
        const due = pending.filter((p) => p.at <= until).sort((a, b) => a.at - b.at || a.id - b.id);
        const next = due[0];
        if (next === undefined) break;
        pending.splice(pending.indexOf(next), 1);
        t = Math.max(t, next.at);
        next.fn();
      }
      t = until;
    },
    pending: () => pending.length,
  };
}

/** PT-5b — the shelf of page stills as the service holds it, in memory; and the host's two hands on a page's pixels: the
 * taker answers a picture the size of the face it read (and says what it read, in `log`), the decoder a bitmap. */
export function fakeStills(log: string[] = []) {
  const shelf = new Map<string, PageStill>();
  const name = (docId: string, key: string): string => `${docId}/${key}`;
  const bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[] = [];
  return {
    shelf,
    log,
    bitmaps,
    stills: {
      keep: vi.fn(async (docId: string, key: string, still: PageStill) => {
        log.push(`keep ${key}`);
        shelf.set(name(docId, key), still);
      }),
      kept: vi.fn(async (docId: string, key: string) => shelf.get(name(docId, key))),
      forget: vi.fn(async (docId: string, key: string) => {
        log.push(`forget ${key}`);
        shelf.delete(name(docId, key));
      }),
    },
    takeStill: vi.fn(async (_device: GPUDevice, face: { width: number; height: number }) => {
      log.push("take");
      return {
        type: "image/webp",
        image: new Uint8Array([7, 7, 7]),
        size: [face.width, face.height] as const,
      };
    }),
    decodeStill: vi.fn(async (still: { image: Uint8Array }) => {
      const bitmap = { width: 800, height: 500, close: vi.fn(), of: still.image };
      bitmaps.push(bitmap);
      return bitmap as unknown as ImageBitmap;
    }),
  };
}

/** A still as the shelf keeps it. */
export const stillOf = (over: Partial<PageStill> = {}): PageStill => ({
  address: PAGE.url,
  logical: [1280, 800],
  size: [800, 500],
  type: "image/webp",
  image: new Uint8Array([1, 2, 3]),
  takenAt: 900_000,
  ...over,
});

/** A page's browser state as LSF says it. */
export const browserAt = (url: string, over: Record<string, unknown> = {}) => ({
  url,
  title: "Fixture",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  ...over,
});

export const HELD: LiveDemand = { ...SEEN, fps: 60, interactive: true };

export const KEY = "13918995204487956201-1";
export const DOC = "doc-1";

/** PT-5b — the service with a document, a shelf, the two hands, a clock: and a pane's face opened on it. */
export function stage(over: Partial<DeskLiveDeps> = {}) {
  const clock = fakeClock();
  const log: string[] = [];
  const shelf = fakeStills(log);
  const exists = { value: true as boolean | undefined };
  const t = setup({
    docId: () => DOC,
    stills: shelf.stills,
    takeStill: shelf.takeStill as never,
    decodeStill: shelf.decodeStill as never,
    now: clock.now,
    timers: clock.timers,
    exists: () => exists.value,
    graceMs: () => 60_000,
    ...over,
  });
  /** What the pages' producers owe (see `pump`). */
  const owed: (() => void)[] = [];
  type Handle = (typeof t.handles)[number];
  /** A page as main holds it: its producer's state (the presentation's summary), and every handle the pool gave for its key. */
  interface Staged {
    readonly presentation: ReturnType<typeof fakePresentation>;
    readonly handles: Handle[];
    attached: boolean;
    /** Its producer answers nothing any more (a main process that hangs). */
    deaf?: boolean;
  }
  const pages = new Map<string, Staged>();
  const RANK: Record<string, number> = { hibernated: 0, paused: 1, live: 2 };
  /** The pool's fold of what its holders ask: the most any of them asks; nobody holding: paused. */
  const folded = (page: Staged): string => {
    let most: string | undefined;
    for (const h of page.handles) {
      if (h.released > 0) continue;
      const mode = ((h.demands.at(-1) ?? h.opts.initialDemand) as { mode: string }).mode;
      if (most === undefined || (RANK[mode] ?? 0) > (RANK[most] ?? 0)) most = mode;
    }
    return most ?? "paused";
  };
  /** The producer's state said again (the same presentation: its frames still land), to every holder. */
  const sayOf = (page: Staged, state: LiveSurfaceRuntimeSummaryV1["state"]): void => {
    page.presentation.summary = {
      state,
      transport: "shared-texture",
    } as LiveSurfaceRuntimeSummaryV1;
    for (const h of page.handles) if (h.released === 0) h.set({});
  };
  /** The producer ANSWERS what it is asked, as LSF's does: live makes or resumes its page, paused pauses it, hibernated
   * lets its window go — a paused ask makes nothing of a page that has none. */
  const answer = (page: Staged): void => {
    if (!page.attached || page.deaf === true) return;
    const was = page.presentation.summary.state;
    const mode = folded(page);
    const next =
      mode === "live"
        ? was === "created" || was === "hibernated" || was === "paused"
          ? "live"
          : was
        : mode === "paused"
          ? was === "live"
            ? "paused"
            : was
          : was === "live" || was === "paused"
            ? "hibernated"
            : was;
    if (next !== was) sayOf(page, next);
  };
  const seen = (page: Staged, h: Handle): void =>
    h.set({
      status: "live",
      presentation: page.presentation as never,
      browser: browserAt(PAGE.url) as never,
    });
  /** A handle the pool gave for the page's key: its asks and its release reach the producer when the test `pump`s (never
   * inside the ask — a summary crosses a port). */
  const join = (page: Staged, h: Handle): void => {
    page.handles.push(h);
    const ask = h.setDemand;
    h.setDemand = (d) => {
      ask.call(h, d);
      owed.push(() => answer(page));
    };
    const release = h.release;
    h.release = () => {
      release.call(h);
      owed.push(() => answer(page));
    };
    if (!page.attached) return;
    seen(page, h);
    owed.push(() => answer(page));
  };
  t.hooks.acquired = (h) => {
    const page = pages.get(h.key);
    if (page !== undefined) join(page, h);
  };
  /**
   * A pane's face opened; `live`: its lane attached, its page saying its address; `summary`: its producer's state then
   * (`created`: a page nothing has been made of yet). A key opened again finds its page as it stands.
   */
  const open = (
    key = KEY,
    live = true,
    summary: LiveSurfaceRuntimeSummaryV1["state"] = "live",
    spec: Readonly<Record<string, unknown>> = PAGE,
  ) => {
    const arrived = vi.fn();
    const face = t.live.open(key, spec, arrived);
    const handle = t.handles[t.handles.length - 1];
    if (handle === undefined) throw new Error("no handle");
    let page = pages.get(handle.key);
    if (page === undefined) {
      page = { presentation: fakePresentation(summary), handles: [], attached: false };
      pages.set(handle.key, page);
      join(page, handle);
    }
    const staged = page;
    const presentation = staged.presentation;
    const say = (state: LiveSurfaceRuntimeSummaryV1["state"]): void => sayOf(staged, state);
    const attach = (): void => {
      staged.attached = true;
      for (const h of staged.handles) if (h.released === 0) seen(staged, h);
      // the ask the pool held while the lane attached reaches the producer now
      owed.push(() => answer(staged));
    };
    if (live && !staged.attached) attach();
    /** A frame lands and is drawn. */
    const frame = (): boolean => {
      presentation.land();
      return face.take();
    };
    /** The mode last written to its wire. */
    const wire = (): string | undefined => (handle.demands.at(-1) as { mode?: string })?.mode;
    /** Its producer answers nothing from here on. */
    const deaf = (): void => {
      staged.deaf = true;
    };
    return { key, face, handle, presentation, arrived, attach, frame, say, wire, deaf };
  };
  /** What the service has in flight that CAN finish does (every fake answers within a few turns of the microtask queue). */
  const turns = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  /** Every producer answers what it was asked, and what the service asks in answer, until all is quiet. (Not `settled()`:
   * a rest in flight waits for its page's answer, which is owed here.) */
  const pump = async (): Promise<void> => {
    for (let turn = 0; turn < 500; turn += 1) {
      await turns();
      const next = owed.shift();
      if (next === undefined) return;
      next();
    }
    throw new Error("the producers never went quiet");
  };
  return { ...t, clock, shelf, log, exists, open, pump };
}

/** The page's summary said again (a producer that failed, hibernated…), its browser state with it. */
export const says = (
  handle: { set(next: Record<string, unknown>): void },
  state: string,
  over: { error?: Record<string, unknown>; browser?: Record<string, unknown> } = {},
): void =>
  handle.set({
    presentation: {
      ...fakePresentation(state as never),
      summary: {
        state,
        transport: "shared-texture",
        ...(over.error === undefined ? {} : { error: over.error }),
      },
    },
    ...(over.browser === undefined ? {} : { browser: over.browser }),
  });
