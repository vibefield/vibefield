import { SegmentedControl } from "@vibefield/design-kit/primitives";
import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
  useLayoutEffect,
  useRef,
} from "react";
import { boardStats } from "./board-stats";
import type { FilterOption, FiltersPlace } from "./pegboard-model";
import "./pegboard.css";

// THE PEGBOARD'S CHROME, controller-free (DK-13; DESIGN.md §8 "The pegboard — Objects, behind the line"; UI_SYSTEM's
// controller/view split): the board itself is the DESK's — its specimens hung by category over their label tape,
// drawn on the GPU behind the line — and what VibeField draws over it is screen-space chrome, lit by nothing and
// following the theme: THE FILTERS (the kit's segmented control, cut for the wood) in the board's clear header band,
// and the BOARD's keyboard stop — a listbox naming the specimens, its focused one ringed in the select ink over where
// the desk draws it. The controller (`Pegboard.tsx`) places both imperatively each time the tray publishes; the catalog
// hands a fixture place.

export interface PegboardViewProps {
  /** The board is out (the tray's `open`): the chrome is reachable; shut, it is inert. */
  readonly open: boolean;
  readonly options: readonly FilterOption[];
  /** The category the board shows (`""` All). */
  readonly category: string;
  readonly onCategory: (id: string) => void;
  /** Where the filters stand — the catalog's fixture; the product writes it imperatively through `filtersRef`. */
  readonly place?: FiltersPlace | null;
  readonly filtersRef?: Ref<HTMLDivElement>;
  /** The specimens the board hangs now, in reading order: the listbox's options. */
  readonly specimens: readonly { readonly type: string; readonly label: string }[];
  /** The specimen the keyboard is on (its type), or null. */
  readonly focused: string | null;
  readonly boardRef?: Ref<HTMLDivElement>;
  readonly ringRef?: Ref<HTMLDivElement>;
  /** The ring over the focused specimen — the catalog's fixture rect; the product writes it through `ringRef`. */
  readonly ring?: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  } | null;
  readonly onBoardKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onBoardFocus?: (event: FocusEvent<HTMLDivElement>) => void;
  readonly onBoardBlur?: (event: FocusEvent<HTMLDivElement>) => void;
}

/** The listbox option's id for a specimen's type. */
export const specimenOptionId = (type: string): string =>
  `vf-pegboard-${type.replace(/[^\w-]/gu, "_")}`;

/** The filters' place as a style (their centre at `cx`) — lengths as CSS strings, so the controller can write it to the
 * element's own style as it is (a bare number written there is no length at all). */
export function filtersStyle(place: FiltersPlace | null | undefined): CSSProperties {
  if (place === null || place === undefined) return { opacity: 0, visibility: "hidden" };
  return {
    transform: `translate(${place.cx}px, ${place.y}px) translateX(-50%)`,
    maxWidth: `${place.maxWidth}px`,
    opacity: place.opacity,
    visibility: place.opacity > 0 ? "visible" : "hidden",
  };
}

/** Where more lies beyond a track that scrolls past its band: `start`, `end`, `both`, or nothing. */
export function moreOf(track: {
  readonly scrollLeft: number;
  readonly clientWidth: number;
  readonly scrollWidth: number;
}): "start" | "end" | "both" | null {
  const start = track.scrollLeft > 1;
  const end = track.scrollLeft + track.clientWidth < track.scrollWidth - 1;
  return start && end ? "both" : start ? "start" : end ? "end" : null;
}

/** The ring's place as a style: 2 out from the object, its 2px ring outside that (the focus ring's offset 2). */
export function ringStyle(
  rect:
    | { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
    | null
    | undefined,
): CSSProperties {
  if (rect === null || rect === undefined) return {};
  return {
    transform: `translate(${rect.x0 - 2}px, ${rect.y0 - 2}px)`,
    width: `${rect.x1 - rect.x0 + 4}px`,
    height: `${rect.y1 - rect.y0 + 4}px`,
  };
}

export function PegboardView({
  open,
  options,
  category,
  onCategory,
  place,
  filtersRef,
  specimens,
  focused,
  boardRef,
  ringRef,
  ring,
  onBoardKeyDown,
  onBoardFocus,
  onBoardBlur,
}: PegboardViewProps): ReactElement {
  boardStats.renders += 1;
  const active = specimens.some((s) => s.type === focused) ? focused : null;
  // past the band's width the filters scroll inside it, the end where more lies fading (the track's own measure)
  const trackRef = useRef<HTMLFieldSetElement | null>(null);
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track === null) return;
    const mark = (): void => {
      const more = moreOf(track);
      if (more === null) delete track.dataset["more"];
      else track.dataset["more"] = more;
    };
    mark();
    track.addEventListener("scroll", mark, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
    resize?.observe(track);
    return () => {
      track.removeEventListener("scroll", mark);
      resize?.disconnect();
    };
  }, []);
  return (
    <div className="vf-pegboard" data-open={open ? "true" : "false"} inert={!open}>
      <div ref={filtersRef} className="vf-pegboard-filters" style={filtersStyle(place)}>
        <SegmentedControl
          ref={trackRef}
          className="vf-pegboard-track"
          options={options}
          value={category}
          onChange={onCategory}
          label="Objects"
        />
      </div>
      {/* the board's keyboard stop: a listbox of the specimens the DESK draws (no native select can stand for them) */}
      <div
        ref={boardRef}
        className="vf-pegboard-board"
        role="listbox"
        aria-label="Objects on the pegboard"
        tabIndex={0}
        {...(active === null ? {} : { "aria-activedescendant": specimenOptionId(active) })}
        onKeyDown={onBoardKeyDown}
        onFocus={onBoardFocus}
        onBlur={onBoardBlur}
      >
        {specimens.map((s) => (
          <div
            key={s.type}
            id={specimenOptionId(s.type)}
            role="option"
            tabIndex={-1}
            aria-selected={s.type === active}
            data-type={s.type}
            className="vf-pegboard-option"
          >
            {s.label}
          </div>
        ))}
      </div>
      <div
        ref={ringRef}
        className="vf-pegboard-ring"
        aria-hidden="true"
        {...(ring === undefined || ring === null ? {} : { "data-shown": "true" })}
        style={ringStyle(ring)}
      />
    </div>
  );
}
