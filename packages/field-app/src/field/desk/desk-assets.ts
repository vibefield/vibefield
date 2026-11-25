import {
  type HandFaceFiles,
  type HandFacesLender,
  handFaces,
  type InkRaster,
  inkRaster,
  penFaces,
} from "@vibecook/ice/desk";
import caveat500 from "./assets/fonts/Caveat-500.ttf?url";
import caveat600 from "./assets/fonts/Caveat-600.ttf?url";
import kalam400 from "./assets/fonts/Kalam-400.ttf?url";
import { base64Bytes } from "./desk-bytes";
import { DESK_FACE_FILES, deskHandFiles } from "./desk-faces";
import type { DeskPlant } from "./desk-plates";

// WHAT THE DESK IS FED (DK-3; the orchestrator's ruling 8 — the packaged CSP is NOT widened; r6 §3):
//
// - THE HAND: the three OFL faces ICE's desk app ships (assets/fonts, OFL.txt beside them — Caveat
//   medium and semibold, Kalam), handed to the desk's text raster BY URL. ICE loads each through
//   `new FontFace(family, "url(…)")` — the font loader, governed by `font-src`, which the packaged
//   policy leaves to `default-src 'self'`; the files are the renderer's own assets. One raster per
//   page; a face loads once, the first time a note asks for it.
// - THE HAND'S PEN (IK, 2026-11-25; ICE I59): the same three faces BAKED (assets/hand, OFL.txt beside
//   them; `pnpm gen:hands`), lent to every kind under the same names. ICE's lender reads a face's two
//   files through a `fetch` the host may hand it, and the window's own `fetch` is what `connect-src
//   ws://127.0.0.1:*` refuses packaged — so this one reads each file from a BUNDLED MODULE, as the
//   plates are: the json's text (`?raw`), the bin's bytes as a data URL (`?url&inline`, base64, decoded
//   here). Each file is its own lazy chunk, reached only on a sheet's first ask for its face. The
//   raster stays: it still writes a sheet the face cannot (a glyph it lacks).
// - THE PLATES: lazy modules, one per plant (desk-plates.ts) — never a `fetch`, which `connect-src
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

const text = (module: Promise<{ readonly default: string }>): Promise<string> =>
  module.then((m) => m.default);

/** Each baked file's module, by its name: the json's text, the bin's data URL — each its own lazy chunk. */
const HAND_MODULES: Readonly<Record<string, () => Promise<string>>> = {
  "caveat-500.hand.json": () => text(import("./assets/hand/caveat-500.hand.json?raw")),
  "caveat-500.hand.bin": () => text(import("./assets/hand/caveat-500.hand.bin?url&inline")),
  "caveat-600.hand.json": () => text(import("./assets/hand/caveat-600.hand.json?raw")),
  "caveat-600.hand.bin": () => text(import("./assets/hand/caveat-600.hand.bin?url&inline")),
  "kalam-400.hand.json": () => text(import("./assets/hand/kalam-400.hand.json?raw")),
  "kalam-400.hand.bin": () => text(import("./assets/hand/kalam-400.hand.bin?url&inline")),
};

/** The baked files the bundle holds, by name (a test holds them to the face table). */
export const DESK_HAND_MODULE_NAMES: readonly string[] = Object.keys(HAND_MODULES);

/** The hand's faces' files, by the desk's names for the faces: each face's two baked files, by name (desk-faces.ts). */
export const DESK_HAND_FILES: Readonly<Record<string, HandFaceFiles>> = Object.fromEntries(
  Object.entries(DESK_FACE_FILES).map(([name, file]) => [name, deskHandFiles(file)]),
);

/** What the hand's lender reads a file as: a response's two readers, over the file's own bytes. */
export interface DeskHandFile {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * One baked file, by its name, read from its bundled module — never a request (ruling 8): the json's text as written, the
 * bin's bytes from their data URL. A name the table does not hold answers 404, so the lender says the face did not load and
 * its sheets keep the raster.
 */
export async function deskHandFile(name: string): Promise<DeskHandFile> {
  const load = HAND_MODULES[name];
  if (load === undefined) {
    const none = (): Promise<never> => Promise.reject(new Error(`desk: no hand file ${name}`));
    return { ok: false, status: 404, json: none, arrayBuffer: none };
  }
  const value = await load();
  const bytes = name.endsWith(".bin")
    ? base64Bytes(value.slice(value.indexOf(",") + 1))
    : new TextEncoder().encode(value);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(value),
    arrayBuffer: async () => bytes.buffer,
  };
}

let hand: HandFacesLender | null = null;

/** The page's hand faces (IK; ICE I59): the baked atlases by the `PEN_FACES` names, each read once, on a sheet's first ask. */
export function deskHand(): HandFacesLender {
  hand ??= handFaces({ faces: DESK_HAND_FILES, fetch: deskHandFile });
  return hand;
}

/** One plant's gobo plate — loaded once, from its own lazy module (item 583: a desk loads the plant it wears). */
export function deskPlate(plant: DeskPlant): Promise<Uint8Array<ArrayBuffer>> {
  return import("./desk-plates").then((m) => m.loadPlate(plant));
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
