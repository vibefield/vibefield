import { type CanvasEngine, type Entity, PrefabId, selectedEntities } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";
import { type CardOrigin, type PictCard, textCardOf } from "../../../frame/cards/cards-model";
import { type CardStore, cardsStore, type DealFrom } from "../../../frame/cards/cards-store";
import { COPY_DOOR_WORDS, COPY_WORDS } from "../../../frame/cards/cards-words";
import { type CopyDeps, type CopyHost, copyToHand } from "../../../frame/cards/copy-door";
import { sayOnLine } from "../../../frame/line-door";
import { heldNow, type MountedDesk, plainWords } from "../desk-door";
import { encodePng, type PngEncoder } from "../desk-stills";
import { type CopiedObject, copyName, noteWords } from "./copy-face";
import { beginCopyRecord, type CopyFrom, noteCopy, type ViewBox } from "./copy-record";

// THE DESK'S COPY — THE ACT (HN-D3, HN-D2; DESIGN.md §8 "The desk's Copy"; R15, DK-D26; plan addendum (50); ICE I23,
// I40). Pressed on the bar, in the bar grown into its menu, on the tools in hand, or by ⌘C over the desk, the selection —
// or the object in hand — is dealt into the hand as ONE card, flying from the objects' own box, through the one copy
// door (`copyToHand`, HN-5): a lone NOTE is a TEXT card of its writing; anything else a PICTURE card titled by its name
// (copy-face.ts), its still taken through the desk's capture door of the OBJECTS — drawn WITHOUT the selection's marks
// (`capture({ rect, marks: false })`, ICE I40, desk.6). The selection is never touched: no clear, no restore, no blink a
// peer could see (DK-17b):
//   ON THE DESK — the rect is the anchor's box WITHOUT the brackets' outset (6 for one object, the union's 10 for
//   several), taken of the last presented frame at once;
//   IN HAND — the object STAYS in hand (addendum (50)): the card flies from where the desk DRAWS it (the held pose
//   seam's frame, `__vfDesk.held()`), and the still is that drawn box — the hand is drawn out of the marks (D4b).
// What the card holds goes on the system clipboard FIRST (HN-5, LC-9): the note's words through the host's copy door,
// the picture's PNG through the clipboard's picture door — its words or its picture, one write, for a second would
// replace the first. The card is dealt only once the clipboard took it, so the newest card is what the clipboard
// holds; a refusal deals nothing, and the line says why. The picture card keeps its PNG too (LC-7): a Blob in this
// renderer, shown through a `blob:` URL (the packaged `img-src` admits `blob:` — DK-4), with no file on disk for a
// pane to take. Where no picture can be taken — nothing of the box on the view, a desk that cannot draw — no card is
// dealt, and the line says why.

/** The brackets' outset around the selection (ICE's marks: 6 out for one object, the union's 10 for several). */
export const BRACKETS = { one: 6, several: 10 } as const;

/** The anchor's box less the brackets' outset: the objects' own box. */
export function insetBox(box: ViewBox, count: number): ViewBox {
  const m = count > 1 ? BRACKETS.several : BRACKETS.one;
  return { x0: box.x0 + m, y0: box.y0 + m, x1: box.x1 - m, y1: box.y1 - m };
}

