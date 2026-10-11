import type { MonitorViewKey, MonitorViewMark } from "@vibecook/puppeteer-view-sdk";
import { keyLegend } from "@vibecook/puppeteer-view-sdk/toolkit";
import { ViewMark } from "@vibecook/puppeteer-views";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import {
  type CSSProperties,
  type FocusEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  STORIES_RETURN_MS,
  storiesShown,
  storyHome,
  storyInView,
  storyName,
  storyTurn,
} from "./head-row";
import "./godview-head.css";

// GODVIEW'S HEAD — STORIES (DESIGN.md §8 "Godview's head — Stories"; One Frame
// §23, round 3; GV-D1, MV-D16 marks only, N12 (a), N13 (a)) — controller-free,
// so the catalog mounts this exact markup wherever it mounts the monitor. The
// monitor's views switch in a row of glass circles on the frame's head row,
// centred on the window. What it shows is all props: the views (each one's
// manifest: its label, its filled mark, the keys it takes while focused), the
// current view, and the deck's state. What it keeps is only its own: the room
// it measures, the page it is turned to, and which circle the pointer or the
// focus is on. It replaced the 40px instrument bar; puppeteer's own Godview
// keeps that bar.

/** A view as the head switches to it: its manifest's id, label, mark (MV-D6)
 * and declared keys (MV-D8). */
export interface GodviewHeadEntry {
  readonly id: string;
  readonly label: string;
  readonly mark: MonitorViewMark;
  readonly keys?: readonly MonitorViewKey[] | undefined;
}

/** The terminals' state, as the deck's owner says it (GV-D11): `maximized`,
 * nothing of the head stands over them. */
export type GodviewHeadDeck = "away" | "up" | "maximized";

export interface GodviewHeadViewProps {
  /** Every view the head switches between, in the registry's order. */
  views: readonly GodviewHeadEntry[];
  viewId: string;
  deck: GodviewHeadDeck;
  onSelectView?: (viewId: string) => void;
}

/** The page the row is turned to, and what it was turned for. */
interface Turned {
  readonly held: string;
  readonly offset: number;
}

/** Which circle the pointer and the keyboard's focus are on. */
interface Pointed {
  readonly hover: string | null;
  readonly focus: string | null;
}

const NOT_POINTED: Pointed = { hover: null, focus: null };

