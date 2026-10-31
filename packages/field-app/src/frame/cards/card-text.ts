import type { Card } from "./cards-model";
import { OUTSIDE_WORDS, TARGET_WORDS } from "./cards-words";

// WHAT A CARD GIVES AN INPUT (HN-4, HN-L5; DESIGN.md §8 "The hand", where cards go): the text a
// card puts in, why one gives nothing, and the still a snapshot's path names. One authority for
// every place that takes a card as text — Godview's panes (`godview/pane-card-target.ts`) and, in
// SP-1d, Chat's composer, whose card chips carry the same text into a send (DESIGN.md §8 "Chat's
// composer") — so a card never gives a pane one thing and a message another. PURE.

/** Characters a shell reads as themselves; a path with any other is quoted. */
const SHELL_PLAIN = /^[\w./@%+=:,-]+$/u;

/** A path as a shell reads it: as it is, or single-quoted when it holds a space or anything a
 * shell would read otherwise (a quote inside closed, escaped and reopened, POSIX's way). PURE. */
export function shellPath(path: string): string {
  return SHELL_PLAIN.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}

/** What each kind gives, as it is: its words; a file its path; a picture its file's path, the road
 * a Finder drop takes (null with no file — or a file with no path, one a page made (HN-6):
 * nothing to give); an agent its handle. PURE. */
function givenBy(card: Card): string | null {
  switch (card.kind) {
    case "text":
    case "msg":
    case "term":
      return card.paste;
    case "file":
      return card.paste === "" ? null : shellPath(card.paste);
    case "pict":
      return card.path === undefined ? null : shellPath(card.path);
    case "agent":
      return card.handle;
  }
}

/** HN-L5 — what a card puts into a pane. Return is never pressed for you (DESIGN.md §8 "The hand",
 * where cards go), so a card's text loses its trailing CR or LF before the pane is given it, for
 * every kind — here, the one place: a program that has not asked for bracketed paste reads a
 * trailing break as Return. The breaks inside are the card's own. PURE. */
export function paneTextOf(card: Card): string | null {
  const given = givenBy(card);
  if (given === null) return null;
  let end = given.length;
  while (end > 0 && (given[end - 1] === "\n" || given[end - 1] === "\r")) end -= 1;
  return given.slice(0, end);
}

/** Why a card gives nothing, in the hand's words: a file with no path, else a picture with no
 * file (HN-L5). PURE. */
export function nothingToGive(card: Card): string {
  return card.kind === "file" ? OUTSIDE_WORDS.fileNoPath : TARGET_WORDS.pictureNoFile;
}

/** The still a snapshot's picture names by its path, or null for every other card. A snapshot's
 * path names its still only while main keeps it — the ring every window shares moves on under the
 * others' captures — so a place asks main first and is never handed a path to nothing. A picture
 * brought in from another app names the person's own file, never a still (HN-6). PURE. */
export function stillOf(card: Card): string | null {
  return card.kind === "pict" && card.origin.how === "snapshot" && card.path !== undefined
    ? card.path
    : null;
}
