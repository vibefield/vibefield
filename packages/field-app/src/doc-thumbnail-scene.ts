import {
  type CanvasEngine,
  ChildOf,
  defineQuery,
  type Entity,
  MeasuredSize,
  Position,
  PrefabId,
  Size,
  StackZ,
  WireFrom,
  WirePorts,
  WireTo,
  widgets,
} from "@vibecook/ice";
import { previewBackground } from "@vibefield/shell-ui";

// A thumbnail is a sanitized projection of durable canvas structure. It never
// reads widget React faces or live bindings, so terminal/browser/agent runtime
// content cannot accidentally become durable image data.

export interface DocThumbnailWidget {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  background: string;
}

export interface DocThumbnailWire {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface DocThumbnailScene {
  background: string;
  widgets: DocThumbnailWidget[];
  wires: DocThumbnailWire[];
}

const widgetQ = defineQuery([Position, PrefabId]);
const wireQ = defineQuery([WirePorts]);
const DEFAULT_CANVAS_BACKGROUND = "#f6f6f8";

export function captureDocThumbnailScene(ce: CanvasEngine): DocThumbnailScene {
  const cards: Array<DocThumbnailWidget & { entity: Entity }> = [];
  const centers = new Map<Entity, { x: number; y: number }>();

  ce.world.query(widgetQ).each((batch) => {
    for (const row of batch) {
      const entity = batch.entity(row);
      // A folder is the root-level visual representative of its descendants.
      // Drawing children again at their parent-local coordinates corrupts the
      // overview and leaks detail that the closed folder intentionally hides.
      // Root-level ≠ parentless (fix 2026-07-21): EVERY widget is ChildOf
      // something — the canvas ANCHOR at root, its folder inside one (probe:
      // 21/21 seeds parent to the anchor) — so "no parent" read the whole
      // board as empty. Root-level = the parent is not itself a widget.
      const parent = ce.world.getRelation(entity, ChildOf);
      if (parent !== undefined && ce.world.get(parent, PrefabId) !== undefined) continue;
      const position = ce.world.get(entity, Position);
      const measured = ce.world.get(entity, MeasuredSize);
      const declared = ce.world.get(entity, Size);
      const size = measured !== undefined && measured.w > 0 ? measured : declared;
      const type = ce.world.get(entity, PrefabId)?.id;
      if (position === undefined || size === undefined || typeof type !== "string") continue;
      const def = widgets.get(type);
      const card: DocThumbnailWidget & { entity: Entity } = {
        entity,
        type,
        x: position.x,
        y: position.y,
        w: size.w,
        h: size.h,
        z: ce.world.get(entity, StackZ)?.z ?? cards.length,
        background: previewBackground(type, def?.surface),
      };
      cards.push(card);
      centers.set(entity, { x: card.x + card.w / 2, y: card.y + card.h / 2 });
    }
  });

  const wires: DocThumbnailWire[] = [];
  ce.world.query(wireQ).each((batch) => {
    for (const row of batch) {
      const wire = batch.entity(row);
      const from = ce.world.getRelation(wire, WireFrom);
      const to = ce.world.getRelation(wire, WireTo);
      if (from === undefined || to === undefined) continue;
      const a = centers.get(from);
      const b = centers.get(to);
      if (a === undefined || b === undefined) continue;
      wires.push({ fromX: a.x, fromY: a.y, toX: b.x, toY: b.y });
    }
  });

  cards.sort((a, b) => a.z - b.z);
  return {
    background: DEFAULT_CANVAS_BACKGROUND,
    widgets: cards.map(({ entity: _entity, ...card }) => card),
    wires,
  };
}
