import { useEffect, useState } from "react";
import { useTheme } from "../../../theme";
import { HELD_SCALE } from "../CardsView";
import { type PrintSpec, printStock } from "./press";
import { CARD_DESIGN } from "./press-numbers";

/**
 * The hand's prints, put where every card can wear them (DESIGN.md §5 "the press"): the front and the back at the
 * window's pixel density, and again at a card picked up's 2.4×, for the theme's light, as four properties on the root,
 * with `data-vf-card-print="ready"` once the front has printed. They are printed after the window is idle and again only
 * when the theme or the pixel density changes. Until then, and where WebGL2 is refused, the cards wear the flat stock.
 */

const PROPS = {
  front: "--vf-card-print-front",
  back: "--vf-card-print-back",
  frontHeld: "--vf-card-print-front-held",
  backHeld: "--vf-card-print-back-held",
} as const;

const idle = (fn: () => void): (() => void) => {
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(fn, { timeout: 1500 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 200);
  return () => clearTimeout(id);
};

function useDensity(): number {
  const [density, setDensity] = useState(() =>
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(`(resolution: ${density}dppx)`);
    const moved = (): void => setDensity(window.devicePixelRatio || 1);
    query.addEventListener?.("change", moved);
    return () => query.removeEventListener?.("change", moved);
  }, [density]);
  return density;
}

export function usePrintedStock(): void {
  const { dark } = useTheme();
  const density = useDensity();
  useEffect(() => {
    let live = true;
    const spec = (side: PrintSpec["side"], scale: number): PrintSpec => ({
      side,
      width: CARD_DESIGN.width,
      height: CARD_DESIGN.height,
      density: density * scale,
      night: dark,
    });
    const cancel = idle(() => {
      void Promise.all([
        printStock(spec("front", 1)),
        printStock(spec("back", 1)),
        printStock(spec("front", HELD_SCALE)),
        printStock(spec("back", HELD_SCALE)),
      ]).then(([front, back, frontHeld, backHeld]) => {
        if (!live) return;
        const root = document.documentElement;
        const put = (name: string, url: string | null): void => {
          if (url === null) root.style.removeProperty(name);
          else root.style.setProperty(name, `url("${url}")`);
        };
        put(PROPS.front, front);
        put(PROPS.back, back);
        put(PROPS.frontHeld, frontHeld);
        put(PROPS.backHeld, backHeld);
        if (front === null) delete root.dataset.vfCardPrint;
        else root.dataset.vfCardPrint = "ready";
      });
    });
    return () => {
      live = false;
      cancel();
    };
  }, [dark, density]);
}
