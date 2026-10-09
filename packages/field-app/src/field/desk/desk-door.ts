import {
  Camera,
  type CanvasEngine,
  defineQuery,
  type Entity,
  heldEntity,
  Not,
  Position,
  PrefabId,
  PresenceCursor,
  Size,
  Specimen,
  setWidgetProps,
  specimensOf,
  trayEntity,
} from "@vibecook/ice";
import type {
  AmbientMode,
  CaptureOptions,
  DeskLayerHandle,
  DeskLayerPerf,
  DeskLayerStatus,
  GpuMemory,
  PickResult,
  SelectionAnchor,
  ThemeName,
  TrayAnchor,
} from "@vibecook/ice/desk";
import { type BoardPersistenceState, getBoardStatus } from "../../board-status";
import { lastSend, type SendRecord } from "../../frame/line-send";
import { type SaidNotice, statusLineSaid } from "../../frame/status-line";
import type {
  DeskLiveFaceRow,
  DeskLiveSources,
  DeskLiveStats,
} from "../../surfaces/live/desk-live";
import { type BarStats, readBarStats } from "./bar/bar-stats";
import { type CoverRecord, coverCaptures, coverRecords } from "./cover-still";
import { DESK_FACE_URLS, deskText } from "./desk-assets";
import { deskBlobs } from "./desk-blobs";
import type { ObjectWords } from "./desk-object-words";
import { peersRenders } from "./peers/PeersOnTheMat";
import { type PeersRecord, peersRecord } from "./peers/peers-reflector";
import { type BoardStats, readBoardStats } from "./pegboard/board-stats";

// THE DESK MOUNTED NOW, and its DOOR (DK-3). One desk draws in the Canvas stage at a time — one layer
// per committed engine generation, remounted by Reload (ruling 1) — and two readers want it outside
// the stage: Settings → Advanced → Developer (its numbers — ruling 2: `status()`, `perf()`'s boot and
// frames, `submits()`, the memory ledger; no panel of ICE's) and the smokes and rigs, through
// `window.__vfDesk` (the shape of ICE's own `window.__desk`, narrowed to what a harness reads). The
// CANVAS_READY bargain (development-console.ts), extended one door: reads, plus the ambient switch a
// freeze witness needs to make the desk busy before it covers it. No document authority. DK-8 adds two
// reads: an object type's props (what a kind's own write landed) and the board's persistence row.

export interface MountedDesk {
  readonly engine: CanvasEngine;
  readonly handle: DeskLayerHandle;
  /** The document generation the stage was mounted for (FieldView's key). */
  readonly generation: number;
  /** The desk's own remounts within that generation (Reload). */
  readonly mount: number;
  /** The theme the bridge last dressed the desk in. */
  theme: ThemeName;
  /** DK-9/DK-11 — the chrome's words for an object of a type on THIS mount (desk-object-words.ts): its human
   * name, and why the desk draws it as missing — read by the bar, its grown menu and the status line. */
  readonly words?: (type: string) => ObjectWords;
  /** DK-13 — the types this mount was made WITHOUT (DK-9's off set, as read at its mount): their kinds are not drawn,
   * so the pegboard offers neither them nor a category of nothing else (P3c). */
  readonly off?: ReadonlySet<string>;
  /** DK-16 — the layer's OWN device once it arrived (null before, and with none): what the smokes' GPU faults reach. */
  readonly device?: () => GPUDevice | null;
  /** PT-2 — the mount's live pages (the service lent under ICE's `LIVE`); absent where none is lent. */
  readonly live?: DeskLiveSources;
}

/** What the chrome says of a type when the mount names no words: the type, drawn. */
export const plainWords = (type: string): ObjectWords => ({
  type,
  title: type,
  state: null,
  label: type,
});

let current: MountedDesk | null = null;
const listeners = new Set<() => void>();
/** How many desks this renderer has mounted (DK-9: a launch mounts ONE — no transient generation). */
let mounted = 0;

