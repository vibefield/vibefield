import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, type WorkerOptions } from "node:worker_threads";
import {
  LOG_TRANSPORT_LIMITS,
  PLUGIN_LIMITS,
  type PluginManifestV1,
  type PluginRecord,
  type PublicEntryState,
  SCOPES,
  type Scope,
  validatePluginManifest,
} from "@vibefield/contracts";
import { createBoundedLineFramer, createNoopLogger, type Logger } from "@vibefield/logging";
import {
  type ActivationCloseReason,
  type ActivationScope,
  projectPluginAuthority,
  type RuntimeTargetCandidate,
  RuntimeTargetController,
  type ServiceRuntimeTarget,
  samePluginRuntimeObservation,
  samePluginRuntimeTarget,
} from "@vibefield/plugin-runtime";
import type { PluginRegistryCandidate, PluginRegistryService } from "./plugin-registry";
import type {
  ServiceCallerInfo,
  ServiceProviderCandidate,
  ServiceRegistry,
} from "./service-registry";
import type { TokenGrant, TokenService } from "./token-service";

// ServiceHost (plugin spec §14.2/§18, P4): one worker thread per plugin
// service entry, host-owned harness, §10.4 deadlines, the §18.3 crash ladder,
// §18.2 deactivation order. The worker gets a plugin-bound product lease and a
// MINIMAL env (EL7 — daemon secrets never enter plugin runtimes); handlers
// stay worker-side, only metadata and calls cross the port.
//
// The host re-reads + re-validates the plugin's manifest at start (a local
// file the daemon already trusts paths for): PluginRecord is the SANITIZED
// public row and deliberately carries no entry paths — the host is
// daemon-internal and may know them.

export interface ServiceLeaseObservation {
  readonly manifestHash: string;
  readonly grantGeneration: number;
  readonly authorityFingerprint: string;
}

export interface ServiceHostConfig {
  registry: ServiceRegistry;
  plugins: PluginRegistryService;
  tokens: TokenService;
  /** the bound product port (workers dial loopback with their lease) */
  controlPort: () => number;
  /** exact service-instance key; production supplies the durable local device id */
  deviceId?: () => string;
  /** override for the bundled daemon (bin.cjs cannot use import.meta) */
  harnessPath?: string;
  /** test seams — production defaults are the §10.4 PLUGIN_LIMITS */
  deadlines?: { activateMs?: number; deactivateMs?: number };
  /** PRC-2 protocol seam: production constructs a real worker thread. */
  workerFactory?: (harnessPath: string, options: WorkerOptions) => Worker;
  /** test seam — production defaults are the §18.3 ladder constants */
  ladder?: { baseMs?: number; maxMs?: number; windowMs?: number; quarantineAt?: number };
  /** LOG-L6 authority seam: production mints service leases through audit. */
  mintServiceLease?: (
    pluginId: string,
    scopes: Scope[],
    observation: ServiceLeaseObservation,
  ) => Promise<TokenGrant>;
  /** LOG-L6 authority seam: crash/stop revocation is audited by safe token ID. */
  revokeServiceLease?: (pluginId: string, tokenId: string, reason: string) => Promise<void>;
  logger?: Logger;
  pluginLog?: (record: PluginServiceLogRecord) => void;
}

export interface PluginServiceLogRecord {
  pluginId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  fields?: Readonly<Record<string, unknown>>;
  event?: "plugin.log" | "plugin.output";
}

interface Entry {
  state: PublicEntryState;
  worker: Worker | null;
  /** registry unregister fns for this plugin's live providers */
  unregisters: Map<string, () => void>;
  /** declaration-validated provider bindings stay unavailable until the worker activation commit */
  providerCandidates: Map<string, ServiceProviderCandidate>;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  sinks: Map<
    number,
    {
      snapshot(v: unknown): void;
      delta(v: unknown): void;
      end(e?: { kind: string; message: string }): void;
    }
  >;
  crashTimes: number[];
  restartTimer: NodeJS.Timeout | null;
  /** deliberate teardown in progress — an exit is not a crash */
  stopping: boolean;
  routeState: "withdrawn" | "activating" | "active" | "draining";
  stopTask: Promise<void> | null;
  pendingChanged: Set<() => void>;
  /** Invalidates async start work before a worker generation exists (manifest read / lease mint). */
  startEpoch: number;
  generation: number;
  detachOutput: (() => void) | null;
  leaseTokenId: string | null;
  leaseRelease: Promise<void> | null;
  controller: RuntimeTargetController<ServiceRuntimeTarget, ServiceWorkerCandidate>;
  credentialWaiters: Map<
    number,
    {
      worker: Worker;
      generation: number;
      grantGeneration: number;
      resolve(): void;
      reject(error: Error): void;
    }
  >;
}

interface ServiceWorkerCandidate extends RuntimeTargetCandidate {
  readonly target: ServiceRuntimeTarget;
  readonly worker: Worker;
  readonly generation: number;
  leaseTokenId: string | null;
  readonly updateEpisode?: ServiceCandidateEpisode;
  invalidateCredential(grantGeneration: number): void;
}

interface ServiceActivationSource {
  readonly record: PluginRecord;
  readonly manifest: PluginManifestV1;
  readonly root: string;
  readonly updateEpisode?: ServiceCandidateEpisode;
}

interface ServiceCandidateEpisode {
  readonly updateId: string;
  readonly pluginId: string;
  readonly baseInstallRevision: string | null;
  readonly baseObservationFingerprint: string;
  readonly source: ServiceActivationSource;
  readonly target: ServiceRuntimeTarget;
  state: "prepared" | "committed" | "disposed";
}

export interface PreparedServiceCandidate {
  readonly updateId: string;
  readonly pluginId: string;
  readonly target: ServiceRuntimeTarget;
  /** Synchronous provider publication at the logical commit edge. */
  commit(): void;
  /** Pre-commit candidate teardown. */
  discard(): Promise<void>;
  /** Drop episode authority after a committed worker has been adopted live. */
  release(): void;
}

export class ServiceHost {
  private readonly entries = new Map<string, Entry>();
  private readonly candidateEpisodes = new Map<string, ServiceCandidateEpisode>();
  private nextCallId = 1;
  private nextDeactivationId = 1;
  private nextCredentialId = 1;
  private disposed = false;
  private readonly logger: Logger;

  constructor(private readonly cfg: ServiceHostConfig) {
    this.logger = cfg.logger ?? createNoopLogger();
  }

