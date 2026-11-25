// The COMMENT PAD's LOOK. Two halves, by whose colours they are:
//
// - its INK is the HOST's: the hand writes with the host's pens (the kit's `PENS` are names; STICKY.md §3 —
//   "the inks are the host's", the note's and the desk calendar's lines), so the pad reads the palette's
//   `pens` role by its `pen` prop, exactly as ICE's note does, and draws nothing in a pen the host never
//   named (`record` says so — the theme gate). The kind-conformance harness drives it WITH the product's
//   palette for that reason (DK-7's note, ruled at DK-8).
// - its PAPER is its own, like the clock's dials: the desk's one writing paper (ICE's notebook ivory, by
//   name), the block's edge a shade down, and the binding strip and the rules in one of the product's
//   ORGANIZATIONAL ACCENTS (DESIGN.md §2.6 — "containers, comments, tags": a curated set, assigned per
//   object, used as tint — the binding at full, the rules a hairline's tint). A host may dress the pad by
//   naming `commentPads` in its palette (`CommentPadPalette`).
//
// - its MARKS (IK, 2026-11-25 — DESIGN.md §8 "The words bar"): the pens a letter is re-inked in and a line is pulled in are
//   the host's `pens` again; the highlighters are the DESK's own five, the ones the desk calendar marks its days with — the
//   palette's `calendars.highlighters`, laid under the ink by multiply at its `calendars.alpha.highlight` (62 %) — and a desk
//   shows no highlighter the host never named; the selection's WASH is the pencil (ICE's `MARKS.inks.pencil`, the brackets'
//   own ink, `--vf-tutor`'s value) at 28 %, the pad's own token until a host's palette names the pencil.
//
// The same colours by day and by night: the LIGHT changes (the Moon, the night's chain — the kit's).

import {
  HIGHLIGHTERS,
  type Palette,
  PENS,
  type RGB,
  rgb,
  type TokenRef,
} from "@vibefield/plugin-sdk/desk";
import { PAD_ACCENTS, type PadAccent } from "./ids";

/** The pad's own colours as tokens (a CSS colour each; `token` names its source). */
export interface PadTokens {
  readonly paper: TokenRef;
  readonly sheet: TokenRef;
  readonly accents: Readonly<Record<PadAccent, TokenRef>>;
  /** The rules' presence on the paper (a hairline's tint), and the margin rule's. */
  readonly ruleAlpha: number;
  readonly marginAlpha: number;
  /** The selection's wash under the words (DESIGN.md §8): its pencil and its presence. */
  readonly wash: TokenRef;
  readonly washAlpha: number;
}

/**
 * A host's palette as the pad reads it: the host's `pens` (required to write), the desk's highlighters (the calendars' — one set
 * for the whole desk; none named, no highlight is drawn), and optionally its own dress for the pad.
 */
export interface CommentPadPalette extends Palette {
  readonly pens?: Readonly<Record<string, TokenRef>>;
  readonly calendars?: {
    readonly highlighters?: Readonly<Record<string, TokenRef>>;
    readonly alpha?: { readonly highlight?: number };
  };
  readonly commentPads?: PadTokens;
}

const t = (token: string, css: string): TokenRef => ({ token: `comment-pad: ${token}`, css });
const accent = (hex: string): TokenRef => t(`DESIGN.md §2.6 organizational accent ${hex}`, hex);

/** The plugin's own dress. */
export const COMMENT_PAD_PALETTE: PadTokens = {
  paper: t("writing paper — the desk's notebook ivory (ICE NOTEBOOK_LOOK.paper)", "#f3ebdc"),
  sheet: t("the block's edge — the ivory a shade down", "#ddd2bf"),
  accents: {
    indigo: accent("#6366F1"),
    pink: accent("#EC4899"),
    green: accent("#22C55E"),
    amber: accent("#F59E0B"),
    cyan: accent("#06B6D4"),
    violet: accent("#8B5CF6"),
    red: accent("#EF4444"),
    blue: accent("#3B82F6"),
  },
  ruleAlpha: 0.26,
  marginAlpha: 0.5,
  wash: t("DESIGN.md §8 the words' wash — ICE MARKS.inks.pencil (--vf-tutor)", "#79b5f8"),
  washAlpha: 0.28,
};

/** A highlighter's presence when the host names none of its own (DESIGN.md §8: multiply at 62 %). */
const HIGHLIGHT_ALPHA = 0.62;

/** The look the record reads: the pad's colours parsed, and the host's pens and highlighters parsed (none named: empty). */
export interface PadLook {
  readonly paper: RGB;
  readonly sheet: RGB;
  readonly accents: Readonly<Record<PadAccent, RGB>>;
  readonly ruleAlpha: number;
  readonly marginAlpha: number;
  readonly pens: Readonly<Record<string, RGB>>;
  /** The desk's highlighters by name (the kit's `HIGHLIGHTERS`) — only those the host named — and the presence they are laid at. */
  readonly highlighters: Readonly<Partial<Record<string, RGB>>>;
  readonly highlight: number;
  readonly wash: RGB;
  readonly washAlpha: number;
  /** A swatch ROLE's colour as CSS (`pen.<name>`, `highlight.<name>` — the words' menu's names), for a copy's `text/html`. */
  readonly swatches: Readonly<Record<string, string>>;
}

export function padLook(palette: CommentPadPalette): PadLook {
  const own = palette.commentPads ?? COMMENT_PAD_PALETTE;
  const accents = {} as Record<PadAccent, RGB>;
  for (const name of PAD_ACCENTS)
    accents[name] = rgb((own.accents[name] ?? COMMENT_PAD_PALETTE.accents[name]).css);
  const pens: Record<string, RGB> = {};
  const swatches: Record<string, string> = {};
  for (const [name, token] of Object.entries(palette.pens ?? {})) {
    pens[name] = rgb(token.css);
    if ((PENS as readonly string[]).includes(name)) swatches[`pen.${name}`] = token.css;
  }
  const highlighters: Record<string, RGB> = {};
  const named = palette.calendars?.highlighters ?? {};
  for (const name of HIGHLIGHTERS) {
    const token = named[name];
    if (token === undefined) continue;
    highlighters[name] = rgb(token.css);
    swatches[`highlight.${name}`] = token.css;
  }
  const wash = own.wash ?? COMMENT_PAD_PALETTE.wash;
  return {
    paper: rgb(own.paper.css),
    sheet: rgb(own.sheet.css),
    accents,
    ruleAlpha: own.ruleAlpha,
    marginAlpha: own.marginAlpha,
    pens,
    highlighters,
    highlight: palette.calendars?.alpha?.highlight ?? HIGHLIGHT_ALPHA,
    wash: rgb(wash.css),
    washAlpha: own.washAlpha ?? COMMENT_PAD_PALETTE.washAlpha,
    swatches,
  };
}
