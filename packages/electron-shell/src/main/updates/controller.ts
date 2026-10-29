// WP12b (EDP §11.1–§11.3, §11.6; build-wp12-updater.md §4) — the UpdateController: one owner of the update state in
// Electron main. It runs only in a packaged app (the wiring decides), keeps ONE check or download in flight, maps every
// failure to a bounded code (no remote text in privileged UI), persists the person's choices and TD-10's remembered
// versions, and appends refusals and declines to the audit ledger (TD §4).
//
// electron-updater's `autoInstallOnAppQuit` defaults to true, which would install a staged update on any quit, past
// EDP-35's census gate; it is forced off here. WP12c (L2b-ii) wires the apply — `restartToInstall()` over an
// `ApplyPort` (`apply.ts`), macOS only — and where no port is wired a staged update stays HELD (`apply-unbuilt`).
// WP12d (L3b-i, `build-wp12-updater.md` §12; the PM's ruling 2026-10-15 16:03Z): the policy's levers bite through
// `decideUpdate` (B1); the apply re-reads a FRESH verified policy at the click and holds `policy-unreachable` when it
// cannot (B2, no offline allowance); and a release whose signed manifest leaves the native plane's bytes alone keeps
// the floor and its sessions — no census gate, no consent box, `native: false` (B3).
// L3b-ii (B4–B6): a staged update applies ON ITS OWN when EDP-34's safe window holds (`considerSilentApply`: on staged,
// on the last window's close, on resume, and on a 30-minute timer that lives only while staged); the root keys anchor
// on the adopted rotation chain, persisted as signed documents and re-verified from the embedded keys at every load;
// and a staged payload the person or the policy turns away is deleted from electron-updater's cache.

import { randomUUID } from "node:crypto";
import {
  compareReleaseVersions,
  UPDATE_CHANNELS,
  UPDATE_PLANES,
  UPDATES_AUDIT_ACTIONS,
  UPDATES_SERVICE,
  type UpdateApplyTrigger,
  type UpdateChannel,
  type UpdateCheckResult,
  type UpdateDownloadResult,
  type UpdatePlane,
  type UpdatePolicy,
  type UpdatesUnavailableState,
  type UpdateView,
  type UpdateViewLastApply,
} from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import type { UpdatePrepared, UpdateQuitPlan } from "../quit-flow";
import {
  type ApplyPort,
  type BoxContent,
  type CensusSession,
  type CensusSnapshot,
  type ConsentWords,
  censusNotice,
  consentBox,
  consentWords,
  downloadNotice,
  expiredNotice,
  type LeverWhy,
  policyNotice,
  quitNotice,
  SQUIRREL_STAGE_MS,
} from "./apply";
import {
  type CensusCount,
  decideUpdate,
  type LeverRefusal,
  leverRefusal,
  type PolicyLevers,
  type UpdateAction,
  type UpdateTrigger,
} from "./decide";
import { type NativePlane, type NativeVerdict, nativeVerdict } from "./native-plane";
import { UpdateRefusal } from "./refusal";
import { anchorFrom, MAX_ADOPTED_ROOTS, type RootAnchor, rotates } from "./root-chain";
import { type SafeWindowContext, safeWindow, safeWindowLine } from "./safe-window";
import type { UpdateClientState, UpdateStateStore } from "./state-store";
import {
  type ChainResult,
  type FetchBytes,
  type RememberedVersions,
  type VerifiedChain,
  verifyUpdateChain,
} from "./verify-chain";

export type UpdateErrorCode = "refused" | "offline" | "checksum-mismatch" | "failed";

export type UpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking"; readonly reason: "launch" | "manual" | "resume" }
  | { readonly kind: "not-available" }
  | { readonly kind: "available"; readonly version: string }
  | { readonly kind: "downloading"; readonly version: string; readonly percent: number }
  | {
      readonly kind: "staged";
      readonly version: string;
      readonly stagedAt: number;
      readonly blockedBy?:
        | "sessions"
        | "census-unknown"
        | "apply-unbuilt"
        | "policy-unreachable"
        | "policy-unverified";
      /** WP12c — the live sessions the last census read (the tray's verb says them); absent where unwired */
      readonly sessions?: number | "unknown";
      /** L3b-i (B3) — the release leaves the native plane's bytes alone: the floor and its sessions live on */
      readonly keepsSessions?: true;
    }
  | {
      readonly kind: "error";
      readonly code: UpdateErrorCode;
      readonly unavailable?: {
        readonly service: "updates";
        readonly state: UpdatesUnavailableState;
      };
    };

/** The slice of electron-updater's AppUpdater the controller drives (a fake in tests). */
export interface UpdaterPort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  setFeedURL(options: unknown): void;
  checkForUpdates(): Promise<{
    readonly isUpdateAvailable?: boolean;
    readonly updateInfo?: { readonly version: string };
  } | null>;
  downloadUpdate(cancellationToken?: unknown): Promise<unknown>;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
}

export interface CancellationLike {
  cancel(): void;
}

export interface UpdateControllerOptions {
  readonly updater: UpdaterPort;
  /** `setFeedURL`'s options for VibeField's provider, given the context it calls back into (the wiring builds them,
   * so this module never imports electron-updater). */
  readonly feedOptions: (context: {
    verify(fetch: FetchBytes): Promise<ChainResult>;
    verified(result: VerifiedChain): void;
  }) => unknown;
  readonly newCancellationToken: () => CancellationLike;
  readonly origin: string;
  readonly rootKeys: readonly string[];
  /** The build-time floor (the staged identity's `updateFloors`): never accept below what this build shipped with. */
  readonly floors?: RememberedVersions;
  /** The build's channel (the staged identity's `updateChannel`); the person's setting overrides it. */
  readonly buildChannel: UpdateChannel;
  readonly feedFile: string;
  readonly store: UpdateStateStore;
  readonly appendAudit?: (record: AuditAppendV1) => Promise<void>;
  /** The shell's structured logger (`@vibefield/logging`): `(event, message, attrs)`. */
  readonly log: {
    info(event: string, message: string, attrs?: Readonly<Record<string, unknown>>): void;
    warn(event: string, message: string, attrs?: Readonly<Record<string, unknown>>): void;
  };
  readonly now?: () => number;
  /** EDP §11.2: a resume checks only when the last check is at least this old. Default 6 h. */
  readonly staleMs?: number;
  /** WP12c (L2b-ii) — the apply's world: the census, the consent box, the quit flow, the daemons' stop, Squirrel.
   * Absent (or `wired: false`), a staged update is HELD `apply-unbuilt` (§10 S5). */
  readonly apply?: ApplyPort;
  /** The running app's version: the outcome of a handed-off install is judged against it at the next launch. */
  readonly currentVersion?: string;
  /** WP12c (§10 S7) — EDP-34's context minus the census and the planes (the controller holds both: the planes are
   * B3's verdict); doctor names the failing clause */
  readonly safeWindowContext?: () => Omit<
    SafeWindowContext,
    "census" | "planes" | "displayHeldAwake"
  >;
  /** L3b-ii (B4) — the display clause's reader (`display-awake.ts`), read fresh by each silent evaluation; absent, the
   * clause is `unknown`, which is closed. */
  readonly displayHeldAwake?: () => Promise<boolean | "unknown">;
  /** L3b-ii (B6) — electron-updater's staged-update cache: emptied when the person or the policy turns a staged
   * payload away, or a check finds nothing (EDP-38), and measured for doctor. */
  readonly stagedCache?: StagedCachePort;
  /** L3b-i (B2) — the byte fetcher a FRESH policy check runs on at the click (main's `net.fetch`). Absent, every apply
   * holds `policy-unreachable`: no offline allowance (the PM's ruling 2026-10-15 16:03Z). */
  readonly fetch?: FetchBytes;
  /** L3b-i (B1) — the host OS's own version, for the policy's OS floor (null = unreadable, which reads as unmet). */
  readonly hostOsVersion?: () => string | null;
  /** L3b-i (B3) — the installed app's native plane (`hashNativePlane(process.resourcesPath)`) and this build's key in
   * the release manifest (`releasePlatformKey`). Either absent, every release counts as touching the floor. */
  readonly nativePlane?: () => Promise<NativePlane>;
  readonly platformKey?: string;
}

/** L3b-ii (B6) — the staged-update cache, as the controller drives it (`install.ts` builds it over electron-updater's
 * own directory). */
export interface StagedCachePort {
  /** empty the pending payload (never the copy of the previous update the differential download reads) */
  clear(): Promise<void>;
  /** the cache's size in bytes; null when unreadable */
  size(): Promise<number | null>;
}

/** What the silent evaluation (B4) concluded: underway, or why not (the safe window's clause, or the apply's refusal). */
export type SilentOutcome =
  | { readonly applying: true }
  | { readonly applying: false; readonly reason: string };