  private entry(pluginId: string): Entry {
    let e = this.entries.get(pluginId);
    if (e === undefined) {
      let created!: Entry;
      const controller = new RuntimeTargetController<ServiceRuntimeTarget, ServiceWorkerCandidate>(
        `service:${pluginId}:${this.cfg.deviceId?.() ?? "local"}`,
        {
          activate: (target, scope, signal) =>
            this.activateTarget(pluginId, created, target, scope, signal),
          refresh: (candidate, _previous, next, signal) =>
            this.refreshCandidate(pluginId, created, candidate, next, signal),
          termination: {
            kind: "worker",
            force: (reason) => this.forceEntry(created, reason),
          },
          activationDeadlineMs:
            this.cfg.deadlines?.activateMs ?? PLUGIN_LIMITS.SERVICE_ACTIVATE_DEADLINE_MS,
          // Candidate disposal owns PRC-2's exact route/call/cleanup deadline. Give that disposer
          // one scheduling turn to report before the outer controller asks for boundary force.
          disposalDeadlineMs:
            (this.cfg.deadlines?.deactivateMs ?? PLUGIN_LIMITS.DEACTIVATE_DEADLINE_MS) + 25,
        },
      );
      created = {
        state: "none",
        worker: null,
        unregisters: new Map(),
        providerCandidates: new Map(),
        pending: new Map(),
        sinks: new Map(),
        crashTimes: [],
        restartTimer: null,
        stopping: false,
        routeState: "withdrawn",
        stopTask: null,
        pendingChanged: new Set(),
        startEpoch: 0,
        generation: 0,
        detachOutput: null,
        leaseTokenId: null,
        leaseRelease: null,
        controller,
        credentialWaiters: new Map(),
      };
      e = created;
      this.entries.set(pluginId, e);
    }
    return e;
  }

  state(pluginId: string): PublicEntryState {
    return this.entries.get(pluginId)?.state ?? "none";
  }

  /** start every enabled plugin whose manifest declares entries.service and
   * activation onStartup (§18.6 — restart activates only demanded services) */
  async startEligible(): Promise<void> {
    for (const record of this.cfg.plugins.list()) {
      if (!record.enabled) continue;
      const manifest = await this.readManifest(record.id);
      if (manifest === null || manifest.entries?.service === undefined) continue;
      if (!manifest.activation.includes("onStartup")) continue;
      await this.start(record.id).catch((e) => {
        this.logger.error(
          "fieldd.plugin_service.startup_activation_failed",
          "Plugin service startup activation failed",
          e,
          { pluginId: record.id },
        );
      });
    }
  }

  /** explicit (re)start — clears crash history (user re-enable clears quarantine, §18.3) */
  async restartFresh(pluginId: string): Promise<void> {
    const e = this.entry(pluginId);
    e.crashTimes = [];
    if (e.restartTimer !== null) {
      clearTimeout(e.restartTimer);
      e.restartTimer = null;
    }
    if (e.controller.state === "failed")
      e.controller.retry({ kind: "manual", detail: "explicit service restart" });
    await this.start(pluginId);
  }

  /** PRC-5c: break from the live service target, activate the explicit
   * immutable candidate, and hold every provider behind its private commit
   * edge. The live registry pointer may still name the old artifact. */
  async prepareCandidate(input: {
    updateId: string;
    baseInstallRevision: string | null;
    candidate: PluginRegistryCandidate;
  }): Promise<PreparedServiceCandidate | null> {
    if (!/^pupd_[A-Za-z0-9_-]+$/.test(input.updateId) || input.updateId.length > 128)
      throw new Error("invalid plugin update id");
    const { record, manifest, root, artifactSha256 } = input.candidate;
    if (
      !/^sha256:[0-9a-f]{64}$/.test(artifactSha256) ||
      manifest.id !== record.id ||
      record.installRevision !== artifactSha256.slice("sha256:".length)
    ) {
      throw new Error(`${record.id}: candidate service identity does not match its artifact`);
    }
    if (!record.enabled || record.service === "none") return null;
    if (manifest.entries?.service === undefined)
      throw new Error(`${record.id}: candidate service row has no service manifest entry`);
    if (this.candidateEpisodes.has(record.id))
      throw new Error(`${record.id}: a candidate service episode already exists`);
    if ([...this.candidateEpisodes.values()].some((episode) => episode.updateId === input.updateId))
      throw new Error(`${input.updateId}: candidate service episode already exists`);
    const current = this.cfg.plugins.get(record.id);
    const actualBase = current?.installRevision ?? null;
    if (actualBase !== input.baseInstallRevision) {
      throw new Error(
        `${record.id}: candidate service base is stale; expected ${input.baseInstallRevision ?? "absent"}, found ${actualBase ?? "absent"}`,
      );
    }
    const target = this.serviceTargetForRecord(record);
    if (target === null) return null;
    const source = { record, manifest, root };
    const episode: ServiceCandidateEpisode = {
      updateId: input.updateId,
      pluginId: record.id,
      baseInstallRevision: input.baseInstallRevision,
      baseObservationFingerprint: serviceRecordFingerprint(current),
      source,
      target,
      state: "prepared",
    };
    this.candidateEpisodes.set(record.id, episode);
    const e = this.entry(record.id);
    try {
      e.controller.prepareDesired(target, {
        reason: { kind: "reload", detail: input.updateId },
      });
      const settled = await e.controller.settle({ deadlineMs: this.controllerSettleDeadline() });
      if (
        settled.state !== "prepared" ||
        !samePluginRuntimeObservation(settled.desired, target) ||
        e.controller.preparedCandidate === undefined
      ) {
        throw new Error(
          `${record.id}: candidate service did not reach private readiness (${settled.state})`,
        );
      }
    } catch (error) {
      await this.discardServiceEpisode(episode).catch(() => undefined);
      throw error;
    }

    const handle: PreparedServiceCandidate = {
      updateId: input.updateId,
      pluginId: record.id,
      target,
      commit: () => {
        if (episode.state === "committed") return;
        if (episode.state !== "prepared")
          throw new Error(`${input.updateId}: candidate service episode is disposed`);
        if (
          serviceRecordFingerprint(this.cfg.plugins.get(record.id)) !==
          serviceRecordFingerprint(episode.source.record)
        ) {
          throw new Error(`${record.id}: stale service candidate cannot commit`);
        }
        const snapshot = e.controller.commitPrepared();
        if (!samePluginRuntimeObservation(snapshot.committed, target))
          throw new Error(`${input.updateId}: candidate service did not commit its exact target`);
        episode.state = "committed";
      },
      discard: async () => await this.discardServiceEpisode(episode),
      release: () => {
        if (episode.state !== "committed")
          throw new Error(`${input.updateId}: only a committed service episode can release`);
        if (this.candidateEpisodes.get(record.id) === episode)
          this.candidateEpisodes.delete(record.id);
      },
    };
    return Object.freeze(handle);
  }

