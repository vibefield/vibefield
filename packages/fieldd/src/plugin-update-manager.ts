import type {
  PluginModuleUrls,
  PluginRecord,
  PluginUpdateArtifact,
  RendererParticipantIdentity,
} from "@vibefield/contracts";
import { RpcCallError } from "./native-link";
import type {
  PluginModuleAuthority,
  PreparedCandidateModules,
  PreparedRecoveryModules,
} from "./plugin-modules";
import type { PluginRegistryCandidate, PluginRegistryService } from "./plugin-registry";
import {
  PluginUpdateCoordinator,
  type PluginUpdateDeadlines,
  type PluginUpdateStart,
  type PreparedServiceUpdate,
  type RendererBoundaryReplacementRequest,
  type RendererUpdateDiagnosticStatus,
  type ServiceUpdateParticipant,
} from "./plugin-update-coordinator";
import type {
  AcquiredPluginUpdateSource,
  PluginUpdateSourceReleaseRequest,
  PluginUpdateSourceRequest,
} from "./plugin-update-transport";
import type { PreparedServiceCandidate, ServiceHost } from "./service-host";

export interface PluginRegistryUpdateCandidate {
  readonly runtime: PluginRegistryCandidate;
  commitArtifact(commitEpoch: number): Promise<void>;
  discardArtifact(): Promise<void>;
}

export interface PluginUpdateSourceGrant {
  readonly tokenId: string;
  readonly token: string;
  readonly pluginId: string;
  readonly expiresAt: number;
}

export interface PluginUpdateSourceMintRequest {
  readonly updateId: string;
  readonly purpose: "candidate" | "recover-old";
  readonly identity: RendererParticipantIdentity;
  readonly record: PluginRecord;
}

export interface PluginUpdateSourceRevokeRequest {
  readonly tokenId: string;
  readonly pluginId: string;
  readonly updateId: string;
  readonly purpose: "candidate" | "recover-old";
  readonly reason:
    | "discarded"
    | "candidate-failed"
    | "renderer-crashed"
    | "renderer-left"
    | "released"
    | "expired"
    | "shutdown";
}

export interface PluginUpdateManagerOptions {
  readonly plugins: Pick<PluginRegistryService, "get" | "commitEpoch">;
  readonly modules: Pick<PluginModuleAuthority, "prepareCandidate" | "prepareRecovery">;
  readonly serviceHost: () => Pick<
    ServiceHost,
    "prepareCandidate" | "restartFresh" | "stop"
  > | null;
  /** Runs after the coordinator's synchronous freeze/route-close edge and before candidates stage. */
  readonly retireOldAuthority: (pluginId: string, updateId: string) => void | Promise<void>;
  readonly mintSourceLease: (
    request: PluginUpdateSourceMintRequest,
  ) => PluginUpdateSourceGrant | Promise<PluginUpdateSourceGrant>;
  /** Must revoke at the mint table and terminate the exact authenticated ProductAPI connection. */
  readonly revokeSourceLease: (request: PluginUpdateSourceRevokeRequest) => void | Promise<void>;
  readonly requestRendererReplacement: (
    request: RendererBoundaryReplacementRequest,
  ) => void | Promise<void>;
  readonly deadlines?: Partial<PluginUpdateDeadlines>;
}

interface UpdateEpisodeRuntime {
  readonly pluginId: string;
  readonly oldRecord: PluginRecord;
  readonly candidate: PluginRegistryUpdateCandidate;
  readonly oldArtifact: PluginUpdateArtifact;
  readonly candidateArtifact: PluginUpdateArtifact;
  readonly candidateLeaseIds: Set<string>;
  updateId: string | null;
  prepareTask: Promise<PreparedServiceUpdate> | null;
  candidateModules: PreparedCandidateModules | null;
  recoveryModulesTask: Promise<PreparedRecoveryModules> | null;
  serviceCandidate: PreparedServiceCandidate | null;
  candidateSourcesRevoked: boolean;
  candidateModulesDisposed: boolean;
  finishTask: Promise<void> | null;
}

