import { NOTE_TYPE } from "@vibecook/ice/desk/objects";
import type { ObjectWords } from "../desk-object-words";

// THE DESK'S COPY — WHAT A SELECTION IS CALLED, AND THE WORDS IT KEEPS (HN-D3; DESIGN.md §8 "The desk's Copy", "The
// missing face"; R15 as amended 13:40Z, DK-D26, PT-4 ruling 5). Pure: from the selected objects as the host reads them —
// each one's type, its words (the mount's human name and, for a missing face, why) and its durable props.
//   ITS NAME — the title its picture card carries into the hand: ANY KIND its name ("Clock"); SEVERAL "N objects"; a
//   MISSING FACE its type's name (the manifest's, else the type id — never its word: the card names what it is, the bar
//   says why it is missing); AN OBJECT SHOWING A LIVE PAGE (a browser pane) what its page is CALLED — the page's title,
//   else its address as its kind prints it (the mount's LIVE service says it, by the object's durable key) — its first
//   24 characters, as the chip cut a note's writing.
//   ITS WORDS — the durable text the objects keep (a note's writing, a pad's lines): a lone note's are its TEXT card,
//   and any copy's are what the system clipboard is given — beside its picture, in the picture's one write (LC-19).

/** How much of a live page's name a copy carries (DK-14's chip cut: "its first 24 characters"). */
export const NAME_CHARS = 24;

/** One selected object as the host read it. */
export interface CopiedObject {
  readonly type: string;
  readonly words: ObjectWords;
  /** Its durable props (the cells of its groups, merged). */
  readonly props: Readonly<Record<string, unknown>>;
  /** PT-4: what the live page it shows is called — its title, else its address as printed; absent: it shows none. */
  readonly live?: string;
}

/** A writing's first `n` characters — its runs of white space one space, cut with "…" when there is more; null when
 * there is nothing written. Counted by code point, so a character is never split. */
export function firstChars(text: string, n: number = NAME_CHARS): string | null {
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

/** A lone NOTE's writing — its copy is a text card of these words (HN-D3: "one note → a text card"). Null for
 * anything else, and for a note with nothing written, which is copied as its picture. */
export function noteWords(objects: readonly CopiedObject[]): string | null {
  const [one, ...rest] = objects;
  if (one === undefined || rest.length > 0 || one.type !== NOTE_TYPE) return null;
  return durableText(one.props);
}

/** The words a copy gives the system clipboard: the durable text the objects keep, in selection order, a blank line
 * between two; null when none keeps any (a clock, a print — its picture alone). A picture card carries them beside
 * its picture, in the same one write (HN-5, LC-19). */
export function copiedWords(objects: readonly CopiedObject[]): string | null {
  const texts = objects.flatMap((o) => {
    const text = durableText(o.props);
    return text === null ? [] : [text];
  });
  return texts.length === 0 ? null : texts.join("\n\n");
}

/** What a copy is called — its picture card's title (§8, R15's names, above). */
export function copyName(objects: readonly CopiedObject[]): string {
  if (objects.length > 1) return `${objects.length} objects`;
  const one = objects[0];
  if (one === undefined) return "Nothing";
  // an object showing a live page is called by its page (its title, else its address as printed)
  if (one.live !== undefined && one.words.state === null)
    return firstChars(one.live) ?? one.words.title;
  // any other kind — a missing face, drawn or not, an empty note — its type's human name
  return one.words.title;
}
