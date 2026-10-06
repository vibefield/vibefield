import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  BAR,
  type BarPlace,
  growMenu,
  placeBar,
  placeHand,
  type ScreenBox,
  type ViewSize,
} from "./bar-geometry";
import type { HandCell } from "./bar-hand";
import type { BarCell, MenuRow } from "./bar-model";
import {
  barMotion,
  rowDelay,
  shownTransition,
  swapAt,
  TRAVEL_GRACE_MS,
  TRAVEL_MS,
  travelTransition,
} from "./bar-motion";
import { barStats } from "./bar-stats";
import { KindGlyph } from "./KindGlyph";
import "./selection-bar.css";

// THE SELECTION BAR (DK-11; DESIGN.md §8 "The selection bar", "The bar grown — More, and right-click"; MC-1, MC-2,
// MC-5, MC-D6; R1–R10, R20, R23 reversed, R25) — and THE TOOLS IN HAND (DK-12; §8 "Tools in hand"; MC-D4, MC-D9; R2,
// R13). Controller-free (UI_SYSTEM.md): this view owns the bar's DOM, its motion, its keyboard and its focus and takes
// plain data — the cells, the menu's rows, the eyebrow, the hand's cells — while `SelectionBar` reads the desk's doors
// and runs the acts. ONE element through every role (M1): the bar on the line's glass over a selection, the same piece
// grown into its solid menu by More or a right-click (MC-D6, FC-D14), and the same piece TRAVELLING into the hand when
// an object is picked up — to y 64 under the head over the anchor's `travelMs` (560, I20) on the island curve, its
// contents swapping by a 120 ms cross-fade over the travel's last 120 ms — and back the same way (R13).
//
// PLACED IMPERATIVELY (§8: "placed imperatively each time the anchor publishes — never a render per frame"): the
// controller calls `place(anchor)` on each publish and the view writes its own transform from its measured width
// — no React render. A render happens only when what the bar SAYS changes (the selection, its acts, its words, the
// hand's tools, the mode in hand, the kind's word). The transform places the bar's CENTRE (`translateX(-50%)`), so
// its width can change with its contents — the cross-fade's 120 ms — without it leaving its place.

/** What the bar is placed from: the anchor's box, its count and the view (ICE's `SelectionAnchor`, narrowed). */
export interface PlaceAnchor {
  readonly box: ScreenBox | null;
  readonly count: number;
  readonly view: ViewSize;
}

export interface SelectionBarHandle {
  /** Place the bar over the anchor: an imperative write of its place, never a render. `now: false` only
   * remembers it — the anchor whose publish changed what the bar says, placed once the bar has re-rendered. */
  place(anchor: PlaceAnchor, now?: boolean): void;
}

/** The bar's role: over a selection, or the tools in hand (§8). */
export type BarRole = "selection" | "hand";

export interface SelectionBarViewProps {
  readonly cells: readonly BarCell[];
  /** The grown menu's rows, nearest first, in their groups. */
  readonly groups: readonly (readonly MenuRow[])[];
  /** What the menu acts on, at its far end ("NOTE", "2 OBJECTS", "CLOCK · PLUGIN OFF"). */
  readonly eyebrow: string;
  /** A selection on screen to stand over — or an object in hand (false: the bar fades out, keeping what it said). */
  readonly shown: boolean;
  /** A gesture is on, or a note is being written — or, in hand, the object flies home: the bar steps aside (R8). */
  readonly stepAside: boolean;
  /** The bar grown into its menu — one of the frame's open surfaces (R5). */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** A cell pressed (every act but More, which grows the bar). */
  readonly onCell: (cell: BarCell) => void;
  /** A row taken. */
  readonly onRow: (row: MenuRow) => void;
  /** DK-12 — an object is in hand: the bar's role is the tools in hand under the head (else over the selection). */
  readonly held?: boolean;
  /** DK-12 — the tools in hand's cells (bar-hand.ts `handCells`). */
  readonly hand?: readonly HandCell[];
  /** DK-12 — the travel between the roles, ms: the anchor's `held.travelMs` (I20); the layer's 560 when it carries none. */
  readonly travelMs?: number;
  /** DK-12 — a tool used, or Done (the controller runs `ops.useHeldTool` / `ops.putDown`). */
  readonly onHand?: (cell: HandCell) => void;
  /** Reduced motion (M6, R8): every duration halved, fades only. */
  readonly reduced?: boolean;
  /** A plate's fixed place (the catalog): the view places itself from it. The product places imperatively. */
  readonly fixed?: PlaceAnchor;
  readonly handleRef?: Ref<SelectionBarHandle>;
}