interface IssuedSourceLease {
  readonly leaseId: string;
  readonly tokenId: string;
  readonly pluginId: string;
  readonly updateId: string;
  readonly purpose: "candidate" | "recover-old";
  readonly identity: RendererParticipantIdentity;
  readonly expiresAt: number;
  readonly episode: UpdateEpisodeRuntime;
  timer: NodeJS.Timeout | null;
  released: boolean;
}

/** PRC-5e assembly above the per-plugin coordinator kernel.
 *
 * It stages module/service authority only after the synchronous member freeze, owns provisional
 * source leases through an exact inverse, and keeps retained-old recovery on a fresh module URL.
 * The installer remains the owner of durable pointer commit/discard; callers provide those two
 * effects as one immutable registry candidate.
 */
export class PluginUpdateManager {
  private readonly coordinators = new Map<string, PluginUpdateCoordinator>();
  private readonly activeByPlugin = new Map<string, UpdateEpisodeRuntime>();
  private readonly episodes = new Map<string, UpdateEpisodeRuntime>();
  private readonly sourceLeases = new Map<string, IssuedSourceLease>();
  private readonly diagnosticsListeners = new Set<() => void>();
  private readonly rendererRetirementListeners = new Set<
    (pluginId: string, identity: RendererParticipantIdentity) => void
  >();
  private readonly coordinatorDiagnosticDisposers = new Map<string, () => void>();
  private disposed = false;

  constructor(private readonly options: PluginUpdateManagerOptions) {}

  /** Observation-only lookup. Unlike coordinatorFor(), this can never allocate coordinator state
   * or validate/advance the durable plugin pointer. */
  existingCoordinatorFor(pluginId: string): PluginUpdateCoordinator | undefined {
    return this.coordinators.get(pluginId);
  }

  rendererDiagnosticStatus(
    pluginId: string,
    identity: RendererParticipantIdentity,
  ): RendererUpdateDiagnosticStatus | undefined {
    return this.existingCoordinatorFor(pluginId)?.rendererDiagnosticStatus(identity);
  }

  subscribeDiagnostics(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.diagnosticsListeners.add(listener);
    return () => this.diagnosticsListeners.delete(listener);
  }

  subscribeRendererRetirements(
    listener: (pluginId: string, identity: RendererParticipantIdentity) => void,
  ): () => void {
    if (this.disposed) return () => undefined;
    this.rendererRetirementListeners.add(listener);
    return () => this.rendererRetirementListeners.delete(listener);
  }

