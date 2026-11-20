// THE PLANTS' PLATES (DK-3; the orchestrator's ruling 8 — the packaged CSP is NOT widened; item 583): the 512² rgba8
// gobo plates a desk can wear, one per plant of Settings → Canvas (DESIGN.md §8), shipped as BUNDLED MODULES: each
// plate's gzip as base64 text, imported `?raw`, inflated in memory (desk-bytes.ts). Nothing is requested — the
// packaged renderer's `connect-src` admits `ws://127.0.0.1:*` alone, so a `fetch(url)` of a plate is refused there
// (r6 §3). EACH PLATE IS ITS OWN LAZY CHUNK, reached only through the `import()` below, so a desk loads the one plant
// it wears and no plate's text rides the boot graph.
//
// WHERE THEY COME FROM:
// - `palm` and `canopy` are grown: ICE's desk app generates them (`apps/desk/tools/make-gobo-plate.mjs` at ICE
//   `c7ade1a`: `palm --seed 1`, `canopy --seed 1` — never the study's plates, whose licence the product does not hold).
// - The other five are made from pictures generated for this product (2026-11-19), by that tool's prototype
//   (`draft/ground/tools/make-gobo-plate.mjs`, whose `image` path ICE's port left behind): `image <picture>
//   --sigma 0.6 --levels`. The picture's luminance is the silhouette, and the wind's channels are grown from it. The
//   pictures are not committed; each plate is pinned by the SHA-256 of its raw bytes.

import type { DeskLightPlant } from "@vibefield/contracts";
import { base64Bytes, gunzip } from "./desk-bytes";

/** A plate is 512² texels of rgba8 (`handle.setPlate`). */
export const PLATE_BYTES = 512 * 512 * 4;

/** A plant that has a plate: every plant but `none`, the bare mat in open light. */
export type DeskPlant = Exclude<DeskLightPlant, "none">;

interface PlantPlate {
  /** SHA-256 of the plate's raw bytes; the test holds the bundled module to it. */
  readonly sha256: string;
  /** The plate's gzip as base64 text, from its own lazy chunk. */
  readonly text: () => Promise<string>;
}

const raw = (module: Promise<{ readonly default: string }>): Promise<string> =>
  module.then((m) => m.default);

export const PLANT_PLATES: Readonly<Record<DeskPlant, PlantPlate>> = {
  monstera: {
    sha256: "e0aabf08dc82b37db0af3968806de19b2a5afa2150f9cf723f8c000bdcebf222",
    text: () => raw(import("./assets/gobo-monstera.rgba.gz.b64?raw")),
  },
  "climbing-monstera": {
    sha256: "34bc78e048def4367d23e51584fe5f77db4f9c4891bf59b377a36b68c2abbf96",
    text: () => raw(import("./assets/gobo-climbing-monstera.rgba.gz.b64?raw")),
  },
  "fan-palm": {
    sha256: "019f38b918342f045023679e5612238ed38a41637228a554e1f33301c30b9735",
    text: () => raw(import("./assets/gobo-fan-palm.rgba.gz.b64?raw")),
  },
  "coconut-palm": {
    sha256: "513e7eb308cc0b990d03e484b1787c9351a4de344812ffd8de37d290241fed8e",
    text: () => raw(import("./assets/gobo-coconut-palm.rgba.gz.b64?raw")),
  },
  "under-the-palm": {
    sha256: "8da18eca7b42da4f88bcb3205504ab94f935b9843d9a498152795c9f3e18c69a",
    text: () => raw(import("./assets/gobo-under-the-palm.rgba.gz.b64?raw")),
  },
  // ICE's committed `apps/desk/assets/*.rgba`, which its `gen:check` holds to the generator
  palm: {
    sha256: "d61fdb9f49009c32d008ddd01e34d3317dd2883d1fd723401cf6cb1c938320c5",
    text: () => raw(import("./assets/gobo-palm-1.rgba.gz.b64?raw")),
  },
  canopy: {
    sha256: "4e4f5563646845fddaad3d62f595bdf8fccc4eb4d13abccbeb430bf4daaae482",
    text: () => raw(import("./assets/gobo-canopy-1.rgba.gz.b64?raw")),
  },
};

const loading = new Map<DeskPlant, Promise<Uint8Array<ArrayBuffer>>>();

/** One plant's plate, inflated: loaded once per page. A load that fails is forgotten, so the next ask tries again. */
export function loadPlate(plant: DeskPlant): Promise<Uint8Array<ArrayBuffer>> {
  const had = loading.get(plant);
  if (had !== undefined) return had;
  const load = PLANT_PLATES[plant]
    .text()
    .then((text) => gunzip(base64Bytes(text)))
    .then((bytes) => {
      if (bytes.length !== PLATE_BYTES) {
        throw new Error(`desk: the ${plant} plate is ${bytes.length} bytes, not ${PLATE_BYTES}`);
      }
      return bytes;
    });
  loading.set(plant, load);
  load.catch(() => {
    if (loading.get(plant) === load) loading.delete(plant);
  });
  return load;
}
