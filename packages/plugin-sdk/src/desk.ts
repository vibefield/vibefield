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
//    `MenuActionDef` and their APIs, what an act says now (`MenuActionState` and its context — ICE I61) and its
//    choices (`ActChoice`, `ActChoiceField`, `ActChoiceTaken` — ICE I62; track OM, 2026-11-25), `HeldGlyph`,
//    `TrayEntry` (`hang` required), `Entity`, `World`;
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

import type { Entity, MenuActionDef } from "@vibecook/ice";
import type { DriverFactory, ObjectDef, ObjectHost, ObjectKind } from "@vibecook/ice/desk";
import {
  encodeMarks,
  findQuote,
  freshSeed,
  HIGHLIGHTERS,
  type HighlighterName,
  type InkChange,
  type InkValue,
  inkCells,
  inkOf,
  type LiveInfo,
  mark,
  PENS,
  type PenName,
  readWriting,
  replace,
  serviceKey,
} from "@vibecook/ice/desk/kit";
import {
  INK_NO_HIGHLIGHT,
  INK_TOOL_NAMES,
  INK_TOOLS,
  INK_WORDS_MAX,
  OBJECT_LIMITS,
} from "@vibefield/contracts";

export type {
  ActChoice,
  ActChoiceField,
  ActChoiceTaken,
  Entity,
  HeldGlyph,
  HeldToolApi,
  HeldToolDef,
  HeldToolState,
  HeldToolStateContext,
  MenuActionApi,
  MenuActionDef,
  MenuActionState,
  MenuActionStateContext,
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
  /** The pane’s own sound preference, independent of visibility. */
  readonly muted?: boolean;
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
  if (spec.muted !== undefined && typeof spec.muted !== "boolean") return undefined;
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
    ...(spec.muted === undefined ? {} : { muted: spec.muted as boolean }),
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
 *  - EY-1 (1f, 2026-11-19), a page an agent's run made: `never-opened` (it never reached this window: main let it go
 *    first) and `run-ended` (its run's page was closed, and nothing brings it back: the closed still). No `retry`;
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
  "never-opened",
  "run-ended",
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
  readonly dedicated?: boolean;
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
  return {
    source,
    deviceType,
    runtime,
    label,
    scheme,
    ...(spec.dedicated === true ? { dedicated: true } : {}),
  };
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
  /** Present only on a headless boot. Live means a frame from this boot reached the pane. */
  readonly bootDisplay?: "starting" | "live";
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
  const { is, device, act, bootDisplay } = said as Readonly<Record<string, unknown>>;
  if (!isSimulatorState(is)) return undefined;
  let face: LiveSimulatorFace = { is };
  if (is === "booting" && (bootDisplay === "starting" || bootDisplay === "live"))
    face = { ...face, bootDisplay };
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

/** The device a phone is BOUND to, as a host answers it: CoreSimulator's device type and runtime — never a UDID. */
export interface LiveSimulatorBinding {
  readonly deviceType: string;
  readonly runtime: string;
}

/**
 * Xcode's simulator inventory on this Mac. The setup picker requests compatible models for every installed iOS runtime.
 * Plugins using the older synchronous device lookup can still read the host's last snapshot.
 */
export interface SimulatorDevices {
  /** Native prerequisite setup when offered by the host. Checks only read this Mac. */
  readonly setup?: SimulatorSetup;
  /** Read installed iOS versions and their compatible iPhones, newest runtime first. */
  configurations?(): Promise<readonly SimulatorRuntimeOption[]>;
  /**
   * The device a phone of model `prefer` (a CoreSimulator device type) attaches here: this Mac's BOOTED device of that
   * type; else its first booted iPhone (the phone takes that iPhone's model); else `prefer` on the newest runtime this Mac
   * holds — whose face then says honestly that it is off, or that there is no such device. Undefined: the host has not read
   * this Mac's devices yet, or it holds none to offer.
   */
  attachable(prefer: string): LiveSimulatorBinding | undefined;
}

export type SimulatorSetupStatus =
  | {
      readonly stage: "ready";
      readonly xcodeVersion?: string | undefined;
      readonly configurations: readonly SimulatorRuntimeOption[];
    }
  | {
      readonly stage:
        | "install-xcode"
        | "select-xcode"
        | "accept-license"
        | "finish-xcode"
        | "install-runtime"
        | "unsupported"
        | "unavailable";
      readonly xcodeVersion?: string | undefined;
    };

export interface SimulatorSetup {
  check(): Promise<SimulatorSetupStatus>;
  open(target: "app-store" | "xcode"): Promise<void>;
}

export interface SimulatorRuntimeOption {
  readonly runtime: string;
  readonly models: readonly { readonly deviceType: string; readonly name: string }[];
}

/** The key the host lends a simulator kind this Mac's devices under (`KindHost.use(SIMULATOR_DEVICES)`). */
export const SIMULATOR_DEVICES = serviceKey<SimulatorDevices>("vibefield.simulator.devices");

/**
 * THE DESK'S HOLD, lent to kinds (track OM, OM-2, 2026-11-25): a kind's act picks one of the person's selected objects
 * up, the same pick-up a double-click makes (ICE's `ops.open`), so the object comes to reading size and its tools travel
 * with it. The simulator's Simulator settings… opens its sheet on the phone it picked up. The desk refuses an object
 * that is not among the selected or that cannot be opened. What it does not know: which kind asks, or whether a person
 * just pressed. A kind calls it from an act the person ran; one that called it at another time could only pick up an
 * object the person had selected, which a press of their own would put down.
 */
export interface DeskHold {
  /** Picks `entity`, one of the selected, up; the selection becomes it alone. True when the desk took it up. */
  pickUp(entity: Entity): boolean;
}

/** The key the host lends the desk's hold under (`KindHost.use(DESK_HOLD)`). */
export const DESK_HOLD = serviceKey<DeskHold>("vibefield.desk.hold");

// docs:begin agent-half
/** What a kind's agent handler reads an object through. A host-built view: no `world`, no entity, and no write of any kind,
 * so a read handler has nothing to write with (§5.3). The same words run wherever the object's document is. */
export interface AgentReadApi {
  /** The object's durable props as they stand now, each as the manifest declares it. A copy: changing it changes nothing. */
  props(): Readonly<Record<string, unknown>>;
}

/** What an act handler writes through. Every `setProps` of one act is ONE change the person can undo; a handler that throws
 * writes nothing. `props()` sees what this act has set so far. */
export interface AgentActApi extends AgentReadApi {
  /** Set some of the object's props. Checked against the declared props when the act ends. */
  setProps(patch: Readonly<Record<string, unknown>>): void;
}

export type AgentToolInput = Readonly<Record<string, unknown>>;

/** An act's answer. `value` goes to the agent; `changed` is what the person's undo will say (absent: the agent's own words
 * for the act). */
export interface AgentActAnswer {
  readonly value?: unknown;
  readonly changed?: string;
}

/**
 * A kind's AGENT HALF (§5.3): its handlers, beside its menu. The tools and faces themselves are declared once, in the
 * manifest's `contributes.objects[].agent`; `vibefield-plugin check` holds the two to each other.
 */
export interface AgentHalf {
  /** What `object_open` shows of the object now: small, bounded, JSON. */
  readonly summary: (api: AgentReadApi) => unknown;
  /** A text, file or link face's content, by the face's id: its words, its file's body, or its address. */
  readonly faces?: Readonly<Record<string, (api: AgentReadApi) => string>>;
  /** The handlers of the tools the manifest marks `readOnly`, by name. */
  readonly read?: Readonly<Record<string, (api: AgentReadApi, input: AgentToolInput) => unknown>>;
  /** The handlers of the acting tools, by name. Each runs as one transaction. */
  readonly act?: Readonly<
    Record<string, (api: AgentActApi, input: AgentToolInput) => AgentActAnswer | undefined>
  >;
}
// docs:end agent-half

/** What an act recorded: the values it set and what those props held before. */
export interface AgentActInverse {
  readonly after: Readonly<Record<string, unknown>>;
  readonly before: Readonly<Record<string, unknown>>;
}

/** One act being recorded: its API, and (when it ends) the one change it made, or undefined when it changed nothing. */
export interface AgentActRecording {
  readonly api: AgentActApi;
  inverse(): AgentActInverse | undefined;
}

/** JSON equality, whatever order an object's keys were written in. */
export function sameAgentValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return keysA.every((key) => key in right && sameAgentValue(left[key], right[key]));
}