  coordinatorFor(pluginId: string): PluginUpdateCoordinator | undefined {
    const record = this.options.plugins.get(pluginId);
    if (record === undefined || record.state !== "enabled") return undefined;
    const artifact = artifactFor(record);
    const commitEpoch = this.options.plugins.commitEpoch(pluginId);
    if (commitEpoch === undefined) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${pluginId}: registry has no durable commit epoch`,
        false,
      );
    }
    const existing = this.coordinators.get(pluginId);
    if (existing !== undefined) {
      if (
        !sameArtifact(existing.currentArtifact, artifact) ||
        existing.commitEpoch !== commitEpoch
      ) {
        // Durable pointer publication refreshes the registry before the awaited commit callback
        // returns to the coordinator. During that one-way interval, reconnects must still find
        // the exact coordinator that owns the candidate/next-epoch transition. No other mismatch
        // is tolerated, and the exception disappears with the active episode.
        const active = this.activeByPlugin.get(pluginId);
        if (
          active !== undefined &&
          sameArtifact(existing.currentArtifact, active.oldArtifact) &&
          sameArtifact(artifact, active.candidateArtifact) &&
          commitEpoch === existing.commitEpoch + 1
        ) {
          return existing;
        }
        throw new RpcCallError(
          "CONFLICT",
          `${pluginId}: registry artifact or epoch moved outside the update coordinator`,
          false,
        );
      }
      return existing;
    }
    const coordinator = new PluginUpdateCoordinator({
      pluginId,
      currentArtifact: artifact,
      commitEpoch,
      requestRendererReplacement: this.options.requestRendererReplacement,
      ...(this.options.deadlines === undefined ? {} : { deadlines: this.options.deadlines }),
    });
    this.coordinators.set(pluginId, coordinator);
    this.coordinatorDiagnosticDisposers.set(
      pluginId,
      coordinator.subscribe(() => this.emitDiagnosticsChanged()),
    );
    this.emitDiagnosticsChanged();
    return coordinator;
  }

  beginRegistryUpdate(candidate: PluginRegistryUpdateCandidate): PluginUpdateStart {
    if (this.disposed) throw new RpcCallError("UNAVAILABLE", "plugin update manager is stopping");
    const record = candidate.runtime.record;
    const oldRecord = this.options.plugins.get(record.id);
    if (oldRecord === undefined)
      throw new RpcCallError("NOT_FOUND", `no installed plugin to update: ${record.id}`, false);
    const coordinator = this.coordinatorFor(record.id);
    if (coordinator === undefined)
      throw new RpcCallError("PRECONDITION_FAILED", `${record.id} is not enabled`, false);
    if (this.activeByPlugin.has(record.id))
      throw new RpcCallError("CONFLICT", `${record.id} already has an update in flight`, true);
    const oldArtifact = artifactFor(oldRecord);
    const candidateArtifact = artifactFor(record);
    if (sameArtifact(oldArtifact, candidateArtifact))
      throw new RpcCallError("CONFLICT", `${record.id} candidate is already current`, false);

    const episode: UpdateEpisodeRuntime = {
      pluginId: record.id,
      oldRecord: freezeRecord(oldRecord),
      candidate,
      oldArtifact,
      candidateArtifact,
      candidateLeaseIds: new Set(),
      updateId: null,
      prepareTask: null,
      candidateModules: null,
      recoveryModulesTask: null,
      serviceCandidate: null,
      candidateSourcesRevoked: false,
      candidateModulesDisposed: false,
      finishTask: null,
    };
    this.activeByPlugin.set(record.id, episode);

    const service: ServiceUpdateParticipant = {
      participantId: `service:${record.id}`,
      incarnation: `fieldd:${oldRecord.installRevision}`,
      prepare: (updateId) => this.prepareEpisode(episode, updateId),
      recoverOld: async () => await this.recoverOldService(episode),
    };
    let started: PluginUpdateStart;
    try {
      started = coordinator.begin({
        oldArtifact,
        candidateArtifact,
        service,
        commitArtifact: (commitEpoch) => candidate.commitArtifact(commitEpoch),
        discardArtifact: () => candidate.discardArtifact(),
        promoteCandidateAuthority: () => episode.candidateModules?.promote(),
        revokeCandidateSources: async () => await this.revokeCandidateSources(episode),
        disposeCandidateModuleAuthority: () => this.disposeCandidateModules(episode),
      });
    } catch (error) {
      this.activeByPlugin.delete(record.id);
      throw error;
    }
    if (episode.updateId !== started.updateId) {
      this.activeByPlugin.delete(record.id);
      throw new Error("coordinator did not synchronously bind its update authority episode");
    }
    const completion = started.completion.finally(async () => await this.finishEpisode(episode));
    // The coordinator already sinks its internal deferred, but finally() creates
    // a distinct promise. Keep shutdown/fatal disposal from becoming an
    // unhandled rejection when an installer caller has already disappeared.
    void completion.catch(() => undefined);
    return Object.freeze({ updateId: started.updateId, completion });
  }

  /** Candidate service credentials cannot compare against the still-old live registry row. This
   * narrow lookup exposes only the exact record already owned by the active manager episode. */
  serviceCandidateRecord(pluginId: string, updateId: string): PluginRecord | undefined {
    const episode = this.episodes.get(updateId);
    if (
      this.disposed ||
      episode === undefined ||
      episode.pluginId !== pluginId ||
      episode.updateId !== updateId ||
      episode.candidateSourcesRevoked
    ) {
      return undefined;
    }
    return episode.candidate.runtime.record;
  }

  /** Orderly per-plugin renderer departure. Source revocation completes before its vote can leave
   * the barrier; a mere subscription disconnect never calls this path. */
  async retireRenderer(pluginId: string, identity: RendererParticipantIdentity): Promise<boolean> {
    const revocations = await Promise.allSettled(
      [...this.sourceLeases.values()]
        .filter((issued) => issued.pluginId === pluginId && sameIdentity(issued.identity, identity))
        .map((issued) => this.releaseIssued(issued, "renderer-left")),
    );
    const coordinator = this.coordinators.get(pluginId);
    const retired = coordinator === undefined ? false : await coordinator.retireRenderer(identity);
    const failure = revocations.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
    if (retired) this.emitRendererRetired(pluginId, identity);
    return retired;
  }

  async retireRendererEverywhere(identity: RendererParticipantIdentity): Promise<number> {
    const pluginIds = new Set(this.coordinators.keys());
    for (const issued of this.sourceLeases.values()) {
      if (sameIdentity(issued.identity, identity)) pluginIds.add(issued.pluginId);
    }
    const results = await Promise.allSettled(
      [...pluginIds].map(async (pluginId) => await this.retireRenderer(pluginId, identity)),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
    return results.filter(
      (result): result is PromiseFulfilledResult<boolean> =>
        result.status === "fulfilled" && result.value,
    ).length;
  }

  /** Positive boundary death. Candidate/old source authority is revoked before
   * the exact vote is removed, while the coordinator retains a recovery target
   * for the stable logical window. */
  async crashRenderer(pluginId: string, identity: RendererParticipantIdentity): Promise<boolean> {
    const revocations = await Promise.allSettled(
      [...this.sourceLeases.values()]
        .filter((issued) => issued.pluginId === pluginId && sameIdentity(issued.identity, identity))
        .map((issued) => this.releaseIssued(issued, "renderer-crashed")),
    );
    const coordinator = this.coordinators.get(pluginId);
    const crashed = coordinator === undefined ? false : await coordinator.crashRenderer(identity);
    const failure = revocations.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
    if (crashed) this.emitRendererRetired(pluginId, identity);
    return crashed;
  }

  async crashRendererEverywhere(identity: RendererParticipantIdentity): Promise<number> {
    const pluginIds = new Set(this.coordinators.keys());
    for (const issued of this.sourceLeases.values()) {
      if (sameIdentity(issued.identity, identity)) pluginIds.add(issued.pluginId);
    }
    const results = await Promise.allSettled(
      [...pluginIds].map(async (pluginId) => await this.crashRenderer(pluginId, identity)),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
    return results.filter(
      (result): result is PromiseFulfilledResult<boolean> =>
        result.status === "fulfilled" && result.value,
    ).length;
  }

  async acquireSource(request: PluginUpdateSourceRequest): Promise<AcquiredPluginUpdateSource> {
    if (this.disposed) throw new RpcCallError("UNAVAILABLE", "plugin update manager is stopping");
    const episode = this.episodes.get(request.fence.updateId);
    if (
      episode === undefined ||
      episode.pluginId !== request.fence.artifact.pluginId ||
      episode.updateId === null
    ) {
      throw new RpcCallError("CONFLICT", "plugin update source episode is absent", true);
    }
    if (request.signal?.aborted)
      throw new RpcCallError("CONFLICT", "plugin update source request was cancelled", true);
    if (!this.retainedObservationIsCurrent(episode))
      throw new RpcCallError("CONFLICT", "plugin update base observation moved", true);

    let record: PluginRecord;
    let module: PluginModuleUrls | undefined;
    if (request.fence.purpose === "candidate") {
      if (episode.candidateSourcesRevoked)
        throw new RpcCallError("CONFLICT", "candidate source authority is revoked", true);
      await episode.prepareTask;
      if (episode.candidateSourcesRevoked)
        throw new RpcCallError("CONFLICT", "candidate source authority is revoked", true);
      record = episode.candidate.runtime.record;
      module = episode.candidateModules?.module;
    } else {
      record = episode.oldRecord;
      module = (await this.recoveryModules(episode)).module;
    }
    if (module === undefined)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${episode.pluginId}: update artifact has no renderer module`,
        false,
      );
    if (
      !sameArtifact(artifactFor(record), request.fence.artifact) ||
      module.pluginId !== record.id ||
      module.installRevision !== record.installRevision ||
      module.manifestHash !== record.manifestHash
    ) {
      throw new RpcCallError("CONFLICT", "plugin update source artifact moved", true);
    }

