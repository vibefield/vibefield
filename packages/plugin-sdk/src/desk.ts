// @vibefield/plugin-sdk/desk — THE OBJECT DOOR (DK-6; spec §12.8): everything a plugin's object
// KIND is written against, re-exported from the umbrella's PUBLISHED entries and from nowhere else
// (ICE design-016 K-L1 — the SDK is a plugin's only door onto ICE; K-L2 — a plugin kind compiles
// exactly as one of ICE's six built-ins does, from these same names):
//
//  - `@vibecook/ice/desk/kit`, WHOLE — the render kit a kind's pass is written against: the slot's
//    view and its mat (`MatPass`), the lamp and its light, the kit's WGSL by name (`kitWgsl`), a
//    container's inside, the finishes, the service keys a kind is lent (`TEXT_RASTER`,
//    `PICTURE_DECODER`, `BLOB_STORE`, `serviceKey`/`service`), and since PT-2 the LIVE FACE a kind
//    reads (ICE design-019: `LIVE`, `LiveFace` and its words, `LiveTexture`, `liveDepth`,
//    `createSight`). The live face's HOST half — `createLiveTexture` (the writer a host fills on the
//    desk's device) and `stillLive` (a still host's source of committed bytes) — is not in the kit
//    since ICE `0.16.0-portals.4` (I51: it lives on `@vibecook/ice/desk`, the host's entry), so this
//    door hands it to no one without a word of its own: a kind SAMPLES the texture its host's `LIVE`
//    service fills and never makes one (PA-22).
//  - `@vibecook/ice/desk/engine` — the raw-WebGPU engine a pass is built with (`compose`/`compile`,
//    pipelines, `defineStruct`, targets), LESS device acquisition (`acquire`/`adopt`): a kind draws
//    on the HOST's one device, handed to its `create` (DK-D22 — a plugin gets no device of its own).
//  - `@vibecook/ice/desk`, CURATED — the kind contract (`ObjectKind`, `KindProgram`, `KindPass`, the
//    world half's contexts), the placement keys (`DESK_OBJECT`, `CONTAINABLE`, `PINNABLE`), the record
//    store, the theme's types and `rgb` (with `MISSING_INK`, what it answers for a colour it cannot
//    read — I32), the fault ladder's constants. Never the host half: no
//    `deskLayer`, no renderer, no profiler — those are the app's.
//  - `@vibecook/ice` — the core types a kind's acts and tray entry speak: `HeldToolDef`,
//    `MenuActionDef` and their APIs, `HeldGlyph`, `TrayEntry` (`hang` required), `Entity`, `World`;
//    and the two core names a kind's DOM HALF reads (DK-8 — VibeField's comment pad, the first plugin
//    kind with a text part), exactly as ICE's own halves read them (the note's body, the calendar's
//    line): `Camera` — the resource that says where the desk's one editor stands on screen (read,
//    never written) — and `Active` — the tag that says its object is still in the frame (a nav cut
//    ends the lease). Nothing else of core's: a kind writes its document through `writable(docs)`.
//
// NOTHING of `@vibecook/ice/desk/objects`: a plugin never imports a built-in kind (K-L4 — a kind
// names another only by its registry name, through `KindDriverHost.kind(name)`/`provides(key)`).
// `test/desk-door.test.ts` holds this file to that, and to the published entries alone.
//
// The plugin's bundle leaves this module EXTERNAL (`@vibefield/plugin-sdk` and its subpaths are host
// singletons, PA-29): at load the host's import map binds it to the app's own copy, so a plugin kind
// runs on the host's one ICE — one loro, one strata, one catalog.

import type { MenuActionDef } from "@vibecook/ice";
import type { DriverFactory, ObjectDef, ObjectHost, ObjectKind } from "@vibecook/ice/desk";
import { type LiveInfo, serviceKey } from "@vibecook/ice/desk/kit";