const agentPropsCopy = (props: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  structuredClone({ ...props });

/** The read API over a set of props (the host's, and the kit's harness). */
export function agentReadApi(props: Readonly<Record<string, unknown>>): AgentReadApi {
  return { props: () => agentPropsCopy(props) };
}

/**
 * The act API over a set of props, recording as it goes (the host's, and the kit's harness; one implementation, so they
 * cannot disagree). It writes nothing: the host commits `inverse().after` as one transaction once the handler returns,
 * and keeps `inverse()` so the agent's change can be undone apart from the person's own.
 */
export function recordAgentAct(props: Readonly<Record<string, unknown>>): AgentActRecording {
  const set: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  return {
    api: {
      props: () => agentPropsCopy({ ...props, ...set }),
      setProps(patch) {
        for (const [name, value] of Object.entries(patch)) {
          if (value === undefined) continue;
          if (!(name in before)) before[name] = props[name];
          set[name] = structuredClone(value);
        }
      },
    },
    inverse() {
      const changed = Object.keys(set).filter((name) => !sameAgentValue(set[name], before[name]));
      if (changed.length === 0) return undefined;
      return {
        after: Object.fromEntries(changed.map((name) => [name, set[name]])),
        before: Object.fromEntries(changed.map((name) => [name, before[name]])),
      };
    },
  };
}

/** Whether an object still holds what an act set: the only state its undo may apply to. */
export function agentActStillHolds(
  props: Readonly<Record<string, unknown>>,
  inverse: Pick<AgentActInverse, "after">,
): boolean {
  return Object.entries(inverse.after).every(([name, value]) => sameAgentValue(props[name], value));
}

/**
 * AN AGENT TOOL'S HONEST NO (IK, 2026-11-25): the input asks for what the object cannot do — a quote it does not hold, a
 * pen the desk has no such name for. A handler throws one, in words the agent can act on; nothing is written, the host
 * answers it as the agent's bad input (never as the desk failing), and the kit's conformance takes it as an answer.
 */
export class AgentToolRefusal extends Error {
  override readonly name = "AgentToolRefusal";
}

/** Whether a handler's throw is an honest no (`AgentToolRefusal`), by its name: a plugin's copy of the class reads so too. */
export const isAgentToolRefusal = (error: unknown): error is AgentToolRefusal =>
  error instanceof Error && error.name === "AgentToolRefusal";

/** The three tools every written kind shares, as a manifest's `agent.tools` lists them (contracts' `ink-tools.ts`). */
export { INK_TOOL_NAMES, INK_TOOLS };

/**
 * How a written kind keeps its ink, for `withInkTools`. Every name has the ink cell's default (ICE's
 * `groups: { ink: ["text", "seeds", "marks"] }`, the sheet's `seed` and `pen`); a kind whose props are called otherwise
 * names them here — `{ cell: { text: "body" } }` for a kind whose words are its `body`. A kind that declares no `marks`
 * prop (a cell written before marks existed) reads unmarked, edits its words and seeds alone, and refuses a mark.
 */
export interface InkToolsOptions {
  /** The props of the ink cell: its words, each glyph's hand, each glyph's mark. */
  readonly cell?: { readonly text?: string; readonly seeds?: string; readonly marks?: string };
  /** The prop holding the sheet's own seed (the hand of a glyph with no stored one). Default `seed`; absent, 0. */
  readonly seed?: string;
  /** The prop holding the sheet's own pen (a word in no pen of its own is in it). Default `pen`. */
  readonly pen?: string;
  /** The most characters the kind's words hold (its manifest's `maxLength`). Default `INK_WORDS_MAX`. */
  readonly max?: number;
  /** What an agent is told the object is, in its refusals: "note", "pad". Default "sheet". */
  readonly noun?: string;
  /** A fresh seed for a glyph just written (ICE's `freshSeed` unless a test says). */
  readonly fresh?: () => number;
}

const refuse = (words: string): never => {
  throw new AgentToolRefusal(words);
};

const stringOf = (v: unknown): string => (typeof v === "string" ? v : "");

/** Words as an agent is told them back: one line, short. */
const quoted = (words: string): string => {
  const line = words.replaceAll("\n", " ");
  return `"${line.length <= 40 ? line : `${line.slice(0, 39)}…`}"`;
};

const isPen = (v: unknown): v is PenName =>
  typeof v === "string" && (PENS as readonly string[]).includes(v);
const isHighlighter = (v: unknown): v is HighlighterName =>
  typeof v === "string" && (HIGHLIGHTERS as readonly string[]).includes(v);

/** How many times `quote` is written in `text`, overlapping starts counted (`findQuote`'s count). */
const timesIn = (text: string, quote: string): number => {
  const at = findQuote(text, quote);
  if (!("error" in at)) return 1;
  return at.error === "ambiguous" ? at.count : 0;
};

/** What a mark_text input asks, as one change for ICE's `mark` (every field it names, `clear` first), and its words. */
function changeOf(
  input: AgentToolInput,
  own: PenName | undefined,
  noun: string,
): { readonly change: InkChange; readonly words: readonly string[] } {
  const change: Record<string, unknown> = {};
  const words: string[] = [];
  if (input["clear"] !== undefined) {
    if (input["clear"] !== true) refuse("`clear` is true, or left out.");
    change["clear"] = true;
    words.push("its marks cleared");
  }
  const pen = input["pen"];
  if (pen !== undefined) {
    if (!isPen(pen))
      refuse(`The desk has no pen called ${String(pen)}. Its pens: ${PENS.join(", ")}.`);
    // the sheet's own pen is no pen of the words' own (the words' menu does the same)
    change["pen"] = pen === own ? null : pen;
    words.push(pen === own ? `in the ${noun}'s own pen` : `in the ${pen} pen`);
  }
  const highlight = input["highlight"];
  if (highlight !== undefined) {
    if (highlight !== INK_NO_HIGHLIGHT && !isHighlighter(highlight))
      refuse(
        `The desk has no highlighter called ${String(highlight)}. Its highlighters: ${HIGHLIGHTERS.join(", ")}, or ${INK_NO_HIGHLIGHT}.`,
      );
    change["highlight"] = highlight === INK_NO_HIGHLIGHT ? null : highlight;
    words.push(highlight === INK_NO_HIGHLIGHT ? "unhighlighted" : `highlighted ${highlight}`);
  }
  for (const [line, on] of [
    ["strike", "struck through"],
    ["underline", "underlined"],
  ] as const) {
    const v = input[line];
    if (v === undefined) continue;
    if (typeof v !== "boolean" && !isPen(v))
      refuse(`\`${line}\` is true, false or one of the pens: ${PENS.join(", ")}.`);
    change[line] = v;
    words.push(v === false ? `not ${on}` : v === true ? on : `${on} in the ${v} pen`);
  }
  if (words.length === 0)
    refuse("Say how to mark the words: `pen`, `highlight`, `strike`, `underline` or `clear`.");
  // ICE's `InkChange` is one field's change; `mark` sets every field a change names, `clear` first
  return { change: change as InkChange, words };
}

/**
 * THE INK TOOLS (IK, 2026-11-25; ink-agent A) — a written kind's agent half with the three tools every written kind
 * shares added to its own (`INK_TOOLS`; the kind's manifest lists them beside its own tools, and `vibefield-plugin check`
 * holds the two together). An agent names words by QUOTING them, never by an index:
 *  - `read_writing` → the words with their marks, as ICE's `readWriting` reads them (the text, the sheet's own pen, and
 *    each marked run by its pen, highlighter, strike and underline), its runs bounded to what one answer may carry
 *    (`more`: how many were left off);
 *  - `edit_text { quote, with, occurrence? }` → ICE's `findQuote`, then `replace`, which keeps the marks the replaced
 *    letters all shared; the words, their hands and their marks written as ONE cell;
 *  - `mark_text { quote, occurrence?, pen?, highlight?, strike?, underline?, clear? }` → `findQuote`, then `mark`, by the
 *    kit's names (`PENS`, `HIGHLIGHTERS`, `none`); the sheet's own pen lifts another.
 * A quote not found, found more than once with no `occurrence`, or a name the desk does not have is an `AgentToolRefusal`
 * that says which. Each write is the kind's act like its others: one change, recorded for its separate undo, said in
 * words. An object being typed in lands its open draft before any act reaches it (the host's applier does it, by ICE's
 * `inkTypingOn`), so a quote is found among the words the person sees.
 */
export function withInkTools(half: AgentHalf, opts: InkToolsOptions = {}): AgentHalf {
  for (const name of Object.values(INK_TOOL_NAMES))
    if (half.read?.[name] !== undefined || half.act?.[name] !== undefined)
      throw new Error(`withInkTools: the kind already has a tool called ${name}`);
  const TEXT = opts.cell?.text ?? "text";
  const SEEDS = opts.cell?.seeds ?? "seeds";
  const MARKS = opts.cell?.marks ?? "marks";
  const SEED = opts.seed ?? "seed";
  const PEN = opts.pen ?? "pen";
  const max = opts.max ?? INK_WORDS_MAX;
  const noun = opts.noun ?? "sheet";
  const fresh = opts.fresh ?? freshSeed;

  /** Whether the kind keeps marks: its props name the cell's marks (every declared prop is in `props()`, set or not). */
  const keepsMarks = (props: Readonly<Record<string, unknown>>): boolean => MARKS in props;
  const inkIn = (props: Readonly<Record<string, unknown>>): InkValue => {
    const seed = props[SEED];
    return inkOf(
      {
        text: stringOf(props[TEXT]),
        seeds: stringOf(props[SEEDS]),
        marks: keepsMarks(props) ? stringOf(props[MARKS]) : "",
      },
      typeof seed === "number" && Number.isFinite(seed) ? seed : 0,
    );
  };
  const ownPen = (props: Readonly<Record<string, unknown>>): PenName | undefined => {
    const pen = props[PEN];
    return isPen(pen) ? pen : undefined;
  };

  /** Where the agent's quote is, or its honest no. */
  const where = (
    text: string,
    input: AgentToolInput,
  ): { readonly quote: string; readonly from: number; readonly to: number } => {
    const quote = input["quote"];
    if (typeof quote !== "string" || quote === "")
      return refuse("Quote the words you mean, exactly as `read_writing` gives them.");
    const occurrence = input["occurrence"];
    if (occurrence !== undefined && !(Number.isInteger(occurrence) && (occurrence as number) >= 1))
      return refuse("`occurrence` counts from 1, the first time the words are written.");
    const at = findQuote(text, quote, occurrence as number | undefined);
    if (!("error" in at)) return { quote, from: at.from, to: at.to };
    if (at.error === "ambiguous")
      return refuse(
        `${quoted(quote)} is written ${at.count} times on this ${noun}. Say which with \`occurrence\`, 1 to ${at.count}.`,
      );
    const times = timesIn(text, quote);
    if (times > 0)
      return refuse(
        `${quoted(quote)} is written on this ${noun} only ${times === 1 ? "once" : `${times} times`}.`,
      );
    return refuse(
      `This ${noun} does not say ${quoted(quote)}. Read it with \`read_writing\` and quote its words exactly.`,
    );
  };

  const readWritingTool = (api: AgentReadApi): unknown => {
    const props = api.props();
    const { text, runs } = readWriting(inkIn(props));
    const pen = ownPen(props);
    const head = { text, ...(pen === undefined ? {} : { pen }) };
    // the runs an answer may carry beside the words (the host refuses an answer past OBJECT_LIMITS.TOOL_BYTES)
    let room =
      OBJECT_LIMITS.TOOL_BYTES - new TextEncoder().encode(JSON.stringify(head)).byteLength - 64;
    const kept = [];
    for (const run of runs) {
      const bytes = new TextEncoder().encode(JSON.stringify(run)).byteLength + 1;
      if (bytes > room) break;
      room -= bytes;
      kept.push(run);
    }
    return {
      ...head,
      runs: kept,
      ...(kept.length < runs.length ? { more: runs.length - kept.length } : {}),
    };
  };

  const editText = (api: AgentActApi, input: AgentToolInput): AgentActAnswer => {
    const props = api.props();
    const words = input["with"];
    if (typeof words !== "string")
      return refuse("Say the words to write in their place with `with`; empty removes them.");
    const ink = inkIn(props);
    const { quote, from, to } = where(ink.text, input);
    if (words === quote) return { value: { at: from, chars: ink.text.length } };
    const next = replace(ink, from, to, words, fresh);
    if (next.text.length > max)
      return refuse(
        `This ${noun} holds at most ${max} characters, and that would make it ${next.text.length}.`,
      );
    const cells = inkCells(next);
    // the WHOLE cell in one step: the words, their hands and their marks moved together
    api.setProps({
      [TEXT]: cells.text,
      [SEEDS]: cells.seeds,
      ...(keepsMarks(props) ? { [MARKS]: cells.marks } : {}),
    });
    return {
      value: { at: from, chars: next.text.length },
      changed:
        words === "" ? `Removed ${quoted(quote)}` : `Changed ${quoted(quote)} to ${quoted(words)}`,
    };
  };

  const markText = (api: AgentActApi, input: AgentToolInput): AgentActAnswer => {
    const props = api.props();
    if (!keepsMarks(props))
      return refuse(`This ${noun} keeps no marks: its words can be changed, not marked.`);
    const { change, words } = changeOf(input, ownPen(props), noun);
    const ink = inkIn(props);
    const { quote, from, to } = where(ink.text, input);
    const next = mark(ink, from, to, change);
    // a mark moves the marks alone: the words and their hands stay as they are (the cell is still written whole)
    api.setProps({ [MARKS]: encodeMarks(next.marks) });
    return {
      value: { at: from, chars: to - from },
      changed: `Marked ${quoted(quote)}: ${words.join(", ")}`,
    };
  };

  return {
    ...half,
    read: { ...half.read, [INK_TOOL_NAMES.read]: readWritingTool },
    act: { ...half.act, [INK_TOOL_NAMES.edit]: editText, [INK_TOOL_NAMES.mark]: markText },
  };
}

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
  /** What an agent can do with it: the handlers of the manifest's `agent` block (§5.3). Absent: agents can place it, no more. */
  readonly agent?: AgentHalf;
}
// docs:end object-binding
