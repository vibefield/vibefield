import { useSyncExternalStore } from "react";

/**
 * THE LIGHT THE HAND STANDS IN (DESIGN.md §5 "the press", "The lamp, live"): which light the hand's cards are printed
 * for, by day or by night, and whether the print is on them yet, said on the root beside the prints themselves
 * (`use-printed-stock.ts` says it; `data-vf-card-print="ready"` is the stylesheet's own key). A held card's lamp reads
 * it, so the light that runs across a card as it turns is the light the card was printed in.
 */

const LIGHT = "data-vf-card-light";
const PRINT = "data-vf-card-print";

export interface PrintLight {
  /** the theme's light: the lamp by night, or by day */
  readonly night: boolean;
  /** the press has printed: the cards wear the print, and a lamp has something to light */
  readonly printed: boolean;
}

/** Say the light the hand stands in. */
export function markCardLight(root: HTMLElement, night: boolean): void {
  root.setAttribute(LIGHT, night ? "night" : "day");
}

/** Say whether the cards wear the print. */
export function markCardPrint(root: HTMLElement, printed: boolean): void {
  if (printed) root.setAttribute(PRINT, "ready");
  else root.removeAttribute(PRINT);
}

/** The root's two words as one, so a reader sees a change as a new value and no change as the same one. */
function read(): string {
  if (typeof document === "undefined") return "day";
  const root = document.documentElement;
  const light = root.getAttribute(LIGHT) === "night" ? "night" : "day";
  return root.getAttribute(PRINT) === "ready" ? `${light} ready` : light;
}

function listen(changed: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const watch = new MutationObserver(changed);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: [LIGHT, PRINT] });
  return () => watch.disconnect();
}

/** The light the hand stands in now, and whether its cards wear the print. */
export function usePrintLight(): PrintLight {
  const said = useSyncExternalStore(listen, read, () => "day");
  return { night: said.startsWith("night"), printed: said.endsWith("ready") };
}
