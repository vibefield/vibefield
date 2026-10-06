import { type CanvasEngine, type Entity, PrefabId, selectedEntities } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";
import { deskPalette } from "@vibecook/ice/desk/objects";
import type { ChipStill, DeskChip } from "../../../frame/draft";
import {
  beginSendRecord,
  noteSend,
  type SendFrom,
  sendToLine,
  type WindowBox,
} from "../../../frame/line-send";
import { heldNow, type MountedDesk, plainWords } from "../desk-door";
import { encodePng, type PngEncoder } from "../desk-stills";
import { chipFace, chipObjects, type SentObject } from "./send-face";

// SEND TO… — THE ACT (DK-14; DESIGN.md §8 "Send to…"; R15, DK-D26; plan addendum (50); ICE I23). Pressed on the bar,
// in the bar grown into its menu, or on the tools in hand, the selection becomes ONE chip in the line's draft — it only
// drafts: it never sends and never aims. This reads the selection as the host reads it (its entities, each one's type,
// words and durable props), makes the chip's face and what it carries (send-face.ts), hands it to the line with where it
// flies from (line-send.ts), and takes the chip's STILL through the desk's capture door:
//   ON THE DESK — the rect is the anchor's box WITHOUT the brackets' outset (6 for one object, the union's 10 for
//   several), the MARKS HIDDEN FIRST by the host's own doors: the selection is cleared, the brackets' presence left
//   (ICE's 120 ms), the capture taken of the last presented frame, and the selection put back as it was;
//   IN HAND — the object STAYS in hand (addendum (50)): the chip flies from where the desk DRAWS it (the held pose
//   seam's frame, `__vfDesk.held()`), and the still is that drawn box — the hand is drawn out of the marks (D4b), so
//   there is nothing to hide.
// The still is PNG bytes kept in this renderer under a `blob:` URL (the packaged `img-src` admits `blob:` — DK-4).

/** The brackets' outset around the selection (ICE's marks: 6 out for one object, the union's 10 for several). */
export const BRACKETS = { one: 6, several: 10 } as const;

/** The brackets' presence fades this long once the selection is cleared (ICE's `MARKS.clocks.leave` / `unionFade`). */
export const MARKS_LEAVE_MS = 120;

/** The longest the act waits for the marks to leave before it captures what the desk last presented. */
export const MARKS_PATIENCE_MS = 600;

/** A box in CSS px of the desk's view (the anchor's, the pick's). */
export interface ViewBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

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

/** The selected objects as the host reads them (§8 "The doors"): type, words, durable props — in selection order. */
export function sentObjects(desk: MountedDesk, entities: readonly Entity[]): SentObject[] {
  const words = desk.words ?? plainWords;
  const out: SentObject[] = [];
  for (const e of entities) {
    const type = desk.engine.world.get(e, PrefabId)?.id;
    if (typeof type !== "string") continue;
    out.push({ type, words: words(type), props: objectProps(desk.engine, e) });
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

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });

/**
 * The brackets gone from what the desk presents: the selection was just cleared, and their presence fades over the
 * marks' leave. Resolves once a frame has been presented after the fade ended — or, once the desk has drawn since the
 * clear and owes no frame, after the fade and two frames more — and at the latest after `MARKS_PATIENCE_MS`.
 */
export async function marksLeft(
  handle: Pick<DeskLayerHandle, "perf" | "dirty">,
  now: () => number = () => performance.now(),
  frame: () => Promise<void> = nextFrame,
): Promise<void> {
  const t0 = now();
  const f0 = handle.perf().frames;
  let fAtLeave: number | null = null;
  while (now() - t0 < MARKS_PATIENCE_MS) {
    await frame();
    const t = now() - t0;
    if (t < MARKS_LEAVE_MS) continue;
    const frames = handle.perf().frames;
    fAtLeave ??= frames;
    if (frames > fAtLeave) return;
    if (t >= MARKS_LEAVE_MS + 40 && frames > f0 && !handle.dirty()) return;
  }
}

