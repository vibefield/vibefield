import { type FieldClipboardHost, type FieldDiagnosticsHost, peekHost } from "../../host";
import { getRendererLogger } from "../../logging";
import { type Card, type CardOrigin, textCardOf } from "./cards-model";
import { dealCard } from "./cards-sources";
import { type CardStore, cardsStore, type DealFrom } from "./cards-store";
import { COPY_DOOR_WORDS } from "./cards-words";

/**
 * THE COPY DOOR (HN-5; HN-L1, HN-D2, LC-9; DESIGN.md §8 "The hand", where cards come from,
 * and §8 "Copy"): every copy VibeField makes puts what it copied on the system clipboard AND
 * deals its card, in that order — the clipboard is written first, and the card is dealt only
 * once the write was taken, so the newest card is what the clipboard holds. A refusal deals
 * nothing and comes back in words, for the source to say where it says things (the desk's
 * line; a Settings button keeps its own failure). The words go through the host's copy door
 * (`copyText`: main's `clipboard.writeText`, 64 KiB, the smokes' `harnessCopies`), a picture
 * through the clipboard's picture door (`writeImage`: design-03 §5.1's write half, beside
 * item 102's read). With no host — the browser catalog — the web's own write stands, as
 * item 102 keeps the web's read there; nothing else in the product writes
 * `navigator.clipboard`. A program's write (a terminal's OSC 52) is not a copy: it takes
 * `writeClipboard` alone and deals no card (terminal/clipboard.ts).
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

/** What the system clipboard is given: a copy's words, or its picture's PNG — one, never both, for
 * a second write would replace the first. */
export type ClipboardContent =
  | { readonly text: string; readonly png?: undefined }
  | { readonly png: Uint8Array<ArrayBuffer>; readonly text?: undefined };

/** A copy: what the clipboard is given, the card the hand gets, and the box it leaves from. */
export type CopyRequest = ClipboardContent & {
  /** what the hand gets, dealt through `dealCard` */
  readonly card: Card;
  /** the box it leaves from (window px); null rises into its place */
  readonly from: DealFrom | null;
};

export type CopyOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const log = () => getRendererLogger().child({ component: "cards" });

/** The system clipboard written, and nothing dealt: what a copy writes first, and all a program's
 * write does. Never throws: a refusal comes back in words. */
export async function writeClipboard(
  what: ClipboardContent,
  deps: CopyDeps = {},
): Promise<CopyOutcome> {
  const host = deps.host === undefined ? peekHost() : deps.host;
  if (what.png !== undefined) {
    const pictureDoor = host?.clipboard;
    try {
      if (pictureDoor !== undefined) {
        await pictureDoor.writeImage(what.png);
      } else {
        const png = new Blob([what.png], { type: "image/png" });
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      }
      return { ok: true };
    } catch (error) {
      // main's refusal comes in its own words (the preload's); the page's own write gives none
      const said = pictureDoor !== undefined && error instanceof Error ? error.message : "";
      return { ok: false, reason: said === "" ? COPY_DOOR_WORDS.picture : said };
    }
  }
  const wordsDoor = host?.diagnostics;
  try {
    if (wordsDoor !== undefined) await wordsDoor.copyText(what.text);
    else await navigator.clipboard.writeText(what.text);
    return { ok: true };
  } catch {
    // the copy door's refusals are a bridge's, not a person's: one sentence for all of them
    return { ok: false, reason: COPY_DOOR_WORDS.words };
  }
}

/** A copy: what it holds on the system clipboard first, then its card dealt into the hand from
 * its box. A refusal deals nothing, and its words come back for the source to say. */
export async function copyToHand(request: CopyRequest, deps: CopyDeps = {}): Promise<CopyOutcome> {
  const written = await writeClipboard(request, deps);
  if (!written.ok) {
    log().warn("renderer.cards.copy_refused", "A copy did not reach the clipboard; no card", {
      kind: request.card.kind,
      reason: written.reason,
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

/** Where a pressed control's card leaves from: its box, window px — null with none to measure. */
export function dealFromElement(element: Element | null | undefined): DealFrom | null {
  if (element === null || element === undefined) return null;
  const box = element.getBoundingClientRect();
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}