  async start(pluginId: string): Promise<void> {
    if (this.disposed) return;
    const updateEpisode = this.candidateEpisodes.get(pluginId);
    if (updateEpisode?.state === "prepared")
      throw new Error(`${pluginId}: candidate update ${updateEpisode.updateId} owns the service`);
    const e = this.entry(pluginId);
    if (e.stopTask !== null) await e.stopTask;
    if (this.disposed) return;
    if (e.state === "quarantined" && e.crashTimes.length > 0) return; // §18.3 — user clear required
    const target = this.serviceTarget(pluginId);
    if (target === null) {
      e.controller.setDesired(null);
      await e.controller.settle({ deadlineMs: this.controllerSettleDeadline() });
      return;
    }

    const committed = e.controller.committed;
    if (
      committed !== null &&
      samePluginRuntimeTarget(committed, target) &&
      !samePluginRuntimeObservation(committed, target)
    ) {
      // The registry observation is already authoritative. Prevent the old product credential from
      // doing new work while the serialized refresh mints and acknowledges its replacement.
      e.controller.activeCandidate?.invalidateCredential(target.observedGrantGeneration);
    }
    e.stopping = false;
    e.controller.setDesired(target);
    const snapshot = await e.controller.settle({ deadlineMs: this.controllerSettleDeadline() });
    if (!samePluginRuntimeObservation(e.controller.desired, target)) return;
    if (samePluginRuntimeObservation(snapshot.committed, target)) return;
    if (snapshot.state === "non-quiescent") {
      this.setState(pluginId, e, "degraded");
      throw new Error(`${pluginId}: prior service target did not quiesce`);
    }
    if (snapshot.state === "failed") {
      this.setState(pluginId, e, "degraded");
      throw new Error(`${pluginId}: ${snapshot.error ?? "service activation failed"}`);
    }
  }

