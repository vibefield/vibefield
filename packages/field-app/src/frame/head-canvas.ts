import {
  Camera,
  type CanvasEngine,
  defineQuery,
  type Entity,
  NavDepth,
  NavFrame,
  PrefabId,
  widgets,
} from "@vibecook/ice";

// WHAT THE HEAD READS FROM THE CANVAS, AND ASKS OF IT (One Frame FR-3;
// DESIGN.md §8 "The head"). The name pill shows where you are — the field and
// the folders you have entered — and the readout shows the zoom; both are the
// canvas's facts, and the zoom's acts are the canvas's ops. A door, not the
// engine: the head's controller reads the door, so the catalog can run the
// shipping head on fixture facts, and the cutover swaps only what is behind it
// (ICE 0.11's facade — `zoomTo` · `zoomToFit` · `exitTo` — which the desk
// keeps).
//
// The nav reads are the retired breadcrumbs' (ported from the v1 playground,
// then made event-driven): ICE's nav stack is ENTITIES, one `NavEntry` per
// depth carrying `NavDepth{d}` (the field's top is depth 0, the empty stack)
// and a `NavFrame → container` relation. Strata's `observeQuery` wakes on a
// NavEntry's spawn or despawn (enter, exit), and an `observeValue` per
// container's title component catches a rename while you are inside it. What
// changed at FR-3: there is no synthesized "Root" crumb — the top is the
// field, which the document manager names (F12).

/** One folder on the way down from the field's top. */
export interface HeadCrumb {
  /** Its depth in the nav stack: 1 for a folder on the field, and so on. */
  readonly depth: number;
  readonly label: string;
}

export interface HeadCanvas {
  /** The folders you are in, outermost first; empty at the field's top. The
   * same array until the path changes, so a store can read it as a snapshot. */
  path(): readonly HeadCrumb[];
  subscribePath(onChange: () => void): () => void;
  /** The zoom as the readout says it: a whole percent. */
  percent(): number;
  subscribePercent(onChange: () => void): () => void;
  /** The camera's zoom, 1 being actual size. */
  zoom(): number;
  zoomTo(zoom: number): void;
  /** Frame everything in the folder you are in. */
  zoomToFit(): void;
  /** Up to `depth` (0: the field's top) in ONE flight (design-006 §5) — a loop
   * of single exits would stack flights, each cancelling the last. */
  exitTo(depth: number): void;
}

const navEntryQ = defineQuery([NavDepth]);

/** A container's title, read generically: its PrefabId → its widget type →
 * the first group carrying a `title` field → that value; else the PrefabId,
 * else "Folder" (there is no generic widget-title seam). */
function titleOf(engine: CanvasEngine, container: Entity): string {
  const type = engine.world.get(container, PrefabId)?.id;
  const widget = typeof type === "string" ? widgets.get(type) : undefined;
  if (widget !== undefined) {
    const group = widget.groups.find((g) => "title" in g.fields);
    if (group !== undefined) {
      const v = engine.world.get(container, group.component) as { title?: unknown } | undefined;
      const title = v?.title;
      if (typeof title === "string" && title.length > 0) return title;
    }
  }
  return typeof type === "string" && type.length > 0 ? type : "Folder";
}

/** The nav stack as crumbs, outermost first. */
export function readHeadPath(engine: CanvasEngine): HeadCrumb[] {
  const entries: { depth: number; container: Entity | undefined }[] = [];
  engine.world.query(navEntryQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      const container = engine.world.getRelation(e, NavFrame);
      entries.push({
        depth: engine.world.read(e, NavDepth).d,
        container:
          container !== undefined && engine.world.isAlive(container) ? container : undefined,
      });
    }
  });
  entries.sort((a, b) => a.depth - b.depth);
  return entries.map(({ depth, container }) => ({
    depth,
    label: container !== undefined ? titleOf(engine, container) : "Folder",
  }));
}

export function headPathEqual(a: readonly HeadCrumb[], b: readonly HeadCrumb[]): boolean {
  return (
    a.length === b.length && a.every((c, i) => c.depth === b[i]?.depth && c.label === b[i]?.label)
  );
}

const zoomOf = (engine: CanvasEngine): number => engine.world.getResource(Camera)?.zoom ?? 1;

/** The head's door over a live canvas engine. */
export function canvasHead(engine: CanvasEngine): HeadCanvas {
  let path = readHeadPath(engine);
  const listeners = new Set<() => void>();
  let unwire: (() => void) | null = null;

  // ONE observation for every reader: the first subscriber wires it, the last
  // unwires it, and a change updates the shared snapshot BEFORE anyone hears
  // of it — so no reader can find the path already current and stay asleep.
  const wire = (): (() => void) => {
    const titleSubs: (() => void)[] = [];
    const rewireTitles = (): void => {
      for (const un of titleSubs.splice(0)) un();
      engine.world.query(navEntryQ).each((b) => {
        for (const r of b) {
          const container = engine.world.getRelation(b.entity(r), NavFrame);
          if (container === undefined || !engine.world.isAlive(container)) continue;
          const type = engine.world.get(container, PrefabId)?.id;
          const widget = typeof type === "string" ? widgets.get(type) : undefined;
          const group = widget?.groups.find((g) => "title" in g.fields);
          if (group !== undefined) {
            titleSubs.push(engine.world.reactive.observeValue(container, group.component, fire));
          }
        }
      });
    };
    function fire(): void {
      const next = readHeadPath(engine);
      if (headPathEqual(path, next)) return;
      path = next;
      rewireTitles(); // the containers may have changed with the stack
      for (const fn of [...listeners]) fn();
    }
    const unQuery = engine.world.reactive.observeQuery(navEntryQ, fire);
    path = readHeadPath(engine);
    rewireTitles();
    return () => {
      unQuery();
      for (const un of titleSubs) un();
    };
  };

  return {
    path: () => {
      // Unwatched, read it fresh — keeping the array when nothing changed, so
      // the snapshot is stable for a store that has not subscribed yet.
      if (unwire === null) {
        const next = readHeadPath(engine);
        if (!headPathEqual(path, next)) path = next;
      }
      return path;
    },
    subscribePath(onChange) {
      listeners.add(onChange);
      if (unwire === null) unwire = wire();
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && unwire !== null) {
          unwire();
          unwire = null;
        }
      };
    },
    percent: () => Math.round(zoomOf(engine) * 100),
    subscribePercent: (onChange) => engine.world.reactive.observeResource(Camera, onChange),
    zoom: () => zoomOf(engine),
    zoomTo: (zoom) => engine.ops.zoomTo(zoom),
    zoomToFit: () => engine.ops.zoomToFit(),
    exitTo: (depth) => engine.ops.exitTo(depth),
  };
}
