// WP12b (EDP §11.1–§11.3, §11.6; build-wp12-updater.md §4) — the UpdateController: one owner of the update state in
// Electron main. It runs only in a packaged app (the wiring decides), keeps ONE check or download in flight, maps every
// failure to a bounded code (no remote text in privileged UI), persists the person's choices and TD-10's remembered
// versions, and appends refusals and declines to the audit ledger (TD §4).
//
// What L1 (WP12b) deliberately does not do: APPLY. electron-updater's `autoInstallOnAppQuit` defaults to true, which
// would install a staged update on any quit, past EDP-35's census gate; it is forced off here, and a staged update is
// HELD (`apply-unbuilt`) until WP12c wires the gate and `restartToInstall`.

import { randomUUID } from "node:crypto";
import {
  UPDATES_AUDIT_ACTIONS,
  UPDATES_SERVICE,
  type UpdateChannel,
  type UpdatesUnavailableState,
} from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import { decideUpdate, type UpdateAction, type UpdateTrigger } from "./decide";
import { UpdateRefusal } from "./refusal";
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
      readonly blockedBy?: "sessions" | "apply-unbuilt";
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
  /** EDP-33/35: VibeField-hosted live sessions. 0 until WP12c reads the terminal inventory. */
  readonly census?: () => number;
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
    return decideUpdate(this.stateValue, this.options.census?.() ?? 0, {
      trigger,
      enabled: this.enabled,
      lastCheckAt: this.client.lastCheckAt,
      now: this.now(),
      staleMs: this.options.staleMs ?? SIX_HOURS,
      declined: this.client.declined,
      applyWired: false,
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
    if (this.recovered !== null) {
      lines.push(
        `the update state was unreadable at ${new Date(this.recovered.at).toISOString()}; moved aside to ${this.recovered.movedAside}; restarted from the build's floor`,
      );
    }
    return lines;
  }

  /** WP12c wires the apply through the one census-aware gate (EDP-35). Until then: honestly refused. */
  async restartToInstall(): Promise<{ ok: false; reason: "apply-unbuilt" }> {
    return { ok: false, reason: "apply-unbuilt" };
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
    const next = this.decide("downloaded");
    if (next.kind === "hold")
      this.setState({ kind: "staged", version, stagedAt: this.now(), blockedBy: next.reason });
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
    if (append === undefined) return;
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