/** What `restartToInstall()` answered. `ok: true` = the update quit is underway (the flow owns the rest). */
export type RestartOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "not-staged"
        | "apply-unbuilt"
        | "declined"
        // the silent path only (`silentHeld`): the person's off switch, and the policy's `requireUserConfirmation`
        | "disabled"
        | "confirmation-required"
        | "census-unknown"
        | "consent-declined"
        | "quit-underway"
        | "policy-unreachable"
        | "policy-unverified"
        // the silent path (B4) never asks: a touched release with live sessions waits for a person
        | "sessions"
        // C2 (L3c-i): the prepared snapshot went stale before the answer — a fresh prepare, never a silent proceed
        | "expired"
        | LeverRefusal;
      /** L3c-ii — what the person reads, where the card needs main's sentence (an expired snapshot) */
      readonly words?: { readonly message: string; readonly detail: string };
    };

/** C2 (L3c-i) — the first phase's answer: the snapshot a consent shows and the token bound to its ids, or a refusal
 * with the words both the tray's box and the Settings card say. */
export type PrepareOutcome =
  | {
      readonly ok: true;
      readonly token: string;
      readonly version: string;
      readonly keepsSessions: boolean;
      readonly sessions: readonly CensusSession[];
      readonly expiresAt: number;
      /** L3c-ii — present only when the apply ends sessions: the consent's one set of words */
      readonly consent?: ConsentWords;
    }
  | {
      readonly ok: false;
      readonly reason: Exclude<RestartOutcome, { ok: true }>["reason"];
      readonly words?: { readonly message: string; readonly detail: string };
    };

/** C2 — how long a prepared snapshot stands: past it, the person's answer is to a list that may be stale. */
export const PREPARE_TTL_MS = 120_000;

const CHANNEL_RANK: Readonly<Record<UpdateChannel, number>> = { stable: 0, beta: 1, nightly: 2 };

/** How long the apply's ATTEMPT row may take to reach fieldd's audit before the apply goes on without it. */
const AUDIT_ATTEMPT_BOUND_MS = 2_000;
/** How long the click's fresh policy check may take before it counts as unreachable (B2). */
export const FRESH_POLICY_BOUND_MS = 20_000;
/** B4 — while staged, the silent apply is re-evaluated this often (a timer that lives ONLY while staged). */
export const SILENT_RECHECK_MS = 30 * 60_000;

const LEVER_CODE: Readonly<Record<LeverRefusal, string>> = {
  killed: "KILLED",
  yanked: "YANKED",
  "floor-unmet": "FLOOR_UNMET",
};

const isLever = (reason: string): reason is LeverRefusal => Object.hasOwn(LEVER_CODE, reason);

/** The verified policy, as the one decision reads it. */
export function leversOf(policy: UpdatePolicy): PolicyLevers {
  return {
    killSwitch: policy.killSwitch,
    yanked: policy.yanked,
    floors: policy.floors.os !== undefined ? { os: policy.floors.os } : {},
    requireUserConfirmation: policy.requireUserConfirmation,
  };
}

const SIX_HOURS = 6 * 60 * 60 * 1000;
const OFFLINE_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
]);

