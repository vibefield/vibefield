import type { CanvasEngine } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";
import { getRendererLogger } from "../../logging";
import {
  isHidden as realIsHidden,
  onVisibilityChange as realOnVisibilityChange,
} from "../../visibility";

// THE DESK'S STILLS (DK-4; DK-D27 ruled 2 Oct — "the explorer shows the desk"): a board's picture in the
// fields explorer is the DESK as it last showed it, through ICE's capture door (petition I23:
// `handle.capture({ scale })` — the last PRESENTED frame drawn once more and read back; no redraw, no
// wake, no frame counted — a quarter of the view, see `captureScale` for the ratio it is asked at). Taken TWICE in a board's life and never per
// frame: at its CLOSE (the manager asks before the switch, the new board or the window's end takes the
// desk away), and ONCE ON IDLE after an edit settles — the persistence path owes a still after each
// acknowledged save, and the still is taken the first time the desk's loop is at rest (asleep, or parked
// under a cover) after that. A timer looks for the rest only while a still is owed — none at rest
// otherwise, the desk's idle-zero kept. PF6: an owed still waits out a hidden window at the source.

/** A thumbnail's size: a quarter of the view at its device ratio (what `capture({ scale: 0.25 })` names). */
export const STILL_SCALE = 0.25;
/** How often an owed still looks for the desk at rest. */
export const REST_POLL_MS = 400;
/** How long an owed still waits for a rest before it is left to the board's close. */
export const REST_PATIENCE_MS = 120_000;
/** The most a closing board's still may hold the switch. */
export const CLOSE_BUDGET_MS = 1_500;

/**
 * The scale the capture door is ASKED at for a quarter-size still: `STILL_SCALE`, but never below a device ratio of 1.
 * MEASURED (DK-4, 2026-10-03, the packaged app on Dawn at dpr 2, the seeded board): `capture({ scale: 0.25 })` — a ratio of
 * 0.5 — draws the calendar and the notebook and NONE of the card kinds (the note, the mini mat, the whiteboard, the print),
 * while 0.5 and 1 draw all six (ICE's rig:capture checks the quarter still's size, never its picture). So the still is asked at
 * `max(0.25, 1 / dpr)` and brought down to the quarter as it is encoded — the same size, every object in it. An ICE petition
 * is owed; when the door draws every kind at a quarter, this asks `STILL_SCALE` again.
 */
export function captureScale(dpr: number): number {
  return Math.max(STILL_SCALE, dpr > 0 ? 1 / dpr : 1);
}

/** Encode a still as PNG bytes, `factor` of its size (1: as captured). */
export type PngEncoder = (bitmap: ImageBitmap, factor: number) => Promise<Uint8Array<ArrayBuffer>>;

/** A still as PNG bytes, through a 2D OffscreenCanvas — brought down by `factor`, smoothed. */
export const encodePng: PngEncoder = async (bitmap, factor) => {
  const width = Math.max(1, Math.round(bitmap.width * factor));
  const height = Math.max(1, Math.round(bitmap.height * factor));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("desk still: no 2d context");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
};

/** The desk's still as PNG bytes, a quarter of the view — or undefined where the desk has none: `failed` or `degraded`,
 * before its first frame, its device lost mid-copy (the capture door's honest answer). */
export async function deskStillPng(
  handle: Pick<DeskLayerHandle, "capture" | "lastInputs">,
  encode: PngEncoder = encodePng,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  // the device ratio the last frame was drawn at — the one the capture door scales
  const dpr = handle.lastInputs()?.view.dpr ?? globalThis.devicePixelRatio ?? 1;
  const scale = captureScale(dpr);
  const still = await handle.capture({ scale });
  if (still === undefined) return undefined;
  try {
    return await encode(still, STILL_SCALE / scale);
  } finally {
    still.close();
  }
}

interface VisibilitySeam {
  isHidden(): boolean;
  onVisibilityChange(fn: (hidden: boolean) => void): () => void;
}

export interface DeskStillsOptions {
  /** The engine whose frame loop says when the desk is at rest. */
  readonly engine: Pick<CanvasEngine, "frame">;
  /** The desk drawing this board now (the stage's layer for this generation), or null. */
  readonly desk: () => Pick<DeskLayerHandle, "capture" | "lastInputs"> | null;
  /** Where a still goes: the explorer's shelf, under this board's id. */
  readonly keep: (png: Uint8Array<ArrayBuffer>) => Promise<void> | void;
  readonly encode?: PngEncoder;
  readonly visibility?: VisibilitySeam;
  readonly now?: () => number;
}

export interface DeskStills {
  /** An edit settled: a still is owed, taken once at the desk's next rest. */
  owe(): void;
  /** A still is owed and not yet taken (a witness). */
  owed(): boolean;
  /** The board closes: its still now — the last frame it showed — the owed one with it. */
  close(): Promise<void>;
  dispose(): void;
}

export function createDeskStills(opts: DeskStillsOptions): DeskStills {
  const vis = opts.visibility ?? {
    isHidden: realIsHidden,
    onVisibilityChange: realOnVisibilityChange,
  };
  const now = opts.now ?? Date.now;
  const encode = opts.encode ?? encodePng;
  const log = getRendererLogger().child({ component: "docs.stills" });
  let owing = false;
  let owedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unwatch: (() => void) | null = null;
  let taking: Promise<boolean> | null = null;
  let disposed = false;

  const atRest = (): boolean => {
    const frame = opts.engine.frame;
    return frame.sleepStats().asleep || frame.isParked();
  };

  /** One still, kept — never two at once. */
  const take = (): Promise<boolean> => {
    taking ??= (async () => {
      try {
        const handle = opts.desk();
        if (handle === null) return false;
        const png = await deskStillPng(handle, encode);
        if (png === undefined) return false;
        await opts.keep(png);
        return true;
      } catch (error) {
        log.warn("renderer.docs.still_failed", "The board's still was not taken", {
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      } finally {
        taking = null;
      }
    })();
    return taking;
  };

  const stop = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    unwatch?.();
    unwatch = null;
  };

  const arm = (): void => {
    if (disposed || !owing || timer !== null || unwatch !== null) return;
    if (vis.isHidden()) {
      // PF6: a hidden window looks for nothing; the next `visible` resumes the wait
      unwatch = vis.onVisibilityChange((hidden) => {
        if (hidden) return;
        unwatch?.();
        unwatch = null;
        arm();
      });
      return;
    }
    timer = setTimeout(look, REST_POLL_MS);
  };

  const look = (): void => {
    timer = null;
    if (disposed || !owing) return;
    if (now() - owedAt > REST_PATIENCE_MS) {
      owing = false; // the desk never rested: the board's close takes its still
      return;
    }
    if (vis.isHidden() || !atRest()) {
      arm();
      return;
    }
    owing = false;
    void take().then((kept) => {
      // no desk drew it (failed, before its first frame): owed again for the next rest
      if (!kept && !disposed) {
        owing = true;
        arm();
      }
    });
  };

  return {
    owe() {
      if (disposed) return;
      if (!owing) owedAt = now();
      owing = true;
      arm();
    },
    owed: () => owing,
    async close() {
      owing = false;
      stop();
      if (disposed) return;
      let budget: ReturnType<typeof setTimeout> | null = null;
      await Promise.race([
        take(),
        new Promise<void>((resolve) => {
          budget = setTimeout(resolve, CLOSE_BUDGET_MS);
        }),
      ]);
      if (budget !== null) clearTimeout(budget);
    },
    dispose() {
      disposed = true;
      owing = false;
      stop();
    },
  };
}
