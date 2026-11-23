import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

// THE PARTS OF A COLUMN OF CIRCLES WHOSE CARDS STAND BESIDE IT (DESIGN.md §8 "Godview's profiles column"; since WL-1,
// 2026-11-23, "Godview's work column", its twin on the stage's right). Each column names its own nodes here, and which
// side of its pill its cards stand on, so one card stand (`CardStand`), one reach (`column-hold.ts`) and one set of
// keys serve both: the profiles column's behaviour, moved here unchanged, with the work column's cards mirrored.

/** How a column's own nodes are found: class names, never the other column's. */
export interface ColumnParts {
  /** the pill */
  readonly column: string;
  /** the circles' own list, which scrolls inside the pill */
  readonly list: string;
  /** a circle's item: its circle and, with no layer, its card's stand */
  readonly item: string;
  /** the circle, its item's control */
  readonly circle: string;
  /** a card's stand, in the cards layer or in place */
  readonly stand: string;
  /** where Tab may land in the column after a card (a selector) */
  readonly tabStops: string;
  /** which side of the pill a card stands on */
  readonly side: "right" | "left";
  /** the target an item or a stand stands for, read off its own data; none for a node that stands for none */
  readonly targetOf: (node: HTMLElement) => string | undefined;
}

/** A class name as a selector. */
export const dot = (name: string): string => `.${name}`;

/** The stand of what a column shows, in the cards layer or in place. Found by the stands' own data, as `CSS.escape`
 * is not ours to lean on under happy-dom. */
export function standOf(
  root: ParentNode | null | undefined,
  parts: ColumnParts,
  target: string,
): HTMLElement | null {
  for (const stand of root?.querySelectorAll<HTMLElement>(dot(parts.stand)) ?? []) {
    if (parts.targetOf(stand) === target) return stand;
  }
  return null;
}

/** The keyboard home when a deliberate act closes the card (§8 "Pinned"): if the card holds it, to its circle. The
 * timers never call this: a grace or a dwell is the pointer's, and the circle is a live toggle. */
export function handFocusHome(column: HTMLElement | null, parts: ColumnParts): void {
  const stand = document.activeElement?.closest<HTMLElement>(dot(parts.stand));
  const target = stand ? parts.targetOf(stand) : undefined;
  if (!column || target === undefined) return;
  for (const item of column.querySelectorAll<HTMLElement>(dot(parts.item))) {
    if (parts.targetOf(item) === target) {
      item.querySelector<HTMLElement>(dot(parts.circle))?.focus();
      return;
    }
  }
}

/** UM-R-F (c4; §8 "Focus is pointing"): whether the keyboard, going to `node`, stays with `target` — inside its item
 * (the circle, or the add's zone) or inside the stand that carries its card in the layer. */
export function keepsKeyboard(
  node: EventTarget | null,
  item: HTMLElement,
  target: string,
  parts: ColumnParts,
): boolean {
  if (!(node instanceof Element)) return false;
  if (item.contains(node)) return true;
  const stand = node.closest<HTMLElement>(dot(parts.stand));
  return stand !== null && parts.targetOf(stand) === target;
}

/** Tab across the portal (§8 "Pinned"): the card leaves the circle's DOM once it stands in the layer, so its Tab order
 * is carried by hand, forward from the circle onto the card's first control that can act, and back from that control.
 * Forward from its last control it goes on to the next stop in the column, as if the card stood after its circle
 * (UM-R-F, c4: focus shows a card, so Tab on every circle enters its card, and the window's order alone never reached
 * a second circle). Key events bubble through the portal to the circle's item, which holds this. No layer, the DOM's
 * own order holds. */
export function tabAcrossPortal(
  event: KeyboardEvent<HTMLElement>,
  layer: HTMLElement | null | undefined,
  target: string,
  parts: ColumnParts,
): void {
  if (event.key !== "Tab" || !layer) return;
  const stand = standOf(layer, parts, target);
  const controls = [...(stand?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
  const first = controls[0];
  const last = controls[controls.length - 1];
  const circle = event.currentTarget.querySelector<HTMLElement>(dot(parts.circle));
  if (!first || !last || !circle) return;
  if (!event.shiftKey && event.target === circle) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && event.target === first) {
    event.preventDefault();
    circle.focus();
  } else if (!event.shiftKey && event.target === last) {
    const column = circle.closest(dot(parts.column));
    const stops = [...(column?.querySelectorAll<HTMLElement>(parts.tabStops) ?? [])];
    const next = stops[stops.indexOf(circle) + 1];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }
}

/** The keys an open card takes where the keyboard is: Esc closes a card the keyboard shows (UM-R-F, c4; a pinned
 * card's Esc is the window's, which takes it first), and Tab crosses the portal. With no card open there is no
 * handler, so Esc passes on to whatever holds it. */
export function cardKeys(
  event: KeyboardEvent<HTMLElement>,
  layer: HTMLElement | null | undefined,
  target: string,
  pinned: boolean,
  onClose: () => void,
  parts: ColumnParts,
): void {
  if (event.key === "Escape") {
    if (pinned) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }
  tabAcrossPortal(event, layer, target, parts);
}

/** UM-R-F (c6; §8 "The pill", §4 `--vf-scroll-fade`): marks the circles' list `data-overflow` while it holds more than
 * its room, so the sheet gives it §4's fade. It is measured as the list would stand without the fade, whose 20 under
 * its end would otherwise keep a list that fits marked. In the stage only: the catalog's list never scrolls. The mark
 * is the DOM's own, set here and read by the sheet alone, so React never renders it.
 * It never changes the box to measure it (the review's F2): taking the mark off for a read laid the list out 16
 * shorter, and Chromium clamped a list scrolled to its end, which the mark's return did not undo. So the fade's extra
 * padding is read off instead: the list's own padding under its end, taken while it stands unmarked, against the
 * padding it wears marked. The mark moves only when the answer does. */
export function useOverflowMark(
  list: RefObject<HTMLDivElement | null>,
  measure: boolean,
  count: number,
): void {
  const unmarkedPadding = useRef<number | null>(null);
  const mark = useCallback((): void => {
    const node = list.current;
    if (!node) return;
    const marked = node.hasAttribute("data-overflow");
    const padding = Number.parseFloat(getComputedStyle(node).paddingBottom) || 0;
    if (!marked) unmarkedPadding.current = padding;
    const extra = marked ? Math.max(0, padding - (unmarkedPadding.current ?? padding)) : 0;
    const over = measure && node.scrollHeight - extra > node.clientHeight;
    if (over !== marked) node.toggleAttribute("data-overflow", over);
  }, [list, measure]);
  // measured as it stands and whenever a circle comes or goes, before it paints
  useLayoutEffect(() => {
    void count;
    mark();
  }, [mark, count]);
  // …and whenever its room moves, with the window, the deck's edge and the cover's scale
  useEffect(() => {
    const node = list.current;
    if (!measure || !node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(mark);
    observer.observe(node);
    return () => observer.disconnect();
  }, [list, measure, mark]);
}
