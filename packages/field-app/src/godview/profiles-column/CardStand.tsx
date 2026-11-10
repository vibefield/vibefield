import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

// UM-R1 (DESIGN.md §8 "Where the cards stand") — A CARD'S STAND: the popover or the add's card, handed to the cards
// layer the stage holds beside itself (`.vf-monitor-cards`, z 13), because inside the stage no z-index can raise a card
// over the terminals (godview.css `.vf-monitor-chrome`). It stands 16 right of the pill with its top 6 above its item's,
// held between the layer's top and foot, and with no layer (the catalog, which has no terminals) it stands in place.
// React's enter and leave walk the fiber through a portal, so its item's hover and keys need no change to reach it.

/** §8: "16 right of the pill". */
const RIGHT_OF_PILL = 16;
/** §8: "its top 6 above the circle's (the pill's edge)". */
const ABOVE_ITEM = 6;

export interface CardPlacement {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
}

/** Where a card may stand in `layer`, in the layer's own pixels even while the cover scales the stage (the monitor's
 * `clientWidth || rect` idiom). The floor is the panes' foot and the ceiling y 64, both the layer's own box: a stand
 * taller than the room is held at the room's height and scrolls, its top at the room's top. */
function placeCard(
  layer: HTMLElement,
  stand: HTMLElement,
  anchor: HTMLElement,
): CardPlacement | null {
  const item = anchor.closest(".vf-profiles-item");
  const pill = item?.closest(".vf-profiles-column");
  if (!item || !pill) return null;
  const layerRect = layer.getBoundingClientRect();
  const width = layer.clientWidth || Math.round(layerRect.width);
  const height = layer.clientHeight || Math.round(layerRect.height);
  const sx = layerRect.width > 0 ? width / layerRect.width : 1;
  const sy = layerRect.height > 0 ? height / layerRect.height : 1;
  const left =
    Math.round((pill.getBoundingClientRect().right - layerRect.left) * sx) + RIGHT_OF_PILL;
  const natural = (item.getBoundingClientRect().top - layerRect.top) * sy - ABOVE_ITEM;
  const standHeight = stand.getBoundingClientRect().height * sy;
  return {
    left,
    top: Math.round(Math.max(0, Math.min(natural, height - standHeight))),
    maxWidth: Math.max(0, width - left - RIGHT_OF_PILL),
    maxHeight: height,
  };
}

const samePlacement = (a: CardPlacement | null, b: CardPlacement | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.maxWidth === b.maxWidth &&
    a.maxHeight === b.maxHeight);

export function CardStand({
  layer,
  profile,
  card,
  children,
}: {
  /** the stage's cards layer; absent, the card stands in place */
  layer: HTMLElement | null | undefined;
  /** the profile whose popover this holds */
  profile?: string;
  /** "add": the add's card */
  card?: "add";
  children: ReactNode;
}): ReactElement {
  const standRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<CardPlacement | null>(null);
  const place = useCallback((): void => {
    const stand = standRef.current;
    const anchor = anchorRef.current;
    if (!layer || !stand || !anchor) return;
    const next = placeCard(layer, stand, anchor);
    setPlacement((current) => (samePlacement(current, next) ? current : next));
  }, [layer]);
  // measured as it stands and whenever the column renders, before it paints
  useLayoutEffect(place);
  // the room moves with the window, the deck's foot and the card's own contents
  useEffect(() => {
    const stand = standRef.current;
    if (!layer || !stand || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(layer);
    observer.observe(stand);
    return () => observer.disconnect();
  }, [layer, place]);
  // UM-R-F (c4; §8 "Focus is pointing"): a card taken away while it holds the keyboard — a peek over it, after the
  // pointer's dwell — first hands the keyboard to its own circle, so the keyboard is never lost to the page and the
  // card it stood for comes back when the peek lets go. React runs a component's layout cleanup before it removes the
  // component's nodes, so the stand still holds the keyboard here. A deliberate close has handed it home already.
  useLayoutEffect(() => {
    const stand = standRef.current;
    // with no layer the stand is in its item, and there is no anchor
    const anchor = layer ? anchorRef.current : null;
    return () => {
      if (!stand?.contains(document.activeElement)) return;
      (anchor ?? stand)
        .closest(".vf-profiles-item")
        ?.querySelector<HTMLElement>(".vf-profiles-circle")
        ?.focus();
    };
  }, [layer]);
  const style: CSSProperties | undefined = placement === null ? undefined : placement;
  const stand = (
    <div
      ref={standRef}
      className="vf-profiles-stand"
      {...(profile !== undefined ? { "data-profile": profile } : {})}
      {...(card !== undefined ? { "data-card": card } : {})}
      style={style}
    >
      {children}
    </div>
  );
  if (!layer) return stand;
  return (
    <>
      <span ref={anchorRef} hidden />
      {createPortal(stand, layer)}
    </>
  );
}
