// THE GOBO PLATES (DK-3; the orchestrator's ruling 8 — the packaged CSP is NOT widened): the two
// 512² rgba8 plates ICE's desk app generates (`apps/desk/tools/make-gobo-plate.mjs` at ICE `c7ade1a`:
// `palm --seed 1` for slot `c`, `canopy --seed 1` for slot `b` — never the study's plates, whose licence
// the product does not hold), shipped as BUNDLED MODULES: each plate's gzip as base64 text, imported
// `?raw`, inflated in memory (desk-bytes.ts). Nothing is requested — the packaged renderer's
// `connect-src` admits `ws://127.0.0.1:*` alone, so ICE's own app's `fetch(url)` of its plates is
// refused there (r6 §3). Reached only through `import()` (desk-assets.ts), so its text rides a lazy
// chunk, never the boot graph.

import canopyGz from "./assets/gobo-canopy-1.rgba.gz.b64?raw";
import palmGz from "./assets/gobo-palm-1.rgba.gz.b64?raw";
import { base64Bytes, gunzip } from "./desk-bytes";

/** A plate is 512² texels of rgba8 (`handle.setPlate`). */
export const PLATE_BYTES = 512 * 512 * 4;

/** SHA-256 of each plate's raw bytes — ICE's committed `apps/desk/assets/*.rgba`, which its `gen:check`
 * holds to the generator; the test holds these modules to the same bytes. */
export const PLATE_SHA256 = {
  c: "d61fdb9f49009c32d008ddd01e34d3317dd2883d1fd723401cf6cb1c938320c5",
  b: "4e4f5563646845fddaad3d62f595bdf8fccc4eb4d13abccbeb430bf4daaae482",
} as const;

export interface DeskPlates {
  readonly c: Uint8Array<ArrayBuffer>;
  readonly b: Uint8Array<ArrayBuffer>;
}

async function plate(text: string, name: string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await gunzip(base64Bytes(text));
  if (bytes.length !== PLATE_BYTES) {
    throw new Error(`desk: the ${name} plate is ${bytes.length} bytes, not ${PLATE_BYTES}`);
  }
  return bytes;
}

/** Both plates, inflated: `c` the palm, `b` the canopy. */
export async function loadPlates(): Promise<DeskPlates> {
  const [c, b] = await Promise.all([plate(palmGz, "palm"), plate(canopyGz, "canopy")]);
  return { c, b };
}
