import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { COVER } from "../field/desk/cover-still";
import { type DeskStill, deskStill, subscribeDeskStill } from "../field/desk/desk-still";

// THE GLASS IS THE DESK (TL-3, 2026-11-19; DESIGN.md §8 "The glass is the desk"; R16, DK-D25). Under the panes, in the
// deck's well, stands the same still the cover stands on, at its own place in the window and opaque, so a pane's ground
// at its alpha is the only layer between its text and the desk (at the default 82%, the desk is 18% of a pane's ground).
//
// THE PICTURE. Drawn from the still's own canvas once per still while Godview's glass is wanted, at a quarter of its size
// (the blur hides the rest), as an object URL that lives in this renderer alone: never stored, logged or sent, and
// revoked when a newer still replaces it, when the cover drops its still or stands on the mat's ground, when the glass is
// no longer wanted (Godview lowered, the panes solid, Reduce transparency) and when the well goes. Nothing is drawn while
// the glass is not wanted.
//
// ITS PLACE, from the two LAYOUT boxes (offsets, never the boxes a transform is moving): the still as it rests (receded
// to 0.98 once it stands, unless Reduce motion keeps it at 1, as cover-still.css does) and the well. So the picture is
// placed where the well will stand: while the sheet travels (a rise, a fall, a maximize, a restore) or Godview opens, it
// rides with them and lands aligned, never snapping. It is placed again only when something moves: the deck's state or
// shift on the stage's root, the well's size, the still's face, the window's size. One placing per frame at most;
// nothing runs while nothing moves.

/** The picture's numbers (DESIGN.md §8 "The glass is the desk"). */
export const GLASS = {
  /** a quarter of the still's size, each way: the blur (40 CSS px) hides the rest */
  pictureScale: 0.25,
  pictureType: "image/jpeg",
  pictureQuality: 0.9,
} as const;

/** A box on the page, in CSS px. */
export interface GlassBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where the picture is painted in the well: its offset from the well's corner and its size, in CSS px. */
export interface GlassPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The still's resting box (scaled about its centre by `scale`) placed in the well's coordinates. PURE. */
export function glassPlacement(still: GlassBox, scale: number, well: GlassBox): GlassPlacement {
  const width = still.width * scale;
  const height = still.height * scale;
  return {
    x: still.left + (still.width - width) / 2 - well.left,
    y: still.top + (still.height - height) / 2 - well.top,
    width,
    height,
  };
}

/** Whether Godview's glass wants the desk: Godview shown, panes that are not solid, and no Reduce transparency. PURE. */
export function glassWanted(open: boolean, opacity: number, reduceTransparency: boolean): boolean {
  return open && opacity < 1 && !reduceTransparency;
}

/** What the well stands on: the desk's picture, the mat's ground, or nothing of its own (the frame, as before TL-3). */
export type GlassFace =
  | { readonly kind: "picture"; readonly url: string }
  | { readonly kind: "ground" }
  | null;

export interface DeskGlassSeams {
  readonly still: () => DeskStill;
  readonly subscribe: (listener: () => void) => () => void;
  /** Draw a still at `GLASS.pictureScale` of its size, as the picture's bytes; null when it drew nothing. */
  readonly draw: (still: DeskStill) => Promise<Blob | null>;
  readonly createUrl: (picture: Blob) => string;
  readonly revokeUrl: (url: string) => void;
}

export interface DeskGlass {
  /** Whether the glass is wanted now. Not wanted, no picture is drawn and any held one is revoked. */
  want(wanted: boolean): void;
  face(): GlassFace;
  subscribe(listener: () => void): () => void;
  /** The well goes: the held picture is revoked, and one still being drawn is dropped when it comes. */
  dispose(): void;
}

function sameFace(a: GlassFace, b: GlassFace): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "ground" || b.kind === "ground") return a.kind === b.kind;
  return a.url === b.url;
}

