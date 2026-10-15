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

import { randomUUID } from "node:crypto";
import {
  UPDATE_PLANES,
  UPDATES_AUDIT_ACTIONS,
  UPDATES_SERVICE,
  type UpdateChannel,
  type UpdatePlane,
  type UpdatePolicy,
  type UpdatesUnavailableState,
} from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import type { UpdatePrepared, UpdateQuitPlan } from "../quit-flow";
import {
  type ApplyPort,
  type CensusSnapshot,
  consentBox,
  policyNotice,
  quitNotice,
  SQUIRREL_STAGE_MS,
} from "./apply";
import {
  type CensusCount,
  compareSemver,
  decideUpdate,
  type LeverRefusal,
  leverRefusal,
  type PolicyLevers,
  type UpdateAction,
  type UpdateTrigger,
} from "./decide";
import { type NativePlane, type NativeVerdict, nativeVerdict } from "./native-plane";
import { UpdateRefusal } from "./refusal";
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
        | "killed"
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
  readonly safeWindowContext?: () => Omit<SafeWindowContext, "census" | "planes">;
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

/** What `restartToInstall()` answered. `ok: true` = the update quit is underway (the flow owns the rest). */
export type RestartOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "not-staged"
        | "apply-unbuilt"
        | "declined"
        | "disabled"
        | "census-unknown"
        | "consent-declined"
        | "quit-underway"
        | "policy-unreachable"
        | "policy-unverified"
        | LeverRefusal;
    };

