import type { ViewKeys } from "./views";

// THE ZOOM'S ACTS (One Frame §6, FC-D8; DESIGN.md §8 "The head", §10; DK-D24's
// keys): what the readout's menu lists, what the palette's zoom rows run, and
// what ⌘+ ⌘− ⌘0 ⇧1 press — one table, so the three doors to an act can never
// name it, key it or do it two ways.

export type ZoomAct = "in" | "out" | "fit" | "actual";

export interface ZoomActEntry {
  readonly act: ZoomAct;
  readonly name: string;
}

/** In the menu's order. */
export const ZOOM_ACTS: readonly ZoomActEntry[] = [
  { act: "in", name: "Zoom in" },
  { act: "out", name: "Zoom out" },
  { act: "fit", name: "Zoom to fit" },
  { act: "actual", name: "Actual size" },
];

/** In and out step by this, as the old − + did (and out is its inverse, 0.8). */
export const ZOOM_STEP = 1.25;

const MAC_KEYS: Readonly<Record<ZoomAct, string>> = {
  in: "⌘+",
  out: "⌘−",
  fit: "⇧1",
  actual: "⌘0",
};

const OTHER_KEYS: Readonly<Record<ZoomAct, string>> = {
  in: "Ctrl+Plus",
  out: "Ctrl+Minus",
  fit: "Shift+1",
  actual: "Ctrl+0",
};

/** The key as a menu row, the palette and a tooltip say it (never printed as
 * a cap — FR-5). */
export function zoomKeyLabel(act: ZoomAct, keys: ViewKeys): string {
  return (keys === "mac" ? MAC_KEYS : OTHER_KEYS)[act];
}

type ZoomKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> &
  Partial<Pick<KeyboardEvent, "code">>;

/** The act a key presses, or null. ⌘ on the Mac and Ctrl elsewhere, never
 * both (views.ts's rule). Punctuation by the character it types — ⌘= on a
 * US board, a layout that puts + on its own key, the keypad's + and − — and
 * the digits by the physical key first (`Digit0`, `Digit1`), so a layout that
 * types something else on the digit row still presses them. */
export function zoomActForKey(event: ZoomKey, keys: ViewKeys): ZoomAct | null {
  if (event.altKey) return null;
  const command =
    keys === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const code = event.code ?? "";
  if (command) {
    if (event.key === "+" || event.key === "=") return "in";
    if (event.shiftKey) return null;
    if (event.key === "-") return "out";
    if (code === "Digit0" || event.key === "0") return "actual";
    return null;
  }
  if (event.metaKey || event.ctrlKey || !event.shiftKey) return null;
  return code === "Digit1" || event.key === "!" ? "fit" : null;
}

/** The zoom band the canvas allows — the ENGINE's (`settings.zoom` → `CameraLimits`): on the desk the
 * scale-free band, ICE's `ZOOM_MIN`…`ZOOM_MAX` (1e-8…1e8) — never a constant of the head's (DK-3,
 * ruling 5: the 0.25–3 clamp was a DOM card's tuning and left with it). */
export interface ZoomBounds {
  readonly min: number;
  readonly max: number;
}

/** What the zoom's acts move: the canvas's camera (the head's canvas door). */
export interface ZoomTarget {
  zoom(): number;
  zoomTo(zoom: number): void;
  zoomToFit(): void;
  /** The engine's band; absent, the camera's own clamp is the only one. */
  bounds?(): ZoomBounds;
}

const clampTo = (zoom: number, bounds: ZoomBounds | undefined): number =>
  bounds === undefined ? zoom : Math.min(bounds.max, Math.max(bounds.min, zoom));

export function runZoom(target: ZoomTarget, act: ZoomAct): void {
  const bounds = target.bounds?.();
  switch (act) {
    case "in":
      target.zoomTo(clampTo(target.zoom() * ZOOM_STEP, bounds));
      return;
    case "out":
      target.zoomTo(clampTo(target.zoom() / ZOOM_STEP, bounds));
      return;
    case "fit":
      target.zoomToFit();
      return;
    case "actual":
      target.zoomTo(clampTo(1, bounds));
  }
}

/** Whether an act can move the camera at all: in at the band's top, out at its foot, cannot. */
export function zoomActAvailable(
  act: ZoomAct,
  zoom: number,
  bounds: ZoomBounds | undefined,
): boolean {
  if (bounds === undefined) return true;
  if (act === "in") return zoom < bounds.max;
  if (act === "out") return zoom > bounds.min;
  return true;
}

/** The zoom as the readout's ONE number, a percent — whatever the band allows (ruling 5): whole from
 * 10%, a tenth below it, two significant figures under 1% — so a scale-free desk never reads 0%. */
export function zoomPercent(zoom: number): number {
  const percent = zoom * 100;
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  if (percent >= 10) return Math.round(percent);
  if (percent >= 1) return Math.round(percent * 10) / 10;
  return Number(percent.toPrecision(2));
}

const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20, useGrouping: true });

/** The readout's number as it is printed: thousands grouped, never an exponent ("10,000,000,000"). */
export function formatZoomPercent(percent: number): string {
  return GROUPED.format(percent);
}