export type {
  Entity,
  HeldGlyph,
  HeldToolApi,
  HeldToolDef,
  HeldToolState,
  HeldToolStateContext,
  MenuActionApi,
  MenuActionDef,
  TrayEntry,
  World,
} from "@vibecook/ice";
export { Active, Camera } from "@vibecook/ice";
export {
  CONTAINABLE,
  type ColourParse,
  createRecordStore,
  cssColor,
  type DataChildren,
  DESK_OBJECT,
  type DriverFactory,
  defineObject,
  driversOf,
  FLUX_REST,
  type HeldContext,
  type HeldCursorContext,
  type HeldEvent,
  type HeldReadoutContext,
  hostOf,
  type InsideContext,
  isObjectKind,
  KIND_MISSING,
  KIND_STRIKES,
  type KindDriver,
  type KindDriverHost,
  type KindExtra,
  type KindFault,
  type KindHost,
  type KindLocal,
  type KindPalette,
  type KindPass,
  type KindProgram,
  kindPalette,
  MISSING_INK,
  NO_DOCS,
  numberProp,
  type ObjectContext,
  type ObjectDef,
  type ObjectDomHost,
  type ObjectFlux,
  type ObjectHit,
  type ObjectHost,
  type ObjectKind,
  type ObjectRect,
  type OpenBinding,
  objectKindOf,
  type Palette,
  PINNABLE,
  type RecordStore,
  type RecordStoreStats,
  type RGB,
  type RGBA,
  type RungContext,
  rectFrame,
  rectOf,
  rgb,
  type SlotContext,
  type StratumName,
  stringProp,
  type ThemeName,
  type TokenRef,
  type TypingDocs,
  type WritableSession,
  writable,
  ZOOM_MAX,
  ZOOM_MIN,
} from "@vibecook/ice/desk";
export {
  type BindEntry,
  type BindKind,
  BLEND_OVER,
  beginPass,
  bindGroup,
  bindLayout,
  type Clear,
  type ComposedShader,
  type ComposeOptions,
  compile,
  compose,
  defineStruct,
  type FieldSlot,
  type FieldType,
  type FieldValue,
  type RenderPipelineOptions,
  readback,
  renderPipeline,
  type ShaderPart,
  type StructBuffer,
  type StructDef,
  type StructValues,
  storageBuffer,
  Target,
  type TargetOptions,
  uniformBuffer,
  type Visibility,
} from "@vibecook/ice/desk/engine";
export * from "@vibecook/ice/desk/kit";

// docs:begin live-browser-spec
/**
 * THE PAGE A BROWSER FACE OPENS (PT-2) — the `spec` a browser kind hands the host's `LIVE` service (`LiveSources.open(key, spec,
 * arrived)`, ICE design-019 §3.2: the HOST's contract, which the desk never reads), typed here so the plugin and the host agree:
 * the address (the host's browser policy decides what loads), the page's CSS viewport (the kind's own, from its size) and the
 * device px each CSS px is drawn at (its device's own ratio — the page is laid out at the viewport and rastered at the two
 * multiplied), its colour scheme, and the label the host's surface wears.
 */
export interface LiveBrowserSpec {
  readonly source: "browser";
  readonly url: string;
  readonly viewport: readonly [number, number];
  readonly deviceScaleFactor: number;
  readonly scheme: "light" | "dark";
  readonly label: string;
  /** PT-4 — the device the page is seen as. Absent: a pointer device of the host's engine's own agent. */
  readonly device?: LiveBrowserDevice;
}

/**
 * THE DEVICE A PAGE IS SEEN AS (PT-4) — what the page is TOLD beyond its viewport and its density: whether it is laid out as
 * a phone or a tablet (`mobile`), how many fingers it takes (`touchPoints` — 0 is a pointer device; a press in hand on a page
 * with any arrives as a TOUCH), and the AGENT it announces. `agent: null` is the host's engine's own — its Chromium by name
 * and bundled version, said by the host, never a string a plugin writes down.
 */
export interface LiveBrowserDevice {
  readonly mobile: boolean;
  readonly touchPoints: number;
  readonly agent: LiveBrowserAgent | null;
}

/** An agent as a page reads it: `navigator.userAgent`, `navigator.platform`, and the client hints it ships with
 * (`navigator.userAgentData`: its platform, that platform's version, the device's model). */
