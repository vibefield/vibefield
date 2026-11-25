import { Camera, type Entity } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";
import {
  NOTE_TYPE,
  PHOTO_KIND,
  PHOTO_TYPE,
  type Prints,
  printRect,
} from "@vibecook/ice/desk/objects";
import { clientToScreen, screenToWorld } from "@vibecook/ice/kernel";
import type { ObjectRef } from "@vibefield/contracts";
import {
  bloomOf,
  type Destination,
  dragLabelOf,
  faceOf,
  LANDING_WORDS,
  landing,
} from "../../frame/cards/card-landing";
import {
  type CardPlayed,
  type CardTarget,
  cardTargets,
  TARGET_LAYER,
} from "../../frame/cards/card-targets";
import type { ImageFace, LinkFace, RefFace } from "../../frame/cards/cards-model";
import { OUTCOME_WORDS, TARGET_WORDS } from "../../frame/cards/cards-words";
import { readyFace } from "../../frame/cards/face-ready";
import { type RefPlace, resolveRef } from "../../frame/cards/hand-over";
import { getActiveView, subscribeActiveView } from "../../frame/view-state";
import { type FieldHost, peekHost } from "../../host";
import { getRendererLogger } from "../../logging";
import { deskBlobs } from "./desk-blobs";
import { currentDesk, type MountedDesk, subscribeDesk } from "./desk-door";
import { lookAtObject } from "./look-at-object";
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
  /** Where a ref's object lies (undefined: `objects.resolve`, through the window's door). */
  readonly resolve?: (ref: ObjectRef) => Promise<RefPlace | null>;
  /** Where a print's picture is kept (undefined: the page's one byte store). */
  readonly blobs?: { put(bytes: Uint8Array<ArrayBuffer>, type: string): Promise<string> };
}

const log = () => getRendererLogger().child({ component: "cards.desk" });

/** The browser pane's durable type, when the desk holds it (a dev run since FL-1). */
const BROWSER_PANE_TYPE = "vibefield.browser-pane";

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

/** The desk as a place a card lands (`card-landing.ts`, §4.4), what it can hold now. PURE. */
function destinationOf(desk: MountedDesk, still: StillBytes | undefined): Destination {
  return {
    at: "desk",
    browser: desk.engine.catalog.widget(BROWSER_PANE_TYPE) !== undefined,
    stills: still !== undefined,
  };
}

/** Why the desk cannot take anything now, in the desk's words; null when it can. */
function refusalOf(desk: MountedDesk): string | null {
  const tray = trayOf(desk)?.anchor();
  if (tray?.held === true) return TARGET_WORDS.deskHeld;
  if (tray?.open === true) return TARGET_WORDS.deskBoardOut;
  const session = desk.engine.docs.current();
  if (session === undefined || session.readOnly) return TARGET_WORDS.deskReadOnly;
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
  picture: ImageFace,
  still: StillBytes | undefined,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (picture.bytes !== undefined) return new Uint8Array(await picture.bytes.arrayBuffer());
  if (picture.path === undefined || still === undefined) return null;
  return still(picture.path);
}

