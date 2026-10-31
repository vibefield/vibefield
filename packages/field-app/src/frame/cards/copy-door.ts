import { ClipboardCopyRefusal, SHELL_CLIPBOARD, utf8ByteLength } from "@vibefield/contracts";
import { type FieldClipboardHost, type FieldDiagnosticsHost, peekHost } from "../../host";
import { getRendererLogger } from "../../logging";
import { getActiveView } from "../view-state";
import { type Card, type CardOrigin, type TextCard, textCardOf } from "./cards-model";
import { dealCard } from "./cards-sources";
import { type CardStore, cardsStore, type DealFrom } from "./cards-store";
import { COPY_DOOR_WORDS } from "./cards-words";

/**
 * THE COPY DOOR (HN-5; HN-L1, HN-D2, LC-9; DESIGN.md §8 "The hand", where cards come from,
 * and §8 "Copy"): every copy VibeField makes puts what it copied on the system clipboard AND
 * deals its card, in that order — the clipboard is written first, and the card is dealt only
 * once the write was taken, so the newest card is what the clipboard holds. A refusal deals
 * nothing and comes back in Copy's voice, for the source to say where it says things (the
 * desk's line; a Settings button keeps its own failure), with what the door was told beside it
 * for the log. Both bounds are checked here first (`SHELL_CLIPBOARD`, main's, by reference), so
 * nothing past one is asked of a door; a door's refusal is said in its terms only when the door
 * typed it (`ClipboardCopyRefusal`), and anything else — Electron's "Error invoking remote
 * method…", a malformed answer, the preload's own assertion — in the door's one sentence, its
 * own message logged: a refusal never repeats a bridge's error. The words go through the host's
 * copy door (`copyText`: main's `clipboard.writeText`, the smokes' `harnessCopies`), a picture
 * through the clipboard's picture door (`writeImage`: design-03 §5.1's write half, beside item
 * 102's read), the copy's words beside it in that same one write (LC-19). With no host — the
 * browser catalog — the web's own write stands, as item 102 keeps the web's read there; nothing
 * else in the product writes `navigator.clipboard`. A program's write (a terminal's OSC 52) is
 * not a copy: it takes `writeClipboard` alone and deals no card (terminal/clipboard.ts).
 */

/** The clipboard's two doors a copy writes through; the window's host has both. */
export interface CopyHost {
  readonly diagnostics?: Pick<FieldDiagnosticsHost, "copyText">;
  readonly clipboard?: Pick<FieldClipboardHost, "writeImage">;
}

export interface CopyDeps {
  /** the clipboard's doors (undefined: the window's host; null: none — the web's own write) */
  readonly host?: CopyHost | null;
  /** the hand the card is dealt into (undefined: the window's own) */
  readonly store?: CardStore;
}

/** What the system clipboard is given: a copy's words, or its picture's PNG with the copy's
 * words beside it when it has any — the picture's in ONE write, both formats of one item, for a
 * second write would replace the first (LC-19). */
export type ClipboardContent =
  | { readonly text: string; readonly png?: undefined }
  | { readonly png: Uint8Array<ArrayBuffer>; readonly text?: string };

/** A copy: what the clipboard is given, the card the hand gets, and the box it leaves from. */
export type CopyRequest = ClipboardContent & {
  /** what the hand gets, dealt through `dealCard` */
  readonly card: Card;
  /** the box it leaves from (window px); null rises into its place */
  readonly from: DealFrom | null;
};

/** A copy the clipboard did not take: why, in Copy's voice, and what the door was told. */
export interface CopyRefused {
  readonly ok: false;
  /** the clause the source says after "Not copied —" (`COPY_DOOR_WORDS`) */
  readonly reason: string;
  /** for the log alone: a refusal's terms in bytes, or the error a door threw, never said */
  readonly error: string;
}

export type CopyOutcome = { readonly ok: true } | CopyRefused;

const log = () => getRendererLogger().child({ component: "cards" });

/** The copy door's own check, before either door: the picture's PNG and the words against the
 * clipboard's bounds. Null when both are within. */
function pastBound(content: ClipboardContent): ClipboardCopyRefusal | null {
  const { WRITE_IMAGE_MAX_BYTES: pictureMax, WRITE_TEXT_MAX_BYTES: wordsMax } = SHELL_CLIPBOARD;
  const png = content.png?.byteLength ?? 0;
  if (png > pictureMax) {
    return { reason: "too-large", what: "picture", bytes: png, max: pictureMax };
  }
  const words = content.text === undefined ? 0 : utf8ByteLength(content.text);
  if (words > wordsMax) {
    return { reason: "too-large", what: "words", bytes: words, max: wordsMax };
  }
  return null;
}