export function publishDesk(desk: MountedDesk): () => void {
  mounted += 1;
  current = desk;
  for (const fn of listeners) fn();
  return () => {
    if (current !== desk) return;
    current = null;
    for (const fn of listeners) fn();
  };
}

export function currentDesk(): MountedDesk | null {
  return current;
}

/** The desks this renderer has mounted, this one included — a launch's is 1 (DK-9). */
export function desksMounted(): number {
  return mounted;
}

export function subscribeDesk(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** A still read back as numbers — a harness cannot carry an ImageBitmap across `executeJavaScript`. */
export interface DeskSample {
  readonly width: number;
  readonly height: number;
  /** Distinct colours, each channel quantized to 32 levels: 1 is a uniform frame. */
  readonly colors: number;
  /** Rec. 709 luma over the still, 0–255. */
  readonly lumaMin: number;
  readonly lumaMax: number;
  readonly lumaMean: number;
}

/** Read a captured still back through a 2D canvas. */
export async function sampleBitmap(bitmap: ImageBitmap): Promise<DeskSample> {
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("desk sample: no 2d context");
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  const colors = new Set<number>();
  let min = 255;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
    sum += luma;
  }
  const n = Math.max(1, width * height);
  return {
    width,
    height,
    colors: colors.size,
    lumaMin: Math.round(min),
    lumaMax: Math.round(max),
    lumaMean: Math.round(sum / n),
  };
}

// not the pegboard's specimens: runtime entities of each kind, hung by the desk, never in the document
const objectsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

/** The document's objects by type — what the seed laid, a census a harness can hold. */
export function deskCensus(engine: CanvasEngine): Record<string, number> {
  const out: Record<string, number> = {};
  engine.world.query(objectsQ).each((batch) => {
    for (const row of batch) {
      const type = engine.world.get(batch.entity(row), PrefabId)?.id;
      if (typeof type === "string") out[type] = (out[type] ?? 0) + 1;
    }
  });
  return out;
}

