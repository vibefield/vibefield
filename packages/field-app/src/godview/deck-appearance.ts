import { useSyncExternalStore } from "react";
import { getRendererLogger } from "../logging";

// The deck's appearance, and where GT-D12 says it belongs: with the VIEWER.
//
// 0.9.0's law is that a session carries terminal SEMANTICS while theme,
// background opacity and shaders are each viewer's own — this desktop tunes its
// glass, and GT-5's phone will render the same session through its own palette.
// That law is why this is NOT `config.ghostty`: the floor's configuration
// document is one field-native's, served to every viewer that attaches to it,
// so appearance kept there would follow a session onto the phone. The config
// document stays what GT-3 made it — the advanced per-device file — and this is
// a preference of the surface that draws.
//
// HOME: the renderer's own `localStorage`, beside the layout it decorates.
// The alternatives were read and refused, both for reasons already on the
// record. `storage.appPreferences.*` is `locality: "sync"` — its own panel says
// "these preferences live with your synced user settings" — so it would carry
// this device's glass to every other device, and it is a typed boolean
// preference schema besides; those are the two objections GT-D8's v0.3
// amendment already recorded when the same store refused the restore manifest.
// `storage.kv.*` is plugin-principal-only and self-scoped (plugin-registry
// §16.3), and spine UI is not a plugin principal. What is left is the store the
// viewer already owns, which is the one whose lifetime actually matches the
// thing being stored.
//
// It buys a structural property worth naming: localStorage reads are
// SYNCHRONOUS, so the first render already holds the saved opacity. There is no
// load to gate the workspace on and therefore no opaque-to-glass flash to
// prevent — unlike `defaultShell`/`initialCwd` at GT-2e, which cross an IPC and
// must be waited for.

/** The deck's own namespace, beside `vf-godview-deck-v1`. Deliberately not the
 * app's IPC channel prefix, which wall R6 reserves for contracts. */
const APPEARANCE_STORAGE_KEY = "vf-godview-appearance-v1";

export interface DeckAppearance {
  /** `GHOSTTY_COLOR_THEMES` entry names, or `null` for Godview's built-in
   * palette for that mode. Light and dark are intentionally independent: a
   * palette chosen to sit well on one surface should not be forced onto the
   * other when the viewer flips modes. */
  lightThemeName: string | null;
  darkThemeName: string | null;
  /** The terminal background's alpha, 0–1. The renderer applies it (0.9.0
   * premultiplies the theme background into its clear color), which is what
   * makes this true transparency rather than a composite. */
  opacity: number;
  /** Whether a cell's OWN background — the color a program painted — takes the
   * same alpha. Off by default: a program that paints a background usually
   * means it, and dissolving it hides output rather than framing it. */
  opacityCells: boolean;
}

export const DEFAULT_DECK_APPEARANCE: DeckAppearance = {
  lightThemeName: null,
  darkThemeName: null,
  opacity: 0.82,
  opacityCells: false,
};

export type DeckAppearanceMode = "light" | "dark";

/** The catalog choice active for a Godview color mode. Kept beside the schema
 * so every consumer — panel, renderer, and diagnostics — resolves it the same
 * way. */
export function deckThemeNameForMode(
  appearance: DeckAppearance,
  mode: DeckAppearanceMode,
): string | null {
  return mode === "dark" ? appearance.darkThemeName : appearance.lightThemeName;
}

function parsedThemeName(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Tolerant reader (design-00): anything unreadable is the default, and a
 * partly-readable record keeps the fields that parsed. A preference is never
 * worth failing a mount over. */
export function parseDeckAppearance(raw: string | null): DeckAppearance {
  if (raw === null || raw === "") return DEFAULT_DECK_APPEARANCE;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_DECK_APPEARANCE;
  }
  if (typeof value !== "object" || value === null) return DEFAULT_DECK_APPEARANCE;
  const record = value as Record<string, unknown>;
  const opacity = record.opacity;
  // `themeName` was the original single-selection schema. Seed BOTH new mode
  // slots from it so an upgrade preserves the user's existing choice; once
  // either new field is written, each mode evolves independently.
  const legacyThemeName = parsedThemeName(record.themeName);
  return {
    lightThemeName:
      "lightThemeName" in record ? parsedThemeName(record.lightThemeName) : legacyThemeName,
    darkThemeName:
      "darkThemeName" in record ? parsedThemeName(record.darkThemeName) : legacyThemeName,
    // Clamped rather than rejected: a value outside 0–1 is a version of this
    // file the writer got wrong, and the nearest legal opacity is a better
    // answer than reverting a user's whole appearance.
    opacity:
      typeof opacity === "number" && Number.isFinite(opacity)
        ? Math.min(1, Math.max(0, opacity))
        : DEFAULT_DECK_APPEARANCE.opacity,
    opacityCells: record.opacityCells === true,
  };
}

function read(): DeckAppearance {
  try {
    return parseDeckAppearance(localStorage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    // A page with no storage has no saved appearance, which is an answer.
    return DEFAULT_DECK_APPEARANCE;
  }
}

let current: DeckAppearance = read();
const listeners = new Set<() => void>();

export function getDeckAppearance(): DeckAppearance {
  return current;
}

export function subscribeDeckAppearance(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The one writer. Persist first, then announce: a listener that re-reads
 * storage must not see the old bytes, and a write that throws should not leave
 * subscribers believing something was saved. */
export function setDeckAppearance(next: DeckAppearance): void {
  current = next;
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
  } catch (cause) {
    getRendererLogger()
      .child({ component: "godview" })
      .error(
        "renderer.godview.appearance_save_failed",
        "The deck appearance could not be saved; it applies to this session only",
        cause,
      );
  }
  for (const fn of listeners) fn();
}

/** Read by BOTH the open deck and the Settings panel, which is what makes an
 * appearance change apply live: they are the same value, so a save re-renders
 * the deck's `theme` prop — and `theme` is not among the workspace's
 * initialization deps, so the panes re-theme without re-initializing. */
export function useDeckAppearance(): DeckAppearance {
  return useSyncExternalStore(subscribeDeckAppearance, getDeckAppearance, getDeckAppearance);
}

/** Test seam: drop the value and its subscribers between cases. */
export function resetDeckAppearanceForTest(): void {
  current = DEFAULT_DECK_APPEARANCE;
  listeners.clear();
  try {
    localStorage.removeItem(APPEARANCE_STORAGE_KEY);
  } catch {
    // Nothing to clear in a harness without storage.
  }
}
