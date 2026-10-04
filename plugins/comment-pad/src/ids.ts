// The comment pad's IDS — durable: its type lives in boards. Pure (no import), so the manifest's emit
// (plain Node, before any bundle exists) and the kind read the same strings.

/** The pad's durable type id — its plugin's id itself (an object may take the bare id: `isOwnedName`). */
export const COMMENT_PAD_TYPE = "vibefield.comment-pad";

/**
 * The pad's KIND name — its key in the desk's registry, in every slot's objects and in `handle.local(…)`.
 * The host's rule (DK-6 input (b)): a kind's registry name IS its type, one id and no second namespace.
 */
export const COMMENT_PAD_KIND = COMMENT_PAD_TYPE;

/** The pad's TEXT PART (ICE K8a): what the desk's one editor's lease names while a pad is written. */
export const COMMENT_PAD_PART = "comment-pad.sheet";

/** The pad's own category on the pegboard — its own row of hooks, beside the desk's paper and things. */
export const COMMENT_PAD_CATEGORY = "comments";

/** The pad's size as laid, world units — portrait, an index card's proportion at the desk's note scale. */
export const PAD_SIZE = { w: 220, h: 280 } as const;

/** DESIGN.md §2.6's organizational accents ("containers, comments, tags"), by name, in its order — a pad wears one. */
export const PAD_ACCENTS = [
  "indigo",
  "pink",
  "green",
  "amber",
  "cyan",
  "violet",
  "red",
  "blue",
] as const;
export type PadAccent = (typeof PAD_ACCENTS)[number];

/** The pens the hand writes with — the kit's `PENS`, by name (the inks are the host's; test/manifest.test.ts holds them equal). */
export const PAD_PENS = ["felt", "ball", "fountain", "red"] as const;
