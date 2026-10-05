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
  type ScreenBox,
  type ViewSize,
} from "./bar-geometry";
import type { BarCell, MenuRow } from "./bar-model";
import { barMotion, rowDelay, shownTransition } from "./bar-motion";
import { barStats } from "./bar-stats";
import { KindGlyph } from "./KindGlyph";
import "./selection-bar.css";

// THE SELECTION BAR (DK-11; DESIGN.md §8 "The selection bar", "The bar grown — More, and right-click"; MC-1, MC-2,
// MC-5, MC-D6; R1–R10, R20, R23 reversed, R25). Controller-free (UI_SYSTEM.md): this view owns the bar's DOM, its
// motion, its keyboard and its focus and takes plain data — the cells, the menu's rows, the eyebrow — while
// `SelectionBar` reads the desk's doors and runs the acts. ONE element through every role (M1): the bar on the
// line's glass, and the same piece grown into its solid menu by More or a right-click (MC-D6, FC-D14).
//
// PLACED IMPERATIVELY (§8: "placed imperatively each time the anchor publishes — never a render per frame"): the
// controller calls `place(anchor)` on each publish and the view writes its own transform from its measured width
// — no React render. A render happens only when what the bar SAYS changes (the selection, its acts, its words).

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

export interface SelectionBarViewProps {
  readonly cells: readonly BarCell[];
  /** The grown menu's rows, nearest first, in their groups. */
  readonly groups: readonly (readonly MenuRow[])[];
  /** What the menu acts on, at its far end ("NOTE", "2 OBJECTS", "CLOCK · PLUGIN OFF"). */
  readonly eyebrow: string;
  /** A selection on screen to stand over (false: the bar fades out, keeping what it said). */
  readonly shown: boolean;
  /** A gesture is on, or a note is being written: the bar steps aside (R8). */
  readonly stepAside: boolean;
  /** The bar grown into its menu — one of the frame's open surfaces (R5). */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** A cell pressed (every act but More, which grows the bar). */
  readonly onCell: (cell: BarCell) => void;
  /** A row taken. */
  readonly onRow: (row: MenuRow) => void;
  /** Reduced motion (M6, R8): every duration halved, fades only. */
  readonly reduced?: boolean;
  /** A plate's fixed place (the catalog): the view places itself from it. The product places imperatively. */
  readonly fixed?: PlaceAnchor;
  readonly handleRef?: Ref<SelectionBarHandle>;
}

/** The cells a key can reach — the buttons; the missing face's words and the rules are not stops. */
const focusable = (cell: BarCell): boolean => cell.kind !== "rule" && cell.kind !== "words";

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
  reduced = false,
  fixed,
  handleRef,
}: SelectionBarViewProps): ReactElement {
  barStats.renders += 1;
  const motion = barMotion(reduced);
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  /** The bar's own row width, measured after each content change. */
  const widthRef = useRef(0);
  /** The list's natural height (rows, rules, eyebrow, padding), measured after each content change. */
  const listNatural = useRef(0);
  const lastAnchor = useRef<PlaceAnchor | null>(fixed ?? null);
  const placed = useRef<BarPlace | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  /** Opened from the keyboard: the hot row takes the focus as it shows. */
  const focusOnOpen = useRef(false);
  const [rover, setRover] = useState(0);
  const [hot, setHot] = useState<string | null>(null);

  // AWAY for a gesture and while a note is written (R8): out at once, back `backMs` after it ends
  const [away, setAway] = useState(stepAside);
  useEffect(() => {
    if (stepAside) {
      setAway(true);
      return;
    }
    const t = setTimeout(() => setAway(false), motion.backMs);
    return () => clearTimeout(t);
  }, [stepAside, motion.backMs]);
  const visible = shown && !away;

  /** THE GROW (R6, R20): the one element's material grows from the bar's own row — up, or down with the row
   * heading it — to the menu, which is placed from that row; written imperatively, as the place is. */
  const layoutGrow = useCallback((): void => {
    const root = rootRef.current;
    const at = placed.current;
    const anchor = lastAnchor.current;
    if (root === null) return;
    const set = (name: string, px: number): void => root.style.setProperty(name, `${px}px`);
    if (!openRef.current || at === null || anchor === null) {
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
      const at = placeBar(anchor, widthRef.current);
      if (root === null || at === null) return;
      placed.current = at;
      root.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
      root.dataset.below = at.below ? "true" : "false";
      barStats.placements += 1;
      if (openRef.current) layoutGrow();
    },
    [layoutGrow],
  );
  useImperativeHandle(handleRef, () => ({ place }), [place]);

  // A content change: measure the row and the list, then place from the last anchor — the publish that changed
  // the content placed nothing (the controller leaves it to this), so it is still one placement for one publish.
  useLayoutEffect(() => {
    widthRef.current = rowRef.current?.offsetWidth ?? 0;
    listNatural.current = listRef.current?.scrollHeight ?? 0;
    const anchor = fixed ?? lastAnchor.current;
    if (anchor !== null) place(anchor);
  }, [cells, groups, eyebrow, fixed, place]);

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
  // run the cell — each taken from the desk's keymap (its arrows nudge, its ⏎ opens, its Esc climbs out).
  const stops = cells.map((cell, index) => (focusable(cell) ? index : -1)).filter((i) => i >= 0);
  const rovingAt = stops.includes(rover) ? rover : (stops[0] ?? 0);
  const onToolbarKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const index = Number(target.dataset.cell);
    if (!Number.isFinite(index)) return;
    const cell = cells[index];
    const at = stops.indexOf(index);
    const go = (to: number): void => {
      event.preventDefault();
      const next = stops[(to + stops.length) % stops.length];
      if (next === undefined) return;
      setRover(next);
      rowRef.current?.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus();
    };
    switch (event.key) {
      case "ArrowRight":
        go(at + 1);
        return;
      case "ArrowLeft":
        go(at - 1);
        return;
      case "Home":
        go(0);
        return;
      case "End":
        go(stops.length - 1);
        return;
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
    opacity: visible ? 1 : 0,
    visibility: visible ? "visible" : "hidden",
    transition: shownTransition(motion, !shown ? "out" : away ? "away" : "in"),
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className="vf-bar"
      data-selection-bar=""
      data-shown={visible ? "true" : "false"}
      data-motion={motion.grows ? "grow" : "fade"}
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
        role="toolbar"
        aria-label="Selection"
        aria-orientation="horizontal"
        onKeyDown={onToolbarKey}
        style={{ height: BAR.height }}
      >
        {cells.map(cellNode)}
      </div>
    </div>
  );
}