    const grant = await this.options.mintSourceLease({
      updateId: request.fence.updateId,
      purpose: request.fence.purpose,
      identity: request.identity,
      record,
    });
    const validTokenId = /^tk_[0-9a-f]{12}$/.test(grant.tokenId);
    if (
      !validTokenId ||
      grant.token.trim().length === 0 ||
      grant.pluginId !== record.id ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= Date.now()
    ) {
      if (validTokenId) {
        const incumbent = this.sourceLeases.get(grant.tokenId);
        if (incumbent !== undefined) await this.releaseIssued(incumbent, "discarded");
        else {
          await this.options.revokeSourceLease({
            tokenId: grant.tokenId,
            pluginId: record.id,
            updateId: request.fence.updateId,
            purpose: request.fence.purpose,
            reason: "discarded",
          });
        }
      }
      throw new RpcCallError("INTERNAL", "update source mint returned an invalid lease", false);
    }
    const incumbent = this.sourceLeases.get(grant.tokenId);
    if (incumbent !== undefined) {
      await this.releaseIssued(incumbent, "discarded");
      throw new RpcCallError("INTERNAL", "update source lease id was reused", false);
    }
    if (!this.retainedObservationIsCurrent(episode)) {
      await this.options.revokeSourceLease({
        tokenId: grant.tokenId,
        pluginId: record.id,
        updateId: request.fence.updateId,
        purpose: request.fence.purpose,
        reason: "discarded",
      });
      throw new RpcCallError("CONFLICT", "plugin update base observation moved", true);
    }
    const issued: IssuedSourceLease = {
      leaseId: grant.tokenId,
      tokenId: grant.tokenId,
      pluginId: record.id,
      updateId: request.fence.updateId,
      purpose: request.fence.purpose,
      identity: freezeIdentity(request.identity),
      expiresAt: grant.expiresAt,
      episode,
      timer: null,
      released: false,
    };
    this.sourceLeases.set(issued.leaseId, issued);
    if (issued.purpose === "candidate") episode.candidateLeaseIds.add(issued.leaseId);
    issued.timer = setTimeout(
      () => void this.releaseIssued(issued, "expired").catch(() => undefined),
      Math.max(0, Math.min(2_147_483_647, issued.expiresAt - Date.now())),
    );
    issued.timer.unref();