/** The cells a key can reach — the buttons; the missing face's words and the rules are not stops. */
const focusable = (cell: BarCell): boolean => cell.kind !== "rule" && cell.kind !== "words";
/** In hand: the buttons — the readout and the rules are not stops. */
const handFocusable = (cell: HandCell): boolean => cell.kind !== "rule" && cell.kind !== "readout";

const cellKey = (cell: BarCell, index: number): string => {
  switch (cell.kind) {
    case "rule":
      return `rule-${cell.at}`;
    case "act":
      return `act-${cell.id}`;
    case "desk":
      return cell.act;
    default:
      return `${cell.kind}-${index}`;
  }
};

const handKey = (cell: HandCell, index: number): string => {
  switch (cell.kind) {
    case "rule":
      return `rule-${cell.at}`;
    case "tool":
      return `tool-${cell.id}`;
    default:
      return `${cell.kind}-${index}`;
  }
};

/** A reduced-motion role change, a fade only: out at the old place, then in at the new one. */
type SwapPhase = "none" | "out" | "in";

const NO_HAND: readonly HandCell[] = [];

export function SelectionBarView({
  cells,
  groups,
  eyebrow,
  shown,
  stepAside,
  open,
  onOpenChange,
  onCell,
  onRow,
  held = false,
  hand = NO_HAND,
  travelMs = TRAVEL_MS,
  onHand,
  reduced = false,
  fixed,
  handleRef,
}: SelectionBarViewProps): ReactElement {
  barStats.renders += 1;
  const role: BarRole = held ? "hand" : "selection";
  const motion = barMotion(reduced);
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const handRowRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  /** The bar's own row width, measured after each content change. */
  const widthRef = useRef(0);
  /** The tools in hand's row width, measured after each content change. */
  const handWidthRef = useRef(0);
  /** The list's natural height (rows, rules, eyebrow, padding), measured after each content change. */
  const listNatural = useRef(0);
  const lastAnchor = useRef<PlaceAnchor | null>(fixed ?? null);
  const placed = useRef<BarPlace | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  /** The role the bar is placed for — its target; the face below is what it SHOWS (they differ through a travel). */
  const roleRef = useRef<BarRole>(role);
  /** Opened from the keyboard: the hot row takes the focus as it shows. */
  const focusOnOpen = useRef(false);
  const [rover, setRover] = useState(0);
  const [handRover, setHandRover] = useState(0);
  const [hot, setHot] = useState<string | null>(null);

  // AWAY for a gesture and while a note is written (R8) — and, in hand, while the object flies home: out at once, back
  // `backMs` (200) after it ends
  const [away, setAway] = useState(stepAside);
  useEffect(() => {
    if (stepAside) {
      setAway(true);
      return;
    }
    const t = setTimeout(() => setAway(false), motion.backMs);
    return () => clearTimeout(t);
  }, [stepAside, motion.backMs]);

  // THE ROLE CHANGE (DK-12, M1, R13): what the bar SHOWS (`face`) follows its role at the travel's end
  const [face, setFace] = useState<BarRole>(role);
  const faceRef = useRef<BarRole>(role);
  const [traveling, setTraveling] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [swapPhase, setSwapPhase] = useState<SwapPhase>("none");
  const swapPhaseRef = useRef<SwapPhase>("none");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const visible = shown && !away && swapPhase !== "out";
  /** Whether the bar was SEEN as of the last render committed — what a role change travels from, or not. */
  const wasVisible = useRef(visible);
  const roleSeen = useRef(role);
  /** The tools in hand as last given — they stay on their row through the travel home and its cross-fade. */
  const lastHand = useRef(hand);
  if (hand.length > 0) lastHand.current = hand;
  const handShown = role === "hand" || face === "hand" || swapping ? lastHand.current : NO_HAND;

  /** The root's transitions: its opacity's (shown, away, out — or a reduced role change's fade), the travel's transform
   * while it travels, and the width's while the contents cross-fade. */
  const transitionOf = (
    phase: SwapPhase,
    travelOn: boolean,
    swapOn: boolean,
    shownNow: boolean,
    awayNow: boolean,
  ): string => {
    const parts = [
      phase === "out"
        ? `opacity ${motion.swapMs}ms ease-out, visibility 0s linear ${motion.swapMs}ms`
        : phase === "in"
          ? `opacity ${motion.swapMs}ms ease-out`
          : shownTransition(motion, !shownNow ? "out" : awayNow ? "away" : "in"),
    ];
    if (travelOn) parts.push(travelTransition(travelMs));
    if (swapOn) parts.push(`width ${motion.swapMs}ms ease`);
    return parts.join(", ");
  };

  /** The width of what the bar shows — its glass — written with its place. */
  const fit = useCallback((): void => {
    const root = rootRef.current;
    if (root === null) return;
    const w = faceRef.current === "hand" ? handWidthRef.current : widthRef.current;
    root.style.width = `${w}px`;
  }, []);

  /** THE GROW (R6, R20): the one element's material grows from the bar's own row — up, or down with the row
   * heading it — to the menu, which is placed from that row; written imperatively, as the place is. */
  const layoutGrow = useCallback((): void => {
    const root = rootRef.current;
    const at = placed.current;
    const anchor = lastAnchor.current;
    if (root === null) return;
    const set = (name: string, px: number): void => root.style.setProperty(name, `${px}px`);
    if (!openRef.current || at === null || anchor === null || roleRef.current !== "selection") {
      for (const name of [
        "--vf-bar-grow-l",
        "--vf-bar-grow-r",
        "--vf-bar-grow-t",
        "--vf-bar-grow-b",
      ])
        set(name, 0);
      return;
    }
    const w = widthRef.current;
    const g = growMenu({ x: at.x, y: at.y, width: w }, listNatural.current, anchor.view);
    const listOut = g.listHeight + 1; // the list and the strong hairline between it and the row
    set("--vf-bar-grow-l", at.x - g.x);
    set("--vf-bar-grow-r", g.x + g.width - (at.x + w));
    set("--vf-bar-grow-t", g.up ? listOut : 0);
    set("--vf-bar-grow-b", g.up ? 0 : listOut);
    set("--vf-bar-list-x", g.x - at.x);
    set("--vf-bar-list-w", g.width);
    set("--vf-bar-list-h", g.listHeight);
    root.dataset.dir = g.up ? "up" : "down";
    root.dataset.scroll = g.scroll ? "true" : "false";
  }, []);

  const place = useCallback(
    (anchor: PlaceAnchor, now = true): void => {
      lastAnchor.current = anchor;
      if (!now) return;
      const root = rootRef.current;
      const inHand = roleRef.current === "hand";
      const w = inHand ? handWidthRef.current : widthRef.current;
      const at = inHand ? placeHand(anchor.view, w) : placeBar(anchor, w);
      if (root === null || at === null) return;
      placed.current = at;
      // a reduced role change places at its swap point, unseen (a fade only): this anchor is remembered for it
      if (swapPhaseRef.current === "out") return;
      root.style.transform = `translate(${(at.x + w / 2).toFixed(1)}px, ${at.y.toFixed(1)}px) translateX(-50%)`;
      root.dataset.below = at.below ? "true" : "false";
      fit();
      barStats.placements += 1;
      if (openRef.current) layoutGrow();
    },
    [layoutGrow, fit],
  );
  useImperativeHandle(handleRef, () => ({ place }), [place]);

  const clearTimers = useCallback((): void => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // THE ROLE CHANGE — declared before the content's measure-and-place, so the travel's transition is on before the new
  // place is written (else the bar jumps). Seen, it TRAVELS: the transform over `travelMs` on the island curve, the face
  // changing at the travel's last 120 ms (the rows cross-fade and the glass's width follows), the transition off at the
  // end so a moving selection places instantly again. Reduced (M6): out over half the swap, the new place and face, in
  // over the other half. Unseen (the bar hidden as the hand came or went): the new face at once, placed where it stands.
  useLayoutEffect(() => {
    if (role === roleSeen.current) return;
    roleSeen.current = role;
    roleRef.current = role;
    clearTimers();
    const root = rootRef.current;
    const settle = (): void => {
      faceRef.current = role;
      setFace(role);
    };
    if (!wasVisible.current || root === null) {
      setTraveling(false);
      setSwapping(false);
      swapPhaseRef.current = "none";
      setSwapPhase("none");
      settle();
      return;
    }
    if (!motion.travels) {
      swapPhaseRef.current = "out";
      setSwapPhase("out");
      timers.current.push(
        setTimeout(() => {
          settle();
          swapPhaseRef.current = "in";
          setSwapPhase("in");
          const anchor = lastAnchor.current;
          if (anchor !== null) place(anchor);
          timers.current.push(
            setTimeout(() => {
              swapPhaseRef.current = "none";
              setSwapPhase("none");
            }, motion.swapMs),
          );
        }, motion.swapMs),
      );
      return;
    }
    root.style.transition = transitionOf("none", true, false, true, false);
    setTraveling(true);
    setSwapping(false);
    timers.current.push(
      setTimeout(
        () => {
          settle();
          setSwapping(true);
        },
        swapAt(motion, travelMs),
      ),
      setTimeout(() => {
        setTraveling(false);
        setSwapping(false);
      }, travelMs + TRAVEL_GRACE_MS),
    );
  }, [role]);

  // what was seen, for the next role change (after the role change has read it)
  useLayoutEffect(() => {
    wasVisible.current = visible;
  });

  // the face changed: the glass takes the width of what it now shows (over the cross-fade, while `swapping`)
  useLayoutEffect(() => {
    faceRef.current = face;
    fit();
  }, [face, fit]);

  // A content change: measure the rows and the list, then place from the last anchor — the publish that changed
  // the content placed nothing (the controller leaves it to this), so it is still one placement for one publish.
  useLayoutEffect(() => {
    widthRef.current = rowRef.current?.offsetWidth ?? 0;
    handWidthRef.current = handRowRef.current?.offsetWidth ?? 0;
    listNatural.current = listRef.current?.scrollHeight ?? 0;
    const anchor = fixed ?? lastAnchor.current;
    if (anchor !== null) place(anchor);
  }, [cells, handShown, groups, eyebrow, fixed, place]);

  // the grow follows `open`; the hot row is the nearest takeable one as it opens
  useLayoutEffect(() => {
    layoutGrow();
    if (!open) {
      setHot(null);
      return;
    }
    const nearest = groups.flat().find((row) => row.waits === undefined);
    setHot(nearest?.id ?? null);
  }, [open, groups, layoutGrow]);

  // keyboard-opened: the hot row takes the focus once it can
  useEffect(() => {
    if (!open || !focusOnOpen.current || hot === null) return;
    focusOnOpen.current = false;
    rowElement(hot)?.focus({ preventScroll: true });
  }, [open, hot]);

  /** A row's element by its id (no selector built from it). */
  const rowElement = (id: string): HTMLElement | undefined =>
    [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])].find(
      (el) => el.dataset.row === id,
    );

  /** The rows a key walks, nearest first — those that can be taken. */
  const takeable = useCallback(
    (): MenuRow[] => groups.flat().filter((row) => row.waits === undefined),
    [groups],
  );

  const walk = useCallback(
    (key: "ArrowUp" | "ArrowDown"): void => {
      const rows = takeable();
      if (rows.length === 0) return;
      const at = rows.findIndex((row) => row.id === hot);
      // grown up the list reads bottom-up, nearest first: ↑ walks AWAY from the bar there, toward it grown down
      const up = rootRef.current?.dataset.dir !== "down";
      const away = key === "ArrowUp" ? up : !up;
      const next = rows[at < 0 ? 0 : (at + (away ? 1 : rows.length - 1)) % rows.length];
      if (next === undefined) return;
      setHot(next.id);
      if (rootRef.current?.contains(document.activeElement))
        rowElement(next.id)?.focus({ preventScroll: true });
    },
    [hot, takeable],
  );

  const take = useCallback(
    (row: MenuRow): void => {
      if (row.waits !== undefined) return;
      onOpenChange(false);
      onRow(row);
    },
    [onOpenChange, onRow],
  );

  // OPEN: it closes on Esc — taken before the desk's Esc ladder (R5) — and on a press anywhere else; ↑ ↓ walk and
  // Return takes, wherever the focus is but a field being typed in (the desk's arrows never nudge under a menu)
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
    };
    const onKey = (event: globalThis.KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName));
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const inside = rootRef.current?.contains(document.activeElement) === true;
        onOpenChange(false);
        if (inside) moreRef.current?.focus({ preventScroll: true });
        return;
      }
      if (typing) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        event.stopImmediatePropagation();
        walk(event.key);
        return;
      }
      if (event.key === "Enter") {
        const row = takeable().find((r) => r.id === hot);
        if (row === undefined) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        take(row);
        if (rootRef.current?.contains(document.activeElement))
          moreRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpenChange, walk, take, takeable, hot]);

  // THE TOOLBAR'S KEYS (R9): ← → between its cells, Home End to its ends, Esc back to the desk, Enter and Space
  // run the cell — each taken from the desk's keymap (its arrows nudge, its ⏎ opens, its Esc climbs out). In hand the
  // tools in hand are a toolbar of their own, keyed the same way.
  const stops = cells.map((cell, index) => (focusable(cell) ? index : -1)).filter((i) => i >= 0);
  const rovingAt = stops.includes(rover) ? rover : (stops[0] ?? 0);
  const handStops = handShown
    .map((cell, index) => (handFocusable(cell) ? index : -1))
    .filter((i) => i >= 0);
  const handRovingAt = handStops.includes(handRover) ? handRover : (handStops[0] ?? 0);

  /** ← → Home End within one toolbar's stops. Answers true when the key was taken. */
  const roveKey = (
    event: KeyboardEvent<HTMLDivElement>,
    index: number,
    toolbarStops: readonly number[],
    toolbar: HTMLDivElement | null,
    setAt: (i: number) => void,
  ): boolean => {
    const at = toolbarStops.indexOf(index);
    const go = (to: number): void => {
      event.preventDefault();
      const next = toolbarStops[(to + toolbarStops.length) % toolbarStops.length];
      if (next === undefined) return;
      setAt(next);
      toolbar?.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus();
    };
    switch (event.key) {
      case "ArrowRight":
        go(at + 1);
        return true;
      case "ArrowLeft":
        go(at - 1);
        return true;
      case "Home":
        go(0);
        return true;
      case "End":
        go(toolbarStops.length - 1);
        return true;
      default:
        return false;
    }
  };

  const onToolbarKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const index = Number(target.dataset.cell);
    if (!Number.isFinite(index)) return;
    const cell = cells[index];
    if (roveKey(event, index, stops, rowRef.current, setRover)) return;
    switch (event.key) {
      case "Escape":
        if (open) return; // the open menu's own Esc (above) takes it first
        event.preventDefault();
        target.blur();
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (cell !== undefined) press(cell, true);
        return;
      case "ArrowUp":
      case "ArrowDown":
        event.preventDefault();
        if (cell?.kind === "desk" && cell.act === "more" && !open) {
          focusOnOpen.current = true;
          onOpenChange(true);
        }
        return;
    }
  };

  const onHandKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const index = Number(target.dataset.cell);
    if (!Number.isFinite(index)) return;
    const cell = handShown[index];
    if (roveKey(event, index, handStops, handRowRef.current, setHandRover)) return;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        target.blur();
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (cell !== undefined) runHand(cell);
        return;
    }
  };

  const press = (cell: BarCell, fromKeyboard: boolean): void => {
    if (cell.kind === "send" || cell.kind === "rule" || cell.kind === "words") return;
    if (cell.kind === "desk" && cell.act === "more") {
      focusOnOpen.current = fromKeyboard && !open;
      onOpenChange(!open);
      return;
    }
    if (open) onOpenChange(false);
    onCell(cell);
  };

  /** A tool used, or Done: never the waiting Send to…, a faint slot, a rule or the readout. */
  const runHand = (cell: HandCell): void => {
    if (cell.kind === "done" || (cell.kind === "tool" && cell.look !== "faint")) onHand?.(cell);
  };

  const cellNode = (cell: BarCell, index: number): ReactElement => {
    const stop = {
      "data-cell": index,
      tabIndex: index === rovingAt ? 0 : -1,
      onFocus: () => setRover(index),
    };
    switch (cell.kind) {
      case "rule":
        return <span key={cellKey(cell, index)} className="vf-bar-rule" aria-hidden="true" />;
      case "words":
        return (
          <span key={cellKey(cell, index)} className="vf-bar-words" data-bar-words="">
            {cell.label}
          </span>
        );
      case "send":
        return (
          <button
            key={cellKey(cell, index)}
            type="button"
            className="vf-bar-send"
            data-act="send"
            aria-disabled="true"
            title={cell.tip}
            {...stop}
          >
            <FieldGlyph name="agents" size={16} />
            <span>{cell.label}</span>
          </button>
        );
      case "act":
        return (
          <button
            key={cellKey(cell, index)}
            type="button"
            className={cell.glyph === undefined ? "vf-bar-cell vf-bar-cell--text" : "vf-bar-cell"}
            data-act={`act:${cell.id}`}
            aria-label={cell.label}
            title={cell.label}
            onClick={() => press(cell, false)}
            {...stop}
          >
            {cell.glyph === undefined ? (
              cell.label
            ) : (
              <KindGlyph glyph={cell.glyph} label={cell.label} />
            )}
          </button>
        );
      case "desk": {
        const more = cell.act === "more";
        return (
          <button
            key={cellKey(cell, index)}
            ref={more ? moreRef : undefined}
            type="button"
            className="vf-bar-cell"
            data-act={cell.act}
            aria-label={cell.label}
            title={cell.tip}
            {...(more ? { "aria-haspopup": "menu" as const, "aria-expanded": open } : {})}
            onClick={() => press(cell, false)}
            {...stop}
          >
            <FieldGlyph name={cell.glyph} size={16} />
          </button>
        );
      }
    }
  };

  // THE TOOLS IN HAND's cells (§8 "Tools in hand"): Send to… · rule · the kind's tools · the readout · rule · Done
  const handNode = (cell: HandCell, index: number): ReactElement => {
    const stop = {
      "data-cell": index,
      tabIndex: index === handRovingAt ? 0 : -1,
      onFocus: () => setHandRover(index),
    };
    switch (cell.kind) {
      case "rule":
        return <span key={handKey(cell, index)} className="vf-bar-rule" aria-hidden="true" />;
      case "send":
        return (
          <button
            key={handKey(cell, index)}
            type="button"
            className="vf-bar-send"
            data-act="send"
            aria-disabled="true"
            title={cell.tip}
            {...stop}
          >
            <FieldGlyph name="agents" size={16} />
            <span>{cell.label}</span>
          </button>
        );
      case "readout":
        return (
          <span key={handKey(cell, index)} className="vf-bar-readout" data-readout="">
            {cell.text}
          </span>
        );
      case "done":
        return (
          <button
            key={handKey(cell, index)}
            type="button"
            className="vf-bar-done"
            data-act="done"
            title={cell.tip}
            onClick={() => runHand(cell)}
            {...stop}
          >
            {cell.label}
          </button>
        );
      case "tool": {
        const mode = cell.look === "dot" || cell.look === "mode";
        const className =
          cell.look === "dot"
            ? "vf-bar-cell vf-bar-dot"
            : cell.glyph === undefined
              ? "vf-bar-cell vf-bar-cell--text"
              : "vf-bar-cell";
        return (
          <button
            key={handKey(cell, index)}
            type="button"
            className={className}
            data-tool={cell.id}
            data-look={cell.look}
            data-run={cell.run}
            {...(cell.gap ? { "data-gap": "" } : {})}
            {...(cell.on ? { "data-on": "" } : {})}
            aria-label={cell.label}
            title={cell.tip}
            {...(mode ? { "aria-pressed": cell.on } : {})}
            {...(cell.look === "faint" ? { "aria-disabled": true } : {})}
            {...(cell.swatch === undefined
              ? {}
              : { style: { "--vf-bar-swatch": cell.swatch } as CSSProperties })}
            onClick={() => runHand(cell)}
            {...stop}
          >
            {cell.look === "dot" ? (
              <span className="vf-bar-dot-ink" aria-hidden="true" />
            ) : cell.glyph === undefined ? (
              cell.label
            ) : (
              <KindGlyph glyph={cell.glyph} label={cell.label} />
            )}
          </button>
        );
      }
    }
  };

  // the list, nearest first in the DOM (it is read that way); grown up it stands bottom-up (column-reverse)
  let order = 0;
  const listNodes: ReactElement[] = [];
  groups.forEach((group, g) => {
    if (group.length === 0) return;
    if (listNodes.length > 0) listNodes.push(<hr key={`sep-${g}`} className="vf-bar-sep" />);
    for (const row of group) {
      const delay = rowDelay(motion, order);
      order += 1;
      listNodes.push(
        <button
          key={row.id}
          type="button"
          role="menuitem"
          className="vf-bar-item"
          data-row={row.id}
          {...(row.id === hot ? { "data-hot": "" } : {})}
          {...(row.danger === true ? { "data-danger": "" } : {})}
          {...(row.waits === undefined
            ? {}
            : { "aria-disabled": true, title: `${row.label} — ${row.waits}` })}
          tabIndex={-1}
          style={{ "--vf-bar-delay": `${delay}ms` } as CSSProperties}
          onPointerEnter={() => {
            if (row.waits === undefined) setHot(row.id);
          }}
          onClick={() => take(row)}
        >
          <span className="vf-bar-item-label">{row.label}</span>
          {row.key === undefined ? null : <span className="vf-bar-key">{row.key}</span>}
        </button>,
      );
    }
  });
  listNodes.push(
    <div
      key="eyebrow"
      className="vf-bar-eye"
      role="presentation"
      style={{ "--vf-bar-delay": `${rowDelay(motion, order)}ms` } as CSSProperties}
    >
      {eyebrow}
    </div>,
  );

  const rootStyle = {
    "--vf-bar-grow-ms": `${motion.growMs}ms`,
    "--vf-bar-fold-ms": `${motion.foldDelayMs}ms`,
    "--vf-bar-firm-ms": `${motion.firmMs}ms`,
    "--vf-bar-row-ms": `${motion.rowMs}ms`,
    "--vf-bar-out-ms": `${motion.contentOutMs}ms`,
    "--vf-bar-swap-ms": `${motion.swapMs}ms`,
    opacity: visible ? 1 : 0,
    visibility: visible ? "visible" : "hidden",
    transition: transitionOf(swapPhase, traveling, swapping, shown, away),
  } as CSSProperties;

  const selectionShown = face === "selection";
  return (
    <div
      ref={rootRef}
      className="vf-bar"
      data-selection-bar=""
      data-shown={visible ? "true" : "false"}
      data-motion={motion.grows ? "grow" : "fade"}
      data-role={role}
      data-face={face}
      {...(traveling ? { "data-traveling": "" } : {})}
      {...(open ? { "data-open": "" } : {})}
      style={rootStyle}
      inert={!visible}
    >
      <div className="vf-bar-glass" aria-hidden="true" />
      <div className="vf-bar-panel" aria-hidden="true">
        <span className="vf-bar-hairline" />
      </div>
      <div
        ref={listRef}
        className="vf-bar-list"
        role="menu"
        aria-label={`${eyebrow.charAt(0)}${eyebrow.slice(1).toLowerCase()}`}
        inert={!open}
      >
        {listNodes}
      </div>
      <div
        ref={rowRef}
        className="vf-bar-row"
        data-face-row="selection"
        role="toolbar"
        aria-label="Selection"
        aria-orientation="horizontal"
        {...(selectionShown ? {} : { "aria-hidden": true })}
        inert={!selectionShown}
        onKeyDown={onToolbarKey}
        style={{ height: BAR.height }}
      >
        {cells.map(cellNode)}
      </div>
      {handShown.length === 0 ? null : (
        <div
          ref={handRowRef}
          className="vf-bar-row vf-bar-row--hand"
          data-face-row="hand"
          role="toolbar"
          aria-label="Tools in hand"
          aria-orientation="horizontal"
          {...(selectionShown ? { "aria-hidden": true } : {})}
          inert={selectionShown}
          onKeyDown={onHandKey}
          style={{ height: BAR.height }}
        >
          {handShown.map(handNode)}
        </div>
      )}
    </div>
  );
}
