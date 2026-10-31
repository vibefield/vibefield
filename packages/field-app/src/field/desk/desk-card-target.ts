import { Camera } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";
import {
  NOTE_TYPE,
  PHOTO_KIND,
  PHOTO_TYPE,
  type Prints,
  printRect,
} from "@vibecook/ice/desk/objects";
import { clientToScreen, screenToWorld } from "@vibecook/ice/kernel";
import {
  type CardPlayed,
  type CardTarget,
  cardTargets,
  TARGET_LAYER,
} from "../../frame/cards/card-targets";
import type { Card, PictCard } from "../../frame/cards/cards-model";
import { OUTCOME_WORDS, TARGET_WORDS } from "../../frame/cards/cards-words";
import { getActiveView, subscribeActiveView } from "../../frame/view-state";
import { type FieldHost, peekHost } from "../../host";
import { getRendererLogger } from "../../logging";
import { deskBlobs } from "./desk-blobs";
import { currentDesk, type MountedDesk, subscribeDesk } from "./desk-door";
import { trayOf } from "./pegboard/board-door";

// THE DESK TAKES A CARD (HN-4, HN-D7; DESIGN.md §8 "The hand", where cards go): text, a message
// or a terminal's lines land as a NOTE, a picture as a PRINT, centred where the card is let go.
// Both kinds are on the desk today; a file or an agent says the desk can't hold one yet. Each lands
// by ONE spawn through the engine's ops — one undo step — and becomes the selection, as Comment's
// pad does (bar-acts.ts). A print is made from bytes, never a URL: the card's own (the desk's
// Copy, a paste) or, for a snapshot, the still's own through the shell's still door, kept in the
// desk's byte store first, as the seed keeps its sample print (desk-seed.ts). The desk takes
// nothing while it is inert to the pointer — an object in hand, the pegboard out — or while its
// board is one this window may not write, and says why in the desk's own words.

/** A retained still's bytes, through the shell (`FieldHost.screenshotStillBytes`). */
type StillBytes = (path: string) => Promise<Uint8Array<ArrayBuffer> | null>;

export interface DeskCardTargetDeps {
  /** The shell's still door (undefined: the window's host). */
  readonly host?: Pick<FieldHost, "screenshotStillBytes">;
  /** Where a print's picture is kept (undefined: the page's one byte store). */
  readonly blobs?: { put(bytes: Uint8Array<ArrayBuffer>, type: string): Promise<string> };
}

const log = () => getRendererLogger().child({ component: "cards.desk" });

/** The desk's own element (the layer's canvas lies in it): its box is the place's, and a client
 * point maps to the world through it (SelectionBar's and the desk's Copy's reading). */
function containerOf(desk: MountedDesk): HTMLElement | null {
  const canvas = (desk.handle as Partial<DeskLayerHandle>).canvas;
  return canvas instanceof HTMLElement
    ? ((canvas.closest("[data-ice-canvas]") as HTMLElement | null) ?? canvas.parentElement)
    : null;
}

/** A client point on the desk's world, through the field's CSS recede (ICE I39). */
function worldPoint(
  desk: MountedDesk,
  at: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } | null {
  const container = containerOf(desk);
  const camera = desk.engine.world.getResource(Camera);
  if (container === null || camera === undefined) return null;
  const screen = clientToScreen(at.x, at.y, container.getBoundingClientRect(), container);
  return screenToWorld(screen.x, screen.y, camera);
}

/** Why the desk cannot take this card now, in the desk's words; null when it can. */
function refusalOf(desk: MountedDesk, card: Card, still: StillBytes | undefined): string | null {
  if (card.kind === "file" || card.kind === "agent") return TARGET_WORDS.deskRefuses(card);
  const tray = trayOf(desk)?.anchor();
  if (tray?.held === true) return TARGET_WORDS.deskHeld;
  if (tray?.open === true) return TARGET_WORDS.deskBoardOut;
  const session = desk.engine.docs.current();
  if (session === undefined || session.readOnly) return TARGET_WORDS.deskReadOnly;
  // a picture is printed from its pixels: its own bytes, or a snapshot's through the still door
  if (
    card.kind === "pict" &&
    card.bytes === undefined &&
    (card.path === undefined || still === undefined)
  ) {
    return TARGET_WORDS.deskNoPicture;
  }
  return null;
}

/** A note of the card's words, centred on the point, at the kind's own size. */
function noteOnto(
  desk: MountedDesk,
  text: string,
  at: { readonly x: number; readonly y: number },
): CardPlayed {
  const size = desk.engine.catalog.widget(NOTE_TYPE)?.defaultSize;
  if (size === undefined) return { ok: false, note: OUTCOME_WORDS.notPlaced };
  try {
    const note = desk.engine.ops.spawnWidget(NOTE_TYPE, {
      x: at.x - size.w / 2,
      y: at.y - size.h / 2,
      w: size.w,
      h: size.h,
      props: { text },
    });
    desk.engine.ops.setSelection([note]);
    return { ok: true, note: OUTCOME_WORDS.placedNote };
  } catch (cause) {
    log().error("renderer.cards.desk_note_refused", "The desk refused a card's note", cause);
    return { ok: false, note: OUTCOME_WORDS.notPlaced };
  }
}

