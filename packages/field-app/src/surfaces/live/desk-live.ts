// THE DESK'S LIVE SERVICE (PT-2 — ICE design-019 §3.2, the host's half of the live face; PORTALS' rulings 1–6): what VibeField
// lends the desk under ICE's `LIVE` key. A kind opens a FACE per object by the object's durable key; the service holds the page
// behind it in the window's LSF pool and fills the face's texture — the kind holds a view and words, never a frame (PA-22 by
// construction: the frame lives in the pool's lease and leaves it only into ICE's writer).
//  - THE GATE (ruling 3) is the host's, by the OBJECT: the key's entity, its type, the plugin that contributes it, that plugin's
//    effective capabilities — `surface.attach` and `surface.browser` for a browser page, a failed face with the words otherwise.
//    Nothing a kind writes in its spec grants anything.
//  - THE KEYS (ruling 4): the pool's key is `desk:<key>` (apart from any panel's); the mint's `reuseKey` is the durable key
//    itself, so a reload re-attaches the SAME running page (fieldd forwards it to custody since PT-2).
//  - ONE COPY (ruling 1): a frame is taken through the presentation's `presentLatestVia` — its lease released on every path —
//    straight into ICE's writer, on the DESK's device, from LSF's `visibleRect`, with its `logicalSize` as the texture's
//    `logical` (the page's CSS viewport — what PT-3's hand maps into). LSF's own texture store is not used here.
//  - THE WAKE: the attachment tells of a landed frame (`onFrame`) and the handle of a moved state or page (`onState`); each is one
//    `arrived()`. `take()` presents the newest frame once; an UNSEEN face's frame is taken and closed, drawn nowhere (ruling 6).
//  - THE DEMAND (ruling 5): the kind's `LiveDemand` → the pool's intent (fps to the nearest bucket not above, the raster, the
//    page's logical viewport, priority 80 in use / 50 at rest).
//  - ONE SERVICE PER DESK MOUNT: its writers are made on that mount's device; a remount makes a new service, and the pool's
//    grace keeps the page attached across it.
//  - IN USE (PT-3 rulings 3–6): a face takes INPUT in the coordinates of the frame it DISPLAYED (its logical size); the service
//    stamps each with the geometry revision of the frame it presented (LSF drops a stale one, the service drops nothing itself)
//    and sends it down the pool's lane — a pointer, a wheel (the page's CSS px), a key, committed text, an IME composition.
//    The face's words carry the page's CURSOR, and a cursor that moves is an arrival. NAVIGATION goes through the page, by the
//    face's key (`navigate` — the second service, `BROWSER_NAVIGATION`): never by re-opening it.
//  - AS A DEVICE SEES IT (PT-4): the spec's device and scheme are the page's EMULATION — on the source at its mint, and told
//    again (`emulate`, a navigation command) whenever the spec moves under the open page (`respec` — the second service) and
//    once as the lane goes live (a page re-bound after a reload is the spec's, whatever it was told before; the same told
//    twice is nothing at the producer). A re-spec lays the page out at the spec's viewport FIRST — the demand goes down the
//    same port ahead of the emulation — so a page that reloads for its new device loads at that device's size.
//  - ONE PROFILE (PT-4 ruling 3): every desk page is minted into the SAME persistent profile (`DESK_PROFILE`), as the tabs
//    of one browser are — main keeps it under the user's data, apart from the app's own session.
//  - THE PARKED DESK (PT-5a ruling 5; design-019 §8): while the desk's loop is parked its kinds are not ticked and cannot
//    ask, so the service asks for them — `park(true)` pauses every page (LSF mutes a page that is not asked for live:
//    ruling 4), `park(false)` gives each page its face's LAST ask back.
//  - A PAGE'S FAILURES ARE SAID (PT-5a ruling 3): a load that failed, a page that stopped, a lane lost, a page the desk may
//    not open — each a `failed` state whose reason begins with the SDK's word for it (`LIVE_BROWSER_FAILURES`), with a `retry`
//    wherever trying again can help. A failed page's frames are NEVER shown (the engine's own error page stays unseen): its
//    texture is hidden until a frame of the page that follows lands, and nothing is sent to it meanwhile. The page's source
//    says its stops (`whenStopped: "say"`): a desk page is never restarted behind the person.
//  - THE FAVICON (PT-4 ruling 4): the page's icon rides LSF's browser state; the face's words carry its bytes under
//    `extra.favicon` (decoded once a key) — `null` where the page has none, absent before the page has said anything.
//    PT-5a (ruling 8): its bytes cross the page's port ONCE a key — main's control session posts them with the first
//    summary that names the key and the key alone after; the pool's attachment keeps them, so the state read here is whole.
//  - THE LAST STILL (PT-5b rulings 1, 2): a page's pixels are the HOST's (PA-22) and stay on this device — the service reads
//    the face's own texture back (still-taker.ts), keeps the picture on the byte store's shelf under the document and the
//    object (page-stills.ts: never in the document, never synced, never said to a log), and lays it into the face's writer
//    wherever no live frame of the page has landed: at open, when its page is at rest, and — where the address that FAILED
//    is the still's — under a failure's words. A still is of ONE address: another's is not shown. It is never passed off as
//    the page: `info().extra.still` says so, with its age, until the page's next frame lands in its place. TAKEN when a held
//    pane is put down, before a page is put to rest, and at rest at most once every 30 s a pane where a frame arrived since.
//  - SIX PAGES ALIVE AT MOST (PT-5b ruling 3; live-cap.ts is the policy): a page is made alive only when the cap lets it —
//    until then, and when it is put to rest, its pane shows its still. A rest takes the page's still first, then asks it
//    `hibernated` (its WebContents gone, its address kept by its producer); a page let go of (a deleted pane's, kept by the
//    pool's grace) is alive and counted, and rested first when its slot is wanted.
//  - ITS TEXTURE LET GO (PT-5b ruling 4): the kind charges each face's bytes to the desk's budget; when the budget evicts
//    one the kind says so (`BROWSER_NAVIGATION.evict`) and the writer is destroyed — the film, or its still when next seen.
//  - A BOUND SIMULATOR (PT-S2; the brief's Part 3): a spec the SDK reads as a device (`liveSimulatorSpec`) opens a lane of its
//    own (`openSimulator`) — its gate's scopes the source's (`surface.attach` + `surface.capture`: live-gate.ts), its mint the
//    phone's BINDING and never a UDID, its pool key the face's key AND its binding (a phone bound anew never re-holds the
//    grace-kept stream of the device it left), no input (view-only), no navigation (the page verbs refuse it). It is a `Lane`
//    in the one map: the six-alive cap, the rests, the stills' clock and the shelf are the pages' own (`seatOf`,
//    `stillClockOf`, `readStill`, `forgetLater` — one place for the PT-5b/PT-6a fixes). Main's FACTS are said in the SDK's
//    nine words (simulator-face.ts, R2): `info().extra.simulator` — its state, the device's name, and the state's ONE act
//    (memoized, resolved by the face's key when it RUNS, a no-op once the word has moved; none while main runs one) — and
//    never `extra.still` (R14: a moving age would remake the phone at every take). Its still is of ONE binding (R15).

import type { LiveTextureOptions, LiveWriter } from "@vibecook/ice/desk";
import type {
  LiveDemand,
  LiveFace,
  LiveInfo,
  LiveInput,
  LiveSources,
  LiveState,
  LiveTexture,
} from "@vibecook/ice/desk/kit";
import {
  BROWSER_DESK_PROFILE_REF,
  type CoreSimulatorDeviceTypeIdV1,
  type CoreSimulatorRuntimeIdV1,
  LIVE_SURFACE_FPS_BUCKETS_V1,
  type LiveSurfaceBrowserEmulationV1,
  type LiveSurfaceBrowserStateV1,
  type LiveSurfaceDemandV1,
  type LiveSurfaceDeviceVerbV1,
  type LiveSurfaceFpsBucketV1,
  type LiveSurfaceInputEventV1,
  type LiveSurfaceSimulatorConditionV1,
  type LiveSurfaceSimulatorStateV1,
  SurfaceOpenResultV1,
} from "@vibefield/contracts";
import {
  type BrowserNavigation,
  type LiveBrowserFailure,
  type LiveBrowserRefusal,
  type LiveBrowserSpec,
  type LiveBrowserStill,
  type LiveSimulatorSpec,
  type LiveSimulatorState,
  liveBrowserFailureReason,
  liveBrowserSpec,
  liveSimulatorSpec,
} from "@vibefield/plugin-sdk/desk";
import {
  type ProductSurfaceFrame,
  SURFACE_POOL_GRACE_MS,
  type SurfaceDemandIntent,
  type SurfaceHandle,
  type SurfaceHandleState,
  type SurfacePool,
  type SurfaceTicketSource,
} from "../pool";
import { type CapFace, capPlan, LIVE_PAGES_MAX } from "./live-cap";
import { PAGE_STILL_MAX_PX, type PageStill, type PageStills } from "./page-stills";
import {
  SIMULATOR_ACTS,
  type SimulatorAct,
  simulatorAddress,
  simulatorLiveState,
  simulatorReuseKey,
  simulatorSource,
  simulatorState,
} from "./simulator-face";
import type { StillDecoder, StillTaker } from "./still-taker";

/** What the gate answers for a face's key: the object's type (its kind's name — the texture's label), or why it may not open. */
export type LiveGateAnswer = { readonly type: string } | { readonly refused: string };

/** PT-S2: what a face shows — a browser page, or a bound Simulator's device (the gate asks each source's own scopes). */
export type LiveFaceSource = "browser" | "ios-simulator";

