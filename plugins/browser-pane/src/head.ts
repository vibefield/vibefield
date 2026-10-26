// The HEAD's raster — what is engraved into the pane's head, as the pass reads it (BROWSER.md §4; the prototype's
// lab/browser-band.ts, its pure half). Pure: the service's KEY and its shape, what a raster depends on, the band ladder
// it is drawn at, and where its two halves' rows are. The drawing itself is the plugin's DOM half's (head-canvas.ts —
// Canvas 2D, lent as a keyed service, PT-1 ruling 8: the desk's `TextRaster` lays hand layouts to r8 alone, and the head
// is RGBA — the UI's sans and mono, ‹ › ↻ ✕, the lock, a colour favicon).
//
// The raster holds both: its upper half the engraving's coverage (alpha), its lower half the colour print
// (premultiplied), a two-texel gutter between — `engraveSplit` says where each half's rows are.

import {
  type LiveBrowserRefusal,
  type LiveBrowserStill,
  type LiveInfo,
  serviceKey,
} from "@vibefield/plugin-sdk/desk";
import { displayOf, isSecure } from "./address";
import { SAMPLE_URL } from "./ids";
import type { PaneShape } from "./law";
import type { HeadBitmap } from "./layout";
import type { NoticeBitmap, NoticeSpec } from "./notice";

/** What the head says. */
export interface HeadState {
  /** The address as it is cut ("" = none: the start page's prompt). */
  readonly display: string;
  readonly secure: boolean;
  /** The favicon on the capsule, by id (null: none): the sample's (`"sample"`), a page's own once its picture is decoded
   * (`faviconId(key)` — PT-4), or the GENERIC mark (`"generic"` — a page with none, or one whose picture cannot be read). */
  readonly favicon: string | null;
  readonly loading: boolean;
  readonly canBack: boolean;
  readonly canForward: boolean;
  /** The viewport, CSS px — the dev browser's size readout, set flush right. */
  readonly viewport: readonly [number, number];
  /** PT-5a — what the capsule says INSTEAD of its address, for a moment (a download refused): alone, no lock, no favicon. */
  readonly saying?: string;
  /** PT-5b — the pane shows a PHOTOGRAPH of its page (its last still), not the page: the capsule carries the rest mark. */
  readonly rest?: true;
}

/**
 * What a pane's head says, from its address and its shape: the address as printed, its lock, the sample's favicon on the
 * sample, and the viewport — a still page never loading, with no history. A LIVE page (PT-2) says its own words instead
 * (`info` — the host's `LiveInfo`, the producer's committed navigation truth): the address it is at (a redirect's, never the
 * one typed), its lock, loading while it loads, and how far back and forward its history reaches.
 */
export function headStateOf(
  url: string,
  S: PaneShape,
  info?: LiveInfo,
  /** PT-4: a live page's favicon id as the desk state answers it (`PaneLocal.icon`) — null: the host says nothing of one. */
  icon: string | null = null,
  /** PT-5a: what the capsule says instead of the address for a moment (`PaneLocal.saying`). */
  saying?: string,
  /** PT-5b: the page shown is its last still (`pageStill`) — the head carries the rest mark. */
  rest = false,
): HeadState {
  const at = info?.address ?? url;
  return {
    display: displayOf(at),
    secure: isSecure(at),
    favicon: info === undefined ? (url === SAMPLE_URL ? "sample" : null) : icon,
    loading: info?.loading !== undefined,
    canBack: info?.back === true,
    canForward: info?.forward === true,
    viewport: S.viewport,
    ...(saying === undefined ? {} : { saying }),
    ...(rest ? { rest: true as const } : {}),
  };
}

/** What the head says, for a moment, of something the page asked for and may not have (the SDK's `LiveBrowserRefusal`) —
 * a permission's own words are `PERMISSION_WORDS`'; this is a permission the pane has no word for. */
export const REFUSAL_WORDS: Readonly<Record<LiveBrowserRefusal["what"], string>> = {
  download: "Download blocked",
  permission: "Permission blocked",
};

/** BP-D1 (thinking-browser-profile.md, 2026-10-26) — a refused PERMISSION, said by what the page asked for (the host's
 * word: Chromium's own, `camera` and `microphone` for a media request). A desk's pages get none; the head says which. */
