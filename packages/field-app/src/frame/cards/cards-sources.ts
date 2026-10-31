import type { FrameView, ScreenshotCaptureOk } from "@vibefield/contracts";
import type { Card, PictCard } from "./cards-model";
import { type CardStore, cardsStore, type DealFrom } from "./cards-store";

/**
 * Who deals a card (HN-D2, DESIGN.md §8 "The hand", Where cards come from):
 * every source goes through here, so a card's origin, its words and the box it
 * leaves from are made one way. A snapshot — the line's own button, ⌃⌘A or the
 * View menu — is a picture card that leaves its region; the desk's Copy and the
 * other sources build their card and deal it with `dealCard`.
 */

interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface WindowPlace {
  readonly screenX: number;
  readonly screenY: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
}

/** A capture's region mapped into this window, when it lies inside it: the box
 * the card leaves from. Only the shell's normalized screen DIP bounds belong
 * here — never the helper's platform-native `bounds` (SNAP; the contract's own
 * rule). A region elsewhere, or none, deals the card from where it will stand.
 * PURE. */
export function captureFrom(
  screenBounds: ScreenBox | undefined,
  win: WindowPlace,
): DealFrom | null {
  if (screenBounds === undefined || screenBounds.width <= 0 || screenBounds.height <= 0) {
    return null;
  }
  const left = screenBounds.x - win.screenX;
  const top = screenBounds.y - win.screenY;
  const inside =
    left + screenBounds.width > 0 &&
    top + screenBounds.height > 0 &&
    left < win.innerWidth &&
    top < win.innerHeight;
  return inside ? { left, top, width: screenBounds.width, height: screenBounds.height } : null;
}

/** What dealing a capture needs from the host: the still's own scheme. */
export interface CaptureHost {
  readonly screenshotStillUrl?: (path: string) => string;
}

/** A snapshot (the line's snapshot, ⌃⌘A, the View menu's Take Screenshot) as a
 * picture card, dealt from its region. The still is main's (its ring keeps
 * twelve, as the hand holds twelve); a pane takes its file's path (HN-L5). */
export function dealCapture(
  ok: ScreenshotCaptureOk,
  host: CaptureHost,
  view: FrameView,
  options: { readonly store?: CardStore; readonly win?: WindowPlace } = {},
): PictCard {
  const store = options.store ?? cardsStore;
  const card: PictCard = {
    id: store.nextId("pict"),
    kind: "pict",
    origin: { view, how: "snapshot" },
    at: store.now(),
    title: "Snapshot",
    width: ok.width,
    height: ok.height,
    src: host.screenshotStillUrl?.(ok.path) ?? "",
    path: ok.path,
    paste: ok.path,
  };
  const win = options.win ?? (typeof window === "undefined" ? undefined : window);
  store.deal(card, win === undefined ? null : captureFrom(ok.screenBounds, win));
  return card;
}

/** Deal any card, from its source's box (window px) or from where it will stand. */
export function dealCard(card: Card, from: DealFrom | null, store: CardStore = cardsStore): void {
  store.deal(card, from);
}
