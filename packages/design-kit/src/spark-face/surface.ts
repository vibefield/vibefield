import { useSyncExternalStore } from "react";
import type { SparkRgb } from "./engine";

// A framed face's cut ring takes the surface behind it (DESIGN.md §2.10): the chrome, the inset
// fill, a selected row, the mat's glass, a desk object's paper. Each is a token, so the face reads
// the colour where it sits — the first ground behind it that is mostly opaque — and reads it again
// when the theme turns.

const CHANNELS = /^(?:rgba?|color)\((?:srgb\s+)?([^)]*)\)$/u;

function channelsOf(colour: string): number[] | null {
  const found = CHANNELS.exec(colour.trim());
  if (!found?.[1]) return null;
  const parts = found[1]
    .split(/[\s,/]+/u)
    .filter(Boolean)
    .map((part) => (part.endsWith("%") ? Number.parseFloat(part) / 100 : Number(part)));
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
  // the rgb function speaks 0–255; color's srgb space speaks 0–1
  const scale = colour.trim().startsWith("color(") ? 1 : 255;
  const [r = 0, g = 0, b = 0, alpha = 1] = parts;
  return [r / scale, g / scale, b / scale, alpha];
}

/** The ground behind an element, as the engine takes a colour (0–1 per channel). */
export function surfaceBehind(element: Element | null): SparkRgb {
  for (let at = element; at; at = at.parentElement) {
    const channels = channelsOf(getComputedStyle(at).backgroundColor);
    if (channels && (channels[3] ?? 1) > 0.5)
      return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0];
  }
  // nothing opaque behind it: the page's own ground, light or dark
  const dark = element?.ownerDocument.documentElement.classList.contains("dark") ?? false;
  return dark ? [0, 0, 0] : [1, 1, 1];
}

// The theme turns by the root's class (theme.ts) or by the system's scheme under Auto.
let turns = 0;
const listeners = new Set<() => void>();
let watching: (() => void) | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!watching && typeof document !== "undefined") {
    const turn = (): void => {
      turns += 1;
      for (const each of listeners) each();
    };
    const roots = new MutationObserver(turn);
    roots.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const scheme =
      typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    scheme?.addEventListener("change", turn);
    watching = () => {
      roots.disconnect();
      scheme?.removeEventListener("change", turn);
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && watching) {
      watching();
      watching = undefined;
    }
  };
}

/** A count that moves each time the theme may have turned, so a face reads its ground again. */
export function useThemeTurns(): number {
  return useSyncExternalStore(
    subscribe,
    () => turns,
    () => 0,
  );
}