export const PERMISSION_WORDS: Readonly<Record<string, string>> = {
  camera: "Camera blocked",
  microphone: "Microphone blocked",
  geolocation: "Location blocked",
  notifications: "Notifications blocked",
  "clipboard-read": "Clipboard blocked",
  "clipboard-sanitized-write": "Clipboard blocked",
  "display-capture": "Screen sharing blocked",
  midi: "MIDI blocked",
  midiSysex: "MIDI blocked",
  pointerLock: "Pointer lock blocked",
  keyboardLock: "Keyboard lock blocked",
  fullscreen: "Full screen blocked",
  "window-management": "Window placement blocked",
  "idle-detection": "Idle detection blocked",
  "storage-access": "Cookie access blocked",
  "top-level-storage-access": "Cookie access blocked",
  "speaker-selection": "Speaker choice blocked",
  fileSystem: "File access blocked",
  hid: "Device access blocked",
  serial: "Device access blocked",
  usb: "Device access blocked",
  openExternal: "Opening an app blocked",
};

/** The words the head says for a refusal: a download's, or a permission's own (`PERMISSION_WORDS`, else the general). */
export function refusalWords(refusal: LiveBrowserRefusal): string {
  if (refusal.what === "download") return REFUSAL_WORDS.download;
  return Object.hasOwn(PERMISSION_WORDS, refusal.permission)
    ? (PERMISSION_WORDS[refusal.permission] ?? REFUSAL_WORDS.permission)
    : REFUSAL_WORDS.permission;
}

/** How long the head says it (ms). */
export const REFUSAL_SAY_MS = 2600;

/** A permission's word as the host carries it (`LiveSurfaceBrowserStateV1.refused.permission`'s shape). */
const PERMISSION_WORD = /^[a-z][A-Za-z-]{0,47}$/;

/** What the host's face says the page asked for and may not have (`info.extra.refused`), or undefined: nothing, or a word
 * this pane does not know. */
export function pageRefusal(info: LiveInfo | undefined): LiveBrowserRefusal | undefined {
  const said = info?.extra?.refused;
  if (typeof said !== "object" || said === null) return undefined;
  const { what, serial, permission } = said as {
    readonly what?: unknown;
    readonly serial?: unknown;
    readonly permission?: unknown;
  };
  if (typeof serial !== "number" || !Number.isSafeInteger(serial) || serial <= 0) return undefined;
  if (what === "download") return { what, serial };
  if (what === "permission" && typeof permission === "string" && PERMISSION_WORD.test(permission))
    return { what, permission, serial };
  return undefined;
}

/** PT-5d (M7 H10) — the page's DOCUMENT as the host's face says it (`info.extra.document`: its producer's count of the
 * documents it has committed), or undefined: the host counts none. */
export function pageDocument(info: LiveInfo | undefined): number | undefined {
  const said = info?.extra?.document;
  return typeof said === "number" && Number.isFinite(said) ? said : undefined;
}

/**
 * PT-5b — what the host's face says of its texture being a STILL (`info.extra.still` — the SDK's `LiveBrowserStill`): a
 * photograph of the page, when it was taken and how long ago — or undefined: the texture is the page's own frame (or the
 * host says nothing of stills). The pane draws a still as a photograph, never as the page.
 */
export function pageStill(info: LiveInfo | undefined): LiveBrowserStill | undefined {
  const said = info?.extra?.still;
  if (typeof said !== "object" || said === null) return undefined;
  const { takenAt, age } = said as Partial<LiveBrowserStill>;
  if (typeof takenAt !== "number" || !Number.isFinite(takenAt)) return undefined;
  return { takenAt, age: typeof age === "number" && age >= 0 ? age : 0 };
}

/** A page's favicon as the host's face says it (`LiveInfo.extra.favicon` — VibeField's contract): a key to compare, the
 * image's type, its bytes. */
