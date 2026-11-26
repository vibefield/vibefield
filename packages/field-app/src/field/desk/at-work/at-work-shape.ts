import type { SparkId } from "@vibefield/contracts";
import type { SparkStatus } from "@vibefield/design-kit/spark-face";
import type { PeersHidden } from "../peers/peers-model";
import { atWorkCovers, atWorkFramesMeet } from "./at-work-hand";
import { AT_WORK_INK_TOKENS, type AtWorkInks, type InkTone } from "./at-work-ink";
import {
  AT_WORK,
  type AtWorkMarks,
  atWorkBand,
  atWorkChipAt,
  type ScreenFrame,
} from "./at-work-model";

// THE AT-WORK MARK'S ELEMENTS (item 550, 2026-11-18; DESIGN.md §8 "At work on the mat"). What React renders for the
// marks, and where each element stands, from the model's marks: the DOM form's frame per object (a CSS stroke in the
// ink, nested as the GL strokes are, still) and its stickers (a chip with `AgentIcon`), and in both forms each spark's
// star (a still in its spark's status as Chat reads it, hidden while the layer's live stage draws it, DESIGN.md §2.10
// "the desk is a stage") and each chip on the line's glass. React renders the SHAPE — it moves only when an element
// comes or goes — and the layer writes the PLACEMENTS imperatively each frame (`at-work-layer.ts`), as the peers'
// controller writes theirs; the catalog hands the same placements to the shipping view (`AtWorkPreview.tsx`). PURE: no
// DOM, no GL.

const NO_TONE: InkTone = { linear: [0, 0, 0], encoded: [0, 0, 0] };

/** The inks the DOM form draws with when the root spells none the GL form can read: their CSS alone (a token's
 * `var()`), so the DOM form is never a blank. */
export const AT_WORK_DOM_INKS: AtWorkInks = {
  neutral: {
    id: "neutral",
    base: NO_TONE,
    leanA: NO_TONE,
    leanB: NO_TONE,
    deep: NO_TONE,
    css: `var(${AT_WORK_INK_TOKENS.neutral})`,
  },
  starlight: {
    id: "starlight",
    base: NO_TONE,
    leanA: NO_TONE,
    leanB: NO_TONE,
    deep: NO_TONE,
    css: `var(${AT_WORK_INK_TOKENS.pearl})`,
  },
};

/** Which form draws: the GL marks, or the DOM's still CSS stroke and chips. */
export type AtWorkForm = "gl" | "dom";

/** One object as React renders its elements (positions are written by the layer, never rendered). */
export interface AtWorkShapeObject {
  readonly key: string;
  readonly lod: AtWorkMarks["lod"];
  /** the DOM form's strokes: settled widths and gaps, ink px, and their CSS ink */
  readonly strokes: readonly {
    readonly run: string;
    readonly form: "marker" | "starlight" | "line";
    readonly ink: string;
    readonly hw: number;
    readonly gap: number;
  }[];
  readonly seats: readonly {
    readonly run: string;
    readonly form: "sticker" | "count" | "star";
    readonly agent: string;
    readonly count: number;
    readonly ink: string;
    readonly spark: SparkId | null;
    readonly crewSpark: SparkId | null;
    /** a spark's own star's face: its spark's status as Chat's list holds it (DESIGN.md §2.10), never one mapped from
     * its row; null while the list holds no entry for it (its still, with no word), and for every other seat */
    readonly face: SparkStatus | null;
  }[];
  readonly chips: readonly { readonly run: string; readonly word: "needs-you" | "failed" }[];
}

export interface AtWorkShape {
  readonly form: AtWorkForm;
  readonly hidden: PeersHidden;
  readonly objects: readonly AtWorkShapeObject[];
}

/** The element ids the view gives what the layer places (`bind`). */
export const atWorkIds = {
  object: (key: string) => `object:${key}`,
  seat: (key: string, run: string, form: string) => `seat:${key}:${run}:${form}`,
  chip: (key: string, run: string) => `chip:${key}:${run}`,
} as const;

/** One object as a frame draws it: its key, its frame on screen, its marks, and whether it lies under the object in
 * hand (something else is in hand: its marks are covered where the hand's silhouette lies, 2026-11-24). */
export interface AtWorkDrawnObject {
  readonly key: string;
  readonly frame: ScreenFrame;
  readonly marks: AtWorkMarks;
  readonly under?: boolean;
}