  private async activateTarget(
    pluginId: string,
    e: Entry,
    target: ServiceRuntimeTarget,
    _scope: ActivationScope,
    signal: AbortSignal,
  ): Promise<ServiceWorkerCandidate> {
    if (this.disposed || signal.aborted) throw new Error(`${pluginId}: service target superseded`);
    const startEpoch = ++e.startEpoch;
    e.stopping = false;
    let boundaryWorker: Worker | null = null;
    let candidateReturned = false;
    signal.addEventListener(
      "abort",
      () => {
        e.startEpoch += 1;
        e.stopping = true;
        this.beginRouteDrain(pluginId, e);
        if (!candidateReturned && boundaryWorker !== null) void boundaryWorker.terminate();
      },
      { once: true },
    );

    const source = await this.resolveActivationSource(pluginId, target);
    if (!this.isCurrentTarget(pluginId, e, startEpoch, target, signal))
      throw new Error(`${pluginId}: service target superseded while reading its manifest`);
    if (source === null) throw new Error(`${pluginId}: service activation source is unavailable`);
    const { record, root, manifest, updateEpisode } = source;
    const entryRel = manifest?.entries?.service;
    if (entryRel === undefined) throw new Error(`${pluginId}: service entry is unavailable`);
    const entryPath = resolve(join(root, entryRel));
    if (!entryPath.startsWith(`${resolve(root)}${sep}`)) {
      this.setActivationState(pluginId, e, "quarantined", updateEpisode);
      this.logger.error(
        "fieldd.plugin_service.entry_path_rejected",
        "Plugin service entry escaped its plugin root and was refused",
        undefined,
        { pluginId },
      );
      throw new Error(`${pluginId}: service entry escaped its plugin root`);
    }

    const generation = ++e.generation;
    e.routeState = "activating";
    this.setActivationState(pluginId, e, "activating", updateEpisode);

    const authority = projectPluginAuthority("service", record.grantedCapabilities);
    const scopes = authority.capabilities.filter((capability): capability is Scope =>
      // TokenService accepts only contract core scopes. Custom x.* authority remains in the
      // target fingerprint and is enforced by the service fabric rather than the bearer.
      (SCOPES as readonly string[]).includes(capability),
    );
    const leaseObservation: ServiceLeaseObservation = {
      manifestHash: target.artifact.manifestHash,
      grantGeneration: target.observedGrantGeneration,
      authorityFingerprint: target.authorityFingerprint,
    };
    await e.leaseRelease;
    e.leaseRelease = null;
    if (!this.isCurrentTarget(pluginId, e, startEpoch, target, signal))
      throw new Error(`${pluginId}: service target superseded before lease mint`);
    let lease: TokenGrant;
    try {
      lease =
        this.cfg.mintServiceLease !== undefined
          ? await this.cfg.mintServiceLease(pluginId, scopes, leaseObservation)
          : this.cfg.tokens.mint(scopes, `plugin:${pluginId}:service`, { pluginId });
    } catch (error) {
      if (!this.isCurrentTarget(pluginId, e, startEpoch, target, signal))
        throw new Error(`${pluginId}: service target superseded during lease mint`);
      e.routeState = "withdrawn";
      this.setActivationState(pluginId, e, "degraded", updateEpisode);
      throw error;
    }
    if (!this.isCurrentTarget(pluginId, e, startEpoch, target, signal)) {
      await this.releaseLeaseToken(pluginId, lease.tokenId, "service-start-superseded");
      throw new Error(`${pluginId}: service target superseded after lease mint`);
    }
    e.leaseTokenId = lease.tokenId;

    const harness =
      // fileURLToPath, not `.pathname`: on Windows `.pathname` is `/C:/…/harness.mjs`
      // (a leading-slash drive path) that new Worker cannot load, so the service
      // never activates and every `until(active)` times out. fileURLToPath yields
      // the native path on both platforms.
      this.cfg.harnessPath ??
      fileURLToPath(new URL("./service-worker-harness.mjs", import.meta.url));
    let worker: Worker;
    try {
      const options: WorkerOptions = {
        workerData: {
          pluginId,
          version: record.version,
          entryPath,
          leaseUrl: `ws://127.0.0.1:${this.cfg.controlPort()}`,
          leaseToken: lease.token,
          scopes: lease.scopes, // presence-gates ctx.settings/storage (§10.2)
          logLimits: {
            recordBytes: LOG_TRANSPORT_LIMITS.PLUGIN_RECORD_BYTES,
            messageBytes: LOG_TRANSPORT_LIMITS.PLUGIN_MESSAGE_BYTES,
            stringBytes: LOG_TRANSPORT_LIMITS.PLUGIN_STRING_BYTES,
            objectDepth: LOG_TRANSPORT_LIMITS.PLUGIN_OBJECT_DEPTH,
            objectKeys: LOG_TRANSPORT_LIMITS.PLUGIN_OBJECT_KEYS,
            arrayItems: LOG_TRANSPORT_LIMITS.PLUGIN_ARRAY_ITEMS,
          },
        },
        env: {}, // EL7 — a minimal environment, daemon secrets stripped
        // a CLEAN node CLI for the worker: no inherited loaders/debug flags
        // (vitest's tinypool execArgv otherwise leaks in and wedges module
        // loading; production hygiene wants this anyway)
        execArgv: [],
        // worker stdio flows through the HOST's log surface — a dying worker's
        // last words must never vanish into a parent runner's void (§23)
        stdout: true,
        stderr: true,
      };
      worker = this.cfg.workerFactory?.(harness, options) ?? new Worker(harness, options);
    } catch (error) {
      e.routeState = "withdrawn";
      await this.releaseServiceLease(pluginId, e, "worker-construction-failed");
      this.setActivationState(pluginId, e, "degraded", updateEpisode);
      throw error;
    }
    e.detachOutput?.();
    e.detachOutput = this.capturePluginOutput(worker, pluginId);
    e.worker = worker;
    boundaryWorker = worker;

    const declarations = manifest.contributes?.services ?? [];

    await new Promise<void>((resolveActivate, rejectActivate) => {
      let settled = false;
      let providerError: unknown;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      worker.on("message", (msg: Record<string, unknown>) => {
        if (e.generation !== generation) return; // a stale worker's echo
        switch (msg["t"]) {
          case "activated":
            if (e.stopping || e.routeState === "draining") {
              finish(() => rejectActivate(new Error(`${pluginId}: deactivated during activation`)));
              return;
            }
            if (
              providerError !== undefined ||
              new Set(declarations.map((declaration) => declaration.namespace)).size !==
                e.providerCandidates.size
            ) {
              finish(() => {
                this.beginRouteDrain(pluginId, e);
                void worker.terminate();
                this.setActivationState(pluginId, e, "degraded", updateEpisode);
                rejectActivate(
                  providerError instanceof Error
                    ? providerError
                    : new Error(
                        `${pluginId}: service activation did not provide every declaration`,
                      ),
                );
              });
              return;
            }
            finish(resolveActivate);
            return;
          case "activate-failed":
            finish(() => {
              this.beginRouteDrain(pluginId, e);
              void worker.terminate();
              this.setActivationState(pluginId, e, "degraded", updateEpisode);
              rejectActivate(
                new Error(
                  `${pluginId}: ${(msg["error"] as { message?: string } | undefined)?.message ?? "activation failed"}`,
                ),
              );
            });
            return;
          case "provide": {
            if (e.stopping || e.routeState === "draining" || e.routeState === "withdrawn") return;
            try {
              const namespace = String(msg["namespace"]);
              const nsDecls = declarations.filter((s) => s.namespace === namespace);
              const candidate = this.cfg.registry.stage({
                pluginId,
                namespace,
                declarations: nsDecls.flatMap((s) => s.methods),
                implemented: msg["implemented"] as Array<{
                  name: string;
                  kind: "query" | "mutation" | "subscription";
                }>,
                handlers: this.portHandlers(pluginId, e, namespace, worker, generation),
              });
              e.providerCandidates.set(namespace, candidate);
            } catch (err) {
              providerError ??= err;
              this.logger.error(
                "fieldd.plugin_service.provide_rejected",
                "Plugin service provider registration was refused",
                err,
                { pluginId },
              );
            }
            return;
          }
          case "unprovide": {
            const namespace = String(msg["namespace"]);
            // A draining generation has already withdrawn public ingress while retaining a typed
            // tombstone. Its worker-side ownership inverse is cleanup confirmation, not a second
            // route transition; final withdrawPlugin retires the tombstone after teardown.
            if (e.routeState !== "draining") {
              e.providerCandidates.get(namespace)?.dispose();
              e.providerCandidates.delete(namespace);
            }
            e.unregisters.delete(namespace);
            return;
          }
          case "result": {
            const id = msg["id"] as number;
            const waiter = e.pending.get(id);
            e.pending.delete(id);
            this.notifyPendingChanged(e);
            if (waiter === undefined) return;
            if (msg["ok"] === true) waiter.resolve(msg["value"]);
            else {
              const err = msg["error"] as { message?: string } | undefined;
              waiter.reject(new Error(err?.message ?? "provider error"));
            }
            return;
          }
          case "sub-snapshot":
            e.sinks.get(msg["id"] as number)?.snapshot(msg["value"]);
            return;
          case "sub-delta":
            e.sinks.get(msg["id"] as number)?.delta(msg["value"]);
            return;
          case "sub-end": {
            const id = msg["id"] as number;
            e.sinks.get(id)?.end(msg["error"] as { kind: string; message: string } | undefined);
            e.sinks.delete(id);
            return;
          }
          case "credential-rotated": {
            const requestId = msg["requestId"] as number;
            const waiter = e.credentialWaiters.get(requestId);
            if (
              waiter === undefined ||
              waiter.worker !== worker ||
              waiter.generation !== generation ||
              waiter.grantGeneration !== msg["grantGeneration"]
            )
              return;
            e.credentialWaiters.delete(requestId);
            waiter.resolve();
            return;
          }
          case "log": {
            const level = msg["level"];
            if (level !== "debug" && level !== "info" && level !== "warn" && level !== "error") {
              this.logger.warn(
                "fieldd.plugin_service.log_rejected",
                "Plugin service emitted an invalid log level",
                { pluginId, reason: "level" },
              );
              return;
            }
            const message =
              typeof msg["message"] === "string"
                ? msg["message"]
                : "[plugin emitted a non-string log message]";
            const fields = msg["fields"];
            this.cfg.pluginLog?.({
              pluginId,
              level,
              message,
              ...(fields !== null && typeof fields === "object" && !Array.isArray(fields)
                ? { fields: fields as Record<string, unknown> }
                : {}),
              event: "plugin.log",
            });
            return;
          }
          default:
            return;
        }
      });

      worker.on("error", (err) => {
        if (e.generation !== generation) return;
        this.beginRouteDrain(pluginId, e);
        this.logger.error(
          "fieldd.plugin_service.worker_failed",
          "Plugin service worker emitted an error",
          err,
          { pluginId },
        );
        finish(() => rejectActivate(err)); // pre-activation error path
      });

      worker.on("exit", (code) => {
        if (e.generation !== generation) return;
        e.detachOutput?.();
        e.detachOutput = null;
        e.worker = null;
        this.rejectCredentialWaiters(e, worker, generation, "service worker exited");
        void this.releaseServiceLease(pluginId, e, "worker-exit");
        this.failAllInflight(e, "provider gone");
        for (const provider of e.providerCandidates.values()) provider.dispose();
        e.providerCandidates.clear();
        this.cfg.registry.withdrawPlugin(pluginId);
        e.unregisters.clear();
        e.routeState = "withdrawn";
        if (e.stopping || this.disposed) {
          finish(() => rejectActivate(new Error(`${pluginId}: deactivated during activation`)));
          return;
        }
        finish(() =>
          rejectActivate(new Error(`${pluginId}: worker exited (${code}) during activation`)),
        );
        if (updateEpisode?.state === "prepared") {
          e.state = "degraded";
          e.controller.setDesired(null, {
            reason: { kind: "crash", detail: updateEpisode.updateId },
          });
        } else {
          this.onCrash(pluginId, e);
        }
      });
    });

    const candidate: ServiceWorkerCandidate = {
      target,
      worker,
      generation,
      leaseTokenId: lease.tokenId,
      ...(updateEpisode === undefined ? {} : { updateEpisode }),
      commit: () => {
        if (!this.isCurrentTarget(pluginId, e, startEpoch, target, signal))
          throw new Error(`${pluginId}: stale service candidate cannot commit`);
        // Handlers must accept work before the registry emits its synchronous availability event.
        // Until this exact edge every staged method answers typed UNAVAILABLE.
        e.routeState = "active";
        for (const [namespace, provider] of e.providerCandidates) {
          provider.commit();
          e.unregisters.set(namespace, () => provider.dispose());
        }
        if (!this.isCurrentTarget(pluginId, e, startEpoch, target, signal))
          throw new Error(`${pluginId}: service candidate changed during provider commit`);
        this.setState(pluginId, e, "active");
        this.logger.info("fieldd.plugin_service.activated", "Plugin service worker activated", {
          pluginId,
        });
      },
      dispose: () => this.stopCandidate(pluginId, e, candidate),
      invalidateCredential: (grantGeneration) => {
        if (e.worker !== worker || e.generation !== generation) return;
        try {
          worker.postMessage({ t: "credential-invalidate", grantGeneration });
        } catch {
          // The controller's refresh/termination paths will observe the lost worker boundary.
        }
      },
    };
    candidateReturned = true;
    return candidate;
  }

