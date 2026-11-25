import minimat from "./minimat.svg?raw";
import note from "./note.svg?raw";
import print from "./print.svg?raw";
import whiteboard from "./whiteboard.svg?raw";

/** A built-in kind's sticker, as a plugin's arrives from `plugins.stickers`. */
export interface BuiltInSticker {
  readonly svg: string;
  readonly radius: number;
}

/**
 * OB-D16 (2026-11-25) — THE BUILT-IN KINDS' STICKERS. A plugin's art ships in its own bundle; a built-in kind has no
 * bundle (contracts' `DESK_KINDS` declares it, ICE draws it), so its art lives here, with its window half. Every
 * built-in with an agent half has one (`test/pane-stickers.test.ts` holds it), and each is held to the same
 * `stickerArtProblems` a plugin's art is.
 */
export const BUILT_IN_STICKERS: Readonly<Record<string, BuiltInSticker>> = {
  "desk.note": { svg: note, radius: 2.4 },
  "desk.photo": { svg: print, radius: 1.6 },
  "desk.board": { svg: whiteboard, radius: 2.2 },
  "desk.minimat": { svg: minimat, radius: 2.4 },
};
