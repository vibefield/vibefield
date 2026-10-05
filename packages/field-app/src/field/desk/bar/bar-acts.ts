import { type CanvasEngine, type Entity, Position, Size, selectedEntities } from "@vibecook/ice";

// THE BAR'S ACTS (DK-11; DESIGN.md §8 "The doors": "the acts run through the engine's ops"; "The bar grown"). Each
// act of the bar and its grown menu is ONE engine op on the selection — `ops.runMenuAction` for a kind's,
// `ops.duplicateSelection`, `ops.setLocked`, `ops.deleteSelection`, `ops.reorder`, `ops.arrange` (Clean up — one
// undo step, DK-D29), `ops.open` — never a write of the chrome's own. The one act that is VibeField's composition is
// COMMENT (DK-D24 — the C key's wrap of the selection, which left the keymap with field-tools at DK-8): a comment pad
// laid at the selection's edge, one undo step, the pad selected so it can be written on.

/** The comment pad's type (plugins/comment-pad — named by its TYPE, as the seed names it; DK-8). */
export const COMMENT_PAD_TYPE = "vibefield.comment-pad";

/** The comment pad's gap from the selection it comments on (world units — Clean up's own gutter). */
export const COMMENT_GAP = 24;

/** The act ids the bar and its menu run (a kind's act is `act:<id>`). */
export type BarActId =
  | `act:${string}`
  | "duplicate"
  | "tape"
  | "delete"
  | "open"
  | "comment"
  | "front"
  | "back"
  | "cleanup";

/** The selection's box in WORLD units (its objects' Position + Size), or null when nothing selected has one. */
export function selectionWorldBox(
  engine: CanvasEngine,
  entities: readonly Entity[] = selectedEntities(engine.world),
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const e of entities) {
    const p = engine.world.get(e, Position);
    const s = engine.world.get(e, Size);
    if (p === undefined || s === undefined) continue;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + s.w);
    y1 = Math.max(y1, p.y + s.h);
  }
  return x0 === Number.POSITIVE_INFINITY ? null : { x0, y0, x1, y1 };
}

/**
 * COMMENT — a comment pad laid at the selection's right edge (its top on the selection's top, the gutter between),
 * at its kind's own size, in the frame the selection lies in: ONE spawn, one undo step; the pad becomes the
 * selection. Returns the pad, or null when nothing selected has a box or the pad's type is not here.
 */
export function layComment(engine: CanvasEngine): Entity | null {
  const box = selectionWorldBox(engine);
  const pad = engine.catalog.widget(COMMENT_PAD_TYPE);
  if (box === null || pad === undefined) return null;
  const entity = engine.ops.spawnWidget(COMMENT_PAD_TYPE, {
    x: box.x1 + COMMENT_GAP,
    y: box.y0,
    w: pad.defaultSize.w,
    h: pad.defaultSize.h,
  });
  engine.ops.setSelection([entity]);
  return entity;
}

/** Run one of the bar's acts on the selection — through the engine's ops alone. `locked`: every selected object
 * is taped (the anchor's), so the tape act lifts it. */
export function runBarAct(engine: CanvasEngine, id: BarActId, locked: boolean): void {
  if (id.startsWith("act:")) {
    engine.ops.runMenuAction(id.slice("act:".length));
    return;
  }
  const selection = selectedEntities(engine.world);
  switch (id) {
    case "duplicate":
      engine.ops.duplicateSelection();
      return;
    case "tape":
      engine.ops.setLocked(selection, !locked);
      return;
    case "delete":
      engine.ops.deleteSelection();
      return;
    case "open": {
      const one = selection[0];
      if (selection.length !== 1 || one === undefined) return;
      try {
        engine.ops.open(one);
      } catch {
        // refused (its type no longer opens, or another object is in hand): the row was offered in vain — nothing
      }
      return;
    }
    case "comment":
      layComment(engine);
      return;
    case "front":
      engine.ops.reorder(selection, "top");
      return;
    case "back":
      engine.ops.reorder(selection, "bottom");
      return;
    case "cleanup":
      engine.ops.arrange();
      return;
  }
}