    if (
      request.signal?.aborted ||
      (issued.purpose === "candidate" && episode.candidateSourcesRevoked)
    ) {
      await this.releaseIssued(issued, "discarded");
      throw new RpcCallError("CONFLICT", "plugin update source barrier advanced", true);
    }

    return Object.freeze({
      value: {
        updateId: issued.updateId,
        purpose: issued.purpose,
        artifact: request.fence.artifact,
        record,
        module,
        lease: {
          leaseId: issued.leaseId,
          token: grant.token,
          pluginId: record.id,
          manifestHash: record.manifestHash,
          grantGeneration: record.grantGeneration,
          expiresAt: grant.expiresAt,
        },
      },
      discard: async () => await this.releaseIssued(issued, "discarded"),
    });
  }

  async releaseSource(request: PluginUpdateSourceReleaseRequest): Promise<boolean> {
    const issued = this.sourceLeases.get(request.leaseId);
    if (issued === undefined) return false;
    if (
      issued.pluginId !== request.pluginId ||
      issued.updateId !== request.updateId ||
      !sameIdentity(issued.identity, request.identity)
    ) {
      throw new RpcCallError("CONFLICT", "update source lease belongs to another authority", false);
    }
    await this.releaseIssued(issued, "released");
    return true;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const coordinator of this.coordinators.values()) coordinator.dispose();
    for (const dispose of this.coordinatorDiagnosticDisposers.values()) dispose();
    this.coordinatorDiagnosticDisposers.clear();
    this.diagnosticsListeners.clear();
    this.rendererRetirementListeners.clear();
    await Promise.allSettled(
      [...this.sourceLeases.values()].map((issued) => this.releaseIssued(issued, "shutdown")),
    );
    await Promise.allSettled(
      [...this.activeByPlugin.values()].map((episode) => this.finishEpisode(episode)),
    );
  }

  private prepareEpisode(
    episode: UpdateEpisodeRuntime,
    updateId: string,
  ): Promise<PreparedServiceUpdate> {
    if (episode.updateId !== null && episode.updateId !== updateId)
      return Promise.reject(new Error(`${episode.pluginId}: update id changed during preparation`));
    if (episode.updateId === null) {
      episode.updateId = updateId;
      this.episodes.set(updateId, episode);
    }
    episode.prepareTask ??= this.prepareEpisodeWork(episode);
    return episode.prepareTask;
  }

  private async prepareEpisodeWork(episode: UpdateEpisodeRuntime): Promise<PreparedServiceUpdate> {
    const updateId = episode.updateId!;
    await this.options.retireOldAuthority(episode.pluginId, updateId);
    const moduleTask = this.options.modules.prepareCandidate({
      updateId,
      baseInstallRevision: episode.oldRecord.installRevision,
      candidate: episode.candidate.runtime,
    });
    const serviceTask = this.prepareServiceCandidate(episode);
    const [moduleResult, serviceResult] = await Promise.allSettled([moduleTask, serviceTask]);
    if (moduleResult.status === "fulfilled") {
      episode.candidateModules = moduleResult.value;
      if (episode.candidateModulesDisposed) episode.candidateModules.dispose();
    }
    if (serviceResult.status === "fulfilled") episode.serviceCandidate = serviceResult.value;
    const failed = [moduleResult, serviceResult].find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed !== undefined) {
      this.disposeCandidateModules(episode);
      await episode.serviceCandidate?.discard().catch(() => undefined);
      throw failed.reason;
    }
    return Object.freeze({
      commit: () => episode.serviceCandidate?.commit(),
      discard: async () => await episode.serviceCandidate?.discard(),
      release: () => episode.serviceCandidate?.release(),
    });
  }

  private async prepareServiceCandidate(
    episode: UpdateEpisodeRuntime,
  ): Promise<PreparedServiceCandidate | null> {
    const oldHasService = episode.oldRecord.enabled && episode.oldRecord.service !== "none";
    const candidateRecord = episode.candidate.runtime.record;
    const candidateHasService = candidateRecord.enabled && candidateRecord.service !== "none";
    const host = this.options.serviceHost();
    if (host === null) {
      if (oldHasService || candidateHasService)
        throw new Error(`${episode.pluginId}: service host is not ready for update`);
      return null;
    }
    if (candidateHasService) {
      return await host.prepareCandidate({
        updateId: episode.updateId!,
        baseInstallRevision: episode.oldRecord.installRevision,
        candidate: episode.candidate.runtime,
      });
    }
    if (oldHasService) await host.stop(episode.pluginId);
    return null;
  }

  private async recoverOldService(episode: UpdateEpisodeRuntime): Promise<void> {
    if (!episode.oldRecord.enabled || episode.oldRecord.service === "none") return;
    const host = this.options.serviceHost();
    if (host === null)
      throw new Error(`${episode.pluginId}: service host is unavailable for recovery`);
    await host.restartFresh(episode.pluginId);
  }

  private async recoveryModules(episode: UpdateEpisodeRuntime): Promise<PreparedRecoveryModules> {
    episode.recoveryModulesTask ??= this.options.modules.prepareRecovery({
      updateId: episode.updateId!,
      artifact: episode.oldArtifact,
    });
    return await episode.recoveryModulesTask;
  }

  private async revokeCandidateSources(episode: UpdateEpisodeRuntime): Promise<void> {
    episode.candidateSourcesRevoked = true;
    const results = await Promise.allSettled(
      [...episode.candidateLeaseIds]
        .map((leaseId) => this.sourceLeases.get(leaseId))
        .filter((issued): issued is IssuedSourceLease => issued !== undefined)
        .map((issued) => this.releaseIssued(issued, "candidate-failed")),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
  }

  private disposeCandidateModules(episode: UpdateEpisodeRuntime): void {
    if (episode.candidateModulesDisposed) return;
    episode.candidateModulesDisposed = true;
    episode.candidateModules?.dispose();
  }

  private finishEpisode(episode: UpdateEpisodeRuntime): Promise<void> {
    episode.finishTask ??= this.finishEpisodeWork(episode);
    return episode.finishTask;
  }

  private async finishEpisodeWork(episode: UpdateEpisodeRuntime): Promise<void> {
    try {
      if (episode.candidateSourcesRevoked) await this.revokeCandidateSources(episode);
      this.disposeCandidateModules(episode);
      const recovery = await episode.recoveryModulesTask?.catch(() => null);
      recovery?.dispose();
    } finally {
      if (episode.updateId !== null && this.episodes.get(episode.updateId) === episode)
        this.episodes.delete(episode.updateId);
      if (this.activeByPlugin.get(episode.pluginId) === episode)
        this.activeByPlugin.delete(episode.pluginId);
    }
  }

  private async releaseIssued(
    issued: IssuedSourceLease,
    reason: PluginUpdateSourceRevokeRequest["reason"],
  ): Promise<void> {
    if (issued.released) return;
    issued.released = true;
    if (issued.timer !== null) clearTimeout(issued.timer);
    issued.timer = null;
    this.sourceLeases.delete(issued.leaseId);
    issued.episode.candidateLeaseIds.delete(issued.leaseId);
    await this.options.revokeSourceLease({
      tokenId: issued.tokenId,
      pluginId: issued.pluginId,
      updateId: issued.updateId,
      purpose: issued.purpose,
      reason,
    });
  }

  private retainedObservationIsCurrent(episode: UpdateEpisodeRuntime): boolean {
    const current = this.options.plugins.get(episode.pluginId);
    return current !== undefined && sameAuthorityObservation(current, episode.oldRecord);
  }

  private emitDiagnosticsChanged(): void {
    for (const listener of [...this.diagnosticsListeners]) {
      try {
        listener();
      } catch {
        // Runtime observation is never update authority.
      }
    }
  }

  private emitRendererRetired(pluginId: string, identity: RendererParticipantIdentity): void {
    for (const listener of [...this.rendererRetirementListeners]) {
      try {
        listener(pluginId, identity);
      } catch {
        // Retirement already happened; a passive cache observer cannot alter that fact.
      }
    }
  }
}

