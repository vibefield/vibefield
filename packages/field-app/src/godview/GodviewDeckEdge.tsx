import { MONITOR_STAGE_CLASS } from "@vibecook/puppeteer-views";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  clampDeckShift,
  DECK_SHIFT_PROPERTY,
  type DeckEdgeBounds,
  deckEdgeBounds,
  deckEdgeValueText,
  deckShiftForKey,
  measureDeckEdge,
  storeDeckShift,
  storedDeckShift,
} from "./deck-edge";

export interface GodviewDeckEdgeProps {
  /** Remember where this viewer left the edge (the live overlay). Fixtures
   * move it for the length of the page and forget. */
  persist: boolean;
  /** Whether a monitor stands above the deck. Without one there is nothing to
   * move against, so the lip draws no grip and the edge sits at rest. */
  monitorPresent: boolean;
}

interface Drag {
  pointerId: number;
  startY: number;
  startShift: number;
  bounds: DeckEdgeBounds;
}

/**
 * THE DECK'S LIP (DESIGN.md §8, 2026-09-28): the band along the top of the
 * terminal sheet, and — with a monitor above it — the separator that moves the
 * sheet's edge. The number it moves is written straight onto the stage's root
 * as `--vf-godview-deck-shift` and `godview.css` does the layout, so a drag
 * re-renders this lip and nothing else: the monitor and the deck are elements
 * the stage was handed, and they follow the edge through CSS alone. The
 * terminals and the swarm each re-measure their own boxes (ResizeObserver),
 * which is how they resize without being told.
 *
 * Two numbers: the INTENT (where the viewer put the edge — remembered) and the
 * APPLIED shift (the intent clamped to this window). A window that shrinks
 * clamps the edge; one that grows back returns it to where it was put.
 */
export function GodviewDeckEdge({ persist, monitorPresent }: GodviewDeckEdgeProps): ReactElement {
  const lipRef = useRef<HTMLDivElement>(null);
  const [intentInit] = useState(() => (persist ? storedDeckShift() : 0));
  const intent = useRef(intentInit);
  const applied = useRef(0);
  const drag = useRef<Drag | null>(null);
  const [shift, setShift] = useState(0);
  const [bounds, setBounds] = useState<DeckEdgeBounds | null>(null);
  const [dragging, setDragging] = useState(false);

  const stage = useCallback((): { root: HTMLElement; monitor: Element } | null => {
    const root = lipRef.current?.closest<HTMLElement>(".vf-godview");
    const monitor = root?.querySelector(`.${MONITOR_STAGE_CLASS}`);
    return root && monitor ? { root, monitor } : null;
  }, []);

  const apply = useCallback((next: number): void => {
    const root = lipRef.current?.closest<HTMLElement>(".vf-godview");
    applied.current = next;
    if (root) {
      if (next === 0) root.style.removeProperty(DECK_SHIFT_PROPERTY);
      else root.style.setProperty(DECK_SHIFT_PROPERTY, `${next}px`);
    }
    setShift(next);
  }, []);

  const measure = useCallback((): DeckEdgeBounds | null => {
    const found = stage();
    return found
      ? deckEdgeBounds(measureDeckEdge(found.root, found.monitor, applied.current))
      : null;
  }, [stage]);

  const commit = useCallback(
    (next: number): void => {
      intent.current = next;
      if (persist) storeDeckShift(next);
      if (next !== applied.current) apply(next);
    },
    [apply, persist],
  );

  // Place the edge, and keep it placed while the window and the monitor's
  // tuned height move. A layout effect, so the first paint of an open
  // already stands where the viewer left it. The monitor unmounts while
  // Godview is closed; the edge rests then and comes back on the next open.
  useLayoutEffect(() => {
    const found = monitorPresent ? stage() : null;
    if (!found) {
      apply(0);
      setBounds(null);
      return;
    }
    const settle = (): void => {
      if (drag.current !== null) return;
      const next = measure();
      if (next === null) return;
      setBounds((current) =>
        current !== null && current.min === next.min && current.max === next.max ? current : next,
      );
      const placed = clampDeckShift(intent.current, next);
      if (placed !== applied.current) apply(placed);
    };
    settle();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(settle);
    observer.observe(found.root);
    observer.observe(found.monitor);
    return () => observer.disconnect();
  }, [apply, measure, monitorPresent, stage]);

  // The root outlives this lip only in a fixture swap; leave it at rest.
  useLayoutEffect(() => {
    const lip = lipRef.current;
    return () => {
      lip?.closest<HTMLElement>(".vf-godview")?.style.removeProperty(DECK_SHIFT_PROPERTY);
    };
  }, []);

  const end = useCallback(
    (event: PointerEvent<HTMLDivElement>): void => {
      const current = drag.current;
      if (current === null || event.pointerId !== current.pointerId) return;
      drag.current = null;
      setDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      commit(applied.current);
    },
    [commit],
  );

  if (!monitorPresent) {
    return <div ref={lipRef} className="vf-godview-deck-lip" aria-hidden="true" />;
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator that moves an edge is the ARIA window-splitter pattern; <hr> cannot take focus or a value
    <div
      ref={lipRef}
      className="vf-godview-deck-lip"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Terminal deck edge"
      aria-valuenow={shift}
      {...(bounds !== null ? { "aria-valuemin": bounds.min, "aria-valuemax": bounds.max } : {})}
      aria-valuetext={deckEdgeValueText(shift)}
      tabIndex={0}
      title="Drag to move the deck · double-click to rest"
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const measured = measure();
        if (measured === null) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          startShift: applied.current,
          bounds: measured,
        };
        setBounds(measured);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current === null || event.pointerId !== current.pointerId) return;
        const next = clampDeckShift(
          current.startShift + event.clientY - current.startY,
          current.bounds,
        );
        if (next !== applied.current) apply(next);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => {
        const measured = measure();
        commit(measured === null ? 0 : clampDeckShift(0, measured));
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const measured = measure();
        if (measured === null) return;
        const next = deckShiftForKey(event.key, event.shiftKey, applied.current, measured);
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        setBounds(measured);
        commit(next);
      }}
    >
      <span className="vf-godview-deck-grip" aria-hidden="true" />
    </div>
  );
}
