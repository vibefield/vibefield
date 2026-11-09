/**
 * What the card's bloom is told (lanes/ob-build/SEAM.md; OB-1b's `card-landing.ts` is its one authority). The bloom draws
 * this and authors no rule or reason of its own. These types stand here until that file lands, and then re-export it.
 */

export type ChipType = "text" | "image" | "file" | "link" | "session" | "ref";

export interface Bud {
  readonly face: string;
  readonly type: ChipType;
  /** the word on the bud: "Live", "Outline", "OPML", "Picture" */
  readonly label: string;
  /** what choosing does, apart so the words can set them apart: "Hand over" + "the live map" */
  readonly verb: string;
  readonly noun: string;
  readonly lands: boolean;
  /** only when it cannot land: the table's words */
  readonly reason?: string;
}

export interface BloomModel {
  /** "claude·2 · Godview", the one line under the words */
  readonly where: string;
  /** the first face that fits; null when none does, and then no bloom opens */
  readonly hub: string | null;
  /** every face, in the card's order, so a face that can't land keeps its place */
  readonly buds: readonly Bud[];
  /** exactly one fits: it plays at once, no bloom */
  readonly onlyFit: string | null;
}
