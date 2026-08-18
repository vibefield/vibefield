import { randomBytes } from "node:crypto";
import {
  PLUGIN_LIMITS,
  PluginUpdateAckParams,
  PluginUpdateArtifact,
  type PluginUpdateCommand,
  PluginUpdateId,
  PluginUpdateParticipant,
  type PluginUpdatePhase,
  type PluginUpdateRecoveryTarget,
  PluginUpdateSnapshot,
  RendererParticipantIdentity,
} from "@vibefield/contracts";

type UpdateAck = typeof PluginUpdateAckParams._type;
type UpdateSnapshot = typeof PluginUpdateSnapshot._type;

export interface RendererUpdateRegistration {
  readonly identity: RendererParticipantIdentity;
  readonly artifact: PluginUpdateArtifact | null;
  readonly send: (command: PluginUpdateCommand) => void;
}

export interface PreparedServiceUpdate {
  commit(): void;
  discard(): Promise<void>;
  release(): void;
}

export interface ServiceUpdateParticipant {
  readonly participantId: string;
  readonly incarnation: string;
  prepare(updateId: string): Promise<PreparedServiceUpdate>;
  recoverOld(updateId: string): Promise<void>;
}

export interface PluginUpdateCandidate {
  readonly oldArtifact: PluginUpdateArtifact;
  readonly candidateArtifact: PluginUpdateArtifact;
  readonly service?: ServiceUpdateParticipant;
  /** The one durable pointer CAS. Resolution means registry discovery is candidate-current. */
  commitArtifact(): Promise<void>;
  /** Runs only after retained-old recovery converges. Immutable bytes remain until then. */
  discardArtifact(): Promise<void>;
  /** Promote the candidate module-resolution episode immediately after pointer publication. */
  promoteCandidateAuthority?(): void;
  /** Pre-commit only: revoke candidate seed tokens and terminate their authenticated sockets. */
  revokeCandidateSources?(): void | Promise<void>;
  /** Retire the temporary module-resolution episode after either barrier outcome converges. */
  disposeCandidateModuleAuthority?(): void | Promise<void>;
}

export interface PluginUpdateOutcome {
  readonly outcome: "committed" | "candidate-failed-old-recovered";
  readonly updateId: string;
  readonly currentArtifact: PluginUpdateArtifact;
  readonly commitEpoch: number;
}

export interface PluginUpdateStart {
  readonly updateId: string;
  readonly completion: Promise<PluginUpdateOutcome>;
}

export interface PluginUpdateSourceFence {
  readonly updateId: string;
  readonly purpose: "candidate" | "recover-old";
  readonly artifact: PluginUpdateArtifact;
}

export interface PluginUpdateCoordinatorOptions {
  readonly pluginId: string;
  readonly currentArtifact: PluginUpdateArtifact;
  readonly commitEpoch?: number;
  readonly makeUpdateId?: () => string;
  readonly deadlines?: Partial<PluginUpdateDeadlines>;
  readonly now?: () => number;
  /** A request to terminate one exact renderer boundary. Resolution is not
   * death evidence; only a later crashRenderer() call may remove the vote. */
  readonly requestRendererReplacement?: (
    request: RendererBoundaryReplacementRequest,
  ) => void | Promise<void>;
}

export interface PluginUpdateDeadlines {
  readonly prepareMs: number;
  readonly commitMs: number;
  readonly recoveryMs: number;
  readonly boundaryDeathMs: number;
}

export interface RendererBoundaryReplacementRequest {
  readonly pluginId: string;
  readonly updateId: string;
  readonly phase: "committing" | "recovering-old";
  readonly identity: RendererParticipantIdentity;
}

type Expected = "prepare" | "commit" | "recover-old" | "settled";

interface RendererSlot {
  readonly participantId: string;
  readonly incarnation: string;
  connected: boolean;
  status: "live" | "held";
  artifact: PluginUpdateArtifact | null;
  send: (command: PluginUpdateCommand) => void;
  pending: PluginUpdateCommand | null;
}

interface EpisodeMember {
  readonly kind: "service" | "renderer";
  readonly participantId: string;
  readonly incarnation: string;
  expected: Expected;
}

interface UpdateEpisode {
  readonly updateId: string;
  readonly input: PluginUpdateCandidate;
  readonly oldArtifact: PluginUpdateArtifact;
  readonly candidateArtifact: PluginUpdateArtifact;
  readonly oldCommitEpoch: number;
  readonly members: Map<string, EpisodeMember>;
  readonly completion: Deferred<PluginUpdateOutcome>;
  phase: "preparing" | "committing" | "recovering-old";
  commitStarted: boolean;
  logicalCommit: boolean;
  serviceHandle: PreparedServiceUpdate | null;
  servicePrepare: Promise<PreparedServiceUpdate> | null;
  serviceRecovery: Promise<void> | null;
  phaseDeadlineAt: number;
  deathDeadlineAt: number | null;
  phaseTimer: ReturnType<typeof setTimeout> | null;
  deathTimer: ReturnType<typeof setTimeout> | null;
  terminal: boolean;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/**
 * One plugin's fieldd-owned disruptive update barrier.
 *
 * `begin()` closes the route and freezes exact renderer/service incarnations before returning or
 * starting async work. Disconnect changes reachability only and pending commands survive an exact
 * reconnect. The pointer CAS is serialized behind all prepare results. There is no path from a
 * logical commit to retained-old recovery.
 */
export class PluginUpdateCoordinator {
  readonly pluginId: string;