/** A raw failure as a bounded code (EDP §11.1: provider errors never leak remote content into privileged UI). */
export function updateErrorOf(error: unknown): UpdateState & { kind: "error" } {
  if (error instanceof UpdateRefusal) {
    return {
      kind: "error",
      code: "refused",
      unavailable: { service: UPDATES_SERVICE.SERVICE, state: error.state },
    };
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ERR_CHECKSUM_MISMATCH") return { kind: "error", code: "checksum-mismatch" };
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if ((typeof code === "string" && OFFLINE_CODES.has(code)) || /net::ERR_/.test(message)) {
    return { kind: "error", code: "offline" };
  }
  return { kind: "error", code: "failed" };
}

export class UpdateController {
  private stateValue: UpdateState = { kind: "idle" };
  private client: UpdateClientState;
  private readonly listeners = new Set<(state: UpdateState) => void>();
  private download: CancellationLike | null = null;
  private lastVerified: VerifiedChain | null = null;
  /** A client state that could not be read and was moved aside at construction (said loudly; WP12 §3). */
  private recovered: { readonly at: number; readonly movedAside: string } | null = null;
  private disposed = false;
  /** WP12c — the last census count (decide reads it synchronously); 0 until a wired port reads it */
  private censusCount: CensusCount = 0;
  /** WP12c — set once the daemons' consented stop succeeded: from then on nothing here may reach fieldd */
  private daemonsStopped = false;
  /** B3 — the staged release's verdict on the native plane (touched until a signed manifest says otherwise) */
  private native: NativeVerdict = { touched: true, why: "no-manifest" };
  /** the installed native plane, hashed once per process (the bundle does not change under a running app) */
  private localNative: Promise<NativePlane | null> | null = null;
  /** B5 — the root keys the next check trusts: the embedded set, or the newest adopted rotation */
  private anchor: RootAnchor;
  /** B4 — the timer that re-evaluates the silent apply; alive only while staged and no apply is underway */
  private silentTimer: ReturnType<typeof setInterval> | null = null;
  private silentInFlight = false;
  /** one apply flow at a time (the tray's click, the silent path and the card's prepare never run two) */
  private restarting = false;
  /** C2 — the snapshot the last prepare took, and the token bound to it (one use; `PREPARE_TTL_MS`) */
  private prepared: {
    readonly token: string;
    readonly version: string;
    readonly native: boolean;
    readonly sessions: readonly CensusSession[];
    readonly expiresAt: number;
  } | null = null;
  /** an apply's quit is underway (from `quitForUpdate` until an abort): nothing re-evaluates */
  private applying = false;
  /** AU-1 (AU-D11 A) — THIS launch judged the last apply (`landed`): a failed install is said once, by the launch
   * that found it */
  private judgedThisLaunch = false;
  /** bumped by every channel change: a check that began before it answers a channel the person has left */
  private channelEpoch = 0;
  /** B4 — the display clause's last reading (doctor's), and the last silent evaluation's answer */
  private display: boolean | "unknown" = "unknown";
  private silentNote: string | null = null;
  /** B6 — the staged cache's last measured size, and a collection in flight (a download waits for it) */
  private cacheBytes: number | null = null;
  private collecting: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly onProgress = (progress: { percent: number }): void => {
    if (this.stateValue.kind === "downloading") {
      this.setState({ ...this.stateValue, percent: Math.max(0, Math.min(100, progress.percent)) });
    }
  };
  // electron-updater also emits every failure as an `error` EVENT; the promises below carry them, and this listener
  // exists so an emitter with no `error` listener can never throw into the main process.
  private readonly onError = (error: unknown): void => {
    this.options.log.warn("desktop.update.updater_error", "The updater reported an error", {
      code: updateErrorOf(error).code,
    });
  };

  constructor(private readonly options: UpdateControllerOptions) {
    this.now = options.now ?? Date.now;
    const loaded = options.store.load();
    this.client = loaded.state;
    if (loaded.recovered !== null) {
      // loud, never silent: a warn line, an audit row and a doctor line — and the chain still judges every document
      // against the BUILD's floor, so the reset is to what this build shipped with, never to zero (§3)
      this.recovered = { at: this.now(), movedAside: loaded.recovered };
      options.log.warn(
        "desktop.update.state_recovered",
        "The update state was unreadable; it was moved aside and the updater restarts from the build's floor",
        { movedAside: loaded.recovered },
      );
      this.audit(UPDATES_AUDIT_ACTIONS.VERIFY, "failed", "STATE_UNREADABLE", {
        movedAside: loaded.recovered,
      });
    }
    // B5 — the adopted rotation chain, re-verified from the embedded keys; a link that does not verify is dropped
    // with everything after it, loudly (a same-uid writer cannot plant a root)
    const roots = anchorFrom(options.rootKeys, this.client.trustRoots);
    this.anchor = roots.anchor;
    if (roots.dropped > 0) {
      this.client = { ...this.client, trustRoots: roots.kept };
      try {
        options.store.save(this.client);
      } catch {
        // the next save writes the kept chain
      }
      options.log.warn(
        "desktop.update.root_chain_dropped",
        "Adopted trust-roots that no longer verify from the app's root keys were dropped",
        { dropped: roots.dropped, kept: roots.kept.length },
      );
      this.audit(UPDATES_AUDIT_ACTIONS.VERIFY, "failed", "ROOT_CHAIN_BROKEN", {
        dropped: String(roots.dropped),
      });
    }
    const updater = options.updater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false; // WP12c's gate owns the apply; nothing installs on a plain quit
    // EDP-36: only a channel below the running build's own may install an older version — set deliberately (C6)
    updater.allowDowngrade = CHANNEL_RANK[this.channel] < CHANNEL_RANK[options.buildChannel];
    // `allowPrerelease` is left as electron-updater sets it (on for a nightly or beta build, AppUpdater.js:218): the
    // custom provider never reads it — the signed channel heads decide the channel (D4).
    updater.setFeedURL(
      options.feedOptions({
        verify: (fetch) => this.verify(fetch),
        verified: (result) => {
          // a check that began on the channel the person has since left verified THAT channel: its levers never
          // judge this one's versions (B2, C6)
          if (result.policy.channel !== this.channel) return;
          this.lastVerified = result;
        },
      }),
    );
    updater.on("download-progress", this.onProgress);
    updater.on("error", this.onError);
    // AU-1 (AU-D11 A) — what the last apply landed as, judged ONCE by the first launch after it, by version for every
    // branch (an `exited` that Squirrel did arm comes back on the new version, which is installed). A record an older
    // app already delivered (`audited`, no `landed`) is history: never judged, never shown. The ledger's own judgement
    // below is unchanged.
    const last = this.client.lastApply;
    if (
      last !== null &&
      !last.audited &&
      last.landed === undefined &&
      options.currentVersion !== undefined
    ) {
      const outcome = options.currentVersion === last.version ? "installed" : "not-applied";
      // said as THIS launch's own only by the version the apply landed on or left: a third version (installed by hand
      // after an exit) stamps the judgement, so it is never judged again, and never says "didn't install" of it. A
      // record with no `from` is an older app's (a packaged app always knows its version), so this launch is a third
      // version of it too.
      this.judgedThisLaunch = outcome === "installed" || options.currentVersion === last.from;
      this.persist({ ...this.client, lastApply: { ...last, landed: { at: this.now(), outcome } } });
    }
    // AU-1 (AU-D3 A) — the staged version now runs: it installed, so nothing is staged any more
    const staged = this.client.staged;
    if (staged !== null && staged.version === options.currentVersion)
      this.persist({ ...this.client, staged: null });
    // WP12c — an apply that exited after the daemon stop recorded its outcome here; fieldd is alive again at this
    // launch, so its OUTCOME row reaches the ledger now, once.
    if (this.client.lastApply !== null && !this.client.lastApply.audited)
      void this.deliverLastApply();
  }

  get state(): UpdateState {
    return this.stateValue;
  }

  get lastCheckAt(): number | null {
    return this.client.lastCheckAt;
  }

  get channel(): UpdateChannel {
    return this.client.channel ?? this.options.buildChannel;
  }

  get enabled(): boolean {
    return this.client.enabled ?? true;
  }

  /** The last verified chain's policy and heads (WP12d's levers read them). */
  get verified(): VerifiedChain | null {
    return this.lastVerified;
  }

  subscribe(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  decide(trigger: UpdateTrigger): UpdateAction {
    return decideUpdate(this.stateValue, this.censusCount, {
      trigger,
      enabled: this.enabled,
      lastCheckAt: this.client.lastCheckAt,
      now: this.now(),
      staleMs: this.options.staleMs ?? SIX_HOURS,
      declined: this.client.declined,
      applyWired: this.options.apply?.wired === true,
      policy: this.lastVerified === null ? null : leversOf(this.lastVerified.policy),
      hostOs: this.options.hostOsVersion?.() ?? null,
      nativeTouched: this.native.touched,
    });
  }

  /** One check (launch · manual · resume), single-flight; a found update downloads unless declined or off. Settles
   * when the download does (the launch and resume paths, the tray and the app menu rely on that). */
  async check(reason: "launch" | "manual" | "resume"): Promise<UpdateAction> {
    const { action, download } = await this.checkOnce(reason);
    if (download !== null) await download;
    return action;
  }

  /** AU-1 (LC-5) — a person's check from a door: answered when the CHECK settles (the Me menu's in-place row, the
   * card's busy). A found update's download goes on, and the view says it. */
  async checkForPerson(): Promise<UpdateCheckResult> {
    const { result, download } = await this.checkOnce("manual");
    // the download's own failures become a state (`startDownload`); nothing here waits for it
    void download?.catch(() => undefined);
    return result;
  }

  /** The check alone: settles when the check does; a found update's download is started and handed back, never
   * awaited here. */
  private async checkOnce(reason: "launch" | "manual" | "resume"): Promise<{
    readonly action: UpdateAction;
    readonly result: UpdateCheckResult;
    readonly download: Promise<void> | null;
  }> {
    const action = this.decide(reason);
    // a check or a download in flight (the view says which); a disposed controller runs nothing either, and nothing
    // checks once an apply has begun (its payload is the one Squirrel stages)
    if (action.kind !== "check" || this.disposed || this.applying)
      return { action, result: { outcome: "busy" }, download: null };
    const before = this.stateValue;
    const epoch = this.channelEpoch;
    this.setState({ kind: "checking", reason });
    let found: string | null = null;
    try {
      const result = await this.options.updater.checkForUpdates();
      if (this.channelEpoch !== epoch) return this.checkOutlived(action);
      this.persist({ ...this.client, lastCheckAt: this.now() });
      found =
        result?.isUpdateAvailable === true && result.updateInfo ? result.updateInfo.version : null;
    } catch (error) {
      if (this.channelEpoch !== epoch) return this.checkOutlived(action);
      this.persist({ ...this.client, lastCheckAt: this.now() });
      this.fail(error);
      return { action, result: { outcome: "failed" }, download: null };
    }
    if (this.disposed || this.applying)
      return { action, result: { outcome: "busy" }, download: null };
    if (found === null) {
      this.setState({ kind: "not-available" });
      // EDP-38: nothing to offer, so nothing staged is kept
      void this.collectStagedCache("not-available");
      this.forgetStaged();
      return { action, result: { outcome: "up-to-date" }, download: null };
    }
    this.setState({ kind: "available", version: found });
    const next = this.decide("available");
    if (next.kind === "download") {
      return {
        action,
        result: { outcome: "found", version: next.version },
        download: this.startDownload(next.version),
      };
    }
    // AU-1 (G5, LC-12) — with automatic updates off, the version a person downloaded by hand stays staged: its payload
    // is in the cache, and the switch governs what downloads without them. Reaching `disabled` means no decline and no
    // lever refused it; `settleStaged` judges the levers again against the policy this check just verified.
    if (
      next.kind === "none" &&
      next.reason === "disabled" &&
      before.kind === "staged" &&
      before.version === found
    ) {
      this.setState(before);
      this.settleStaged();
      return { action, result: { outcome: "held", version: found }, download: null };
    }
    if (next.kind === "none" && isLever(next.reason))
      this.refuseByLever(found, next.reason, UPDATES_AUDIT_ACTIONS.VERIFY);
    return { action, result: { outcome: "held", version: found }, download: null };
  }

  /** A check the person's channel change outlived answered the channel they left: nothing it found is offered,
   * staged or judged (`setChannel` already dropped that channel's payload); the next check resolves the new one. */
  private checkOutlived(action: UpdateAction): {
    readonly action: UpdateAction;
    readonly result: UpdateCheckResult;
    readonly download: null;
  } {
    if (this.stateValue.kind === "checking") this.setState({ kind: "idle" });
    return { action, result: { outcome: "busy" }, download: null };
  }

  /** A person declines a version: it stays declined across restarts and a staged download (EDP §11.3). AU-1 (LC-13):
   * the found version stays in view, `available` and declined, so "Download anyway" is one click away. */
  decline(version: string): void {
    if (!this.client.declined.includes(version)) {
      this.persist({ ...this.client, declined: [...this.client.declined, version].slice(-64) });
    }
    this.audit(UPDATES_AUDIT_ACTIONS.DECLINE, "succeeded", undefined, { version });
    this.emit();
    // an apply already begun installs what the person consented to; the decline governs what comes after
    if (this.applying) return;
    const state = this.stateValue;
    if ("version" in state && state.version === version) {
      this.cancelDownload();
      this.setState({ kind: "available", version });
      // B6 — the declined payload goes (the timer died with the staged state: `setState`)
      void this.collectStagedCache("declined");
      this.forgetStaged();
    }
  }

  /** AU-1 (AU-G5, AU-G6) — a person downloads THIS found version: with automatic updates off, or a skip taken back
   * (the decline is removed, persisted and audited). Never a version a lever refuses; never while an apply runs. */
  async downloadForPerson(version: string): Promise<UpdateDownloadResult> {
    if (this.restarting || this.applying) return { ok: false, reason: "busy" };
    const state = this.stateValue;
    if ((state.kind === "downloading" || state.kind === "staged") && state.version === version)
      return { ok: true };
    if (state.kind !== "available" || state.version !== version)
      return { ok: false, reason: "not-available" };
    const policy = this.lastVerified === null ? null : leversOf(this.lastVerified.policy);
    const lever = leverRefusal(version, policy, this.options.hostOsVersion?.() ?? null);
    if (lever !== null) {
      this.refuseByLever(version, lever, UPDATES_AUDIT_ACTIONS.VERIFY);
      // nothing downloaded: the words say the download, never the install
      return {
        ok: false,
        reason: lever,
        words: wordsOf(downloadNotice(this.leverWhy(lever, version, policy?.floors.os))),
      };
    }
    const skipped = this.client.declined.includes(version);
    if (skipped) {
      this.persist({
        ...this.client,
        declined: this.client.declined.filter((declined) => declined !== version),
      });
    }
    this.audit(UPDATES_AUDIT_ACTIONS.DOWNLOAD, "succeeded", undefined, {
      version,
      why: skipped ? "skipped" : "updates-off",
    });
    // the view moves to `downloading`; the download's own failures become a state (`startDownload`)
    void this.startDownload(version).catch(() => undefined);
    return { ok: true };
  }

  /** The off switch: honored at every stage boundary — an in-flight download is cancelled now. AU-1 (X13): a found
   * update waits for you — off mid-download lands on `available`, and on again downloads a found, unskipped version. */
  setEnabled(enabled: boolean): void {
    this.persist({ ...this.client, enabled });
    this.emit();
    const state = this.stateValue;
    if (!enabled && state.kind === "downloading") {
      this.cancelDownload();
      this.setState({ kind: "available", version: state.version });
      return;
    }
    if (enabled && state.kind === "available") {
      const next = this.decide("available");
      if (next.kind === "download") void this.startDownload(next.version).catch(() => undefined);
    }
  }

  /** C6 (L3c-i; EDP-36) — the person's channel. A channel below the running build's is a DOWNGRADE, and only then is
   * electron-updater allowed one (`allowDowngrade`, set deliberately, never inherited). A download or a staged
   * payload from the old channel is dropped: the next check resolves the new channel's head. Audited. */
  setChannel(channel: UpdateChannel): void {
    const from = this.channel;
    if (channel === from) return;
    this.persist({ ...this.client, channel });
    this.options.updater.allowDowngrade = this.downgrades();
    this.audit(UPDATES_AUDIT_ACTIONS.CHANNEL, "succeeded", undefined, {
      from,
      to: channel,
      downgrade: String(this.downgrades()),
    });
    // a check in flight answers the channel just left: it is dropped when it settles (`checkOutlived`)
    this.channelEpoch += 1;
    // an apply already begun installs what the person consented to; the channel governs what comes after
    if (this.applying) {
      this.emit();
      return;
    }
    const state = this.stateValue;
    this.lastVerified = null;
    this.native = { touched: true, why: "no-manifest" };
    this.prepared = null;
    if (state.kind === "downloading") this.cancelDownload();
    // `checking` stays until that check settles (`checkOutlived` lands it on idle): electron-updater hands a second
    // check the first one's promise, so a check started now would read the old channel's answer
    if (state.kind === "downloading" || state.kind === "staged" || state.kind === "available")
      this.setState({ kind: "idle" });
    // the old channel's payload goes whatever the state shows: a check may have replaced `staged` (AU-1's persisted
    // clock still names it), or a relaunch left it in the cache behind an idle state
    if (state.kind === "staged" || this.client.staged !== null) {
      void this.collectStagedCache("channel-changed");
      this.forgetStaged();
    }
    this.emit();
  }

  /** The chosen channel ranks below the running build's own (EDP-36's "Return to stable"). */
  private downgrades(): boolean {
    return CHANNEL_RANK[this.channel] < CHANNEL_RANK[this.options.buildChannel];
  }

  /** C6 — the ONE projection the tray and the Settings card both render (they cannot drift). */
  view(): UpdateView {
    const state = this.stateValue;
    const common = {
      channel: this.channel,
      buildChannel: this.options.buildChannel,
      enabled: this.enabled,
      lastCheckAt: this.client.lastCheckAt,
      applyWired: this.options.apply?.wired === true,
      ...this.unsupportedBelow(),
      // AU-1 — the running version (the Me row's "You're on …") and the last apply, once a launch judged it
      ...(this.options.currentVersion !== undefined
        ? { currentVersion: this.options.currentVersion }
        : {}),
      ...this.lastApplyView(),
    };
    switch (state.kind) {
      case "checking":
        return { phase: "checking", ...common };
      // L3c-ii — found and held (skipped, or updates off): never "checking", which would never end
      case "available":
        return {
          phase: "available",
          version: state.version,
          ...(this.client.declined.includes(state.version) ? { declined: true } : {}),
          ...common,
        };
      case "downloading":
        return { phase: "downloading", version: state.version, percent: state.percent, ...common };
      case "staged":
        return {
          phase: "staged",
          version: state.version,
          ...(state.sessions !== undefined ? { sessions: state.sessions } : {}),
          ...(state.keepsSessions === true ? { keepsSessions: true } : {}),
          ...(state.blockedBy !== undefined ? { blockedBy: state.blockedBy } : {}),
          // AU-1 (AU-D3 A) — when this version FIRST became ready here, across launches
          stagedAt: state.stagedAt,
          ...common,
        };
      case "error": {
        const unavailable = state.unavailable?.state;
        if (unavailable === UPDATES_SERVICE.STATE_KILLED) return { phase: "paused", ...common };
        if (unavailable === UPDATES_SERVICE.STATE_FLOOR_UNMET)
          return { phase: "unsupported", ...common };
        if (state.code === "offline") return { phase: "offline", ...common };
        return {
          phase: "failed",
          ...(unavailable !== undefined ? { unavailable } : { unavailable: state.code }),
          ...common,
        };
      }
      default:
        return { phase: "idle", ...common };
    }
  }

  /** AU-1 (AU-D11 A; AU-G7) — the last apply as the window says it, once a launch has judged it (`landed`). A record
   * this process wrote has no `landed` (it is judged by the next launch), and neither does an older app's history. An
   * `installed` apply is said only while its version runs: another build on the same state (a hand install, a second
   * copy) never reads "Updated today" of a version it is not. No time filter here: the window decides "Updated today"
   * against `at`. */
  private lastApplyView(): { lastApply?: UpdateViewLastApply } {
    const last = this.client.lastApply;
    const landed = last?.landed;
    if (last === null || landed === undefined) return {};
    const current = this.options.currentVersion;
    if (landed.outcome === "installed" && current !== undefined && current !== last.version)
      return {};
    return {
      lastApply: {
        version: last.version,
        ...(last.from !== undefined ? { from: last.from } : {}),
        outcome: landed.outcome,
        at: landed.at,
        ...(last.trigger !== undefined ? { trigger: last.trigger } : {}),
        ...(this.judgedThisLaunch ? { thisLaunch: true } : {}),
      },
    };
  }

  private unsupportedBelow(): { unsupportedBelow?: string } {
    const min = this.lastVerified?.policy.minSupported;
    const current = this.options.currentVersion;
    return min !== undefined && current !== undefined && compareReleaseVersions(current, min) < 0
      ? { unsupportedBelow: min }
      : {};
  }

  /** EDP §11.6's doctor lines: the state, the last check, a staged version and what blocks it, a refusal's clause,
   * and a reset state. WP12d's doctor surface renders them; L1 states them. */
  doctorLines(): string[] {
    const state = this.stateValue;
    const lines = [
      `updates: ${state.kind} · channel ${this.channel}${this.enabled ? "" : " · turned off"}`,
      `last check: ${this.client.lastCheckAt === null ? "never" : new Date(this.client.lastCheckAt).toISOString()}`,
    ];
    const windowContext = this.options.safeWindowContext;
    if (state.kind === "staged" && windowContext !== undefined) {
      lines.push(
        safeWindowLine(
          safeWindow({
            ...windowContext(),
            displayHeldAwake: this.display,
            planes: this.planes(),
            census: this.censusCount,
          }),
        ),
      );
      if (this.silentNote !== null) lines.push(`silent apply: ${this.silentNote}`);
    }
    if (this.cacheBytes !== null)
      lines.push(`update cache: ${(this.cacheBytes / 1_048_576).toFixed(1)} MB`);
    const verified = this.lastVerified;
    if (verified !== null) {
      const policy = verified.policy;
      const flags = [
        policy.killSwitch ? "kill switch ON" : null,
        policy.requireUserConfirmation ? "confirmation required" : null,
        policy.yanked.length > 0 ? `${policy.yanked.length} yanked` : null,
        policy.floors.os !== undefined ? `macOS ${policy.floors.os} or later` : null,
      ].filter((flag): flag is string => flag !== null);
      lines.push(
        `policy: v${policy.version} for ${policy.channel}${flags.length > 0 ? ` — ${flags.join(", ")}` : ""}`,
      );
      const current = this.options.currentVersion;
      if (current !== undefined && policy.yanked.includes(current))
        lines.push(`the running version ${current} is yanked; the next update replaces it`);
      if (
        current !== undefined &&
        policy.minSupported !== undefined &&
        compareReleaseVersions(current, policy.minSupported) < 0
      ) {
        lines.push(
          `UNSUPPORTED: ${current} is below the minimum supported ${policy.minSupported} (advisory, never a block)`,
        );
      }
    }
    if (state.kind === "staged") {
      lines.push(
        this.native.touched
          ? `native plane: touched (${this.native.why}) — the apply ends its sessions`
          : `native plane: untouched by ${state.version} — its sessions keep running`,
      );
    }
    if (state.kind === "staged") {
      lines.push(
        `staged ${state.version} since ${new Date(state.stagedAt).toISOString()}${
          state.blockedBy !== undefined ? ` — blocked by: ${state.blockedBy}` : ""
        }`,
      );
    }
    if (state.kind === "error" && state.unavailable !== undefined) {
      lines.push(`UNAVAILABLE {service: "updates", state: "${state.unavailable.state}"}`);
    }
    const last = this.client.lastApply;
    if (last !== null) {
      lines.push(
        `last apply: ${last.version} at ${new Date(last.at).toISOString()} — ${last.branch}${
          last.reason !== undefined ? ` (${last.reason})` : ""
        }; ${last.consented} session${last.consented === 1 ? "" : "s"} consented${
          last.audited ? "" : "; outcome not yet in the audit ledger"
        }`,
      );
      // AU-1 — what the first launch after it found, and where it began
      if (last.landed !== undefined)
        lines.push(`landed: ${last.landed.outcome} at ${new Date(last.landed.at).toISOString()}`);
      const began = [
        last.from !== undefined ? `from: ${last.from}` : null,
        last.trigger !== undefined ? `trigger: ${last.trigger}` : null,
      ].filter((part): part is string => part !== null);
      if (began.length > 0) lines.push(began.join(" · "));
    }
    if (this.recovered !== null) {
      lines.push(
        `the update state was unreadable at ${new Date(this.recovered.at).toISOString()}; moved aside to ${this.recovered.movedAside}; restarted from the build's floor`,
      );
    }
    return lines;
  }

  /** WP12c (L2b-ii; `build-wp12-updater.md` §10, the PM's rulings 13:31–13:40Z) — the person's "Restart to Update",
   * in EDP §11.5's order with one law on top (an irreversible step goes after the last refusal):
   *   1. ONE census snapshot (unknown holds) → 2. the consent box when sessions live (Cancel holds) → the ATTEMPT row
   *   while fieldd lives → 3. the quit flow's update mode: the durable close, then `prepare()` = the daemons' consented
   *   stop with the snapshot's ids (a refusal ABORTS: nothing stopped, the window reopens) → 4. Squirrel's staging
   *   (only now: a staged payload is applied at the next start, `electron.d.ts:2103-2104`) → 5. `quitAndInstall()`.
   * From the stop on, every branch exits and nothing here reaches fieldd; `lastApply` names the branch first.
   *
   * L3b-i puts two reads in front of the census, both before anything is torn down: (B2) a FRESH verified policy —
   * unreachable or unverified holds, with the person told why; a lever that now refuses (a kill switch or a yank
   * published after the download, a floor) stops it — and (B3) the native plane's verdict from that same chain: a
   * release that leaves the floor's bytes alone skips the census and the consent and stops fieldd alone.
   *
   * L3b-ii (B4): `silent` is the safe window's own apply. It never shows a box: a refusal holds, said in the ledger and
   * doctor; and a release that touches the floor needs a FRESH census at zero (never the tray's periodic count — a
   * session born in the gap is the refusal fieldd's own re-check already makes). */
  async restartToInstall(opts: { readonly silent?: boolean } = {}): Promise<RestartOutcome> {
    // single-flight: a person's click while the silent path is mid-check (or the reverse) is the same apply
    if (this.restarting) return { ok: false, reason: "quit-underway" };
    this.restarting = true;
    try {
      const silent = opts.silent === true;
      const apply = this.options.apply;
      const prepared = await this.prepareOnce();
      if (!prepared.ok) {
        if (!silent && prepared.words !== undefined && apply !== undefined)
          await apply.notify(wordsBox(prepared.words));
        return { ok: false, reason: prepared.reason };
      }
      if (prepared.sessions.length > 0) {
        // the silent path asks no one: live sessions wait for a person (EDP-33, EDP-34's plane gate)
        if (silent || apply === undefined) {
          this.prepared = null;
          return { ok: false, reason: "sessions" };
        }
        // the tray's consent: the native box between the two phases, showing THIS snapshot
        const consented = await apply.confirm(consentBox(prepared.version, prepared.sessions));
        if (!consented) {
          this.prepared = null;
          return { ok: false, reason: "consent-declined" };
        }
      }
      const confirmed = await this.confirmRestart(prepared.token, silent ? "silent" : "person");
      if (!confirmed.ok && confirmed.reason === "expired" && !silent && apply !== undefined)
        await apply.notify(expiredNotice());
      return confirmed.ok ? confirmed : { ok: false, reason: confirmed.reason };
    } finally {
      this.restarting = false;
    }
  }

  /** C2 (L3c-i; the PM's ruling 2026-10-15 18:17Z) — the first phase, for the Settings card (its consent) and, inside
   * `restartToInstall`, the tray: a FRESH policy (B2), the levers, the planes (B3) and ONE census snapshot, bound to a
   * token. Nothing is torn down. */
  async prepareRestart(): Promise<PrepareOutcome> {
    if (this.restarting) return { ok: false, reason: "quit-underway" };
    this.restarting = true;
    try {
      return await this.prepareOnce();
    } finally {
      this.restarting = false;
    }
  }

  /** C2 — the second phase: act on EXACTLY the prepared snapshot (its ids are what fieldd re-checks, the last word).
   * One use; a stale, replaced or unknown token is `expired`, which means a fresh prepare, never a silent proceed. */
  async confirmRestart(
    token: string,
    trigger: "person" | "silent" = "person",
  ): Promise<RestartOutcome> {
    const prepared = this.prepared;
    this.prepared = null;
    const state = this.stateValue;
    if (
      prepared === null ||
      prepared.token !== token ||
      this.now() > prepared.expiresAt ||
      state.kind !== "staged" ||
      state.version !== prepared.version
    ) {
      return { ok: false, reason: "expired", words: wordsOf(expiredNotice()) };
    }
    const apply = this.options.apply;
    if (apply === undefined || !apply.wired) return { ok: false, reason: "apply-unbuilt" };
    // the silent path's guards, read again past the prepare's awaits (the fresh policy read, the census) — before the
    // ATTEMPT row, with no await between, so a hold here writes no row — and once more past the ATTEMPT row, below:
    // a person who switched updates off, or a policy that now requires confirmation, holds it before anything is torn
    // down
    if (trigger === "silent") {
      const held = this.silentHeld(prepared.version);
      if (held !== null) return { ok: false, reason: held };
    }
    const sessions = prepared.sessions.map((session) => session.sessionId);
    const operationId = randomUUID();
    // AU-1 (X3) — the record says how the apply began; the ATTEMPT row keeps the ledger's own words (`person`)
    const began: UpdateApplyTrigger = trigger === "silent" ? "silent" : "restart";
    await this.auditAttempt(operationId, {
      version: prepared.version,
      consented: String(sessions.length),
      native: prepared.native ? "stop" : "keep",
      trigger,
    });
    // AU-1 — the last await-free point before the quit. The ATTEMPT row was awaited (up to AUDIT_ATTEMPT_BOUND_MS) and
    // nothing serialises the doors against it (`restarting` guards only `restartToInstall` and `prepareRestart`): a
    // check (the tray, the app menu, a resume, the card), a decline, a channel change, or a census refresh whose lever
    // discards the payload may have moved the update on, on either path; and on the silent path the switch, a decline
    // or a policy that now requires confirmation hold it. From here to `quitForUpdate` nothing awaits. A refusal after
    // the ATTEMPT row is closed by its OUTCOME row, so every ATTEMPT row has exactly one.
    const late = trigger === "silent" ? this.silentHeld(prepared.version) : null;
    const current = this.stateValue;
    if (late !== null || current.kind !== "staged" || current.version !== prepared.version) {
      this.auditApplyRefused(operationId, late ?? "not-staged", {
        version: prepared.version,
        consented: sessions.length,
        began,
      });
      // a moved update is the entry's `expired`: a fresh prepare, never a silent proceed
      return late !== null
        ? { ok: false, reason: late }
        : { ok: false, reason: "expired", words: wordsOf(expiredNotice()) };
    }
    if (
      !apply.quitForUpdate(
        this.updatePlan(apply, prepared.version, sessions, operationId, prepared.native, began),
      )
    ) {
      this.auditApplyRefused(operationId, "quit-underway", {
        version: prepared.version,
        consented: sessions.length,
        began,
      });
      return { ok: false, reason: "quit-underway" };
    }
    // the apply's quit is underway: nothing re-evaluates (the timer dies here, and again at the stop)
    this.applying = true;
    this.syncSilentTimer();
    return { ok: true };
  }

  private async prepareOnce(): Promise<PrepareOutcome> {
    this.prepared = null;
    const state = this.stateValue;
    if (state.kind !== "staged") return { ok: false, reason: "not-staged" };
    const apply = this.options.apply;
    if (apply === undefined || !apply.wired) return { ok: false, reason: "apply-unbuilt" };
    if (this.client.declined.includes(state.version)) return { ok: false, reason: "declined" };
    // AU-1 (LC-12) — the off switch governs what happens WITHOUT a person (the background download, the silent apply,
    // install on quit); a person's Restart of a staged version is a person's act, so it is not refused here
    const version = state.version;

    // B2 — a fresh verified policy, read now; no offline allowance
    const fresh = await this.freshPolicy();
    // AU-1 — the read is awaited (up to FRESH_POLICY_BOUND_MS), and a check, a decline or a channel change meanwhile
    // moved the update on: the path that moved it owns its payload and its clock, so nothing below stages it again
    // (`stagedOf` would re-persist the clock of a collected payload) or judges a lever on a version the state left
    const after = this.stateValue;
    if (after.kind !== "staged" || after.version !== version)
      return { ok: false, reason: "not-staged" };
    if (fresh.kind !== "verified") {
      const reason = fresh.kind === "unreachable" ? "policy-unreachable" : "policy-unverified";
      this.audit(
        UPDATES_AUDIT_ACTIONS.APPLY,
        "denied",
        reason === "policy-unreachable" ? "POLICY_UNREACHABLE" : "POLICY_UNVERIFIED",
        { version, ...(fresh.kind === "refused" ? { state: fresh.state } : {}) },
      );
      this.setState({ ...this.stagedOf(version), blockedBy: reason });
      return {
        ok: false,
        reason,
        words: wordsOf(
          policyNotice({ kind: reason === "policy-unreachable" ? "unreachable" : "unverified" }),
        ),
      };
    }
    this.lastVerified = fresh.chain;
    const policy = leversOf(fresh.chain.policy);
    const lever = leverRefusal(version, policy, this.options.hostOsVersion?.() ?? null);
    if (lever !== null) {
      this.refuseByLever(version, lever, UPDATES_AUDIT_ACTIONS.APPLY);
      return {
        ok: false,
        reason: lever,
        words: wordsOf(policyNotice(this.leverWhy(lever, version, policy.floors.os))),
      };
    }

    // B3 — the planes, by digest, from the same fresh chain; a touched release takes ONE census snapshot
    const native = (await this.judgeNative(fresh.chain, version)).touched;
    let sessions: readonly CensusSession[] = [];
    if (native) {
      const snapshot = await this.readCensus();
      if (!snapshot.known) {
        this.audit(UPDATES_AUDIT_ACTIONS.APPLY, "denied", "CENSUS_UNKNOWN", { version });
        return { ok: false, reason: "census-unknown", words: wordsOf(censusNotice()) };
      }
      sessions = snapshot.sessions;
    }
    const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
    const expiresAt = this.now() + PREPARE_TTL_MS;
    this.prepared = { token, version, native, sessions, expiresAt };
    return {
      ok: true,
      token,
      version,
      keepsSessions: !native,
      sessions,
      expiresAt,
      // L3c-ii — the consent's words travel with the snapshot, so the card says what the tray's box says
      ...(sessions.length > 0 ? { consent: consentWords(version, sessions) } : {}),
    };
  }

  /** B4 (EDP-34, §11.3) — apply a staged update ON ITS OWN when the safe window holds: windowless ∧ tray-resident ∧ the
   * display not held awake (read fresh) ∧ the plane gate (field-native untouched, or a FRESH census at zero — checked
   * inside the apply). The policy's `requireUserConfirmation` and the person's off switch keep it a person's act.
   * Evaluated on staged, on the last window's close, on resume, and on the timer that lives only while staged. */
  async considerSilentApply(
    trigger: "staged" | "window-closed" | "resume" | "timer",
  ): Promise<SilentOutcome> {
    const no = (reason: string): SilentOutcome => {
      this.silentNote = `not now (${trigger}) — ${reason}`;
      return { applying: false, reason };
    };
    if (this.silentInFlight || this.applying || this.daemonsStopped || this.disposed)
      return { applying: false, reason: "busy" };
    const state = this.stateValue;
    if (state.kind !== "staged") return { applying: false, reason: "not-staged" };
    if (this.options.apply?.wired !== true) return no("apply-unbuilt");
    const held = this.silentHeld(state.version);
    if (held !== null) return no(held);
    const windowContext = this.options.safeWindowContext;
    if (windowContext === undefined) return no("no window context");
    this.silentInFlight = true;
    try {
      this.display = (await this.options.displayHeldAwake?.()) ?? "unknown";
      // the window's own clauses first (the plane gate needs the fresh chain and census the apply reads)
      const window = safeWindow({
        ...windowContext(),
        displayHeldAwake: this.display,
        planes: this.planes(),
        census: 0,
      });
      if (!window.open) return no(window.clause);
      const outcome = await this.restartToInstall({ silent: true });
      if (outcome.ok) {
        this.silentNote = `applying (${trigger})`;
        return { applying: true };
      }
      return no(outcome.reason);
    } finally {
      this.silentInFlight = false;
    }
  }

  /** B4 — what keeps an apply a person's act: the off switch, a decline, the policy's `requireUserConfirmation` (the
   * last verified one: the apply's fresh read replaces it). Read at the silent path's entry and again inside
   * `confirmRestart` past each await, so a change while the apply reads never installs. AU-1 (X14) removed
   * `prepareOnce`'s own `disabled`, so this is the silent path's only reading of the switch. */
  private silentHeld(version: string): "disabled" | "declined" | "confirmation-required" | null {
    if (!this.enabled) return "disabled";
    if (this.client.declined.includes(version)) return "declined";
    if (this.lastVerified?.policy.requireUserConfirmation === true) return "confirmation-required";
    return null;
  }

  /** B4 — the re-evaluation timer: alive only while staged, wired and no apply underway; it dies on every exit branch
   * (the stop sets `daemonsStopped`), on a decline or any other leaving of the staged state, and on dispose. */
  private syncSilentTimer(): void {
    const wanted =
      this.stateValue.kind === "staged" &&
      this.options.apply?.wired === true &&
      !this.applying &&
      !this.daemonsStopped &&
      !this.disposed;
    if (wanted && this.silentTimer === null) {
      this.silentTimer = setInterval(() => {
        void this.considerSilentApply("timer");
      }, SILENT_RECHECK_MS);
      this.silentTimer.unref?.();
    } else if (!wanted && this.silentTimer !== null) {
      clearInterval(this.silentTimer);
      this.silentTimer = null;
    }
  }

  /** Whether the re-evaluation timer is alive (doctor; the tests' window onto the timer's life). */
  get silentTimerAlive(): boolean {
    return this.silentTimer !== null;
  }

  /** B6 — empty the staged payload (never while a download writes it), then measure the cache for doctor. */
  private collectStagedCache(reason: string): Promise<void> {
    const cache = this.options.stagedCache;
    if (cache === undefined || this.stateValue.kind === "downloading") return Promise.resolve();
    const run = (async () => {
      try {
        await cache.clear();
        this.options.log.info(
          "desktop.update.cache_collected",
          "The staged update's payload was deleted",
          {
            reason,
          },
        );
      } catch (error) {
        this.options.log.warn(
          "desktop.update.cache_collect_failed",
          "The staged update's payload stayed",
          {
            reason,
            error: String(error),
          },
        );
      }
      await this.measureCache();
    })();
    // the tracked promise is the one compared: the collection clears itself once done (a download then waits for none)
    const tracked: Promise<void> = run.finally(() => {
      if (this.collecting === tracked) this.collecting = null;
    });
    this.collecting = tracked;
    return run;
  }

  private async measureCache(): Promise<void> {
    const cache = this.options.stagedCache;
    if (cache === undefined) return;
    this.cacheBytes = await cache.size().catch(() => null);
  }

  /** B2 — the chain run again, now, on the click's own fetcher: verified, refused (named), or unreachable (a network
   * failure, or no answer inside `FRESH_POLICY_BOUND_MS`). */
  private async freshPolicy(): Promise<
    | { readonly kind: "verified"; readonly chain: VerifiedChain }
    | { readonly kind: "refused"; readonly state: UpdatesUnavailableState }
    | { readonly kind: "unreachable" }
  > {
    const fetch = this.options.fetch;
    if (fetch === undefined) return { kind: "unreachable" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.verify(fetch),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), FRESH_POLICY_BOUND_MS);
        }),
      ]);
      if (result === "timeout") return { kind: "unreachable" };
      return result.ok
        ? { kind: "verified", chain: result }
        : { kind: "refused", state: result.state };
    } catch {
      return { kind: "unreachable" };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** A lever refused a version (B1): audited, and the state says it — `killed` or `floor-unmet` (the tray's "Updates
   * Paused" / "Update Needs a Newer macOS"), or nothing to offer for a yank. A STAGED payload any lever refuses is
   * deleted (B6): a kill no longer holds it, so after a later policy lifts the kill the next check downloads again.
   * AU-1 — the version staged on this Mac is the state's, or else the persisted clock's: a check has already moved the
   * state (`checking`, then `available`) when its lever bites, and after a relaunch the payload waits in
   * electron-updater's cache while the state is idle. Either way the refused payload goes, and its clock with it. Every
   * caller judges the levers of `lastVerified` (a check's chain, the click's fresh one), so the staged version is
   * refused when it IS `version`, or when a lever refuses it too (a kill, the OS floor). */
  private refuseByLever(version: string, lever: LeverRefusal, action: string): void {
    this.audit(action, "denied", LEVER_CODE[lever], { version });
    this.options.log.warn("desktop.update.lever", "The update policy refused a version", {
      version,
      lever,
      channel: this.channel,
    });
    const state = this.stateValue;
    const staged = state.kind === "staged" ? state.version : (this.client.staged?.version ?? null);
    this.stateForLever(lever);
    if (staged !== null && (staged === version || this.leverOf(staged) !== null)) {
      void this.collectStagedCache(lever);
      this.forgetStaged();
    }
  }

  /** B1 — the last verified policy's lever on `version` for this host, or null. */
  private leverOf(version: string): LeverRefusal | null {
    const policy = this.lastVerified === null ? null : leversOf(this.lastVerified.policy);
    return leverRefusal(version, policy, this.options.hostOsVersion?.() ?? null);
  }

  /** A lever's refusal of `version`, as the words name it (the apply's `policyNotice`, a download's `downloadNotice`). */
  private leverWhy(lever: LeverRefusal, version: string, floor: string | undefined): LeverWhy {
    if (lever === "killed") return { kind: "killed", channel: this.channel };
    if (lever === "yanked") return { kind: "yanked", version };
    return { kind: "floor-unmet", version, floor: floor ?? "" };
  }

  private stateForLever(lever: LeverRefusal): void {
    if (lever === "yanked") {
      this.setState({ kind: "not-available" });
      return;
    }
    this.setState({
      kind: "error",
      code: "refused",
      unavailable: {
        service: UPDATES_SERVICE.SERVICE,
        state:
          lever === "killed" ? UPDATES_SERVICE.STATE_KILLED : UPDATES_SERVICE.STATE_FLOOR_UNMET,
      },
    });
  }

  /** B3 — the verdict on the native plane for `version`, from a verified chain whose head IS that version. */
  private async judgeNative(chain: VerifiedChain | null, version: string): Promise<NativeVerdict> {
    const read = this.options.nativePlane;
    const key = this.options.platformKey;
    let verdict: NativeVerdict;
    if (read === undefined || key === undefined) verdict = { touched: true, why: "unreadable" };
    else if (chain === null || chain.headVersion !== version)
      verdict = { touched: true, why: "head-moved" };
    else {
      this.localNative ??= read().catch(() => null);
      verdict = nativeVerdict(chain.manifest, key, await this.localNative);
    }
    this.native = verdict;
    return verdict;
  }

  /** EDP-34's planes for the staged release: every plane, minus field-native when B3 found it untouched. */
  private planes(): readonly UpdatePlane[] {
    return this.native.touched
      ? UPDATE_PLANES
      : UPDATE_PLANES.filter((plane) => plane !== "field-native");
  }

  /** The quit flow's plan for one apply. `prepare` is the only place the daemons stop. */
  private updatePlan(
    apply: ApplyPort,
    version: string,
    sessions: readonly string[],
    operationId: string,
    native: boolean,
    trigger: UpdateApplyTrigger,
  ): UpdateQuitPlan {
    const consented = sessions.length;
    return {
      prepare: async (): Promise<UpdatePrepared> => {
        const stopped = await apply.stopDaemons(sessions, version, native);
        if (!stopped.ok) return { kind: "abort", reason: stopped.reason };
        // The daemons are down. From here every branch exits, and nothing may reach fieldd (that would START it).
        this.daemonsStopped = true;
        this.syncSilentTimer(); // every exit branch starts here: the re-evaluation timer dies with the stop
        const staged = await apply.stage(SQUIRREL_STAGE_MS);
        if (staged.kind === "staged") {
          this.recordLastApply({ version, branch: "installing", consented, operationId, trigger });
          return { kind: "install" };
        }
        if (staged.kind === "refused") {
          // Squirrel's own error: nothing is armed, so the app relaunches on the current bytes
          this.recordLastApply({
            version,
            branch: "relaunched",
            reason: "squirrel-refused",
            consented,
            operationId,
            trigger,
          });
          return { kind: "exit", relaunch: true, reason: "squirrel-refused" };
        }
        // no answer in the bound: Squirrel may still arm, so the app quits WITHOUT relaunch, after saying so
        this.recordLastApply({
          version,
          branch: "exited",
          reason: "squirrel-timeout",
          consented,
          operationId,
          trigger,
        });
        await apply.notify(quitNotice("squirrel-timeout"));
        return { kind: "exit", relaunch: false, reason: "squirrel-timeout" };
      },
      install: () => apply.install(),
      aborted: (reason) => {
        // before the stop: fieldd lives, so this outcome reaches the ledger now, as the ATTEMPT row's own OUTCOME row
        this.auditApplyRefused(operationId, "sessions-changed", {
          version,
          consented,
          began: trigger,
          reason,
        });
        this.applying = false; // still staged: the re-evaluation timer comes back with the state below
        this.setState({ ...this.stagedOf(version), blockedBy: "sessions" });
        apply.restore();
        void this.refreshCensus();
      },
      installStalled: async () => {
        this.recordLastApply({
          version,
          branch: "exited",
          reason: "install-failed",
          consented,
          operationId,
          trigger,
        });
        await apply.notify(quitNotice("install-failed"));
      },
    };
  }

  /** WP12c — the census, ONE snapshot, through the port (bounded there); also refreshes the tray's count. */
  private async readCensus(): Promise<CensusSnapshot> {
    const apply = this.options.apply;
    if (apply === undefined || !apply.wired) return { known: true, sessions: [] };
    const snapshot = await apply.census().catch((): CensusSnapshot => ({ known: false }));
    this.censusCount = snapshot.known ? snapshot.sessions.length : "unknown";
    this.settleStaged();
    return snapshot;
  }

  /** The staged update's standing after a census or a policy read (B1, B3): held and named, discarded, or offered. */
  private settleStaged(): void {
    const state = this.stateValue;
    if (state.kind !== "staged") return;
    const next = this.decide("downloaded");
    if (next.kind === "discard") {
      this.refuseByLever(next.version, next.reason, UPDATES_AUDIT_ACTIONS.VERIFY);
      return;
    }
    const { blockedBy: _blocked, keepsSessions: _keeps, sessions: _sessions, ...rest } = state;
    this.setState({
      ...rest,
      ...(this.options.apply?.wired === true ? { sessions: this.censusCount } : {}),
      ...(this.native.touched ? {} : { keepsSessions: true as const }),
      ...(next.kind === "hold" ? { blockedBy: next.reason } : {}),
    });
  }

  /** WP12c — re-read the census so the tray's verb stays honest (never while the daemons are stopped). */
  async refreshCensus(): Promise<void> {
    if (this.daemonsStopped || this.disposed) return;
    await this.readCensus();
  }

  private stagedOf(version: string): UpdateState & { kind: "staged" } {
    const state = this.stateValue;
    return state.kind === "staged" && state.version === version
      ? state
      : { kind: "staged", version, stagedAt: this.stagedSince(version) };
  }

  /** AU-1 (AU-D3 A) — when `version` FIRST became ready on this Mac: the persisted clock when it is this version's (a
   * relaunch re-stages it from electron-updater's cache), else now, persisted. */
  private stagedSince(version: string): number {
    const staged = this.client.staged;
    if (staged !== null && staged.version === version) return staged.at;
    const at = this.now();
    this.persist({ ...this.client, staged: { version, at } });
    return at;
  }

  /** AU-1 (AU-D3 A) — the staged payload is collected (declined, a channel change, a lever, a check that found
   * nothing): its clock goes with it. */
  private forgetStaged(): void {
    if (this.client.staged !== null) this.persist({ ...this.client, staged: null });
  }

  /** WP12c — synchronous, before every exit the apply takes (the store writes atomically and at once). AU-1: with the
   * version it leaves (`from`) and how it began (`trigger`); its `landed` is the next launch's to judge. */
  private recordLastApply(entry: {
    version: string;
    branch: "installing" | "relaunched" | "exited";
    reason?: "squirrel-refused" | "squirrel-timeout" | "install-failed";
    consented: number;
    operationId: string;
    trigger: UpdateApplyTrigger;
  }): void {
    const from = this.options.currentVersion;
    this.persist({
      ...this.client,
      lastApply: {
        at: this.now(),
        version: entry.version,
        branch: entry.branch,
        ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
        consented: entry.consented,
        operationId: entry.operationId,
        audited: false,
        ...(from !== undefined ? { from } : {}),
        trigger: entry.trigger,
      },
    });
  }

  /** WP12c — at the next launch, the OUTCOME row for an apply that exited after the stop, once. A handed-off install
   * succeeded when this app now runs the version it installed. */
  private async deliverLastApply(): Promise<void> {
    const last = this.client.lastApply;
    const append = this.options.appendAudit;
    if (last === null || last.audited || append === undefined) return;
    const installed = last.branch === "installing" && this.options.currentVersion === last.version;
    const reasonCode = installed
      ? undefined
      : last.branch === "installing"
        ? "INSTALL_NOT_APPLIED"
        : (last.reason ?? "unknown").toUpperCase().replace(/-/g, "_");
    try {
      await append({
        action: UPDATES_AUDIT_ACTIONS.APPLY,
        target: { kind: "app-update", id: this.channel },
        phase: "outcome",
        outcome: installed ? "succeeded" : "failed",
        ...(reasonCode !== undefined ? { reasonCode } : {}),
        operationId: last.operationId ?? randomUUID(),
        attrs: {
          version: last.version,
          branch: last.branch,
          consented: String(last.consented),
          // AU-1 — where the apply began, when the record says it. `began` is the record's word (`restart`, `silent`,
          // `quit`); the ledger's `trigger` stays the ATTEMPT row's (`person`, `silent`), so one operation never names
          // its trigger in two vocabularies
          ...(last.from !== undefined ? { from: last.from } : {}),
          ...(last.trigger !== undefined ? { began: last.trigger } : {}),
        },
      });
      this.persist({ ...this.client, lastApply: { ...last, audited: true } });
    } catch (error) {
      this.options.log.warn(
        "desktop.update.apply_outcome_unaudited",
        "The last apply's outcome did not reach the audit ledger; it is tried again at the next launch",
        { error: String(error) },
      );
    }
  }

  /** AU-1 — an apply refused AFTER its ATTEMPT row and before anything was torn down (fieldd lives): the ATTEMPT's one
   * OUTCOME row, `denied`, under its operation id, in `deliverLastApply`'s vocabulary — the reason code is the refusal
   * in capitals, `began` says how the apply began (the record's word; the ATTEMPT row's `trigger` keeps the ledger's)
   * and `from` the version it would have left. */
  private auditApplyRefused(
    operationId: string,
    refusal: string,
    entry: {
      readonly version: string;
      readonly consented: number;
      readonly began: UpdateApplyTrigger;
      readonly reason?: string;
    },
  ): void {
    const from = this.options.currentVersion;
    this.audit(
      UPDATES_AUDIT_ACTIONS.APPLY,
      "denied",
      refusal.toUpperCase().replace(/-/g, "_"),
      {
        version: entry.version,
        consented: String(entry.consented),
        ...(from !== undefined ? { from } : {}),
        began: entry.began,
        ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      },
      operationId,
    );
  }

  /** WP12c — the apply's ATTEMPT row, through fieldd while it lives, awaited and bounded. */
  private async auditAttempt(operationId: string, attrs: Record<string, string>): Promise<void> {
    const append = this.options.appendAudit;
    if (append === undefined) return;
    const record: AuditAppendV1 = {
      action: UPDATES_AUDIT_ACTIONS.APPLY,
      target: { kind: "app-update", id: this.channel },
      phase: "attempt",
      operationId,
      attrs,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      append(record).catch((error: unknown) => {
        this.options.log.warn(
          "desktop.update.audit_failed",
          "The apply's attempt row was not appended",
          {
            error: String(error),
          },
        );
      }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, AUDIT_ATTEMPT_BOUND_MS);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
  }

  dispose(): void {
    this.disposed = true;
    this.syncSilentTimer();
    this.cancelDownload();
    this.options.updater.removeListener("download-progress", this.onProgress);
    this.options.updater.removeListener("error", this.onError);
    this.listeners.clear();
  }

  private async verify(fetch: FetchBytes): Promise<ChainResult> {
    const result = await verifyUpdateChain({
      origin: this.options.origin,
      channel: this.channel,
      rootKeys: this.anchor.keys,
      remembered: this.client.remembered,
      ...(this.options.floors !== undefined ? { floors: this.options.floors } : {}),
      now: this.now(),
      feedFile: this.options.feedFile,
      fetch,
    });
    // every ACCEPTED document is remembered, even when a later step refused (TD-10) — and a trust-root that ROTATES the
    // root set is adopted (B5): persisted as its signed document, so the next rotation verifies against it
    let trustRoots = this.client.trustRoots;
    const adopted = result.acceptedRoot;
    if (adopted !== undefined && rotates(this.anchor, adopted.rootKeys)) {
      if (trustRoots.length >= MAX_ADOPTED_ROOTS) {
        this.options.log.warn(
          "desktop.update.root_chain_full",
          "A rotated trust-root verified, but the adopted chain is full; it is trusted for this check only",
          { version: adopted.version, kept: trustRoots.length },
        );
      } else {
        trustRoots = [
          ...trustRoots,
          { version: adopted.version, doc: adopted.doc, sig: adopted.sig },
        ];
        this.anchor = { keys: adopted.rootKeys, version: adopted.version };
        this.options.log.info("desktop.update.root_adopted", "A rotated trust-root was adopted", {
          version: adopted.version,
          keys: adopted.rootKeys.length,
        });
      }
    }
    this.persist({ ...this.client, remembered: result.remembered, trustRoots });
    return result;
  }

  private async startDownload(version: string): Promise<void> {
    // the download is the state from the first moment, so a second door call (a double click) finds it underway
    const token = this.options.newCancellationToken();
    this.download = token;
    this.setState({ kind: "downloading", version, percent: 0 });
    // a collection in flight empties the directory the download writes: let it finish first (B6); a decline, the off
    // switch or a channel change meanwhile cancelled this download
    if (this.collecting !== null) {
      await this.collecting;
      if (this.download !== token) return;
    }
    try {
      await this.options.updater.downloadUpdate(token);
    } catch (error) {
      if (this.download !== token) return; // cancelled by decline or the off switch; its state is already set
      this.download = null;
      this.fail(error);
      return;
    }
    if (this.download !== token) return;
    this.download = null;
    this.setState({ kind: "staged", version, stagedAt: this.stagedSince(version) });
    // WP12 L4 (R4) — a staged update leaves a line: what is staged, and the sha512 its payload was checked against (the
    // signed feed's). Before this, nothing outside the process said "staged" — a doctor gap of its own.
    const sha512 = feedSha512Of(this.lastVerified?.feedText ?? "");
    this.options.log.info(
      "desktop.update.staged",
      "An update is downloaded; it installs at the next restart",
      {
        version,
        ...(sha512 !== null ? { sha512 } : {}),
      },
    );
    // B3 — the verdict from the chain that found this version (its head IS the staged one, or it reads touched)
    await this.judgeNative(this.lastVerified, version);
    if (this.options.apply?.wired === true) {
      // WP12c — the census decides what the tray offers (the verb, the consent, or a hold)
      await this.readCensus();
    } else {
      this.settleStaged();
    }
    await this.measureCache();
    // B4 — a freshly staged update may apply on its own at once, when the safe window already holds
    if (this.stateValue.kind === "staged") await this.considerSilentApply("staged");
  }

  private cancelDownload(): void {
    const token = this.download;
    this.download = null;
    token?.cancel();
  }

  private fail(error: unknown): void {
    const state = updateErrorOf(error);
    this.setState(state);
    if (state.unavailable !== undefined) {
      const detail = error instanceof UpdateRefusal ? error.detail : undefined;
      this.options.log.warn(
        "desktop.update.refused",
        "UNAVAILABLE: the update was refused before any download",
        {
          service: state.unavailable.service,
          state: state.unavailable.state,
          detail,
          channel: this.channel,
        },
      );
      this.audit(
        UPDATES_AUDIT_ACTIONS.VERIFY,
        "denied",
        state.unavailable.state.toUpperCase().replace(/-/g, "_"),
      );
    } else {
      this.options.log.info("desktop.update.check_failed", "An update check failed", {
        code: state.code,
      });
    }
  }

  /** An OUTCOME row, fire and forget; under its own operation id unless it closes an ATTEMPT row (`operationId`). */
  private audit(
    action: string,
    outcome: "denied" | "succeeded" | "failed",
    reasonCode?: string,
    attrs?: Record<string, string>,
    operationId?: string,
  ): void {
    const append = this.options.appendAudit;
    // after the daemon stop an append would START fieldd (it travels through `ensureFieldd`): never
    if (append === undefined || this.daemonsStopped) return;
    const record: AuditAppendV1 = {
      action,
      target: { kind: "app-update", id: this.channel },
      phase: "outcome",
      outcome,
      ...(reasonCode !== undefined ? { reasonCode } : {}),
      operationId: operationId ?? randomUUID(),
      ...(attrs !== undefined ? { attrs } : {}),
    };
    append(record).catch((error: unknown) => {
      this.options.log.warn(
        "desktop.update.audit_failed",
        "An update audit record was not appended",
        {
          action,
          error: String(error),
        },
      );
    });
  }

  private persist(next: UpdateClientState): void {
    this.client = next;
    try {
      this.options.store.save(next);
    } catch (error) {
      this.options.log.warn(
        "desktop.update.state_save_failed",
        "The update state could not be saved",
        {
          error: String(error),
        },
      );
    }
  }

  private setState(next: UpdateState): void {
    this.stateValue = next;
    this.syncSilentTimer();
    this.emit();
  }

  /** Subscribers hear the state AND the person's choices (the switch, the channel, a decline): the view is both. */
  private emit(): void {
    for (const listener of this.listeners) listener(this.stateValue);
  }
}

/** The words a refusal carries to the card (the tray's box says the same). */
function wordsOf(box: BoxContent): { message: string; detail: string } {
  return { message: box.message, detail: box.detail };
}

/** The tray's native box for those words. AU-4: the menus' Download Update says a refusal in it too (`index.ts`). */
export function wordsBox(words: { readonly message: string; readonly detail: string }): BoxContent {
  return {
    message: words.message,
    detail: words.detail,
    buttons: ["OK"],
    defaultId: 0,
    cancelId: 0,
  };
}

/** The verified feed's top-level `sha512:` (electron-builder writes it unquoted or quoted), the payload's checked hash. */
export function feedSha512Of(feedText: string): string | null {
  const match = feedText.match(/^sha512:[ \t]*['"]?([^'"\s]+)['"]?[ \t]*$/m);
  return match === null ? null : match[1]!;
}

/** The channels, lowest first (the segmented control's order). */
export const UPDATE_CHANNELS_BY_RANK: readonly UpdateChannel[] = [...UPDATE_CHANNELS].sort(
  (a, b) => CHANNEL_RANK[a] - CHANNEL_RANK[b],
);