export interface DeskLiveDeps {
  /** The window's surface pool; null on a host with no live surfaces (every face fails, said). */
  readonly pool: () => SurfacePool<ProductSurfaceFrame> | null;
  /** The WINDOW's product connection — the mint rides it, as the plugin door's does (surface-door.tsx). Null: daemon away. */
  readonly mintClient: () => { request(method: string, params?: unknown): Promise<unknown> } | null;
  /** The capability gate (ruling 3), by the object the key names — PT-S2: for the source the face would show (a page when
   * unsaid). */
  readonly gate: (key: string, source?: LiveFaceSource) => LiveGateAnswer;
  /** The desk's device (`deskLayer({ onDevice })`); undefined before it arrives. */
  readonly device: () => GPUDevice | undefined;
  /** ICE's writer — `createLiveTexture` — the HOST's. */
  readonly writer: (device: GPUDevice, o: LiveTextureOptions) => LiveWriter;
  /** PT-5b — THE LAST STILL: the open document's id (a still is kept under it and the object's key; undefined: none is
   * kept or shown), the shelf, and the host's two hands on a page's pixels — the texture read back and encoded, a kept
   * still decoded. Any of them absent: no stills (the film, as before). */
  readonly docId?: () => string | undefined;
  readonly stills?: Pick<PageStills, "keep" | "kept" | "forget">;
  readonly takeStill?: StillTaker;
  readonly decodeStill?: StillDecoder;
  /** PT-5b — THE CAP's eyes: how far the pane `key` lies from the view's centre (any unit; absent: unknown), and whether
   * the document still holds the object (`false`: deleted — its still is forgotten when its page's grace lapses;
   * `undefined`: not known, nothing is forgotten). */
  readonly far?: (key: string) => number;
  readonly exists?: (key: string) => boolean | undefined;
  /** How long the pool keeps a page nobody holds (a deleted pane's still is forgotten then) — the pool's own, by default. */
  readonly graceMs?: () => number;
  /** The clock and the timers (a test's own). */
  readonly now?: () => number;
  readonly timers?: {
    set(fn: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
}

/** What the service counts — a smoke reads it through the desk door. */
export interface DeskLiveStats {
  readonly opened: number;
  readonly open: number;
  readonly refused: number;
  readonly presented: number;
  /** Frames taken for an unseen face (or with no device yet) and closed, drawn nowhere (ruling 6). */
  readonly dropped: number;
  readonly demands: number;
  /** ICE writers made — one per face and device; a remade one is a new texture (the PLAYING row's "none remade"). */
  readonly writers: number;
  /** PT-3: inputs sent down a page's lane, and those the service could not send (no frame presented yet, a closed lane —
   * PT-5c2: or a frame of a document the page has left). */
  readonly inputs: number;
  readonly inputsUnsent: number;
  /** PT-3: navigations sent to a page by its key, and those refused (no page open for the key). */
  readonly navigations: number;
  readonly navigationsRefused: number;
  /** PT-4: specs that moved under an open page (`respec`), and emulations told down a page's lane. */
  readonly respecs: number;
  readonly emulations: number;
  /** PT-5a: times the desk parked, and whether it is parked now. */
  readonly parks: number;
  readonly parked: boolean;
  /** PT-5b: the most pages alive at once, and how many are now (the open faces' and those let go that the pool's grace
   * still keeps); pages put to rest and pages woken by the service. */
  readonly cap: number;
  readonly alive: number;
  readonly rests: number;
  readonly wakes: number;
  /** PT-5b: stills taken (and kept), stills laid into a face's texture, stills of deleted panes forgotten; textures let
   * go at the budget's word. */
  readonly stillsTaken: number;
  readonly stillsShown: number;
  readonly stillsForgotten: number;
  readonly evictions: number;
  /** PT-S2: a bound Simulator's acts RUN — each a device verb sent down its lane (or its lost lane minted again). */
  readonly acts: number;
}

/** PT-S2 — a bound Simulator's face as a smoke reads it (a row carries no function: its act by name). */
export interface DeskLiveSimulatorRow {
  /** The state its words say (`extra.simulator.is`) — null: none yet (attaching, or main has said no facts). */
  readonly is: LiveSimulatorState | null;
  /** The act its words offer — a device verb, `mint` (its lane lost) — null: none. */
  readonly act: SimulatorAct | null;
  /** Main's facts: where the device is, the act main runs now, the crop fallen back to the whole window (R6). */
  readonly condition: LiveSurfaceSimulatorConditionV1 | null;
  readonly acting: LiveSurfaceDeviceVerbV1 | null;
  readonly degraded: boolean;
  /** PT-S3 (D4) — and the device main ATTACHED, as its facts say it: its name as simctl says it (with no device, its
   * type's), its type and its runtime (R3: not the binding's where this Mac lacks the bound one) — null: unsaid. Never a
   * UDID: main's facts carry none. */
  readonly name: string | null;
  readonly deviceType: CoreSimulatorDeviceTypeIdV1 | null;
  readonly runtime: CoreSimulatorRuntimeIdV1 | null;
}

/** A page's favicon as a face's words carry it (`LiveInfo.extra.favicon`): a key to compare, the image's type, its bytes. */
export interface LiveFavicon {
  readonly key: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

/** One open face as a smoke reads it. */
export interface DeskLiveFaceRow {
  readonly key: string;
  /** PT-S2: what the face shows — a page, or a bound Simulator. */
  readonly source: LiveFaceSource;
  /** The kind's last ask (undefined before its law has spoken: paused). */
  readonly demand: LiveDemand | undefined;
  /** What the pool last wrote to the wire for the page — LSF's demand — null before any. */
  readonly wire: LiveSurfaceDemandV1 | null;
  /** PT-6a (M14 — R3): the surface the page is (the pool's attachment; null: none) — by which main's census counts its own
   * frame sessions. */
  readonly surface: string | null;
  readonly state: LiveState;
  /** The face's words — the page's address, title, loading line, history reach (what the kind's head reads) — less their
   * `extra` (a favicon's bytes are not a row's to carry: its key is, below). */
  readonly info: LiveInfo;
  /** PT-4: the favicon's key (null: none); the page's label — its title, else the spec's; the device it was last told. */
  readonly favicon: string | null;
  readonly label: string;
  /** null: a face that never opened a page (refused). */
  readonly emulation: LiveSurfaceBrowserEmulationV1 | null;
  /** Frames the attachment told of; frames presented into the texture; frames taken and closed unseen. */
  readonly arrivals: number;
  readonly presented: number;
  readonly dropped: number;
  /** PT-3: inputs this face sent, and the last one's kind — a smoke's witness that a page in hand was told. */
  readonly inputs: number;
  readonly lastInput: LiveInput["kind"] | null;
  /** The face's texture: its size, its present count, its generation (a remade texture is a new epoch) — and (PT-5b) the
   * bytes it holds on the device, every level counted: what its kind charges the desk's budget. */
  readonly texture:
    | {
        readonly width: number;
        readonly height: number;
        readonly revision: number;
        readonly epoch: number;
        readonly bytes: number;
      }
    | undefined;
  /** PT-5a: the texture is HIDDEN (`texture()` answers none) — it holds what no face may show (the engine's own error page,
   * a page from before it failed) until a frame of the page that follows lands; and the serial of the last thing the page
   * asked for and was refused (0: nothing). */
  readonly veiled: boolean;
  readonly refused: number;
  /** PT-5c2 (F7): the texture shown is of the document the page is at NOW — the hand's input goes. False between a
   * commit and the new document's first frame (the face still showing the one before), through a still, and with nothing
   * shown: a smoke that presses after a navigation waits for it. */
  readonly current: boolean;
  /** PT-5a (ruling 8): how many times a favicon's BYTES arrived on the page's attachment — once a key, whatever the summaries. */
  readonly faviconBytes: number;
  /** PT-5b: its page is ALIVE as the cap counts it; the service put it to REST. */
  readonly alive: boolean;
  readonly rested: boolean;
  /** PT-5b: the texture holds a STILL taken then (ms; null: a frame of the page, or nothing); and when this page's still
   * was last taken or read by this service (null: never). */
  readonly still: number | null;
  readonly stillAt: number | null;
  /** PT-S2: a bound Simulator's words and facts (null: a page's face); and the acts this face RAN. */
  readonly simulator: DeskLiveSimulatorRow | null;
  readonly acts: number;
}

export interface DeskLiveSources extends LiveSources {
  /** PT-3: what the desk lends under `BROWSER_NAVIGATION` — a page navigated by its face's key, never re-opened. */
  readonly navigation: BrowserNavigation;
  /** PT-4 (ruling 5): what the page behind `key` is called — its title, else its spec's label (the address as its kind
   * prints it); undefined with no page open for the key. */
  label(key: string): string | undefined;
  stats(): DeskLiveStats;
  /** The faces open now — a smoke's witness of the law's asks, the source's pace and the texture's life. */
  faces(): readonly DeskLiveFaceRow[];
  /**
   * PT-5a (ruling 5) — the desk's loop parked (`true`: every page paused, and so silent) or running again (`false`: each
   * page asked for what its face LAST asked). The same word twice is nothing.
   */
  park(parked: boolean): void;
  /** PT-5b (ruling 3) — the most pages alive at once: read, or (the TEST door) lowered or raised — the plan is made again. */
  cap(next?: number): number;
  /** PT-5b — whatever the service has in flight (a still being taken, kept or laid; a page being put to rest) is done. */
  settled(): Promise<void>;
  /** Every face closed (the mount is going). */
  dispose(): void;
}

/** LSF's fps buckets — the nearest not above `fps`; a live ask is never under the first rate (2). */
export function fpsBucket(fps: number, live: boolean): LiveSurfaceFpsBucketV1 {
  if (!live) return 0;
  let best: LiveSurfaceFpsBucketV1 = 2;
  for (const b of LIVE_SURFACE_FPS_BUCKETS_V1) if (b > 0 && b <= fps) best = b;
  return best;
}

/** THE DEMAND MAP (ruling 5): the kind's `LiveDemand` in the pool's words. */
export function liveDemandIntent(d: LiveDemand): SurfaceDemandIntent {
  const logicalViewport =
    d.viewport === undefined ? undefined : { width: d.viewport[0], height: d.viewport[1] };
  if (d.mode === "paused")
    return {
      mode: "paused",
      targetFps: 0,
      priority: 0,
      interactive: false,
      ...(logicalViewport === undefined ? {} : { logicalViewport }),
    };
  const raster =
    d.raster[0] >= 1 && d.raster[1] >= 1
      ? { width: Math.round(d.raster[0]), height: Math.round(d.raster[1]) }
      : undefined;
  return {
    mode: "live",
    targetFps: fpsBucket(d.fps, true),
    ...(raster === undefined ? {} : { targetRasterSize: raster }),
    ...(logicalViewport === undefined ? {} : { logicalViewport }),
    priority: d.interactive ? 80 : 50,
    interactive: d.interactive,
  };
}

/** How a failed face is tried again: the pool mints its page anew (a lost lane), or the page is asked to load again. */
export interface LiveRetries {
  readonly mint: () => void;
  readonly reload: () => void;
}

/**
 * The face's state, read off the pool's handle and the producer's summary. PT-5a (ruling 3) — A PAGE'S FAILURES ARE SAID,
 * each in the SDK's words (`LIVE_BROWSER_FAILURES`, the producer's own message after them for a diagnostic):
 *  - its LOAD failed (`browser.failure` — the producer is alive, behind the engine's own error page, which no face shows):
 *    the load's reason; `retry` reloads (the engine asks for the failed address again);
 *  - the page STOPPED (`failed`: `producer-crashed` — its process gone; `frame-stalled` the person's to recover — unresponsive
 *    past the producer's bound): `retry` reloads, and the producer starts again where the page was;
 *  - a source that cannot be brought back (`permanent`) may not be: no `retry`; any other failure: `failed`, `retry` reloads;
 *  - the lane is LOST: `retry` mints it again.
 */
export function liveStateOf(
  state: SurfaceHandleState<ProductSurfaceFrame>,
  retries: LiveRetries,
): LiveState {
  switch (state.status) {
    case "attaching":
      return { is: "starting" };
    case "released":
      return { is: "closed" };
    case "lost":
      return {
        is: "failed",
        reason: liveBrowserFailureReason("lost", state.error?.message),
        retry: retries.mint,
      };
    case "live": {
      const summary = state.presentation?.summary;
      if (summary?.state === "closed") return { is: "closed" };
      if (summary?.state === "failed") {
        const error = summary.error;
        if (error?.recovery === "permanent")
          return { is: "failed", reason: liveBrowserFailureReason("may-not", error.message) };
        const word: LiveBrowserFailure =
          error?.code === "producer-crashed"
            ? "stopped"
            : error?.code === "frame-stalled" && error.recovery === "user-action"
              ? "unresponsive"
              : error?.code === "source-not-found"
                ? "load-failed"
                : "failed";
        return {
          is: "failed",
          reason: liveBrowserFailureReason(word, error?.message),
          retry: retries.reload,
        };
      }
      const failure = state.browser?.failure;
      if (failure !== undefined)
        return {
          is: "failed",
          // (the contract's `failed` and `stopped` are a LOAD's: the SDK says them `load-failed` and `load-stopped` — its
          // own `stopped` is a page whose process is gone)
          reason: liveBrowserFailureReason(
            failure.reason === "failed"
              ? "load-failed"
              : failure.reason === "stopped"
                ? "load-stopped"
                : failure.reason,
          ),
          retry: retries.reload,
        };
      switch (summary?.state) {
        case undefined:
        case "created":
        case "starting":
        case "reconnecting":
          return { is: "starting" };
        case "live":
          return { is: "live" };
        default:
          // paused, hibernated: the last frame holds
          return { is: "paused" };
      }
    }
  }
}

/** PT-5a: is the face's page one whose frames no face may show — its load failed (the engine's own error page), it stopped,
 * its lane is lost? */
const failing = (state: SurfaceHandleState<ProductSurfaceFrame>): boolean =>
  state.status === "lost" ||
  state.presentation?.summary.state === "failed" ||
  state.browser?.failure !== undefined;

/** LSF reports a page loading, not how far: an indeterminate line (half way). */
const LOADING = 0.5;

/** The face's words, read off the producer's committed navigation truth (`LiveSurfaceBrowserStateV1`). */
export function liveInfoOf(state: SurfaceHandleState<ProductSurfaceFrame>): LiveInfo {
  const b = state.browser;
  const degraded =
    state.presentation?.summary.transport === "cpu-bgra" ? { degraded: "cpu-bitmap" } : {};
  if (b === null) return degraded;
  return {
    address: b.url,
    ...(b.title === undefined ? {} : { title: b.title }),
    ...(b.loading ? { loading: LOADING } : {}),
    back: b.canGoBack,
    forward: b.canGoForward,
    ...(b.cursor === undefined ? {} : { cursor: b.cursor }),
    ...degraded,
  };
}

/** The pointer's button in LSF's words (DOM's numbering: 0 the primary, 1 the middle, 2 the secondary). */
const BUTTONS = ["left", "middle", "right"] as const;

/** What CDP calls the modifiers, from the face's mask (Alt 1, Ctrl 2, Meta 4, Shift 8 — `LiveInput` key's `mods`). */
const modifiersOf = (mods: number) => ({
  alt: (mods & 1) !== 0,
  ctrl: (mods & 2) !== 0,
  meta: (mods & 4) !== 0,
  shift: (mods & 8) !== 0,
});

/** The longest text one input carries (the wire's and the producer's bound): longer is sent in pieces. */
const TEXT_MAX = 16_384;

/**
 * A face's input in LSF's words (PT-3 ruling 3) — in the displayed frame's logical px, held inside its `[w, h]` (the producer
 * refuses a point outside it); what the wire cannot carry (a key name past its bound, a text past its own in pieces) is
 * said as LSF can say it, or not at all.
 */
export function liveInputEvents(
  e: LiveInput,
  logical: readonly [number, number],
): readonly LiveSurfaceInputEventV1[] {
  const at = (x: number, y: number) => ({
    x: Math.min(Math.max(x, 0), logical[0]),
    y: Math.min(Math.max(y, 0), logical[1]),
  });
  switch (e.kind) {
    case "pointer": {
      const button = BUTTONS[e.button];
      return [
        {
          kind: "pointer",
          action: e.phase,
          ...at(e.x, e.y),
          ...(e.phase === "move" || button === undefined ? {} : { button }),
          ...(e.phase === "move" ? {} : { clickCount: Math.min(Math.max(e.count, 1), 3) }),
          ...(e.buttons > 0 ? { buttons: Math.min(e.buttons, 31) } : {}),
        },
      ];
    }
    case "wheel":
      return [
        {
          kind: "wheel",
          ...at(e.x, e.y),
          deltaX: Math.min(Math.max(e.dx, -100_000), 100_000),
          deltaY: Math.min(Math.max(e.dy, -100_000), 100_000),
        },
      ];
    case "key":
      if (e.key.length < 1 || e.key.length > 32 || e.code.length < 1 || e.code.length > 64)
        return [];
      return [
        {
          kind: "key",
          action: e.phase,
          key: e.key,
          code: e.code,
          modifiers: modifiersOf(e.mods),
          ...(e.repeat ? { autoRepeat: true } : {}),
        },
      ];
    case "text": {
      const pieces: LiveSurfaceInputEventV1[] = [];
      for (let i = 0; i < e.text.length; i += TEXT_MAX)
        pieces.push({ kind: "text", text: e.text.slice(i, i + TEXT_MAX) });
      return pieces;
    }
    case "compose": {
      const text = e.text.slice(0, TEXT_MAX);
      return [{ kind: "compose", text, caret: Math.min(Math.max(e.caret, 0), text.length) }];
    }
  }
}

/** What a face says, as one string — so the handle's every publish is not a change of the face's words. */
const wordsOf = (state: SurfaceHandleState<ProductSurfaceFrame>): string =>
  JSON.stringify([
    state.status,
    state.presentation?.summary.state ?? null,
    state.browser,
    state.error?.message ?? null,
  ]);

/** A face that cannot open — the desk MAY NOT (PT-5a: said in the SDK's word, the gate's own after it; nothing to try
 * again): its state says why; it takes nothing, draws its film, closes to nothing. PT-S2: its words are `info` (a bound
 * Simulator's state where the host knows it — `no-simulator` in a window with no live surfaces). */
function failedFace(
  key: string,
  reason: string,
  release: () => void,
  info: LiveInfo = {},
): LiveFace {
  let closed = false;
  return {
    key,
    texture: () => undefined,
    take: () => false,
    state: () =>
      closed
        ? { is: "closed" }
        : { is: "failed", reason: liveBrowserFailureReason("may-not", reason) },
    info: () => (closed ? {} : info),
    demand: () => {},
    close() {
      if (closed) return;
      closed = true;
      release();
    },
  };
}

/** A frame's logical size as ICE's writer takes it — each side finite and > 0 (the writer refuses any other), or none. */
const logicalOf = (size: {
  readonly width: number;
  readonly height: number;
}): readonly [number, number] | undefined =>
  Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
    ? [size.width, size.height]
    : undefined;

/** The face's page in the pool: apart from any panel's (ruling 4). */
const POOL_PREFIX = "desk:";
const poolKey = (key: string): string => `${POOL_PREFIX}${key}`;

/** THE DESK'S BROWSER PROFILE (PT-4 ruling 3): every desk page's — one persistent session, as the tabs of one browser share
 * theirs. Main keeps it under the user's data by an opaque name (`LAYOUT.BROWSER_PROFILES_DIR`), apart from the shell's.
 * Declared once, in contracts (`BROWSER_DESK_PROFILE_REF`): main names the profile Settings' Clear browsing data clears by
 * it (BP-D4). */
export const DESK_PROFILE = BROWSER_DESK_PROFILE_REF;

/**
 * THE PAGE AS A DEVICE SEES IT (PT-4 rulings 1–2): the spec's device and scheme in LSF's words — its density, a phone's or a
 * tablet's layout, its fingers, the agent it announces with its hints (none named: the producer's engine's own), and the
 * colour scheme the page is told (the kind has already resolved the desk's).
 */
export function emulationOf(page: LiveBrowserSpec): LiveSurfaceBrowserEmulationV1 {
  const agent = page.device?.agent ?? null;
  return {
    deviceScaleFactor: page.deviceScaleFactor,
    mobile: page.device?.mobile ?? false,
    touchPoints: page.device?.touchPoints ?? 0,
    ...(agent === null
      ? {}
      : {
          agent: {
            userAgent: agent.userAgent,
            navigatorPlatform: agent.navigatorPlatform,
            hints: {
              platform: agent.platform,
              platformVersion: agent.platformVersion,
              architecture: "",
              model: agent.model,
              mobile: page.device?.mobile ?? false,
            },
          },
        }),
    colorScheme: page.scheme,
  };
}

/** LSF's browser source for a page: the desk's one profile, laid out at the page's viewport at its device's density (LSF
 * sizes its frame by the two multiplied, and lays the page out at the viewport), born on its device. */
function browserSource(page: LiveBrowserSpec) {
  return {
    kind: "browser" as const,
    initialUrl: page.url,
    // PT-5a: a desk page that stops is SAID to have stopped, and waits for its reload — never restarted behind the person
    whenStopped: "say" as const,
    profile: { mode: "persistent" as const, ref: DESK_PROFILE },
    logicalViewport: { width: page.viewport[0], height: page.viewport[1] },
    deviceScaleFactor: page.deviceScaleFactor,
    emulation: emulationOf(page),
  };
}

/** PT-5a: what the page asked for and may not have, as the face's words carry it (`LiveBrowserRefusal`) — a refused
 * permission with its word (BP-D1). */
const refusalOf = (
  refused: NonNullable<LiveSurfaceBrowserStateV1["refused"]>,
): LiveBrowserRefusal =>
  refused.what === "permission"
    ? { what: "permission", permission: refused.permission, serial: refused.serial }
    : { what: "download", serial: refused.serial };

/** A favicon's bytes out of the state's base64 (PT-5a: the pool's summary is whole — a favicon it names has its bytes; one
 * that came without them, which the attachment never lets through, is none). */
function faviconOf(icon: NonNullable<LiveSurfaceBrowserStateV1["favicon"]>): LiveFavicon | null {
  if (icon.data === undefined) return null;
  const raw = atob(icon.data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return { key: icon.key, type: icon.mediaType, bytes };
}

/** What a parked desk asks of a page: paused — no frames, and (LSF's rule) no sound — its layout kept. */
const PARKED = { mode: "paused", fps: 0, raster: [0, 0], interactive: false } as const;

/** PT-5b: what a page AT REST is asked — hibernated: its WebContents gone, its address kept by its producer. */
const restIntent = (viewport?: readonly [number, number]): SurfaceDemandIntent => ({
  mode: "hibernated",
  targetFps: 0,
  priority: 0,
  interactive: false,
  ...(viewport === undefined
    ? {}
    : { logicalViewport: { width: viewport[0], height: viewport[1] } }),
});

/** PT-5b: at rest in view a page's still is retaken at most this often, and only when a frame arrived since the last. */
export const PAGE_STILL_EVERY_MS = 30_000;
/** …and no sooner than this after the first frame since the last (nor while the page says it is loading). */
export const PAGE_STILL_SETTLE_MS = 1_500;
/** A page is put to rest whether or not its still could be taken in this long (a device lost under the read). */
export const PAGE_STILL_TAKE_MAX_MS = 1_500;
/** A lane still being attached holds a slot against the seen pages for this long at most (its page may be alive already). */
export const LIVE_ATTACH_HOLD_MS = 3_000;
/** A let-go page asked to rest is taken to have rested after this long, whatever it says. */
const GHOST_REST_WAIT_MS = 2_000;

/** PT-5b: two addresses as ONE page's — the same once the platform has normalised each (a bare origin's slash, a host's case). */
export function sameAddress(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

/** PT-5b: is the page alive by its producer's own word (a WebContents: starting, live, paused, reconnecting)? */
const aliveBySummary = (state: SurfaceHandleState<ProductSurfaceFrame>): boolean => {
  if (state.status !== "live") return false;
  const s = state.presentation?.summary.state;
  return s === "starting" || s === "live" || s === "paused" || s === "reconnecting";
};

/**
 * PT-6a (M10 A6): the bound on a page's LAST WORD after a load that showed nothing — the refusal of a download the load began:
 * the session's guard cancels it and says so, a moment after the load's end (g-fl: a refusal heard after an immediate let-go
 * was dropped with the window). A page is let go at that refusal; one that refuses nothing (an empty answer, a stop) at this
 * bound. No signal says a download is still pending: the refusal is the item's whole life (`will-download`, cancelled at once).
 */
export const NOTHING_SHOWN_BOUND_MS = 2_000;

/**
 * PT-6a (M7 A6) — A LOAD THAT ENDED WITH NOTHING SHOWN: no document of the page came (an attachment, an empty answer) or the
 * person stopped it before anything did — its failure said while no document stands (`starting`), or kept by a page let go
 * for it (`hibernated`). Its window shows nothing a face may show: the service lets the page go (asks it `hibernated`, and main
 * lets it go as a rest does), its words kept; a new address — a go, the face's ↻ — clears the failure, and its pane's ask is
 * written again. (Before: it kept its window and the cap's slot, for nothing shown.)
 */
const nothingShown = (state: SurfaceHandleState<ProductSurfaceFrame>): boolean => {
  if (state.status !== "live") return false;
  const reason = state.browser?.failure?.reason;
  const summary = state.presentation?.summary.state;
  return (
    (reason === "no-document" || reason === "stopped") &&
    (summary === "starting" || summary === "hibernated")
  );
};

/** A still as a face's words say it. */
const stillOf = (takenAt: number, at: number): LiveBrowserStill => ({
  takenAt,
  age: Math.max(0, at - takenAt),
});

/** A page that is let go and at rest is never minted again by the service's own hand. */
const NO_MINT = {
  mint: (): Promise<never> => Promise.reject(new Error("a page at rest is not minted")),
  async close(): Promise<void> {},
};

/** One open page as the service holds it: what the mount's verbs and the cap's plan reach. */
interface Lane {
  readonly key: string;
  /** PT-S2: what it shows — the page verbs (`navigate`, `respec`) reach a browser lane only. */
  readonly source: LiveFaceSource;
  /** PT-S2: its pool entry less the desk's prefix — a page's is its key; a bound Simulator's its key and its binding (a phone
   * bound anew is another entry: the stream the pool's grace keeps of the device it left is a let-go one, never its own). */
  readonly entry: string;
  readonly handle: SurfaceHandle<ProductSurfaceFrame>;
  /** When its lane was asked for (a lane still attaching holds a slot for `LIVE_ATTACH_HOLD_MS` from then). */
  readonly openedAt: number;
  respec(page: LiveBrowserSpec): void;
  label(): string;
  /** What goes down the wire now: the kind's ask, held by the park and by the cap. */
  send(): void;
  /** PT-5b — the cap's read of it, and its words: woken, adopted as it stands, put to rest (its still taken first). */
  capFace(): CapFace;
  adoptable(): boolean;
  /** PT-6a (M15 — V1): its page came back UNASKED (main restarted it after a stop) and the plan has not woken it. */
  unasked(): boolean;
  wake(): void;
  /** True: its ask had been held back, and goes down the wire now. */
  adopt(): boolean;
  rest(): Promise<void>;
  /** PT-5b — its texture let go (the budget's word): the film, or its still when it is next seen. */
  evict(): boolean;
  /** PT-5b — the pane was sent to another address (`go`): a still of the one it left is not shown. */
  went(url: string): void;
  /** PT-S2 — a bound Simulator's act, run when its face's words still offer it (a press on words that moved is nothing). */
  act?(act: SimulatorAct): void;
}

/** How much a pane's ask holds the page: a rest that a pick-up or a look overtook is not done. */
const RANK = { unseen: 0, seen: 1, held: 2 } as const;

/**
 * PT-5b, PT-6a — ONE LANE'S SEAT AT THE CAP, whatever its source shows (a page, a bound Simulator: PT-S2 — so the cap's fixes
 * are made in ONE place): the service lets its source be alive (it woke it, or took it as it stood); it put it to REST (its
 * wire `hibernated`); it is putting it to rest now (its still being taken); PT-6a (M15 — V1) it STOPPED since the plan last
 * woke it — a source main restarts by itself came back UNASKED: never adopted, it is woken into a free slot or put to rest,
 * never another seen face's slot-taker; and when its object was last SEEN (from a live ask until its ask leaves `live`).
 */
interface Seat {
  allowed: boolean;
  rested: boolean;
  resting: boolean;
  stoppedSinceWake: boolean;
  seenAt: number;
  want(): CapFace["want"];
  /** PT-6a (M15 — V1): alive by its summary, back unasked since its stop — the plan's to wake or to rest (one being put
   * to rest, or rested, is leaving: not this). */
  unasked(): boolean;
  /** Alive: the service lets it be — or it is alive as it stands (a page re-bound; one whose window is still going). */
  alive(): boolean;
  capFace(): CapFace;
  adoptable(): boolean;
  wake(): void;
  /** True: its ask had been held back, and goes down the wire now. */
  adopt(): boolean;
  /** The kind asked `d` (`was` before it) — PT-5b2 (ruling 8): LAST SEEN is stamped at a live ask and when one ends (asks
   * are change-only: stamped at a live ask alone, a pane watched for ten minutes read as last seen ten minutes ago). */
  saw(was: LiveDemand | undefined, d: LiveDemand): void;
  /** PT-6a (M14, R1): its source STOPPED — it gives back the cap's permission: its slot is another's now, and coming back it
   * waits for the plan's wake (a free slot, or the hand). */
  stop(): void;
  /** What goes down its wire: put to rest (or `gone` — a page let go for showing nothing), hibernated; the desk parked, or a
   * seen face the cap makes wait, paused as it was made (nothing is made of it); else the kind's own ask. */
  intent(viewport: readonly [number, number] | undefined, gone: boolean): SurfaceDemandIntent;
  /** PUT TO REST — its still `take`n first (bounded by `PAGE_STILL_TAKE_MAX_MS`). False: it stays (closed, being rested
   * already, or picked up or seen while its still was taken — the plan is made again); true: rested, its wire to be sent. */
  rest(take: () => Promise<unknown>): Promise<boolean>;
}

/**
 * PT-5b — ONE FACE'S STILL CLOCK (a page's, a bound Simulator's): whether a live frame landed since its still was last taken
 * (`fresh`), when that was (`at` — or read off the shelf; −∞: never), the take, and the timer that asks for one at rest.
 */
interface StillClock {
  fresh: boolean;
  at: number;
  take(): Promise<boolean>;
  arm(): void;
  stop(): void;
}

/** The service's timers (the host's, or a test's clock). */
type LiveTimers = NonNullable<DeskLiveDeps["timers"]>;

/**
 * PT-6a (M7 B6) — THE WINDOW'S forget timers: by its shelf of page stills (one a window, `pageStills()`), each pane's key's ONE
 * timer — the newest delete's, whichever mount made it, with the clock that set it. An open in ANY mount cancels it. (Before:
 * each mount kept its own; a pane deleted, its mount gone, undone and deleted again in the next mount left the first timer
 * to forget the still ten seconds into the second grace.)
 */
const forgetTimers = new WeakMap<
  object,
  Map<string, { readonly timers: LiveTimers; handle: unknown }>
>();

export function createDeskLiveSources(deps: DeskLiveDeps): DeskLiveSources {
  /** PT-5a: the desk's loop is parked — every page is held paused until it runs again. */
  let parked = false;
  /** PT-5b: the most pages alive at once (the policy's one constant, unless the test door lowered it). */
  let cap = LIVE_PAGES_MAX;
  let disposed = false;
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? {
    set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
    clear: (h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const graceMs = deps.graceMs ?? (() => SURFACE_POOL_GRACE_MS);
  const faces = new Map<string, { face: LiveFace; row: () => DeskLiveFaceRow }>();
  const counts = {
    opened: 0,
    refused: 0,
    presented: 0,
    dropped: 0,
    demands: 0,
    writers: 0,
    inputs: 0,
    inputsUnsent: 0,
    navigations: 0,
    navigationsRefused: 0,
    respecs: 0,
    parks: 0,
    emulations: 0,
    rests: 0,
    wakes: 0,
    stillsTaken: 0,
    stillsShown: 0,
    stillsForgotten: 0,
    evictions: 0,
    acts: 0,
  };
  /** The open pages' lanes by key (a failed face has none): what `navigate` and `respec` reach, and what a page is called. */
  const lanes = new Map<string, Lane>();
  /** PT-S2: a lane holds the pool entry `entry` (a page's is its key; a bound Simulator's its key and its binding). */
  const laneHolds = (entry: string): boolean => {
    for (const lane of lanes.values()) if (lane.entry === entry) return true;
    return false;
  };
  /** PT-5b: what is in flight — a still being taken, kept, read or shown; a page being put to rest (a test's wait). */
  const inflight = new Set<Promise<unknown>>();
  const track = <T>(work: Promise<T>): Promise<T> => {
    inflight.add(work);
    const done = (): void => {
      inflight.delete(work);
    };
    work.then(done, done);
    return work;
  };
  /** PT-5b: deleted panes' stills, each forgotten when its page's grace lapses (an undo within it cancels). */
  const forgetting = ((): Map<string, { readonly timers: LiveTimers; handle: unknown }> => {
    const shelf = deps.stills;
    if (shelf === undefined) return new Map();
    let held = forgetTimers.get(shelf);
    if (held === undefined) {
      held = new Map();
      forgetTimers.set(shelf, held);
    }
    return held;
  })();
  /**
   * PT-5b — THE PAGES LET GO: a face that closes lets its lane go, and the pool's grace keeps the page (a deleted pane's, an
   * undo away; another mount's) — ALIVE, so counted. What this service knows of each it let go (when it was last seen,
   * whether it was alive), those it has put to rest since, and those being put to rest now.
   */
  const gone = new Map<string, { readonly seenAt: number; readonly alive: boolean }>();
  const ghostsRested = new Set<string>();
  const ghostsResting = new Set<string>();
  /** A lane's wire and surface, by its pool entry (`Lane.entry`). */
  const wireOf = (entry: string): LiveSurfaceDemandV1 | null =>
    deps
      .pool()
      ?.snapshot()
      .entries.find((e) => e.key === poolKey(entry))?.demand ?? null;
  const surfaceOf = (entry: string): string | null =>
    deps
      .pool()
      ?.snapshot()
      .entries.find((e) => e.key === poolKey(entry))?.surfaceId ?? null;

  /** The let-go pages the pool still keeps, as the cap reads them — each by its pool entry (PT-S2: a bound Simulator's let
   * go is its key and its binding). */
  const ghosts = (): CapFace[] => {
    const rows: CapFace[] = [];
    const kept = new Set<string>();
    for (const entry of deps.pool()?.snapshot().entries ?? []) {
      if (!entry.key.startsWith(POOL_PREFIX)) continue;
      const key = entry.key.slice(POOL_PREFIX.length);
      kept.add(key);
      if (laneHolds(key)) continue;
      const seenAt = gone.get(key)?.seenAt ?? Number.NEGATIVE_INFINITY;
      const row = {
        key,
        want: "unseen",
        seenAt,
        far: Number.POSITIVE_INFINITY,
        ghost: true,
      } as const;
      if (ghostsResting.has(key)) {
        rows.push({ ...row, alive: true, fixed: true });
        continue;
      }
      // held by nobody, its lane attached: a page in its grace — alive unless this service knows better
      if (entry.holders !== 0 || entry.status !== "live") continue;
      if (ghostsRested.has(key) || gone.get(key)?.alive === false) continue;
      rows.push({ ...row, alive: true });
    }
    for (const key of [...gone.keys()]) if (!kept.has(key)) gone.delete(key);
    for (const key of [...ghostsRested]) if (!kept.has(key)) ghostsRested.delete(key);
    return rows;
  };
  /** A let-go page PUT TO REST (its slot is wanted): asked hibernated through a lane of the service's own, let go again
   * once it says so. Its still is the last one taken while its pane stood (nothing is read of a page nobody shows). */
  const restGhost = (key: string): Promise<void> => {
    const pool = deps.pool();
    if (pool === null || ghostsResting.has(key)) return Promise.resolve();
    let handle: SurfaceHandle<ProductSurfaceFrame>;
    try {
      handle = pool.acquire(poolKey(key), { initialDemand: restIntent(), tickets: NO_MINT });
    } catch {
      return Promise.resolve();
    }
    ghostsResting.add(key);
    return new Promise<void>((resolve) => {
      let over = false;
      let off: (() => void) | undefined;
      let timer: unknown = null;
      const done = (): void => {
        if (over) return;
        over = true;
        if (timer !== null) timers.clear(timer);
        off?.();
        handle.release();
        ghostsResting.delete(key);
        // (a pane back on the desk meanwhile — an undo — is a lane's again, and no ghost)
        if (!laneHolds(key)) ghostsRested.add(key);
        counts.rests += 1;
        resolve();
      };
      timer = timers.set(done, GHOST_REST_WAIT_MS);
      off = handle.onState((state) => {
        if (state.status !== "attaching" && !aliveBySummary(state)) done();
      });
      if (over) off();
    });
  };

  /** One timer for the plan made again by itself: a lane's attach hold lapsing. */
  let planTimer: unknown = null;
  let planDue = Number.POSITIVE_INFINITY;
  const planAt = (due: number): void => {
    if (!Number.isFinite(due) || (planTimer !== null && due >= planDue)) return;
    if (planTimer !== null) timers.clear(planTimer);
    planDue = due;
    planTimer = timers.set(
      () => {
        planTimer = null;
        planDue = Number.POSITIVE_INFINITY;
        replan();
      },
      Math.max(0, due - now()) + 20,
    );
  };

  /**
   * PT-5b — THE CAP, DONE (live-cap.ts is its policy): read every page, plan, and do what can be done NOW — a page alive
   * as it stands is the service's; a wake into a free slot (the held page's whatever it costs); a rest is begun (its still
   * first) and the wake it makes room for follows when the page it rests is gone. A parked desk plans nothing (its kinds
   * cannot ask). `asking`: the lanes whose ask moved — each one's wire is written once, whatever the plan said; `all`:
   * every lane's.
   */
  function replan(opts: { readonly asking?: readonly Lane[]; readonly all?: boolean } = {}): void {
    if (disposed) return;
    const touched = new Set<Lane>(opts.all === true ? lanes.values() : (opts.asking ?? []));
    if (!parked) {
      const all = [...lanes.values()];
      const rows = [...all.map((lane) => lane.capFace()), ...ghosts()];
      const plan = capPlan(rows, cap);
      const going = new Set(plan.rest);
      for (const lane of all) {
        if (!lane.adoptable() || going.has(lane.key)) continue;
        // (its wire moves only where the cap had held its ask back)
        if (lane.adopt()) touched.add(lane);
      }
      const want = new Map(rows.map((row) => [row.key, row.want]));
      let room = cap - rows.filter((row) => row.alive).length;
      for (const key of plan.wake) {
        const lane = lanes.get(key);
        if (lane === undefined) continue;
        if (want.get(key) !== "held") {
          // its slot is being made: the rest's end plans again
          if (room <= 0) continue;
          room -= 1;
        }
        lane.wake();
        touched.add(lane);
      }
      for (const key of plan.rest) {
        const lane = lanes.get(key);
        const rested = lane === undefined ? restGhost(key) : lane.rest();
        void track(rested.then(() => replan()));
      }
      // PT-6a (M15 — V1): a page that came back UNASKED (main restarted it after a stop) and that the plan does not wake —
      // no slot free, or unseen — is the page put to rest, never another seen one's slot given for it
      const woken = new Set(plan.wake);
      for (const lane of all) {
        if (!lane.unasked() || woken.has(lane.key)) continue;
        void track(lane.rest().then(() => replan()));
      }
      // a page waits on a lane that has not said: asked again when that lane's hold lapses
      if (plan.waiting.length > 0)
        planAt(
          Math.min(
            ...all
              .filter((lane) => lane.capFace().unknown === true)
              .map((lane) => lane.openedAt + LIVE_ATTACH_HOLD_MS),
          ),
        );
    }
    // a parked desk's pages stay paused whatever is asked: nothing is written but the park's own word
    if (!parked || opts.all === true) for (const lane of touched) lane.send();
  }

  /** The lanes whose ask moved this tick and waits for its end (see `ask`). */
  const asking = new Set<Lane>();
  let askQueued = false;
  /**
   * A pane's ask MOVED. Where every page can be alive (no more lanes than the cap) — and always for the page in the hand —
   * the plan is made at once. Else once, at the end of the tick: a desk zoomed out over twenty panes asks for them one by
   * one in one tick, and it is the six NEAREST the view's centre that are woken, not the first six that asked.
   */
  const ask = (lane: Lane, urgent: boolean): void => {
    if (urgent || lanes.size <= cap) {
      replan({ asking: [lane] });
      return;
    }
    asking.add(lane);
    if (askQueued) return;
    askQueued = true;
    void track(
      Promise.resolve().then(() => {
        askQueued = false;
        const all = [...asking];
        asking.clear();
        replan({ asking: all });
      }),
    );
  };

  /** A face that may not open, said — PT-S2: of its source; a bound Simulator's with its state where the host knows it
   * (`said`: `no-simulator` in a window with no live surfaces). */
  const refuse = (
    key: string,
    reason: string,
    source: LiveFaceSource = "browser",
    said?: LiveSimulatorState,
  ): LiveFace => {
    counts.refused += 1;
    const face = failedFace(
      key,
      reason,
      () => faces.delete(key),
      said === undefined ? {} : { extra: { simulator: { is: said } } },
    );
    faces.set(key, {
      face,
      row: () => ({
        key,
        source,
        demand: undefined,
        wire: null,
        surface: null,
        state: face.state(),
        info: face.info(),
        favicon: null,
        label: "",
        emulation: null,
        arrivals: 0,
        presented: 0,
        dropped: 0,
        inputs: 0,
        lastInput: null,
        texture: undefined,
        veiled: false,
        refused: 0,
        current: false,
        faviconBytes: 0,
        alive: false,
        rested: false,
        still: null,
        stillAt: null,
        simulator:
          source === "browser"
            ? null
            : {
                is: said ?? null,
                act: null,
                condition: null,
                acting: null,
                degraded: false,
                name: null,
                deviceType: null,
                runtime: null,
              },
        acts: 0,
      }),
    });
    return face;
  };

  /** PT-5b, PT-6a — a lane's seat at the cap (`Seat`), its source's whatever it is: `stopped` — the plan has nothing to do
   * for it (a page failed, its lane lost, let go; PT-S2: a device that cannot stream). */
  const seatOf = (o: {
    readonly key: string;
    readonly handle: SurfaceHandle<ProductSurfaceFrame>;
    readonly openedAt: number;
    readonly asked: () => LiveDemand | undefined;
    readonly stopped: () => boolean;
    readonly closed: () => boolean;
  }): Seat => {
    const seat: Seat = {
      allowed: false,
      rested: false,
      resting: false,
      stoppedSinceWake: false,
      seenAt: Number.NEGATIVE_INFINITY,
      want: () => {
        const asked = o.asked();
        return asked === undefined || asked.mode !== "live"
          ? "unseen"
          : asked.interactive
            ? "held"
            : "seen";
      },
      unasked: () =>
        seat.stoppedSinceWake &&
        !seat.allowed &&
        !seat.rested &&
        !seat.resting &&
        !o.stopped() &&
        aliveBySummary(o.handle.state),
      alive: () =>
        !o.stopped() && !seat.unasked() && (seat.allowed || aliveBySummary(o.handle.state)),
      capFace: () => {
        const state = o.handle.state;
        return {
          key: o.key,
          want: seat.want(),
          alive: seat.alive(),
          seenAt: seat.seenAt,
          far: deps.far?.(o.key) ?? Number.POSITIVE_INFINITY,
          // being put to rest (its still being taken, its window going), or stopped: nothing is planned for it
          ...(seat.resting || o.stopped() || (!seat.allowed && seat.rested && aliveBySummary(state))
            ? { fixed: true }
            : {}),
          ...(!seat.allowed &&
          state.status === "attaching" &&
          now() - o.openedAt < LIVE_ATTACH_HOLD_MS
            ? { unknown: true }
            : {}),
        };
      },
      adoptable: () =>
        !seat.allowed &&
        !seat.rested &&
        !seat.resting &&
        !o.stopped() &&
        !seat.stoppedSinceWake &&
        aliveBySummary(o.handle.state),
      wake() {
        if (seat.allowed) return;
        seat.allowed = true;
        seat.rested = false;
        seat.stoppedSinceWake = false;
        counts.wakes += 1;
      },
      adopt() {
        seat.allowed = true;
        seat.rested = false;
        return o.asked()?.mode === "live";
      },
      saw(was, d) {
        if (d.mode === "live" || was?.mode === "live") seat.seenAt = now();
      },
      stop() {
        seat.allowed = false;
        seat.stoppedSinceWake = true;
      },
      intent(viewport, gone) {
        const asked = o.asked();
        return (!seat.allowed && seat.rested) || gone
          ? restIntent(viewport)
          : liveDemandIntent(
              parked || asked === undefined || (!seat.allowed && asked.mode === "live")
                ? { ...PARKED, ...(viewport === undefined ? {} : { viewport }) }
                : asked,
            );
      },
      async rest(take) {
        if (o.closed() || seat.resting) return false;
        seat.resting = true;
        const was = RANK[seat.want()];
        let bound: unknown = null;
        try {
          await Promise.race([
            take(),
            new Promise<void>((resolve) => {
              bound = timers.set(resolve, PAGE_STILL_TAKE_MAX_MS);
            }),
          ]);
        } finally {
          if (bound !== null) timers.clear(bound);
          seat.resting = false;
        }
        // picked up, or seen, while its still was taken: it stays (the plan is made again)
        if (o.closed() || RANK[seat.want()] > was) return false;
        seat.allowed = false;
        seat.rested = true;
        counts.rests += 1;
        return true;
      },
    };
    return seat;
  };

  /**
   * PT-5b — A FACE'S STILL CLOCK (`StillClock` — a page's; PT-S2 a bound Simulator's): THE STILL, TAKEN from what the face's
   * writer holds (its texture read back: still-taker.ts) and kept on the shelf with the `address` it is a photograph of (a
   * page's where it is NOW — an address that moved within the document is this document's; a Simulator's its binding). Only
   * a LIVE frame not yet photographed is: a quiet source writes nothing, a still is never taken of a still, and a failed
   * page's frames are not shown, so not kept. PT-5b2 (ruling 1), PT-5b3 (ruling 4) — only a texture that is `current` (a
   * page's: of the DOCUMENT the page is at — one of the document before, the document moved and no frame since, is not
   * photographed), and nothing while its source is `settling` (a page that says it is loading) — on every path (a put-down,
   * a rest, the timer). Refused so, the frame stays owed. At rest in view (`arm`): a still at most once every
   * `PAGE_STILL_EVERY_MS`, a little after the first frame since the last — and none of the face in the hand (`held`: its
   * put-down takes it, the best pixels it will have).
   */
  const stillClockOf = (o: {
    readonly key: string;
    readonly closed: () => boolean;
    readonly film: () => { readonly writer: LiveWriter; readonly device: GPUDevice } | undefined;
    readonly current: () => boolean;
    readonly settling: () => boolean;
    readonly address: () => string;
    readonly held: () => boolean;
  }): StillClock => {
    let timer: unknown = null;
    const clock: StillClock = {
      fresh: false,
      at: Number.NEGATIVE_INFINITY,
      take() {
        const stills = deps.stills;
        const take = deps.takeStill;
        const docId = deps.docId?.();
        const film = o.film();
        if (
          o.closed() ||
          stills === undefined ||
          take === undefined ||
          docId === undefined ||
          film === undefined ||
          // (a failed page's frames are not current: the failure said so, and no frame of it is taken since)
          !o.current() ||
          !clock.fresh ||
          o.settling()
        )
          return Promise.resolve(false);
        clock.fresh = false;
        const address = o.address();
        const face = film.writer.face;
        const logical: readonly [number, number] = [face.logical[0], face.logical[1]];
        const at = now();
        // PT-5b2 (ruling 5) — the thirty seconds run from the take's BEGINNING: a frame that lands while the texture is read
        // back and encoded arms the timer from here (before: from the still before — a second take 1.5 s after, for exactly
        // the pages that paint most). A still is counted taken when it is KEPT.
        clock.at = at;
        // PT-5b3 (ruling 7) — A TAKE THAT FAILED HAS A CLOCK OF ITS OWN: it answered no picture, it rejected, or its keep
        // failed — its frame is owed, and asked for again ONCE, thirty seconds after this take BEGAN, frame or no frame (a
        // put-down and a rest still ask at once). Before, the moment was given back: a quiet page was asked again by
        // nothing until its next frame, and a page that paints under a failure that lasts (a shelf that cannot be written:
        // a full disk) was read back and encoded every 1.5 s.
        const failed = (): false => {
          clock.fresh = true;
          clock.stop();
          clock.arm();
          return false;
        };
        return track(
          (async () => {
            const taken = await take(film.device, face);
            if (taken === undefined) return failed();
            await stills.keep(docId, o.key, {
              address,
              logical,
              size: taken.size,
              type: taken.type,
              image: taken.image,
              takenAt: at,
            });
            counts.stillsTaken += 1;
            return true;
          })().catch(failed),
        );
      },
      arm() {
        if (timer !== null || deps.stills === undefined || deps.takeStill === undefined) return;
        const due = Math.max(clock.at + PAGE_STILL_EVERY_MS, now() + PAGE_STILL_SETTLE_MS);
        timer = timers.set(
          () => {
            timer = null;
            if (o.closed() || !clock.fresh) return;
            // a source still settling is not yet what it will show: asked again in a moment
            if (o.settling()) return clock.arm();
            // in the hand its put-down takes it — the best pixels it will have
            if (o.held()) return;
            void clock.take();
          },
          Math.max(0, due - now()),
        );
      },
      stop() {
        if (timer !== null) timers.clear(timer);
        timer = null;
      },
    };
    return clock;
  };

  /** Is there a shelf to read a still off here — the stills, the document's id, the host's hand that decodes one? */
  const stillsKept = (): boolean =>
    deps.stills !== undefined && deps.decodeStill !== undefined && deps.docId?.() !== undefined;
  /**
   * PT-5b — THE SHELF'S STILL of a face's key, read and decoded for it: `mine` is asked before the decode and after it (the
   * face may have moved on meanwhile). PT-5b2 (ruling 9): a still is at most `PAGE_STILL_MAX_PX` on its long side — a picture
   * the shelf holds that is larger is none this desk took, and no texture of any size is made of it. Undefined: nothing to
   * lay (none kept, or not the face's); a still that cannot be read rejects.
   */
  const readStill = async (
    key: string,
    mine: (kept: PageStill) => boolean,
  ): Promise<{ readonly bitmap: ImageBitmap; readonly kept: PageStill } | undefined> => {
    const stills = deps.stills;
    const decode = deps.decodeStill;
    const docId = deps.docId?.();
    if (stills === undefined || decode === undefined || docId === undefined) return undefined;
    const kept = await stills.kept(docId, key);
    if (kept === undefined || !mine(kept)) return undefined;
    const bitmap = await decode(kept);
    if (!mine(kept) || Math.max(bitmap.width, bitmap.height) > PAGE_STILL_MAX_PX) {
      bitmap.close();
      return undefined;
    }
    return { bitmap, kept };
  };

  /** PT-5b — a DELETED object's still is forgotten when its source's grace lapses (an undo within it finds source and
   * still); one that only left this mount keeps its own. (PT-6a, M7 B6: the newest delete owns the key's one timer —
   * another's, of any mount, is cleared.) */
  const forgetLater = (key: string): void => {
    const stills = deps.stills;
    const docId = deps.docId?.();
    if (stills === undefined || docId === undefined || deps.exists?.(key) !== false) return;
    const was = forgetting.get(key);
    if (was !== undefined) was.timers.clear(was.handle);
    const entry: { readonly timers: LiveTimers; handle: unknown } = { timers, handle: null };
    entry.handle = timers.set(() => {
      forgetting.delete(key);
      if (deps.exists?.(key) !== false || deps.docId?.() !== docId) return;
      counts.stillsForgotten += 1;
      void track(stills.forget(docId, key).catch(() => undefined));
    }, graceMs());
    forgetting.set(key, entry);
  };

  /** A lane's TICKETS: its mint rides the WINDOW's product connection, as the plugin door's does (surface-door.tsx) — made
   * of what `params` says when it MINTS (a mint after a loss is made of the spec as it stands then) — and its close. */
  const ticketsOf = (params: () => Readonly<Record<string, unknown>>): SurfaceTicketSource => ({
    async mint() {
      const client = deps.mintClient();
      if (client === null) throw new Error("no fieldd connection (daemon away or still booting)");
      const raw = await client.request("surface.open", params());
      const opened = SurfaceOpenResultV1.parse(raw);
      return { ticket: opened.ticket, surfaceId: opened.surfaceId };
    },
    async close(surfaceId: string) {
      const client = deps.mintClient();
      if (client === null) return;
      await client.request("surface.close", { surfaceId });
    },
  });

  /**
   * PT-S2 — A BOUND SIMULATOR'S LANE (the brief's Part 3): the phone's device, minted by its BINDING (simulator-face.ts) under
   * the gate's capture scopes, its frames presented as a page's are — and NOTHING of a page: no input (view-only), no
   * navigation, no emulation, no favicon, no document or address rules, no veil (a stopped device's last frame is its
   * truth, not an engine's error page). Its seat at the cap, its still clock, the shelf and its forget are the pages' own.
   *  - ITS POOL ENTRY is its key AND its binding: a phone bound anew opens another entry, and the stream of the device it
   *    left is let go (the pool's grace keeps it, the cap counts it — a ghost, rested first) — never re-held as this one's.
   *  - ITS WORDS (`info().extra.simulator`, R2): main's facts in the SDK's nine — `live` where its frames flow (its ask live,
   *    the cap's slot its own, no still in a frame's place), else `at-rest`; a lane LOST is `stopped`. A desk PARKED says
   *    nothing new (the words wake the desk: a parked one is never woken by its own pause). The device's name as main says
   *    it. The state's ONE act (R4) — none while main runs one (`acting`), none where the handle has no device lane — is a
   *    closure MEMOIZED by its verb (so the words do not churn), resolved by the face's KEY when it RUNS (the lane open then,
   *    its words still offering it: a press on a face that moved on is nothing). Never `extra.still` (R14).
   *  - A DEVICE THAT CANNOT STREAM (off, booting, no window, none, refused, stopped) is stopped as the cap reads it: it gives
   *    back its slot when it stops, and coming back it waits for the plan's wake — as a page that stops (PT-6a M14). Its
   *    WIRE still carries the kind's own live ask: main withholds that device itself (brief Part 2) and looks for its window,
   *    or restarts its stream, only under a live ask — so Show it, Try again and a Screen Recording grant come back by it.
   *    Streaming again, the stream comes up unasked: the plan wakes it into a free slot or puts it to rest (PT-6a M15).
   *  - ITS STILL is filed under its binding (R15): one taken of another device is never laid into its face.
   */
  const openSimulator = (key: string, bound: LiveSimulatorSpec, arrived: () => void): LiveFace => {
    const source = simulatorSource(bound);
    if (source === undefined)
      return refuse(key, "not a device this desk can open", "ios-simulator");
    const gate = deps.gate(key, "ios-simulator");
    if ("refused" in gate) return refuse(key, gate.refused, "ios-simulator");
    const pool = deps.pool();
    if (pool === null)
      return refuse(
        key,
        "live surfaces are unavailable in this window",
        "ios-simulator",
        "no-simulator",
      );
    const label = `${gate.type}/live ${key}`;
    /** What its stills are filed under, and its pool entry: its key and its binding. */
    const address = simulatorAddress(bound);
    const entry = `${key}~${address}`;
    const reuseKey = simulatorReuseKey(bound);
    let handle: SurfaceHandle<ProductSurfaceFrame>;
    try {
      handle = pool.acquire(poolKey(entry), {
        // paused until the kind's law has seen the face AND the cap lets it be alive — no viewport: a device is its own size
        initialDemand: liveDemandIntent(PARKED),
        tickets: ticketsOf(() => ({
          source,
          ...(reuseKey === undefined ? {} : { reuseKey }),
        })),
      });
    } catch (error) {
      return refuse(key, error instanceof Error ? error.message : String(error), "ios-simulator");
    }
    // the device is a lane's again: what the service knew of it while it was let go is over
    gone.delete(entry);
    ghostsRested.delete(entry);
    const openedAt = now();

    let closed = false;
    let presentation = handle.presentation;
    let offFrame: (() => void) | null = null;
    let frameOwed = false;
    let wordsOwed = false;
    /** The last demand the kind sent: paused (unseen) until it says otherwise. */
    let asked: LiveDemand | undefined;
    let writer: LiveWriter | undefined;
    let writerDevice: GPUDevice | undefined;
    /** The texture holds a STILL taken then (the shelf's, or the stream as it was put to rest) — never said (R14), but it
     * holds the words at `at-rest` until a frame lands in its place; the texture holds a LIVE frame of the device. */
    let still: number | undefined;
    let liveShown = false;
    let waiting: { readonly bitmap: ImageBitmap; readonly kept: PageStill } | undefined;
    let showing = 0;
    const tally = { arrivals: 0, presented: 0, dropped: 0, acts: 0 };
    // close() unsubscribes both listeners at once, so nothing tells after it
    const tell = (): void => arrived();
    /** Main's facts of the device (absent: none said yet). */
    const facts = (): LiveSurfaceSimulatorStateV1 | undefined =>
      handle.state.presentation?.summary.simulator;
    /** It cannot stream: its lane lost, its producer failed, its device anywhere but streaming — the plan has nothing to do
     * for it (its act has). */
    const stoppedOf = (state: SurfaceHandleState<ProductSurfaceFrame>): boolean => {
      if (state.status === "lost" || state.presentation?.summary.state === "failed") return true;
      const condition = state.presentation?.summary.simulator?.condition;
      return condition !== undefined && condition !== "streaming";
    };
    const seat = seatOf({
      key,
      handle,
      openedAt,
      asked: () => asked,
      stopped: () => stoppedOf(handle.state),
      closed: () => closed,
    });
    const clock = stillClockOf({
      key,
      closed: () => closed,
      film: () =>
        writer === undefined || writerDevice === undefined
          ? undefined
          : { writer, device: writerDevice },
      current: () => liveShown,
      settling: () => false,
      address: () => address,
      held: () => asked?.mode === "live" && asked.interactive,
    });
    /** Its frames FLOW — its ask live, the cap's slot its own, no still in a frame's place (the park is not read: a parked
     * desk's words do not move). */
    const flowing = (): boolean =>
      seat.allowed && !seat.rested && asked?.mode === "live" && still === undefined;
    /** What the face SAYS (the SDK's word and its act by name), or nothing yet (attaching; no facts and nothing failed). */
    const said = ():
      | { readonly is: LiveSimulatorState; readonly act: SimulatorAct | null }
      | undefined => {
      const state = handle.state;
      if (state.status === "lost") return { is: "stopped", act: "mint" };
      if (state.status !== "live") return undefined;
      const summary = state.presentation?.summary;
      if (summary?.state === "closed") return undefined;
      const failed = summary?.state === "failed";
      const f = summary?.simulator;
      const is =
        f === undefined
          ? failed
            ? "stopped"
            : undefined
          : simulatorState(f.condition, { failed, flowing: flowing() });
      if (is === undefined) return undefined;
      const verb = f?.acting === undefined ? SIMULATOR_ACTS[is] : null;
      return { is, act: verb !== null && handle.device !== undefined ? verb : null };
    };
    /** Each act's closure, made once (the words compare them as there or not): resolved by the face's KEY when it runs. */
    const acts = new Map<SimulatorAct, () => void>();
    const actOf = (act: SimulatorAct | null): (() => void) | undefined => {
      if (act === null) return undefined;
      const made = acts.get(act);
      if (made !== undefined) return made;
      const verb: SimulatorAct = act;
      const run = (): void => lanes.get(key)?.act?.(verb);
      acts.set(verb, run);
      return run;
    };
    /** What the face says as one string — a move of it is an arrival (the kind's words are remade). */
    const wordOf = (): string => {
      const state = handle.state;
      const summary = state.presentation?.summary;
      return JSON.stringify([
        state.status,
        summary?.state ?? null,
        summary?.transport ?? null,
        summary?.simulator ?? null,
        state.error?.message ?? null,
        said() ?? null,
      ]);
    };
    let spoke = "";
    /** The words moved since last said: owed to the next take (true) — `retell` tells the kind so; a take carries them. */
    const reword = (): boolean => {
      const next = wordOf();
      if (next === spoke) return false;
      spoke = next;
      wordsOwed = true;
      return true;
    };
    const retell = (): void => {
      if (reword()) tell();
    };
    const dropWaiting = (): void => {
      waiting?.bitmap.close();
      waiting = undefined;
    };
    /** A still read off the shelf, laid into the face's own writer — the one path a live frame takes. False: no device yet
     * (it waits; the next `take` lays it). */
    const layStill = (): boolean => {
      const w = waiting;
      const device = deps.device();
      if (w === undefined || device === undefined || closed) return false;
      waiting = undefined;
      try {
        if (writer === undefined || writerDevice !== device) {
          writer?.destroy();
          writer = deps.writer(device, { label, width: w.bitmap.width, height: w.bitmap.height });
          writerDevice = device;
          counts.writers += 1;
        }
        writer.present(w.bitmap, undefined, w.kept.logical);
      } finally {
        w.bitmap.close();
      }
      still = w.kept.takenAt;
      clock.at = Math.max(clock.at, w.kept.takenAt);
      liveShown = false;
      counts.stillsShown += 1;
      return true;
    };
    /** THE STILL, SHOWN: where the shelf keeps one taken on THIS binding (R15) and no live frame has landed. */
    const showStill = (): Promise<void> => {
      if (closed || !stillsKept()) return Promise.resolve();
      showing += 1;
      const turn = showing;
      const mine = (kept: PageStill): boolean =>
        !closed && turn === showing && !liveShown && kept.address === address;
      return track(
        (async () => {
          const read = await readStill(key, mine);
          if (read === undefined) return;
          dropWaiting();
          waiting = read;
          if (layStill()) wordsOwed = true;
          reword();
          tell();
        })(),
      );
    };

    const listen = (next: SurfaceHandleState<ProductSurfaceFrame>["presentation"]): void => {
      if (next === presentation && offFrame !== null) return;
      offFrame?.();
      presentation = next;
      offFrame =
        presentation?.onFrame(() => {
          tally.arrivals += 1;
          frameOwed = true;
          tell();
        }) ?? null;
    };
    listen(presentation);
    let wasStopping = stoppedOf(handle.state);
    /** What the cap reads of the lane, as one word: a move of it is a plan made again. */
    const capWord = (state: SurfaceHandleState<ProductSurfaceFrame>): string =>
      `${state.status} ${aliveBySummary(state)} ${stoppedOf(state)}`;
    let capWas = capWord(handle.state);
    spoke = wordOf();
    const offState = handle.onState((state) => {
      if (state.presentation !== presentation) listen(state.presentation);
      // PT-6a (M14, R1), as a page: a device that STOPS streaming gives back the cap's permission — its slot is another's,
      // and coming back (booted, its window shown, tried again) it waits for the plan's wake; its wire is written at once
      // (the kind's live ask stays on it while main holds the device: `send`)
      const stops = stoppedOf(state);
      if (stops && !wasStopping) {
        seat.stop();
        lanes.get(key)?.send();
      }
      wasStopping = stops;
      const word = capWord(state);
      if (word !== capWas) {
        capWas = word;
        if (!closed && lanes.has(key)) replan();
      }
      retell();
    });

    const face: LiveFace = {
      key,
      texture: (): LiveTexture | undefined => writer?.face,
      take(): boolean {
        if (closed) return false;
        // a still read before the device came is laid now (the words it holds at rest are this take's)
        if (waiting !== undefined && layStill()) wordsOwed = true;
        reword();
        const changed = wordsOwed;
        wordsOwed = false;
        if (!frameOwed) return changed;
        frameOwed = false;
        const p = presentation;
        if (p === null || p.closed) return changed;
        const device = deps.device();
        if (
          asked === undefined ||
          asked.mode === "paused" ||
          device === undefined ||
          (seat.rested && !seat.allowed)
        ) {
          // an unseen face's frame (ruling 6), one before the device, or one crossing as it was put to rest: taken and
          // closed, drawn nowhere
          if (p.presentLatestVia(() => false).kind !== "idle") {
            counts.dropped += 1;
            tally.dropped += 1;
          }
          return changed;
        }
        const r = p.presentLatestVia((frame, metadata) => {
          const rect = metadata.geometry.visibleRect;
          if (writer === undefined || writerDevice !== device) {
            writer?.destroy();
            writer = deps.writer(device, { label, width: rect.width, height: rect.height });
            writerDevice = device;
            counts.writers += 1;
          }
          writer.present(frame, rect, logicalOf(metadata.geometry.logicalSize));
          return true;
        });
        if (r.kind !== "consumed") return changed;
        counts.presented += 1;
        tally.presented += 1;
        // a frame of the device as it is: no still any more (one on its way is void from here) — its words say so with
        // this take
        still = undefined;
        liveShown = true;
        clock.fresh = true;
        showing += 1;
        dropWaiting();
        clock.arm();
        reword();
        wordsOwed = false;
        return true;
      },
      state: (): LiveState => {
        if (closed) return { is: "closed" };
        const word = said();
        if (word !== undefined) return simulatorLiveState(word.is, actOf(word.act));
        const state = handle.state;
        return state.status === "released" || state.presentation?.summary.state === "closed"
          ? { is: "closed" }
          : { is: "starting" };
      },
      info: (): LiveInfo => {
        if (closed) return {};
        const state = handle.state;
        const degraded =
          state.presentation?.summary.transport === "cpu-bgra" ? { degraded: "cpu-bitmap" } : {};
        const word = said();
        if (word === undefined) return degraded;
        const name = facts()?.name;
        const act = actOf(word.act);
        return {
          ...degraded,
          extra: {
            simulator: {
              is: word.is,
              ...(name === undefined || name.length === 0 ? {} : { device: name }),
              ...(act === undefined ? {} : { act }),
            },
          },
        };
      },
      demand(d: LiveDemand): void {
        if (closed) return;
        const was = asked;
        asked = d;
        counts.demands += 1;
        seat.saw(was, d);
        // PUT DOWN: the best pixels the device will have are in its texture now
        if (was?.mode === "live" && was.interactive && !(d.mode === "live" && d.interactive))
          void clock.take();
        // the cap may wake it, make it wait, or rest another for it
        ask(lane, d.mode === "live" && d.interactive);
        // seen with nothing of the device to show: its still, where the shelf keeps one of THIS binding
        if (d.mode === "live" && !liveShown && still === undefined) void showStill();
        retell();
      },
      close(): void {
        if (closed) return;
        // what the cap knows of the stream it lets go of (the pool's grace keeps it)
        gone.set(entry, { seenAt: seat.seenAt, alive: seat.alive() });
        closed = true;
        lanes.delete(key);
        offState();
        offFrame?.();
        offFrame = null;
        clock.stop();
        dropWaiting();
        handle.release();
        writer?.destroy();
        writer = undefined;
        faces.delete(key);
        forgetLater(key);
        // its lane's slot may be another's now
        replan();
      },
    };
    faces.set(key, {
      face,
      row: () => {
        const t = writer?.face;
        const { extra: _extra, ...info } = face.info();
        const word = said();
        const f = facts();
        return {
          key,
          source: "ios-simulator",
          demand: asked,
          wire: wireOf(entry),
          surface: surfaceOf(entry),
          state: face.state(),
          info,
          favicon: null,
          label: lane.label(),
          emulation: null,
          arrivals: tally.arrivals,
          presented: tally.presented,
          dropped: tally.dropped,
          inputs: 0,
          lastInput: null,
          texture:
            t === undefined
              ? undefined
              : {
                  width: t.width,
                  height: t.height,
                  revision: t.revision,
                  epoch: t.epoch,
                  bytes: t.bytes,
                },
          veiled: false,
          refused: 0,
          current: liveShown,
          faviconBytes: 0,
          alive: seat.alive(),
          rested: seat.rested,
          still: still ?? null,
          stillAt: Number.isFinite(clock.at) ? clock.at : null,
          simulator: {
            is: word?.is ?? null,
            act: word?.act ?? null,
            condition: f?.condition ?? null,
            acting: f?.acting ?? null,
            degraded: f?.degraded === true,
            // PT-S3 (D4): the device attached, by name — each picked, never the facts whole (they pass unknown keys through)
            name: f?.name ?? null,
            deviceType: f?.deviceType ?? null,
            runtime: f?.runtime ?? null,
          },
          acts: tally.acts,
        };
      },
    });
    const lane: Lane = {
      key,
      source: "ios-simulator",
      entry,
      handle,
      openedAt,
      // a page's verbs: the service's own guards keep them off a device (no spec moves under it — a phone bound anew is
      // closed and opened again by its kind)
      respec: () => {},
      went: () => {},
      // what it is called: the device's name as main says it, else the one its phone gives
      label: () => facts()?.name ?? bound.label,
      send() {
        if (closed) return;
        // MAIN HOLDS a device that cannot stream (its demand hibernated there) and looks for its window, or restarts it,
        // only under a LIVE ask: the kind's own goes down while main says so — never withheld a second time here, or Show
        // it, Try again and a grant would never come back. The seat stays stopped (no slot is held); streaming again, the
        // stream comes up unasked and the plan wakes it or rests it (PT-6a M15)
        const state = handle.state;
        const mainHolds = state.status === "live" && stoppedOf(state) && !seat.rested;
        handle.setDemand(
          mainHolds && !parked && asked?.mode === "live"
            ? liveDemandIntent(asked)
            : seat.intent(undefined, false),
        );
        // woken, made to wait, put to rest: the words may say so
        retell();
      },
      capFace: seat.capFace,
      adoptable: seat.adoptable,
      unasked: seat.unasked,
      wake: seat.wake,
      adopt: seat.adopt,
      // PUT TO REST: its still taken first, then its stream hibernated (main ends its capture: a wake finds the device and
      // its window again). What its texture holds is a photograph now — the words say `at-rest`
      async rest() {
        if (!(await seat.rest(clock.take))) return;
        if (liveShown) {
          liveShown = false;
          still = Number.isFinite(clock.at) ? clock.at : now();
        }
        lane.send();
      },
      evict() {
        if (closed || writer === undefined) return false;
        writer.destroy();
        writer = undefined;
        writerDevice = undefined;
        still = undefined;
        liveShown = false;
        showing += 1;
        dropWaiting();
        wordsOwed = true;
        tell();
        counts.evictions += 1;
        return true;
      },
      act(act) {
        if (closed || said()?.act !== act) return;
        if (act === "mint") handle.retry();
        else if (handle.device?.({ verb: act }) !== true) return;
        counts.acts += 1;
        tally.acts += 1;
      },
    };
    lanes.set(key, lane);
    // a still the shelf keeps of this binding is shown at once — before the device's first frame
    void showStill();
    // a stream re-bound alive (this window's reload) holds its slot from the start
    if (lane.adoptable()) replan();
    return face;
  };

  const open = (
    key: string,
    spec: Readonly<Record<string, unknown>>,
    arrived: () => void,
  ): LiveFace => {
    // one face per key per desk (design-019 §3.2): a key opened twice is a host error, said
    if (faces.has(key))
      throw new Error(`desk LIVE: the face "${key}" is open twice — one face per key per desk`);
    counts.opened += 1;
    // PT-5b: the pane is on the desk again (an undo within its page's grace): its still is not forgotten
    const owed = forgetting.get(key);
    if (owed !== undefined) {
      owed.timers.clear(owed.handle);
      forgetting.delete(key);
    }
    // PT-S2: a spec that names a device is a bound Simulator's — its own lane, never parsed as a page
    if (spec.source === "ios-simulator") {
      const bound = liveSimulatorSpec(spec);
      return bound === undefined
        ? refuse(key, "not a device this desk can open", "ios-simulator")
        : openSimulator(key, bound, arrived);
    }
    const opened = liveBrowserSpec(spec);
    if (opened === undefined) return refuse(key, "not a page this desk can open");
    /** The face's spec as it stands: its open's, then each `respec`'s. A mint after a loss is made of THIS one. */
    let page = opened;
    const gate = deps.gate(key);
    if ("refused" in gate) return refuse(key, gate.refused);
    const pool = deps.pool();
    if (pool === null) return refuse(key, "live pages are unavailable in this window");
    const label = `${gate.type}/live ${key}`;
    let handle: SurfaceHandle<ProductSurfaceFrame>;
    try {
      handle = pool.acquire(poolKey(key), {
        // paused until the kind's law has seen the face AND the cap lets its page be alive: nothing is made of it yet
        initialDemand: liveDemandIntent({
          mode: "paused",
          fps: 0,
          raster: [0, 0],
          viewport: page.viewport,
          interactive: false,
        }),
        tickets: ticketsOf(() => ({ source: browserSource(page), reuseKey: key })),
      });
    } catch (error) {
      return refuse(key, error instanceof Error ? error.message : String(error));
    }
    // the page is a lane's again: what the service knew of it while it was let go is over
    gone.delete(key);
    ghostsRested.delete(key);
    const openedAt = now();

    let closed = false;
    let presentation = handle.presentation;
    let offFrame: (() => void) | null = null;
    /** A frame landed since the last take; the state or the page's words moved since the last take. */
    let frameOwed = false;
    let wordsOwed = false;
    let words = wordsOf(handle.state);
    /** PT-5a — the face shows nothing of its page (the engine's own error page; a page from before its failed load, or
     * before it stopped): hidden — the kind draws its film — until a frame of the page that follows lands, or (PT-5b) the
     * shelf's still of the address that FAILED is laid in its place. PT-5b: a hidden face HOLDS no texture either (it is
     * let go at the failure: what a face holds is what the desk's budget counts), so this is the row's word and no guard. */
    let veiled = failing(handle.state);
    /** The last demand the kind sent: paused (unseen) until it says otherwise. */
    let asked: LiveDemand | undefined;
    let writer: LiveWriter | undefined;
    let writerDevice: GPUDevice | undefined;
    /** The frame the face DISPLAYS: its geometry revision and logical size — what input is mapped against and stamped with. */
    let shown:
      | { readonly revision: number; readonly logical: readonly [number, number] }
      | undefined;
    const tally = { arrivals: 0, presented: 0, dropped: 0, inputs: 0 };
    let lastInput: LiveInput["kind"] | null = null;
    /** PT-5b — THE CAP: the page's seat (`seatOf` — PT-S2: a bound Simulator's is the same) — the service lets it be alive
     * (it woke it, or took it as it stood); it put it to rest (its wire is `hibernated`); it is putting it to rest now (its
     * still being taken); PT-6a (M15 — V1) it stopped since the plan last woke it; when its pane was last seen (it is seen
     * from a live ask until its ask leaves `live`). */
    const seat = seatOf({
      key,
      handle,
      openedAt,
      asked: () => asked,
      stopped: () => stopped(),
      closed: () => closed,
    });
    /** PT-6a (M7, M10 A6): its page let go for a load that showed nothing (`nothingShown`) — until a new address clears it —
     * the timer its let-go waits on (`NOTHING_SHOWN_BOUND_MS`), and the refusals' serial when its load began (a refusal
     * since is the load's last word). */
    let letGone = false;
    let goneTimer: unknown = null;
    /** PT-6a (M14, R1): a FAILED page asked back — its ↻ (`reload`), or a `go` — is planned for again: it waits for a slot
     * as any seen page, or comes alive in the hand (a failed page starts only under a live ask). */
    let revived = false;
    let loadSerial = 0;
    let wasLoading = false;
    const holdGone = (gone: boolean): void => {
      if (gone === letGone) return;
      letGone = gone;
      // PT-6a (M14, R1): let go, it gives back the cap's permission — coming back it waits for the plan's wake
      if (gone) seat.allowed = false;
      lanes.get(key)?.send();
      if (!closed && lanes.has(key)) replan();
    };
    /** PT-5b — THE STILL: the texture's content is a STILL (the shelf's, or the page as it was put to rest) and when it was
     * taken; the texture holds a LIVE frame of the page as it is; when this page's still was last taken, and whether a
     * frame landed since, and the still's timer (its clock: `stillClockOf`); a still read and waiting for the device; the
     * reads begun (the last one wins). */
    let still: { readonly takenAt: number; readonly address: string } | undefined;
    let liveShown = false;
    /**
     * PT-5b2 (ruling 1), PT-5b3 (ruling 4) — WHAT THE FRAME NOW IN THE TEXTURE IS OF. Its DOCUMENT: the one the frame
     * says (its producer's stamp, at its paint), else the one that stood when it ARRIVED — never the one that stands when
     * it is consumed (a frame of a list, drawn after the page committed an item, was stamped the item's). And, for a
     * producer that counts no documents, the ADDRESS the page said when it arrived. A document that moves with no frame
     * since leaves the texture "of the document before"; an address that moves WITHIN a document (a hash, a script's
     * `replaceState`) does not — the pixels are of this document still.
     */
    let frameDoc: number | undefined;
    let frameOf: string | undefined;
    /** What stood when the newest frame ARRIVED: the page's document (none: its producer counts none) and its address. */
    let arrivedAt: { readonly document: number | undefined; readonly address: string } | undefined;
    const clock = stillClockOf({
      key,
      closed: () => closed,
      film: () =>
        writer === undefined || writerDevice === undefined
          ? undefined
          : { writer, device: writerDevice },
      // a LIVE frame of the document the page is at
      current: () => liveShown && ofNow(),
      // a page still loading is not yet what it will show
      settling: () => handle.state.browser?.loading === true,
      // filed under the address NOW: an address that moved within the document is this document's
      address: () => addressNow(),
      held: () => asked?.mode === "live" && asked.interactive,
    });
    let waiting: { readonly bitmap: ImageBitmap; readonly kept: PageStill } | undefined;
    let showing = 0;
    /** PT-4: the emulation last told down the lane (as one string) — told again only when the spec's moved. */
    let told: string | undefined;
    const tellDevice = (): void => {
      const emulation = emulationOf(page);
      const next = JSON.stringify(emulation);
      if (next === told || closed) return;
      // the lane takes it only while it is live; until then it is owed (the next live state tells it)
      if (!handle.navigate({ action: "emulate", emulation })) return;
      told = next;
      counts.emulations += 1;
    };
    /** PT-4: the favicon as the face's words carry it — decoded once a key. */
    let icon: LiveFavicon | null = null;
    const iconOf = (favicon: LiveSurfaceBrowserStateV1["favicon"]): LiveFavicon | null => {
      if (favicon === undefined) icon = null;
      else if (icon?.key !== favicon.key) icon = faviconOf(favicon);
      return icon;
    };
    // close() unsubscribes both listeners at once, so nothing tells after it
    const tell = (): void => arrived();
    /** The address the page is at (its producer's word), else the one its pane names — what a still is a photograph of. */
    const addressNow = (): string => handle.state.browser?.url ?? page.url;
    /** Where the pane was last SENT (`go`), until its page says an address of its own again; and the address a still is
     * shown for: where the pane is headed, else where its page is. */
    let headed: string | undefined;
    let saidAt = handle.state.browser?.url;
    const paneAddress = (): string => headed ?? addressNow();
    /** PT-5b3 (ruling 4): the DOCUMENT the page is at — the producer's serial; undefined: it counts none. */
    const documentNow = (): number | undefined => handle.state.browser?.document;
    /** The texture's pixels are of the DOCUMENT the page is at now — by the serial where the frame and the page both
     * say one; else by the address, as before PT-5b3 (a producer that counts none). */
    const ofNow = (): boolean => {
      const now = documentNow();
      if (frameDoc !== undefined && now !== undefined) return frameDoc === now;
      return frameOf !== undefined && sameAddress(frameOf, addressNow());
    };
    const dropWaiting = (): void => {
      waiting?.bitmap.close();
      waiting = undefined;
    };
    /** The face's texture LET GO — the film: the budget evicted it, or it held a still of an address the pane has left. */
    const letGo = (): boolean => {
      if (closed || writer === undefined) return false;
      writer.destroy();
      writer = undefined;
      writerDevice = undefined;
      shown = undefined;
      still = undefined;
      liveShown = false;
      showing += 1;
      dropWaiting();
      wordsOwed = true;
      tell();
      return true;
    };
    /** A still is a photograph of ONE address: the pane gone elsewhere under it (the document's word, or the page's), it
     * is not shown. */
    const stillStands = (): void => {
      if (still !== undefined && !sameAddress(still.address, paneAddress())) letGo();
    };

    /** PT-5b — a still read off the shelf is laid into the face's own writer: the one path a live frame takes. False: no
     * device yet (it waits; the next `take` lays it). */
    const layStill = (): boolean => {
      const w = waiting;
      const device = deps.device();
      if (w === undefined || device === undefined || closed) return false;
      waiting = undefined;
      try {
        if (writer === undefined || writerDevice !== device) {
          writer?.destroy();
          writer = deps.writer(device, { label, width: w.bitmap.width, height: w.bitmap.height });
          writerDevice = device;
          counts.writers += 1;
        }
        writer.present(w.bitmap, undefined, w.kept.logical);
      } finally {
        w.bitmap.close();
      }
      still = { takenAt: w.kept.takenAt, address: w.kept.address };
      clock.at = Math.max(clock.at, w.kept.takenAt);
      liveShown = false;
      // it is what the shelf KEPT, so it is not hidden (and it takes no press: there is no page under it — every way here
      // has let the displayed frame's geometry go already: a rest, a failure, an eviction, an open)
      veiled = false;
      counts.stillsShown += 1;
      return true;
    };
    /** Does the face want its still now: its page failed (the still of THAT address stands under the words), or no live
     * frame of the page as it is has landed in its texture. */
    const wantsStill = (): boolean => failing(handle.state) || !liveShown;
    /**
     * PT-5b — THE STILL, SHOWN: where the shelf keeps one OF THE ADDRESS THE PANE IS AT (a still is a photograph of one
     * address — the document may have moved the pane while this device was away: then the film, and the next take replaces
     * it) and no live frame has landed. Never over a live frame; never passed off as one (`info().extra.still`).
     */
    const showStill = (): Promise<void> => {
      if (closed || !stillsKept()) return Promise.resolve();
      showing += 1;
      const turn = showing;
      const mine = (kept: PageStill): boolean =>
        !closed && turn === showing && wantsStill() && sameAddress(kept.address, paneAddress());
      return track(
        (async () => {
          // (a still that cannot be read rejects: nothing is laid — the film)
          const read = await readStill(key, mine);
          if (read === undefined) return;
          dropWaiting();
          waiting = read;
          if (layStill()) wordsOwed = true;
          tell();
        })(),
      );
    };

    const listen = (next: SurfaceHandleState<ProductSurfaceFrame>["presentation"]): void => {
      if (next === presentation && offFrame !== null) return;
      offFrame?.();
      presentation = next;
      offFrame =
        presentation?.onFrame(() => {
          tally.arrivals += 1;
          frameOwed = true;
          // PT-5b3 (ruling 4): what the page said when this frame ARRIVED (the newest: it is the one taken)
          arrivedAt = { document: documentNow(), address: addressNow() };
          tell();
        }) ?? null;
    };
    listen(presentation);
    let wasFailing = failing(handle.state);
    /** PT-6a (M14, R1): its page STOPPED — failed, or its handle lost (a page let go is `holdGone`'s). */
    const stopping = (state: SurfaceHandleState<ProductSurfaceFrame>): boolean =>
      state.status === "lost" || state.presentation?.summary.state === "failed";
    let wasStopping = stopping(handle.state);
    /** What the cap reads of the lane, as one word: a move of it is a plan made again. */
    const capWord = (state: SurfaceHandleState<ProductSurfaceFrame>): string =>
      `${state.status} ${aliveBySummary(state)} ${state.presentation?.summary.state === "failed"}`;
    let capWas = capWord(handle.state);
    const offState = handle.onState((state) => {
      if (state.presentation !== presentation) listen(state.presentation);
      // a lane gone live is told the spec's device (a page re-bound after a reload may have been told another)
      if (state.status === "live") tellDevice();
      const fails = failing(state);
      if (fails && !wasFailing) {
        // PT-5a: the page's frames are not shown — PT-5b: nor HELD (the texture is let go; a still read for the address
        // before is dropped), but the shelf's still of the address that FAILED is shown, under the words
        veiled = true;
        letGo();
        dropWaiting();
        void showStill();
      }
      wasFailing = fails;
      // PT-6a (M14, R1): a page that STOPS gives back the cap's permission — its slot is another's now, and coming back (a
      // peer's address, a reload, a mint after a loss) it waits for the plan's wake: a free slot, or the hand. Its wire
      // says so at once: main starts a failed page under a live ask (before: kept live, a SEEN page was rested for it)
      const stops = stopping(state);
      if (stops && !wasStopping) {
        seat.stop();
        revived = false;
        lanes.get(key)?.send();
      }
      wasStopping = stops;
      // PT-6a (M7, M10 A6): a load that showed nothing lets its page go at its LAST WORD — the refusal of a download the
      // load began — else at `NOTHING_SHOWN_BOUND_MS`; a page let go already, at once; a new address writes its pane's ask
      // again
      const serial = state.browser?.refused?.serial ?? 0;
      const loading = state.browser?.loading === true;
      if (loading && !wasLoading) loadSerial = serial;
      wasLoading = loading;
      const gone = nothingShown(state);
      if (!gone || state.presentation?.summary.state === "hibernated" || serial > loadSerial) {
        if (goneTimer !== null) timers.clear(goneTimer);
        goneTimer = null;
        holdGone(gone);
      } else if (!letGone && goneTimer === null)
        goneTimer = timers.set(() => {
          goneTimer = null;
          if (!closed && nothingShown(handle.state)) holdGone(true);
        }, NOTHING_SHOWN_BOUND_MS);
      if (state.browser?.url !== saidAt) {
        saidAt = state.browser?.url;
        headed = undefined;
      }
      stillStands();
      // PT-5b: a lane attached, a page that came alive or went (stopped, hibernated, lost) — the cap's count moved
      const word = capWord(state);
      if (word !== capWas) {
        capWas = word;
        if (!closed && lanes.has(key)) replan();
      }
      const said = wordsOf(state);
      if (said === words) return;
      words = said;
      wordsOwed = true;
      tell();
    });

    const face: LiveFace = {
      key,
      texture: (): LiveTexture | undefined => writer?.face,
      take(): boolean {
        if (closed) return false;
        // a still read before the device came is laid now
        if (waiting !== undefined && layStill()) wordsOwed = true;
        const changed = wordsOwed;
        wordsOwed = false;
        if (!frameOwed) return changed;
        frameOwed = false;
        const p = presentation;
        if (p === null || p.closed) return changed;
        const device = deps.device();
        if (
          asked === undefined ||
          asked.mode === "paused" ||
          device === undefined ||
          failing(handle.state) ||
          (seat.rested && !seat.allowed)
        ) {
          // an unseen face's frame (ruling 6) — or one before the device, or a failed page's (PT-5a: the engine's own
          // error page is never shown), or (PT-5b2) one that was crossing when its page was PUT TO REST (consumed, it
          // unsaid the pane's still — no dim, no mark, `paused` — until its page was woken): taken and closed, drawn nowhere
          if (p.presentLatestVia(() => false).kind !== "idle") {
            counts.dropped += 1;
            tally.dropped += 1;
          }
          return changed;
        }
        let said: number | undefined;
        const r = p.presentLatestVia((frame, metadata) => {
          said = metadata.document;
          const rect = metadata.geometry.visibleRect;
          const size = metadata.geometry.logicalSize;
          if (writer === undefined || writerDevice !== device) {
            writer?.destroy();
            writer = deps.writer(device, { label, width: rect.width, height: rect.height });
            writerDevice = device;
            counts.writers += 1;
          }
          const logical = logicalOf(size);
          writer.present(frame, rect, logical);
          shown =
            logical === undefined ? undefined : { revision: metadata.geometry.revision, logical };
          return true;
        });
        if (r.kind !== "consumed") return changed;
        counts.presented += 1;
        tally.presented += 1;
        // a frame of the page as it is now: the face shows its texture again — and (PT-5b) it is no still any more: the
        // words say so with this frame, and a still on its way is dropped
        veiled = false;
        still = undefined;
        liveShown = true;
        frameDoc = said ?? arrivedAt?.document;
        frameOf = arrivedAt?.address ?? addressNow();
        clock.fresh = true;
        // (a still being read is void from here: were this page put to rest before the read ends, its texture is the page
        // as it was — never the shelf's older photograph laid over it)
        showing += 1;
        dropWaiting();
        clock.arm();
        return true;
      },
      state: (): LiveState => {
        if (closed) return { is: "closed" };
        const state = liveStateOf(handle.state, {
          mint: () => handle.retry(),
          reload: () => {
            // PT-6a (M7 A6): a page let go for showing nothing is asked at its address again — a new window (a page with
            // none takes no reload)
            const url = handle.state.browser?.url;
            if (letGone && url !== undefined) {
              handle.navigate({ action: "go", url });
              return;
            }
            handle.navigate({ action: "reload" });
            // PT-6a (M14, R1): a FAILED page asked back is planned for again
            if (handle.state.presentation?.summary.state === "failed") {
              revived = true;
              if (!closed && lanes.has(key)) replan();
            }
          },
        });
        // PT-5b: a page the cap has not let be alive yet is not starting — nothing is being made of it: it rests
        return state.is === "starting" &&
          !seat.allowed &&
          handle.state.presentation?.summary.state === "created"
          ? { is: "paused" }
          : state;
      },
      info: (): LiveInfo => {
        if (closed) return {};
        const state = handle.state;
        const info = liveInfoOf(state);
        // the host's word on the page's favicon: its bytes, `null` where it has none — nothing before the page has spoken;
        // (PT-5a) the last thing the page asked for and may not have, to be said; and (PT-5b) that the texture is a STILL —
        // a photograph of the page, with its age: never passed off as the page
        const extra = {
          ...(state.browser === null
            ? {}
            : {
                favicon: iconOf(state.browser.favicon),
                ...(state.browser.refused === undefined
                  ? {}
                  : { refused: refusalOf(state.browser.refused) }),
                // PT-5d (M7 H10): the page's DOCUMENT, as its producer counts it — the pane's wait for a page the document
                // sent elsewhere ends by it moving, not by a look that saw the page arrive
                ...(typeof state.browser.document === "number"
                  ? { document: state.browser.document }
                  : {}),
              }),
          ...(still === undefined ? {} : { still: stillOf(still.takenAt, now()) }),
        };
        return Object.keys(extra).length === 0 ? info : { ...info, extra };
      },
      demand(d: LiveDemand): void {
        if (closed) return;
        const was = asked;
        asked = d;
        counts.demands += 1;
        // PT-5b2 (ruling 8) — LAST SEEN: a pane is seen until its ask leaves `live`, so it is stamped then too
        seat.saw(was, d);
        // PT-5b — PUT DOWN: the best pixels the page will have are in its texture now
        if (was?.mode === "live" && was.interactive && !(d.mode === "live" && d.interactive))
          void clock.take();
        // the cap may wake it, make it wait, or rest another for it
        ask(lane, d.mode === "live" && d.interactive);
        // PT-5b2 (ruling 1) — seen again with a texture of an address the page has LEFT while nobody looked (a peer's `go`,
        // a script's redirect: its frames were taken and closed meanwhile): the film, never the page it left
        if (d.mode === "live" && was?.mode !== "live" && liveShown && !ofNow()) letGo();
        // seen with nothing of the page to show: its still, where the shelf keeps one
        if (d.mode === "live" && !liveShown && still === undefined) void showStill();
      },
      // in the DISPLAYED frame's logical px, stamped with that frame's geometry revision; nothing displayed yet: nothing sent
      input(e: LiveInput): void {
        if (closed) return;
        // PT-5a: nothing is sent to a page whose frames are not shown (a press must never land on what nobody sees) —
        // PT-5b: nor through a still (`shown` is none while one stands) — PT-5c2 (F7): nor through a frame of a document
        // the page has LEFT. After a commit, until the new document's first frame, the face shows the one before — and
        // an event aimed at it lands on the NEW document: PT-5c2's probe `f7.cjs` (Electron 43.1.1, offscreen, the next
        // document's first paint held by its stylesheet) had a press, its release and a key sent after the commit and
        // before that paint heard by the new document at once, and a touch the moment it painted — as a tap. Unsent,
        // counted; its first frame, and the hand goes again.
        // PT-5d (G1) — A RELEASE PASSES THAT GATE (a pointer's up, a key's up; it still needs a frame to map its point):
        // a press the renderer sent before it heard of the commit, and main heard after it, went to the NEW document and
        // is down there — held back, its up left the key, the button or the finger down in the new page. Main lets up
        // only what it holds down, so the up of a press the commit forgot is nothing.
        const at = shown;
        const events = at === undefined ? [] : liveInputEvents(e, at.logical);
        const release = (e.kind === "pointer" || e.kind === "key") && e.phase === "up";
        if (at === undefined || events.length === 0 || (!release && !ofNow())) {
          counts.inputsUnsent += 1;
          return;
        }
        for (const event of events) {
          if (handle.sendInput(event, at.revision)) counts.inputs += 1;
          else counts.inputsUnsent += 1;
        }
        tally.inputs += 1;
        lastInput = e.kind;
      },
      close(): void {
        if (closed) return;
        // what the cap knows of the page it lets go of (the pool's grace keeps it)
        gone.set(key, { seenAt: seat.seenAt, alive: seat.alive() });
        closed = true;
        lanes.delete(key);
        offState();
        offFrame?.();
        offFrame = null;
        clock.stop();
        dropWaiting();
        handle.release();
        writer?.destroy();
        writer = undefined;
        faces.delete(key);
        // PT-5b — a DELETED pane's still is forgotten when its page's grace lapses; a pane that only left this mount keeps
        // its own
        forgetLater(key);
        // its lane's slot may be another's now
        replan();
      },
    };
    /** PT-4 (ruling 5): what the page is called — its title when it has one (never a blank one), else its spec's label. The
     * face's row and the mount's `label(key)` say the same word. */
    const called = (): string => liveInfoOf(handle.state).title?.trim() || page.label;
    /** A page that failed or whose lane is lost has no WebContents — and the plan has nothing to do for it (its ↻ has). */
    const stopped = (): boolean =>
      letGone ||
      handle.state.status === "lost" ||
      (handle.state.presentation?.summary.state === "failed" && !revived);
    faces.set(key, {
      face,
      row: () => {
        const t = writer?.face;
        const { extra: _extra, ...info } = face.info();
        return {
          key,
          source: "browser",
          demand: asked,
          wire: wireOf(key),
          surface: surfaceOf(key),
          state: face.state(),
          info,
          favicon: icon?.key ?? null,
          label: called(),
          emulation: emulationOf(page),
          ...tally,
          lastInput,
          texture:
            t === undefined
              ? undefined
              : {
                  width: t.width,
                  height: t.height,
                  revision: t.revision,
                  epoch: t.epoch,
                  bytes: t.bytes,
                },
          veiled,
          refused: handle.state.browser?.refused?.serial ?? 0,
          current: shown !== undefined && ofNow(),
          faviconBytes: handle.faviconArrivals ?? 0,
          alive: seat.alive(),
          rested: seat.rested,
          still: still?.takenAt ?? null,
          stillAt: Number.isFinite(clock.at) ? clock.at : null,
          simulator: null,
          acts: 0,
        };
      },
    });
    const lane: Lane = {
      key,
      source: "browser",
      entry: key,
      handle,
      openedAt,
      // PT-4: the spec moved under the open page — laid out at its viewport first where that moved (the demand goes ahead of
      // the emulation down the one port: a page that reloads for its new device loads at that device's size), then told its
      // device where that moved; a spec whose label alone moved (the page went elsewhere) sends nothing down the port
      respec(next) {
        const resized =
          next.viewport[0] !== page.viewport[0] || next.viewport[1] !== page.viewport[1];
        page = next;
        counts.respecs += 1;
        if (resized) {
          if (asked !== undefined) asked = { ...asked, viewport: next.viewport };
          lane.send();
        }
        tellDevice();
      },
      label: called,
      send() {
        if (closed) return;
        // a page the cap put to rest stays hibernated (and one let go for showing nothing); a parked desk's pages are
        // paused; a page seen that the cap makes wait is paused as it was made (nothing is made of it); else the kind's
        // own ask
        handle.setDemand(seat.intent(asked?.viewport ?? page.viewport, letGone));
      },
      capFace: seat.capFace,
      adoptable: seat.adoptable,
      unasked: seat.unasked,
      wake: seat.wake,
      adopt: seat.adopt,
      // PUT TO REST: its still taken first (what its texture holds is the page as it was), then its page hibernated — its
      // WebContents gone, its address kept by its producer. Coming back is a LOAD: its history, its scroll and whatever
      // was typed into it are what a rest costs.
      async rest() {
        if (!(await seat.rest(clock.take))) return;
        // what its texture holds is a photograph now, and says so — where it is of the document the page is at (PT-5b2
        // ruling 1, PT-5b3 ruling 4): under the address NOW (an address tidied within the document is its own). A
        // texture of the document BEFORE is nothing of this page: its film. And a pane SENT elsewhere that has not said
        // so yet is not shown the page it is leaving as where it is headed (`stillStands`).
        if (liveShown) {
          if (ofNow()) {
            liveShown = false;
            still = {
              takenAt: Number.isFinite(clock.at) ? clock.at : now(),
              address: addressNow(),
            };
            shown = undefined;
            wordsOwed = true;
            tell();
            stillStands();
          } else letGo();
        }
        lane.send();
      },
      evict() {
        if (!letGo()) return false;
        counts.evictions += 1;
        return true;
      },
      went(url) {
        // where the pane is headed — until its page says an address of its own
        headed = url;
        stillStands();
        // PT-6a (M14, R1): a FAILED page asked back is planned for again
        if (handle.state.presentation?.summary.state === "failed") {
          revived = true;
          if (!closed && lanes.has(key)) replan();
        }
      },
    };
    lanes.set(key, lane);
    // PT-5b: a still the shelf keeps of this page's address is shown at once — before its page's first frame
    void showStill();
    // a page re-bound alive (this window's reload) holds its slot from the start
    if (lane.adoptable()) replan();
    return face;
  };

  return {
    open,
    navigation: {
      navigate(key, command) {
        const lane = lanes.get(key);
        // PT-S2: a page's verbs reach a PAGE — a bound Simulator takes none (refused, counted)
        if (lane === undefined || lane.source !== "browser" || !lane.handle.navigate(command)) {
          counts.navigationsRefused += 1;
          return false;
        }
        counts.navigations += 1;
        if (command.action === "go") lane.went(command.url);
        return true;
      },
      respec(key, spec) {
        const lane = lanes.get(key);
        const next = liveBrowserSpec(spec);
        if (lane === undefined || lane.source !== "browser" || next === undefined) return false;
        lane.respec(next);
        return true;
      },
      evict: (key) => lanes.get(key)?.evict() === true,
    },
    label: (key) => lanes.get(key)?.label(),
    park(now) {
      if (now === parked) return;
      parked = now;
      if (now) counts.parks += 1;
      // parked: every page paused; running again: the plan (what moved meanwhile), then each page its face's last ask
      replan({ all: true });
    },
    cap(next) {
      const wanted = next === undefined ? cap : Math.floor(next);
      if (Number.isFinite(wanted) && wanted >= 1 && wanted !== cap) {
        cap = wanted;
        replan();
      }
      return cap;
    },
    async settled() {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },
    stats: () => ({
      ...counts,
      open: faces.size,
      parked,
      cap,
      alive:
        [...lanes.values()].filter((lane) => lane.capFace().alive).length +
        ghosts().filter((row) => row.alive).length,
    }),
    faces: () => [...faces.values()].map((f) => f.row()),
    dispose() {
      disposed = true;
      for (const { face } of [...faces.values()]) face.close();
      faces.clear();
      // PT-5b2 (ruling 2) — a deleted pane's grace is the UNDO's, not the mount's: its timer stands past this mount (a
      // plugin toggled, a device healed — the document is there to say, when it lapses, that the pane is still gone);
      // where no document is open to say (the board closed, the window going) the next open's sweep forgets it
      if (planTimer !== null) timers.clear(planTimer);
      planTimer = null;
    },
  };
}
