import {
  type LiveSurfaceCropV1,
  type LiveSurfaceDemandV1,
  type LiveSurfaceDeviceCommandV1,
  type LiveSurfaceDeviceVerbV1,
  LiveSurfaceIdV1,
  type LiveSurfaceIosSimulatorBindingV1,
  LiveSurfaceIosSimulatorDeviceSourceV1,
  type LiveSurfaceRuntimeSummaryV1,
  type LiveSurfaceSimulatorConditionV1,
  LiveSurfaceSimulatorStateV1,
  type LiveSurfaceIosSimulatorDeviceSourceV1 as SimulatorDeviceSource,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { LiveSurfaceRuntimeHandle } from "./authority";
import {
  IosSimulatorLiveSurfaceRuntime,
  type IosSimulatorResolutionProvider,
  type ResolvedIosSimulatorCapture,
} from "./ios-simulator-producer";
import type { LiveSurfaceRuntimeAttachContext, LiveSurfaceRuntimeAttachment } from "./runtime";
import {
  createLiveSurfaceRuntimeSupportSnapshot,
  type LiveSurfaceRuntimeSupportSnapshot,
} from "./runtime-support";
import { type SckCaptureClient, SckCaptureClientError } from "./sck-producer";
import {
  pickDevice,
  type SimctlDevicePick,
  type SimctlService,
  type SimctlSnapshot,
  SimctlUnavailableError,
} from "./simctl";
import type { LiveSurfaceProducerTextureFrame } from "./texture-forwarder";

// PT-S2 — A PHONE BOUND BY ITS DEVICE TYPE AND RUNTIME (`ios-simulator-device`): main resolves the binding to one of THIS
// Mac's devices (R3, `pickDevice`), keeps the UDID, and reports where the device is as FACTS (`summary.simulator`, R2) —
// the renderer says them in the SDK's words. Below the facts it is the ordinary Simulator capture: ONE inner
// `IosSimulatorLiveSurfaceRuntime` (SCK pixels) for the session's whole life (R7) — a summary whose `stateRevision` or
// `producerEpoch` moves backwards kills the window's whole live-surface generation (`control-session.ts`), so the device
// under it changes by its RESOLVER, a closure over the current pick, never by a fresh inner. Main withholds the renderer's
// demand until the device is `streaming` (a hibernated demand of main's own: the inner never spins on an absent device)
// and re-forwards the renderer's last ask when it is. The acts (boot · create · show · retry · Open Settings) are main's,
// each single-flight with `acting` said while it runs (R4); an act its condition does not offer is nothing (the face
// races the summary). The watch reads the shared simctl snapshot (R8) every ~2 s while the device is not streaming or an
// act runs, every ~5 s at rest; while live, the inner's own 1 s revalidation watches the window. Nothing here ever shuts
// a device down: a device is the person's.
//
// R3, ONE STREAM A DEVICE: two bindings that land on one device share one inner runtime — a session that has published
// nothing yet (its inner still at its first revision, so its holders can only move forwards) JOINS the session already
// streaming the device it picked. Sessions that converge after both have published keep their own streams (moving one
// would move its summaries backwards); the authority's canonical key already gives one binding one surface. The share
// lasts while the bindings agree: each surface keeps its OWN binding, and one whose binding comes to pick another device
// (it reached this one by a fallback tier, and the devices moved under it) leaves for a session of its own at its next
// idle — at once with no face attached, else when its last face detaches; never under a face (a fresh inner would move
// that face's summaries backwards). The session itself picks by a binding one of its members HOLDS: the opener's, and
// when that surface leaves, a remaining member's (one that agreed at the last look first) — never a binding no member
// holds any more. The device then moves at the next look, by the resolver, under the same inner.

/** The inner's own source never reaches a capture: its resolver is the session's closure. Contract-valid, never a UDID. */
const PLACEHOLDER_UDID = "bound-simulator";
const WATCH_UNREADY_MS = 2_000;
const WATCH_REST_MS = 5_000;
/** After main boots or creates a device, a booted device with no window yet is still on its way up for this long. */
const BOOT_GRACE_MS = 30_000;
/** After main shows a device's window, the same for Simulator.app to draw it. */
const SHOW_GRACE_MS = 10_000;

/** What the last resolution of the picked device's window said (reset when the pick moves to another device). */
type WindowVerdict = "unknown" | "found" | "none" | "ambiguous" | "denied";

/** The simctl verbs a bound simulator uses (main's one `SimctlService`). */
export type SimulatorDeviceSimctl = Pick<
  SimctlService,
  "list" | "invalidate" | "boot" | "create" | "show"
>;

/** The capture half a bound simulator streams through: the UDID resolver and the helper's client. */
export interface SimulatorDeviceCapture {
  readonly resolver: IosSimulatorResolutionProvider;
  readonly client: SckCaptureClient;
}

export interface SimulatorDeviceSessionsOptions {
  readonly simctl: SimulatorDeviceSimctl;
  /** Built lazily, at the first look; THROWS on a shell with no capture half (not a Mac, or no helper) — the face's
   * `no-simulator` (R5), never a mint error. */
  readonly capture: () => SimulatorDeviceCapture;
  /** main's fixed Screen Recording settings address, behind the harness's gate */
  readonly openSettings: () => Promise<void>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly watchUnreadyMs?: number;
  readonly watchRestMs?: number;
  readonly bootGraceMs?: number;
  readonly showGraceMs?: number;
  /** the inner SCK runtime's own bounds */
  readonly revalidateIntervalMs?: number;
  readonly startupTimeoutMs?: number;
  readonly restartLimit?: number;
  readonly monotonicNowUs?: () => bigint;
}

/** One phone's surface: what the authority holds (`factories.iosSimulatorDevice`). */
export interface IosSimulatorDeviceLiveSurfaceRuntime extends LiveSurfaceRuntimeHandle {
  readonly source: SimulatorDeviceSource;
  readonly summary: LiveSurfaceRuntimeSummaryV1;
  supportSnapshot(): LiveSurfaceRuntimeSupportSnapshot;
}

/** The pool's half a session reaches: R3's host search, a strayed member's own session, its own leaving, and the inner
 * attachments' ids. */
interface SessionPool {
  hostFor(joiner: DeviceSession, udid: string): DeviceSession | undefined;
  split(member: SessionMember): void;
  forget(session: DeviceSession): void;
  nextAttachmentId(): string;
}

interface SessionMember {
  readonly surfaceId: string;
  /** this surface's own binding and crop — what it follows, even inside a session it joined (R3) */
  readonly source: SimulatorDeviceSource;
  /** the session serving this surface — moved by an R3 join, and out again by a split */
  session: DeviceSession;
  /** its own binding picks another device than its session streams, at the last look: it splits at its next idle */
  strayed: boolean;
}

interface DeviceAttachmentRecord {
  readonly member: SessionMember;
  readonly context: LiveSurfaceRuntimeAttachContext;
  /** this record's attachment on its session's inner */
  inner: LiveSurfaceRuntimeAttachment | null;
  /** the renderer's last accepted ask; null until it asks */
  ask: LiveSurfaceDemandV1 | null;
  /** main's own revisions into the inner (its tracker refuses one that does not grow) */
  forwardRevision: number;
  forwardedShape: string;
  /** `retry`: the next forward goes even when its shape is the last one's (a fresh live demand restarts a failed inner) */
  forceForward: boolean;
  lastPublished: string;
  active: boolean;
}

function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function demandShape(demand: LiveSurfaceDemandV1): string {
  return JSON.stringify({
    mode: demand.mode,
    targetFps: demand.targetFps,
    targetRasterSize: demand.targetRasterSize,
    logicalViewport: demand.logicalViewport,
    priority: demand.priority,
    interactive: demand.interactive,
  });
}

/** What the inner is told while the device is not streaming: nothing to capture. */
function withheld(ask: LiveSurfaceDemandV1): LiveSurfaceDemandV1 {
  return {
    revision: ask.revision,
    mode: "hibernated",
    targetFps: 0,
    priority: ask.priority,
    interactive: false,
  };
}

function sameUdid(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left.toUpperCase() === right.toUpperCase();
}

/** One binding, by what `pickDevice` reads of it. */
function sameBinding(
  left: LiveSurfaceIosSimulatorBindingV1,
  right: LiveSurfaceIosSimulatorBindingV1,
): boolean {
  return left.deviceType === right.deviceType && left.runtime === right.runtime;
}

/** Two picks land in one place: the same device — or, with none, the same one "Create it" would make. */
function samePlace(left: SimctlDevicePick, right: SimctlDevicePick): boolean {
  if (left.device !== undefined || right.device !== undefined) {
    return sameUdid(left.device?.udid, right.device?.udid);
  }
  return (
    left.create?.deviceType === right.create?.deviceType &&
    left.create?.runtime === right.create?.runtime
  );
}

/** The inner's frames, as this surface's: the surface id rewritten, every release delegated. */
function asSurface(
  frame: LiveSurfaceProducerTextureFrame,
  surfaceId: string,
): LiveSurfaceProducerTextureFrame {
  if (frame.metadata.surfaceId === surfaceId) return frame;
  return {
    metadata: { ...frame.metadata, surfaceId },
    textureInfo: frame.textureInfo,
    releaseSource: (reason) => frame.releaseSource(reason),
    allReferencesReleased: (reason) => frame.allReferencesReleased(reason),
  };
}

class DeviceSession {
  readonly cropKey: string;
  readonly members = new Set<SessionMember>();
  readonly records = new Set<DeviceAttachmentRecord>();
  readonly #pool: SessionPool;
  readonly #options: SimulatorDeviceSessionsOptions;
  /** what every look picks by: a member's own binding — the opener's, re-keyed when its holder leaves (`rekey`) */
  #binding: LiveSurfaceIosSimulatorBindingV1;
  readonly #crop: LiveSurfaceCropV1;
  readonly #now: () => number;
  readonly #inner: IosSimulatorLiveSurfaceRuntime;
  #pick: SimctlDevicePick | null = null;
  #unavailable = false;
  #verdict: WindowVerdict = "unknown";
  #degraded = false;
  /** the inner went live on the picked device — its window going then is `stopped`, not `no-window` */
  #streamed = false;
  /** the inner failed with the window found, at a look: `stopped` until a retry (or a device change) */
  #stalled = false;
  #acting: LiveSurfaceDeviceVerbV1 | null = null;
  /** bumped as each act that changed CoreSimulator settles: a look's list begun before then may predate the change */
  #settled = 0;
  #graceUntil = 0;
  #condition: LiveSurfaceSimulatorConditionV1 | undefined;
  #facts: LiveSurfaceSimulatorStateV1 | undefined;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #timerMs = 0;
  #looking = false;
  #lookAgain = false;
  #disposed = false;

  /** R7: the inner's resolver — the CURRENT pick's UDID, re-resolved at every start and revalidation. */
  readonly #resolver: IosSimulatorResolutionProvider = {
    resolve: async () => {
      const udid = this.#pick?.device?.udid;
      if (udid === undefined || this.#disposed) {
        throw new SckCaptureClientError(
          {
            code: "source-not-found",
            message: "The bound Simulator device is not attached",
            recovery: "automatic",
          },
          "not-booted",
        );
      }
      const capture = this.captureOrNull();
      if (capture === null) {
        throw new SckCaptureClientError({
          code: "unsupported",
          message: "Simulator capture is unavailable in this shell",
          recovery: "permanent",
        });
      }
      try {
        const resolved = await capture.resolver.resolve({
          kind: "ios-simulator",
          udid,
          crop: this.#crop,
        });
        this.noteResolved(udid, resolved);
        return resolved;
      } catch (error) {
        this.noteRefused(udid, error);
        throw error;
      }
    },
  };

  /** The helper's client, read lazily; a start it refuses for want of Screen Recording is the face's `no-permission`. */
  readonly #client: SckCaptureClient = {
    startSession: async (request) => {
      const capture = this.captureOrNull();
      if (capture === null) {
        throw new SckCaptureClientError({
          code: "unsupported",
          message: "Simulator capture is unavailable in this shell",
          recovery: "permanent",
        });
      }
      const udid = this.#pick?.device?.udid;
      try {
        return await capture.client.startSession(request);
      } catch (error) {
        if (
          udid !== undefined &&
          error instanceof SckCaptureClientError &&
          error.surfaceError.code === "permission-denied"
        ) {
          this.noteRefused(udid, error);
        }
        throw error;
      }
    },
  };

  constructor(
    pool: SessionPool,
    options: SimulatorDeviceSessionsOptions,
    surfaceId: string,
    source: SimulatorDeviceSource,
  ) {
    this.#pool = pool;
    this.#options = options;
    this.#binding = source.binding;
    this.#crop = source.crop;
    this.cropKey = JSON.stringify(source.crop);
    this.#now = options.now ?? Date.now;
    this.#inner = new IosSimulatorLiveSurfaceRuntime({
      surfaceId,
      source: { kind: "ios-simulator", udid: PLACEHOLDER_UDID, crop: source.crop },
      resolver: this.#resolver,
      delegate: this.#client,
      ...(options.revalidateIntervalMs === undefined
        ? {}
        : { revalidateIntervalMs: options.revalidateIntervalMs }),
      ...(options.startupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: options.startupTimeoutMs }),
      ...(options.restartLimit === undefined ? {} : { restartLimit: options.restartLimit }),
      ...(options.monotonicNowUs === undefined ? {} : { monotonicNowUs: options.monotonicNowUs }),
    });
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** The device this session streams, upper-cased — an R3 join's key. */
  get attachedUdid(): string | undefined {
    return this.#pick?.device?.udid.toUpperCase();
  }

  summaryFor(surfaceId: string): LiveSurfaceRuntimeSummaryV1 {
    return {
      ...this.#inner.summary,
      surfaceId,
      ...(this.#facts === undefined ? {} : { simulator: this.#facts }),
    };
  }

  supportSnapshot(surfaceId: string): LiveSurfaceRuntimeSupportSnapshot {
    const inner = this.#inner.supportSnapshot();
    return createLiveSurfaceRuntimeSupportSnapshot({
      sourceKind: "ios-simulator-device",
      summary: this.summaryFor(surfaceId),
      effectiveDemand: inner.effectiveDemand,
      metrics: inner.metrics,
    });
  }

  attach(
    member: SessionMember,
    context: LiveSurfaceRuntimeAttachContext,
  ): LiveSurfaceRuntimeAttachment {
    if (this.#disposed) throw new Error("cannot attach a closed bound Simulator surface");
    if (!context.operations.includes("view")) {
      throw new Error("bound Simulator attachment lacks view grant");
    }
    const record: DeviceAttachmentRecord = {
      member,
      context,
      inner: null,
      ask: null,
      forwardRevision: 0,
      forwardedShape: "",
      forceForward: false,
      lastPublished: "",
      active: true,
    };
    record.inner = this.#inner.attach(this.innerContext(record));
    record.lastPublished = JSON.stringify(this.summaryFor(member.surfaceId));
    this.records.add(record);
    // the watch runs while a face is attached; the first one looks at once
    if (this.records.size === 1) void this.look();
    return {
      get summary() {
        return record.member.session.summaryFor(record.member.surfaceId);
      },
      setDemand(demand) {
        if (!record.active) return;
        record.ask = demand;
        record.member.session.asked(record);
      },
      device(command: LiveSurfaceDeviceCommandV1) {
        if (!record.active) return;
        record.member.session.act(command.verb);
      },
      dispose() {
        if (!record.active) return;
        record.active = false;
        record.member.session.release(record);
      },
    };
  }

  /** R3: take a pristine session's surfaces and faces — each face re-attached here, its ask forwarded afresh. */
  adopt(members: Iterable<SessionMember>, records: Iterable<DeviceAttachmentRecord>): void {
    // members first: a summary the joiner's inner still publishes while its faces leave it is then nobody's
    for (const member of members) {
      member.session = this;
      this.members.add(member);
    }
    for (const record of records) {
      record.inner?.dispose();
      record.inner = null;
      record.forwardedShape = "";
      if (!record.active) continue;
      record.inner = this.#inner.attach(this.innerContext(record));
      this.records.add(record);
    }
    this.refresh();
  }

  leave(member: SessionMember): void {
    this.members.delete(member);
    for (const record of [...this.records]) {
      if (record.member !== member) continue;
      record.active = false;
      this.release(record);
    }
    if (this.members.size === 0) this.dispose();
    else this.rekey();
  }

  /** R3: the binding the session picks by is one a member holds. When its holder has left, a remaining member's is
   * taken — one that agreed with the session at the last look first, so the pick moves as little as it can. Only the
   * binding moves here: no member changes session and no face changes inner, so the next look moves the device under
   * the SAME inner by the resolver (R7), and no summary moves backwards. Every `strayed` was measured against the old
   * binding's pick: cleared, and re-swept by that look — at once while a face is attached, else at the next face's
   * attach (a face-less session never looks). At once even mid-act: the act runs on the device it began with (`run`
   * reads the pick once), nothing is offered nor joined while `acting`, and `settle` then picks by a binding a member
   * holds. */
  private rekey(): void {
    if (this.#disposed) return;
    let heir: SessionMember | undefined;
    for (const member of this.members) {
      if (sameBinding(member.source.binding, this.#binding)) return;
      if (heir === undefined || (heir.strayed && !member.strayed)) heir = member;
    }
    if (heir === undefined) return;
    this.#binding = heir.source.binding;
    for (const member of this.members) member.strayed = false;
    if (this.records.size > 0) void this.look();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clearTimer();
    for (const record of this.records) {
      record.active = false;
      record.inner?.dispose();
      record.inner = null;
    }
    this.records.clear();
    this.members.clear();
    this.#pool.forget(this);
    // an act in flight is allowed to finish (a spawned boot is CoreSimulator's); nothing is shut down
    this.#inner.dispose();
  }

  private innerContext(record: DeviceAttachmentRecord): LiveSurfaceRuntimeAttachContext {
    return {
      attachmentId: this.#pool.nextAttachmentId(),
      rendererGeneration: record.context.rendererGeneration,
      operations: record.context.operations,
      publishSummary: () => {
        // the inner's summary rides with this session's facts, under the face's own surface id
        if (!record.active || record.member.session !== this) return;
        this.innerChanged();
      },
      publishCpuFrame: (frame) =>
        record.context.publishCpuFrame({
          metadata: { ...frame.metadata, surfaceId: record.member.surfaceId },
          pixels: frame.pixels,
        }),
      offerTextureFrame: (frame) =>
        record.context.offerTextureFrame(asSurface(frame, record.member.surfaceId)),
    };
  }

  private asked(record: DeviceAttachmentRecord): void {
    this.gate(record);
    // a live ask that main withholds for want of a window or permission is probed now, not at the next tick
    if (record.ask?.mode === "live" && this.#condition !== "streaming") void this.look();
  }

  private release(record: DeviceAttachmentRecord): void {
    this.records.delete(record);
    record.inner?.dispose();
    record.inner = null;
    if (this.records.size === 0) this.clearTimer();
    // a strayed surface's last face gone: it leaves for its own binding's session now (R3)
    if (this.members.has(record.member)) this.splitIfIdle(record.member);
  }

  // --- the acts (R4) -------------------------------------------------------------------------------------------------

  private act(verb: LiveSurfaceDeviceVerbV1): void {
    if (this.#disposed || this.#acting !== null || !this.offers(verb)) return;
    this.#acting = verb;
    this.refresh();
    void this.run(verb)
      .catch(() => {
        this.#options.logger?.warn(
          "desktop.live_surfaces.simulator_act_failed",
          "a bound Simulator act failed",
          { verb },
        );
      })
      .then(() => this.settle(verb))
      .finally(() => {
        this.#acting = null;
        if (this.#disposed) return;
        this.refresh();
        void this.look();
      });
  }

  /** Still INSIDE the act (`acting` said, nothing else offered): after an act that changed CoreSimulator — failed or not —
   * its devices are read afresh before the flight ends, so the face it leaves never offers what it already did (a second
   * "Create it" from the pick before the create would make a twin of the phone just made, its name unique only against
   * the old list; a Boot would flash back). A look whose list was begun before this read is not kept (`#settled`). */
  private async settle(verb: LiveSurfaceDeviceVerbV1): Promise<void> {
    if (this.#disposed || (verb !== "boot" && verb !== "create" && verb !== "show")) return;
    const simctl = this.#options.simctl;
    simctl.invalidate();
    try {
      const snapshot = await simctl.list();
      if (this.#disposed) return;
      this.#unavailable = false;
      // (`acting` is still set: a pick here never joins another session)
      this.setPick(pickDevice(snapshot, this.#binding));
    } catch (error) {
      if (error instanceof SimctlUnavailableError) this.#unavailable = true;
    } finally {
      this.#settled += 1;
    }
  }

  /** The acts each condition offers; any other is the face racing the summary — nothing. */
  private offers(verb: LiveSurfaceDeviceVerbV1): boolean {
    const booted = this.#pick?.device?.state === "Booted" && !this.#unavailable;
    switch (verb) {
      case "boot":
        return this.#condition === "off";
      case "create":
        return this.#condition === "no-device" && this.#pick?.create !== undefined;
      case "show":
      case "retry":
        return booted;
      case "open-settings":
        return this.#condition === "no-permission";
    }
  }

  private async run(verb: LiveSurfaceDeviceVerbV1): Promise<void> {
    const simctl = this.#options.simctl;
    const device = this.#pick?.device;
    switch (verb) {
      case "boot": {
        if (device === undefined) return;
        await simctl.boot(device.udid);
        this.#graceUntil = this.#now() + (this.#options.bootGraceMs ?? BOOT_GRACE_MS);
        await simctl.show(device.udid);
        return;
      }
      case "create": {
        // ONE act: two clicks to see a phone just asked for is friction
        const plan = this.#pick?.create;
        if (plan === undefined) return;
        const udid = await simctl.create(plan.name, plan.deviceType, plan.runtime);
        await simctl.boot(udid);
        this.#graceUntil = this.#now() + (this.#options.bootGraceMs ?? BOOT_GRACE_MS);
        await simctl.show(udid);
        return;
      }
      case "show": {
        if (device === undefined) return;
        await simctl.show(device.udid);
        this.#graceUntil = this.#now() + (this.#options.showGraceMs ?? SHOW_GRACE_MS);
        return;
      }
      case "retry": {
        // the window shown first when it has none, then a FRESH live demand: the inner restarts from failed on it
        if (device !== undefined && this.#verdict === "none") {
          await simctl.show(device.udid);
          this.#graceUntil = this.#now() + (this.#options.showGraceMs ?? SHOW_GRACE_MS);
        }
        this.#stalled = false;
        this.#verdict = "unknown";
        for (const record of this.records) record.forceForward = true;
        return;
      }
      case "open-settings":
        await this.#options.openSettings();
        return;
    }
  }

  // --- the watch -------------------------------------------------------------------------------------------------------

  private async look(): Promise<void> {
    if (this.#disposed) return;
    if (this.#looking) {
      this.#lookAgain = true;
      return;
    }
    this.#looking = true;
    try {
      do {
        this.#lookAgain = false;
        await this.lookOnce();
      } while (this.#lookAgain && !this.#disposed);
    } catch {
      this.#options.logger?.warn(
        "desktop.live_surfaces.simulator_look_failed",
        "a bound Simulator could not be looked at",
      );
    } finally {
      this.#looking = false;
    }
    this.refresh();
  }

  private async lookOnce(): Promise<void> {
    const capture = this.captureOrNull();
    if (capture === null) return;
    const settled = this.#settled;
    let snapshot: SimctlSnapshot;
    try {
      snapshot = await this.#options.simctl.list();
    } catch (error) {
      // no Simulator here (R5); any other failed list says nothing new — the last facts stand
      if (error instanceof SimctlUnavailableError) this.#unavailable = true;
      return;
    }
    if (this.#disposed) return;
    if (settled !== this.#settled) {
      // an act settled while this list was out: it may predate what the act changed — read again
      this.#lookAgain = true;
      return;
    }
    this.#unavailable = false;
    if (this.setPick(pickDevice(snapshot, this.#binding))) return;
    if (this.sweepStrays(snapshot)) return;
    // a failure the window does not explain (the helper, the stream): the face's `stopped`, until a retry
    if (
      this.#inner.summary.state === "failed" &&
      (this.#verdict === "found" || this.#verdict === "unknown")
    ) {
      this.#stalled = true;
    }
    if (this.shouldProbe()) await this.probe(capture);
  }

  /** true when this session joined another (R3) and is gone */
  private setPick(pick: SimctlDevicePick): boolean {
    const before = this.attachedUdid;
    this.#pick = pick;
    const after = this.attachedUdid;
    if (before === after) return false;
    // another device: nothing known of the last one's window says anything of this one's
    this.#verdict = "unknown";
    this.#degraded = false;
    this.#streamed = false;
    this.#stalled = false;
    return after !== undefined && this.joinIfShared(after);
  }

  /** R3 while the bindings agree: each member's OWN binding picks afresh; one that lands elsewhere than this session has
   * strayed, and splits at once when no face of it is attached (else at its last face's detach: `release`). True when
   * every member left and this session is gone. */
  private sweepStrays(snapshot: SimctlSnapshot): boolean {
    const pick = this.#pick;
    if (pick === null) return false;
    for (const member of [...this.members]) {
      member.strayed = !samePlace(pickDevice(snapshot, member.source.binding), pick);
      this.splitIfIdle(member);
    }
    return this.#disposed;
  }

  /** A strayed member with no face attached here leaves for a session of its own binding (the pool's). */
  private splitIfIdle(member: SessionMember): void {
    if (this.#disposed || !member.strayed || member.session !== this) return;
    for (const record of this.records) if (record.member === member) return;
    this.members.delete(member);
    this.#pool.split(member);
    if (this.members.size === 0) this.dispose();
  }

  private joinIfShared(udid: string): boolean {
    if (this.#acting !== null || this.#inner.summary.stateRevision !== 0) return false;
    const host = this.#pool.hostFor(this, udid);
    if (host === undefined) return false;
    const members = [...this.members];
    const records = [...this.records];
    this.members.clear();
    this.records.clear();
    host.adopt(members, records);
    this.dispose();
    return true;
  }

  /** Under a live ask, a device withheld for want of a window or permission is probed for it — the helper's window
   * list runs ONLY under a live ask; at rest only simctl does. */
  private shouldProbe(): boolean {
    return (
      this.#acting === null &&
      this.#pick?.device?.state === "Booted" &&
      (this.#verdict === "none" || this.#verdict === "ambiguous" || this.#verdict === "denied") &&
      this.hasLiveAsk()
    );
  }

  private async probe(capture: SimulatorDeviceCapture): Promise<void> {
    const udid = this.#pick?.device?.udid;
    if (udid === undefined) return;
    try {
      const resolved = await capture.resolver.resolve({
        kind: "ios-simulator",
        udid,
        crop: this.#crop,
      });
      this.noteResolved(udid, resolved);
    } catch (error) {
      this.noteRefused(udid, error);
    }
  }

  private noteResolved(udid: string, resolved: ResolvedIosSimulatorCapture): void {
    if (this.#disposed || !sameUdid(udid, this.attachedUdid)) return;
    const degraded = resolved.geometry.cropState === "degraded";
    if (this.#verdict === "found" && this.#degraded === degraded) return;
    if (this.#verdict !== "found") this.#stalled = false;
    this.#verdict = "found";
    this.#degraded = degraded;
    this.refresh();
  }

  /** A refusal's TYPED reason, never its message (`SckCaptureClientError.reason`). */
  private noteRefused(udid: string, error: unknown): void {
    if (this.#disposed || !sameUdid(udid, this.attachedUdid)) return;
    if (!(error instanceof SckCaptureClientError)) return;
    let verdict: WindowVerdict | null = null;
    if (error.surfaceError.code === "permission-denied") verdict = "denied";
    else if (error.reason === "no-window") verdict = "none";
    else if (error.reason === "ambiguous") verdict = "ambiguous";
    else if (error.reason === "not-booted") {
      // the resolver's device list and this session's disagree: read CoreSimulator afresh
      this.#options.simctl.invalidate();
      void this.look();
    }
    // `stale` and `viewport` are the inner's own rebind; a crash says nothing of the window
    if (verdict === null || verdict === this.#verdict) return;
    this.#verdict = verdict;
    this.#degraded = false;
    this.#stalled = false;
    this.refresh();
  }

  private captureOrNull(): SimulatorDeviceCapture | null {
    try {
      return this.#options.capture();
    } catch {
      this.#unavailable = true;
      return null;
    }
  }

  private hasLiveAsk(): boolean {
    for (const record of this.records) {
      if (record.active && record.ask?.mode === "live") return true;
    }
    return false;
  }

  // --- the facts, the gate, the cadence ----------------------------------------------------------------------------------

  /** R2 — main's FACTS, top-down (the renderer says each in the SDK's words). Absent until the first look. */
  private derive(): LiveSurfaceSimulatorConditionV1 | undefined {
    if (this.#unavailable) return "no-simulator";
    if (this.#acting === "create") return "booting";
    const pick = this.#pick;
    if (pick === null) return undefined;
    const device = pick.device;
    if (device === undefined) return "no-device";
    if (this.#acting === "boot") return "booting";
    if (device.state === "Booting" || device.state === "Creating") return "booting";
    if (device.state !== "Booted") return "off";
    switch (this.#verdict) {
      case "denied":
        return "no-permission";
      case "ambiguous":
        return "no-window";
      case "none":
        if (this.#now() < this.#graceUntil) return "booting";
        return this.#streamed ? "stopped" : "no-window";
      default:
        // found, or not yet asked (nothing asked live yet: the inner resolves the window when a face asks)
        return this.#stalled ? "stopped" : "streaming";
    }
  }

  private facts(
    condition: LiveSurfaceSimulatorConditionV1 | undefined,
  ): LiveSurfaceSimulatorStateV1 | undefined {
    if (condition === undefined) return undefined;
    const device = condition === "no-simulator" ? undefined : this.#pick?.device;
    const name = device?.name ?? (condition === "no-simulator" ? undefined : this.#pick?.typeName);
    return LiveSurfaceSimulatorStateV1.parse({
      condition,
      ...(name !== undefined && LiveSurfaceSimulatorStateV1.shape.name.safeParse(name).success
        ? { name }
        : {}),
      ...(device === undefined ? {} : { deviceType: device.deviceType, runtime: device.runtime }),
      ...(this.#acting === null ? {} : { acting: this.#acting }),
      ...(condition === "streaming" && this.#degraded ? { degraded: true } : {}),
    });
  }

  /** Re-derive, tell every face, and open or close the gate. Never inside the inner's own publish loop. */
  private refresh(): void {
    if (this.#disposed) return;
    this.#condition = this.derive();
    this.#facts = this.facts(this.#condition);
    for (const record of [...this.records]) {
      this.publish(record);
      this.gate(record);
    }
    this.schedule();
  }

  /** The inner published (inside its own loop over its attachments): every face gets the inner's summary with this
   * session's facts — no demand moves here (a forward would re-enter the inner mid-loop); a condition that moved is
   * re-gated after it. */
  private innerChanged(): void {
    const state = this.#inner.summary.state;
    if (state === "live") this.#streamed = true;
    if (state !== "failed") this.#stalled = false;
    const condition = this.derive();
    const moved = condition !== this.#condition;
    this.#condition = condition;
    this.#facts = this.facts(condition);
    for (const record of [...this.records]) this.publish(record);
    if (moved) queueMicrotask(() => this.refresh());
  }

  private publish(record: DeviceAttachmentRecord): void {
    if (!record.active) return;
    const summary = this.summaryFor(record.member.surfaceId);
    const key = JSON.stringify(summary);
    if (key === record.lastPublished) return;
    record.lastPublished = key;
    record.context.publishSummary(summary);
  }

  /** Demand reaches the inner only while `streaming`; else main's own hibernated demand. Forwarded on change, with
   * main's own monotonic revision. */
  private gate(record: DeviceAttachmentRecord): void {
    const ask = record.ask;
    const inner = record.inner;
    if (!record.active || ask === null || inner === null) return;
    const demand = this.#condition === "streaming" ? ask : withheld(ask);
    const shape = demandShape(demand);
    if (shape === record.forwardedShape && !record.forceForward) return;
    record.forceForward = false;
    record.forwardedShape = shape;
    record.forwardRevision += 1;
    inner.setDemand({ ...demand, revision: record.forwardRevision });
  }

  private schedule(): void {
    if (this.#disposed || this.records.size === 0) {
      this.clearTimer();
      return;
    }
    const ms =
      this.#acting !== null || this.#condition !== "streaming"
        ? (this.#options.watchUnreadyMs ?? WATCH_UNREADY_MS)
        : (this.#options.watchRestMs ?? WATCH_REST_MS);
    if (this.#timer !== null && this.#timerMs === ms) return;
    this.clearTimer();
    this.#timerMs = ms;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.look();
    }, ms);
    this.#timer.unref?.();
  }

  private clearTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

/** One phone's surface: a member of the session serving its device. */
class BoundSimulatorSurface implements IosSimulatorDeviceLiveSurfaceRuntime {
  readonly surfaceId: string;
  readonly source: SimulatorDeviceSource;
  readonly #member: SessionMember;
  #disposed = false;

  constructor(surfaceId: string, source: SimulatorDeviceSource, member: SessionMember) {
    this.surfaceId = surfaceId;
    this.source = source;
    this.#member = member;
  }

  get summary(): LiveSurfaceRuntimeSummaryV1 {
    return this.#member.session.summaryFor(this.surfaceId);
  }

  supportSnapshot(): LiveSurfaceRuntimeSupportSnapshot {
    return this.#member.session.supportSnapshot(this.surfaceId);
  }

  attach(context: LiveSurfaceRuntimeAttachContext): LiveSurfaceRuntimeAttachment {
    if (this.#disposed) throw new Error("cannot attach a closed bound Simulator surface");
    return this.#member.session.attach(this.#member, context);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#member.session.leave(this.#member);
  }
}

/**
 * PT-S2 — main's bound simulators: one per authority, every phone's session in it, so a pristine session can find the
 * one already streaming the device it picked (R3). `open` is the authority's factory.
 */
export class SimulatorDeviceSessions {
  readonly #options: SimulatorDeviceSessionsOptions;
  readonly #sessions = new Set<DeviceSession>();
  #attachments = 0;
  #disposed = false;
  readonly #pool: SessionPool = {
    hostFor: (joiner, udid) => {
      for (const session of this.#sessions) {
        if (
          session !== joiner &&
          !session.disposed &&
          session.cropKey === joiner.cropKey &&
          sameUdid(session.attachedUdid, udid)
        ) {
          return session;
        }
      }
      return undefined;
    },
    split: (member) => {
      // its own binding's session — pristine, so its first look may join the one streaming what it picks (R3)
      const session = new DeviceSession(this.#pool, this.#options, member.surfaceId, member.source);
      this.#sessions.add(session);
      member.session = session;
      member.strayed = false;
      session.members.add(member);
    },
    forget: (session) => {
      this.#sessions.delete(session);
    },
    nextAttachmentId: () => {
      this.#attachments += 1;
      return `simdev_attachment_${this.#attachments}`;
    },
  };

  constructor(options: SimulatorDeviceSessionsOptions) {
    for (const [name, value] of [
      ["watchUnreadyMs", options.watchUnreadyMs],
      ["watchRestMs", options.watchRestMs],
      ["bootGraceMs", options.bootGraceMs],
      ["showGraceMs", options.showGraceMs],
    ] as const) {
      if (value !== undefined) positive(value, `bound Simulator ${name}`);
    }
    this.#options = options;
  }

  /** the sessions alive — one a device being streamed, after R3's joins */
  get size(): number {
    return this.#sessions.size;
  }

  open(surfaceId: string, rawSource: SimulatorDeviceSource): IosSimulatorDeviceLiveSurfaceRuntime {
    if (this.#disposed) throw new Error("bound Simulator sessions are closed");
    const id = LiveSurfaceIdV1.parse(surfaceId);
    const source = LiveSurfaceIosSimulatorDeviceSourceV1.parse(rawSource);
    const session = new DeviceSession(this.#pool, this.#options, id, source);
    this.#sessions.add(session);
    const member: SessionMember = { surfaceId: id, source, session, strayed: false };
    session.members.add(member);
    return new BoundSimulatorSurface(id, source, member);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const session of [...this.#sessions]) session.dispose();
  }
}