/** A print of the picture, centred on the point, falling in as a paste's does (`Prints.arrive`). */
async function printOnto(
  desk: MountedDesk,
  picture: ImageFace,
  at: { readonly x: number; readonly y: number },
  deps: DeskCardTargetDeps,
  still: StillBytes | undefined,
): Promise<CardPlayed> {
  const { engine } = desk;
  const session = engine.docs.current();
  let hash: string;
  try {
    const bytes = await pictureBytes(picture, still);
    if (bytes === null) return { ok: false, note: OUTCOME_WORDS.printGone };
    hash = await (deps.blobs ?? deskBlobs()).put(bytes, picture.bytes?.type || "image/png");
  } catch (cause) {
    log().error("renderer.cards.desk_print_bytes", "A card's picture could not be kept", cause);
    return { ok: false, note: OUTCOME_WORDS.notPlaced };
  }
  // the desk may have changed while the bytes came: another board (the seed asks the same,
  // desk-seed.ts); an object taken into hand, the pegboard out, a board turned read-only — what
  // the answer refused, asked again, in its words; or another view, under whose cover the desk is
  // a frozen still that takes nothing
  if (engine.docs.current() !== session) return { ok: false, note: OUTCOME_WORDS.notPlaced };
  const refused = refusalOf(desk);
  if (refused !== null) return { ok: false, note: refused };
  if (getActiveView() !== "canvas") return { ok: false, note: OUTCOME_WORDS.notPlaced };
  try {
    const r = printRect(at.x, at.y, picture.width, picture.height);
    const print = engine.ops.spawnWidget(PHOTO_TYPE, {
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      props: { blob: hash, width: picture.width, height: picture.height, angle: 0 },
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

/** §4.4: a ref on the desk is where it already is, so the camera goes to it and it is selected. */
async function goToObject(
  desk: MountedDesk,
  face: RefFace,
  deps: DeskCardTargetDeps,
): Promise<CardPlayed> {
  const place = await (deps.resolve ?? resolveRef)(face.ref);
  if (place === null) return { ok: false, note: OUTCOME_WORDS.objectGone };
  if (place.docId !== desk.docId) return { ok: false, note: OUTCOME_WORDS.onAnotherBoard };
  const entity = desk.engine.docs.current()?.store.resolve(place.key as never) as
    | Entity
    | undefined;
  // the one door to an object (look-at-object.ts): its centre at the view's centre, and selected
  if (entity === undefined || !lookAtObject(desk, entity))
    return { ok: false, note: OUTCOME_WORDS.objectGone };
  return { ok: true, note: OUTCOME_WORDS.onTheDesk };
}

/** A browser pane open at an address, centred on the point (§4.4: "a link: a browser pane at it"). */
function pageOnto(
  desk: MountedDesk,
  link: LinkFace,
  at: { readonly x: number; readonly y: number },
): CardPlayed {
  const size = desk.engine.catalog.widget(BROWSER_PANE_TYPE)?.defaultSize;
  if (size === undefined) return { ok: false, note: LANDING_WORDS.deskNoPage };
  try {
    const pane = desk.engine.ops.spawnWidget(BROWSER_PANE_TYPE, {
      x: at.x - size.w / 2,
      y: at.y - size.h / 2,
      w: size.w,
      h: size.h,
      props: { url: link.url },
    });
    desk.engine.ops.setSelection([pane]);
    return { ok: true, note: OUTCOME_WORDS.placedPage };
  } catch (cause) {
    log().error("renderer.cards.desk_page_refused", "The desk refused a card's page", cause);
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
    destination: () => destinationOf(desk, still()),
    answer: (card) => {
      const said = dragLabelOf(bloomOf(card, destinationOf(desk, still())), "The desk");
      if (!said.ok) return { ok: false, label: said.label };
      const refused = refusalOf(desk);
      if (refused !== null) return { ok: false, label: refused };
      return { ok: true, label: said.label };
    },
    play: async (card, faceId, at) => {
      const door = still();
      const face = faceOf(card, faceId);
      const verdict = landing(face, destinationOf(desk, door));
      if (!verdict.lands) return { ok: false, note: verdict.reason };
      const refused = refusalOf(desk);
      if (refused !== null) return { ok: false, note: refused };
      const point = worldPoint(desk, at);
      if (point === null) return { ok: false, note: OUTCOME_WORDS.notPlaced };
      switch (face.type) {
        case "image":
          return printOnto(desk, face, point, deps, door);
        case "text": {
          const ready = await readyFace(face, null);
          if (!ready.ok) return { ok: false, note: ready.note };
          return ready.face.type === "text"
            ? noteOnto(desk, ready.face.text, point)
            : { ok: false, note: OUTCOME_WORDS.notPlaced };
        }
        case "link":
          return pageOnto(desk, face, point);
        case "ref":
          return goToObject(desk, face, deps);
        default:
          return { ok: false, note: OUTCOME_WORDS.notPlaced };
      }
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