export interface LiveBrowserAgent {
  readonly userAgent: string;
  readonly navigatorPlatform: string;
  readonly platform: string;
  readonly platformVersion: string;
  readonly model: string;
}
// docs:end live-browser-spec

/** A whole, positive CSS length the source can be laid out at. */
const cssLength = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 32_768;

/**
 * A `spec` read as a browser page (the host's side): the spec when every field is what `LiveBrowserSpec` says, else undefined —
 * a host refuses what it cannot read rather than guessing at it.
 */
export function liveBrowserSpec(
  spec: Readonly<Record<string, unknown>>,
): LiveBrowserSpec | undefined {
  const { source, url, viewport, deviceScaleFactor, scheme, label } = spec;
  if (source !== "browser" || typeof url !== "string" || url.length === 0) return undefined;
  if (!Array.isArray(viewport) || viewport.length !== 2) return undefined;
  const [w, h] = viewport as readonly unknown[];
  if (!cssLength(w) || !cssLength(h)) return undefined;
  // the page's own density: device px a CSS px, as a display has (LSF draws at most 8)
  if (
    typeof deviceScaleFactor !== "number" ||
    !Number.isFinite(deviceScaleFactor) ||
    deviceScaleFactor <= 0 ||
    deviceScaleFactor > 8
  )
    return undefined;
  if (scheme !== "light" && scheme !== "dark") return undefined;
  if (typeof label !== "string") return undefined;
  // PT-4: a device named must be one the host can read whole — never half a device
  const device = spec.device === undefined ? undefined : liveBrowserDevice(spec.device);
  if (spec.device !== undefined && device === undefined) return undefined;
  return {
    source,
    url,
    viewport: [w, h],
    deviceScaleFactor,
    scheme,
    label,
    ...(device === undefined ? {} : { device }),
  };
}

/** A word a page is told: a string within `max`, with no control character in it. */
const told = (v: unknown, max: number): v is string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the refusal IS of control characters
  typeof v === "string" && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);

/** A `device` read as `LiveBrowserDevice` (the host's side), or undefined when any of it is not what the type says. */
function liveBrowserDevice(value: unknown): LiveBrowserDevice | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { mobile, touchPoints, agent } = value as Readonly<Record<string, unknown>>;
  if (typeof mobile !== "boolean") return undefined;
  if (
    typeof touchPoints !== "number" ||
    !Number.isSafeInteger(touchPoints) ||
    touchPoints < 0 ||
    touchPoints > 10
  )
    return undefined;
  if (agent === null) return { mobile, touchPoints, agent: null };
  if (typeof agent !== "object" || agent === undefined) return undefined;
  const { userAgent, navigatorPlatform, platform, platformVersion, model } = agent as Readonly<
    Record<string, unknown>
  >;
  if (!told(userAgent, 512) || userAgent.length === 0) return undefined;
  if (!told(navigatorPlatform, 32) || !told(platform, 64)) return undefined;
  if (!told(platformVersion, 32) || !told(model, 64)) return undefined;
  return {
    mobile,
    touchPoints,
    agent: { userAgent, navigatorPlatform, platform, platformVersion, model },
  };
}

/**
 * A BROWSER PAGE'S NAVIGATION (PT-3 ruling 10) — the second service VibeField lends beside `LIVE`. ICE's `LiveFace` has no
 * navigation verb and gets none (the desk stays ignorant of sources), so a browser kind navigates its face's page THROUGH this
 * service, by the face's key — never by re-opening it: a face is keyed by its object's durable key and main's custody re-binds
 * a page by it, so an address written under a running page cannot reach the page. The host gates it by the object, as it
 * gates `LIVE` (the kind's plugin granted `surface.attach` and `surface.browser`), and `go` meets the browser's own address
 * policy at the producer.
 */
export type BrowserNavigationCommand =
  | { readonly action: "go"; readonly url: string }
  | { readonly action: "back" }
  | { readonly action: "forward" }
  | { readonly action: "reload" }
  | { readonly action: "stop" };