  private currentArtifactValue: PluginUpdateArtifact;
  private commitEpochValue: number;
  private generation = 0;
  private stateValue: UpdateSnapshot["state"] = "active";
  private routeOpenValue = true;
  private readonly renderers = new Map<string, RendererSlot>();
  private readonly recoveryTargets = new Map<string, PluginUpdateRecoveryTarget>();
  private readonly usedUpdateIds = new Set<string>();
  private episode: UpdateEpisode | null = null;
  private advanceTail: Promise<void> = Promise.resolve();
  private readonly makeUpdateId: () => string;
  private readonly now: () => number;
  private readonly deadlines: PluginUpdateDeadlines;
  private readonly requestRendererReplacement: (
    request: RendererBoundaryReplacementRequest,
  ) => void | Promise<void>;
  private readonly listeners = new Set<(snapshot: UpdateSnapshot) => void>();

  constructor(options: PluginUpdateCoordinatorOptions) {
    this.pluginId = options.pluginId;
    this.currentArtifactValue = freezeArtifact(options.currentArtifact);
    if (this.currentArtifactValue.pluginId !== this.pluginId)
      throw new Error("coordinator artifact belongs to another plugin");
    this.commitEpochValue = options.commitEpoch ?? 1;
    if (!Number.isSafeInteger(this.commitEpochValue) || this.commitEpochValue <= 0)
      throw new Error("plugin update commit epoch must be positive");
    this.makeUpdateId = options.makeUpdateId ?? mintUpdateId;
    this.now = options.now ?? Date.now;
    this.deadlines = Object.freeze({
      prepareMs: deadline(
        options.deadlines?.prepareMs ?? PLUGIN_LIMITS.UPDATE_PREPARE_DEADLINE_MS,
        "prepare",
      ),
      commitMs: deadline(
        options.deadlines?.commitMs ?? PLUGIN_LIMITS.UPDATE_COMMIT_DEADLINE_MS,
        "commit",
      ),
      recoveryMs: deadline(
        options.deadlines?.recoveryMs ?? PLUGIN_LIMITS.UPDATE_RECOVERY_DEADLINE_MS,
        "recovery",
      ),
      boundaryDeathMs: deadline(
        options.deadlines?.boundaryDeathMs ?? PLUGIN_LIMITS.UPDATE_BOUNDARY_DEATH_DEADLINE_MS,
        "boundary death",
      ),
    });
    this.requestRendererReplacement = options.requestRendererReplacement ?? (() => undefined);
  }

  get currentArtifact(): PluginUpdateArtifact {
    return this.currentArtifactValue;
  }

  get commitEpoch(): number {
    return this.commitEpochValue;
  }

  get routeOpen(): boolean {
    return this.routeOpenValue;
  }