export function GodviewHeadView({
  views,
  viewId,
  deck,
  onSelectView,
}: GodviewHeadViewProps): ReactElement {
  const roomRef = useRef<HTMLDivElement>(null);
  // The room the row may take: between the lights' slot and the search button,
  // one head gap from each. The stylesheet lays it out, so a filter's token
  // widening the button's glass narrows it with no word from the Peek.
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = roomRef.current;
    if (element === null) return;
    const measure = (): void => {
      const width = Math.floor(element.clientWidth);
      setRoom(width > 0 ? width : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const count = views.length;
  const shown = storiesShown(count, room);
  const paged = count > shown;
  const last = Math.max(0, count - shown);
  const current = views.findIndex((view) => view.id === viewId);

  // The page. Whatever changes what the row holds — the view, the views, how
  // many circles fit — turns it to the page that holds the current view unless
  // the page it is on already does (React's state-from-the-previous-render
  // pattern: the row never paints a page without its view after such a change).
  const held = `${viewId}\u0000${count}\u0000${shown}`;
  const [turned, setTurned] = useState<Turned>(() => ({
    held,
    offset: current < 0 ? 0 : storyHome(count, shown, current),
  }));
  let offset = Math.min(turned.offset, last);
  if (turned.held !== held) {
    if (current >= 0 && !storyInView(offset, shown, current)) {
      offset = storyHome(count, shown, current);
    }
    setTurned({ held, offset });
  }
  const turnTo = useCallback((next: number) => setTurned({ held, offset: next }), [held]);

  // 700ms after the pointer leaves the head, a row paged past the current view
  // comes back to the page that holds it. Never from under the keyboard: while
  // the focus is on the head by the keys, the page stays where they turned it.
  const returning = useRef<number | undefined>(undefined);
  const stay = useCallback((): void => {
    if (returning.current !== undefined) window.clearTimeout(returning.current);
    returning.current = undefined;
  }, []);
  useEffect(() => stay, [stay]);
  const leave = (): void => {
    stay();
    if (!paged || current < 0 || storyInView(offset, shown, current)) return;
    returning.current = window.setTimeout(() => {
      returning.current = undefined;
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        roomRef.current?.contains(focused) === true &&
        focused.matches(":focus-visible")
      ) {
        return;
      }
      turnTo(storyHome(count, shown, current));
    }, STORIES_RETURN_MS);
  };

  /** One press of a chevron. A chevron with nothing more behind it steps out,
   * so the press that empties it hands the focus on to the circle at that end. */
  const turn = (direction: -1 | 1): void => {
    const next = storyTurn(offset, direction, count, shown);
    turnTo(next);
    if (direction === 1 ? next >= last : next <= 0) {
      roomRef.current
        ?.querySelectorAll<HTMLButtonElement>(".vf-story")
        [direction === 1 ? count - 1 : 0]?.focus();
    }
  };

  // The name is said under a circle while the pointer or the focus is on it.
  const [pointed, setPointed] = useState<Pointed>(NOT_POINTED);
  const said = pointed.hover ?? pointed.focus;
  const saidAt = said === null ? -1 : views.findIndex((view) => view.id === said);
  const saidView = saidAt < 0 ? undefined : views[saidAt];

  const maximized = deck === "maximized";
  // Every circle and chevron in view is a control in the window's drag strip,
  // so it is a hole in it (`no-drag`, as the frame's other head controls are).
  // Not maximized, where nothing of the head is over the terminals' title bar;
  // and not a circle off the page, which nothing can press.
  const hole = maximized ? "" : " no-drag";

  return (
    <div
      ref={roomRef}
      className="vf-stories"
      data-deck={deck}
      {...(paged ? { "data-paged": "" } : {})}
      inert={maximized}
    >
      <div
        className="vf-stories-row"
        style={{ "--vf-stories-shown": shown, "--vf-stories-offset": offset } as CSSProperties}
        onPointerEnter={stay}
        onPointerLeave={leave}
      >
        {paged ? (
          <button
            type="button"
            className={`vf-stories-chev${hole}`}
            data-end="start"
            aria-label="Earlier views"
            disabled={offset <= 0}
            onClick={() => turn(-1)}
          >
            <FieldGlyph name="chevron" size={12} turn={180} />
          </button>
        ) : null}
        {/* biome-ignore lint/a11y/useSemanticElements: a row of toggle buttons that choose the monitor's view, not a fieldset of form inputs; the perf lab, the capture harness and the smokes pick a view by this group and its label */}
        <div className="vf-stories-reel" role="group" aria-label="Monitor view">
          <div className="vf-stories-track">
            {views.map((view, index) => {
              const on = view.id === viewId;
              const inView = storyInView(offset, shown, index);
              return (
                <button
                  key={view.id}
                  type="button"
                  className={`vf-story${inView ? hole : ""}`}
                  aria-label={`${view.label} view`}
                  aria-pressed={on}
                  onClick={() => onSelectView?.(view.id)}
                  onPointerEnter={() => setPointed((now) => ({ ...now, hover: view.id }))}
                  onPointerLeave={() =>
                    setPointed((now) => (now.hover === view.id ? { ...now, hover: null } : now))
                  }
                  onFocus={(event: FocusEvent<HTMLButtonElement>) => {
                    // a circle the keyboard reaches off the page turns the row to it
                    if (!inView) turnTo(storyHome(count, shown, index));
                    if (event.target.matches(":focus-visible")) {
                      setPointed((now) => ({ ...now, focus: view.id }));
                    }
                  }}
                  onBlur={() =>
                    setPointed((now) => (now.focus === view.id ? { ...now, focus: null } : now))
                  }
                >
                  <ViewMark mark={view.mark} fallback={view.label} />
                </button>
              );
            })}
          </div>
        </div>
        {paged ? (
          <button
            type="button"
            className={`vf-stories-chev${hole}`}
            data-end="end"
            aria-label="More views"
            disabled={offset >= last}
            onClick={() => turn(1)}
          >
            <FieldGlyph name="chevron" size={12} />
          </button>
        ) : null}
        {saidView !== undefined && storyInView(offset, shown, saidAt) ? (
          <span
            // a new element per circle, so each one's name arrives (the entry
            // transition is the element's own)
            key={saidView.id}
            className="vf-stories-label"
            role="tooltip"
            style={{ "--vf-stories-at": saidAt } as CSSProperties}
          >
            {storyName(saidView.label)}
            {saidView.keys !== undefined && saidView.keys.length > 0 ? (
              // the keys the view takes while it is focused (MV-D8, M177), as
              // the bar's tooltip printed them
              <kbd
                aria-label={`while focused: ${saidView.keys.map((entry) => `${entry.key}, ${entry.label}`).join("; ")}`}
              >
                {saidView.keys.map((entry) => keyLegend(entry.key)).join(" ")}
              </kbd>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