  /** §18.3 — degraded → backoff restart; 3 crashes in the window → quarantine */
  private onCrash(pluginId: string, e: Entry): void {
    e.controller.setDesired(null, { reason: { kind: "crash", detail: pluginId } });
    const now = Date.now();
    const windowMs = this.cfg.ladder?.windowMs ?? 600_000;
    const quarantineAt = this.cfg.ladder?.quarantineAt ?? 3;
    e.crashTimes = [...e.crashTimes.filter((t) => now - t < windowMs), now];
    if (e.crashTimes.length >= quarantineAt) {
      this.setState(pluginId, e, "quarantined");
      this.logger.error(
        "fieldd.plugin_service.quarantined",
        "Plugin service was quarantined after repeated crashes",
        undefined,
        { pluginId, crashCount: e.crashTimes.length },
      );
      return;
    }
    this.setState(pluginId, e, "restarting");
    const baseMs = this.cfg.ladder?.baseMs ?? 1_000;
    const maxMs = this.cfg.ladder?.maxMs ?? 30_000;
    const backoff = Math.min(baseMs * 2 ** (e.crashTimes.length - 1), maxMs);
    e.restartTimer = setTimeout(() => {
      e.restartTimer = null;
      void this.start(pluginId).catch((err) => {
        this.logger.error(
          "fieldd.plugin_service.restart_failed",
          "Plugin service restart failed",
          err,
          { pluginId },
        );
      });
    }, backoff);
  }

  /** Synchronous PRC-2 ingress edge used by registry-driven disable before its async stop joins. */
  beginDrain(
    pluginId: string,
    reason: ActivationCloseReason = { kind: "disable", detail: pluginId },
  ): void {
    const e = this.entries.get(pluginId);
    if (e === undefined) {
      // A test/alternate host may have registered a provider without a worker entry. It still
      // participates in the common route edge; stop() below can retire it immediately.
      this.cfg.registry.beginDrainPlugin(pluginId);
      return;
    }
    e.startEpoch += 1;
    e.stopping = true;
    e.controller.setDesired(null, { reason });
    if (e.controller.activeCandidate === undefined) this.beginRouteDrain(pluginId, e);
  }

  /** §18.2 deactivation: route drain → admitted-call window → correlated worker cleanup → force. */
  async stop(pluginId: string): Promise<void> {
    const e = this.entries.get(pluginId);
    if (e === undefined) {
      this.cfg.registry.withdrawPlugin(pluginId);
      return;
    }
    if (e.restartTimer !== null) {
      clearTimeout(e.restartTimer);
      e.restartTimer = null;
    }
    if (e.stopTask !== null) return e.stopTask;
    this.beginDrain(pluginId);
    const task = (async () => {
      await e.controller.settle({ deadlineMs: this.controllerSettleDeadline() });
      if (e.controller.desired === null) {
        for (const provider of e.providerCandidates.values()) provider.dispose();
        e.providerCandidates.clear();
        this.cfg.registry.withdrawPlugin(pluginId);
        e.unregisters.clear();
        e.routeState = "withdrawn";
        this.setState(pluginId, e, "inactive");
      }
    })();
    e.stopTask = task;
    try {
      await task;
    } finally {
      if (e.stopTask === task) e.stopTask = null;
    }
  }