/** A box as the capture door's rect, cut to the view — null when nothing of it is on the view. */
export function captureRect(
  box: ViewBox,
  view: { readonly width: number; readonly height: number },
): { x: number; y: number; width: number; height: number } | null {
  const x0 = Math.max(0, box.x0);
  const y0 = Math.max(0, box.y0);
  const x1 = Math.min(view.width, box.x1);
  const y1 = Math.min(view.height, box.y1);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** An object's durable props: the cells of its type's groups, merged (what `__vfDesk.objects` reads). */
export function objectProps(engine: CanvasEngine, entity: Entity): Record<string, unknown> {
  const type = engine.world.get(entity, PrefabId)?.id;
  const widget = typeof type === "string" ? engine.catalog.widget(type) : undefined;
  const props: Record<string, unknown> = {};
  for (const group of widget?.groups ?? [])
    Object.assign(props, (engine.world.get(entity, group.component) as object | undefined) ?? {});
  return props;
}

/** The selected objects as the host reads them (§8 "The doors"): type, words, durable props — in selection order — and,
 * for one showing a live page (PT-4), what the mount's LIVE service calls that page, by the object's durable key. */
export function copiedObjects(desk: MountedDesk, entities: readonly Entity[]): CopiedObject[] {
  const words = desk.words ?? plainWords;
  const store = desk.engine.docs.current()?.store;
  const out: CopiedObject[] = [];
  for (const e of entities) {
    const type = desk.engine.world.get(e, PrefabId)?.id;
    if (typeof type !== "string") continue;
    const key = store?.keyOf(e) as string | undefined;
    const live = key === undefined ? undefined : desk.live?.label(key);
    out.push({
      type,
      words: words(type),
      props: objectProps(desk.engine, e),
      ...(live === undefined ? {} : { live }),
    });
  }
  return out;
}

/** The desk's own element — its view's origin on the window (the layer's canvas lies in it). */
function viewOrigin(desk: MountedDesk): { left: number; top: number } {
  const canvas = (desk.handle as Partial<DeskLayerHandle>).canvas;
  const el =
    canvas instanceof HTMLElement
      ? ((canvas.closest("[data-ice-canvas]") as HTMLElement | null) ?? canvas.parentElement)
      : null;
  const rect = el?.getBoundingClientRect();
  return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
}

/** A picture of the objects: its PNG — as the card keeps it, and as the clipboard's picture door takes its bytes — and
 * its size in device px. */
export interface DeskPicture {
  readonly png: Blob;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

/** The picture: the rect through the capture door at the view's device px, WITHOUT the selection's marks (ICE I40 — the
 * objects as they look unselected; the selection, the world and the presented frame untouched), as PNG bytes — null
 * where the desk has none to give (failed or degraded, before its first frame, its device lost). */
export async function pictureOf(
  handle: Pick<DeskLayerHandle, "capture">,
  rect: { x: number; y: number; width: number; height: number },
  encode: PngEncoder = encodePng,
): Promise<DeskPicture | null> {
  const bitmap = await handle.capture({ rect, marks: false });
  if (bitmap === undefined) return null;
  try {
    const bytes = await encode(bitmap);
    return {
      png: new Blob([bytes], { type: "image/png" }),
      bytes,
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

/** Two selections the same, in any order. */
const sameEntities = (a: readonly Entity[], b: readonly Entity[]): boolean =>
  a.length === b.length && a.every((e) => b.includes(e));

/** What the act needs of the world beyond the desk — a test's doubles stand in for them. */
export interface CopySeams {
  readonly encode?: PngEncoder;
  /** The object in hand and where the desk drew it (`heldNow` — the pose seam a desk's frame fills). */
  readonly held?: typeof heldNow;
  /** The hand the card is dealt into (left out: the window's own, `cardsStore`). */
  readonly store?: CardStore;
  /** The clipboard's doors the copy writes through (left out: the window's host; null: none — the page's own). */
  readonly host?: CopyHost | null;
}

/**
 * COPY from `from`: the selection — or, from the pill in hand or ⌘C while something is held, the object in hand — dealt
 * into the hand as ONE card once the system clipboard holds what it holds: a lone note's writing as a text card;
 * anything else as a picture card once its still is taken. Answers whether a copy began — false with nothing selected
 * or nowhere for the card to fly from.
 */
export function copySelection(desk: MountedDesk, from: CopyFrom, seams: CopySeams = {}): boolean {
  const { engine, handle } = desk;
  const held = from === "hand" || from === "key" ? (seams.held ?? heldNow)(engine) : null;
  /** The selection at the press — the act never writes it; the record observes that it stands the same after. */
  const before = selectedEntities(engine.world);
  const entities: readonly Entity[] = held !== null ? [held.entity as Entity] : before;
  if (entities.length === 0) return false;
  const objects = copiedObjects(desk, entities);
  if (objects.length === 0) return false;

  // where it flies from, and the still's rect: the held object as DRAWN, or the selection's own box (the brackets off)
  let box: ViewBox | null = null;
  if (held !== null) {
    const f = held.frame;
    box =
      f === null ? null : { x0: f.cx - f.hx, y0: f.cy - f.hy, x1: f.cx + f.hx, y1: f.cy + f.hy };
  } else {
    const anchor = handle.selection.anchor();
    box = anchor.box === null ? null : insetBox(anchor.box, entities.length);
  }
  if (box === null) return false;
  const rect = captureRect(box, handle.selection.anchor().view);
  const offset = viewOrigin(desk);
  const fromBox: DealFrom = {
    left: box.x0 + offset.left,
    top: box.y0 + offset.top,
    width: box.x1 - box.x0,
    height: box.y1 - box.y0,
  };
  // a lone note's words are its card; anything else is its picture, and gives the clipboard no words
  const writing = noteWords(objects);
  const record = beginCopyRecord({
    from,
    objects: objects.map((o) => ({ type: o.type, name: o.words.title })),
    fromBox,
    rect:
      rect === null
        ? null
        : { x0: rect.x, y0: rect.y, x1: rect.x + rect.width, y1: rect.y + rect.height },
    words: writing,
  });
  const store = seams.store ?? cardsStore;
  const deps: CopyDeps = { store, ...(seams.host === undefined ? {} : { host: seams.host }) };
  const cardOrigin: CardOrigin = { view: "canvas", how: "copy" };
  /** The copy door refused what the card holds: no card, and the line says why. */
  const refuse = (reason: string): void => {
    const refused = COPY_DOOR_WORDS.refused(reason);
    noteCopy(record.seq, { wrote: false, refused });
    sayOnLine(refused);
  };

  // a lone note: its writing, a text card once the clipboard holds its words
  if (writing !== null) {
    const card = textCardOf(writing, {
      id: store.nextId("text"),
      origin: cardOrigin,
      at: store.now(),
    });
    void copyToHand({ card, from: fromBox, text: writing }, deps).then((copied) => {
      if (!copied.ok) {
        refuse(copied.reason);
        return;
      }
      noteCopy(record.seq, {
        wrote: true,
        kept: sameEntities(selectedEntities(engine.world), before),
        card: { id: card.id, kind: "text", title: card.title },
        at: { dealt: performance.now() },
      });
    });
    return true;
  }

  // anything else: its picture, taken behind the press
  void (async () => {
    let picture: DeskPicture | null = null;
    let refused: string = COPY_WORDS.offScreen;
    // the record OBSERVES the selection standing as it stood at the press — when the still is asked and after it
    // answered — never the act's word (the act writes no selection at all)
    let kept = sameEntities(selectedEntities(engine.world), before);
    try {
      if (rect !== null) {
        refused = COPY_WORDS.notDrawn;
        // the record keeps the marks as the capture door is HANDED them — never the option this
        // act means to pass — so a still asked with the brackets never reads as one without
        const door: Pick<DeskLayerHandle, "capture"> = {
          capture: (options) => {
            noteCopy(record.seq, { marks: options?.marks ?? true });
            return handle.capture(options);
          },
        };
        picture = await pictureOf(door, rect, seams.encode);
      }
    } catch {
      picture = null; // a capture that failed gives no picture, and the line says so below
    } finally {
      kept = kept && sameEntities(selectedEntities(engine.world), before);
      noteCopy(record.seq, { kept, at: { captured: performance.now() } });
    }
    if (picture === null) {
      noteCopy(record.seq, { refused });
      sayOnLine(refused);
      return;
    }
    noteCopy(record.seq, {
      still: { width: picture.width, height: picture.height, bytes: picture.png.size },
    });
    const card: PictCard = {
      id: store.nextId("pict"),
      kind: "pict",
      origin: cardOrigin,
      at: store.now(),
      title: copyName(objects),
      width: picture.width,
      height: picture.height,
      src: URL.createObjectURL(picture.png),
      bytes: picture.png,
      // no file on disk to paste, nor words of its own: a pane says a picture with no file can't be pasted yet
      paste: "",
    };
    // its PNG on the system clipboard first, then the card (HN-5)
    const copied = await copyToHand({ card, from: fromBox, png: picture.bytes }, deps);
    if (!copied.ok) {
      URL.revokeObjectURL(card.src); // never dealt: its face is shown nowhere
      refuse(copied.reason);
      return;
    }
    noteCopy(record.seq, {
      wrote: true,
      card: { id: card.id, kind: "pict", title: card.title },
      at: { dealt: performance.now() },
    });
  })();
  return true;
}
