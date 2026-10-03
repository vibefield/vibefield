import { type InkRaster, inkRaster, penFaces } from "@vibecook/ice/desk";
import caveat500 from "./assets/fonts/Caveat-500.ttf?url";
import caveat600 from "./assets/fonts/Caveat-600.ttf?url";
import kalam400 from "./assets/fonts/Kalam-400.ttf?url";
import type { DeskPlates } from "./desk-plates";

// WHAT THE DESK IS FED (DK-3; the orchestrator's ruling 8 — the packaged CSP is NOT widened; r6 §3):
//
// - THE HAND: the three OFL faces ICE's desk app ships (assets/fonts, OFL.txt beside them — Caveat
//   medium and semibold, Kalam), handed to the desk's text raster BY URL. ICE loads each through
//   `new FontFace(family, "url(…)")` — the font loader, governed by `font-src`, which the packaged
//   policy leaves to `default-src 'self'`; the files are the renderer's own assets. One raster per
//   page; a face loads once, the first time a note asks for it.
// - THE PLATES: a lazy module (desk-plates.ts) — never a `fetch`, which `connect-src
//   ws://127.0.0.1:*` refuses packaged.
// - THE SEED'S PRINT: a lazy module too (desk-sample-print.ts).

/** The faces' files, by the desk's names for them (`PEN_FACES`). */
export const DESK_FACE_URLS: Readonly<Record<string, string>> = {
  caveat: caveat500,
  "caveat-bold": caveat600,
  kalam: kalam400,
};

let raster: InkRaster | null = null;

/** The page's text raster over the shipped faces. */
export function deskText(): InkRaster {
  raster ??= inkRaster({ faces: penFaces(DESK_FACE_URLS) });
  return raster;
}

let plates: Promise<DeskPlates> | null = null;

/** The generated gobo plates — loaded once, from their lazy module. */
export function deskPlates(): Promise<DeskPlates> {
  plates ??= import("./desk-plates").then((m) => m.loadPlates());
  return plates;
}

/** The seed's print: its bytes and what the store will name them. */
export async function samplePrint(): Promise<{
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly type: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}> {
  const m = await import("./desk-sample-print");
  return { ...m.SAMPLE_PRINT, bytes: m.samplePrintBytes() };
}
