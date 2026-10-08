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
// wake, no frame counted — a quarter of the view, every kind in it since ICE 0.15.0-desk.2). Taken TWICE in a board's life and never per
// frame: at its CLOSE (the manager asks before the switch, the new board or the window's end takes the
// desk away), and ONCE ON IDLE after an edit settles — the persistence path owes a still after each
// acknowledged save, and the still is taken the first time the desk's loop is at rest (asleep) after
// that, or at a cover's edge (below). A timer looks for the rest only while a still is owed — none at
// rest otherwise, the desk's idle-zero kept. PF6: an owed still waits out a hidden window at the source.
//
// DK-10b — UNDER A COVER THE DESK COSTS NOTHING (DESIGN.md "The covers over the desk", DK-D25 ruled, R16:
// the desk runs zero frames and zero submits for as long as the cover stands). A capture is a submit, so a
// PARKED desk is no rest for a still: one owed as a cover rises is taken at once while the freeze walks its
// settle — the desk still presenting, before the park (DK-15's own order: the capture, then the freeze) —
// and one owed under a parked cover waits, and is taken at once as the cover lifts. Found by DK-10b: the
// still taken under a parked cover landed in the smokes' parked second ("a cover did not park the desk").
//
// DK-17b — A THUMBNAIL IS THE DOCUMENT'S PICTURE, NOT THE PERSON'S SELECTION (ICE I40, `0.15.0-desk.6`; the lead's
// ruling 2026-10-08): the door is asked WITHOUT the selection's marks (`marks: false`), so a still taken while a
// selection stands — the edit that owed it usually leaves one — shows the board, never its brackets. The covers' still
// keeps them: it is the desk as it stood (cover-still.ts).

/** A thumbnail's size: a quarter of the view at its device ratio (what `capture({ scale: 0.25 })` names). */
export const STILL_SCALE = 0.25;
/** How often an owed still looks for the desk at rest. */
export const REST_POLL_MS = 400;
/** How long an owed still waits for a rest before it is left to the board's close. */
export const REST_PATIENCE_MS = 120_000;
/** The most a closing board's still may hold the switch. */
export const CLOSE_BUDGET_MS = 1_500;

// DK-6: the door is asked the quarter ITSELF. DK-4 measured ICE 0.15.0-desk.1 drawing two kinds of six
// in a capture below a device ratio of 1 (petition I29) and asked at `max(0.25, 1 / dpr)`, bringing the
// still down as it encoded; desk.2 carries I29's fix (every pass converts device px by the attachment's
// own ratio), so that workaround — `captureScale` and the encoder's factor — retired with the pin.

/** Encode a still as PNG bytes, at its own size. */
export type PngEncoder = (bitmap: ImageBitmap) => Promise<Uint8Array<ArrayBuffer>>;

/** A still as PNG bytes, through a 2D OffscreenCanvas. */
export const encodePng: PngEncoder = async (bitmap) => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("desk still: no 2d context");
  ctx.drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
};

/** The desk's still as PNG bytes, a quarter of the view — or undefined where the desk has none: `failed` or `degraded`,
 * before its first frame, its device lost mid-copy (the capture door's honest answer). */
export async function deskStillPng(
  handle: Pick<DeskLayerHandle, "capture">,
  encode: PngEncoder = encodePng,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const still = await handle.capture({ scale: STILL_SCALE, marks: false });
  if (still === undefined) return undefined;
  try {
    return await encode(still);
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
  readonly desk: () => Pick<DeskLayerHandle, "capture"> | null;
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

  /** Asleep — never under a cover: a freeze's settle and its park are the cover's, and its edges take the still. */
  const atRest = (): boolean => {
    const frame = opts.engine.frame;
    return frame.sleepStats().asleep && !frame.isFrozen();
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
    // under a cover nothing is looked for — its edges take the still (`stopEdges`), and the patience runs uncovered
    if (opts.engine.frame.isFrozen()) return;
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

  // THE COVER'S EDGES (ICE's `frame.onChange`: every freeze taken, every one thawed). As the first is taken the freeze walks its
  // settle and the desk still presents — not parked; as the last thaws the desk draws again. An owed still is taken AT ONCE at
  // either edge (the capture's submit lands before the park, or after the thaw), and never once the cover is parked.
  const stopEdges = opts.engine.frame.onChange(() => {
    if (disposed || !owing) return;
    if (opts.engine.frame.isParked() || vis.isHidden()) return;
    stop();
    owing = false;
    void take().then((kept) => {
      if (!kept && !disposed) {
        owing = true;
        arm();
      }
    });
  });

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
      stopEdges();
    },
  };
}
