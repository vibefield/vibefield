/**
 * Container-nav breadcrumbs — ported from the v1 playground
 * (`../../../infinite-canvas/apps/playground/src/panels/NavigationBreadcrumbs.tsx`).
 *
 * JSX + Tailwind + the SVG icons are VERBATIM; the nav reads changed for v3:
 *  - v1 read a single `NavigationStackResource.frames` array. v3's nav stack is
 *    ENTITIES: one `NavEntry` per depth, carrying `NavDepth{d}` (root = empty
 *    stack) and a `NavFrame → container` relation. We query `[NavDepth]`, sort
 *    by depth, and synthesize the always-present "Root" crumb at depth 0.
 *  - Back goes through `ce.ops.exitContainer()`; crumb jumps through
 *    `ce.ops.exitTo(depth)` — one composed portal-zoom flight per jump
 *    (design-006 §5), not a loop of single pops.
 *  - Container titles are read generically: the container's `PrefabId` → its
 *    widget type → the first group carrying a `title` field → that value. If no
 *    such field exists we fall back to the PrefabId string, then "Folder"
 *    (reported — there is no generic "widget title" seam).
 *  - Updates poll on a 200ms interval (v1 used `engine.onFrame`; v3 has no such
 *    hook — this is chrome, polling is fine), setState-suppressed by structural
 *    equality.
 */
import {
  type CanvasEngine,
  defineQuery,
  type Entity,
  NavDepth,
  NavFrame,
  PrefabId,
  widgets,
} from "@vibecook/ice";
import { useEffect, useRef, useState } from "react";

interface NavigationBreadcrumbsProps {
  engine: CanvasEngine;
}

interface Crumb {
  /** Depth index in the navigation stack. 0 = root. */
  depth: number;
  /** container entity for this frame, or null for the root frame. */
  containerId: Entity | null;
  /** Display label — container title, PrefabId fallback, or "Root". */
  label: string;
}

const navEntryQ = defineQuery([NavDepth]);

/**
 * Best-effort generic title read: PrefabId → widget type → first group with a
 * `title` field → its value. Falls back to the PrefabId, then "Folder".
 */
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

/**
 * Reads the current nav stack from the engine and builds a Crumb[] array.
 * Kept cheap — called once per poll tick.
 */
function readCrumbs(engine: CanvasEngine): Crumb[] {
  const entries: { depth: number; container: Entity | undefined }[] = [];
  engine.world.query(navEntryQ).each((b) => {
    for (const r of b) {
      const e = b.entity(r);
      const depth = engine.world.read(e, NavDepth).d;
      const container = engine.world.getRelation(e, NavFrame);
      entries.push({
        depth,
        container:
          container !== undefined && engine.world.isAlive(container) ? container : undefined,
      });
    }
  });
  entries.sort((a, b) => a.depth - b.depth);
  const crumbs: Crumb[] = [{ depth: 0, containerId: null, label: "Root" }];
  for (const { depth, container } of entries) {
    crumbs.push({
      depth,
      containerId: container ?? null,
      label: container !== undefined ? titleOf(engine, container) : `#${depth}`,
    });
  }
  return crumbs;
}

/**
 * Compare two crumb arrays structurally. Used to suppress setState when the
 * nav stack didn't meaningfully change tick-to-tick.
 */
function crumbsEqual(a: Crumb[], b: Crumb[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ca = a[i];
    const cb = b[i];
    if (ca === undefined || cb === undefined) return false;
    if (ca.containerId !== cb.containerId || ca.label !== cb.label) return false;
  }
  return true;
}

export function NavigationBreadcrumbs({ engine }: NavigationBreadcrumbsProps) {
  const [crumbs, setCrumbs] = useState<Crumb[]>(() => readCrumbs(engine));
  const lastCrumbsRef = useRef<Crumb[]>(crumbs);

  // Re-read on a poll interval, setState only if the nav stack actually
  // changed (v1 used engine.onFrame; v3 has no per-frame hook for chrome).
  useEffect(() => {
    const tick = () => {
      const next = readCrumbs(engine);
      if (!crumbsEqual(lastCrumbsRef.current, next)) {
        lastCrumbsRef.current = next;
        setCrumbs(next);
      }
    };
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [engine]);

  const canGoBack = crumbs.length > 1;

  const goBack = () => {
    if (!canGoBack) return;
    engine.ops.exitContainer();
  };

  const jumpToDepth = (targetDepth: number) => {
    const currentDepth = crumbs.length - 1;
    if (targetDepth >= currentDepth) return;
    // ONE composed transition for the whole jump (design-006 §5) — looping
    // exitContainer would stack N flights, each cancelling the last.
    engine.ops.exitTo(targetDepth);
  };

  return (
    // left-24 clears the macOS traffic lights (hidden-inset titlebar); no-drag: inside the drag strip
    <div
      data-hud-flight="top-left"
      className="hud-flight no-drag absolute top-[9px] left-24 z-50 flex items-center gap-2"
    >
      {/* Back button */}
      <button
        type="button"
        onClick={goBack}
        disabled={!canGoBack}
        className="flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-colors bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200 dark:disabled:hover:bg-neutral-800 dark:disabled:hover:text-neutral-400"
        title={canGoBack ? "Back (Esc)" : "Already at root"}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <title>Back</title>
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>

      {/* Breadcrumb pill */}
      <nav
        aria-label="Navigation breadcrumbs"
        className="flex items-center gap-1 rounded-full bg-white px-3 py-2 shadow-lg text-[12px] font-medium dark:bg-neutral-800"
      >
        {crumbs.map((crumb, i) => {
          const isCurrent = i === crumbs.length - 1;
          const isClickable = !isCurrent;
          return (
            <div
              key={`${crumb.depth}-${crumb.containerId ?? "root"}`}
              className="flex items-center"
            >
              {i > 0 && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mx-0.5 text-neutral-300 dark:text-neutral-600"
                  aria-hidden="true"
                >
                  <title>Separator</title>
                  <path d="m9 18 6-6-6-6" />
                </svg>
              )}
              {isClickable ? (
                <button
                  type="button"
                  onClick={() => jumpToDepth(crumb.depth)}
                  className="max-w-[160px] truncate rounded px-1.5 py-0.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                  title={`Jump to ${crumb.label}`}
                >
                  {crumb.label}
                </button>
              ) : (
                <span
                  className="max-w-[160px] truncate rounded px-1.5 py-0.5 text-neutral-800 dark:text-neutral-100"
                  aria-current="page"
                >
                  {crumb.label}
                </span>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