/** An object as the door reads it: its entity, its props (the cells of its groups, merged) and its rect on its desk. */
export interface DeskObjectRow {
  readonly entity: number;
  /** PT-2 — its DURABLE key in the open document (strata's `store.keyOf` — what `KindHost.keyOf` gives a kind, a live face's
   * key): the same object across a reload, where its entity may be another; null for an object the document does not hold. */
  readonly key: string | null;
  readonly props: Readonly<Record<string, unknown>>;
  /** PT-1 — its `Position` (the top-left) and `Size`, world units: what a resize or a re-cut wrote. */
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/**
 * Each object of `type` on the open board with its props — the cells of its groups, merged — and its rect, what a smoke
 * reads to know what a kind's own write landed (DK-8: the comment pad's typed line; PT-1: the browser pane's size, written by
 * a resize and re-cut by its device switch). Never the pegboard's specimens.
 */
export function deskObjects(engine: CanvasEngine, type: string): DeskObjectRow[] {
  const widget = engine.catalog.widget(type);
  if (widget === undefined) return [];
  const out: DeskObjectRow[] = [];
  const store = engine.docs.current()?.store;
  engine.world.query(objectsQ).each((batch) => {
    for (const row of batch) {
      const e = batch.entity(row);
      if (engine.world.get(e, PrefabId)?.id !== type) continue;
      const props: Record<string, unknown> = {};
      for (const g of widget.groups)
        Object.assign(props, (engine.world.get(e, g.component) as object | undefined) ?? {});
      const at = engine.world.get(e, Position);
      const size = engine.world.get(e, Size);
      out.push({
        entity: e as number,
        key: (store?.keyOf(e) as string | undefined) ?? null,
        props,
        rect: { x: at?.x ?? 0, y: at?.y ?? 0, w: size?.w ?? 0, h: size?.h ?? 0 },
      });
    }
  });
  return out;
}

export interface VfDeskDoor {
  readonly generation: number;
  readonly mount: number;
  /** The desks this renderer has mounted, this one included (DK-9: a launch mounts ONE — the stage
   * waits for the board, so no device is acquired and dropped for a transient generation 0). */
  mounts(): number;
  status(): DeskLayerStatus;
  perf(): DeskLayerPerf;
  /** Every queue submit since the mount (the instrument installs at the mount); null before the device. */
  submits(): { readonly total: number; readonly buffers: number } | null;
  /** The engine's loop at rest (K7a): asleep — the idle a still waits for and the idle-zero row reads (DK-4) —
   * or parked under a freeze, where the desk costs nothing and no still is taken (DK-10b; the cover's edges take it). */
  /** The engine's frame loop at rest or not (DK-5), and — DK-9 — WHY it is awake: its outside wakes counted by
   * reason (`world`, `input`, `doc`, `presence`, `desk:…`), the steps its own timer started, and the desk's
   * registered wake taken apart (ICE's `due`: when each part is next due, `Infinity` never on its own). */
  rest(): {
    readonly asleep: boolean;
    readonly parked: boolean;
    readonly sleeps: number;
    readonly wakes: Readonly<Record<string, number>>;
    readonly timed: number;
    readonly steps: number;
    readonly due: ReturnType<DeskLayerHandle["due"]>;
  };
  /** DK-17b (ICE I41) — the PARK as the gate ANNOUNCES it (`frame.onParked`): resolves when the loop has parked (`at`, the
   * page's clock), at once when it already is (`already` — the announcement is not replayed on subscribe), or not parked
   * after `timeoutMs`. What the smokes' waits for a park ask — never a poll of `rest().parked`. */
  whenParked(
    timeoutMs: number,
  ): Promise<{ readonly parked: boolean; readonly already: boolean; readonly at: number }>;
  pick(point: { readonly x: number; readonly y: number }): {
    readonly entity: number;
    readonly type: string;
    readonly canvas: number;
    readonly part: string;
  } | null;
  capture(opts?: CaptureOptions): Promise<ImageBitmap | undefined>;
  /** A capture read back as numbers (DESK_READY's pixel witness); null while the desk has none. */
  sample(opts?: CaptureOptions): Promise<DeskSample | null>;
  theme(): ThemeName;
  census(): Record<string, number>;
  /** Each object of a type with its props and its rect (`deskObjects`) — what a kind's own write landed. */
  objects(type: string): readonly DeskObjectRow[];
  /**
   * PT-1 — the CAMERA as the engine holds it (core's `Camera`): the view's top-left in world units and its zoom — a desk point
   * on screen is `(world − at) · zoom` (kernel `worldToScreen`). A read: a smoke that lays an object on clear ground finds the
   * ground in world units (each object's rect) and pans the view to it.
   */
  camera(): { readonly x: number; readonly y: number; readonly zoom: number };
  /**
   * PT-2 — a SMOKE's write, the door's one: `patch` merged into the object's props in ONE transaction (one undo step; ICE's
   * `setWidgetProps` — validated against the type's schema first), as the object's own UI writes them — the pane's address field
   * is PT-3's — so a smoke can point a pane at its fixture page. False on a board this window may not write or an object gone.
   */
  writeProps(entity: number, patch: Readonly<Record<string, unknown>>): boolean;
  /**
   * PT-2 — the mount's LIVE pages as its service counts them (surfaces/live/desk-live.ts): its totals (faces opened, frames
   * presented and dropped, demands, writers made) and each open face's row — its key (the object's durable key), the kind's
   * last ask, the demand the pool last wrote for its page, its state and words, its arrivals, presents and texture. Null where
   * no live service is lent. A read: the live-pane smoke's witness.
   */
  live(): { readonly stats: DeskLiveStats; readonly faces: readonly DeskLiveFaceRow[] } | null;
  /**
   * PT-1 — a kind's DESK STATE on this desk (`handle.local(name)` — what its `ObjectKind.local` made), or undefined: no such
   * kind, or none kept. A read: a smoke asks a kind's own witness of it (the browser pane's `said(e)` — what its head says).
   */
  local(name: string): unknown;
  /** The board's persistence as its status row reads it — `live` with the last acknowledged save's time once a save lands. */
  board(): { readonly state: BoardPersistenceState; readonly lastSavedAt: number | null };
  /** What the desk was fed, by the routes the packaged CSP admits (ruling 8): the plates set, each
   * face loaded through `FontFace(url)`, where the byte store keeps its prints. */
  assets(): Promise<{
    readonly plates: boolean;
    readonly faces: Readonly<Record<string, boolean>>;
    readonly blobs: string;
  }>;
  /** The wind's policy: read, or set (a freeze witness makes the desk busy before covering it). */
  ambient(mode?: AmbientMode): AmbientMode;
  memory(): GpuMemory | null;
  /** DK-9, DK-11 — what the selection bar prints for an object of `type`: its human name, and why the desk
   * draws it as missing ("plugin off", "plugin gone", "no kind", "remount to draw it", "can't draw"), the
   * label "Clock · plugin off". */
  words(type: string): ObjectWords;
  /** DK-11 — every notice the status line has said this session, in order (each said ONCE). */
  notices(): readonly SaidNotice[];
  /** DK-11 — the selection bar's counters: the anchor's publishes it heard, its placements (imperative writes) and
   * its view's renders — renderer-wide (a row reads its deltas: placements ≤ publishes, never a render per frame). */
  bar(): BarStats;
  /** DK-12 — the object IN HAND and where the desk drew it this frame: the held pose seam's frame (core's
   * `HeldScreenFrame` — the shown extent's centre and half extents, CSS px, its scale, whether the pickup settled), the
   * reading fit's witness; null with nothing held. A read. */
  held(): { readonly entity: number; readonly frame: HeldFrame | null } | null;
  /** DK-14 — the last Send to… as it went (`frame/line-send.ts`): where it was pressed, the chip's face and what it
   * carries, the capture's rect and the still's size, the still asked without the selection's marks and the selection
   * observed standing (ICE I40, DK-17b), whether the draft was aimed, and
   * each step's time; null before any. A read. */
  sent(): SendRecord | null;
  /** DK-15 — the covers this renderer has stood, oldest first (the last 8; `cover-still.ts`): each step in the order taken —
   * capture, blur, swap, hide, freeze, park; a re-capture's thaw and one frame; the lowering's thaw, show, drop — with its
   * time, the still's size and px per CSS px, the blur's px, the face (a still or the mat's ground) and what was said. A read. */
  covers(): readonly CoverRecord[];
  /** DK-15 — what the cover's OWN capture answers: "nothing" stands in for a lost device (the fallback's row); "desk" the
   * desk's. Read, or set — a witness's switch, like `ambient`. */
  coverCaptures(answer?: "desk" | "nothing"): "desk" | "nothing";
  /** DK-16 — the peers on the mat: whether the layer was mounted with ICE's remote cursors (`handle.cursors` — false: none
   * of ICE's are drawn), the peers as this window last placed them (each one's cursor — x/y, away, canvas — its verdict
   * and box; the layer's verdict; the canvas and camera they were placed by; the reflector's flushes, the element writes,
   * the idle timers fired), how often the layer has rendered (never per frame), and — DK-17b, ICE's I42 — what this
   * window says of its own pointer: the host's away reason and the cursor as its presence last wrote it. A read. */
  peers(): {
    readonly cursors: boolean;
    readonly record: PeersRecord | null;
    readonly renders: number;
    readonly said: PresenceSaid | null;
  };
  /** DK-16 — the smokes' presence relay, installed only on a page loaded with `?presenceRelay=1` (two windows of one shell
   * share no presence room — fieldd's rooms are other desktops' — so the smoke plays the mesh): the presence payloads this
   * window sent since the last ask (base64), and payloads handed in as its lane hands a room's (each through
   * `presence().wire.apply`). */
  presenceTap?(): readonly string[];
  presenceApply?(payloads: readonly string[]): number;
  /** DK-17b (ICE I45) — the point this window's presence FIRST sent out: its `PresenceCursor` x/y as the first outbound
   * payload that carried one left, or null before — installed with the relay. Since desk.7 a spawned pointer's first
   * world point is its own, so a peer's first cursor is never the origin a frame-late world point left behind. */
  presenceFirst?(): { readonly x: number; readonly y: number } | null;
  /** DK-16 — the smokes' GPU faults, installed only on a page loaded with `?deskFaults=1`, on the layer's OWN device:
   * "lose" destroys it, as a GPU reset loses it — the desk goes `failed` ("the device was lost: …") and the stage's card
   * offers its Reload; "error" raises one uncaptured validation error — the desk goes `degraded` and draws on, the status
   * line holding ICE's message and a Reload. Answers whether a device was there to fault. */
  gpuFault?(kind: "lose" | "error"): boolean;
  /** DK-11 — the selection's anchor as the desk last published it (`handle.selection.anchor()`) — what the bar is
   * placed from; null on a handle without the door. A read. */
  anchor(): SelectionAnchor | null;
  /** DK-13 — the pegboard: the tray's anchor as the desk last published it (`handle.tray.anchor()` — the drawer as
   * drawn, its header band, the hand, the categories), the board's scroll and its foot, the specimens as the desk DREW them in its
   * last frame (ICE's own witness — each one's object on screen), and the pegboard chrome's counters; null on a handle
   * without the door. A read. */
  pegboard(): {
    readonly anchor: TrayAnchor;
    readonly scroll: number;
    /** the board's foot inset as the desk drew it (I21 — the layer's `tray.foot`) */
    readonly foot: number | null;
    /** the types core's tray lay HANGS now (the shown category's), in sibling order — since desk.5 (ICE I38) only the
     * kinds the desk was mounted with: a kind it cannot draw is never laid */
    readonly laid: readonly string[];
    readonly specimens: readonly {
      readonly type: string;
      readonly label: string;
      readonly object: {
        readonly x0: number;
        readonly y0: number;
        readonly x1: number;
        readonly y1: number;
      };
    }[];
    readonly stats: BoardStats;
  } | null;
}

/** Where the desk drew a held frame (core's `HeldScreenFrame`, CSS px of the view). */
export interface HeldFrame {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
  readonly s: number;
  readonly settled: boolean;
}

/** The object IN HAND and where the desk drew it this frame — the held pose seam's frame (DK-12) — or null with
 * nothing held. A read. */
export function heldNow(
  engine: CanvasEngine,
): { readonly entity: number; readonly frame: HeldFrame | null } | null {
  const entity = heldEntity(engine.world);
  if (entity === undefined) return null;
  const frame = engine.stack.heldPose.current?.frame(entity);
  return {
    entity: entity as number,
    frame:
      frame === undefined
        ? null
        : {
            cx: frame.cx,
            cy: frame.cy,
            hx: frame.hx,
            hy: frame.hy,
            s: frame.s,
            settled: frame.settled,
          },
  };
}

const pickOf = (
  hit: PickResult | null,
): { entity: number; type: string; canvas: number; part: string } | null =>
  hit === null
    ? null
    : {
        entity: hit.entity as number,
        type: hit.type,
        canvas: hit.canvas as number,
        part: hit.part,
      };

/** Install `window.__vfDesk` for one mount; the returned undo removes it if it is still this one's. */
export function installDeskDoor(desk: MountedDesk, platesSet: () => boolean): () => void {
  const words = desk.words ?? plainWords;
  const { handle, engine } = desk;
  let ambient: AmbientMode = "idle";
  const door: VfDeskDoor = {
    generation: desk.generation,
    mount: desk.mount,
    mounts: desksMounted,
    status: () => handle.status(),
    perf: () => handle.perf(),
    submits: () => {
      const s = handle.submits();
      return s === undefined ? null : { total: s.total(), buffers: s.buffers() };
    },
    rest: () => {
      const stats = engine.frame.sleepStats();
      return {
        asleep: stats.asleep,
        parked: engine.frame.isParked(),
        sleeps: stats.sleeps,
        wakes: stats.wakes,
        timed: stats.timed,
        steps: stats.steps,
        due: handle.due(performance.now()),
      };
    },
    whenParked: (timeoutMs) =>
      new Promise((resolve) => {
        const frame = engine.frame;
        if (frame.isParked()) {
          resolve({ parked: true, already: true, at: performance.now() });
          return;
        }
        const off = frame.onParked((parked) => {
          if (!parked) return;
          off();
          clearTimeout(timer);
          resolve({ parked: true, already: false, at: performance.now() });
        });
        const timer = setTimeout(() => {
          off();
          resolve({ parked: false, already: false, at: performance.now() });
        }, timeoutMs);
      }),
    pick: (point) => pickOf(handle.pick(point)),
    capture: (opts) => handle.capture(opts),
    async sample(opts) {
      const still = await handle.capture(opts);
      if (still === undefined) return null;
      try {
        return await sampleBitmap(still);
      } finally {
        still.close();
      }
    },
    theme: () => desk.theme,
    census: () => deskCensus(engine),
    objects: (type) => deskObjects(engine, type),
    live: () =>
      desk.live === undefined ? null : { stats: desk.live.stats(), faces: desk.live.faces() },
    writeProps: (entity, patch) => {
      const session = engine.docs.current();
      const e = entity as Entity;
      if (session === undefined || session.readOnly || !engine.world.isAlive(e)) return false;
      setWidgetProps(session.store, engine.world, e, patch);
      return true;
    },
    camera: () => {
      const c = engine.world.getResource(Camera);
      return { x: c?.x ?? 0, y: c?.y ?? 0, zoom: c?.zoom ?? 1 };
    },
    local: (name) => (handle as Partial<DeskLayerHandle>).local?.(name),
    board: () => {
      const s = getBoardStatus();
      return { state: s.state, lastSavedAt: s.lastSavedAt ?? null };
    },
    async assets() {
      const text = deskText();
      const names = Object.keys(DESK_FACE_URLS);
      const loaded = await Promise.all(names.map((name) => text.load(name)));
      return {
        plates: platesSet(),
        faces: Object.fromEntries(names.map((name, i) => [name, loaded[i] === true])),
        blobs: await deskBlobs().persistence(),
      };
    },
    ambient(mode) {
      if (mode !== undefined) {
        ambient = mode;
        handle.setAmbient(mode);
      }
      return ambient;
    },
    memory: () => handle.gpuMemory()?.read() ?? null,
    words,
    notices: statusLineSaid,
    bar: readBarStats,
    anchor: () => (handle as Partial<DeskLayerHandle>).selection?.anchor() ?? null,
    pegboard: () => {
      const tray = (handle as Partial<DeskLayerHandle>).tray;
      if (tray === undefined) return null;
      const state = tray.state();
      return {
        anchor: tray.anchor(),
        scroll: state.frame?.scroll ?? tray.scroll(),
        foot: state.frame?.foot ?? null,
        laid: (() => {
          const at = trayEntity(engine.world);
          return at === undefined
            ? []
            : specimensOf(engine.world, at).map((e) => String(engine.world.get(e, PrefabId)?.id));
        })(),
        specimens: state.specimens.map((s) => ({ type: s.type, label: s.label, object: s.object })),
        stats: readBoardStats(),
      };
    },
    held: () => heldNow(engine),
    sent: lastSend,
    covers: coverRecords,
    coverCaptures,
    peers: () => ({
      cursors: (handle as Partial<DeskLayerHandle>).cursors !== false,
      record: peersRecord(),
      renders: peersRenders(),
      said: presenceSaid(engine),
    }),
    ...(presenceRelayAsked() ? presenceRelay(engine) : {}),
    ...(deskFaultsAsked() ? { gpuFault: (kind) => gpuFault(desk.device?.() ?? null, kind) } : {}),
  };
  const scope = globalThis as Record<string, unknown>;
  scope["__vfDesk"] = door;
  return () => {
    if (scope["__vfDesk"] === door) delete scope["__vfDesk"];
  };
}

/** The smokes' URL door for the presence relay (`?presenceRelay=1`). */
export const PRESENCE_RELAY = "presenceRelay";

function presenceRelayAsked(): boolean {
  return (
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get(PRESENCE_RELAY) === "1"
  );
}

const toBase64 = (bytes: Uint8Array): string => {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
};

const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** What this window says of its own pointer (ICE's presence, I42): the host's away reason (`presence().away()` — "cover"
 * while a view covers the canvas, `document-presence.ts`) and its `PresenceCursor` as the publish last wrote it — away
 * (the reason held, or the pointer out of the desk's host) and the canvas its x/y lie in — or null before the first. */
export interface PresenceSaid {
  readonly reason: string | null;
  readonly cursor: { readonly away: boolean; readonly canvas: string } | null;
}

function presenceSaid(engine: CanvasEngine): PresenceSaid | null {
  const session = engine.docs.presence();
  if (session === undefined) return null;
  const peer = session.localPeer;
  const cursor = engine.world.isAlive(peer) ? engine.world.get(peer, PresenceCursor) : undefined;
  return {
    reason: session.away(),
    cursor: cursor === undefined ? null : { away: cursor.away, canvas: cursor.canvas ?? "" },
  };
}

/** The relay's two doors over this engine's presence session — the session followed as it attaches and re-attaches. */
function presenceRelay(
  engine: CanvasEngine,
): Pick<VfDeskDoor, "presenceTap" | "presenceApply" | "presenceFirst"> {
  let tapped: ReturnType<CanvasEngine["docs"]["presence"]>;
  let off: (() => void) | null = null;
  const sent: string[] = [];
  let first: { readonly x: number; readonly y: number } | null = null;
  const follow = (): void => {
    const session = engine.docs.presence();
    if (session === tapped) return;
    off?.();
    tapped = session;
    off =
      session?.onOutbound((payload) => {
        sent.push(toBase64(payload));
        // the cursor the throttle just encoded: the first one that went out is the one a peer first draws (I45)
        if (first !== null) return;
        const peer = session.localPeer;
        const cursor = engine.world.isAlive(peer)
          ? engine.world.get(peer, PresenceCursor)
          : undefined;
        if (cursor !== undefined) first = { x: cursor.x, y: cursor.y };
      }) ?? null;
  };
  follow();
  return {
    presenceTap() {
      follow();
      return sent.splice(0, sent.length);
    },
    presenceApply(payloads) {
      follow();
      const session = engine.docs.presence();
      if (session === undefined) return 0;
      for (const payload of payloads) session.wire.apply(fromBase64(payload));
      return payloads.length;
    },
    presenceFirst() {
      follow();
      return first;
    },
  };
}

/** The smokes' URL door for the GPU faults (`?deskFaults=1`). */
export const DESK_FAULTS = "deskFaults";

function deskFaultsAsked(): boolean {
  return (
    typeof location !== "undefined" && new URLSearchParams(location.search).get(DESK_FAULTS) === "1"
  );
}

/** Fault the layer's own device: lose it (destroyed, as a reset loses it), or raise ONE uncaptured validation error (a
 * buffer of no usage, made outside any error scope). Then ask its queue when its work is done: the browser hands a
 * device's errors back as it polls the device, and a desk asleep submits nothing to poll for — unasked, the fault is told
 * at the desk's next frame, whenever that is (a smoke's banner row once timed out at 10 s with the error logged after). */
export function gpuFault(device: GPUDevice | null, kind: "lose" | "error"): boolean {
  if (device === null) return false;
  if (kind === "lose") device.destroy();
  else device.createBuffer({ size: 4, usage: 0 });
  void device.queue.onSubmittedWorkDone().catch(() => undefined);
  return true;
}