/** The picture's own bytes: the card's, or a snapshot's still through the shell; null when the
 * still is no longer kept. */
async function pictureBytes(
  card: PictCard,
  still: StillBytes | undefined,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (card.bytes !== undefined) return new Uint8Array(await card.bytes.arrayBuffer());
  if (card.path === undefined || still === undefined) return null;
  return still(card.path);
}

/** A print of the picture, centred on the point, falling in as a paste's does (`Prints.arrive`). */
async function printOnto(
  desk: MountedDesk,
  card: PictCard,
  at: { readonly x: number; readonly y: number },
  deps: DeskCardTargetDeps,
  still: StillBytes | undefined,
): Promise<CardPlayed> {
  const { engine } = desk;
  const session = engine.docs.current();
  let hash: string;
  try {
    const bytes = await pictureBytes(card, still);
    if (bytes === null) return { ok: false, note: OUTCOME_WORDS.printGone };
    hash = await (deps.blobs ?? deskBlobs()).put(bytes, card.bytes?.type || "image/png");
  } catch (cause) {
    log().error("renderer.cards.desk_print_bytes", "A card's picture could not be kept", cause);
    return { ok: false, note: OUTCOME_WORDS.notPlaced };
  }
  // the desk may have changed while the bytes came: another board (the seed asks the same,
  // desk-seed.ts); an object taken into hand, the pegboard out, a board turned read-only — what
  // the answer refused, asked again, in its words; or another view, under whose cover the desk is
  // a frozen still that takes nothing
  if (engine.docs.current() !== session) return { ok: false, note: OUTCOME_WORDS.notPlaced };
  const refused = refusalOf(desk, card, still);
  if (refused !== null) return { ok: false, note: refused };
  if (getActiveView() !== "canvas") return { ok: false, note: OUTCOME_WORDS.notPlaced };
  try {
    const r = printRect(at.x, at.y, card.width, card.height);
    const print = engine.ops.spawnWidget(PHOTO_TYPE, {
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      props: { blob: hash, width: card.width, height: card.height, angle: 0 },
    });
    const prints = (desk.handle as Partial<DeskLayerHandle>).local?.(PHOTO_KIND);
    (prints as Prints | undefined)?.arrive(print);
    engine.ops.setSelection([print]);
    return { ok: true, note: OUTCOME_WORDS.placedPrint };
  } catch (cause) {
    log().error("renderer.cards.desk_print_refused", "The desk refused a card's print", cause);
    return { ok: false, note: OUTCOME_WORDS.notPlaced };
  }
}

/** The desk mounted now as a place a card plays onto (HN-D7). */
export function deskCardTarget(desk: MountedDesk, deps: DeskCardTargetDeps = {}): CardTarget {
  const still = (): StillBytes | undefined =>
    (deps.host === undefined ? peekHost() : deps.host)?.screenshotStillBytes;
  return {
    id: "desk",
    kind: "desk",
    layer: TARGET_LAYER.desk,
    rect: () => containerOf(desk)?.getBoundingClientRect() ?? null,
    element: () => containerOf(desk),
    answer: (card) => {
      const refused = refusalOf(desk, card, still());
      if (refused !== null) return { ok: false, label: refused };
      return {
        ok: true,
        label: card.kind === "pict" ? TARGET_WORDS.deskPrint : TARGET_WORDS.deskNote,
      };
    },
    play: async (card, at) => {
      const door = still();
      const refused = refusalOf(desk, card, door);
      if (refused !== null) return { ok: false, note: refused };
      const point = worldPoint(desk, at);
      if (point === null) return { ok: false, note: OUTCOME_WORDS.notPlaced };
      return card.kind === "pict"
        ? printOnto(desk, card, point, deps, door)
        : noteOnto(desk, card.paste, point);
    },
  };
}

/** The desk mounted now takes a card while Canvas is the view (under a cover it is a frozen still,
 * and the view's own places answer): followed across mounts and view switches. A page with no
 * host (the catalog) has no desk to play onto. Returns the undo. */
export function followDeskCardTarget(deps: DeskCardTargetDeps = {}): () => void {
  if (peekHost() === null) return () => undefined;
  let placed: { readonly desk: MountedDesk; readonly off: () => void } | null = null;
  const follow = (): void => {
    const desk = getActiveView() === "canvas" ? currentDesk() : null;
    if (desk === (placed?.desk ?? null)) return;
    placed?.off();
    placed = desk === null ? null : { desk, off: cardTargets.register(deskCardTarget(desk, deps)) };
  };
  const offDesk = subscribeDesk(follow);
  const offView = subscribeActiveView(follow);
  follow();
  return () => {
    offDesk();
    offView();
    placed?.off();
    placed = null;
  };
}
