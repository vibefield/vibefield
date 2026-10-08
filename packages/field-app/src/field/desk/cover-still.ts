import type { FrameControl } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";

// THE STILL UNDER THE COVERS (DK-15; DESIGN.md §8 "The covers over the desk"; DK-D25 — James: "frozen desk should be still
// and consume no render time at all, do it properly"; R16; FC-D13, FC-D15, FC-D16; ICE I23's capture door). Under a cover
// the desk is a STILL and costs nothing. The ruled order, one stand of a cover:
//   RISE  — the cover fades in over the LIVE desk (240 ms, the frame's own CSS) while `handle.capture()` takes the last
//           presented frame; when it resolves the still is BLURRED ONCE — 40 CSS px × the still's bitmap px per CSS px, in
//           an OffscreenCanvas `filter`, never a `backdrop-filter` (the compositor would re-blur it every frame the cover's
//           own content moves; Godview's swarm moves every frame) — and SWAPPED in under the cover's 72 % tint; the desk's
//           canvas is HIDDEN by `visibility` (never `display:none`, which the host's ResizeObserver reads as 0 × 0); then
//           `engine.frame.freeze("cover")` parks the loop: zero frames, zero submits for as long as the cover stands —
//           the park as the gate ANNOUNCES it (`frame.onParked`, ICE I41; DK-17b retired DK-15's poll of `isParked()`
//           each page frame). The still recedes to 0.98 over 560 ms, transform only (the surface's CSS — the cover's
//           settle).
//   AGAIN — a resize or a theme change while covered re-captures: thaw → one frame → capture → (blur → swap → hide) →
//           freeze. Asked while a capture is in flight, it runs once that one has swapped.
//   LOWER — back to Canvas: THAW FIRST, the live canvas shown at once under the lowering cover, the still dropped.
//   NOTHING — a capture that answers nothing covers the mat's ground as the theme lights it (`--vf-mat-ground`), and a desk
//           that HAD drawn says so once a stand on the status line: "The desk lost its graphics device". A desk that never
//           drew (none mounted yet, a board refused, a boot that failed) is covered the same way and says nothing here: its
//           card says why on the canvas.
// Every step is RECORDED in order (`coverRecords()` — `window.__vfDesk.covers()`): the smokes judge the order, the blur's
// px at the view's DPR, the park's time after the rise, and that nothing ran under the park. The controller is pure over
// its seams (`CoverSeams`): `CoverStill.tsx` lends it the window's engine, the desk mounted now and the still's canvas.

/** The canon's numbers for the covers (DESIGN.md §8, §6, §10 — FC-D13, FC-D15, FC-D16; plan Phase 4 inputs (c)). */
export const COVER = {
  /** The cover's own fade over the live desk (the frame's CSS, `view-frame.css`). */
  fadeMs: 240,
  /** The blur, in CSS px of the view — scaled to the still's own px (× its bitmap px per CSS px). */
  blurCssPx: 40,
  /** The still's recede (the surface's CSS, transform only). */
  recedeMs: 560,
  recedeScale: 0.98,
  /** The covers' glass (FC-D16) — the views' own CSS; said here for the witnesses. */
  tint: 0.72,
  /** A re-capture's ONE frame: how long the thawed desk is given to present it before the last presented frame is taken. */
  frameWaitMs: 1_000,
  /** A resize while covered re-captures once the window has stood still this long (a drag resizes every frame). */
  resizeQuietMs: 150,
} as const;

/** The status line's words when a capture answers nothing on a desk that had drawn (DESIGN.md §8 — the card's own words). */
export const LOST_DEVICE_WORDS = "The desk lost its graphics device";
/** The status line's id for them: said once a stand. */
export const LOST_DEVICE_NOTICE = "desk-lost-device";

/** What stands under the cover: the blurred still (the surface takes it — and closes it when it is replaced), the mat's
 * ground, or nothing (the live canvas). */
export type StillFace =
  | { readonly kind: "still"; readonly bitmap: ImageBitmap }
  | { readonly kind: "ground" }
  | { readonly kind: "none" };

