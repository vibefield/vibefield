// THE STILL'S NOTICE (TL-3, 2026-11-19; DESIGN.md §8 "The glass is the desk"): what stands under the covers now, said by
// the still's surface (`stillCanvasSurface`) at every face it shows, for the one reader that draws it again, Godview's
// well (`godview/desk-glass.tsx`). Nothing here copies, keeps or sends a picture: a reader that wants one draws it from
// the still's own canvas while that still stands, and lets it go when the face changes.

export interface DeskStill {
  /** What stands under the cover: the blurred still, the mat's ground, or nothing (the canvas is the view). */
  readonly face: "still" | "ground" | "none";
  /** Bumped at every face shown, so a picture drawn from an earlier still is known to be old. */
  readonly generation: number;
  /** The canvas the still is drawn on, while a still stands. */
  readonly canvas: HTMLCanvasElement | null;
  /** The still's own size, in its px, while a still stands (0 otherwise). */
  readonly width: number;
  readonly height: number;
}

const NONE: DeskStill = { face: "none", generation: 0, canvas: null, width: 0, height: 0 };
let current: DeskStill = NONE;
const listeners = new Set<() => void>();

export function deskStill(): DeskStill {
  return current;
}

export function subscribeDeskStill(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The surface's word: this face is shown now. A still names its canvas and its size; any other face names neither. */
export function sayDeskStill(
  face: DeskStill["face"],
  still?: { readonly canvas: HTMLCanvasElement; readonly width: number; readonly height: number },
): void {
  const generation = current.generation + 1;
  current =
    face === "still" && still !== undefined
      ? { face, generation, canvas: still.canvas, width: still.width, height: still.height }
      : { face: face === "still" ? "ground" : face, generation, canvas: null, width: 0, height: 0 };
  for (const listener of listeners) listener();
}

/** Test seam: nothing stands, and no one listens. */
export function resetDeskStillForTest(): void {
  current = NONE;
  listeners.clear();
}