export function createDeskGlass(seams: DeskGlassSeams): DeskGlass {
  let wanted = false;
  let disposed = false;
  let face: GlassFace = null;
  /** the picture held, and the still it was drawn from */
  let held: { readonly generation: number; readonly url: string } | null = null;
  /** each draw's ask: a picture that comes after a newer ask, a drop or the well's going is never made a URL */
  let asks = 0;
  let drawing: number | null = null;
  const listeners = new Set<() => void>();

  const show = (next: GlassFace): void => {
    if (sameFace(next, face)) return;
    face = next;
    for (const listener of listeners) listener();
  };

  const letGo = (): void => {
    asks += 1;
    drawing = null;
    if (held === null) return;
    const url = held.url;
    held = null;
    seams.revokeUrl(url);
  };

  const refresh = (): void => {
    const still = seams.still();
    if (disposed || !wanted || still.face === "none") {
      letGo();
      show(null);
      return;
    }
    if (still.face === "ground") {
      letGo();
      show({ kind: "ground" });
      return;
    }
    if (held !== null && held.generation === still.generation) {
      show({ kind: "picture", url: held.url });
      return;
    }
    if (drawing === still.generation) return;
    // a newer still: the one held stands until its replacement is drawn, and is revoked then
    asks += 1;
    const ask = asks;
    drawing = still.generation;
    void seams.draw(still).then(
      (picture) => {
        if (ask !== asks || disposed || !wanted || seams.still().generation !== still.generation)
          return;
        drawing = null;
        if (picture === null) {
          letGo();
          show({ kind: "ground" });
          return;
        }
        const url = seams.createUrl(picture);
        const old = held;
        held = { generation: still.generation, url };
        show({ kind: "picture", url });
        if (old !== null) seams.revokeUrl(old.url);
      },
      () => {
        if (ask !== asks || disposed) return;
        drawing = null;
        letGo();
        show({ kind: "ground" });
      },
    );
  };

  const stop = seams.subscribe(refresh);
  return {
    want(next) {
      if (disposed || next === wanted) return;
      wanted = next;
      refresh();
    },
    face: () => face,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      letGo();
      face = null;
      listeners.clear();
    },
  };
}

/** The product's draw: the still's canvas at a quarter of its size, as a JPEG. A draw that leaves the picture's first
 * pixel transparent drew nothing (the still is opaque), and answers null: the well stands on the mat's ground. */
export async function drawDeskPicture(still: DeskStill): Promise<Blob | null> {
  if (still.canvas === null || still.width <= 0 || still.height <= 0) return null;
  const width = Math.max(1, Math.round(still.width * GLASS.pictureScale));
  const height = Math.max(1, Math.round(still.height * GLASS.pictureScale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(still.canvas, 0, 0, width, height);
  if (context.getImageData(0, 0, 1, 1).data[3] === 0) return null;
  return canvas.convertToBlob({ type: GLASS.pictureType, quality: GLASS.pictureQuality });
}

const PRODUCT_SEAMS: DeskGlassSeams = {
  still: deskStill,
  subscribe: subscribeDeskStill,
  draw: drawDeskPicture,
  createUrl: (picture) => URL.createObjectURL(picture),
  revokeUrl: (url) => URL.revokeObjectURL(url),
};

/** A box as layout placed it, transforms aside: the sum of its offsets up its offset parents. A
 * browser ends the chain with null; a test DOM may end it with undefined, and either ends it here
 * (item 590, 2026-11-21). */
function layoutBox(element: HTMLElement): GlassBox {
  let left = 0;
  let top = 0;
  for (
    let at: HTMLElement | null | undefined = element;
    at !== null && at !== undefined;
    at = at.offsetParent as HTMLElement | null | undefined
  ) {
    left += at.offsetLeft;
    top += at.offsetTop;
  }
  return { left, top, width: element.offsetWidth, height: element.offsetHeight };
}

function reduced(query: string): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia(query).matches;
  } catch {
    return false;
  }
}