/** A refusal in its terms: the clause after "Not copied —", and the terms in bytes for the log. */
function refused(refusal: ClipboardCopyRefusal): CopyRefused {
  if (refusal.reason === "not-an-image") {
    return { ok: false, reason: COPY_DOOR_WORDS.unread, error: refusal.reason };
  }
  const { what, bytes, max } = refusal;
  return {
    ok: false,
    reason: COPY_DOOR_WORDS.tooLarge(what, bytes, max),
    error: `${refusal.reason}: ${what} ${bytes} bytes, past ${max}`,
  };
}

/** A door's refusal: one the door typed is said in its terms; anything else in the door's one
 * sentence (`door`), its own message kept for the log. */
function refusedBy(error: unknown, door: string): CopyRefused {
  const typed = ClipboardCopyRefusal.safeParse(error);
  if (typed.success) return refused(typed.data);
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, reason: door, error: message };
}

/** The system clipboard written, and nothing dealt: what a copy writes first, and all a program's
 * write does. Never throws: a refusal comes back in words, with what the door was told. */
export async function writeClipboard(
  what: ClipboardContent,
  deps: CopyDeps = {},
): Promise<CopyOutcome> {
  const past = pastBound(what);
  if (past !== null) return refused(past);
  const host = deps.host === undefined ? peekHost() : deps.host;
  if (what.png !== undefined) {
    const pictureDoor = host?.clipboard;
    try {
      if (pictureDoor !== undefined) {
        await pictureDoor.writeImage(what.png, what.text);
      } else {
        // the page's own write: one item of both formats, as main's is
        const png = new Blob([what.png], { type: "image/png" });
        const words = what.text === undefined ? {} : { "text/plain": what.text };
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png, ...words })]);
      }
      return { ok: true };
    } catch (error) {
      return refusedBy(error, COPY_DOOR_WORDS.picture);
    }
  }
  const wordsDoor = host?.diagnostics;
  try {
    if (wordsDoor !== undefined) await wordsDoor.copyText(what.text);
    else await navigator.clipboard.writeText(what.text);
    return { ok: true };
  } catch (error) {
    return refusedBy(error, COPY_DOOR_WORDS.words);
  }
}

/** A copy: what it holds on the system clipboard first, then its card dealt into the hand from
 * its box. A refusal deals nothing, its words come back for the source to say, and the log keeps
 * what the door was told. */
export async function copyToHand(request: CopyRequest, deps: CopyDeps = {}): Promise<CopyOutcome> {
  const written = await writeClipboard(request, deps);
  if (!written.ok) {
    log().warn("renderer.cards.copy_refused", "A copy did not reach the clipboard; no card", {
      kind: request.card.kind,
      reason: written.reason,
      error: written.error,
    });
    return written;
  }
  dealCard(request.card, request.from, deps.store ?? cardsStore);
  return written;
}

/** A copy of words: a text card of them (`textCardOf` — the first sentence its title), dealt once
 * they are on the system clipboard. */
export function copyWords(
  text: string,
  origin: CardOrigin,
  from: DealFrom | null,
  deps: CopyDeps = {},
): Promise<CopyOutcome> {
  const store = deps.store ?? cardsStore;
  const card = textCardOf(text, { id: store.nextId("text"), origin, at: store.now() });
  return copyToHand({ card, from, text }, { ...deps, store });
}

/** A copy of words that are no prose — a log record's JSON — under a name of their own: a text
 * card titled by it as a line, with a line of its own beside, never its words' first character
 * ("{"). What the clipboard holds, and a play pastes, is the words. */
export function copyNamedWords(
  text: string,
  name: { readonly title: string; readonly body: string },
  origin: CardOrigin,
  from: DealFrom | null,
  deps: CopyDeps = {},
): Promise<CopyOutcome> {
  const store = deps.store ?? cardsStore;
  const card: TextCard = {
    id: store.nextId("text"),
    kind: "text",
    origin,
    at: store.now(),
    title: name.title,
    body: name.body,
    bare: true,
    paste: text,
  };
  return copyToHand({ card, from, text }, { ...deps, store });
}

/** Where a copy made on a sheet over the view comes from (Settings, the Setup Assistant): the
 * view under the sheet, then the sheet's place — "Canvas · Settings · just now". */
export function sheetOrigin(place: string): CardOrigin {
  return { view: getActiveView(), place, how: "copy" };
}

/** Where a pressed control's card leaves from: its box, window px — null with none to measure. */
export function dealFromElement(element: Element | null | undefined): DealFrom | null {
  if (element === null || element === undefined) return null;
  const box = element.getBoundingClientRect();
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}