/** How long the apply's ATTEMPT row may take to reach fieldd's audit before the apply goes on without it. */
const AUDIT_ATTEMPT_BOUND_MS = 2_000;
/** How long the click's fresh policy check may take before it counts as unreachable (B2). */
export const FRESH_POLICY_BOUND_MS = 20_000;

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
    const updater = options.updater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false; // WP12c's gate owns the apply; nothing installs on a plain quit
    updater.allowDowngrade = false;
    // `allowPrerelease` is left as electron-updater sets it (on for a nightly or beta build, AppUpdater.js:218): the
    // custom provider never reads it — the signed channel heads decide the channel (D4).
    updater.setFeedURL(
      options.feedOptions({
        verify: (fetch) => this.verify(fetch),
        verified: (result) => {
          this.lastVerified = result;
        },
      }),
    );
    updater.on("download-progress", this.onProgress);
    updater.on("error", this.onError);
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

  /** One check (launch · manual · resume), single-flight; a found update downloads unless declined or off. */
  async check(reason: "launch" | "manual" | "resume"): Promise<UpdateAction> {
    const action = this.decide(reason);
    if (action.kind !== "check" || this.disposed) return action;
    this.setState({ kind: "checking", reason });
    let found: string | null = null;
    try {
      const result = await this.options.updater.checkForUpdates();
      this.persist({ ...this.client, lastCheckAt: this.now() });
      found =
        result?.isUpdateAvailable === true && result.updateInfo ? result.updateInfo.version : null;
    } catch (error) {
      this.persist({ ...this.client, lastCheckAt: this.now() });
      this.fail(error);
      return action;
    }
    if (this.disposed) return action;
    if (found === null) {
      this.setState({ kind: "not-available" });
      return action;
    }
    this.setState({ kind: "available", version: found });
    const next = this.decide("available");
    if (next.kind === "download") await this.startDownload(next.version);
    else if (next.kind === "none" && isLever(next.reason))
      this.refuseByLever(found, next.reason, UPDATES_AUDIT_ACTIONS.VERIFY);
    return action;
  }

  /** A person declines a version: it stays declined across restarts and a staged download (EDP §11.3). */
  decline(version: string): void {
    if (!this.client.declined.includes(version)) {
      this.persist({ ...this.client, declined: [...this.client.declined, version].slice(-64) });
    }
    this.audit(UPDATES_AUDIT_ACTIONS.DECLINE, "succeeded", undefined, { version });
    const state = this.stateValue;
    if ("version" in state && state.version === version) {
      this.cancelDownload();
      this.setState({ kind: "idle" });
    }
  }

  /** The off switch: honored at every stage boundary — an in-flight download is cancelled now. */
  setEnabled(enabled: boolean): void {
    this.persist({ ...this.client, enabled });
    if (!enabled && this.stateValue.kind === "downloading") {
      this.cancelDownload();
      this.setState({ kind: "idle" });
    }
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
          safeWindow({ ...windowContext(), planes: this.planes(), census: this.censusCount }),
        ),
      );
    }
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
        compareSemver(current, policy.minSupported) < 0
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
   * release that leaves the floor's bytes alone skips the census and the consent and stops fieldd alone. */
  async restartToInstall(): Promise<RestartOutcome> {
    const state = this.stateValue;
    if (state.kind !== "staged") return { ok: false, reason: "not-staged" };
    const apply = this.options.apply;
    if (apply === undefined || !apply.wired) return { ok: false, reason: "apply-unbuilt" };
    if (this.client.declined.includes(state.version)) return { ok: false, reason: "declined" };
    if (!this.enabled) return { ok: false, reason: "disabled" };
    const version = state.version;

    // B2 — a fresh verified policy, read now; no offline allowance
    const fresh = await this.freshPolicy();
    if (fresh.kind !== "verified") {
      const reason = fresh.kind === "unreachable" ? "policy-unreachable" : "policy-unverified";
      this.audit(
        UPDATES_AUDIT_ACTIONS.APPLY,
        "denied",
        reason === "policy-unreachable" ? "POLICY_UNREACHABLE" : "POLICY_UNVERIFIED",
        { version, ...(fresh.kind === "refused" ? { state: fresh.state } : {}) },
      );
      this.setState({ ...this.stagedOf(version), blockedBy: reason });
      await apply.notify(
        policyNotice({ kind: reason === "policy-unreachable" ? "unreachable" : "unverified" }),
      );
      return { ok: false, reason };
    }
    this.lastVerified = fresh.chain;
    const policy = leversOf(fresh.chain.policy);
    const lever = leverRefusal(version, policy, this.options.hostOsVersion?.() ?? null);
    if (lever !== null) {
      this.refuseByLever(version, lever, UPDATES_AUDIT_ACTIONS.APPLY);
      await apply.notify(
        policyNotice(
          lever === "killed"
            ? { kind: "killed", channel: this.channel }
            : lever === "yanked"
              ? { kind: "yanked", version }
              : { kind: "floor-unmet", version, floor: policy.floors.os ?? "" },
        ),
      );
      return { ok: false, reason: lever };
    }

    // B3 — the planes, by digest, from the same fresh chain
    const native = (await this.judgeNative(fresh.chain, version)).touched;
    let sessions: readonly string[] = [];
    if (native) {
      const snapshot = await this.readCensus();
      if (!snapshot.known) {
        this.audit(UPDATES_AUDIT_ACTIONS.APPLY, "denied", "CENSUS_UNKNOWN", { version });
        return { ok: false, reason: "census-unknown" };
      }
      if (snapshot.sessions.length > 0) {
        const consented = await apply.confirm(consentBox(version, snapshot.sessions));
        if (!consented) return { ok: false, reason: "consent-declined" };
      }
      sessions = snapshot.sessions.map((session) => session.sessionId);
    }
    const operationId = randomUUID();
    await this.auditAttempt(operationId, {
      version,
      consented: String(sessions.length),
      native: native ? "stop" : "keep",
    });
    if (!apply.quitForUpdate(this.updatePlan(apply, version, sessions, operationId, native))) {
      return { ok: false, reason: "quit-underway" };
    }
    return { ok: true };
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

  /** A lever refused a version (B1): audited, and the state says it — a kill holds a staged update (a later policy may
   * lift it) and reads `killed` otherwise; a yank or an unmet floor forgets a staged one, never installed. */
  private refuseByLever(version: string, lever: LeverRefusal, action: string): void {
    this.audit(action, "denied", LEVER_CODE[lever], { version });
    this.options.log.warn("desktop.update.lever", "The update policy refused a version", {
      version,
      lever,
      channel: this.channel,
    });
    const state = this.stateValue;
    if (lever === "killed" && state.kind === "staged") {
      this.setState({ ...this.stagedOf(version), blockedBy: "killed" });
      return;
    }
    if (lever === "yanked") {
      // B6 (L3b-ii) empties electron-updater's pending cache; until then a discarded payload stays on disk, never
      // installed (install-on-quit is off, and every check refuses it again)
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
  ): UpdateQuitPlan {
    const consented = sessions.length;
    return {
      prepare: async (): Promise<UpdatePrepared> => {
        const stopped = await apply.stopDaemons(sessions, version, native);
        if (!stopped.ok) return { kind: "abort", reason: stopped.reason };
        // The daemons are down. From here every branch exits, and nothing may reach fieldd (that would START it).
        this.daemonsStopped = true;
        const staged = await apply.stage(SQUIRREL_STAGE_MS);
        if (staged.kind === "staged") {
          this.recordLastApply({ version, branch: "installing", consented, operationId });
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
        });
        await apply.notify(quitNotice("squirrel-timeout"));
        return { kind: "exit", relaunch: false, reason: "squirrel-timeout" };
      },
      install: () => apply.install(),
      aborted: (reason) => {
        // before the stop: fieldd lives, so this outcome reaches the ledger now
        this.audit(UPDATES_AUDIT_ACTIONS.APPLY, "denied", "SESSIONS_CHANGED", { version, reason });
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
      : { kind: "staged", version, stagedAt: this.now() };
  }

  /** WP12c — synchronous, before every exit the apply takes (the store writes atomically and at once). */
  private recordLastApply(entry: {
    version: string;
    branch: "installing" | "relaunched" | "exited";
    reason?: "squirrel-refused" | "squirrel-timeout" | "install-failed";
    consented: number;
    operationId: string;
  }): void {
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
        attrs: { version: last.version, branch: last.branch, consented: String(last.consented) },
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
    this.cancelDownload();
    this.options.updater.removeListener("download-progress", this.onProgress);
    this.options.updater.removeListener("error", this.onError);
    this.listeners.clear();
  }

  private async verify(fetch: FetchBytes): Promise<ChainResult> {
    const result = await verifyUpdateChain({
      origin: this.options.origin,
      channel: this.channel,
      rootKeys: this.options.rootKeys,
      remembered: this.client.remembered,
      ...(this.options.floors !== undefined ? { floors: this.options.floors } : {}),
      now: this.now(),
      feedFile: this.options.feedFile,
      fetch,
    });
    // every ACCEPTED document is remembered, even when a later step refused (TD-10)
    this.persist({ ...this.client, remembered: result.remembered });
    return result;
  }

  private async startDownload(version: string): Promise<void> {
    const token = this.options.newCancellationToken();
    this.download = token;
    this.setState({ kind: "downloading", version, percent: 0 });
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
    this.setState({ kind: "staged", version, stagedAt: this.now() });
    // B3 — the verdict from the chain that found this version (its head IS the staged one, or it reads touched)
    await this.judgeNative(this.lastVerified, version);
    if (this.options.apply?.wired === true) {
      // WP12c — the census decides what the tray offers (the verb, the consent, or a hold)
      await this.readCensus();
      return;
    }
    this.settleStaged();
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

  private audit(
    action: string,
    outcome: "denied" | "succeeded" | "failed",
    reasonCode?: string,
    attrs?: Record<string, string>,
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
      operationId: randomUUID(),
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
    for (const listener of this.listeners) listener(next);
  }
}
