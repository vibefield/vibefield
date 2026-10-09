// THE DESK'S LIVE SERVICE (PT-2 — ICE design-019 §3.2, the host's half of the live face; PORTALS' rulings 1–6): what VibeField
// lends the desk under ICE's `LIVE` key. A kind opens a FACE per object by the object's durable key; the service holds the page
// behind it in the window's LSF pool and fills the face's texture — the kind holds a view and words, never a frame (PA-22 by
// construction: the frame lives in the pool's lease and leaves it only into ICE's writer).
//  - THE GATE (ruling 3) is the host's, by the OBJECT: the key's entity, its type, the plugin that contributes it, that plugin's
//    effective capabilities — `surface.attach` and `surface.browser` for a browser page, a failed face with the words otherwise.
//    Nothing a kind writes in its spec grants anything.
//  - THE KEYS (ruling 4): the pool's key is `desk:<key>` (apart from any panel's); the mint's `reuseKey` is the durable key
//    itself, so a reload re-attaches the SAME running page (fieldd forwards it to custody since PT-2).
//  - ONE COPY (ruling 1): a frame is taken through the presentation's `presentLatestVia` — its lease released on every path —
//    straight into ICE's writer, on the DESK's device, from LSF's `visibleRect`. LSF's own texture store is not used here.
//  - THE WAKE: the attachment tells of a landed frame (`onFrame`) and the handle of a moved state or page (`onState`); each is one
//    `arrived()`. `take()` presents the newest frame once; an UNSEEN face's frame is taken and closed, drawn nowhere (ruling 6).
//  - THE DEMAND (ruling 5): the kind's `LiveDemand` → the pool's intent (fps to the nearest bucket not above, the raster, the
//    page's logical viewport, priority 80 in use / 50 at rest).
//  - ONE SERVICE PER DESK MOUNT: its writers are made on that mount's device; a remount makes a new service, and the pool's
//    grace keeps the page attached across it.

import {
  LIVE_SURFACE_FPS_BUCKETS_V1,
  type LiveSurfaceDemandV1,
  type LiveSurfaceFpsBucketV1,
  SurfaceOpenResultV1,
} from "@vibefield/contracts";
import { type LiveBrowserSpec, liveBrowserSpec } from "@vibefield/plugin-sdk/desk";
import type {
  ProductSurfaceFrame,
  SurfaceDemandIntent,
  SurfaceHandle,
  SurfaceHandleState,
  SurfacePool,
} from "../pool";
import type {
  LiveDemand,
  LiveFace,
  LiveInfo,
  LiveSources,
  LiveState,
  LiveTexture,
  LiveTextureOptions,
  LiveWriter,
} from "./ice-live";

/** What the gate answers for a face's key: the object's type (its kind's name — the texture's label), or why it may not open. */
export type LiveGateAnswer = { readonly type: string } | { readonly refused: string };

export interface DeskLiveDeps {
  /** The window's surface pool; null on a host with no live surfaces (every face fails, said). */
  readonly pool: () => SurfacePool<ProductSurfaceFrame> | null;
  /** The WINDOW's product connection — the mint rides it, as the plugin door's does (surface-door.tsx). Null: daemon away. */
  readonly mintClient: () => { request(method: string, params?: unknown): Promise<unknown> } | null;
  /** The capability gate (ruling 3), by the object the key names. */
  readonly gate: (key: string) => LiveGateAnswer;
  /** The desk's device (`deskLayer({ onDevice })`); undefined before it arrives. */
  readonly device: () => GPUDevice | undefined;
  /** ICE's writer — `createLiveTexture` — the HOST's. */
  readonly writer: (device: GPUDevice, o: LiveTextureOptions) => LiveWriter;
}

/** What the service counts — a smoke reads it through the desk door. */
export interface DeskLiveStats {
  readonly opened: number;
  readonly open: number;
  readonly refused: number;
  readonly presented: number;
  /** Frames taken for an unseen face (or with no device yet) and closed, drawn nowhere (ruling 6). */
  readonly dropped: number;
  readonly demands: number;
  /** ICE writers made — one per face and device; a remade one is a new texture (the PLAYING row's "none remade"). */
  readonly writers: number;
}