/** What the host lends under `BROWSER_NAVIGATION`. */
export interface BrowserNavigation {
  /** Send the page `key`'s face holds a navigation — false: nothing sent (no page open for the key, or one the host refuses). */
  navigate(key: string, command: BrowserNavigationCommand): boolean;
  /**
   * PT-4 — the face's SPEC moved under its open page (another device, another scheme, another viewport with it): the page is
   * told, never re-opened. The host lays it out at the spec's viewport and density and tells it its device and its scheme;
   * the page RELOADS ONCE when what it is told of its device moved (its agent, mobile, touch) — its scheme or its density
   * alone is told live. The spec's `url` is not read here: an address moves by `navigate`. False: no page open for the key,
   * or a spec the host cannot read.
   */
  respec(key: string, spec: Readonly<Record<string, unknown>>): boolean;
  /**
   * PT-5b — the desk's budget EVICTED the face's texture (the kind charged its bytes, `KindHost.budget`; design-019 §7):
   * the host lets the texture go. The face's `texture()` is none until its page's next frame — or its still, laid again
   * when the pane is next seen. False: no page open for the key, or nothing to let go. Absent on a host older than PT-5b.
   */
  evict?(key: string): boolean;
}

/** The key the host lends a browser kind its pages' navigation under (`KindHost.use(BROWSER_NAVIGATION)`). */
export const BROWSER_NAVIGATION = serviceKey<BrowserNavigation>("vibefield.browser.navigation");

// docs:begin live-browser-failure
/**
 * WHY A BROWSER FACE FAILED (PT-5a) — VibeField's contract for a failed browser face's `LiveState.reason` (ICE leaves the
 * string to the host): a WORD of this closed set, then — after `": "` — the host's own detail, which is for a diagnostic and
 * never for a person. A kind says each word in a person's words on its face; the state's `retry` is there when trying again
 * can help.
 *  - the page's LOAD failed — `LiveInfo.address` is still the address that was ASKED for, never the engine's error page:
 *    `name-not-resolved`, `offline`, `connection-refused`, `connection-failed`, `timed-out`, `certificate` (refused, never
 *    bypassed), `blocked` (an address the desk does not open), `load-failed` (any other). `retry` asks for it again;
 *  - the load ENDED WITH NO PAGE (PT-5b2) — nothing of the page stands, and the face is not `starting` for good:
 *    `no-document` (the address answered with something a pane cannot show — a file to download, an empty answer),
 *    `load-stopped` (the person stopped it before anything of the page arrived). `retry` asks for the address again;
 *  - the page STOPPED: `stopped` (its process is gone), `unresponsive` (it stopped answering, and was closed). `retry`
 *    loads it again, where it was;
 *  - `lost`: the desk lost its hold of the page. `retry` opens it again;
 *  - `may-not`: the desk may not open a page for this object (its plugin is not granted the capability, this window lends
 *    no pages). No `retry`;
 *  - `failed`: anything else.
 */
export const LIVE_BROWSER_FAILURES = [
  "name-not-resolved",
  "offline",
  "connection-refused",
  "connection-failed",
  "timed-out",
  "certificate",
  "blocked",
  "no-document",
  "load-stopped",
  "load-failed",
  "stopped",
  "unresponsive",
  "lost",
  "may-not",
  "failed",
] as const;
export type LiveBrowserFailure = (typeof LIVE_BROWSER_FAILURES)[number];

/** A failed browser face's reason as the host says it: the word, then its own detail (none: the word alone). */
export const liveBrowserFailureReason = (failure: LiveBrowserFailure, detail?: string): string =>
  detail === undefined || detail === "" ? failure : `${failure}: ${detail}`;

/** The word of a failed browser face's reason — `failed` for a reason that is none of them (a host older than PT-5a). */
export function liveBrowserFailure(reason: string): LiveBrowserFailure {
  const at = reason.indexOf(": ");
  const word = at < 0 ? reason : reason.slice(0, at);
  return (LIVE_BROWSER_FAILURES as readonly string[]).includes(word)
    ? (word as LiveBrowserFailure)
    : "failed";
}

