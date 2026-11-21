import type { ReactElement } from "react";
import type { DeskStill } from "../field/desk/desk-still";

// THE GLASS IS THE DESK (TL-3, 2026-11-19; DESIGN.md §8 "The glass is the desk"): the surface its rows read, ahead of
// the glass itself. Today the well has no ground of its own: the glass is never wanted, no picture is drawn, and
// nothing stands under the panes but the frame.

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

/** Nothing is placed yet. */
export function glassPlacement(_still: GlassBox, _scale: number, _well: GlassBox): GlassPlacement {
  return { x: 0, y: 0, width: 0, height: 0 };
}

/** The glass is never wanted yet. */
export function glassWanted(
  _open: boolean,
  _opacity: number,
  _reduceTransparency: boolean,
): boolean {
  return false;
}

/** What the well stands on: the desk's picture, the mat's ground, or nothing of its own (the frame). */
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
  /** Whether the glass is wanted now. */
  want(wanted: boolean): void;
  face(): GlassFace;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** A glass that stands nothing yet. */
export function createDeskGlass(_seams: DeskGlassSeams): DeskGlass {
  return {
    want() {},
    face: () => null,
    subscribe: () => () => {},
    dispose() {},
  };
}

/** The well's ground: nothing yet. */
export function DeskGlass(_props: {
  wanted: boolean;
  seams?: DeskGlassSeams;
}): ReactElement | null {
  return null;
}
