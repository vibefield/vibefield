// THE HAND'S FILES (DK-3's three OFL faces, `assets/fonts` — OFL.txt beside them): which shipped file each of the desk's
// faces is, by ICE's names for them (`PEN_FACES`: Caveat medium and semibold, Kalam). One table for both readers of the
// files: the renderer imports them by URL (`desk-assets.ts` — its `?url` imports are held to this table by
// `test/desk-assets.test.ts`), and a Node caller registers them from disk — the playground's still raster (DK-17b, ICE
// I35), so a kind's still draws the same hand the product lends — and bakes them (IK: the hand's generator, below). Pure: a
// name for each file, and where they lie beside this module — no import, so any host may read it.

/** Each face's file, by the desk's names for the faces. */
export const DESK_FACE_FILES: Readonly<Record<string, string>> = {
  caveat: "Caveat-500.ttf",
  "caveat-bold": "Caveat-600.ttf",
  kalam: "Kalam-400.ttf",
};

/** The folder the files lie in, relative to this module. */
export const DESK_FACES_FOLDER = "./assets/fonts/";

// THE HAND'S BAKED FACES (IK, 2026-11-25 — the desk's pen, ICE I59): each face's `ice-hand/1` atlas, baked from its file by ICE's
// baker (`scripts/gen-desk-hands.mjs`, `pnpm gen:hands`; held to the bake by `pnpm gen:check`): `<stem>.hand.json` (the canonical
// text) and `<stem>.hand.bin` (its RG8 texels), the stem the font file's own name, lower-cased, as ICE names its own desk's.

/** The folder the baked hands lie in, relative to this module (OFL.txt beside them). */
export const DESK_HANDS_FOLDER = "./assets/hand/";

/** The two files a face's file bakes into: `Caveat-500.ttf` → `caveat-500.hand.json` and `caveat-500.hand.bin`. */
export function deskHandFiles(file: string): { readonly json: string; readonly bin: string } {
  const stem = file.replace(/\.ttf$/iu, "").toLowerCase();
  return { json: `${stem}.hand.json`, bin: `${stem}.hand.bin` };
}