/** One open face as a smoke reads it. */
export interface DeskLiveFaceRow {
  readonly key: string;
  /** The kind's last ask (undefined before its law has spoken: paused). */
  readonly demand: LiveDemand | undefined;
  /** What the pool last wrote to the wire for the page — LSF's demand — null before any. */
  readonly wire: LiveSurfaceDemandV1 | null;
  readonly state: LiveState;
  /** Frames the attachment told of; frames presented into the texture; frames taken and closed unseen. */
  readonly arrivals: number;
  readonly presented: number;
  readonly dropped: number;
  /** The face's texture: its size, its present count, its generation (a remade texture is a new epoch). */
  readonly texture:
    | {
        readonly width: number;
        readonly height: number;
        readonly revision: number;
        readonly epoch: number;
      }
    | undefined;
}

export interface DeskLiveSources extends LiveSources {
  stats(): DeskLiveStats;
  /** The faces open now — a smoke's witness of the law's asks, the source's pace and the texture's life. */
  faces(): readonly DeskLiveFaceRow[];
  /** Every face closed (the mount is going). */
  dispose(): void;
}

/** LSF's fps buckets — the nearest not above `fps`; a live ask is never under the first rate (2). */
export function fpsBucket(fps: number, live: boolean): LiveSurfaceFpsBucketV1 {
  if (!live) return 0;
  let best: LiveSurfaceFpsBucketV1 = 2;
  for (const b of LIVE_SURFACE_FPS_BUCKETS_V1) if (b > 0 && b <= fps) best = b;
  return best;
}

/** THE DEMAND MAP (ruling 5): the kind's `LiveDemand` in the pool's words. */
export function liveDemandIntent(d: LiveDemand): SurfaceDemandIntent {
  const logicalViewport =
    d.viewport === undefined ? undefined : { width: d.viewport[0], height: d.viewport[1] };
  if (d.mode === "paused")
    return {
      mode: "paused",
      targetFps: 0,
      priority: 0,
      interactive: false,
      ...(logicalViewport === undefined ? {} : { logicalViewport }),
    };
  const raster =
    d.raster[0] >= 1 && d.raster[1] >= 1
      ? { width: Math.round(d.raster[0]), height: Math.round(d.raster[1]) }
      : undefined;
  return {
    mode: "live",
    targetFps: fpsBucket(d.fps, true),
    ...(raster === undefined ? {} : { targetRasterSize: raster }),
    ...(logicalViewport === undefined ? {} : { logicalViewport }),
    priority: d.interactive ? 80 : 50,
    interactive: d.interactive,
  };
}

/** The face's state, read off the pool's handle and the producer's summary. */
export function liveStateOf(
  state: SurfaceHandleState<ProductSurfaceFrame>,
  retry: () => void,
): LiveState {
  switch (state.status) {
    case "attaching":
      return { is: "starting" };
    case "released":
      return { is: "closed" };
    case "lost":
      return { is: "failed", reason: state.error?.message ?? "the page was lost", retry };
    case "live": {
      const summary = state.presentation?.summary;
      switch (summary?.state) {
        case undefined:
        case "created":
        case "starting":
        case "reconnecting":
          return { is: "starting" };
        case "live":
          return { is: "live" };
        case "closed":
          return { is: "closed" };
        case "failed":
          return { is: "failed", reason: summary.error?.message ?? "the page failed", retry };
        default:
          // paused, hibernated: the last frame holds
          return { is: "paused" };
      }
    }
  }
}

/** LSF reports a page loading, not how far: an indeterminate line (half way). */
const LOADING = 0.5;