const REDUCE_TRANSPARENCY = "(prefers-reduced-transparency: reduce)";
const REDUCE_MOTION = "(prefers-reduced-motion: reduce)";

/** Reduce transparency, as the system says it now. */
export function useReduceTransparency(): boolean {
  const [reduce, setReduce] = useState(() => reduced(REDUCE_TRANSPARENCY));
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(REDUCE_TRANSPARENCY);
    const hear = (): void => setReduce(query.matches);
    query.addEventListener("change", hear);
    return () => query.removeEventListener("change", hear);
  }, []);
  return reduce;
}

/** The still's scale at rest: receded once a still stands, unless Reduce motion keeps it whole (cover-still.css). */
function restingScale(still: HTMLCanvasElement): number {
  return still.dataset.still === "still" &&
    still.dataset.recede === "true" &&
    !reduced(REDUCE_MOTION)
    ? COVER.recedeScale
    : 1;
}

const PLACEMENT_PROPERTIES = [
  "--vf-godview-glass-x",
  "--vf-godview-glass-y",
  "--vf-godview-glass-w",
  "--vf-godview-glass-h",
] as const;

/**
 * THE WELL'S GROUND (TL-3): the desk's picture under the panes, or the mat's ground under a cover that stands on it, or
 * nothing while the glass is not wanted. The window's Godview hands it to the stage, which stands it in the well before
 * the panes (`GodviewStage`'s `wellGround`).
 */
export function DeskGlass({
  wanted,
  seams = PRODUCT_SEAMS,
}: {
  wanted: boolean;
  seams?: DeskGlassSeams;
}): ReactElement | null {
  // One glass for the well's life, made in an effect, so StrictMode's twin mount makes its own and disposes it.
  const glass = useRef<DeskGlass | null>(null);
  const wants = useRef(wanted);
  wants.current = wanted;
  const [face, setFace] = useState<GlassFace>(null);
  useEffect(() => {
    const made = createDeskGlass(seams);
    glass.current = made;
    const stop = made.subscribe(() => setFace(made.face()));
    made.want(wants.current);
    return () => {
      stop();
      made.dispose();
      if (glass.current === made) glass.current = null;
      setFace(null);
    };
  }, [seams]);
  useEffect(() => {
    glass.current?.want(wanted);
  }, [wanted]);
  const layer = useRef<HTMLDivElement>(null);
  const picture = face?.kind === "picture";

  useLayoutEffect(() => {
    const element = layer.current;
    if (!picture || element === null) return;
    const root = element.closest<HTMLElement>(".vf-godview");
    let frame = 0;
    let placed = "";
    const place = (): void => {
      frame = 0;
      const still = seams.still().canvas;
      if (still === null) return;
      const at = glassPlacement(layoutBox(still), restingScale(still), layoutBox(element));
      const values = [at.x, at.y, at.width, at.height].map(
        (value) => `${Math.round(value * 100) / 100}px`,
      );
      const said = values.join(" ");
      if (said === placed) return;
      placed = said;
      for (const [index, name] of PLACEMENT_PROPERTIES.entries()) {
        element.style.setProperty(name, values[index] ?? "0px");
      }
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(place);
    };
    place();
    const sized = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    sized?.observe(element);
    const moved = new MutationObserver(schedule);
    if (root !== null) {
      moved.observe(root, {
        attributes: true,
        attributeFilter: [
          "style",
          "data-godview-deck",
          "data-godview-deck-layout",
          "data-godview-open",
        ],
      });
    }
    const still = seams.still().canvas;
    if (still !== null)
      moved.observe(still, { attributes: true, attributeFilter: ["data-still", "data-recede"] });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      sized?.disconnect();
      moved.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [picture, seams]);

  if (face === null) return null;
  return (
    <div
      ref={layer}
      className="vf-godview-deck-glass"
      data-glass={face.kind}
      aria-hidden="true"
      style={face.kind === "picture" ? { backgroundImage: `url("${face.url}")` } : undefined}
    />
  );
}
