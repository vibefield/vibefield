// What a pane is CUT to (BROWSER.md §2) — pure, no import: the manifest's emit (plain Node, before any bundle exists)
// and the law read the same numbers. A browser on the desk is a pane of glass cut to its page, and the page is its CSS
// viewport at its DEVICE's density: the desk is physical at the note's scale (200 world units = 3″), so a pane is the
// true size of the screen it stands for — a laptop's page is 26 cm across, a phone's is the phone's own display.
//
// `Size` IS THE TRUTH (PT-1 ruling 5): the object's extent is what the desk holds, resizes and saves; the viewport is
// DERIVED from it — the page's extent inside the outline over the device's density, in whole CSS px, never under
// 320 × 240. A device switch rewrites `Size` in the same transaction (the density changes with the device).

/** World units per millimetre: the desk's scale is the note's — a 200-unit note is a 3″ (76.2 mm) square. */
export const MM = 200 / 76.2;

/** A viewport a pane can be cut to: the page's CSS size, the device's pixel ratio and density, whether it is a phone's or a tablet's. */
export interface Device {
  readonly id: DeviceId;
  readonly name: string;
  /** The device's own viewport, CSS px — what a pane switched to it is cut to. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** Millimetres per CSS px — the device's own (its display's width over its CSS width). */
  readonly density: number;
  readonly mobile: boolean;
  readonly touch: boolean;
  /** The user agent it announces (null = the engine's own); `platform` for its client hints (PT-4's emulation). */
  readonly ua: string | null;
  readonly platform: string | null;
}

export const DEVICE_IDS = ["laptop", "desktop", "tablet", "phone"] as const;
export type DeviceId = (typeof DEVICE_IDS)[number];

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

/** The iPhone 17 Pro's display, mm across — the phone catalog's, the one number of it the pane keeps. */
export const IPHONE_17_PRO_DISPLAY_MM = 66.592;

/**
 * The device modes (the dev browser's, thinking-browser-widget §3 BW-4), each at its own density: a laptop's 0.200 mm
 * per CSS px (MacBook Pro 14″: 3024 px @ 254 ppi over 1512), a desktop's 0.233 (Studio Display: 5120 @ 218 over 2560),
 * an iPad Air 11″'s 0.192 (1640 @ 264 over 820), an iPhone 17 Pro's 0.166 (its 66.59 mm display over 402 pt) — so a pane
 * cut to a phone is a phone's size on the desk.
 */
export const DEVICES: readonly Device[] = [
  {
    id: "laptop",
    name: "Laptop",
    width: 1280,
    height: 800,
    dpr: 2,
    density: 0.2,
    mobile: false,
    touch: false,
    ua: null,
    platform: null,
  },
  {
    id: "desktop",
    name: "Desktop",
    width: 1440,
    height: 900,
    dpr: 2,
    density: 0.233,
    mobile: false,
    touch: false,
    ua: null,
    platform: null,
  },
  {
    id: "tablet",
    name: "iPad Air 11″",
    width: 820,
    height: 1180,
    dpr: 2,
    density: 0.1924,
    mobile: true,
    touch: true,
    ua: IPAD_UA,
    platform: "iPadOS",
  },
  {
    id: "phone",
    name: "iPhone 17 Pro",
    width: 402,
    height: 874,
    dpr: 3,
    density: IPHONE_17_PRO_DISPLAY_MM / 402,
    mobile: true,
    touch: true,
    ua: IPHONE_UA,
    platform: "iOS",
  },
];
export const deviceById = (id: string): Device | undefined => DEVICES.find((d) => d.id === id);
export const DEFAULT_DEVICE: Device = DEVICES[0] as Device;
/** A prop's device, or the default (laptop) for one the pane does not know. */
export const deviceOf = (id: unknown): Device =>
  (typeof id === "string" ? deviceById(id) : undefined) ?? DEFAULT_DEVICE;

/**
 * The pane, in millimetres: the slab's thickness; the clear BORDER round the page (sides and foot); the HEAD's height —
 * the wider clear border at the top where the chrome is engraved (the page starts under it); the outline's corner (the
 * page's is concentric: corner − border); the polished arris where the top face rolls into the wall (its width inward
 * and its fall).
 */
export const PANE_MM = { thick: 6, border: 5, band: 11, corner: 7, rim: [2.4, 2.4] } as const;

/** The smallest viewport a pane is cut to, CSS px (a resize never asks for less). */
export const MIN_VIEWPORT = [320, 240] as const;

/** Round to the hundredth of a world unit — a size as a document holds it (a new pane's, a device switch's). */
export const hundredth = (v: number): number => Math.round(v * 100) / 100;

/** The pane's outline for a viewport at a device's density — its `Size`, world units: the page, the border round it, the head. */
export function sizeOf(
  viewport: readonly [number, number],
  device: Device = DEFAULT_DEVICE,
): { readonly w: number; readonly h: number } {
  return {
    w: (viewport[0] * device.density + 2 * PANE_MM.border) * MM,
    h: (viewport[1] * device.density + PANE_MM.border + PANE_MM.band) * MM,
  };
}

/** A device's own cut — its viewport at its density — as a document writes it (to the hundredth): a new pane's size, a device switch's. */
export function cutOf(device: Device = DEFAULT_DEVICE): { readonly w: number; readonly h: number } {
  const s = sizeOf([device.width, device.height], device);
  return { w: hundredth(s.w), h: hundredth(s.h) };
}

/**
 * The viewport a `Size` cuts at a device's density: the page's extent inside the outline (the border each side, the
 * border at the foot and the head at the top) over the density, in WHOLE CSS px, never under `MIN_VIEWPORT`.
 */
export function viewportOf(
  size: { readonly w: number; readonly h: number },
  device: Device = DEFAULT_DEVICE,
): readonly [number, number] {
  const scale = device.density * MM;
  const pw = size.w - 2 * PANE_MM.border * MM;
  const ph = size.h - (PANE_MM.border + PANE_MM.band) * MM;
  return [
    Math.max(Math.round(pw / scale), MIN_VIEWPORT[0]),
    Math.max(Math.round(ph / scale), MIN_VIEWPORT[1]),
  ];
}

/** A new pane's size: a laptop's page, 1280 × 800 — 266 × 176 mm of glass. */
export const PANE_SIZE = cutOf(DEFAULT_DEVICE);

/** The smallest a pane is resized to: the smallest viewport at the finest density (a phone's) — coarser devices floor their viewport instead. */
export const PANE_MIN_SIZE = (() => {
  const finest = DEVICES.reduce((a, d) => (d.density < a.density ? d : a), DEFAULT_DEVICE);
  const s = sizeOf(MIN_VIEWPORT, finest);
  // up a hundredth, so the floor's own viewport survives the rounding
  return { w: hundredth(s.w + 0.01), h: hundredth(s.h + 0.01) };
})();