/** The face's words, read off the producer's committed navigation truth (`LiveSurfaceBrowserStateV1`). */
export function liveInfoOf(state: SurfaceHandleState<ProductSurfaceFrame>): LiveInfo {
  const b = state.browser;
  const degraded =
    state.presentation?.summary.transport === "cpu-bgra" ? { degraded: "cpu-bitmap" } : {};
  if (b === null) return degraded;
  return {
    address: b.url,
    ...(b.title === undefined ? {} : { title: b.title }),
    ...(b.loading ? { loading: LOADING } : {}),
    back: b.canGoBack,
    forward: b.canGoForward,
    ...degraded,
  };
}

/** What a face says, as one string — so the handle's every publish is not a change of the face's words. */
const wordsOf = (state: SurfaceHandleState<ProductSurfaceFrame>): string =>
  JSON.stringify([
    state.status,
    state.presentation?.summary.state ?? null,
    state.browser,
    state.error?.message ?? null,
  ]);

/** A face that cannot open: its state says why; it takes nothing, draws its film, closes to nothing. */
function failedFace(key: string, reason: string, release: () => void): LiveFace {
  let closed = false;
  return {
    key,
    texture: () => undefined,
    take: () => false,
    state: () => (closed ? { is: "closed" } : { is: "failed", reason }),
    info: () => ({}),
    demand: () => {},
    close() {
      if (closed) return;
      closed = true;
      release();
    },
  };
}

/** The face's page in the pool: apart from any panel's (ruling 4). */
const poolKey = (key: string): string => `desk:${key}`;

/** LSF's browser source for a page: a memory profile per face, laid out at the page's viewport. */
function browserSource(key: string, page: LiveBrowserSpec) {
  return {
    kind: "browser" as const,
    initialUrl: page.url,
    profile: { mode: "memory" as const, ref: poolKey(key) },
    logicalViewport: { width: page.viewport[0], height: page.viewport[1] },
  };
}

