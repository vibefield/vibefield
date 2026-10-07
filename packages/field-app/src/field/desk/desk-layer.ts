import type { CanvasEngine } from "@vibecook/ice";
import {
  DEFAULT_MAT_CONFIG,
  type DeskLayerFactory,
  deskLayer,
  GRID,
  type GridConfig,
  type ThemeName,
} from "@vibecook/ice/desk";
import { deskPalette, deskTheme } from "@vibecook/ice/desk/objects";
import { deskText } from "./desk-assets";
import { deskBlobs } from "./desk-blobs";

// THE DESK'S LAYER, as VibeField mounts it (DK-3; ICE `docs/api-reference.md` "@ice/desk", the worked
// example `apps/desk/src/App.tsx`): one factory per mount — `<Desk>` re-boots on a new identity, so
// the Canvas stage memoizes it per committed engine generation and per desk remount (the orchestrator's
// ruling 1: the device is the layer's; nothing is shared across generations).

/**
 * THE GRID (DESIGN.md §2.1 as DK-0d wrote it, §10): the engine's own fade-in law and mat, with the
 * rulers PRINTED at a margin of 60 — the mat's unprinted margin between the window's edge and the
 * rulers' frame, so the top ruler starts below the head's strip and the left one clears the notch.
 */
/**
 * THE HAND'S RESERVES (DESIGN.md §8 "Tools in hand"; ICE I20 — `deskLayer({ hold })`): the held object's reading fit
 * keeps 116 under the view's top — the tools in hand stand at y 64, 40 tall, their foot at 104, and 12 more — and 100
 * above its foot — the line's 88 and 12; the bar travels into the hand in 560 ms on the island curve, the anchor
 * carrying it (`HeldAnchor.travelMs`). ICE's own 56 / 72 / 340 are its demo's.
 */
export const DESK_HOLD = { top: 116, band: 100, travelMs: 560 } as const;

/**
 * THE PEGBOARD'S FOOT (DESIGN.md §8 "The pegboard"; ICE I21 — `deskLayer({ tray: { foot } })`): the board's lay keeps 88
 * at its foot — the line's — so the last row clears the line and the board's scroll still reaches it; the board itself
 * runs to its edge behind the line.
 */
export const DESK_TRAY = { foot: 88 } as const;

export const DESK_GRID: GridConfig = {
  fadeIn: GRID.fadeIn,
  mat: { ...DEFAULT_MAT_CONFIG, ruler: { ...DEFAULT_MAT_CONFIG.ruler, on: true, margin: 60 } },
};

/** The desk dressed for one of the app's two themes: ICE's shipped theme and palette (D7), the
 * palette carrying VibeField's own tokens (`--vf-canvas-bg`, `--vf-select`, the note's paper). */
export function deskLook(name: ThemeName): {
  readonly theme: ReturnType<typeof deskTheme>;
  readonly palette: ReturnType<typeof deskPalette>;
} {
  return { theme: deskTheme(name), palette: deskPalette(name) };
}

export interface FieldDeskLayerOptions {
  readonly engine: CanvasEngine;
  /** The theme the first frame is painted in — the owner's at the mount (no flash). */
  readonly theme: ThemeName;
  /** The desk's remount within its engine generation (Reload): the layer's name in the roster says it. */
  readonly mount?: number;
  /** The device's live GPU memory by label from the boot on (dev builds — Settings → Advanced). */
  readonly gpuLedger?: boolean;
  /** Where the layer acquires its device — `navigator.gpu` unless given (desk-gpu.ts's forced
   * first failure, the relaunch heal's smoke door). */
  readonly gpu?: GPU;
  /** Told the layer's OWN device once it arrives (ICE's `onDevice`) — the smokes' GPU faults reach it (DK-16). */
  readonly onDevice?: (device: GPUDevice) => void;
}

/**
 * The layer the field mounts: the engine catalog's object types (the layer reads them — `objects`
 * adds none), the shipped hand (`text`), the document a note's typing commits into (`docs` — the
 * facade's, the one VibeField opens, autosaves and attaches presence to), the renderer-local byte
 * store (`blobs`, DK-D21), the grid, the hand's reserves (`hold`, DK-12 — the tools in hand under the head), the
 * pegboard's foot (`tray`, DK-13 — its lay clears the line), and no
 * further services yet (the kv service rides later). The room's other people are VibeField's to draw (DK-16, DESIGN.md §8
 * "Peers on the mat"; ICE I26): `cursors: false`, so the host mounts no remote cursors of ICE's and nobody is drawn twice —
 * the desk's children draw each peer by face (`peers/PeersOnTheMat.tsx`), and their observers arm the world.
 */
export function fieldDeskLayer(opts: FieldDeskLayerOptions): DeskLayerFactory {
  return deskLayer({
    ...deskLook(opts.theme),
    objects: [],
    name: `vibefield/desk#${opts.mount ?? 0}`,
    text: deskText(),
    docs: opts.engine.docs,
    blobs: deskBlobs(),
    grid: DESK_GRID,
    hold: DESK_HOLD,
    tray: DESK_TRAY,
    cursors: false,
    ...(opts.gpuLedger === true ? { gpuLedger: true } : {}),
    ...(opts.gpu === undefined ? {} : { gpu: opts.gpu }),
    ...(opts.onDevice === undefined ? {} : { onDevice: opts.onDevice }),
  });
}
