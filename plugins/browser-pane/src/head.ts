// The HEAD's raster — what is engraved into the pane's head, as the pass reads it (BROWSER.md §4; the prototype's
// lab/browser-band.ts, its pure half). Pure: the service's KEY and its shape, what a raster depends on, the band ladder
// it is drawn at, and where its two halves' rows are. The drawing itself is the plugin's DOM half's (head-canvas.ts —
// Canvas 2D, lent as a keyed service, PT-1 ruling 8: the desk's `TextRaster` lays hand layouts to r8 alone, and the head
// is RGBA — the UI's sans and mono, ‹ › ↻ ✕, the lock, a colour favicon).
//
// The raster holds both: its upper half the engraving's coverage (alpha), its lower half the colour print
// (premultiplied), a two-texel gutter between — `engraveSplit` says where each half's rows are.

import { serviceKey } from "@vibefield/plugin-sdk/desk";
import { displayOf, isSecure } from "./address";
import { SAMPLE_URL } from "./ids";
import type { PaneShape } from "./law";
import type { HeadBitmap } from "./layout";

/** What the head says. */
export interface HeadState {
  /** The address as it is cut ("" = none: the start page's prompt). */
  readonly display: string;
  readonly secure: boolean;
  /** The favicon printed on the capsule, by id (null: none). PT-1 knows one: the sample's (`"sample"`). */
  readonly favicon: string | null;
  readonly loading: boolean;
  readonly canBack: boolean;
  readonly canForward: boolean;
  /** The viewport, CSS px — the dev browser's size readout, set flush right. */
  readonly viewport: readonly [number, number];
}

/**
 * What a pane's head says in PT-1, from its address and its shape: the address as printed, its lock, the sample's
 * favicon on the sample, and the viewport — never loading, no history (a still page has neither: PT-2's live page does).
 */
export function headStateOf(url: string, S: PaneShape): HeadState {
  return {
    display: displayOf(url),
    secure: isSecure(url),
    favicon: url === SAMPLE_URL ? "sample" : null,
    loading: false,
    canBack: false,
    canForward: false,
    viewport: S.viewport,
  };
}

/** The head's raster as a service a host lends: the pane's head for what it says, drawn at `tpu` texels per world unit. */
export interface HeadRaster {
  raster(S: PaneShape, state: HeadState, tpu: number): HeadBitmap | undefined;
}

/**
 * THE SERVICE'S KEY (ICE K8a): the plugin's DOM half lends it (object.ts `host.lend`, head-canvas.ts) wherever the
 * platform's Canvas 2D is (the product's renderer); where none is lent (a Node still), the pass draws its committed
 * raster (head-still.ts).
 */
export const HEAD_RASTER = serviceKey<HeadRaster>("vibefield.browser-pane.head");

/** The most texels a head's raster may take along its long side. */
export const BAND_TEXELS_MAX = 4096;
/** Texel rows between the engraving and the print. */
export const GUTTER = 2;
/** The band ladder's ends, texels per world unit: a head is never drawn coarser or finer. */
export const BAND = { min: 0.5, max: 8 } as const;

/**
 * What a raster depends on — a new key is a new raster: its size in TEXELS (never the pane's world extent as a decimal: the
 * desk stores a size as f32, so 201.03 comes back 201.0299…, and a key spelt from it drifts across a rounding boundary —
 * the texels it rounds to do not), its band, and what it says.
 */
export const headKey = (S: PaneShape, st: HeadState, tpu: number): string => {
  const { width, half } = headSize(S, tpu);
  return [
    `${width}x${half}`,
    tpu,
    st.display,
    st.secure,
    st.favicon ?? "",
    st.loading,
    st.canBack,
    st.canForward,
    st.viewport.join("x"),
  ].join("|");
};

/**
 * The band a zoom × dpr draws a head at, texels per world unit: the note's √2 ladder (the smallest step at or past the
 * screen's density), within the ladder's ends. Its exponent (in half-octaves) is the kind's RUNG.
 */
export function bandFor(zoomDpr: number): number {
  if (!(zoomDpr > 0) || !Number.isFinite(zoomDpr)) return BAND.min;
  const b = 2 ** (Math.ceil(2 * Math.log2(zoomDpr) - 1e-9) / 2);
  return Math.min(BAND.max, Math.max(BAND.min, b));
}

/** The rung of a zoom × dpr: the band's exponent in half-octaves (what the kind's `rung` answers). */
export const rungFor = (zoomDpr: number): number => Math.round(2 * Math.log2(bandFor(zoomDpr)));

/** The texels per world unit a head is drawn at: the band's, held under the texel cap. */
export const bandDensity = (S: PaneShape, band: number): number =>
  Math.min(band, BAND_TEXELS_MAX / (2 * S.half[0]));

/** A head raster's size at `tpu`: its width, each half's rows, its height. */
export function headSize(
  S: PaneShape,
  tpu: number,
): { readonly width: number; readonly half: number; readonly height: number } {
  const width = Math.max(1, Math.round(2 * S.half[0] * tpu));
  const half = Math.max(1, Math.round((S.band + S.half[1]) * tpu));
  return { width, half, height: half * 2 + GUTTER };
}

/** Where the two halves sit in a raster `height` texels tall: the engraving's rows [0, h), the print's from `at`. */
export const engraveSplit = (height: number): { readonly h: number; readonly at: number } => {
  const h = (height - GUTTER) / 2;
  return { h, at: h + GUTTER };
};
