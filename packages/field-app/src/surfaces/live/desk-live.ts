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
  LIVE_SURFACE_FPS_BUCKETS_V1,
  type LiveSurfaceBrowserEmulationV1,
  type LiveSurfaceBrowserStateV1,
  type LiveSurfaceDemandV1,
  type LiveSurfaceFpsBucketV1,
  type LiveSurfaceInputEventV1,
  SurfaceOpenResultV1,
} from "@vibefield/contracts";
import {
  type BrowserNavigation,
  type LiveBrowserFailure,
  type LiveBrowserRefusal,
  type LiveBrowserSpec,
  liveBrowserFailureReason,
  liveBrowserSpec,
} from "@vibefield/plugin-sdk/desk";
import type {
  ProductSurfaceFrame,
  SurfaceDemandIntent,
  SurfaceHandle,
  SurfaceHandleState,
  SurfacePool,
} from "../pool";

/** What the gate answers for a face's key: the object's type (its kind's name — the texture's label), or why it may not open. */
export type LiveGateAnswer = { readonly type: string } | { readonly refused: string };

export interface DeskLiveDeps {
  /** The window's surface pool; null on a host with no live surfaces (every face fails, said). */
  readonly pool: () => SurfacePool<ProductSurfaceFrame> | null;
  /** The WINDOW's product connection — the mint rides it, as the plugin door's does (surface-door.tsx). Null: daemon away. */
  readonly mintClient: () => { request(method: string, params?: unknown): Promise<unknown> } | null;
  /** The capability gate (ruling 3), by the object the key names. */
  readonly gate: (key: string) => LiveGateAnswer;
  /** The desk's device (`deskLayer({ onDevice })`); undefined before it arrives. */
  readonly device: () => GPUDevice | undefined;
  /** ICE's writer — `createLiveTexture` — the HOST's. */
  readonly writer: (device: GPUDevice, o: LiveTextureOptions) => LiveWriter;
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
  /** PT-3: inputs sent down a page's lane, and those the service could not send (no frame presented yet, a closed lane). */
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
  /** The kind's last ask (undefined before its law has spoken: paused). */
  readonly demand: LiveDemand | undefined;
  /** What the pool last wrote to the wire for the page — LSF's demand — null before any. */
  readonly wire: LiveSurfaceDemandV1 | null;
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
  /** The face's texture: its size, its present count, its generation (a remade texture is a new epoch). */
  readonly texture:
    | {
        readonly width: number;
        readonly height: number;
        readonly revision: number;
        readonly epoch: number;
      }
    | undefined;
  /** PT-5a: the texture is HIDDEN (`texture()` answers none) — it holds what no face may show (the engine's own error page,
   * a page from before it failed) until a frame of the page that follows lands; and the serial of the last thing the page
   * asked for and was refused (0: nothing). */
  readonly veiled: boolean;
  readonly refused: number;
  /** PT-5a (ruling 8): how many times a favicon's BYTES arrived on the page's attachment — once a key, whatever the summaries. */
  readonly faviconBytes: number;
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
          reason: liveBrowserFailureReason(
            failure.reason === "failed" ? "load-failed" : failure.reason,
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
 * again): its state says why; it takes nothing, draws its film, closes to nothing. */
function failedFace(key: string, reason: string, release: () => void): LiveFace {
  let closed = false;
  return {
    key,
    texture: () => undefined,
    take: () => false,
    state: () =>
      closed
        ? { is: "closed" }
        : { is: "failed", reason: liveBrowserFailureReason("may-not", reason) },
    info: () => ({}),
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
const poolKey = (key: string): string => `desk:${key}`;

/** THE DESK'S BROWSER PROFILE (PT-4 ruling 3): every desk page's — one persistent session, as the tabs of one browser share
 * theirs. Main keeps it under the user's data by an opaque name (`LAYOUT.BROWSER_PROFILES_DIR`), apart from the shell's. */
export const DESK_PROFILE = "desk";

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

/** PT-5a: what the page asked for and may not have, as the face's words carry it (`LiveBrowserRefusal`). */
const refusalOf = (
  refused: NonNullable<LiveSurfaceBrowserStateV1["refused"]>,
): LiveBrowserRefusal => ({ what: refused.what, serial: refused.serial });

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

export function createDeskLiveSources(deps: DeskLiveDeps): DeskLiveSources {
  /** PT-5a: the desk's loop is parked — every page is held paused until it runs again. */
  let parked = false;
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
  };
  /** The open pages' lanes by key (a failed face has none): what `navigate` and `respec` reach, and what a page is called. */
  const lanes = new Map<
    string,
    {
      readonly handle: SurfaceHandle<ProductSurfaceFrame>;
      respec(page: LiveBrowserSpec): void;
      label(): string;
      park(parked: boolean): void;
    }
  >();
  const wireOf = (key: string): LiveSurfaceDemandV1 | null =>
    deps
      .pool()
      ?.snapshot()
      .entries.find((entry) => entry.key === poolKey(key))?.demand ?? null;

  const refuse = (key: string, reason: string): LiveFace => {
    counts.refused += 1;
    const face = failedFace(key, reason, () => faces.delete(key));
    faces.set(key, {
      face,
      row: () => ({
        key,
        demand: undefined,
        wire: null,
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
        faviconBytes: 0,
      }),
    });
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
        // paused until the kind's law has seen the face: the page is made and laid out at its viewport, painting nothing yet
        initialDemand: liveDemandIntent({
          mode: "paused",
          fps: 0,
          raster: [0, 0],
          viewport: page.viewport,
          interactive: false,
        }),
        tickets: {
          async mint() {
            const client = deps.mintClient();
            if (client === null)
              throw new Error("no fieldd connection (daemon away or still booting)");
            const raw = await client.request("surface.open", {
              source: browserSource(page),
              reuseKey: key,
            });
            const opened = SurfaceOpenResultV1.parse(raw);
            return { ticket: opened.ticket, surfaceId: opened.surfaceId };
          },
          async close(surfaceId: string) {
            const client = deps.mintClient();
            if (client === null) return;
            await client.request("surface.close", { surfaceId });
          },
        },
      });
    } catch (error) {
      return refuse(key, error instanceof Error ? error.message : String(error));
    }

