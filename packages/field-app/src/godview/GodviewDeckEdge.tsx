import { MONITOR_STAGE_CLASS } from "@vibecook/puppeteer-views";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  clampDeckShift,
  DECK_FLING_SAMPLES,
  DECK_SHIFT_PROPERTY,
  type DeckEdgeBounds,
  type DeckSample,
  deckEdgeBounds,
  deckEdgeEventTrusted,
  deckEdgeValueText,
  deckLetGo,
  deckShiftForKey,
  FIELD_SHIFT_PROPERTY,
  flingVelocity,
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
  /** The terminals are away (GV-D6): the edge holds still where it was left.
   * The monitor has the window then, and an edge that measured it would
   * re-clamp itself and lay the hidden sheet out again — the one thing a
   * minimized deck must not do (§8, one resize per change). */
  away?: boolean;
  /** Let go with less than 120 left, or flung down, the terminals go away —
   * asked of their owner (GV-D6; round 3, W4). Absent (a picture's edge), the
   * held edge stops at the least a deck that is up keeps, as before. */
  onMinimize?: () => void;
  /** The terminals are maximized (GV-D11): the lip is the window's title bar
   * and only its grip drags them; the edge holds still, as away. */
  maximized?: boolean;
  /** Let go above the fill line, or flung up, the terminals fill the window —
   * asked of their owner, at once: the edge was already in the hand (L10).
   * Absent, the held edge stops at the fill line. */
  onMaximize?: () => void;
  /** Out of maximized, asked of the owner: at once (`fall` false) from the
   * START of a drag of the grip, or by a key; as a fall for a double-click. */
  onUp?: (fall: boolean) => void;
  /** Held past either line, the stage says what letting go would do (§8,
   * §9): which, or null when it should not any more. */
  onReadout?: (says: DeckReadoutKind | null) => void;
}

/** What a held edge's readout says: *Minimize* or *Maximize* the terminals. */
export type DeckReadoutKind = "minimize" | "maximize";

interface Drag {
  pointerId: number;
  startY: number;
  startShift: number;
  bounds: DeckEdgeBounds;
  /** The held edge's latest positions, for a fling. */
  samples: DeckSample[];
  /** A press of the maximized grip not yet moved: it leaves maximized on its
   * first move. */
  leaving: boolean;
  /** Takes the window's listeners down and lets the lip go. */
  stop: () => void;
}

/** The grip (GV-D12): the groove — a slot pressed into the frame — in the pill
 * it answers the pointer on. Markup only; `godview.css` draws it and its
 * states, keyed on the lip that holds it. A lip that is a picture (Settings'
 * miniature) wears it too, at rest. */
export function DeckGroove(): ReactElement {
  return (
    <span className="vf-godview-deck-grip" aria-hidden="true">
      <span className="vf-godview-deck-groove" />
    </span>
  );
}

function writeShift(root: HTMLElement | null | undefined, property: string, shift: number): void {
  if (!root) return;
  if (shift === 0) root.style.removeProperty(property);
  else root.style.setProperty(property, `${shift}px`);
}

/**
 * THE DECK'S LIP (DESIGN.md §8, 2026-09-28; the Lip since round 3, GV-D7): the
 * 30 bar along the top of the terminal sheet, and — with a monitor above it —
 * the separator that moves the sheet's edge. The number it moves is written
 * straight onto the stage's root and `godview.css` does the layout, so a drag
 * re-renders this lip and nothing else: the monitor and the deck are elements
 * the stage was handed, and they follow the edge through CSS alone. The
 * terminals and the swarm each re-measure their own boxes (ResizeObserver),
 * which is how they resize without being told.
 *
 * Three numbers: the INTENT (where the viewer put the edge — remembered), the
 * APPLIED shift (where the sheet stands: the intent clamped to this window, or
 * the held edge), and the FIELD shift (the edge as last set, which the
 * monitor's field follows — once per change, never per frame of a drag). A
 * window that shrinks clamps the edge; one that grows back returns it to where
 * it was put.
 *
 * A let-go has outcomes (round 3, W4 — §8 "A let-go decides"): with
 * less than 120 left, or flung down, the terminals go away and the place the
 * viewer left the edge is still the one remembered; otherwise the edge stays
 * and is remembered. (The third, maximized, is the next slice's.) The drag
 * reads trusted moves AT THE WINDOW, in the capture phase: a lost pointer
 * capture ends nothing (the record's "Found while driving it").
 */