  private async stopCandidate(
    pluginId: string,
    e: Entry,
    candidate: ServiceWorkerCandidate,
  ): Promise<void> {
    const worker = candidate.worker;
    const generation = candidate.generation;
    const deadlineMs = this.cfg.deadlines?.deactivateMs ?? PLUGIN_LIMITS.DEACTIVATE_DEADLINE_MS;
    const deadlineAt = Date.now() + deadlineMs;

    if (e.worker === worker && e.generation === generation) {
      const callsDrained = await this.waitForPendingCalls(e, deadlineAt);
      if (!callsDrained) this.failPendingCalls(e, "provider drain deadline exceeded");

      if (e.worker === worker && e.generation === generation) {
        const remaining = Math.max(0, deadlineAt - Date.now());
        if (callsDrained && remaining > 0)
          await this.waitForDeactivation(worker, generation, remaining);
        if (e.worker === worker && e.generation === generation) await worker.terminate();
      }
      e.detachOutput?.();
      e.detachOutput = null;
      if (e.worker === worker) e.worker = null;
    }

    await this.releaseCandidateLease(pluginId, e, candidate, "service-stop");
    this.failAllInflight(e, "provider deactivated");
    for (const provider of e.providerCandidates.values()) provider.dispose();
    e.providerCandidates.clear();
    this.cfg.registry.withdrawPlugin(pluginId);
    e.unregisters.clear();
    e.routeState = "withdrawn";
    // A crash already moved the public entry into restarting/quarantined and owns that state until
    // its backoff or explicit recovery. Cooperative/manual teardown lands inactive instead.
    if (e.state !== "restarting" && e.state !== "quarantined") {
      if (candidate.updateEpisode === undefined || candidate.updateEpisode.state === "committed")
        this.setState(pluginId, e, "inactive");
      else e.state = "inactive";
      this.logger.info("fieldd.plugin_service.deactivated", "Plugin service worker deactivated", {
        pluginId,
      });
    }
  }