  subscribe(listener: (snapshot: UpdateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stops deadline work and rejects an active episode without inventing a
   * recovery edge. Daemon restart semantics remain a separate durability
   * protocol; shutdown must at least leave no live timers or shell requests. */
  dispose(reason = "plugin update coordinator is stopping"): void {
    const episode = this.episode;
    if (episode !== null && !episode.terminal) this.failClosed(episode, new Error(reason));
    this.listeners.clear();
  }

  registerRenderer(input: RendererUpdateRegistration): "live" | "held" {
    const identity = freezeIdentity(input.identity);
    const existing = this.renderers.get(identity.participantId);
    if (existing !== undefined) {
      if (existing.incarnation !== identity.incarnation) {
        throw new Error(
          `${identity.participantId} is occupied by ${existing.incarnation}; positive retirement is required`,
        );
      }
      if (existing.connected) throw new Error(`${identity.participantId} is already connected`);
      existing.connected = true;
      existing.send = input.send;
      if (existing.pending !== null) this.deliver(existing, existing.pending);
      this.changed();
      return existing.status;
    }

    const artifact = input.artifact === null ? null : freezeArtifact(input.artifact);
    const recovery = this.recoveryTargets.get(identity.participantId);
    if (recovery?.retiredIncarnation === identity.incarnation) {
      throw new Error(`${identity.participantId}: crashed renderer incarnation cannot reconnect`);
    }
    const status =
      this.episode === null &&
      recovery === undefined &&
      artifact !== null &&
      sameArtifact(artifact, this.currentArtifactValue)
        ? "live"
        : "held";
    this.renderers.set(identity.participantId, {
      participantId: identity.participantId,
      incarnation: identity.incarnation,
      connected: true,
      status,
      artifact,
      send: input.send,
      pending: null,
    });
    this.changed();
    return status;
  }

  disconnectRenderer(identity: RendererParticipantIdentity): void {
    const renderer = this.requireRenderer(identity);
    if (!renderer.connected) throw new Error(`${renderer.participantId} is already disconnected`);
    renderer.connected = false;
    this.changed();
  }

  /** Positive host-owned departure, distinct from transport loss. It removes only the exact
   * incarnation and may therefore release a frozen barrier member. */
  async retireRenderer(identity: RendererParticipantIdentity): Promise<boolean> {
    const parsed = freezeIdentity(identity);
    const renderer = this.renderers.get(parsed.participantId);
    if (renderer === undefined) return false;
    if (renderer.incarnation !== parsed.incarnation)
      throw new Error(`${parsed.participantId}: stale renderer incarnation`);
    const episode = this.episode;
    if (episode !== null) {
      const member = episode.members.get(parsed.participantId);
      if (member !== undefined && member.incarnation !== parsed.incarnation)
        throw new Error(`${parsed.participantId}: frozen renderer incarnation changed`);
      if (member?.kind === "renderer") episode.members.delete(parsed.participantId);
    }
    this.renderers.delete(parsed.participantId);
    this.recoveryTargets.delete(parsed.participantId);
    this.changed();
    if (episode !== null && !episode.terminal) await this.advance();
    return true;
  }

  /** Positive Electron/host boundary-death evidence. Unlike orderly leave this
   * records a stable-window recovery target. A timeout or socket loss must
   * never call this method. */
  async crashRenderer(identity: RendererParticipantIdentity): Promise<boolean> {
    const parsed = freezeIdentity(identity);
    const renderer = this.renderers.get(parsed.participantId);
    if (renderer === undefined) return false;
    if (renderer.incarnation !== parsed.incarnation)
      throw new Error(`${parsed.participantId}: stale renderer incarnation`);
    const episode = this.episode;
    if (episode !== null) {
      const member = episode.members.get(parsed.participantId);
      if (member !== undefined && member.incarnation !== parsed.incarnation)
        throw new Error(`${parsed.participantId}: frozen renderer incarnation changed`);
      if (member?.kind === "renderer") episode.members.delete(parsed.participantId);
    }
    this.renderers.delete(parsed.participantId);
    this.recoveryTargets.set(
      parsed.participantId,
      recoveryTargetFor(parsed, episode, this.currentArtifactValue, this.commitEpochValue),
    );
    this.changed();
    if (episode !== null && !episode.terminal) await this.advance();
    return true;
  }

  admitHeld(identity: RendererParticipantIdentity): {
    readonly artifact: PluginUpdateArtifact;
    readonly commitEpoch: number;
  } {
    if (this.episode !== null) throw new Error("held renderer cannot publish during an update");
    const renderer = this.requireRenderer(identity);
    if (renderer.status !== "held") throw new Error(`${renderer.participantId} is not held`);
    if (!renderer.connected) throw new Error(`${renderer.participantId} is disconnected`);
    renderer.status = "live";
    renderer.artifact = this.currentArtifactValue;
    this.recoveryTargets.delete(renderer.participantId);
    this.changed();
    return Object.freeze({
      artifact: this.currentArtifactValue,
      commitEpoch: this.commitEpochValue,
    });
  }

  /** Authorize only the code-free source resolver. Paths, module grants, and credentials are
   * minted by the caller after this exact member/barrier fence succeeds. */
  sourceFence(
    identity: RendererParticipantIdentity,
    updateId: string,
    purpose: "candidate" | "recover-old",
  ): PluginUpdateSourceFence {
    const renderer = this.requireRenderer(identity);
    if (!renderer.connected) throw new Error(`${renderer.participantId} is disconnected`);
    const episode = this.requireEpisode(updateId);
    const member = this.requireRendererMember(episode, renderer);
    const expected = purpose === "candidate" ? "prepare" : "recover-old";
    const command = purpose === "candidate" ? "prepare" : "recover-old";
    if (member.expected !== expected || !pendingIs(renderer, command, episode.updateId)) {
      throw new Error(`${renderer.participantId}: source purpose does not match its barrier`);
    }
    return Object.freeze({
      updateId: episode.updateId,
      purpose,
      artifact: purpose === "candidate" ? episode.candidateArtifact : episode.oldArtifact,
    });
  }

  begin(input: PluginUpdateCandidate): PluginUpdateStart {
    if (this.episode !== null) throw new Error(`${this.pluginId} already has an update in flight`);
    const oldArtifact = freezeArtifact(input.oldArtifact);
    const candidateArtifact = freezeArtifact(input.candidateArtifact);
    if (!sameArtifact(oldArtifact, this.currentArtifactValue))
      throw new Error(`${this.pluginId}: update base artifact is stale`);
    if (candidateArtifact.pluginId !== this.pluginId)
      throw new Error(`${this.pluginId}: candidate belongs to another plugin`);
    if (sameArtifact(oldArtifact, candidateArtifact))
      throw new Error(`${this.pluginId}: candidate artifact is already current`);
    if (this.commitEpochValue >= Number.MAX_SAFE_INTEGER)
      throw new Error(`${this.pluginId}: plugin update commit epoch is exhausted`);
    const updateId = PluginUpdateId.parse(this.makeUpdateId());
    if (this.usedUpdateIds.has(updateId))
      throw new Error(`${updateId}: plugin update id was reused`);
    const serviceIdentity =
      input.service === undefined
        ? null
        : freezeServiceIdentity(input.service.participantId, input.service.incarnation);
    const completion = deferred<PluginUpdateOutcome>();
    void completion.promise.catch(() => undefined);
    const members = new Map<string, EpisodeMember>();
    for (const renderer of this.renderers.values()) {
      if (renderer.status !== "live" || !sameArtifact(renderer.artifact, oldArtifact)) continue;
      members.set(renderer.participantId, {
        kind: "renderer",
        participantId: renderer.participantId,
        incarnation: renderer.incarnation,
        expected: "prepare",
      });
    }
    if (serviceIdentity !== null) {
      if (members.has(serviceIdentity.participantId))
        throw new Error(`${serviceIdentity.participantId}: duplicate update participant`);
      members.set(serviceIdentity.participantId, {
        kind: "service",
        participantId: serviceIdentity.participantId,
        incarnation: serviceIdentity.incarnation,
        expected: "prepare",
      });
    }
    const episode: UpdateEpisode = {
      updateId,
      input,
      oldArtifact,
      candidateArtifact,
      oldCommitEpoch: this.commitEpochValue,
      members,
      completion,
      phase: "preparing",
      commitStarted: false,
      logicalCommit: false,
      serviceHandle: null,
      servicePrepare: null,
      serviceRecovery: null,
      phaseDeadlineAt: 0,
      deathDeadlineAt: null,
      phaseTimer: null,
      deathTimer: null,
      terminal: false,
    };

    // Load-bearing synchronous edge: the episode and closed route exist before any callback.
    this.usedUpdateIds.add(updateId);
    this.episode = episode;
    this.routeOpenValue = false;
    this.stateValue = "preparing";
    this.armPhaseDeadline(episode);
    for (const member of members.values()) {
      if (member.kind === "renderer") this.queueRendererCommand(member, prepareCommand(episode));
    }
    if (input.service !== undefined) {
      let prepare: Promise<PreparedServiceUpdate>;
      try {
        prepare = Promise.resolve(input.service.prepare(updateId));
      } catch (error) {
        prepare = Promise.reject(error);
      }
      episode.servicePrepare = prepare;
      void prepare.then(
        (handle) => this.servicePrepared(episode, handle),
        (error) => this.servicePrepareFailed(episode, error),
      );
    }
    this.changed();
    void this.advance();
    return Object.freeze({ updateId, completion: completion.promise });
  }

  async acknowledge(
    identity: RendererParticipantIdentity,
    rawAck: unknown,
  ): Promise<UpdateSnapshot> {
    const renderer = this.requireRenderer(identity);
    if (!renderer.connected) throw new Error(`${renderer.participantId} is disconnected`);
    const ack: UpdateAck = PluginUpdateAckParams.parse(rawAck);
    const episode = this.requireEpisode(ack.updateId);
    const member = this.requireRendererMember(episode, renderer);
    if (ack.pluginId !== this.pluginId) throw new Error("plugin update ack names another plugin");

    if (ack.kind === "failed") {
      const error = new Error(`${ack.error.code}: ${ack.error.message}`);
      if (
        ack.at === "prepare" &&
        episode.phase === "preparing" &&
        !episode.commitStarted &&
        member.expected === "prepare" &&
        pendingIs(renderer, "prepare", episode.updateId)
      ) {
        await this.startOldRecovery(episode, error);
        await this.advance();
        return this.snapshot();
      }
      if (
        ack.at === "commit" &&
        episode.phase === "committing" &&
        member.expected === "commit" &&
        pendingIs(renderer, "commit", episode.updateId)
      ) {
        this.forwardFailure(episode, error);
        return this.snapshot();
      }
      if (
        ack.at === "recover-old" &&
        episode.phase === "recovering-old" &&
        member.expected === "recover-old" &&
        pendingIs(renderer, "recover-old", episode.updateId)
      ) {
        this.failClosed(episode, error);
        return this.snapshot();
      }
      throw new Error(`${renderer.participantId}: failed acknowledgement is stale`);
    }

    if (ack.kind === "prepared") {
      if (
        episode.phase !== "preparing" ||
        episode.commitStarted ||
        member.expected !== "prepare" ||
        !pendingIs(renderer, "prepare", episode.updateId)
      )
        throw new Error(`${renderer.participantId}: prepared acknowledgement is stale`);
      if (!sameArtifact(ack.candidateArtifact, episode.candidateArtifact))
        throw new Error(`${renderer.participantId}: prepared artifact mismatch`);
      member.expected = "settled";
      renderer.pending = null;
      this.changed();
      await this.advance();
      return this.snapshot();
    }

    if (ack.kind === "committed") {
      if (
        episode.phase !== "committing" ||
        member.expected !== "commit" ||
        !pendingIs(renderer, "commit", episode.updateId)
      )
        throw new Error(`${renderer.participantId}: commit acknowledgement is stale`);
      if (
        !sameArtifact(ack.candidateArtifact, episode.candidateArtifact) ||
        ack.commitEpoch !== this.commitEpochValue
      )
        throw new Error(`${renderer.participantId}: commit acknowledgement fence mismatch`);
      member.expected = "settled";
      renderer.artifact = episode.candidateArtifact;
      renderer.pending = null;
      this.changed();
      await this.advance();
      return this.snapshot();
    }

    if (
      episode.phase !== "recovering-old" ||
      member.expected !== "recover-old" ||
      !pendingIs(renderer, "recover-old", episode.updateId)
    )
      throw new Error(`${renderer.participantId}: old recovery acknowledgement is stale`);
    if (!sameArtifact(ack.oldArtifact, episode.oldArtifact))
      throw new Error(`${renderer.participantId}: old recovery artifact mismatch`);
    member.expected = "settled";
    renderer.artifact = episode.oldArtifact;
    renderer.pending = null;
    this.changed();
    await this.advance();
    return this.snapshot();
  }

  async abortBeforeCommit(updateId: string, reason: string): Promise<UpdateSnapshot> {
    const episode = this.requireEpisode(updateId);
    if (episode.phase !== "preparing" || episode.commitStarted)
      throw new Error(`${updateId}: retained-old recovery is no longer available`);
    await this.startOldRecovery(episode, new Error(reason));
    await this.advance();
    return this.snapshot();
  }

  snapshot(): UpdateSnapshot {
    const episode = this.episode;
    return PluginUpdateSnapshot.parse({
      generation: this.generation,
      state: this.stateValue,
      currentArtifact: this.currentArtifactValue,
      commitEpoch: this.commitEpochValue,
      recoveryTargets: [...this.recoveryTargets.values()].sort((left, right) =>
        left.participantId.localeCompare(right.participantId),
      ),
      episode:
        episode === null
          ? null
          : {
              updateId: episode.updateId,
              phase: episode.phase,
              oldArtifact: episode.oldArtifact,
              candidateArtifact: episode.candidateArtifact,
              ...(episode.phase === "committing" ? { commitEpoch: this.commitEpochValue } : {}),
              phaseDeadlineAt: episode.phaseDeadlineAt,
              deathDeadlineAt: episode.deathDeadlineAt,
              participants: [...episode.members.values()]
                .map((member) => ({
                  kind: member.kind,
                  participantId: member.participantId,
                  incarnation: member.incarnation,
                  expected: member.expected,
                  connected:
                    member.kind === "service"
                      ? true
                      : (this.renderers.get(member.participantId)?.connected ?? false),
                }))
                .sort((left, right) => left.participantId.localeCompare(right.participantId)),
            },
    });
  }

  private async servicePrepared(
    episode: UpdateEpisode,
    handle: PreparedServiceUpdate,
  ): Promise<void> {
    if (this.episode !== episode || episode.terminal) {
      try {
        await handle.discard();
      } catch {
        // The owning episode is already failed/absent; its diagnostics carry the primary failure.
      }
      return;
    }
    episode.serviceHandle = handle;
    const service = episode.input.service;
    const member = service === undefined ? undefined : episode.members.get(service.participantId);
    if (episode.phase === "preparing" && member?.expected === "prepare") {
      member.expected = "settled";
      this.changed();
      await this.advance();
      return;
    }
    if (episode.phase === "recovering-old") await this.startServiceRecovery(episode);
  }

  private async servicePrepareFailed(episode: UpdateEpisode, error: unknown): Promise<void> {
    if (this.episode !== episode || episode.terminal) return;
    if (episode.phase === "preparing" && !episode.commitStarted) {
      await this.startOldRecovery(episode, asError(error));
      await this.advance();
      return;
    }
    if (episode.phase === "recovering-old") await this.startServiceRecovery(episode);
  }

  private async advance(): Promise<void> {
    // Every mutation queues its own later pass. Coalescing on an in-flight Promise can lose a
    // same-turn acknowledgement after that pass inspected state but before it cleared its guard.
    const task = this.advanceTail.then(() => this.advanceLoop());
    this.advanceTail = task.catch(() => undefined);
    await task;
  }

  private async advanceLoop(): Promise<void> {
    for (;;) {
      const episode = this.episode;
      if (episode === null || episode.terminal) return;
      if (
        episode.phase === "preparing" &&
        !episode.commitStarted &&
        [...episode.members.values()].every((member) => member.expected === "settled")
      ) {
        episode.commitStarted = true;
        this.changed();
        try {
          await episode.input.commitArtifact();
        } catch (error) {
          episode.commitStarted = false;
          await this.startOldRecovery(episode, asError(error));
          continue;
        }
        if (this.episode !== episode || episode.terminal) return;

        episode.logicalCommit = true;
        this.currentArtifactValue = episode.candidateArtifact;
        this.commitEpochValue += 1;
        episode.phase = "committing";
        this.stateValue = "committing";
        this.resolvePendingRecoveryTargets(episode.candidateArtifact, this.commitEpochValue);
        this.armPhaseDeadline(episode);
        for (const member of episode.members.values()) {
          member.expected = member.kind === "service" ? "settled" : "commit";
        }
        this.changed();
        try {
          episode.input.promoteCandidateAuthority?.();
          episode.serviceHandle?.commit();
        } catch (error) {
          this.forwardFailure(episode, asError(error));
          return;
        }
        for (const member of episode.members.values()) {
          if (member.kind === "renderer") {
            this.queueRendererCommand(member, commitCommand(episode, this.commitEpochValue));
          }
        }
        this.changed();
        continue;
      }
      if (
        episode.phase === "committing" &&
        [...episode.members.values()].every((member) => member.expected === "settled")
      ) {
        await this.finishCommitted(episode);
        return;
      }
      if (
        episode.phase === "recovering-old" &&
        [...episode.members.values()].every((member) => member.expected === "settled")
      ) {
        await this.finishOldRecovery(episode);
        return;
      }
      return;
    }
  }

  private async startOldRecovery(episode: UpdateEpisode, _cause: Error): Promise<void> {
    if (this.episode !== episode || episode.terminal) return;
    if (episode.logicalCommit)
      throw new Error(`${episode.updateId}: old recovery is forbidden after logical commit`);
    if (episode.phase === "recovering-old") return;
    episode.phase = "recovering-old";
    this.stateValue = "recovering-old";
    this.resolvePendingRecoveryTargets(episode.oldArtifact, episode.oldCommitEpoch);
    this.armPhaseDeadline(episode);
    this.changed();
    try {
      await episode.input.revokeCandidateSources?.();
      await episode.input.disposeCandidateModuleAuthority?.();
    } catch (error) {
      this.failClosed(episode, asError(error));
      return;
    }
    for (const member of episode.members.values()) {
      member.expected = "recover-old";
      if (member.kind === "renderer") {
        this.queueRendererCommand(member, recoverCommand(episode));
      }
    }
    this.changed();
    if (episode.input.service !== undefined) void this.startServiceRecovery(episode);
  }

  private async startServiceRecovery(episode: UpdateEpisode): Promise<void> {
    if (episode.serviceRecovery !== null) return await episode.serviceRecovery;
    const service = episode.input.service;
    if (service === undefined) return;
    const task = (async () => {
      try {
        const handle = await episode.servicePrepare?.catch(() => null);
        await (handle ?? episode.serviceHandle)?.discard();
        await service.recoverOld(episode.updateId);
        if (this.episode !== episode || episode.phase !== "recovering-old" || episode.terminal)
          return;
        const member = episode.members.get(service.participantId);
        if (member !== undefined) member.expected = "settled";
        this.changed();
        await this.advance();
      } catch (error) {
        this.failClosed(episode, asError(error));
      }
    })();
    episode.serviceRecovery = task;
    return await task;
  }

  private async finishCommitted(episode: UpdateEpisode): Promise<void> {
    if (this.episode !== episode || episode.terminal) return;
    try {
      episode.serviceHandle?.release();
      await episode.input.disposeCandidateModuleAuthority?.();
    } catch (error) {
      this.forwardFailure(episode, asError(error));
      return;
    }
    const outcome: PluginUpdateOutcome = Object.freeze({
      outcome: "committed",
      updateId: episode.updateId,
      currentArtifact: this.currentArtifactValue,
      commitEpoch: this.commitEpochValue,
    });
    this.clearDeadlineTimers(episode);
    episode.terminal = true;
    this.episode = null;
    this.stateValue = "active";
    this.routeOpenValue = true;
    this.changed();
    episode.completion.resolve(outcome);
  }

  private async finishOldRecovery(episode: UpdateEpisode): Promise<void> {
    if (this.episode !== episode || episode.terminal) return;
    try {
      await episode.input.discardArtifact();
    } catch (error) {
      this.failClosed(episode, asError(error));
      return;
    }
    const outcome: PluginUpdateOutcome = Object.freeze({
      outcome: "candidate-failed-old-recovered",
      updateId: episode.updateId,
      currentArtifact: episode.oldArtifact,
      commitEpoch: episode.oldCommitEpoch,
    });
    this.clearDeadlineTimers(episode);
    episode.terminal = true;
    this.currentArtifactValue = episode.oldArtifact;
    this.commitEpochValue = episode.oldCommitEpoch;
    this.episode = null;
    this.stateValue = "active";
    this.routeOpenValue = true;
    this.changed();
    episode.completion.resolve(outcome);
  }

  private forwardFailure(episode: UpdateEpisode, error: Error): void {
    if (this.episode !== episode || episode.terminal) return;
    // The pointer may already be candidate-current. Keep the route closed for forward recovery;
    // never manufacture a retained-old edge after this point.
    this.clearDeadlineTimers(episode);
    episode.terminal = true;
    this.stateValue = "failed";
    this.changed();
    episode.completion.reject(error);
  }

  private failClosed(episode: UpdateEpisode, error: Error): void {
    if (this.episode !== episode || episode.terminal) return;
    this.clearDeadlineTimers(episode);
    episode.terminal = true;
    this.stateValue = "failed";
    this.changed();
    episode.completion.reject(error);
  }

  private armPhaseDeadline(episode: UpdateEpisode): void {
    this.clearDeadlineTimers(episode);
    const duration =
      episode.phase === "preparing"
        ? this.deadlines.prepareMs
        : episode.phase === "committing"
          ? this.deadlines.commitMs
          : this.deadlines.recoveryMs;
    const phase = episode.phase;
    episode.phaseDeadlineAt = safeDeadlineAt(this.now(), duration);
    episode.deathDeadlineAt = null;
    episode.phaseTimer = setTimeout(() => {
      episode.phaseTimer = null;
      void this.phaseDeadlineExpired(episode, phase).catch((error) => {
        this.failClosed(episode, asError(error));
      });
    }, duration);
    episode.phaseTimer.unref?.();
  }

  private async phaseDeadlineExpired(
    episode: UpdateEpisode,
    phase: PluginUpdatePhase,
  ): Promise<void> {
    if (
      this.episode !== episode ||
      episode.terminal ||
      episode.phase !== phase ||
      episode.deathDeadlineAt !== null
    ) {
      return;
    }
    if (phase === "preparing") {
      if (episode.commitStarted) {
        this.failClosed(
          episode,
          new Error(`${episode.updateId}: artifact commit exceeded the prepare phase deadline`),
        );
        return;
      }
      await this.startOldRecovery(
        episode,
        new Error(`${episode.updateId}: renderer/service preparation deadline exceeded`),
      );
      await this.advance();
      return;
    }

    episode.deathDeadlineAt = safeDeadlineAt(this.now(), this.deadlines.boundaryDeathMs);
    episode.deathTimer = setTimeout(() => {
      episode.deathTimer = null;
      if (this.episode !== episode || episode.terminal || episode.phase !== phase) return;
      const unresolved = [...episode.members.values()].filter(
        (member) => member.expected !== "settled",
      );
      if (unresolved.length === 0) {
        void this.advance();
        return;
      }
      this.failClosed(
        episode,
        new Error(
          `${episode.updateId}: ${phase} boundary-death evidence deadline exceeded for ${unresolved
            .map((member) => member.participantId)
            .sort()
            .join(", ")}`,
        ),
      );
    }, this.deadlines.boundaryDeathMs);
    episode.deathTimer.unref?.();
    const requests = [...episode.members.values()]
      .filter(
        (member): member is EpisodeMember & { readonly kind: "renderer" } =>
          member.kind === "renderer" && member.expected !== "settled",
      )
      .map((member) =>
        Promise.resolve(
          this.requestRendererReplacement({
            pluginId: this.pluginId,
            updateId: episode.updateId,
            phase,
            identity: freezeIdentity({
              participantId: member.participantId,
              incarnation: member.incarnation,
            }),
          }),
        ),
      );
    this.changed();
    // Provider refusal/loss is not death and does not shorten the evidence grace.
    void Promise.allSettled(requests);
  }

  private clearDeadlineTimers(episode: UpdateEpisode): void {
    if (episode.phaseTimer !== null) clearTimeout(episode.phaseTimer);
    if (episode.deathTimer !== null) clearTimeout(episode.deathTimer);
    episode.phaseTimer = null;
    episode.deathTimer = null;
  }

  private resolvePendingRecoveryTargets(artifact: PluginUpdateArtifact, commitEpoch: number): void {
    for (const [participantId, target] of this.recoveryTargets) {
      if (target.artifact !== null) continue;
      this.recoveryTargets.set(participantId, Object.freeze({ ...target, artifact, commitEpoch }));
    }
  }

  private queueRendererCommand(member: EpisodeMember, command: PluginUpdateCommand): void {
    const renderer = this.renderers.get(member.participantId);
    if (renderer === undefined || renderer.incarnation !== member.incarnation)
      throw new Error(`${member.participantId}: frozen renderer disappeared without retirement`);
    renderer.pending = command;
    if (renderer.connected) this.deliver(renderer, command);
  }

  private deliver(renderer: RendererSlot, command: PluginUpdateCommand): void {
    try {
      renderer.send(command);
    } catch {
      // Delivery failure is reachability evidence only. Exact reconnect gets the pending command.
      renderer.connected = false;
    }
  }

  private requireRenderer(identity: RendererParticipantIdentity): RendererSlot {
    const parsed = freezeIdentity(identity);
    const renderer = this.renderers.get(parsed.participantId);
    if (renderer === undefined || renderer.incarnation !== parsed.incarnation)
      throw new Error(`${parsed.participantId}: stale renderer incarnation`);
    return renderer;
  }

  private requireEpisode(updateId: string): UpdateEpisode {
    const parsed = PluginUpdateId.parse(updateId);
    if (this.episode === null || this.episode.updateId !== parsed)
      throw new Error(`${parsed}: stale or absent plugin update`);
    if (this.episode.terminal) throw new Error(`${parsed}: plugin update is failed`);
    return this.episode;
  }

  private requireRendererMember(episode: UpdateEpisode, renderer: RendererSlot): EpisodeMember {
    const member = episode.members.get(renderer.participantId);
    if (
      member === undefined ||
      member.kind !== "renderer" ||
      member.incarnation !== renderer.incarnation
    )
      throw new Error(`${renderer.participantId}: renderer is outside the frozen update vote`);
    return member;
  }

  private changed(): void {
    this.generation += 1;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch {
        // Diagnostics observers must not become update participants.
      }
    }
  }
}

function prepareCommand(episode: UpdateEpisode): PluginUpdateCommand {
  return Object.freeze({
    kind: "prepare",
    updateId: episode.updateId,
    oldArtifact: episode.oldArtifact,
    candidateArtifact: episode.candidateArtifact,
  });
}

function commitCommand(episode: UpdateEpisode, commitEpoch: number): PluginUpdateCommand {
  return Object.freeze({
    kind: "commit",
    updateId: episode.updateId,
    candidateArtifact: episode.candidateArtifact,
    commitEpoch,
  });
}

function recoverCommand(episode: UpdateEpisode): PluginUpdateCommand {
  return Object.freeze({
    kind: "recover-old",
    updateId: episode.updateId,
    oldArtifact: episode.oldArtifact,
  });
}

function freezeArtifact(artifact: PluginUpdateArtifact): PluginUpdateArtifact {
  const parsed = PluginUpdateArtifact.parse(artifact);
  return Object.freeze({
    pluginId: parsed.pluginId,
    installRevision: parsed.installRevision,
    manifestHash: parsed.manifestHash,
  });
}

function freezeIdentity(identity: RendererParticipantIdentity): RendererParticipantIdentity {
  const parsed = RendererParticipantIdentity.parse(identity);
  return Object.freeze({
    participantId: parsed.participantId,
    incarnation: parsed.incarnation,
  });
}

function freezeServiceIdentity(
  participantId: string,
  incarnation: string,
): Pick<RendererParticipantIdentity, "participantId" | "incarnation"> {
  const parsed = PluginUpdateParticipant.parse({
    kind: "service",
    participantId,
    incarnation,
    expected: "prepare",
    connected: true,
  });
  return Object.freeze({ participantId: parsed.participantId, incarnation: parsed.incarnation });
}

function sameArtifact(
  left: PluginUpdateArtifact | null,
  right: PluginUpdateArtifact | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.pluginId === right.pluginId &&
    left.installRevision === right.installRevision &&
    left.manifestHash === right.manifestHash
  );
}

function pendingIs(
  renderer: RendererSlot,
  kind: PluginUpdateCommand["kind"],
  updateId: string,
): boolean {
  return renderer.pending?.kind === kind && renderer.pending.updateId === updateId;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function deadline(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error(`plugin update ${label} deadline must be a nonnegative timer duration`);
  }
  return value;
}

function safeDeadlineAt(now: number, duration: number): number {
  const value = Math.trunc(now) + duration;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("plugin update deadline clock is outside the safe integer range");
  }
  return value;
}

function recoveryTargetFor(
  identity: RendererParticipantIdentity,
  episode: UpdateEpisode | null,
  currentArtifact: PluginUpdateArtifact,
  currentCommitEpoch: number,
): PluginUpdateRecoveryTarget {
  const artifact =
    episode === null
      ? currentArtifact
      : episode.phase === "preparing"
        ? null
        : episode.phase === "committing"
          ? episode.candidateArtifact
          : episode.oldArtifact;
  const commitEpoch =
    episode === null
      ? currentCommitEpoch
      : episode.phase === "preparing"
        ? null
        : episode.phase === "committing"
          ? currentCommitEpoch
          : episode.oldCommitEpoch;
  return Object.freeze({
    kind: "renderer",
    participantId: identity.participantId,
    retiredIncarnation: identity.incarnation,
    artifact,
    commitEpoch,
    reason: "boundary-death",
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function mintUpdateId(): string {
  return `pupd_${randomBytes(12).toString("hex")}`;
}