/** Where the still is drawn — the product's is a `bitmaprenderer` canvas over the desk (`stillCanvasSurface`). */
export interface StillSurface {
  show(face: StillFace): void;
}

/** The desk the cover stills: its capture door, its canvas and its frames (`handle.perf().frames`). */
export interface CoverDesk {
  readonly handle: Pick<DeskLayerHandle, "capture" | "canvas" | "perf">;
}

export interface CoverSeams {
  /** The window's frame gate — the engine's (`ce.frame`), read at each freeze (a new generation brings a new one). */
  readonly frame: () => Pick<FrameControl, "freeze" | "isParked" | "onParked">;
  /** The desk drawing now, or null. */
  readonly desk: () => CoverDesk | null;
  readonly surface: StillSurface;
  /** Blur a still ONCE by `px` of its own (the product's `blurStill`); the caller closes the source. */
  readonly blur: (bitmap: ImageBitmap, px: number) => ImageBitmap;
  /** The view's CSS width — the still's device px are counted against it (`blurCssPx` × px per CSS px). */
  readonly viewWidth: (desk: CoverDesk) => number;
  /** Say a notice once on the status line. */
  readonly say: (id: string, text: string) => void;
  readonly now: () => number;
  /** The page's next frame (or a short timeout, so a hidden page never stalls a wait). */
  readonly nextFrame: () => Promise<void>;
  /** Reduced motion asked (M6) — said in the record; the CSS does the halving. */
  readonly reduced: () => boolean;
}

/** One capture → blur → swap → hide → freeze: the rise's, or a re-capture's. */
export interface CoverPass {
  readonly reason: "rise" | "resize" | "theme";
  readonly asked: number;
  /** a re-capture's thaw, and its one frame: how many the desk presented in the wait, and when the capture was asked */
  thawed?: number;
  frame?: { readonly frames: number; readonly at: number };
  capture?: {
    readonly asked: number;
    readonly answered: number;
    /** the still's device px, or null: the capture answered nothing */
    readonly width: number | null;
    readonly height: number | null;
    /** the view's CSS width it was counted against, and the still's px per CSS px */
    readonly viewWidth: number;
    readonly pxPerCss: number | null;
  };
  blur?: { readonly px: number; readonly ms: number };
  face?: "still" | "ground";
  swapped?: number;
  hidden?: number;
  frozen?: number;
  parked?: number;
  /** the cover lowered (or a newer pass began) before this one swapped: nothing of it was shown */
  aborted?: boolean;
}

/** One stand of a cover, as it went. Times are the page's `performance.now()`. */
export interface CoverRecord {
  readonly seq: number;
  /** the view the cover rose for */
  readonly view: string;
  readonly reduced: boolean;
  readonly rose: number;
  readonly passes: CoverPass[];
  /** every step in the order taken: capture, blur, swap, hide, freeze, park · thaw, frame (a re-capture) · thaw, show, drop */
  readonly steps: string[];
  /** what the status line was asked to say this stand (once), or null */
  said: string | null;
  lowered?: number;
  thawed?: number;
  shown?: number;
  dropped?: number;
}

const KEPT = 8;
let records: CoverRecord[] = [];
let seq = 0;
/** The witnesses' switch (`__vfDesk.coverCaptures`): "nothing" makes the cover's own capture answer nothing, as a lost
 * device's does — the fallback's row. Never the desk's other captures. */
let captures: "desk" | "nothing" = "desk";

/** The covers this renderer has stood, oldest first (the last 8) — what a harness reads. */
export function coverRecords(): readonly CoverRecord[] {
  return records;
}

/** Read, or set, what the cover's capture answers (a witness's switch; "desk" by default). */
export function coverCaptures(answer?: "desk" | "nothing"): "desk" | "nothing" {
  if (answer !== undefined) captures = answer;
  return captures;
}

/** Test seam: no record, the desk's own captures. */
export function resetCoverRecordsForTest(): void {
  records = [];
  seq = 0;
  captures = "desk";
}

