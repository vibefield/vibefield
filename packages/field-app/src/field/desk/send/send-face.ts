import { NOTE_TYPE } from "@vibecook/ice/desk/objects";
import type { ChipObject, DeskChip } from "../../../frame/draft";
import type { ObjectWords } from "../desk-object-words";

// SEND TO…'S CHIP — ITS FACE AND WHAT IT CARRIES (DK-14; DESIGN.md §8 "Send to…", "The missing face"; R15 as amended
// 13:40Z, DK-D26). Pure: from the selected objects as the host reads them — each one's type, its words (the mount's
// human name and, for a missing face, why) and its durable props — and the palette the desk is dressed in.
//   THE FACE: a NOTE wears its paper (its `paper` prop through the palette's CSS colour) and its ink (its `pen`'s),
//   `snippets` and its first 24 characters; ANY OTHER KIND its name and no glyph ("Clock") — neither ICE's `TrayEntry`
//   nor DK-0f's contribution carries one; SEVERAL, `package` and "N objects"; a MISSING FACE its type's name (the
//   manifest's, else the type id — never its word: the chip names what it carries, the bar says why it is missing).
//   WHAT IT CARRIES: the objects' names and their durable text (the `text` a note or a pad keeps); the still is the
//   act's (send-to.ts), attached when the capture resolves.

/** How much of a note's writing its chip shows (§8: "its first 24 characters"). */
export const CHIP_CHARS = 24;

/** One selected object as the host read it. */
export interface SentObject {
  readonly type: string;
  readonly words: ObjectWords;
  /** Its durable props (the cells of its groups, merged). */
  readonly props: Readonly<Record<string, unknown>>;
}

/** The palette's colours a note's chip reads (ICE's `PaperPalette`: its papers and pens by name, each a token's CSS). */
export interface ChipPalette {
  readonly papers?: Readonly<Record<string, { readonly css: string }>>;
  readonly pens?: Readonly<Record<string, { readonly css: string }>>;
}

/** The chip's face (its glyph, its words, a note's paper and ink). */
export type ChipFace = Pick<DeskChip, "label" | "glyph" | "paper" | "ink">;

/** A writing's first `n` characters — its runs of white space one space, cut with "…" when there is more; null when
 * there is nothing written. Counted by code point, so a character is never split. */
export function firstChars(text: string, n: number = CHIP_CHARS): string | null {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat === "") return null;
  const chars = Array.from(flat);
  return chars.length <= n ? flat : `${chars.slice(0, n).join("").trimEnd()}…`;
}

/** An object's durable text: the `text` it keeps (a note's writing, a pad's lines), or null. */
export function durableText(props: Readonly<Record<string, unknown>>): string | null {
  const text = props["text"];
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

/** The objects' names and durable text, in selection order — what the chip carries in words (DK-D26). */
export function chipObjects(objects: readonly SentObject[]): ChipObject[] {
  return objects.map((o) => ({ type: o.type, name: o.words.title, text: durableText(o.props) }));
}

const colourOf = (
  table: Readonly<Record<string, { readonly css: string }>> | undefined,
  name: unknown,
): string | undefined => (typeof name === "string" ? table?.[name]?.css : undefined);

/** The chip's face for these objects (§8 "Send to…" — R15). */
export function chipFace(objects: readonly SentObject[], palette: ChipPalette): ChipFace {
  if (objects.length > 1) return { glyph: "package", label: `${objects.length} objects` };
  const one = objects[0];
  if (one === undefined) return { glyph: null, label: "Nothing" };
  if (one.type === NOTE_TYPE && one.words.state === null) {
    const paper = colourOf(palette.papers, one.props["paper"]);
    const ink = colourOf(palette.pens, one.props["pen"]);
    return {
      glyph: "snippets",
      // an empty note says what it is: its type's name
      label: firstChars(durableText(one.props) ?? "") ?? one.words.title,
      ...(paper === undefined ? {} : { paper }),
      ...(ink === undefined ? {} : { ink }),
    };
  }
  // any other kind — or a missing face, drawn or not — wears its type's human name, no glyph
  return { glyph: null, label: one.words.title };
}