/**
 * WHAT A PAGE ASKED FOR AND MAY NOT HAVE (PT-5a) — `LiveInfo.extra.refused` on a browser face: the last such thing the host
 * answered for the page and wants SAID, with a serial that moves each time — a download (cancelled: a desk keeps no files
 * for a page), or a PERMISSION the page requested (denied: a desk's pages get none — `permission` names it, Chromium's
 * word such as `geolocation` or `notifications`, `camera` and `microphone` for a media request). A kind says it for a
 * moment when the serial moves under an open face. Absent: nothing was.
 */
export type LiveBrowserRefusal =
  | { readonly what: "download"; readonly serial: number }
  | { readonly what: "permission"; readonly permission: string; readonly serial: number };

/**
 * THE TEXTURE IS A STILL (PT-5b) — `LiveInfo.extra.still` on a browser face: what its texture holds is a PHOTOGRAPH of the
 * page — the last one this device kept of the address the pane is at — and not the page: laid by the host before the page's
 * first frame, while its page is at rest (a desk keeps only so many pages alive), or under a failure's words where the
 * address that failed is the still's. `takenAt`: when it was taken (ms, this device's clock); `age`: how long ago, as the
 * words were read. Absent: the texture is the page's own frame. A kind draws a still as a photograph — dimmer, a rest mark
 * on its head — and never as the page; it takes no press. A still never leaves the device it was taken on.
 */
export interface LiveBrowserStill {
  readonly takenAt: number;
  readonly age: number;
}
// docs:end live-browser-failure

// docs:begin live-simulator
/**
 * THE DEVICE A SIMULATOR FACE SHOWS (PT-S1) — the `spec` a simulator kind hands the host's `LIVE` service, typed here so the
 * plugin and the host read one shape (as `LiveBrowserSpec` is): the device the phone is BOUND to, by CoreSimulator's ids — its
 * device type and its runtime, never a UDID (a UDID names one simulator on one Mac; each Mac attaches its OWN simulator of the
 * bound type) — the device's name as the phone says it, and the desk's colour scheme. A real Simulator keeps its own
 * appearance (v1 never switches iOS); a host's fixture follows the desk. The host re-validates the two ids against the
 * contracts' `LiveSurfaceIosSimulatorBindingV1` before it resolves a device — this reader holds only their shape as words.
 */
export interface LiveSimulatorSpec {
  readonly source: "ios-simulator";
  readonly deviceType: string;
  readonly runtime: string;
  readonly label: string;
  readonly scheme: "light" | "dark";
}

/** A `spec` read as a simulator's device (the host's side), or undefined when any field is not what `LiveSimulatorSpec` says. */
export function liveSimulatorSpec(
  spec: Readonly<Record<string, unknown>>,
): LiveSimulatorSpec | undefined {
  const { source, deviceType, runtime, label, scheme } = spec;
  if (source !== "ios-simulator") return undefined;
  if (!told(deviceType, 128) || deviceType.length === 0) return undefined;
  if (!told(runtime, 128) || runtime.length === 0) return undefined;
  if (!told(label, 128)) return undefined;
  if (scheme !== "light" && scheme !== "dark") return undefined;
  return { source, deviceType, runtime, label, scheme };
}

/**
 * THE SIMULATOR'S HONEST FACE (PT-S1; the PT-S design §3) — which of its nine states a simulator face is in, as the HOST knows
 * it (whichever source feeds the face sets it: a kind never learns how its frames are made, so a host may change its source
 * and no kind changes — James's choice 4, 2026-10-29). A kind shows each in a person's words (DESIGN.md §9) and never passes a
 * still off as live. A source says only the states it can reach (one that needs no consent never says `no-permission`):
 *  - `no-simulator` — no Simulator on this Mac. No act;
 *  - `no-permission` — the system refused the host the Simulator's screen (Screen Recording). The act opens the
 *    system's settings;
 *  - `no-device` — no device of the bound type on this Mac. The act creates one;
 *  - `off` — the device is shut down: its last still, dimmed. The act boots it;
 *  - `booting` — from its boot to the window's first frame: the still, with a boot mark. No act;
 *  - `no-window` — booted, but the Simulator's window is closed: the still. The act shows the window;
 *  - `live` — frames flowing: the stream. No act;
 *  - `at-rest` — off view, or the desk's cap rested it: the last frame as a still, with the rest mark. No act;
 *  - `stopped` — the Simulator quit or crashed mid-stream: the still under the failure's dim. The act tries again.
 * The acts manage the device and never reach inside iOS (view-only, v1).
 */