  /** One idempotent synchronous route transition for disable/reload/revocation/crash/shutdown. */
  private beginRouteDrain(pluginId: string, e: Entry): void {
    if (e.routeState !== "withdrawn") e.routeState = "draining";
    this.cfg.registry.beginDrainPlugin(pluginId);

    // Established router subscriptions were ended by beginDrainPlugin and their identity-bound
    // releases removed these sink rows. Anything left is a setup race not yet published by the
    // router; terminalize it here and send its exact worker-generation release.
    const worker = e.worker;
    for (const [id, sink] of [...e.sinks]) {
      try {
        sink.end({ kind: "UNAVAILABLE", message: "provider draining" });
      } catch (error) {
        this.logger.warn(
          "fieldd.plugin_service.subscription_terminal_failed",
          "A service subscription sink rejected its drain terminal",
          {
            pluginId,
            subscriptionId: id,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      } finally {
        e.sinks.delete(id);
        try {
          worker?.postMessage({ t: "unsubscribe", id });
        } catch {
          // The worker boundary is already gone; exit/terminate is the release.
        }
      }
    }
  }

  private waitForPendingCalls(e: Entry, deadlineAt: number): Promise<boolean> {
    if (e.pending.size === 0) return Promise.resolve(true);
    const remaining = Math.max(0, deadlineAt - Date.now());
    if (remaining === 0) return Promise.resolve(false);
    return new Promise<boolean>((resolveWait) => {
      let finished = false;
      const finish = (drained: boolean): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        e.pendingChanged.delete(check);
        resolveWait(drained);
      };
      const check = (): void => {
        if (e.pending.size === 0) finish(true);
      };
      const timer = setTimeout(() => finish(false), remaining);
      e.pendingChanged.add(check);
      check();
    });
  }

  private notifyPendingChanged(e: Entry): void {
    for (const notify of [...e.pendingChanged]) notify();
  }

  private failPendingCalls(e: Entry, reason: string): void {
    for (const [, waiter] of e.pending) waiter.reject(new Error(reason));
    e.pending.clear();
    this.notifyPendingChanged(e);
  }

  /** A result/log/delta cannot consume this waiter: only the exact worker and request id can. */
  private waitForDeactivation(
    worker: Worker,
    generation: number,
    deadlineMs: number,
  ): Promise<void> {
    const requestId = this.nextDeactivationId++;
    return new Promise<void>((resolveWait) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("exit", onExit);
        resolveWait();
      };
      const onMessage = (msg: Record<string, unknown>): void => {
        if (
          msg["t"] === "deactivated" &&
          msg["requestId"] === requestId &&
          msg["generation"] === generation
        )
          finish();
      };
      const onExit = (): void => finish();
      const timer = setTimeout(finish, deadlineMs);
      worker.on("message", onMessage);
      worker.on("exit", onExit);
      try {
        worker.postMessage({ t: "deactivate", requestId, generation });
      } catch {
        finish();
      }
    });
  }

  async stopAll(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.entries.keys()].map((id) => this.stop(id)));
  }

  private failAllInflight(e: Entry, reason: string): void {
    this.failPendingCalls(e, reason);
    for (const [, sink] of e.sinks) sink.end({ kind: "UNAVAILABLE", message: reason });
    e.sinks.clear();
  }

  private setState(pluginId: string, e: Entry, state: PublicEntryState): void {
    e.state = state;
    this.cfg.plugins.setServiceEntryState(pluginId, state);
  }

  private setActivationState(
    pluginId: string,
    e: Entry,
    state: PublicEntryState,
    updateEpisode: ServiceCandidateEpisode | undefined,
  ): void {
    if (updateEpisode === undefined || updateEpisode.state === "committed") {
      this.setState(pluginId, e, state);
    } else {
      // A private candidate is not the live registry row's entry state.
      e.state = state;
    }
  }

  private serviceTarget(pluginId: string): ServiceRuntimeTarget | null {
    const record = this.cfg.plugins.get(pluginId);
    return record === undefined ? null : this.serviceTargetForRecord(record);
  }

  private serviceTargetForRecord(record: PluginRecord): ServiceRuntimeTarget | null {
    if (!record.enabled || record.service === "none") return null;
    const authority = projectPluginAuthority("service", record.grantedCapabilities);
    return {
      face: "service",
      pluginId: record.id,
      artifact: {
        // Production PluginRecord always carries both fields. Fallbacks keep narrow host fakes
        // source-compatible without weakening the daemon's real target identity.
        installRevision: record.installRevision ?? `${record.version}:legacy`,
        manifestHash: record.manifestHash ?? `legacy:${record.id}:${record.version}`,
      },
      instanceKey: { deviceId: this.cfg.deviceId?.() ?? "local" },
      authorityFingerprint: authority.fingerprint,
      observedGrantGeneration: record.grantGeneration ?? 0,
    };
  }

  private isCurrentTarget(
    pluginId: string,
    e: Entry,
    startEpoch: number,
    target: ServiceRuntimeTarget,
    signal: AbortSignal,
  ): boolean {
    return (
      !this.disposed &&
      !signal.aborted &&
      !e.stopping &&
      e.startEpoch === startEpoch &&
      samePluginRuntimeObservation(this.authoritativeTarget(pluginId, target), target)
    );
  }

  private authoritativeTarget(
    pluginId: string,
    requested: ServiceRuntimeTarget,
  ): ServiceRuntimeTarget | null {
    const episode = this.candidateEpisodes.get(pluginId);
    if (episode !== undefined && samePluginRuntimeObservation(episode.target, requested)) {
      return this.candidateEpisodeCurrent(episode) ? episode.target : null;
    }
    return this.serviceTarget(pluginId);
  }

  private candidateEpisodeCurrent(episode: ServiceCandidateEpisode): boolean {
    if (episode.state === "disposed") return false;
    const current = this.cfg.plugins.get(episode.pluginId);
    const fingerprint = serviceRecordFingerprint(current);
    const candidate = serviceRecordFingerprint(episode.source.record);
    if (episode.state === "committed") return fingerprint === candidate;
    return fingerprint === episode.baseObservationFingerprint || fingerprint === candidate;
  }

  private async resolveActivationSource(
    pluginId: string,
    target: ServiceRuntimeTarget,
  ): Promise<ServiceActivationSource | null> {
    const episode = this.candidateEpisodes.get(pluginId);
    if (episode !== undefined && samePluginRuntimeObservation(episode.target, target)) {
      return this.candidateEpisodeCurrent(episode)
        ? { ...episode.source, updateEpisode: episode }
        : null;
    }
    const record = this.cfg.plugins.get(pluginId);
    const root = this.cfg.plugins.rootPath(pluginId);
    if (
      record === undefined ||
      root === undefined ||
      !samePluginRuntimeObservation(this.serviceTargetForRecord(record), target)
    ) {
      return null;
    }
    const manifest = await this.readManifestAt(root);
    return manifest === null ? null : { record, root, manifest };
  }

  private async discardServiceEpisode(episode: ServiceCandidateEpisode): Promise<void> {
    if (episode.state === "disposed") return;
    if (episode.state === "committed")
      throw new Error(`${episode.updateId}: committed service candidate cannot be discarded`);
    episode.state = "disposed";
    const e = this.entries.get(episode.pluginId);
    if (e !== undefined) {
      e.controller.setDesired(null, {
        reason: { kind: "reload", detail: `${episode.updateId}:discard` },
      });
      await e.controller.settle({ deadlineMs: this.controllerSettleDeadline() });
    }
    if (this.candidateEpisodes.get(episode.pluginId) === episode)
      this.candidateEpisodes.delete(episode.pluginId);
  }

  private controllerSettleDeadline(): number {
    const activate = this.cfg.deadlines?.activateMs ?? PLUGIN_LIMITS.SERVICE_ACTIVATE_DEADLINE_MS;
    const deactivate = this.cfg.deadlines?.deactivateMs ?? PLUGIN_LIMITS.DEACTIVATE_DEADLINE_MS;
    return activate + deactivate * 2 + 100;
  }

  private async refreshCandidate(
    pluginId: string,
    e: Entry,
    candidate: ServiceWorkerCandidate,
    target: ServiceRuntimeTarget,
    signal: AbortSignal,
  ): Promise<void> {
    const current = (): boolean =>
      !signal.aborted &&
      e.worker === candidate.worker &&
      e.generation === candidate.generation &&
      e.controller.activeCandidate === candidate &&
      samePluginRuntimeTarget(candidate.target, target) &&
      samePluginRuntimeObservation(this.serviceTarget(pluginId), target);
    if (!current()) return;

    await e.leaseRelease;
    e.leaseRelease = null;
    if (!current()) return;
    const record = this.cfg.plugins.get(pluginId);
    if (record === undefined) return;
    const authority = projectPluginAuthority("service", record.grantedCapabilities);
    const scopes = authority.capabilities.filter((capability): capability is Scope =>
      (SCOPES as readonly string[]).includes(capability),
    );
    const observation: ServiceLeaseObservation = {
      manifestHash: target.artifact.manifestHash,
      grantGeneration: target.observedGrantGeneration,
      authorityFingerprint: target.authorityFingerprint,
    };
    let lease: TokenGrant;
    try {
      lease =
        this.cfg.mintServiceLease !== undefined
          ? await this.cfg.mintServiceLease(pluginId, scopes, observation)
          : this.cfg.tokens.mint(scopes, `plugin:${pluginId}:service`, { pluginId });
    } catch (error) {
      if (!current()) return;
      throw error;
    }
    if (!current()) {
      await this.releaseLeaseToken(pluginId, lease.tokenId, "service-refresh-superseded");
      return;
    }

    try {
      await this.rotateWorkerCredential(e, candidate, lease, target, signal);
    } catch (error) {
      await this.releaseLeaseToken(pluginId, lease.tokenId, "service-refresh-failed");
      if (!current()) return;
      throw error;
    }
    if (!current()) {
      candidate.invalidateCredential(target.observedGrantGeneration);
      await this.releaseLeaseToken(pluginId, lease.tokenId, "service-refresh-superseded");
      return;
    }

    const previousTokenId = candidate.leaseTokenId;
    candidate.leaseTokenId = lease.tokenId;
    e.leaseTokenId = lease.tokenId;
    if (previousTokenId !== null)
      await this.releaseLeaseToken(pluginId, previousTokenId, "service-credential-rotated");
  }

  private rotateWorkerCredential(
    e: Entry,
    candidate: ServiceWorkerCandidate,
    lease: TokenGrant,
    target: ServiceRuntimeTarget,
    signal: AbortSignal,
  ): Promise<void> {
    const requestId = this.nextCredentialId++;
    const deadlineMs = this.cfg.deadlines?.activateMs ?? PLUGIN_LIMITS.SERVICE_ACTIVATE_DEADLINE_MS;
    return new Promise<void>((resolveRotation, rejectRotation) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        e.credentialWaiters.delete(requestId);
        if (error === undefined) resolveRotation();
        else rejectRotation(error);
      };
      const onAbort = (): void => finish(new Error("service credential refresh aborted"));
      const timer = setTimeout(
        () => finish(new Error("service worker did not acknowledge credential refresh")),
        deadlineMs,
      );
      signal.addEventListener("abort", onAbort, { once: true });
      e.credentialWaiters.set(requestId, {
        worker: candidate.worker,
        generation: candidate.generation,
        grantGeneration: target.observedGrantGeneration,
        resolve: () => finish(),
        reject: (error) => finish(error),
      });
      try {
        candidate.worker.postMessage({
          t: "credential",
          requestId,
          token: lease.token,
          grantGeneration: target.observedGrantGeneration,
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private rejectCredentialWaiters(
    e: Entry,
    worker: Worker,
    generation: number,
    reason: string,
  ): void {
    for (const waiter of [...e.credentialWaiters.values()]) {
      if (waiter.worker === worker && waiter.generation === generation)
        waiter.reject(new Error(reason));
    }
  }

  private async forceEntry(
    e: Entry,
    reason: ActivationCloseReason,
  ): Promise<{ terminated: boolean; forced: boolean; detail: string }> {
    const worker = e.worker;
    if (worker === null)
      return { terminated: false, forced: false, detail: `${reason.kind}: no boundary to force` };
    const generation = e.generation;
    try {
      await worker.terminate();
      this.rejectCredentialWaiters(e, worker, generation, "service worker force-terminated");
      if (e.worker === worker) e.worker = null;
      return { terminated: true, forced: true, detail: reason.kind };
    } catch (error) {
      return {
        terminated: false,
        forced: true,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private releaseLeaseToken(pluginId: string, tokenId: string, reason: string): Promise<void> {
    return Promise.resolve(
      this.cfg.revokeServiceLease !== undefined
        ? this.cfg.revokeServiceLease(pluginId, tokenId, reason)
        : this.cfg.tokens.revoke(tokenId),
    )
      .then(() => undefined)
      .catch((error) => {
        this.logger.error(
          "fieldd.plugin_service.lease_revoke_failed",
          "Plugin service lease revocation could not be durably audited",
          error,
          { pluginId, tokenId, reason },
        );
      });
  }

  private releaseServiceLease(pluginId: string, e: Entry, reason: string): Promise<void> {
    const tokenId = e.leaseTokenId;
    if (tokenId === null) return e.leaseRelease ?? Promise.resolve();
    e.leaseTokenId = null;
    const release = this.releaseLeaseToken(pluginId, tokenId, reason);
    e.leaseRelease = release;
    return release;
  }

  private releaseCandidateLease(
    pluginId: string,
    e: Entry,
    candidate: ServiceWorkerCandidate,
    reason: string,
  ): Promise<void> {
    const tokenId = candidate.leaseTokenId;
    candidate.leaseTokenId = null;
    if (tokenId === null) return e.leaseRelease ?? Promise.resolve();
    // The exact worker exit path may already have detached and started releasing this token.
    if (e.leaseTokenId !== tokenId) return e.leaseRelease ?? Promise.resolve();
    e.leaseTokenId = null;
    const release = this.releaseLeaseToken(pluginId, tokenId, reason);
    e.leaseRelease = release;
    return release;
  }

  /** Plugin-owned stdout/stderr must never enter system/fieldd. Consume both
   * streams through the shared bounded framer and route them through the same
   * host-stamped plugins/service boundary as ctx.logger. */
  private capturePluginOutput(worker: Worker, pluginId: string): () => void {
    const detach: Array<() => void> = [];
    const attach = (stream: "stdout" | "stderr", level: "info" | "error"): void => {
      const readable = worker[stream];
      if (readable === null) return;
      let ended = false;
      const framer = createBoundedLineFramer({
        maxBytes: LOG_TRANSPORT_LIMITS.PLUGIN_PARTIAL_LINE_BYTES,
        onLine: (line) => {
          this.cfg.pluginLog?.({
            pluginId,
            level,
            message: line.line,
            fields: { source: stream, truncated: line.truncated },
            event: "plugin.output",
          });
        },
      });
      const onData = (chunk: Buffer | string): void => framer.push(chunk);
      const onEnd = (): void => {
        if (ended) return;
        ended = true;
        framer.flush();
      };
      readable.on("data", onData);
      readable.on("end", onEnd);
      detach.push(() => {
        readable.off("data", onData);
        readable.off("end", onEnd);
        onEnd();
      });
    };
    attach("stdout", "info");
    attach("stderr", "error");
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      for (const stop of detach.splice(0)) stop();
    };
  }

  /** the port bridge the ServiceRegistry invokes — handlers stay worker-side */
  private portHandlers(
    _pluginId: string,
    e: Entry,
    namespace: string,
    worker: Worker,
    generation: number,
  ) {
    const acceptsBusinessWork = (): boolean =>
      e.worker === worker &&
      e.generation === generation &&
      e.routeState !== "draining" &&
      e.routeState !== "withdrawn";
    return {
      call: (name: string, params: unknown, caller: ServiceCallerInfo): Promise<unknown> => {
        if (!acceptsBusinessWork()) return Promise.reject(new Error("provider draining"));
        const id = this.nextCallId++;
        return new Promise((resolveCall, rejectCall) => {
          e.pending.set(id, { resolve: resolveCall, reject: rejectCall });
          try {
            worker.postMessage({ t: "call", id, namespace, name, params, caller });
          } catch (error) {
            e.pending.delete(id);
            this.notifyPendingChanged(e);
            rejectCall(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
      subscribe: async (
        name: string,
        params: unknown,
        caller: ServiceCallerInfo,
        sink: {
          snapshot(v: unknown): void;
          delta(v: unknown): void;
          end(err?: { kind: string; message: string }): void;
        },
      ): Promise<() => void> => {
        if (!acceptsBusinessWork()) throw new Error("provider draining");
        const id = this.nextCallId++;
        e.sinks.set(id, sink);
        try {
          worker.postMessage({ t: "subscribe", id, namespace, name, params, caller });
        } catch (error) {
          e.sinks.delete(id);
          throw error;
        }
        let released = false;
        return () => {
          if (released) return;
          released = true;
          if (e.sinks.get(id) === sink) e.sinks.delete(id);
          try {
            worker.postMessage({ t: "unsubscribe", id });
          } catch {
            // Exact old-generation worker already exited; there is nothing left to release.
          }
        };
      },
    };
  }

  private async readManifest(pluginId: string): Promise<PluginManifestV1 | null> {
    const root = this.cfg.plugins.rootPath(pluginId);
    if (root === undefined) return null;
    return await this.readManifestAt(root);
  }

  private async readManifestAt(root: string): Promise<PluginManifestV1 | null> {
    try {
      const raw = JSON.parse(await readFile(join(root, "vibefield.plugin.json"), "utf8"));
      const result = validatePluginManifest(raw);
      return result.ok ? result.manifest : null;
    } catch {
      return null;
    }
  }
}

function serviceRecordFingerprint(record: PluginRecord | undefined): string {
  return JSON.stringify(
    record === undefined
      ? null
      : [
          record.id,
          record.version,
          record.state,
          record.enabled,
          // active/inactive/degraded are runtime output, not authority input.
          // Only whether the manifest declares a service participates in the
          // observation; private preparation necessarily drains the old entry.
          record.service === "none",
          record.installRevision,
          record.manifestHash,
          record.grantGeneration,
          record.grantedCapabilities,
        ],
  );
}