export interface CoverStill {
  /** The cover rose over the desk (`view` names it for the record), or lowered back to the canvas. */
  cover(up: boolean, view?: string): void;
  /** The window resized or the theme changed: while covered, the still is taken again. */
  recapture(reason: "resize" | "theme"): void;
  /** The window's engine changed under a standing cover (a new generation): the old one thawed, the new one frozen at once;
   * the still stands. */
  engineChanged(): void;
  /** Whether a cover stands (a witness). */
  up(): boolean;
  dispose(): void;
}

export function createCoverStill(seams: CoverSeams): CoverStill {
  /** Bumped by every rise and every lowering: a pass that sees a newer one shows nothing. */
  let epoch = 0;
  let up = false;
  let thaw: (() => void) | null = null;
  /** The desk canvas hidden under the still, to show again. */
  let hidden: HTMLCanvasElement | null = null;
  /** The pass in flight (a rise or a re-capture), and one asked meanwhile. */
  let running: symbol | null = null;
  let again: "resize" | "theme" | null = null;
  /** The stand now (null on the canvas). Each pass steps into ITS stand's record, never a later one's. */
  let record: CoverRecord | null = null;
  let disposed = false;
  /** The pass waiting on its park, and its listener on the gate it froze — let go at the park, the lowering, a newer pass. */
  let waiting: { token: number; rec: CoverRecord; pass: CoverPass } | null = null;
  let unpark: (() => void) | null = null;

  const step = (rec: CoverRecord | null, name: string): number => {
    const at = seams.now();
    rec?.steps.push(name);
    return at;
  };

  const thawNow = (rec: CoverRecord | null): number | undefined => {
    if (thaw === null) return undefined;
    thaw();
    thaw = null;
    return step(rec, "thaw");
  };

  const letGoPark = (): void => {
    unpark?.();
    unpark = null;
    waiting = null;
  };

  /** The park as the gate ANNOUNCES it (ICE I41, `frame.onParked`): `true` once, as the settle walk's last step ends — and
   * never replayed on subscribe, so the gate is read ONCE for a park it already holds (another holder's freeze). */
  const hearPark = (token: number, rec: CoverRecord, pass: CoverPass): void => {
    letGoPark();
    const gate = seams.frame();
    const parked = (): void => {
      letGoPark();
      if (token !== epoch || thaw === null || disposed || pass.parked !== undefined) return;
      pass.parked = step(rec, "park");
    };
    waiting = { token, rec, pass };
    unpark = gate.onParked((now) => {
      if (now) parked();
    });
    if (gate.isParked()) parked();
  };

  /** freeze — then the park listened for. */
  const freeze = (token: number, rec: CoverRecord, pass: CoverPass): void => {
    if (thaw === null) thaw = seams.frame().freeze("cover");
    pass.frozen = step(rec, "freeze");
    hearPark(token, rec, pass);
  };

  /** capture → blur once → swap → hide → freeze. False when a newer stand or a lowering overtook it. */
  const captureAndSwap = async (
    token: number,
    rec: CoverRecord,
    pass: CoverPass,
  ): Promise<boolean> => {
    const desk = seams.desk();
    if (desk === null && pass.reason !== "rise") {
      // nothing to take again (the desk between mounts): what stands stays, the gate closed again
      freeze(token, rec, pass);
      return true;
    }
    let still: ImageBitmap | undefined;
    if (desk !== null) {
      const asked = step(rec, "capture");
      const viewWidth = seams.viewWidth(desk);
      try {
        still = captures === "nothing" ? undefined : await desk.handle.capture();
      } catch {
        still = undefined; // the door answers undefined for a lost device; a throw is a malformed ask — the same ground
      }
      pass.capture = {
        asked,
        answered: seams.now(),
        width: still?.width ?? null,
        height: still?.height ?? null,
        viewWidth,
        pxPerCss: still === undefined || viewWidth <= 0 ? null : still.width / viewWidth,
      };
    }
    if (token !== epoch || disposed) {
      still?.close();
      pass.aborted = true;
      return false;
    }
    let face: StillFace;
    if (still === undefined) {
      face = { kind: "ground" };
      // a desk that had drawn and now answers nothing has lost its device: said once a stand
      if (desk !== null && desk.handle.perf().frames >= 1 && rec.said === null) {
        rec.said = LOST_DEVICE_WORDS;
        seams.say(LOST_DEVICE_NOTICE, LOST_DEVICE_WORDS);
      }
    } else {
      const px = COVER.blurCssPx * (pass.capture?.pxPerCss ?? 1);
      const t0 = seams.now();
      try {
        face = { kind: "still", bitmap: seams.blur(still, px) };
      } finally {
        still.close();
      }
      pass.blur = { px, ms: seams.now() - t0 };
      step(rec, "blur");
    }
    seams.surface.show(face);
    pass.face = face.kind === "still" ? "still" : "ground";
    pass.swapped = step(rec, "swap");
    if (desk !== null) {
      const canvas = desk.handle.canvas;
      if (hidden !== null && hidden !== canvas) hidden.style.visibility = "";
      canvas.style.visibility = "hidden";
      hidden = canvas;
    }
    pass.hidden = step(rec, "hide");
    freeze(token, rec, pass);
    return true;
  };

  /** Run a pass to its end, then the one asked meanwhile. */
  const run = async (token: number, rec: CoverRecord, pass: CoverPass): Promise<void> => {
    const mine = Symbol(pass.reason);
    running = mine;
    try {
      if (pass.reason !== "rise") {
        const thawed = thawNow(rec);
        if (thawed !== undefined) pass.thawed = thawed;
        // ONE frame: the thawed desk presents what moved (the new size, the new theme) — or, nothing having moved, the
        // last presented frame is taken after the wait
        const desk = seams.desk();
        if (desk !== null) {
          const f0 = desk.handle.perf().frames;
          const deadline = seams.now() + COVER.frameWaitMs;
          while (
            token === epoch &&
            !disposed &&
            desk.handle.perf().frames <= f0 &&
            seams.now() < deadline
          ) {
            await seams.nextFrame();
          }
          if (token !== epoch || disposed) {
            pass.aborted = true;
            return;
          }
          pass.frame = { frames: desk.handle.perf().frames - f0, at: step(rec, "frame") };
        }
      }
      await captureAndSwap(token, rec, pass);
    } finally {
      if (running === mine) running = null;
    }
    if (token === epoch && !disposed && again !== null) {
      const reason = again;
      again = null;
      const next: CoverPass = { reason, asked: seams.now() };
      rec.passes.push(next);
      await run(token, rec, next);
    }
  };

  const rise = (view: string): void => {
    epoch += 1;
    up = true;
    again = null;
    seq += 1;
    const rec: CoverRecord = {
      seq,
      view,
      reduced: seams.reduced(),
      rose: seams.now(),
      passes: [],
      steps: [],
      said: null,
    };
    record = rec;
    records = [...records, rec].slice(-KEPT);
    const pass: CoverPass = { reason: "rise", asked: rec.rose };
    rec.passes.push(pass);
    void run(epoch, rec, pass);
  };

  /** THAW FIRST, then the live canvas shown at once, then the still dropped. */
  const lower = (): void => {
    epoch += 1;
    up = false;
    again = null;
    const rec = record;
    record = null;
    if (rec !== null) rec.lowered = seams.now();
    letGoPark();
    const thawed = thawNow(rec);
    if (hidden !== null) {
      hidden.style.visibility = "";
      hidden = null;
    }
    const shown = step(rec, "show");
    seams.surface.show({ kind: "none" });
    const dropped = step(rec, "drop");
    if (rec !== null) {
      if (thawed !== undefined) rec.thawed = thawed;
      rec.shown = shown;
      rec.dropped = dropped;
    }
  };

  return {
    cover(next, view = "cover") {
      if (disposed || next === up) return;
      if (next) rise(view);
      else lower();
    },
    recapture(reason) {
      if (disposed || !up || record === null) return;
      if (running !== null) {
        again = reason;
        return;
      }
      const pass: CoverPass = { reason, asked: seams.now() };
      record.passes.push(pass);
      void run(epoch, record, pass);
    },
    engineChanged() {
      if (disposed || !up || thaw === null) return;
      const pending = waiting;
      thaw();
      thaw = seams.frame().freeze("cover");
      step(record, "engine");
      // a park still owed is the NEW gate's to announce
      if (pending !== null) hearPark(pending.token, pending.rec, pending.pass);
      else letGoPark();
    },
    up: () => up,
    dispose() {
      if (disposed) return;
      if (up) lower();
      disposed = true;
    },
  };
}