export interface PageFavicon {
  readonly key: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

/** The id a head says a page's own favicon by. */
export const faviconId = (key: string): string => `icon:${key}`;
/** The id of the generic mark: a page with no favicon the head can print. */
export const GENERIC_FAVICON = "generic";

/**
 * What the host's face says of a page's favicon (`info.extra.favicon`): the favicon, `null` — the page has none — or
 * undefined: the host says nothing of favicons (a still's face, a host before PT-4), and the head prints no mark at all.
 */
export function pageFavicon(info: LiveInfo | undefined): PageFavicon | null | undefined {
  const said = info?.extra?.favicon;
  if (said === undefined) return undefined;
  if (typeof said !== "object" || said === null) return null;
  const { key, type, bytes } = said as Partial<PageFavicon>;
  return typeof key === "string" && typeof type === "string" && bytes instanceof Uint8Array
    ? { key, type, bytes }
    : null;
}

/** The head's raster as a service a host lends: the pane's head for what it says, drawn at `tpu` texels per world unit. */
export interface HeadRaster {
  raster(S: PaneShape, state: HeadState, tpu: number): HeadBitmap | undefined;
  /**
   * PT-4 — a page's favicon offered for printing: true once its picture is decoded (a head may say `faviconId(key)`);
   * false while it is being decoded — `ready` is called once it is — and for good when it cannot be read.
   */
  picture?(favicon: PageFavicon, ready: () => void): boolean;
  /**
   * PT-5a — a failed page's NOTICE (notice.ts): its words' light over black, opaque sRGB rgba8 rows from the top — PT-5b:
   * the words' BLOCK alone (where it lies on the page is the raster's to say: it measured the lines), at the spec's
   * scale. Undefined where the service cannot draw one — the page then carries no words.
   */
  notice?(spec: NoticeSpec): NoticeBitmap | undefined;
}

/**
 * THE SERVICE'S KEY (ICE K8a): the plugin's DOM half lends it (object.ts `host.lend`, head-canvas.ts) wherever the
 * platform's Canvas 2D is (the product's renderer); where none is lent (a Node still), the pass draws its committed
 * raster (head-still.ts).
 */
export const HEAD_RASTER = serviceKey<HeadRaster>("vibefield.browser-pane.head");

/** The most texels a head's raster may take along its long side. */
export const BAND_TEXELS_MAX = 4096;
/** Texel rows between the engraving and the print. */
export const GUTTER = 2;
/** The band ladder's ends, texels per world unit: a head is never drawn coarser or finer. */
export const BAND = { min: 0.5, max: 8 } as const;

/**
 * What a raster depends on — a new key is a new raster: its size in TEXELS (never the pane's world extent as a decimal: the
 * desk stores a size as f32, so 201.03 comes back 201.0299…, and a key spelt from it drifts across a rounding boundary —
 * the texels it rounds to do not), its band, and what it says.
 */
export const headKey = (S: PaneShape, st: HeadState, tpu: number): string => {
  const { width, half } = headSize(S, tpu);
  return [
    `${width}x${half}`,
    tpu,
    st.display,
    st.secure,
    st.favicon ?? "",
    st.loading,
    st.canBack,
    st.canForward,
    st.viewport.join("x"),
    // (only when it says something: the committed heads' keys stand as they were cut)
    ...(st.saying === undefined ? [] : [`say:${st.saying}`]),
    ...(st.rest === true ? ["rest"] : []),
  ].join("|");
};

/**
 * The band a zoom × dpr draws a head at, texels per world unit: the note's √2 ladder (the smallest step at or past the
 * screen's density), within the ladder's ends. Its exponent (in half-octaves) is the kind's RUNG.
 */
export function bandFor(zoomDpr: number): number {
  if (!(zoomDpr > 0) || !Number.isFinite(zoomDpr)) return BAND.min;
  const b = 2 ** (Math.ceil(2 * Math.log2(zoomDpr) - 1e-9) / 2);
  return Math.min(BAND.max, Math.max(BAND.min, b));
}

/** The rung of a zoom × dpr: the band's exponent in half-octaves (what the kind's `rung` answers). */
export const rungFor = (zoomDpr: number): number => Math.round(2 * Math.log2(bandFor(zoomDpr)));

/** The texels per world unit a head is drawn at: the band's, held under the texel cap. */
export const bandDensity = (S: PaneShape, band: number): number =>
  Math.min(band, BAND_TEXELS_MAX / (2 * S.half[0]));

/** A head raster's size at `tpu`: its width, each half's rows, its height. */
export function headSize(
  S: PaneShape,
  tpu: number,
): { readonly width: number; readonly half: number; readonly height: number } {
  const width = Math.max(1, Math.round(2 * S.half[0] * tpu));
  const half = Math.max(1, Math.round((S.band + S.half[1]) * tpu));
  return { width, half, height: half * 2 + GUTTER };
}

/** Where the two halves sit in a raster `height` texels tall: the engraving's rows [0, h), the print's from `at`. */
export const engraveSplit = (height: number): { readonly h: number; readonly at: number } => {
  const h = (height - GUTTER) / 2;
  return { h, at: h + GUTTER };
};
