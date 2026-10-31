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
  SURFACE_LIMITS,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { LiveSurfaceRuntimeAuthority } from "./runtime";
import type { SimctlVetted } from "./simctl";
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
}

function kindError(kind: KindError["kind"]): KindError {
  return { kind };
}

function hasKind(error: unknown): error is KindError {
  return typeof error === "object" && error !== null && "kind" in error;
}

export interface LiveSurfaceRuntimeHandle extends LiveSurfaceRuntimeAuthority {
  dispose(): void;
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
  } | null;
  /** which answer main's simctl probe vetted (P1) — null: none yet, or no Simulator here */
  readonly vetted: SimctlVetted | null;
}

export interface LiveSurfaceAuthorityDeps {
  resolveWindow(identity: RendererParticipantIdentity): { webContentsId: number } | null;
  hostFor(webContentsId: number): Pick<LiveSurfaceWindowHost, "issue"> | null;
  factories: LiveSurfaceRuntimeFactories;
  enumeration: LiveSurfaceEnumerationSources | null;
  /** PT-S2 (R11): absent or null — the attach's device list is UNAVAILABLE */
  simulatorDevices?: LiveSurfaceSimulatorDeviceSource | null;
  /** PT-S3 (D1): main's simulator census, which `state()` carries as `simulator` — absent: `state()` says none */
  simulatorCensus?: () => LiveSurfaceSimulatorCensus;
  logger?: Logger;
  limits?: { maxRuntimes?: number; maxPerParticipant?: number };
  randomId?: () => string;
}

interface OwnerRecord {
  count: number;
  incarnation: string;
  webContentsId: number;
}

interface CustodyEntry {
  readonly surfaceId: string;
  readonly kind: LiveSurfaceSourceSpecV1["kind"];
  readonly runtime: LiveSurfaceRuntimeHandle;
  readonly dedupeKey: string | null;
  /** True for reuse-keyed entries: a NEW incarnation of the same participant
   * re-binds them (renderer reload continuity — the point of main custody);
   * false entries are swept when their minting document is gone. */
  readonly survivesReload: boolean;
  readonly owners: Map<string, OwnerRecord>;
}

const DEFAULT_MAX_RUNTIMES = 64;
const DEFAULT_MAX_PER_PARTICIPANT = 32;

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
    return `simdev\u0000${source.binding.deviceType}\u0000${source.binding.runtime}\u0000${JSON.stringify(
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
  readonly #randomId: () => string;
  #disposed = false;
  /** PT-5c2 (F4): the device switches the runtimes let go had taken — the census's count only grows. */
  #emulationsGone = 0;
  #frameKeysRefusedGone = 0;

  constructor(deps: LiveSurfaceAuthorityDeps) {
    this.#deps = deps;
    this.#maxRuntimes = deps.limits?.maxRuntimes ?? DEFAULT_MAX_RUNTIMES;
    this.#maxPerParticipant = deps.limits?.maxPerParticipant ?? DEFAULT_MAX_PER_PARTICIPANT;
    this.#randomId = deps.randomId ?? defaultRandomId;
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
      const runtime = this.#createRuntime(surfaceId, params.source);
      entry = {
        surfaceId,
        kind: params.source.kind,
        runtime,
        dedupeKey,
        survivesReload: params.reuseKey !== undefined,
        owners: new Map(),
      };
      fresh = true;
    }

    let ticket: LiveSurfaceAttachTicketV1;
    try {
      ticket = host.issue({
        surfaceId: entry.surfaceId,
        sourceKind: entry.kind,
        // DT-D6: browser surfaces carry the human interaction ops; capture and
        // Simulator are view-only in v1 and advertise no input capability.
        // PT-S2: a bound phone adds its face's acts (boot, create, show, retry,
        // Open Settings) — still no input of any kind.
        operations:
          entry.kind === "browser"
            ? ["view", "pointer", "keyboard", "navigate"]
            : entry.kind === "ios-simulator-device"
              ? ["view", "device"]
              : ["view"],
        principalId: params.owner?.pluginId ?? participant.participantId,
        authority: entry.runtime,
      });
    } catch (error) {
      if (fresh) entry.runtime.dispose();
      if (hasKind(error)) throw error;
      const capacity =
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        String((error as { message: unknown }).message).includes("capacity");
      throw kindError(capacity ? "RESOURCE_EXHAUSTED" : "UNAVAILABLE");
    }

    if (fresh) {
      this.#bySurfaceId.set(entry.surfaceId, entry);
      if (entry.dedupeKey !== null) this.#byDedupeKey.set(entry.dedupeKey, entry);
    }
    const owner = entry.owners.get(participant.participantId);
    if (owner === undefined) {
      entry.owners.set(participant.participantId, {
        count: 1,
        incarnation: participant.incarnation,
        webContentsId: resolved.webContentsId,
      });
    } else {
      owner.count += 1;
      owner.incarnation = participant.incarnation;
      owner.webContentsId = resolved.webContentsId;
    }
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
    try {
      // (main's one shared simctl list serves both: R8)
      [rows, installed] = await Promise.all([source.list(), source.runtimes?.()]);
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
    if (installed === undefined) return { devices };
    const runtimes: string[] = [];
    for (const runtime of installed) {
      if (runtimes.length >= SURFACE_LIMITS.MAX_SIMULATOR_RUNTIMES) break;
      const parsed = CoreSimulatorRuntimeIdV1.safeParse(runtime);
      if (parsed.success) runtimes.push(parsed.data);
    }
    return { devices, runtimes };
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

  /** Wired to the window's destroyed hook: custody never outlives its window. */
  releaseAllForWebContents(webContentsId: number): void {
    for (const entry of [...this.#bySurfaceId.values()]) {
      for (const [participantId, owner] of [...entry.owners]) {
        if (owner.webContentsId === webContentsId) entry.owners.delete(participantId);
      }
      if (entry.owners.size === 0) this.#disposeEntry(entry);
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
  }
}