export const LIVE_SIMULATOR_STATES = [
  "no-simulator",
  "no-permission",
  "no-device",
  "off",
  "booting",
  "no-window",
  "live",
  "at-rest",
  "stopped",
] as const;
export type LiveSimulatorState = (typeof LIVE_SIMULATOR_STATES)[number];

/**
 * `LiveInfo.extra.simulator` on a simulator face: its state, the device's name as the host says it (a simulator's own name,
 * else its type's — absent: the kind names it from its catalog), and the state's ONE act where it has one and the host can
 * run it (`act` — absent: no act is offered).
 */
export interface LiveSimulatorFace {
  readonly is: LiveSimulatorState;
  readonly device?: string;
  readonly act?: () => void;
}

const isSimulatorState = (v: unknown): v is LiveSimulatorState =>
  typeof v === "string" && (LIVE_SIMULATOR_STATES as readonly string[]).includes(v);
const isAct = (v: unknown): v is () => void => typeof v === "function";

/** What a simulator face's words say of its state (`info.extra.simulator`), or undefined: the host says nothing a kind can read. */
export function liveSimulatorFace(
  info: Pick<LiveInfo, "extra"> | undefined,
): LiveSimulatorFace | undefined {
  const said = info?.extra?.simulator;
  if (typeof said !== "object" || said === null) return undefined;
  const { is, device, act } = said as Readonly<Record<string, unknown>>;
  if (!isSimulatorState(is)) return undefined;
  let face: LiveSimulatorFace = { is };
  if (device !== undefined) {
    if (!told(device, 128) || device.length === 0) return undefined;
    face = { ...face, device };
  }
  if (act !== undefined) {
    if (!isAct(act)) return undefined;
    face = { ...face, act };
  }
  return face;
}
// docs:end live-simulator

// docs:begin object-binding
/**
 * An OBJECT's code half (spec §12.8; DK-0f's contract): the value of the renderer module's NAMED
 * EXPORT that `contributes.objects[].binding.kind` names. Static, never registered from `activate` —
 * the desk creates every kind's pass together at its mount — so the HOST reads the export and
 * compiles the prefab from the manifest's DURABLE half through ICE's `defineObject` (§12.2: plugin
 * code never owns a durable schema). The host refuses a binding whose `kind` is not a desk kind
 * (`isObjectKind`) or whose registry `name` is not the row's type (one id, no second namespace).
 *
 * `defineObject` is re-exported by this door for a plugin's own TESTS (compile the object as the host will,
 * then read it back with `objectKindOf`) — never call it in the renderer module: the host defines
 * your type from the manifest, and a second definition of one type throws.
 */
export interface ObjectBinding<G = unknown, R = unknown, L = unknown> {
  /** The kind: its program (its WGSL, its pass) and its world half. Its `name` IS the row's type. */
  readonly kind: ObjectKind<G, R, L>;
  /** The props chain to the manifest's `schemaVersion`: version → (prev) => next. Renames of the TYPE are host history, never a plugin's (`TYPE_RENAMES`). */
  readonly migrate?: ObjectDef["migrate"];
  /** The hand onto the kind's state, made once per desk (a pen, a carry, a typing session). */
  readonly drivers?: DriverFactory;
  /** The kind's DOM half, declared: `lend` · `text` · `mount`. */
  readonly host?: ObjectHost;
  /** Selection-menu acts, one undo step each. */
  readonly menu?: readonly MenuActionDef[];
}
// docs:end object-binding
