import {
  type CanvasEngine,
  defineQuery,
  heldEntity,
  Not,
  Position,
  PrefabId,
  Size,
  Specimen,
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
import { type BarStats, readBarStats } from "./bar/bar-stats";
import { type CoverRecord, coverCaptures, coverRecords } from "./cover-still";
import { DESK_FACE_URLS, deskText } from "./desk-assets";
import { deskBlobs } from "./desk-blobs";
import type { ObjectWords } from "./desk-object-words";
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

/**
 * Each object of `type` on the open board with its props — the cells of its groups, merged — what a smoke reads to
 * know what a kind's own write landed (DK-8: the comment pad's typed line). Never the pegboard's specimens.
 */
export function deskObjects(
  engine: CanvasEngine,
  type: string,
): { readonly entity: number; readonly props: Readonly<Record<string, unknown>> }[] {
  const widget = engine.catalog.widget(type);
  if (widget === undefined) return [];
  const out: { entity: number; props: Record<string, unknown> }[] = [];
  engine.world.query(objectsQ).each((batch) => {
    for (const row of batch) {
      const e = batch.entity(row);
      if (engine.world.get(e, PrefabId)?.id !== type) continue;
      const props: Record<string, unknown> = {};
      for (const g of widget.groups)
        Object.assign(props, (engine.world.get(e, g.component) as object | undefined) ?? {});
      out.push({ entity: e as number, props });
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
  /** Each object of a type with its props (`deskObjects`) — what a kind's own write landed. */
  objects(
    type: string,
  ): readonly { readonly entity: number; readonly props: Readonly<Record<string, unknown>> }[];
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
   * carries, the capture's rect and the still's size, the marks hidden and put back, whether the draft was aimed, and
   * each step's time; null before any. A read. */
  sent(): SendRecord | null;
  /** DK-15 — the covers this renderer has stood, oldest first (the last 8; `cover-still.ts`): each step in the order taken —
   * capture, blur, swap, hide, freeze, park; a re-capture's thaw and one frame; the lowering's thaw, show, drop — with its
   * time, the still's size and px per CSS px, the blur's px, the face (a still or the mat's ground) and what was said. A read. */
  covers(): readonly CoverRecord[];
  /** DK-15 — what the cover's OWN capture answers: "nothing" stands in for a lost device (the fallback's row); "desk" the
   * desk's. Read, or set — a witness's switch, like `ambient`. */
  coverCaptures(answer?: "desk" | "nothing"): "desk" | "nothing";
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
    /** the types core's tray lay HANGS now (the shown category's), in sibling order — the engine catalog's, so a kind
     * the desk was mounted without is laid (a hang) though never drawn */
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
  };
  const scope = globalThis as Record<string, unknown>;
  scope["__vfDesk"] = door;
  return () => {
    if (scope["__vfDesk"] === door) delete scope["__vfDesk"];
  };
}