export function GodviewDeckEdge({
  persist,
  monitorPresent,
  away = false,
  onMinimize,
  maximized = false,
  onMaximize,
  onUp,
  onReadout,
}: GodviewDeckEdgeProps): ReactElement {
  const lipRef = useRef<HTMLDivElement>(null);
  const [intentInit] = useState(() => (persist ? storedDeckShift() : 0));
  const intent = useRef(intentInit);
  const applied = useRef(0);
  const field = useRef(0);
  const drag = useRef<Drag | null>(null);
  const [shift, setShift] = useState(0);
  const [bounds, setBounds] = useState<DeckEdgeBounds | null>(null);
  const [dragging, setDragging] = useState(false);
  // The owner's ears, read at the moment they are needed — a drag outlives
  // the render that started it.
  const minimize = useRef(onMinimize);
  minimize.current = onMinimize;
  const maximize = useRef(onMaximize);
  maximize.current = onMaximize;
  const up = useRef(onUp);
  up.current = onUp;
  const readout = useRef(onReadout);
  readout.current = onReadout;
  const said = useRef<DeckReadoutKind | null>(null);
  const say = useCallback((says: DeckReadoutKind | null): void => {
    if (said.current === says) return;
    said.current = says;
    readout.current?.(says);
  }, []);

  const stage = useCallback((): {
    root: HTMLElement;
    monitor: Element;
    sheet: HTMLElement;
  } | null => {
    const lip = lipRef.current;
    const root = lip?.closest<HTMLElement>(".vf-godview");
    const monitor = root?.querySelector(`.${MONITOR_STAGE_CLASS}`);
    const sheet = lip?.closest<HTMLElement>(".vf-godview-terminal-deck");
    return root && monitor && sheet ? { root, monitor, sheet } : null;
  }, []);

  const apply = useCallback((next: number): void => {
    applied.current = next;
    writeShift(lipRef.current?.closest<HTMLElement>(".vf-godview"), DECK_SHIFT_PROPERTY, next);
    setShift(next);
  }, []);

  const setField = useCallback((next: number): void => {
    field.current = next;
    writeShift(lipRef.current?.closest<HTMLElement>(".vf-godview"), FIELD_SHIFT_PROPERTY, next);
  }, []);

  const measure = useCallback((): DeckEdgeBounds | null => {
    const found = stage();
    if (!found) return null;
    // Inside the frame's cover the deck's well keeps the window's reserve
    // clear (One Frame FC-D15, godview.css), so the deck's minimum stands
    // ABOVE that reserve: the lip and a few rows, never a sliver of one under
    // the line. (The well carries the foot since round 3; the body is the
    // panes, 1 in.)
    const well = found.root.querySelector(".vf-godview-deck-well");
    // Rest is read off the stage's probe at it, which stands still whatever
    // the sheet is doing (maximized at the window's top, travelling); a stage
    // without one is measured off the sheet, which stands at rest + shift.
    const rest = found.root.querySelector<HTMLElement>(":scope > .vf-godview-deck-rest");
    const bounds = deckEdgeBounds(
      rest === null
        ? measureDeckEdge(found.root, found.sheet, well, applied.current)
        : measureDeckEdge(found.root, rest, well, 0),
    );
    return bounds;
  }, [stage]);

  /** A change (a let-go that stays, a key, a double-click): remembered, the
   * sheet placed, and the monitor's field measured once to it. */
  const commit = useCallback(
    (next: number): void => {
      intent.current = next;
      if (persist) storeDeckShift(next);
      if (next !== applied.current) apply(next);
      if (next !== field.current) setField(next);
    },
    [apply, setField, persist],
  );

  // Place the edge, and keep it placed while the window and the monitor's
  // tuned height move. A layout effect, so the first paint of an open
  // already stands where the viewer left it. The monitor unmounts while
  // Godview is closed; the edge rests then and comes back on the next open.
  // Away, it holds still — measured again only when the terminals come up,
  // and then laid out at the edge they come up to before the first paint of
  // their rise (one resize, at most). Maximized, it holds still too: the sheet
  // stands at the window's top whatever the edge says.
  useLayoutEffect(() => {
    if (away || maximized) return;
    const found = monitorPresent ? stage() : null;
    if (!found) {
      apply(0);
      setField(0);
      setBounds(null);
      return;
    }
    const settle = (): void => {
      if (drag.current !== null) return;
      const next = measure();
      if (next === null) return;
      setBounds((current) =>
        current !== null &&
        current.min === next.min &&
        current.max === next.max &&
        current.held === next.held
          ? current
          : next,
      );
      const placed = clampDeckShift(intent.current, next);
      if (placed !== applied.current) apply(placed);
      if (placed !== field.current) setField(placed);
    };
    settle();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(settle);
    observer.observe(found.root);
    observer.observe(found.monitor);
    return () => observer.disconnect();
  }, [apply, setField, measure, monitorPresent, stage, away, maximized]);

  // The root outlives this lip only in a fixture swap; leave it at rest, and
  // take down a drag that was still held.
  useEffect(() => {
    const lip = lipRef.current;
    return () => {
      drag.current?.stop();
      const root = lip?.closest<HTMLElement>(".vf-godview");
      root?.style.removeProperty(DECK_SHIFT_PROPERTY);
      root?.style.removeProperty(FIELD_SHIFT_PROPERTY);
    };
  }, []);

  if (!monitorPresent) {
    return <div ref={lipRef} className="vf-godview-deck-lip" aria-hidden="true" />;
  }

  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || drag.current !== null) return;
    const measured = measure();
    if (measured === null) return;
    event.preventDefault();
    // Out of maximized, the grip turns the bar back into the sheet AT ONCE —
    // from the drag's start, not its let-go (GV-D11): its first move, so a
    // click (a double-click's first half) leaves the bar where it is.
    const lip = event.currentTarget;
    const pointerId = event.pointerId;
    // The capture keeps the cursor and the events with the lip while it lasts;
    // losing it ends nothing — the moves are read at the window below.
    lip.setPointerCapture(pointerId);
    const ours = (moved: globalThis.PointerEvent): boolean =>
      moved.pointerId === pointerId && deckEdgeEventTrusted(moved);
    const move = (moved: globalThis.PointerEvent): void => {
      const current = drag.current;
      if (current === null || !ours(moved)) return;
      if (current.leaving) {
        // the door reads up now, so the head returns; the sheet stands where
        // the bar was (the window's top), the same box, as the pointer takes it
        current.leaving = false;
        up.current?.(false);
      }
      // a held edge goes on down past the line only where letting go there
      // can put the terminals away, and on up past the fill line only where
      // letting go there can fill the window
      const minimizes = minimize.current !== undefined;
      const maximizes = maximize.current !== undefined;
      const next = clampDeckShift(current.startShift + moved.clientY - current.startY, {
        min: maximizes ? current.bounds.top : current.bounds.min,
        max: minimizes ? current.bounds.held : current.bounds.max,
      });
      current.samples.push([performance.now(), next]);
      if (current.samples.length > DECK_FLING_SAMPLES) current.samples.shift();
      if (next !== applied.current) apply(next);
      say(
        minimizes && next > current.bounds.max
          ? "minimize"
          : maximizes && next < current.bounds.min
            ? "maximize"
            : null,
      );
    };
    const letGo = (released: globalThis.PointerEvent): void => {
      const current = drag.current;
      if (current === null || !ours(released)) return;
      current.stop();
      // a press of the maximized grip that never moved leaves it maximized
      if (current.leaving) return;
      const at = applied.current;
      current.samples.push([performance.now(), at]);
      const outcome = deckLetGo(at, current.bounds, flingVelocity(current.samples));
      const toMinimize = minimize.current;
      if (outcome === "away" && toMinimize !== undefined) {
        // The sheet falls at the size it has; the place the viewer left the
        // edge stays the one remembered (the intent), and the field is the
        // monitor's alone once they are away.
        toMinimize();
        return;
      }
      const toMaximize = maximize.current;
      if (outcome === "maximized" && toMaximize !== undefined) {
        // At once, in one layout: the remembered edge, again, is untouched —
        // restore brings the terminals back down to it.
        toMaximize();
        return;
      }
      commit(clampDeckShift(at, current.bounds));
    };
    const stop = (): void => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", letGo, true);
      window.removeEventListener("pointercancel", letGo, true);
      drag.current = null;
      if (lip.hasPointerCapture(pointerId)) lip.releasePointerCapture(pointerId);
      setDragging(false);
      say(null);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", letGo, true);
    window.addEventListener("pointercancel", letGo, true);
    // from the bar, the drag starts at the window's top, where the bar is
    const startShift = maximized ? measured.top : applied.current;
    drag.current = {
      pointerId,
      startY: event.clientY,
      startShift,
      bounds: measured,
      samples: [[performance.now(), startShift]],
      leaving: maximized,
      stop,
    };
    setBounds(measured);
    setDragging(true);
  };

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
      onPointerDown={startDrag}
      onDoubleClick={() => {
        const measured = measure();
        commit(measured === null ? 0 : clampDeckShift(0, measured));
        // on the maximized grip: the terminals fall back, to rest
        if (maximized) up.current?.(true);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const measured = measure();
        if (measured === null) return;
        // On the maximized grip the keys take the terminals out — to the fill
        // line, or with End to 120 left — in one layout; never anywhere a key
        // could minimize or maximize from.
        const next = maximized
          ? maximizedKey(event.key, measured)
          : deckShiftForKey(event.key, event.shiftKey, applied.current, measured);
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        setBounds(measured);
        if (maximized) up.current?.(false);
        commit(next);
      }}
    >
      {/* the grip's hit: the whole lip drags the edge of a sheet; in the
          title bar only this does (GV-D11's 168), the rest moves the window */}
      <span className="vf-godview-deck-grip-hit">
        <DeckGroove />
      </span>
    </div>
  );
}

/** A key on the maximized grip: out, to the fill line (↑ ↓ Home), or to 120
 * left (End). Null for any other key. */
function maximizedKey(key: string, bounds: DeckEdgeBounds): number | null {
  switch (key) {
    case "ArrowUp":
    case "ArrowDown":
    case "Home":
      return bounds.min;
    case "End":
      return bounds.max;
    default:
      return null;
  }
}
