// THE STILL'S TEXT RASTER (DK-17b; ICE petition I35 — `createStill({ services })`). ICE bakes no text raster of its own in
// Node (its `inkRaster` is a browser's Canvas 2D), so `--still` lends ONE of its own under `TEXT_RASTER`: the SAME three faces
// the product's desk lends (field-app's `DESK_FACE_FILES` — Caveat 500 and 600 and Kalam, the shipped OFL files — under ICE's
// `penFaces` families and weights), drawn by a Node canvas (`@napi-rs/canvas` — Skia, prebuilt, no install script; a
// devDependency of this CLI and of nothing else, loaded only when `--still` asks) by ICE's own recipe (`inkRaster`,
// desk/host/ink.ts): the metrics measured at 100 px and given in em; each glyph in its own frame — turned by its tilt, scaled
// by its size, at its pressure — over a faint stroke the pen's bleed wide; the canvas's alpha read back as r8 coverage. The
// faces are registered from disk before the first still, so a face never "loads": `metrics` answers from the first ask, and
// `version` never moves (a still is drawn in one go). A face with no file here (ICE's platform faces — Marker Felt,
// Noteworthy) is never drawable, on every host alike. Skia draws the same bytes for the same layout: a still stays steady.

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FaceSpec, HandLayout, HandMetrics, InkBitmap, TextRaster } from "@vibecook/ice/desk";
import { penFaces } from "@vibecook/ice/desk";
import { DESK_FACE_FILES, DESK_FACES_FOLDER } from "@vibefield/field-app/desk-faces";

/** The shipped face files on disk, by the desk's names — field-app's table, its folder beside the table's own module. */
export function deskFacePaths(): Readonly<Record<string, string>> {
  const table = createRequire(import.meta.url).resolve("@vibefield/field-app/desk-faces");
  const folder = new URL(DESK_FACES_FOLDER, pathToFileURL(table));
  return Object.fromEntries(
    Object.entries(DESK_FACE_FILES).map(([name, file]) => [
      name,
      fileURLToPath(new URL(file, folder)),
    ]),
  );
}

const fontOf = (f: Omit<FaceSpec, "url">, px: number): string =>
  `${f.weight} ${px}px "${f.family}"`;

/**
 * A text raster over a Node canvas, its faces registered from `files` (the desk's names → paths; the product's own faces when
 * absent). Rejects when the canvas cannot load on this host or a face file will not register — the caller's harness error.
 */
export async function stillTextRaster(
  files: Readonly<Record<string, string>> = deskFacePaths(),
): Promise<TextRaster> {
  const { createCanvas, GlobalFonts } = await import("@napi-rs/canvas");
  const faces = penFaces(files);
  const drawable = new Set<string>();
  for (const [name, f] of Object.entries(faces)) {
    if (f.url === undefined) continue;
    // registered under the face's family; Skia picks the weight a font string names (Caveat 500 and 600 are one family)
    if (GlobalFonts.registerFromPath(f.url, f.family) === null)
      throw new Error(`the face "${name}" did not register from ${f.url}`);
    drawable.add(name);
  }
  const metricsCache = new Map<string, HandMetrics>();
  const measure = (face: string): HandMetrics | undefined => {
    const hit = metricsCache.get(face);
    if (hit !== undefined) return hit;
    const f = faces[face];
    if (f === undefined || !drawable.has(face)) return undefined;
    const c = createCanvas(8, 8).getContext("2d");
    c.font = fontOf(f, 100);
    c.textBaseline = "alphabetic";
    const m0 = c.measureText("x");
    const advances = new Map<string, number>();
    const kerns = new Map<string, number>();
    const advance = (ch: string): number => {
      let a = advances.get(ch);
      if (a === undefined) {
        c.font = fontOf(f, 100);
        a = c.measureText(ch).width / 100;
        advances.set(ch, a);
      }
      return a;
    };
    const metrics: HandMetrics = {
      ascent: m0.fontBoundingBoxAscent / 100,
      descent: m0.fontBoundingBoxDescent / 100,
      advance,
      kern: (a, b) => {
        const key = a + b;
        let k = kerns.get(key);
        if (k === undefined) {
          c.font = fontOf(f, 100);
          k = c.measureText(key).width / 100 - advance(a) - advance(b);
          kerns.set(key, k);
        }
        return k;
      },
    };
    metricsCache.set(face, metrics);
    return metrics;
  };
  return {
    metrics: measure,
    version: () => 1,
    raster(
      L: HandLayout,
      face: string,
      box: { readonly w: number; readonly h: number },
      band: number,
      bleed: number,
    ): InkBitmap {
      const f = faces[face];
      if (f === undefined) throw new Error(`still text raster: no face "${face}"`);
      const w = Math.max(1, Math.ceil(box.w * band));
      const h = Math.max(1, Math.ceil(box.h * band));
      // a fresh canvas each raster: no state carried from the last (the browser's resize reset, made explicit)
      const g = createCanvas(w, h).getContext("2d");
      g.scale(band, band);
      g.font = fontOf(f, L.em);
      g.textBaseline = "alphabetic";
      g.textAlign = "left";
      g.fillStyle = "white"; // coverage only: the alpha is what is read
      g.strokeStyle = "white";
      g.lineJoin = "round";
      g.lineCap = "round";
      for (const q of L.glyphs) {
        g.save();
        g.translate(q.x, q.y);
        g.rotate(q.rot);
        g.scale(q.scale, q.scale);
        if (bleed > 0) {
          g.globalAlpha = q.press * 0.45;
          g.lineWidth = bleed / q.scale;
          g.strokeText(q.ch, 0, 0);
        }
        g.globalAlpha = q.press;
        g.fillText(q.ch, 0, 0);
        g.restore();
      }
      const img = g.getImageData(0, 0, w, h).data;
      const bytes = new Uint8Array(w * h);
      for (let i = 0; i < bytes.length; i++) bytes[i] = img[i * 4 + 3] as number;
      return { bytes, w, h };
    },
  };
}