/**
 * BLUR A STILL ONCE (DESIGN.md §8): `px` of the still's own (40 CSS px × its bitmap px per CSS px), through an
 * OffscreenCanvas 2D `filter` — the edges CLAMPED first, so the blur never fades the still's rim to nothing: the still is
 * drawn into a canvas padded by the kernel's reach (3 σ) on every side, its edge rows and columns stretched into the pad,
 * and the blur drawn back at the still's own size. Returns a new bitmap; the caller closes the source.
 */
export function blurStill(
  bitmap: ImageBitmap,
  px: number,
  make: (width: number, height: number) => OffscreenCanvas = (width, height) =>
    new OffscreenCanvas(width, height),
): ImageBitmap {
  const { width: w, height: h } = bitmap;
  const pad = Math.ceil(px * 3);
  const padded = make(w + 2 * pad, h + 2 * pad);
  const p = padded.getContext("2d");
  if (p === null) throw new Error("cover still: no 2d context");
  p.imageSmoothingEnabled = false;
  p.drawImage(bitmap, pad, pad);
  if (pad > 0) {
    // the four edges stretched outward, then the four corners — nearest, so no texel beyond the still is ever sampled
    p.drawImage(bitmap, 0, 0, w, 1, pad, 0, w, pad);
    p.drawImage(bitmap, 0, h - 1, w, 1, pad, pad + h, w, pad);
    p.drawImage(bitmap, 0, 0, 1, h, 0, pad, pad, h);
    p.drawImage(bitmap, w - 1, 0, 1, h, pad + w, pad, pad, h);
    p.drawImage(bitmap, 0, 0, 1, 1, 0, 0, pad, pad);
    p.drawImage(bitmap, w - 1, 0, 1, 1, pad + w, 0, pad, pad);
    p.drawImage(bitmap, 0, h - 1, 1, 1, 0, pad + h, pad, pad);
    p.drawImage(bitmap, w - 1, h - 1, 1, 1, pad + w, pad + h, pad, pad);
  }
  const out = make(w, h);
  const o = out.getContext("2d");
  if (o === null) throw new Error("cover still: no 2d context");
  o.filter = `blur(${px}px)`;
  o.drawImage(padded, -pad, -pad);
  return out.transferToImageBitmap();
}

