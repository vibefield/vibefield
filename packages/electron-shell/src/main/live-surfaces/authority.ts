import { randomBytes } from "node:crypto";
import type {
  LiveSurfaceAttachTicketV1,
  LiveSurfaceBrowserSourceV1,
  LiveSurfaceIosSimulatorDeviceSourceV1,
  LiveSurfaceIosSimulatorSourceV1,
  LiveSurfaceSckWindowSourceV1,
  LiveSurfaceSourceSpecV1,
  RendererParticipantIdentity,
  ShellSurfacesEnumerateParams,
  ShellSurfacesEnumerateResult,
  ShellSurfacesMintParams,
  ShellSurfacesMintResult,
  ShellSurfacesReleaseParams,
  ShellSurfacesReleaseResult,
  ShellSurfacesSimulatorDevicesResult,
  SurfaceSourceDescriptorV1,
} from "@vibefield/contracts";
import {
  CoreSimulatorRuntimeIdV1,
  LiveSurfaceSimulatorDeviceRowV1,
  LiveSurfaceSimulatorRuntimeOptionV1,
  PAGES_MADE_EMULATION,
  PAGES_RUN_PROFILE_PREFIX,
  SHELL_SURFACES_MADE_CLOSED,
  SURFACE_LIMITS,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { BrowserAgentPageState } from "./browser-control-target";
import type { LiveSurfaceRuntimeAuthority } from "./runtime";
import type { SimctlCallCounts, SimctlVetted } from "./simctl";
import type { LiveSurfaceWindowHost } from "./window-host";

// DT-1c (thinking-devtools-pack.md DT-D2) — the production live-surface
// authority: the ONLY caller of `LiveSurfaceWindowHost.issue` outside the labs.
// fieldd's SurfaceService has already run policy (scopes, the kind→scope
// matrix, audit, idempotency); this module owns MECHANISM — producer custody,
// window resolution, and the one-use ticket — and trusts no identifier it did
// not resolve itself (LSF-D6/D14/LSF-16). Runtime custody dies with its owning
// window: D39's close-to-tray destroys the renderer AND its pages — reopen
// re-creates surfaces from durable widget props, honestly.

/** Thrown-shape convention shared with ShellProviderNative implementations:
 * `safeProviderError` reads `.kind` and composes the outward message. */
interface KindError {
  readonly kind:
    | "UNAVAILABLE"
    | "PRECONDITION_FAILED"
    | "RESOURCE_EXHAUSTED"
    | "NOT_FOUND"
    | "INTERNAL";
  /** EY-1 (1f): why a run's make was refused before anything was made. EY-1 (7b, 2026-11-19): or a run's page is
   * gone for good, the one refusal word a window's pane leaves on */
  readonly state?: "no-window" | "desk-full" | typeof SHELL_SURFACES_MADE_CLOSED;
}

function kindError(kind: KindError["kind"], state?: KindError["state"]): KindError {
  return state === undefined ? { kind } : { kind, state };
}

function hasKind(error: unknown): error is KindError {
  return typeof error === "object" && error !== null && "kind" in error;
}

export interface LiveSurfaceRuntimeHandle extends LiveSurfaceRuntimeAuthority {
  readonly deviceInput?: boolean;
  dispose(): void;
  /** EY-1 (1e): a browser page's state for the pages broker (BrowserAgentPageState); a capture
   * has none. */
  agentPageState?(): BrowserAgentPageState;
  /** EY-1 (S1, 2026-11-24): a browser page made for an agent's run is held for its run: started with no window
   * attached, until its first attachment (BrowserLiveSurfaceRuntime.holdForRun). A capture has no such hold.
   * EY-1 (C7, C8, 2026-11-24): `onFailed` is told once, in a turn of its own, if the page's source fails while the
   * hold stands: nobody is attached to ask for it again, so custody decides what becomes of it. */
  holdForRun?(onFailed?: () => void): void;
  /** EY-1 (C6, 2026-11-24): when the pages plane last asked for this page's control binding (unix ms), which every
   * call of a run on a page begins with; null: never. Custody reads it of a page it keeps for a run. A capture has none. */
  agentAskedAt?(): number | null;
  /** PT-5c2 (F4): the device switches its page took (a browser page's `stats.emulations`; a capture takes none) — counted
   * by the census. */
  emulations?(): number;
  /** PT-5d (M15): the key-like events its page refused because a frame of another site held the focus (a browser page's
   * `stats.frameKeysRefused`) — counted by the census. */
  frameKeysRefused?(): number;
  /** PT-6a (K5): the hand's commands its page has SENT and not had answered, now (a browser page's window's) — counted by
   * the census. */
  handInFlight?(): number;
  /** PT-6a (M4 — F1): whether its page's current document is PULL-ONLY (1) — counted by the census. */
  pullOnly?(): number;
  /** PT-6a (M8 — C5): the sessions of its page's frames of other sites it holds — counted by the census. */
  childSessions?(): number;
}

/** Injectable producer construction; production binds the real runtime
 * classes, tests bind fakes. A factory may throw a `.kind` error (capture
 * stack absent → UNAVAILABLE) or a plain Error (invalid source → mapped to
 * PRECONDITION_FAILED here). */
export interface LiveSurfaceRuntimeFactories {
  browser(surfaceId: string, source: LiveSurfaceBrowserSourceV1): LiveSurfaceRuntimeHandle;
  sckWindow(surfaceId: string, source: LiveSurfaceSckWindowSourceV1): LiveSurfaceRuntimeHandle;
  iosSimulator(
    surfaceId: string,
    source: LiveSurfaceIosSimulatorSourceV1,
  ): LiveSurfaceRuntimeHandle;
  /** PT-S2 — a phone bound by its device type and runtime: main picks this Mac's device and keeps its UDID. MINTS on a
   * shell with no Simulator or no capture half, and says `no-simulator` (R5): it never throws for want of one. */
  iosSimulatorDevice(
    surfaceId: string,
    source: LiveSurfaceIosSimulatorDeviceSourceV1,
  ): LiveSurfaceRuntimeHandle;
}

export interface LiveSurfaceEnumerationRow {
  readonly sourceRef: string;
  readonly title?: string;
  readonly appName?: string;
}

/** Enumeration stays REDACTED at this boundary: window-server ids, pids, and
 * frames never leave main (the contracts descriptor cannot even carry them). */
export interface LiveSurfaceEnumerationSources {
  sckWindows(): Promise<readonly LiveSurfaceEnumerationRow[]>;
  bootedSimulators(): Promise<readonly LiveSurfaceEnumerationRow[]>;
}

/** PT-S2 (R11) — this Mac's simulator devices, for the attach: redacted rows (the ids a binding is made of), never a
 * UDID. No Simulator on this Mac is an empty list. */
export interface LiveSurfaceSimulatorDeviceSource {
  list(): Promise<readonly LiveSurfaceSimulatorDeviceRowV1[]>;
  /** The runtimes installed here, the newest first (ids only) — the attach's third pick binds to the newest iOS, whether
   * or not a device runs it yet. Absent: unsaid (the list carries none). */
  runtimes?(): Promise<readonly string[]>;
  configurations?(): Promise<readonly LiveSurfaceSimulatorRuntimeOptionV1[]>;
}

/** PT-S3 (D1) — main's bound simulators, COUNTED (never a UDID, never a name): what a phone row reads beside the runtimes.
 * Its source READS and never makes — a census builds no simctl, no capture stack, no session, and spawns nothing. */
export interface LiveSurfaceSimulatorCensus {
  /** the device sessions alive — one a device streamed, after R3's joins */
  readonly sessions: number;
  /** every device session ever made, each with its ONE inner (R7): a reload that re-binds moves nothing */
  readonly sessionsMade: number;
  /** the capture stack WAS built (its adapter loaded) — a census never builds it */
  readonly captureReady: boolean;
  /** the SCK helper's binary is on disk: the stack spawns it lazily, so `captureReady` alone never proves it */
  readonly helperPresent: boolean;
  /** the helper supervisor's counts — null while no capture stack was built */
  readonly helper: {
    readonly helperStarts: number;
    readonly helperExits: number;
    readonly activeSessions: number;
    readonly framesReceived: number;
    readonly simulatorFramebufferStarts?: number;
  } | null;
  /** which answer main's simctl probe vetted (P1) — null: none yet, or no Simulator here */
  readonly vetted: SimctlVetted | null;
  /** D2, a SMOKE's only: main's simctl calls counted by name (never an argument) — absent in production */
  readonly simctl?: Readonly<SimctlCallCounts>;
}

/** EY-1 (1f, 2026-11-19): how long a run's made page waits for a window's mint to adopt it.
 * EY-1 (S1, 2026-11-24): the grace ends only a page its run was never told of. Once an answer naming the page has left
 * for its run, the run is using it and custody keeps it for the run (`keepForRun`): a covered desk parks its loop and
 * opens no pane's face, so its adopt can come long after this. A kept page goes by a window's mint (adopted), the
 * desk's decline, its run's own close, or its run's end, and by nothing a window says besides.
 * Errata (2026-11-24, EY-1 C4 to C8): "goes by" named four ways and there are more since. A held page, kept or
 * not, also goes when its source fails with no window attached (C7, C8: `failed`); a kept one when its run has asked
 * nothing of it for KEPT_UNUSED_MS (C6: `unused`); a held one when the last product window goes (C4: `no-window`),
 * and when its pane asks for it with no name from a document loaded since its make (C4: `document-gone`). Each is
 * custody's own rule: still nothing a window sends keeps a page, and none of them adopts one. */
export const ADOPT_GRACE_MS = 30_000;

/**
 * EY-1 (C6, 2026-11-24): how long a KEPT page that no window has adopted stands without its run asking for it. A kept
 * page went only by its adopt, a decline, its run's own close or its run's end, and the last two are each one message
 * from fieldd's room. The keep itself is set as the answer naming the page LEAVES main: an answer that never reached the
 * room (its deadline passed first, the link moved, the call was cancelled in the gap) left a page nobody placed and
 * nobody would end, a hidden renderer until the app quit. So a kept page is kept while its run uses it. Use is read at
 * main's one registry of control bindings, which every call of a run on a page asks first (`agentAskedAt`); the clock
 * runs from the keep, begins again at each asking, and at its end the page is let go (`unused`).
 *
 * Thirty minutes: an agent waits on its person (an approval, a question) with its page open under a cover for far
 * longer than any call takes, and a run still at work must not be what loses its page: six of its engine's own idle
 * reaps (the pages broker's PAGES_IDLE_REAP_MS, five minutes each). It is short enough that a page nobody will ever
 * end does not stand to the quit. A page that goes so is told to its run as any let-go page is (its next call on it
 * answers gone), and its pane's mint, when the desk is shown, is refused as closed for good.
 */
export const KEPT_UNUSED_MS = 30 * 60_000;

/**
 * EY-1 (C5, 2026-11-24): the most pages custody holds for runs at once, across every run: pages made for a run that no
 * window has adopted yet. A held page has no face, so the desk's own count of live pages never sees it, and under a
 * cover every run could hold its five (PAGES_RUN_PANES_MAX) with nothing across runs to stop them but custody's own
 * cap of every kind (64), which is the person's too.
 *
 * 16: a quarter of custody's 64, so whatever agents open under a cover the person's own pages, phones and captures keep
 * 48 of it; and room for three runs at their full five and one page more. Each is a real renderer process, unseen. At
 * the bound a make is refused as the desk's room (`desk-full`), and a place comes back when a held page is adopted,
 * closed or let go. A page a window adopted is counted as that window's, never here.
 */
export const HELD_PAGES_MAX = 16;

/** EY-1 (1f): a page an agent's call makes, minted for its run before any window owns it. */
export interface LiveSurfaceMakeForRun {
  readonly run: string;
  readonly url: string;
  readonly by: "open" | "tab" | "popup";
  readonly logicalViewport: LiveSurfaceBrowserSourceV1["logicalViewport"];
  readonly deviceScaleFactor: number;
}

/** EY-1 (1f): why a made page went before a window adopted it, as custody says it to the pages broker's port (its
 * `PagesMadeGone`).
 * EY-1 (C8, 2026-11-24): four words, not three. `failed` is the page's own failure with no window attached (C7, C8:
 * nothing would start it again). It is a word of its own because the port answers a waiting open by it: said as
 * `grace`, a page that failed to start told its run that no VibeField window was open, while the desk stood open. */
export type LiveSurfaceMadeGone = "grace" | "declined" | "run-end" | "failed";

/** EY-1 (2026-11-24): why custody let a held page go, as custody's own log says it (`made_let_go`): the port's words,
 * and custody's own since.
 * - `unused` (C6): kept, and its run asked nothing of it for KEPT_UNUSED_MS.
 * - `no-window` (C4): the last product window went, so no desk is left for it to land on.
 * - `document-gone` (C4): the window's document that could name it was replaced, and its pane asked with no name. */
export type LiveSurfaceMadeWent = LiveSurfaceMadeGone | "unused" | "no-window" | "document-gone";

/** EY-1 (2026-11-24): each of custody's reasons in the port's words. `unused`, `no-window` and `document-gone` are
 * said as `grace`, the port's "no window took it", which each of them is: the broker forgets a page it had named,
 * and a wait that still stands (the last window went under it) is answered `no-window`. The reason itself is in
 * custody's log line. `failed` is said as itself (C8). */
const MADE_GONE_SAID: Readonly<Record<LiveSurfaceMadeWent, LiveSurfaceMadeGone>> = {
  grace: "grace",
  declined: "declined",
  "run-end": "run-end",
  failed: "failed",
  unused: "grace",
  "no-window": "grace",
  "document-gone": "grace",
};

/** A window's host as custody reads it: its tickets, and (EY-1 C4, 2026-11-24) its renderer generation when it says
 * one (LiveSurfaceWindowHost's own: one more at each document the window loads). A host that says none is unknown,
 * never newer. `rendererLive`: whether that generation's document stands now; false before the window's first load
 * ends and between a navigation's start and its load's end, when the number names a document that is not there. A
 * host that does not say is taken to have one. */
export type LiveSurfaceAuthorityHost = Pick<LiveSurfaceWindowHost, "issue"> & {
  readonly rendererGeneration?: number;
  readonly rendererLive?: boolean;
};

export interface LiveSurfaceAuthorityDeps {
  resolveWindow(identity: RendererParticipantIdentity): { webContentsId: number } | null;
  hostFor(webContentsId: number): LiveSurfaceAuthorityHost | null;
  factories: LiveSurfaceRuntimeFactories;
  enumeration: LiveSurfaceEnumerationSources | null;
  /** PT-S2 (R11): absent or null — the attach's device list is UNAVAILABLE */
  simulatorDevices?: LiveSurfaceSimulatorDeviceSource | null;
  /** PT-S3 (D1): main's simulator census, which `state()` carries as `simulator` — absent: `state()` says none */
  simulatorCensus?: () => LiveSurfaceSimulatorCensus;
  logger?: Logger;
  /** `maxHeld` (EY-1 C5): the pages held for runs across all runs; absent, HELD_PAGES_MAX */
  limits?: { maxRuntimes?: number; maxPerParticipant?: number; maxHeld?: number };
  randomId?: () => string;
  /** EY-1 (1f): the product windows that stand now, by their contents' ids */
  productWindows?: () => readonly number[];
  /** EY-1 (1f): the adopt grace's timer */
  timers?: {
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  /** EY-1 (1f): empties an ended run's memory session, once its last page is gone */
  clearRunPartition?: (source: LiveSurfaceBrowserSourceV1) => Promise<void>;
  /** EY-1 (1f): a made page that went before a window adopted it */
  onMadeDisposed?: (run: string, surfaceId: string, why: LiveSurfaceMadeGone) => void;
  /** EY-1 (C6): the clock a kept page's use is read on (unix ms), the control targets' own; absent: `Date.now` */
  now?: () => number;
}

interface OwnerRecord {
  count: number;
  incarnation: string;
  webContentsId: number;
}

/** EY-1 (1f): a run's hold on a page it made, until a window's mint adopts it. */
interface MadeHold {
  readonly run: string;
  /** the adopt grace's timer: cleared once the page is kept. EY-1 (C6): then the kept page's own, which ends it when
   * its run has asked nothing of it for KEPT_UNUSED_MS */
  timer: unknown;
  /** EY-1 (S1, 2026-11-24): the run was told of the page: the grace is over, and the hold stands for the run */
  kept: boolean;
  /** EY-1 (C6): when it was kept (unix ms); 0 until then */
  keptAt: number;
  /** EY-1 (C4, 2026-11-24): the product windows that stood when its run was told of it (its keep), each with the
   * renderer generation of the document it showed then. The page's id reaches a window's document once, with its
   * pane's place, and lives in that document's memory: a document a window loaded since cannot name the page.
   * Read at the keep, not the make: the pane is placed after the answer that names the page leaves main, in the
   * document that stands then. Null until then: no pane of the page is placed anywhere, so no document's nameless
   * mint is its pane's. A window's own entry is null when it had no standing document at the keep (its first load
   * not ended, or between two documents): the place lands in its next one, so what it can name is unknown. */
  under: ReadonlyMap<number, number | null> | null;
}

/** EY-1 (1f): a run main made pages for, and whether it has ended. EY-1 (7b, 2026-11-19): ONE record per run,
 * kept under a stable key (the run's first id) while fieldd may name the run by another (a resume's rebind). */
interface RunRecord {
  /** its session, fixed at its first make: every page of the run lands here, whichever id a mint names */
  readonly source: LiveSurfaceBrowserSourceV1;
  ended: boolean;
  /** the clear of its session, once begun: never twice */
  clearing: Promise<void> | null;
  /** the id fieldd names the run by now; the run's former ids still map to this record */
  current: string;
  /** the reuse keys of the run's pages main closed: none is minted again while the record stands */
  readonly closedKeys: Set<string>;
}

interface CustodyEntry {
  readonly surfaceId: string;
  readonly kind: LiveSurfaceSourceSpecV1["kind"];
  readonly runtime: LiveSurfaceRuntimeHandle;
  /** set when a window adopts a run's made page under its reuse key */
  dedupeKey: string | null;
  /** True for reuse-keyed entries: a NEW incarnation of the same participant
   * re-binds them (renderer reload continuity — the point of main custody);
   * false entries are swept when their minting document is gone. */
  readonly survivesReload: boolean;
  readonly owners: Map<string, OwnerRecord>;
  /** EY-1 (1f): the run holding a page it made, until a window adopts it */
  hold: MadeHold | null;
  /** EY-1 (1f): the run whose own session the page lives in, or null for any other page. EY-1 (7b): the run
   * record's stable key, never an id a rebind moves */
  readonly run: string | null;
  /** EY-1 (7b): the reuse key a window adopted the run's page under, once one has */
  adoptedKey: string | null;
}

/** EY-1 (1f): a run's own session is a memory profile named by the run. EY-1 (2026-11-24): the prefix is contracts'
 * one word (PAGES_RUN_PROFILE_PREFIX), which the window names a made pane's session from at every mint; main keeps
 * no literal of its own. */
export const RUN_PROFILE_PREFIX = PAGES_RUN_PROFILE_PREFIX;

function runOfSource(source: LiveSurfaceSourceSpecV1): string | null {
  if (source.kind !== "browser" || source.profile.mode !== "memory") return null;
  const ref = source.profile.ref;
  return ref.startsWith(RUN_PROFILE_PREFIX) ? ref.slice(RUN_PROFILE_PREFIX.length) : null;
}

/** EY-1 (1f): the page a window's mint adopts. */
function madeOf(params: ShellSurfacesMintParams): string | undefined {
  return params.made;
}

const NODE_TIMERS = {
  setTimeout(run: () => void, ms: number): unknown {
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return timer;
  },
  clearTimeout(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

const DEFAULT_MAX_RUNTIMES = 64;
const DEFAULT_MAX_PER_PARTICIPANT = 32;

/** EY-1 (C3, 2026-11-24): how many keys, and how many run ids, custody remembers of the runs it ended itself: the
 * newest. One past it is forgotten, and its pane's mint is then refused bare (it stands, and shows no page). */
const RETIRED_MAX = 1024;

/** Remembers `value` in a set bounded at RETIRED_MAX, the oldest dropped. */
function remember(set: Set<string>, value: string): void {
  set.delete(value);
  set.add(value);
  if (set.size <= RETIRED_MAX) return;
  for (const oldest of set) {
    set.delete(oldest);
    return;
  }
}

function defaultRandomId(): string {
  return `s-${randomBytes(18).toString("base64url")}`;
}

function canonicalSourceKey(source: LiveSurfaceSourceSpecV1): string | null {
  // Capture kinds share one producer per identical physical source: the helper
  // multiplexes bounded sessions, so two widgets watching one window must not
  // cost two SCK sessions. Browser pages are deliberately never source-keyed —
  // two widgets with one URL are two pages.
  if (source.kind === "sck-window") {
    return `sck\u0000${source.sourceRef}\u0000${JSON.stringify(source.crop ?? null)}\u0000${String(
      source.captureCursor,
    )}`;
  }
  if (source.kind === "ios-simulator") {
    return `sim\u0000${source.udid}\u0000${JSON.stringify(source.crop ?? null)}`;
  }
  // PT-S2 (R10): a bound phone is keyed by its BINDING — one stream a bound device, whoever asks (and two bindings this
  // Mac resolves to one device share its inner runtime below this key: R3, `ios-simulator-device-runtime.ts`)
  if (source.kind === "ios-simulator-device") {
    return `simdev\u0000${source.binding.deviceType}\u0000${source.binding.runtime}\u0000${JSON.stringify(source.binding.instance ?? null)}\u0000${JSON.stringify(
      source.crop ?? null,
    )}`;
  }
  return null;
}

export class LiveSurfaceAuthority {
  readonly #deps: LiveSurfaceAuthorityDeps;
  readonly #bySurfaceId = new Map<string, CustodyEntry>();
  readonly #byDedupeKey = new Map<string, CustodyEntry>();
  readonly #maxRuntimes: number;
  readonly #maxPerParticipant: number;
  /** EY-1 (C5): the bound on pages held for runs, across runs */
  readonly #maxHeld: number;
  readonly #randomId: () => string;
  #disposed = false;
  /** EY-1 (1f): each window's room for agent pages, as its renderer last said it */
  readonly #rooms = new Map<number, number>();
  /** EY-1 (1f): the runs main made pages for, live or ended. EY-1 (7b): by each record's stable key */
  readonly #runs = new Map<string, RunRecord>();
  /** EY-1 (7b): every id a run has been named by, current and former, to its record's key */
  readonly #runIds = new Map<string, string>();
  /** EY-1 (1f): each reuse key a window adopted a run's page under, from any window, and its run's record key */
  readonly #adoptedKeys = new Map<string, string>();
  /** EY-1 (C3, 2026-11-24): what is left of the runs main ended by itself (`endEveryRun`), whose records are gone: the
   * reuse keys their pages were adopted under, and every id they were named by. A pane of one is told `made-closed`
   * and never opens another session; an id leaves the set when its run makes a page again. */
  readonly #retiredKeys = new Set<string>();
  readonly #retiredRuns = new Set<string>();
  readonly #timers: NonNullable<LiveSurfaceAuthorityDeps["timers"]>;
  /** PT-5c2 (F4): the device switches the runtimes let go had taken — the census's count only grows. */
  #emulationsGone = 0;
  #frameKeysRefusedGone = 0;

  constructor(deps: LiveSurfaceAuthorityDeps) {
    this.#deps = deps;
    this.#maxRuntimes = deps.limits?.maxRuntimes ?? DEFAULT_MAX_RUNTIMES;
    this.#maxPerParticipant = deps.limits?.maxPerParticipant ?? DEFAULT_MAX_PER_PARTICIPANT;
    this.#maxHeld = deps.limits?.maxHeld ?? HELD_PAGES_MAX;
    this.#randomId = deps.randomId ?? defaultRandomId;
    this.#timers = deps.timers ?? NODE_TIMERS;
  }

  async enumerate(params: ShellSurfacesEnumerateParams): Promise<ShellSurfacesEnumerateResult> {
    if (this.#disposed) throw kindError("UNAVAILABLE");
    const enumeration = this.#deps.enumeration;
    if (enumeration === null) throw kindError("UNAVAILABLE");
    let rows: readonly LiveSurfaceEnumerationRow[];
    try {
      rows =
        params.kind === "sck-window"
          ? await enumeration.sckWindows()
          : await enumeration.bootedSimulators();
    } catch (error) {
      if (hasKind(error)) throw error;
      this.#deps.logger?.warn(
        "desktop.live_surfaces.enumeration_failed",
        "live-surface source enumeration failed",
        { kind: params.kind },
      );
      throw kindError("UNAVAILABLE");
    }
    const sources: SurfaceSourceDescriptorV1[] = rows
      .slice(0, SURFACE_LIMITS.MAX_ENUMERATED_SOURCES)
      .map((row) => ({
        kind: params.kind,
        sourceRef: row.sourceRef,
        ...(row.title === undefined ? {} : { title: row.title }),
        ...(row.appName === undefined ? {} : { appName: row.appName }),
      }));
    return { sources };
  }

  mint(params: ShellSurfacesMintParams): ShellSurfacesMintResult {
    if (this.#disposed) throw kindError("UNAVAILABLE");
    const participant = params.rendererParticipant;
    const resolved = this.#deps.resolveWindow(participant);
    // A stale incarnation or unknown participant can never bind new authority.
    if (resolved === null) throw kindError("PRECONDITION_FAILED");
    const host = this.#deps.hostFor(resolved.webContentsId);
    if (host === null) throw kindError("UNAVAILABLE");

    // EY-1 (1f): a mint naming a run's made page adopts it; a run's own session opens only so, or
    // for a key a window adopted into that run while it lives; an adopted key never leaves it
    const made = madeOf(params);
    if (made !== undefined) return this.#adopt(params, made, resolved.webContentsId, host);
    const own = this.#holdRunSession(params, resolved.webContentsId, host.rendererGeneration);
    // EY-1 (7b, 2026-11-19): a run's page lands in its record's own session, fixed at the run's first make,
    // whichever of the run's ids the mint names
    const source: LiveSurfaceSourceSpecV1 =
      own === null || params.source.kind !== "browser"
        ? params.source
        : { ...params.source, profile: own.record.source.profile };

    this.#sweepStaleFor(participant, resolved.webContentsId);

    // PT-S2 (R10): a bound phone dedupes on its canonical key EVEN WITH a reuse key (desk-live always sends one: keyed
    // by it, every phone would cost its own stream of one window); the reuse key still says it survives a reload
    const dedupeKey =
      params.reuseKey !== undefined && params.source.kind !== "ios-simulator-device"
        ? `reuse\u0000${participant.participantId}\u0000${params.source.kind}\u0000${params.reuseKey}`
        : canonicalSourceKey(params.source);

    let entry = dedupeKey === null ? undefined : this.#byDedupeKey.get(dedupeKey);
    let fresh = false;
    if (entry === undefined) {
      this.#assertCapacity(participant.participantId);
      const surfaceId = this.#randomId();
      const runtime = this.#createRuntime(surfaceId, source);
      entry = {
        surfaceId,
        kind: source.kind,
        runtime,
        dedupeKey,
        survivesReload: params.reuseKey !== undefined,
        owners: new Map(),
        hold: null,
        run: own === null ? null : own.key,
        adoptedKey: own === null ? null : (params.reuseKey ?? null),
      };
      fresh = true;
    }

    let ticket: LiveSurfaceAttachTicketV1;
    try {
      ticket = this.#issue(host, entry, params);
    } catch (error) {
      if (fresh) entry.runtime.dispose();
      throw error;
    }

    if (fresh) {
      this.#bySurfaceId.set(entry.surfaceId, entry);
      if (entry.dedupeKey !== null) this.#byDedupeKey.set(entry.dedupeKey, entry);
    }
    this.#own(entry, participant, resolved.webContentsId);
    this.#deps.logger?.info(
      "desktop.live_surfaces.surface_minted",
      "live-surface runtime minted or re-bound",
      {
        surfaceId: entry.surfaceId,
        kind: entry.kind,
        fresh,
        participantId: participant.participantId,
        ...(params.owner?.pluginId === undefined ? {} : { pluginId: params.owner.pluginId }),
      },
    );
    return { surfaceId: entry.surfaceId, ticket };
  }

  /** EY-1 (1f): a page for a run, in the run's own memory session, held by the run with no window
   * as its owner until a window's mint names it (`made`), or the grace ends, or the run does.
   * Refused before anything is made: an ended run; no product window (`no-window`); no room on the
   * desk (`desk-full`, by deskHasRoom: a window's own word, or custody's bound on held pages, C5); custody's own
   * cap. */
  makeForRun(make: LiveSurfaceMakeForRun): { surfaceId: string } {
    // EY-1 (7b): the run's record, or its first make: the run's first id is its record's key for good
    const key = this.#runIds.get(make.run) ?? make.run;
    const { surfaceId, source, runtime } = this.#makeRuntime(make, key);
    const entry: CustodyEntry = {
      surfaceId,
      kind: "browser",
      runtime,
      dedupeKey: null,
      survivesReload: true,
      owners: new Map(),
      hold: null,
      run: key,
      adoptedKey: null,
    };
    entry.hold = {
      run: key,
      timer: this.#timers.setTimeout(() => this.#letGo(entry, "grace"), ADOPT_GRACE_MS),
      kept: false,
      keptAt: 0,
      under: null,
    };
    this.#bySurfaceId.set(surfaceId, entry);
    if (!this.#runs.has(key)) {
      this.#runs.set(key, {
        source,
        ended: false,
        clearing: null,
        current: make.run,
        closedKeys: new Set(),
      });
      this.#runIds.set(make.run, key);
      // EY-1 (C3): a run main ended by itself, named again (by a new fieldd), is a run again: a new record
      this.#retiredRuns.delete(make.run);
    }
    this.#deps.logger?.info("desktop.live_surfaces.made", "a page was made for a run", {
      surfaceId,
      by: make.by,
    });
    // EY-1 (S1, 2026-11-24): no window is attached to a made page until the desk adopts it, and a producer starts
    // only under an attachment's ask, so custody asks the start itself: the page is held for its run, and the pages
    // broker's wait for its binding ends with no window.
    // EY-1 (C7, C8, 2026-11-24): and custody hears if it fails while held (nothing else would start it again): the
    // page is let go, so the wait for its binding ends at once and a page its run was told of is the run's no more
    runtime.holdForRun?.(() => this.#letGo(entry, "failed"));
    return { surfaceId };
  }

  /** EY-1 (1f, 2026-11-19): main's early check of the desk's room, a hint: true while any product
   * window has room or has not said its room yet (unknown, not full: the desk's adopt decides).
   * The one read of the rule: makeForRun and the pages broker's pop-up answer both ask it.
   * EY-1 (C5, 2026-11-24): and false while custody holds its bound of pages for runs (HELD_PAGES_MAX): no desk has
   * shown those yet, so no window's count includes them. */
  deskHasRoom(): boolean {
    if (this.#heldPages() >= this.#maxHeld) return false;
    return (this.#deps.productWindows?.() ?? []).some((id) => {
      const room = this.#rooms.get(id);
      return room === undefined || room > 0;
    });
  }

  /** EY-1 (C5): the pages custody holds for runs now, across every run: made, and adopted by no window yet. */
  #heldPages(): number {
    let held = 0;
    for (const entry of this.#bySurfaceId.values()) if (entry.hold !== null) held += 1;
    return held;
  }

  /** EY-1 (1f): the refusals, then the factory. */
  #makeRuntime(
    make: LiveSurfaceMakeForRun,
    key: string,
  ): {
    surfaceId: string;
    source: LiveSurfaceBrowserSourceV1;
    runtime: LiveSurfaceRuntimeHandle;
  } {
    if (this.#disposed) throw kindError("UNAVAILABLE");
    const record = this.#runs.get(key);
    if (record?.ended === true) throw kindError("PRECONDITION_FAILED");
    const windows = this.#deps.productWindows?.() ?? [];
    if (windows.length === 0) throw kindError("UNAVAILABLE", "no-window");
    if (!this.deskHasRoom()) throw kindError("RESOURCE_EXHAUSTED", "desk-full");
    if (this.#bySurfaceId.size >= this.#maxRuntimes) throw kindError("RESOURCE_EXHAUSTED");
    const source: LiveSurfaceBrowserSourceV1 = {
      kind: "browser",
      initialUrl: make.url,
      // EY-1 (7b): a standing record's own session; a first make's is the run's own, by its id
      profile: record?.source.profile ?? {
        mode: "memory",
        ref: `${RUN_PROFILE_PREFIX}${make.run}`,
      },
      logicalViewport: make.logicalViewport,
      deviceScaleFactor: make.deviceScaleFactor,
      // EY-1 (F2, 2026-11-24): born on the browser pane's default device, the one the desk tells an adopted pane as
      // its lane first goes live. That word is then no device switch, so the page its run worked on is neither
      // reloaded nor made anew at its adopt. Its density is the device's, whatever the make's own names
      emulation: { ...PAGES_MADE_EMULATION },
    };
    const surfaceId = this.#randomId();
    return { surfaceId, source, runtime: this.#createRuntime(surfaceId, source) };
  }

  /** EY-1 (1f): a window's room for agent pages, as its renderer last said it. A window that is not
   * a product window has no desk a run's page could land on: what it says is not kept. */
  setRoom(webContentsId: number, agentPages: number): void {
    if (!(this.#deps.productWindows?.() ?? []).includes(webContentsId)) return;
    this.#rooms.set(webContentsId, agentPages);
  }

  /** EY-1 (1f): a product window will not place a made page: it goes at once. A page already
   * adopted, or none of the run's, is not the window's to let go. */
  declineMade(webContentsId: number, surfaceId: string): void {
    if (!(this.#deps.productWindows?.() ?? []).includes(webContentsId)) return;
    const entry = this.#bySurfaceId.get(surfaceId);
    if (entry === undefined || entry.hold === null) {
      this.#deps.logger?.info(
        "desktop.live_surfaces.made_decline_unheld",
        "a window declined a page no run holds; nothing was let go",
        { known: entry !== undefined },
      );
      return;
    }
    this.#letGo(entry, "declined");
  }

  /** EY-1 (1f): a run's end. Its held pages go; no mint enters its session again; the session is
   * cleared once its last page is gone: at once, or when the last in a person's window goes. */
  async endRun(run: string): Promise<{ disposed: number; clearing: "now" | "waiting" | "none" }> {
    const key = this.#runIds.get(run);
    const known = key === undefined ? undefined : this.#runs.get(key);
    if (key === undefined || known === undefined) return { disposed: 0, clearing: "none" };
    if (known.ended) return { disposed: 0, clearing: known.clearing === null ? "waiting" : "none" };
    known.ended = true;
    let disposed = 0;
    for (const entry of [...this.#bySurfaceId.values()]) {
      if (entry.hold?.run !== key) continue;
      this.#letGo(entry, "run-end");
      disposed += 1;
    }
    this.#runPageGone(key);
    if (known.clearing !== null) {
      await known.clearing;
      return { disposed, clearing: "now" };
    }
    let live = 0;
    for (const entry of this.#bySurfaceId.values()) if (entry.run === key) live += 1;
    this.#deps.logger?.info(
      "desktop.live_surfaces.run_session_waits",
      "an ended run's session is cleared when its last page goes",
      { live },
    );
    return { disposed, clearing: "waiting" };
  }

  /**
   * EY-1 (C3, 2026-11-24) — MAIN'S OWN END OF EVERY RUN IT HOLDS, asked when the fieldd that named them is gone (a
   * fieldd with another boot identity attached: `endRunsOfGoneFieldd`). The new fieldd's pages room knows none of
   * them, so the one message that ends a run in main can never come for them. Each live run is ended whole, here:
   * - its held pages are let go, kept or not, and its run's wait is told (`run-end`);
   * - its ADOPTED pages are closed too, and their windows told (a closed summary): the pane named a run no fieldd
   *   knows, so nothing could work or end its page again. (fieldd's own word for a run's end leaves adopted pages
   *   to the person; then the run is truly over. Here every renderer document is being replaced as well.)
   * - its session is cleared at once, no page of it being left;
   * - and it is FORGOTTEN: no id names it. The same id, named again by the new fieldd, starts a new record in the
   *   run's own session, so an agent that lives through the restart can open a page again. What is kept is the
   *   reuse keys its pages were adopted under and its ids (`#retiredKeys`, `#retiredRuns`): an old pane is told
   *   `made-closed`, and its key never opens the run's new session or the desk's own.
   * A run fieldd had already ended is left as it stands. The answer names each run ended by the id fieldd named it
   * by last, for the pages broker's half of it, and counts the pages that went.
   * Said: a make of the same id while its old session's clear is still under way lands in that session as it empties
   * (the same run's own; the clear is three calls on Electron's session, begun here).
   */
  endEveryRun(): { runs: string[]; pages: number } {
    const runs: string[] = [];
    let pages = 0;
    for (const [key, record] of [...this.#runs]) {
      if (record.ended) continue;
      record.ended = true;
      for (const entry of [...this.#bySurfaceId.values()]) {
        if (entry.run !== key) continue;
        pages += 1;
        if (entry.hold !== null) {
          this.#letGo(entry, "run-end");
          continue;
        }
        this.#disposeEntry(entry);
        this.#deps.logger?.info("desktop.live_surfaces.made_closed", "main closed a run's page", {
          surfaceId: entry.surfaceId,
          adopted: 1,
        });
      }
      this.#runPageGone(key);
      runs.push(record.current);
      for (const [id, named] of [...this.#runIds]) {
        if (named !== key) continue;
        this.#runIds.delete(id);
        remember(this.#retiredRuns, id);
      }
      for (const [reuseKey, into] of [...this.#adoptedKeys]) {
        if (into !== key) continue;
        this.#adoptedKeys.delete(reuseKey);
        remember(this.#retiredKeys, reuseKey);
      }
      this.#runs.delete(key);
    }
    if (runs.length > 0) {
      this.#deps.logger?.warn(
        "desktop.live_surfaces.runs_ended_by_main",
        "main ended the runs of a fieldd that is gone",
        { runs: runs.length, pages },
      );
    }
    return { runs, pages };
  }

  /** EY-1 (7b, 2026-11-19): the run a page of a run's own session belongs to, by the id fieldd names it by now;
   * null for any other page. The pages broker's `made`. */
  madeBy(surfaceId: string): string | null {
    const key = this.#bySurfaceId.get(surfaceId)?.run ?? null;
    return key === null ? null : (this.#runs.get(key)?.current ?? null);
  }

  /** EY-1 (7b): main closes a page of the run's own (an agent's close of its tab, a run's close): it goes, and a
   * window never mints its key again while the run's record stands. A page of no such run is untouched. */
  closeMade(run: string, surfaceId: string): boolean {
    const key = this.#runIds.get(run);
    const entry = this.#bySurfaceId.get(surfaceId);
    const record = key === undefined ? undefined : this.#runs.get(key);
    if (entry === undefined || record === undefined || entry.run !== key) return false;
    if (entry.adoptedKey !== null) record.closedKeys.add(entry.adoptedKey);
    this.#disposeEntry(entry);
    // EY-1 (S1, 2026-11-24): said, so a made page that went by main's own close (its run's close of it, a pane
    // nothing could place, a call's deadline) is read in the log apart from one let go unadopted
    this.#deps.logger?.info("desktop.live_surfaces.made_closed", "main closed a run's page", {
      surfaceId,
      adopted: entry.adoptedKey === null ? 0 : 1,
    });
    return true;
  }

  /** EY-1 (S1, 2026-11-24): the run was told of a page it made (the pages broker says so as an answer naming the page
   * in `made` leaves for the run): the run is using it, so the adopt grace no longer ends it. The hold itself stands:
   * a window's mint naming the page still adopts it, however much later, and it goes besides by the desk's decline,
   * the run's own close, or the run's end. Only the run's own page is kept, while it is held and its run lives:
   * another run's, an adopted one, an unknown one and an ended run's keep nothing. Main's broker alone asks this; no
   * message of a window's reaches it.
   * EY-1 (C6, 2026-11-24): and kept while its run uses it: a kept page its run asks nothing of for KEPT_UNUSED_MS
   * goes too (the answer that named it may never have reached the run). */
  keepForRun(run: string, surfaceId: string): boolean {
    const key = this.#runIds.get(run);
    const record = key === undefined ? undefined : this.#runs.get(key);
    const entry = this.#bySurfaceId.get(surfaceId);
    const hold = entry?.hold ?? null;
    if (entry === undefined || record === undefined || record.ended) return false;
    if (entry.run !== key || hold === null) return false;
    if (hold.kept) return true;
    this.#timers.clearTimeout(hold.timer);
    hold.kept = true;
    hold.keptAt = this.#now();
    // EY-1 (C4): its pane is placed now, in the documents that stand now
    hold.under = this.#documentsNow();
    hold.timer = this.#timers.setTimeout(() => this.#keptUnused(entry), KEPT_UNUSED_MS);
    this.#deps.logger?.info(
      "desktop.live_surfaces.made_kept",
      "a run's page is kept for its run: its adopt grace is over",
      { surfaceId },
    );
    return true;
  }

  /** EY-1 (7b): a resumed run's new id names its record from now; its former ids still do. Refused when `from`
   * names no record, the record has ended, or `to` already names one: two records are never merged. */
  rebindRun(from: string, to: string): boolean {
    const key = this.#runIds.get(from);
    const record = key === undefined ? undefined : this.#runs.get(key);
    if (key === undefined || record === undefined || record.ended || this.#runIds.has(to)) {
      this.#deps.logger?.warn(
        "desktop.live_surfaces.run_rebind_refused",
        "a run's new id was refused",
        { known: record === undefined ? 0 : 1, taken: this.#runIds.has(to) ? 1 : 0 },
      );
      return false;
    }
    this.#runIds.set(to, key);
    record.current = to;
    return true;
  }

  /** PT-S2 (R11) — the attach's device list: this Mac's simulator devices, the booted first, bounded, and REDACTED here
   * too — each row re-parsed (one carrying a UDID is refused) and rebuilt of its four fields, so nothing a source spread
   * onto a row reaches fieldd. With them the runtimes installed here, the newest first: each id re-parsed (CoreSimulator's
   * runtime ids only), bounded. */
  async simulatorDevices(): Promise<ShellSurfacesSimulatorDevicesResult> {
    if (this.#disposed) throw kindError("UNAVAILABLE");
    const source = this.#deps.simulatorDevices ?? null;
    if (source === null) throw kindError("UNAVAILABLE");
    let rows: readonly LiveSurfaceSimulatorDeviceRowV1[];
    let installed: readonly string[] | undefined;
    let options: readonly LiveSurfaceSimulatorRuntimeOptionV1[] | undefined;
    try {
      // (main's one shared simctl list serves both: R8)
      [rows, installed, options] = await Promise.all([
        source.list(),
        source.runtimes?.(),
        source.configurations?.(),
      ]);
    } catch (error) {
      if (hasKind(error)) throw error;
      this.#deps.logger?.warn(
        "desktop.live_surfaces.simulator_devices_failed",
        "the simulator device list failed",
      );
      throw kindError("UNAVAILABLE");
    }
    const devices: LiveSurfaceSimulatorDeviceRowV1[] = [];
    for (const row of rows) {
      if (devices.length >= SURFACE_LIMITS.MAX_SIMULATOR_DEVICES) break;
      const parsed = LiveSurfaceSimulatorDeviceRowV1.safeParse(row);
      if (!parsed.success) continue;
      devices.push({
        deviceType: parsed.data.deviceType,
        runtime: parsed.data.runtime,
        name: parsed.data.name,
        booted: parsed.data.booted,
      });
    }
    const configurations = options
      ?.slice(0, SURFACE_LIMITS.MAX_SIMULATOR_RUNTIMES)
      .flatMap((option) => {
        const parsed = LiveSurfaceSimulatorRuntimeOptionV1.safeParse(option);
        return parsed.success ? [parsed.data] : [];
      });
    const runtimes: string[] = [];
    for (const runtime of installed ?? []) {
      if (runtimes.length >= SURFACE_LIMITS.MAX_SIMULATOR_RUNTIMES) break;
      const parsed = CoreSimulatorRuntimeIdV1.safeParse(runtime);
      if (parsed.success) runtimes.push(parsed.data);
    }
    return {
      devices,
      ...(installed === undefined ? {} : { runtimes }),
      ...(configurations === undefined ? {} : { configurations }),
    };
  }

  /** EY-1 (1e, 2026-11-19): a browser page's state for the pages broker, by its surface, bound or
   * not (BrowserAgentPageState): its runtime's own word. Null for a surface main does not hold or a
   * capture's. Read-only: never a runtime, never a mint. */
  agentPageState(surfaceId: string): BrowserAgentPageState | null {
    return this.#bySurfaceId.get(surfaceId)?.runtime.agentPageState?.() ?? null;
  }

  release(params: ShellSurfacesReleaseParams): ShellSurfacesReleaseResult {
    const entry = this.#bySurfaceId.get(params.surfaceId);
    const owner = entry?.owners.get(params.rendererParticipant.participantId);
    if (entry === undefined || owner === undefined) return { released: false };
    owner.count -= 1;
    if (owner.count <= 0) entry.owners.delete(params.rendererParticipant.participantId);
    if (entry.owners.size === 0) this.#disposeEntry(entry);
    return { released: true };
  }

  /** Wired to the window's destroyed hook: custody never outlives its window.
   * EY-1 (C4, 2026-11-24): and a page held for a run never outlives the LAST product window. It was made for the desk
   * of the windows that stood (a make with none is refused), and with none left no desk can place it and no document
   * can name it: it goes, kept or not, and its run is told (its next call on it answers gone; a make is refused
   * `no-window` until a window stands). While another product window stands, a held page stays. (Before: it stood on
   * unseen, its run still working it, until its run's end.) */
  releaseAllForWebContents(webContentsId: number): void {
    this.#rooms.delete(webContentsId);
    for (const entry of [...this.#bySurfaceId.values()]) {
      for (const [participantId, owner] of [...entry.owners]) {
        if (owner.webContentsId === webContentsId) entry.owners.delete(participantId);
      }
      // EY-1 (1f): a page its run still holds belongs to no window yet
      if (entry.owners.size === 0 && entry.hold === null) this.#disposeEntry(entry);
    }
    const standing = (this.#deps.productWindows?.() ?? []).some((id) => id !== webContentsId);
    if (standing) return;
    for (const entry of [...this.#bySurfaceId.values()]) {
      if (entry.hold !== null) this.#letGo(entry, "no-window");
    }
  }

  /** Counts-only census for Doctor-style disclosure; never retains runtimes. PT-5c2 (F4): with the device switches its
   * browser pages took — each runtime's `stats.emulations`, those let go included: MAIN's own count of the switches its
   * runtimes accepted (a switch asked of a born, live page is told at once; one asked of a window not yet born, at its
   * birth; one that moves the density remakes the window). The smoke's TAPS-PENDING reads it of a born, live page — where a
   * moved count is a device command sent; the desk's own count moves when its lane takes the write, sent or not. PT-S3
   * (D1): and main's simulator census, when the authority was given one (`simulatorCensus`). */
  state(): {
    runtimes: number;
    owners: number;
    emulations: number;
    frameKeysRefused: number;
    handInFlight: number;
    pullOnly: number;
    childSessions: number;
    childSessionsBy: Record<string, number>;
    simulator?: LiveSurfaceSimulatorCensus;
  } {
    let owners = 0;
    let emulations = this.#emulationsGone;
    // PT-5d (M15): and the key-like events refused because a frame of another site held the focus — typing into such a
    // frame is off; the smoke's FRAME-TYPE reads that it was refused
    let frameKeysRefused = this.#frameKeysRefusedGone;
    // PT-6a (K5): and the hand's commands its pages have SENT and not had answered, NOW — a page that went keeps none
    let handInFlight = 0;
    // PT-6a (M4 — F1): and its pages whose current document is PULL-ONLY (a mute document, asked for its words)
    let pullOnly = 0;
    // PT-6a (M8 — C5): and the sessions of its pages' frames of other sites, NOW — each page's current document's; PT-6a
    // (M14 — R3): and each runtime's by its SURFACE (one that counts none is absent) — what a row reads of its own pane
    let childSessions = 0;
    const childSessionsBy: Record<string, number> = {};
    for (const [surfaceId, entry] of this.#bySurfaceId) {
      owners += entry.owners.size;
      emulations += entry.runtime.emulations?.() ?? 0;
      frameKeysRefused += entry.runtime.frameKeysRefused?.() ?? 0;
      handInFlight += entry.runtime.handInFlight?.() ?? 0;
      pullOnly += entry.runtime.pullOnly?.() ?? 0;
      const sessions = entry.runtime.childSessions?.();
      if (sessions !== undefined) {
        childSessions += sessions;
        childSessionsBy[surfaceId] = sessions;
      }
    }
    const simulator = this.#deps.simulatorCensus?.();
    return {
      runtimes: this.#bySurfaceId.size,
      owners,
      emulations,
      frameKeysRefused,
      handInFlight,
      pullOnly,
      childSessions,
      childSessionsBy,
      ...(simulator === undefined ? {} : { simulator }),
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of [...this.#bySurfaceId.values()]) this.#disposeEntry(entry);
  }

  /** The window's interaction ticket for an entry: thrown as a kind, never a raw error. */
  #issue(
    host: Pick<LiveSurfaceWindowHost, "issue">,
    entry: CustodyEntry,
    params: ShellSurfacesMintParams,
  ): LiveSurfaceAttachTicketV1 {
    try {
      return host.issue({
        surfaceId: entry.surfaceId,
        sourceKind: entry.kind,
        operations:
          entry.kind === "browser"
            ? ["view", "pointer", "keyboard", "navigate"]
            : entry.kind === "ios-simulator-device"
              ? entry.runtime.deviceInput
                ? ["view", "device", "pointer", "keyboard"]
                : ["view", "device"]
              : ["view"],
        principalId: params.owner?.pluginId ?? params.rendererParticipant.participantId,
        authority: entry.runtime,
      });
    } catch (error) {
      if (hasKind(error)) throw error;
      const capacity =
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        String((error as { message: unknown }).message).includes("capacity");
      throw kindError(capacity ? "RESOURCE_EXHAUSTED" : "UNAVAILABLE");
    }
  }

  #own(entry: CustodyEntry, participant: RendererParticipantIdentity, webContentsId: number): void {
    const owner = entry.owners.get(participant.participantId);
    if (owner === undefined) {
      entry.owners.set(participant.participantId, {
        count: 1,
        incarnation: participant.incarnation,
        webContentsId,
      });
    } else {
      owner.count += 1;
      owner.incarnation = participant.incarnation;
      owner.webContentsId = webContentsId;
    }
  }

  /** EY-1 (1f): a window's mint naming a run's made page adopts it: the same page, under the mint's
   * reuse key, the window its owner, the run's hold and its grace gone. Only a page the run still
   * holds, minted in that run's own session, under a reuse key that names no page yet. */
  #adopt(
    params: ShellSurfacesMintParams,
    made: string,
    webContentsId: number,
    host: Pick<LiveSurfaceWindowHost, "issue">,
  ): ShellSurfacesMintResult {
    const entry = this.#bySurfaceId.get(made);
    const id = runOfSource(params.source);
    const run = id === null ? undefined : this.#runIds.get(id);
    const reuseKey = params.reuseKey;
    // EY-1 (7b, 2026-11-19): a run's page main let go (its grace, a decline, the run's end) or never made is gone
    // for good, and the refusal says so; another run's, an adopted one and a mint outside a run's session stay bare
    if (entry === undefined && id !== null) {
      throw kindError("PRECONDITION_FAILED", SHELL_SURFACES_MADE_CLOSED);
    }
    if (entry === undefined || entry.hold === null || run === undefined || entry.run !== run) {
      throw kindError("PRECONDITION_FAILED");
    }
    if (reuseKey === undefined) {
      throw kindError("PRECONDITION_FAILED");
    }
    // EY-1 (7b): a key main closed is never minted again, not even onto another page the run holds
    if (this.#runs.get(run)?.closedKeys.has(reuseKey) === true) {
      // the window's one designed probe after a close it was not shown (EY, 2026-11-24): an answer, not a fault
      this.#deps.logger?.info(
        "desktop.live_surfaces.run_key_closed",
        "a mint of a run's page main closed",
        {},
      );
      throw kindError("PRECONDITION_FAILED", SHELL_SURFACES_MADE_CLOSED);
    }
    // EY-1 (C3, 2026-11-24): a key of a run main ended by itself is its old pane's: it adopts no page of the run's new
    // record, and leaves
    if (this.#retiredKeys.has(reuseKey)) {
      this.#deps.logger?.warn(
        "desktop.live_surfaces.run_key_closed",
        "a mint under a key of a run main ended",
        {},
      );
      throw kindError("PRECONDITION_FAILED", SHELL_SURFACES_MADE_CLOSED);
    }
    const participant = params.rendererParticipant;
    const dedupeKey = `reuse\u0000${participant.participantId}\u0000browser\u0000${reuseKey}`;
    if (this.#byDedupeKey.has(dedupeKey)) throw kindError("PRECONDITION_FAILED");
    const ticket = this.#issue(host, entry, params);
    this.#timers.clearTimeout(entry.hold.timer);
    entry.hold = null;
    entry.dedupeKey = dedupeKey;
    this.#byDedupeKey.set(dedupeKey, entry);
    this.#adoptedKeys.set(reuseKey, run);
    entry.adoptedKey = reuseKey;
    this.#own(entry, participant, webContentsId);
    this.#deps.logger?.info("desktop.live_surfaces.made_adopted", "a run's page was adopted", {
      surfaceId: entry.surfaceId,
      participantId: participant.participantId,
    });
    return { surfaceId: entry.surfaceId, ticket };
  }

  /** EY-1 (1f): what a mint that names no made page may do with a run's session. A run's own
   * session opens only for a key a window adopted into that run, while the run lives (a reload, a
   * wake, an undo, a second window); a key adopted into a run never re-mints outside it.
   *
   * EY-1 (C4, 2026-11-24): THE PANE THAT NAMES NO PAGE. A mint into a session of one of THIS main's runs, under a key
   * no run ever adopted, is a pane placed for a made page whose id its document does not hold (or a copy of such a
   * pane). It opens nothing, as before: a page is adopted only by a mint that names it. Two things are read off it:
   * - a held page of the run whose run was told of it under an OLDER document of this window can never be named by
   *   this one (the id lived in the document that is gone), so it is let go, unless another product window that
   *   stood then still shows the document it showed then, or may hold the id for all custody knows;
   * - when the run then holds no page at all, no page can ever come to this pane: the refusal says `made-closed`, the
   *   one word a pane leaves on. While the run still holds one, the refusal stays bare.
   * A run this main never had (a pane synced from another device), and a key adopted into another run, stay bare:
   * a stale or forged prop never removes a pane. (Before: every such mint was refused bare, so after a reload a made
   * page's pane stood on a failure for good while its page lived on unseen.) */
  #holdRunSession(
    params: ShellSurfacesMintParams,
    webContentsId: number,
    generation: number | undefined,
  ): { key: string; record: RunRecord } | null {
    const id = runOfSource(params.source);
    const reuseKey = params.reuseKey;
    const adoptedInto = reuseKey === undefined ? undefined : this.#adoptedKeys.get(reuseKey);
    // EY-1 (C3, 2026-11-24): a key of a run main ended by itself (its fieldd gone) is its old pane's, for good
    const retired = reuseKey !== undefined && this.#retiredKeys.has(reuseKey);
    if (id !== null) {
      // EY-1 (7b): any id the run has been named by finds its one record
      const key = this.#runIds.get(id);
      const record = key === undefined ? undefined : this.#runs.get(key);
      // EY-1 (C3): the old pane of such a run is told its page is gone for good, whether its key was adopted or its
      // page was still held when the run was ended (the run then names no record, until it makes a page again)
      if (
        retired ||
        (key === undefined && adoptedInto === undefined && this.#retiredRuns.has(id))
      ) {
        // the pane's last probe as its run's end reaches it, which tells it to leave (EY, 2026-11-24): an answer
        this.#deps.logger?.info(
          "desktop.live_surfaces.run_session_refused",
          "a mint into the session of a run main ended",
          { adopted: retired ? 1 : 0, ended: 1 },
        );
        throw kindError("PRECONDITION_FAILED", SHELL_SURFACES_MADE_CLOSED);
      }
      if (key !== undefined && record !== undefined && adoptedInto === undefined) {
        this.#letGoUnnameable(key, webContentsId, generation);
        if (!this.#holdsFor(key)) {
          this.#deps.logger?.warn(
            "desktop.live_surfaces.run_session_refused",
            "a mint into a run's session with no page held for it",
            { adopted: 0, held: 0, ended: record.ended ? 1 : 0 },
          );
          throw kindError("PRECONDITION_FAILED", SHELL_SURFACES_MADE_CLOSED);
        }
      }
      if (key === undefined || record === undefined || adoptedInto !== key) {
        this.#deps.logger?.warn(
          "desktop.live_surfaces.run_session_refused",
          "a mint into a run's session it was not adopted into",
          { adopted: adoptedInto === undefined ? 0 : 1 },
        );
        throw kindError("PRECONDITION_FAILED");
      }
      // EY-1 (7b, 2026-11-19): a key adopted into the run, after the run's end or after main closed its page, is
      // gone for good, and the refusal says so
      if (record.ended) {
        // the pane's own probe as its run's end reaches it (EY, 2026-11-24): an answer, not a fault
        this.#deps.logger?.info(
          "desktop.live_surfaces.run_session_refused",
          "a mint into a run's session after its end",
          { adopted: 1, ended: 1 },
        );
        throw kindError("PRECONDITION_FAILED", SHELL_SURFACES_MADE_CLOSED);
      }
      if (reuseKey !== undefined && record.closedKeys.has(reuseKey)) {
        // the pane's own probe after its run closed the page (EY, 2026-11-24): an answer, not a fault
        this.#deps.logger?.info(
          "desktop.live_surfaces.run_key_closed",
          "a mint of a run's page main closed",
          {},
        );
        throw kindError("PRECONDITION_FAILED", SHELL_SURFACES_MADE_CLOSED);
      }
      return { key, record };
    }
    if ((adoptedInto !== undefined || retired) && params.source.kind === "browser") {
      this.#deps.logger?.warn(
        "desktop.live_surfaces.run_key_refused",
        "a run's adopted page asked for another session",
        { mode: params.source.profile.mode === "memory" ? 1 : 0 },
      );
      throw kindError("PRECONDITION_FAILED");
    }
    return null;
  }

  /** EY-1 (C4, 2026-11-24): the product windows that stand now, each with the renderer generation of the document it
   * shows, or null when its host says it shows none now (`rendererLive` false). One whose host says no generation is
   * left out: unknown. */
  #documentsNow(): Map<number, number | null> {
    const under = new Map<number, number | null>();
    for (const id of this.#deps.productWindows?.() ?? []) {
      const host = this.#deps.hostFor(id);
      const generation = host?.rendererGeneration;
      if (host === null || generation === undefined) continue;
      under.set(id, host.rendererLive === false ? null : generation);
    }
    return under;
  }

  /** EY-1 (C4): whether custody holds a page for the run that no window has adopted. */
  #holdsFor(key: string): boolean {
    for (const entry of this.#bySurfaceId.values()) {
      if (entry.run === key && entry.hold !== null) return true;
    }
    return false;
  }

  /** EY-1 (C4): the run's held pages that the asking window's document can no longer name are let go: each one its
   * run was told of while this window showed an older document, with no other product window that may still hold its
   * id. Another window may when it shows the document it showed then, or when custody cannot tell: its host says no
   * generation, or it had no standing document then or has none now. A page its run was not told of yet is never let
   * go here, nor one told of while the asking window had no standing document; a window that says no generation
   * lets nothing go. What is not let go here stands until its adopt, its run's end, or the kept page's own clock. */
  #letGoUnnameable(key: string, webContentsId: number, generation: number | undefined): void {
    if (generation === undefined) return;
    const now = this.#documentsNow();
    const others = (this.#deps.productWindows?.() ?? []).filter((id) => id !== webContentsId);
    for (const entry of [...this.#bySurfaceId.values()]) {
      const under = entry.hold?.under ?? null;
      if (entry.run !== key || under === null) continue;
      const was = under.get(webContentsId);
      if (was === undefined || was === null || generation <= was) continue;
      const elsewhere = others.some((id) => {
        const stood = under.get(id);
        const stands = now.get(id);
        return stands === undefined || stands === null || stood === null || stands === stood;
      });
      if (!elsewhere) this.#letGo(entry, "document-gone");
    }
  }

  /** EY-1 (C6, 2026-11-24): a kept page's clock ran out. If its run asked for it since (the pages plane's last asking
   * for its control binding), the clock runs on from that asking; else the page goes. A page adopted, closed or let
   * go meanwhile has no clock left to answer. */
  #keptUnused(entry: CustodyEntry): void {
    const hold = entry.hold;
    if (hold === null || !hold.kept || this.#bySurfaceId.get(entry.surfaceId) !== entry) return;
    const used = Math.max(hold.keptAt, entry.runtime.agentAskedAt?.() ?? 0);
    const left = KEPT_UNUSED_MS - (this.#now() - used);
    if (left > 0) {
      hold.timer = this.#timers.setTimeout(() => this.#keptUnused(entry), left);
      return;
    }
    this.#letGo(entry, "unused");
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)();
  }

  /** EY-1 (1f): a held page goes before any window adopted it, and its run is told why. EY-1 (2026-11-24): a page
   * a window has adopted meanwhile, or one already gone, is nothing here; the reason is custody's own in its log and
   * the port's word to the broker (MADE_GONE_SAID). */
  #letGo(entry: CustodyEntry, why: LiveSurfaceMadeWent): void {
    const hold = entry.hold;
    if (hold === null || this.#bySurfaceId.get(entry.surfaceId) !== entry) return;
    this.#timers.clearTimeout(hold.timer);
    entry.hold = null;
    this.#disposeEntry(entry);
    const current = this.#runs.get(hold.run)?.current ?? hold.run;
    // EY-1 (S1, 2026-11-24): said, so a page that left unadopted is read in the log by why, and whether it was kept
    this.#deps.logger?.info(
      "desktop.live_surfaces.made_let_go",
      "a run's page went before any window adopted it",
      { surfaceId: entry.surfaceId, why, kept: hold.kept ? 1 : 0 },
    );
    this.#deps.onMadeDisposed?.(current, entry.surfaceId, MADE_GONE_SAID[why]);
  }

  /** EY-1 (1f): an ended run's session is cleared, once, when no page of it is left. */
  #runPageGone(run: string): void {
    const known = this.#runs.get(run);
    if (known === undefined || !known.ended || known.clearing !== null) return;
    for (const entry of this.#bySurfaceId.values()) if (entry.run === run) return;
    const clear = this.#deps.clearRunPartition;
    known.clearing =
      clear === undefined
        ? Promise.resolve()
        : clear(known.source).then(
            () => {
              this.#deps.logger?.info(
                "desktop.live_surfaces.run_session_cleared",
                "an ended run's session was cleared",
                { pages: 0 },
              );
            },
            () => {
              this.#deps.logger?.warn(
                "desktop.live_surfaces.run_session_clear_failed",
                "an ended run's session was not cleared",
                { pages: 0 },
              );
            },
          );
  }

  #sweepStaleFor(participant: RendererParticipantIdentity, webContentsId: number): void {
    for (const entry of [...this.#bySurfaceId.values()]) {
      const owner = entry.owners.get(participant.participantId);
      if (owner === undefined || owner.incarnation === participant.incarnation) continue;
      if (entry.survivesReload) {
        // Reload continuity: the running page/session re-binds to the new
        // document; the reuse key is what asked for exactly this. The gone
        // document's mints are forgiven — its pool left custody standing on
        // purpose and nobody can pay them back — so the new document's own
        // closes release the page (PT-2: else a page outlived its object
        // until the window closed).
        owner.incarnation = participant.incarnation;
        owner.webContentsId = webContentsId;
        owner.count = 0;
        continue;
      }
      // The minting document is gone and nothing can name this runtime again.
      entry.owners.delete(participant.participantId);
      if (entry.owners.size === 0) this.#disposeEntry(entry);
    }
  }

  #assertCapacity(participantId: string): void {
    if (this.#bySurfaceId.size >= this.#maxRuntimes) throw kindError("RESOURCE_EXHAUSTED");
    let held = 0;
    for (const entry of this.#bySurfaceId.values()) {
      if (entry.owners.has(participantId)) held += 1;
    }
    if (held >= this.#maxPerParticipant) throw kindError("RESOURCE_EXHAUSTED");
  }

  #createRuntime(surfaceId: string, source: LiveSurfaceSourceSpecV1): LiveSurfaceRuntimeHandle {
    try {
      if (source.kind === "browser") return this.#deps.factories.browser(surfaceId, source);
      if (source.kind === "sck-window") return this.#deps.factories.sckWindow(surfaceId, source);
      if (source.kind === "ios-simulator") {
        return this.#deps.factories.iosSimulator(surfaceId, source);
      }
      return this.#deps.factories.iosSimulatorDevice(surfaceId, source);
    } catch (error) {
      if (hasKind(error)) throw error;
      this.#deps.logger?.warn(
        "desktop.live_surfaces.runtime_construction_rejected",
        "a live-surface runtime refused its source specification",
        { kind: source.kind },
      );
      throw kindError("PRECONDITION_FAILED");
    }
  }

  #disposeEntry(entry: CustodyEntry): void {
    this.#emulationsGone += entry.runtime.emulations?.() ?? 0;
    this.#frameKeysRefusedGone += entry.runtime.frameKeysRefused?.() ?? 0;
    this.#bySurfaceId.delete(entry.surfaceId);
    if (entry.dedupeKey !== null) this.#byDedupeKey.delete(entry.dedupeKey);
    if (entry.hold !== null) {
      this.#timers.clearTimeout(entry.hold.timer);
      entry.hold = null;
    }
    try {
      entry.runtime.dispose();
    } catch (error) {
      this.#deps.logger?.error(
        "desktop.live_surfaces.runtime_dispose_failed",
        "a live-surface runtime failed to dispose cleanly",
        error,
        { surfaceId: entry.surfaceId, kind: entry.kind },
      );
    }
    // EY-1 (1f): an ended run's session is cleared once its last page is gone
    if (entry.run !== null) this.#runPageGone(entry.run);
  }
}