/** What React renders for these objects in this form. PURE. */
export function atWorkShapeOf(
  drawn: readonly AtWorkDrawnObject[],
  form: AtWorkForm,
  hidden: PeersHidden,
): AtWorkShape {
  const objects = drawn.map(({ key, marks }): AtWorkShapeObject => {
    // the DOM form is still: each stroke at the settled band of the strokes it shows, nested about its gap
    const band = atWorkBand(marks.strokes.length);
    const middle = (marks.strokes.length - 1) / 2;
    return {
      key,
      lod: marks.lod,
      strokes: marks.strokes.map((s, k) => ({
        run: s.run,
        form: s.form,
        ink: s.ink.css,
        hw: s.form === "line" ? s.hw : band.hw,
        gap: s.form === "line" ? s.gap : band.gap + (k - middle) * band.hw * AT_WORK.stroke.nest,
      })),
      seats: marks.seats.map((s) => ({
        run: s.run,
        form: s.form,
        agent: s.agent,
        count: s.count,
        ink: s.ink.css,
        spark: s.spark,
        crewSpark: s.crewSpark,
        face: s.star?.status ?? null,
      })),
      chips: marks.chips.map((c) => ({ run: c.run, word: c.word })),
    };
  });
  return { form, hidden, objects };
}

/** Where one element stands: its transform, and its opacity and its box's numbers where it has them. */
export interface AtWorkPlacement {
  readonly id: string;
  readonly transform: string;
  readonly opacity: string | null;
  /** the DOM form's object box: its half extents, its corner and the marks' scale (CSS custom properties) */
  readonly vars: Readonly<Record<string, string>> | null;
}

/** No star is on a live stage. */
const NONE_STAGED: ReadonlySet<string> = new Set();

/** Every element's place this frame: the DOM form's object boxes and stickers, and in both forms each spark's star and
 * each chip (7 right of its seat's rim, or left at the window's edge), a star and a chip at the opacity the model gives
 * them, so they dim with the mark (DESIGN.md §6 "Something in hand", §8 "When not"). `widthOf` is a chip's measured
 * width; `staged` the ids of the stars the layer's live stage draws this frame, whose stills stand at no opacity, so a
 * star is never drawn twice. `hand` (2026-11-24): the silhouette of the object in hand; an object that lies under it
 * has each seat, star and chip whose centre it covers at no opacity, and in the DOM form, which cannot mask by the
 * pixel, its frame at none whole where its marks' reach meets it (else at one). PURE. */
export function atWorkPlacementsOf(
  drawn: readonly AtWorkDrawnObject[],
  form: AtWorkForm,
  widthOf: (id: string) => number,
  viewWidth: number,
  staged: ReadonlySet<string> = NONE_STAGED,
  hand: ScreenFrame | null = null,
): AtWorkPlacement[] {
  const out: AtWorkPlacement[] = [];
  const at = (x: number, y: number): string => `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
  for (const { key, frame, marks, under } of drawn) {
    const zs = marks.inkScale;
    const covered = (x: number, y: number): boolean => under === true && atWorkCovers(hand, x, y);
    if (form === "dom") {
      const hidden = under === true && atWorkFramesMeet(frame, marks.reach * zs, hand);
      out.push({
        id: atWorkIds.object(key),
        transform: `${at(frame.cx, frame.cy)} rotate(${frame.angle.toFixed(4)}rad)`,
        opacity: hidden ? "0" : "1",
        vars: {
          "--vf-atwork-hx": frame.hx.toFixed(2),
          "--vf-atwork-hy": frame.hy.toFixed(2),
          "--vf-atwork-r": frame.r.toFixed(2),
          "--vf-atwork-zs": zs.toFixed(4),
        },
      });
    }
    for (const seat of marks.seats) {
      // a spark's star is a still in both forms, standing aside while the live stage draws it; a sticker is the DOM
      // form's
      if (seat.form !== "star" && form !== "dom") continue;
      const star = seat.star;
      const id = atWorkIds.seat(key, seat.run, seat.form);
      const scale = star === null ? zs : star.size / AT_WORK.freeStar.size;
      let opacity = star === null ? Math.min(seat.opacity, 1) : star.alpha;
      if (staged.has(id) || covered(star?.x ?? seat.x, star?.y ?? seat.y)) opacity = 0;
      out.push({
        id,
        transform: `${at(star?.x ?? seat.x, star?.y ?? seat.y)} scale(${scale.toFixed(4)})`,
        opacity: opacity.toFixed(3),
        vars: null,
      });
    }
    for (const chip of marks.chips) {
      const id = atWorkIds.chip(key, chip.run);
      const place = atWorkChipAt(chip, widthOf(id), viewWidth);
      out.push({
        id,
        transform: at(place.x, place.y),
        opacity: (covered(chip.x, chip.y) ? 0 : chip.opacity).toFixed(3),
        vars: null,
      });
    }
  }
  return out;
}