/** The still: the rect through the capture door at the view's device px, as PNG bytes under a `blob:` URL. */
export async function stillOf(
  handle: Pick<DeskLayerHandle, "capture">,
  rect: { x: number; y: number; width: number; height: number },
  encode: PngEncoder = encodePng,
): Promise<ChipStill | null> {
  const bitmap = await handle.capture({ rect });
  if (bitmap === undefined) return null;
  try {
    const png = await encode(bitmap);
    const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
    return { url, width: bitmap.width, height: bitmap.height, bytes: png.byteLength };
  } finally {
    bitmap.close();
  }
}

let sendSeq = 0;

/** Two selections the same, in any order. */
const sameEntities = (a: readonly Entity[], b: readonly Entity[]): boolean =>
  a.length === b.length && a.every((e) => b.includes(e));

/** What the act needs of the world beyond the desk — a test's doubles stand in for them. */
export interface SendSeams {
  readonly encode?: PngEncoder;
  readonly marks?: (handle: Pick<DeskLayerHandle, "perf" | "dirty">) => Promise<void>;
  /** The object in hand and where the desk drew it (`heldNow` — the pose seam a desk's frame fills). */
  readonly held?: typeof heldNow;
}

/**
 * SEND TO… from `from`: the selection (or the object in hand) as ONE chip into the line's draft, its still taken
 * behind it. Answers whether the line took it — false with nothing selected, no line, or a chip still landing.
 */
export function sendSelection(desk: MountedDesk, from: SendFrom, seams: SendSeams = {}): boolean {
  const { engine, handle } = desk;
  const inHand = from === "hand";
  const held = inHand ? (seams.held ?? heldNow)(engine) : null;
  const entities: readonly Entity[] =
    held !== null ? [held.entity as Entity] : selectedEntities(engine.world);
  if (entities.length === 0) return false;
  const objects = sentObjects(desk, entities);
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
  const view = handle.selection.anchor().view;
  const rect = captureRect(box, view);
  const origin = viewOrigin(desk);
  const fromBox: WindowBox = {
    x0: box.x0 + origin.left,
    y0: box.y0 + origin.top,
    x1: box.x1 + origin.left,
    y1: box.y1 + origin.top,
  };

  const face = chipFace(objects, deskPalette(desk.theme));
  sendSeq += 1;
  const chip: DeskChip = {
    id: `send-${sendSeq}`,
    kind: "desk",
    ...face,
    objects: chipObjects(objects),
    still: null,
  };
  const record = beginSendRecord({
    from,
    label: chip.label,
    glyph: chip.glyph,
    paper: chip.paper ?? null,
    ink: chip.ink ?? null,
    objects: chip.objects,
    fromBox,
    rect:
      rect === null
        ? null
        : { x0: rect.x, y0: rect.y, x1: rect.x + rect.width, y1: rect.y + rect.height },
  });
  const ticket = sendToLine(chip, fromBox);
  if (ticket === null) return false;

  void (async () => {
    let still: ChipStill | null = null;
    const hide = !inHand;
    // the record OBSERVES the marks hidden — nothing selected at the moment the still is taken — and the same
    // selection standing again after; it never takes the act's word for either
    let cleared = false;
    try {
      if (hide) {
        // the marks hidden first, by the host's own doors: the selection cleared — and put back below
        engine.ops.clearSelection();
        await (seams.marks ?? marksLeft)(handle);
      }
      cleared = selectedEntities(engine.world).length === 0;
      if (rect !== null) still = await stillOf(handle, rect, seams.encode);
    } catch {
      still = null; // a capture that failed carries no still; the chip still says what it carries in words
    } finally {
      let restored = false;
      if (hide) {
        // put back as it was — unless the person has selected something else meanwhile
        if (selectedEntities(engine.world).length === 0) {
          const alive = entities.filter((e) => engine.world.get(e, PrefabId) !== undefined);
          if (alive.length > 0) engine.ops.setSelection(alive);
        }
        restored = sameEntities(selectedEntities(engine.world), entities);
      }
      noteSend(record.seq, { marks: { cleared, restored } });
    }
    ticket.attach(still);
  })();
  return true;
}