export function createDeskLiveSources(deps: DeskLiveDeps): DeskLiveSources {
  const faces = new Map<string, { face: LiveFace; row: () => DeskLiveFaceRow }>();
  const counts = { opened: 0, refused: 0, presented: 0, dropped: 0, demands: 0, writers: 0 };
  const wireOf = (key: string): LiveSurfaceDemandV1 | null =>
    deps
      .pool()
      ?.snapshot()
      .entries.find((entry) => entry.key === poolKey(key))?.demand ?? null;

  const refuse = (key: string, reason: string): LiveFace => {
    counts.refused += 1;
    const face = failedFace(key, reason, () => faces.delete(key));
    faces.set(key, {
      face,
      row: () => ({
        key,
        demand: undefined,
        wire: null,
        state: face.state(),
        arrivals: 0,
        presented: 0,
        dropped: 0,
        texture: undefined,
      }),
    });
    return face;
  };

  const open = (
    key: string,
    spec: Readonly<Record<string, unknown>>,
    arrived: () => void,
  ): LiveFace => {
    // one face per key per desk (design-019 §3.2): a key opened twice is a host error, said
    if (faces.has(key))
      throw new Error(`desk LIVE: the face "${key}" is open twice — one face per key per desk`);
    counts.opened += 1;
    const page = liveBrowserSpec(spec);
    if (page === undefined) return refuse(key, "not a page this desk can open");
    const gate = deps.gate(key);
    if ("refused" in gate) return refuse(key, gate.refused);
    const pool = deps.pool();
    if (pool === null) return refuse(key, "live pages are unavailable in this window");
    const label = `${gate.type}/live ${key}`;
    let handle: SurfaceHandle<ProductSurfaceFrame>;
    try {
      handle = pool.acquire(poolKey(key), {
        // paused until the kind's law has seen the face: the page is made and laid out at its viewport, painting nothing yet
        initialDemand: liveDemandIntent({
          mode: "paused",
          fps: 0,
          raster: [0, 0],
          viewport: page.viewport,
          interactive: false,
        }),
        tickets: {
          async mint() {
            const client = deps.mintClient();
            if (client === null)
              throw new Error("no fieldd connection (daemon away or still booting)");
            const raw = await client.request("surface.open", {
              source: browserSource(key, page),
              reuseKey: key,
            });
            const opened = SurfaceOpenResultV1.parse(raw);
            return { ticket: opened.ticket, surfaceId: opened.surfaceId };
          },
          async close(surfaceId: string) {
            const client = deps.mintClient();
            if (client === null) return;
            await client.request("surface.close", { surfaceId });
          },
        },
      });
    } catch (error) {
      return refuse(key, error instanceof Error ? error.message : String(error));
    }

    let closed = false;
    let presentation = handle.presentation;
    let offFrame: (() => void) | null = null;
    /** A frame landed since the last take; the state or the page's words moved since the last take. */
    let frameOwed = false;
    let wordsOwed = false;
    let words = wordsOf(handle.state);
    /** The last demand the kind sent: paused (unseen) until it says otherwise. */
    let asked: LiveDemand | undefined;
    let writer: LiveWriter | undefined;
    let writerDevice: GPUDevice | undefined;
    const tally = { arrivals: 0, presented: 0, dropped: 0 };
    // close() unsubscribes both listeners at once, so nothing tells after it
    const tell = (): void => arrived();
    const listen = (next: SurfaceHandleState<ProductSurfaceFrame>["presentation"]): void => {
      if (next === presentation && offFrame !== null) return;
      offFrame?.();
      presentation = next;
      offFrame =
        presentation?.onFrame(() => {
          tally.arrivals += 1;
          frameOwed = true;
          tell();
        }) ?? null;
    };
    listen(presentation);
    const offState = handle.onState((state) => {
      if (state.presentation !== presentation) listen(state.presentation);
      const now = wordsOf(state);
      if (now === words) return;
      words = now;
      wordsOwed = true;
      tell();
    });

    const face: LiveFace = {
      key,
      texture: (): LiveTexture | undefined => writer?.face,
      take(): boolean {
        if (closed) return false;
        const changed = wordsOwed;
        wordsOwed = false;
        if (!frameOwed) return changed;
        frameOwed = false;
        const p = presentation;
        if (p === null || p.closed) return changed;
        const device = deps.device();
        if (asked === undefined || asked.mode === "paused" || device === undefined) {
          // an unseen face's frame (ruling 6) — or one before the device: taken and closed, drawn nowhere
          if (p.presentLatestVia(() => false).kind !== "idle") {
            counts.dropped += 1;
            tally.dropped += 1;
          }
          return changed;
        }
        const r = p.presentLatestVia((frame, metadata) => {
          const rect = metadata.geometry.visibleRect;
          if (writer === undefined || writerDevice !== device) {
            writer?.destroy();
            writer = deps.writer(device, { label, width: rect.width, height: rect.height });
            writerDevice = device;
            counts.writers += 1;
          }
          writer.present(frame, rect);
          return true;
        });
        if (r.kind !== "consumed") return changed;
        counts.presented += 1;
        tally.presented += 1;
        return true;
      },
      state: () => (closed ? { is: "closed" } : liveStateOf(handle.state, () => handle.retry())),
      info: () => (closed ? {} : liveInfoOf(handle.state)),
      demand(d: LiveDemand): void {
        if (closed) return;
        asked = d;
        counts.demands += 1;
        handle.setDemand(liveDemandIntent(d));
      },
      close(): void {
        if (closed) return;
        closed = true;
        offState();
        offFrame?.();
        offFrame = null;
        handle.release();
        writer?.destroy();
        writer = undefined;
        faces.delete(key);
      },
    };
    faces.set(key, {
      face,
      row: () => {
        const t = writer?.face;
        return {
          key,
          demand: asked,
          wire: wireOf(key),
          state: face.state(),
          ...tally,
          texture:
            t === undefined
              ? undefined
              : { width: t.width, height: t.height, revision: t.revision, epoch: t.epoch },
        };
      },
    });
    return face;
  };

  return {
    open,
    stats: () => ({ ...counts, open: faces.size }),
    faces: () => [...faces.values()].map((f) => f.row()),
    dispose() {
      for (const { face } of [...faces.values()]) face.close();
      faces.clear();
    },
  };
}
