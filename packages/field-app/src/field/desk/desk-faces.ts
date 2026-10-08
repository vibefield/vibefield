// THE HAND'S FILES (DK-3's three OFL faces, `assets/fonts` — OFL.txt beside them): which shipped file each of the desk's
// faces is, by ICE's names for them (`PEN_FACES`: Caveat medium and semibold, Kalam). One table for both readers of the
// files: the renderer imports them by URL (`desk-assets.ts` — its `?url` imports are held to this table by
// `test/desk-assets.test.ts`), and a Node caller registers them from disk — the playground's still raster (DK-17b, ICE
// I35), so a kind's still draws the same hand the product lends. Pure: a name for each file, and where they lie beside this
// module — no import, so any host may read it.

/** Each face's file, by the desk's names for the faces. */
export const DESK_FACE_FILES: Readonly<Record<string, string>> = {
  caveat: "Caveat-500.ttf",
  "caveat-bold": "Caveat-600.ttf",
  kalam: "Kalam-400.ttf",
};

/** The folder the files lie in, relative to this module. */
export const DESK_FACES_FOLDER = "./assets/fonts/";