/**
 * The still's surface in the product: a canvas over the desk with a `bitmaprenderer` context — the blurred still handed
 * over whole (no copy), the mat's ground a CSS colour (`--vf-mat-ground`), nothing at all a transparent canvas the
 * compositor skips (`data-still="none"` — hidden). THE RECEDE starts as a still first stands: its scale-1 style flushed,
 * then `data-recede` — 0.98 over 560 ms, transform only (`cover-still.css`); a still taken again under a standing cover
 * keeps the recede where it is. The ground never recedes: a flat colour has nothing to settle.
 */
export function stillCanvasSurface(el: HTMLCanvasElement): StillSurface {
  let ctx: ImageBitmapRenderingContext | null = null;
  const context = (): ImageBitmapRenderingContext | null => {
    ctx ??= el.getContext("bitmaprenderer");
    return ctx;
  };
  return {
    show(face) {
      if (face.kind === "still") {
        const c = context();
        if (c === null) {
          face.bitmap.close();
          el.dataset.still = "ground";
          return;
        }
        c.transferFromImageBitmap(face.bitmap);
        el.dataset.still = "still";
        if (el.dataset.recede !== "true") {
          void getComputedStyle(el).transform;
          el.dataset.recede = "true";
        }
        return;
      }
      ctx?.transferFromImageBitmap(null);
      el.dataset.still = face.kind;
      el.dataset.recede = "false";
    },
  };
}
