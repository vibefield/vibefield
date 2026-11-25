// THE PAD'S SHEET — its TEXT PART (ICE K8a, `defineObject({ host: { text } })`): the part of a pad the desk's ONE
// editor is lent to. Since IK (2026-11-25) it is the kit's WRITTEN PART (`inkPart`, ICE petition I60): the pad
// DECLARES its writing — where it lies (its GEOMETRY: its layout as last laid, the two maps between the world and the
// layout's units, where the editor's textarea stands), its ink cell and the marks its words take (typing.ts), and the
// sink its writing draws from — and the kit gives it the rest: a tap's lease with the caret where it fell, typing as a
// draft landed in one step, a drag, a word and a line, the clipboard in three flavours, the words' box the words bar
// stands over, and the words' acts.
//
// The editor is the DESK's and invisible (transparent text and caret): it takes what the platform does best — keys,
// key repeat, IME, dictation, the caret's index — and the pad draws the rest (its draft, its caret, the selection's
// wash) from its writing.

import {
  Camera,
  type EditorPlace,
  type Entity,
  type InkGeometry,
  type InkPart,
  inkPart,
  type KindDriver,
  type ObjectDomHost,
  PEN_FACES,
} from "@vibefield/plugin-sdk/desk";
import { COMMENT_PAD_PART } from "./ids";
import { PAD, PAD_FACE, PAD_HAND, writingBox } from "./law";
import type { PadGeometry } from "./layout";
import type { PadLook } from "./theme";
import { PAD_MARKS, padSink } from "./typing";
import type { PadWriting } from "./writing";

/** The pad's driver (`ObjectBinding.drivers`): what its text part asks of the desk's kind host. */
export interface PadDriver extends KindDriver {
  /** Is `e` a comment pad? */
  readonly isPad: (e: Entity) => boolean;
  /** The pad's writing on this desk (its local). */
  readonly writing: () => PadWriting | undefined;
}

/** The pad's sheet: the kit's written part — its text part (the desk routes taps to it), its doors (`focus`, `editing`) and its typing. */
export type PadSheet = InkPart;

/**
 * Where a pad's writing lies (the kit's `InkGeometry`): its layout as its writing last laid it, in the writing box's units (y
 * down from the box's top-left); a world point there through the pad as drawn (its centre, its held scale) — undefined off the
 * sheet; and the editor's textarea over the writing box on screen, from the camera.
 */
export function padGeometry(
  host: Pick<ObjectDomHost, "world" | "geometryOf">,
  writing: () => PadWriting | undefined,
): InkGeometry {
  const font = PEN_FACES[PAD_FACE] ?? { family: "Caveat", weight: 500 };
  const drawn = (e: Entity): PadGeometry | undefined =>
    host.geometryOf(e) as PadGeometry | undefined;
  return {
    layout: (e) => writing()?.layoutOf(e),
    toLayout(e, wx, wy) {
      const G = drawn(e);
      if (G === undefined) return undefined;
      const x = (wx - G.centre[0]) / G.scale + G.size.w / 2;
      const y = (wy - G.centre[1]) / G.scale + G.size.h / 2;
      if (x < 0 || y < 0 || x > G.size.w || y > G.size.h) return undefined; // off the sheet: not its writing's
      const box = writingBox(G.size.w, G.size.h, PAD);
      return [x - box.x, y - box.y];
    },
    toWorld(e, x, y) {
      const G = drawn(e);
      if (G === undefined) return undefined;
      const box = writingBox(G.size.w, G.size.h, PAD);
      return [
        G.centre[0] + (box.x + x - G.size.w / 2) * G.scale,
        G.centre[1] + (box.y + y - G.size.h / 2) * G.scale,
      ];
    },
    place(e): EditorPlace | null {
      const G = drawn(e);
      const cam = host.world.getResource(Camera);
      if (G === undefined || cam === undefined) return null;
      const z = cam.zoom;
      const s = G.scale;
      const box = writingBox(G.size.w, G.size.h, PAD);
      // the writing box on screen: pad units → world (about the sheet's centre, the lift's scale in) → container px
      const wx = G.centre[0] + (box.x - G.size.w / 2) * s;
      const wy = G.centre[1] + (box.y - G.size.h / 2) * s;
      return {
        x: (wx - cam.x) * z,
        y: (wy - cam.y) * z,
        w: box.w * s * z,
        h: box.h * s * z,
        fontPx: PAD_HAND.size * s * z,
        lineHeight: PAD_HAND.size * PAD_HAND.lineHeight * s * z,
        wrap: true,
        font,
      };
    },
  };
}

/** The pad's text part, or undefined where the desk gave it nothing to lease from (no driver: no sheet). */
export function createPadSheet(host: ObjectDomHost): PadSheet | undefined {
  const driver = host.driver as PadDriver | undefined;
  if (driver === undefined) return undefined;
  const writing = (): PadWriting | undefined => driver.writing();
  return inkPart(host, {
    part: COMMENT_PAD_PART,
    label: "write on the comment pad",
    marks: PAD_MARKS,
    accepts: (e) => host.world.isAlive(e) && driver.isPad(e),
    geometry: padGeometry(host, writing),
    sink: padSink(writing),
    // a copy's `text/html` in the host's inks, by the words' menu's swatch roles (none named: the tags alone)
    colour: (role) => (host.look() as PadLook | undefined)?.swatches[role],
  });
}