function artifactFor(record: PluginRecord): PluginUpdateArtifact {
  return Object.freeze({
    pluginId: record.id,
    installRevision: record.installRevision,
    manifestHash: record.manifestHash,
  });
}

function sameArtifact(left: PluginUpdateArtifact, right: PluginUpdateArtifact): boolean {
  return (
    left.pluginId === right.pluginId &&
    left.installRevision === right.installRevision &&
    left.manifestHash === right.manifestHash
  );
}

function freezeRecord(record: PluginRecord): PluginRecord {
  return Object.freeze(structuredClone(record));
}

function freezeIdentity(identity: RendererParticipantIdentity): RendererParticipantIdentity {
  return Object.freeze({
    participantId: identity.participantId,
    incarnation: identity.incarnation,
  });
}

function sameIdentity(
  left: RendererParticipantIdentity,
  right: RendererParticipantIdentity,
): boolean {
  return left.participantId === right.participantId && left.incarnation === right.incarnation;
}

function sameAuthorityObservation(left: PluginRecord, right: PluginRecord): boolean {
  return (
    left.id === right.id &&
    left.state === right.state &&
    left.enabled === right.enabled &&
    left.installRevision === right.installRevision &&
    left.manifestHash === right.manifestHash &&
    left.grantGeneration === right.grantGeneration &&
    JSON.stringify(left.grantedCapabilities) === JSON.stringify(right.grantedCapabilities)
  );
}
