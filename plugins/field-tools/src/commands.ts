/**
 * C key: wrap the current selection in a comment (widgetlab App.tsx port).
 * The comment spawns at the BOTTOM of the frame (order "first" — ONE undoable
 * tx) so members render and pick above it, sized to the selection bbox
 * (measured-when-real sizes) plus header + padding. Random palette accent per
 * spawn. Exported as a command function — since P6 the spine invokes it through
 * the §13 commands contribution (renderer.ts binds it via ctx.commands.register
 * on the §12.7 canvas handle); the former direct field-app import is retired.
 */
import {
  type CanvasEngine,
  MeasuredSize,
  Position,
  Size,
  selectedEntities,
} from "@vibefield/plugin-sdk/canvas";

/** The declared command id (§8.3) — one source of truth for the manifest, the
 * renderer binding, and the spine's canvas-context/palette invocations. */
export const COMMENT_COMMAND = "vibefield.field-tools.comment-around-selection";

/** Curated accents (the lab's card palette) — random pick per C-spawn. */
export const COMMENT_PALETTE = [
  "#6366F1",
  "#EC4899",
  "#22C55E",
  "#F59E0B",
  "#06B6D4",
  "#8B5CF6",
  "#EF4444",
  "#3B82F6",
];

const COMMENT_PAD = 28;
const COMMENT_HEADER = 44;
const COMMENT_GAP = 12; // header → content breathing room

/** Returns true when a comment was spawned (selection non-empty). */
export function spawnCommentAroundSelection(ce: CanvasEngine): boolean {
  const sel = selectedEntities(ce.world);
  if (sel.length === 0) return false;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const e of sel) {
    const p = ce.world.get(e, Position);
    const m = ce.world.get(e, MeasuredSize);
    const s = m !== undefined && m.w > 0 ? m : ce.world.get(e, Size);
    if (p === undefined || s === undefined) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.w);
    maxY = Math.max(maxY, p.y + s.h);
    any = true;
  }
  if (!any) return false;
  // Strictly below every widget in the frame: sibling place "first" (petition
  // 8 — retires the minZ−1 scan; each new comment prepends under the previous
  // ones too).
  const color = COMMENT_PALETTE[Math.floor(Math.random() * COMMENT_PALETTE.length)] as string;
  const comment = ce.ops.spawnWidget("vibefield.field-tools.comment", {
    x: minX - COMMENT_PAD,
    y: minY - COMMENT_HEADER - COMMENT_GAP,
    w: maxX - minX + COMMENT_PAD * 2,
    h: maxY - minY + COMMENT_HEADER + COMMENT_GAP + COMMENT_PAD,
    order: "first",
    props: { title: "Comment", color },
  });
  ce.ops.setSelection([comment]);
  return true;
}