    let closed = false;
    let presentation = handle.presentation;
    let offFrame: (() => void) | null = null;
    /** A frame landed since the last take; the state or the page's words moved since the last take. */
    let frameOwed = false;
    let wordsOwed = false;
    let words = wordsOf(handle.state);
    /** PT-5a — the texture holds what no face may show (the engine's own error page; a page from before its failed load, or
     * before it stopped): hidden — the kind draws its film — until a frame of the page that follows lands. */
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
    /** PT-4: the emulation last told down the lane (as one string) — told again only when the spec's moved. */
    let told: string | undefined;
    const tellDevice = (): void => {
      const emulation = emulationOf(page);
      const now = JSON.stringify(emulation);
      if (now === told || closed) return;
      // the lane takes it only while it is live; until then it is owed (the next live state tells it)
      if (!handle.navigate({ action: "emulate", emulation })) return;
      told = now;
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
    const offState = handle.onState((state) => {
      if (state.presentation !== presentation) listen(state.presentation);
      // a lane gone live is told the spec's device (a page re-bound after a reload may have been told another)
      if (state.status === "live") tellDevice();
      if (failing(state)) veiled = true;
      const now = wordsOf(state);
      if (now === words) return;
      words = now;
      wordsOwed = true;
      tell();
    });

    const face: LiveFace = {
      key,
      texture: (): LiveTexture | undefined => (veiled ? undefined : writer?.face),
      take(): boolean {
        if (closed) return false;
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
          failing(handle.state)
        ) {
          // an unseen face's frame (ruling 6) — or one before the device, or a failed page's (PT-5a: the engine's own
          // error page is never shown): taken and closed, drawn nowhere
          if (p.presentLatestVia(() => false).kind !== "idle") {
            counts.dropped += 1;
            tally.dropped += 1;
          }
          return changed;
        }
        const r = p.presentLatestVia((frame, metadata) => {
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
        // a frame of the page as it is now: the face shows its texture again
        veiled = false;
        return true;
      },
      state: () =>
        closed
          ? { is: "closed" }
          : liveStateOf(handle.state, {
              mint: () => handle.retry(),
              reload: () => {
                handle.navigate({ action: "reload" });
              },
            }),
      info: (): LiveInfo => {
        if (closed) return {};
        const state = handle.state;
        const info = liveInfoOf(state);
        // the host's word on the page's favicon: its bytes, `null` where it has none — nothing before the page has spoken;
        // and (PT-5a) the last thing the page asked for and may not have, to be said
        return state.browser === null
          ? info
          : {
              ...info,
              extra: {
                favicon: iconOf(state.browser.favicon),
                ...(state.browser.refused === undefined
                  ? {}
                  : { refused: refusalOf(state.browser.refused) }),
              },
            };
      },
      demand(d: LiveDemand): void {
        if (closed) return;
        asked = d;
        counts.demands += 1;
        // a parked desk's pages stay paused whatever is asked: the ask is kept, and given back at the unpark
        if (!parked) handle.setDemand(liveDemandIntent(d));
      },
      // in the DISPLAYED frame's logical px, stamped with that frame's geometry revision; nothing displayed yet: nothing sent
      input(e: LiveInput): void {
        if (closed) return;
        // PT-5a: nothing is sent to a page whose frames are not shown (a press must never land on what nobody sees)
        const at = veiled ? undefined : shown;
        const events = at === undefined ? [] : liveInputEvents(e, at.logical);
        if (at === undefined || events.length === 0) {
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
        closed = true;
        lanes.delete(key);
        offState();
        offFrame?.();
        offFrame = null;
        handle.release();
        writer?.destroy();
        writer = undefined;
        faces.delete(key);
      },
    };
    /** PT-4 (ruling 5): what the page is called — its title when it has one (never a blank one), else its spec's label. The
     * face's row and the mount's `label(key)` say the same word. */
    const called = (): string => liveInfoOf(handle.state).title?.trim() || page.label;
    faces.set(key, {
      face,
      row: () => {
        const t = writer?.face;
        const { extra: _extra, ...info } = face.info();
        return {
          key,
          demand: asked,
          wire: wireOf(key),
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
              : { width: t.width, height: t.height, revision: t.revision, epoch: t.epoch },
          veiled,
          refused: handle.state.browser?.refused?.serial ?? 0,
          faviconBytes: handle.faviconArrivals ?? 0,
        };
      },
    });
    lanes.set(key, {
      handle,
      // PT-4: the spec moved under the open page — laid out at its viewport first where that moved (the demand goes ahead of
      // the emulation down the one port: a page that reloads for its new device loads at that device's size), then told its
      // device where that moved; a spec whose label alone moved (the page went elsewhere) sends nothing down the port
      respec(next) {
        const resized =
          next.viewport[0] !== page.viewport[0] || next.viewport[1] !== page.viewport[1];
        page = next;
        counts.respecs += 1;
        if (resized) {
          const laid: LiveDemand = {
            ...(asked ?? { mode: "paused", fps: 0, raster: [0, 0], interactive: false }),
            viewport: next.viewport,
          };
          if (asked !== undefined) asked = laid;
          handle.setDemand(liveDemandIntent(laid));
        }
        tellDevice();
      },
      label: called,
      park(now) {
        handle.setDemand(
          liveDemandIntent(
            now
              ? { ...PARKED, viewport: asked?.viewport ?? page.viewport }
              : (asked ?? { ...PARKED, viewport: page.viewport }),
          ),
        );
      },
    });
    return face;
  };

  return {
    open,
    navigation: {
      navigate(key, command) {
        const lane = lanes.get(key);
        if (lane === undefined || !lane.handle.navigate(command)) {
          counts.navigationsRefused += 1;
          return false;
        }
        counts.navigations += 1;
        return true;
      },
      respec(key, spec) {
        const lane = lanes.get(key);
        const next = liveBrowserSpec(spec);
        if (lane === undefined || next === undefined) return false;
        lane.respec(next);
        return true;
      },
    },
    label: (key) => lanes.get(key)?.label(),
    park(now) {
      if (now === parked) return;
      parked = now;
      if (now) counts.parks += 1;
      for (const lane of lanes.values()) lane.park(now);
    },
    stats: () => ({ ...counts, open: faces.size, parked }),
    faces: () => [...faces.values()].map((f) => f.row()),
    dispose() {
      for (const { face } of [...faces.values()]) face.close();
      faces.clear();
    },
  };
}
