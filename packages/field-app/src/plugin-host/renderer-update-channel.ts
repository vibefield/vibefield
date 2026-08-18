import {
  type PluginUpdateAckParams,
  PluginUpdateAckParams as PluginUpdateAckParamsSchema,
  PluginUpdateAckResult,
  type PluginUpdateArtifact,
  type PluginUpdateCommand,
  PluginUpdateLeaveResult,
  PluginUpdateParticipantEvent,
  PluginUpdateParticipantSnapshot,
  PluginUpdateSourceReleaseResult,
  PluginUpdateSourceResult,
} from "@vibefield/contracts";
import type { PluginProductClient } from "@vibefield/plugin-sdk";
import { getRendererLogger, type RendererLogger } from "../logging";
import {
  type PluginClientBackend,
  PluginClientLeaseBroker,
  type PluginClientLeaseSeed,
} from "./plugin-client";
import type { RendererReplacementSource } from "./renderer-controller";
import { createRendererModuleLoader } from "./renderer-module-loader";
import {
  RendererUpdateParticipant,
  type RendererUpdateParticipantRuntime,
} from "./renderer-update-participant";

interface SubscriptionHandle {
  readonly snapshot: unknown;
  readonly unsubscribe: () => void;
}

export interface RendererUpdateChannelDeps {
  request(method: string, params?: unknown): Promise<unknown>;
  subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<SubscriptionHandle>;
  readonly backend: PluginClientBackend;
  readonly importModule?: (url: string) => Promise<unknown>;
  readonly makeLeaseBroker?: () => PluginClientLeaseBroker;
  readonly logger?: RendererLogger;
}

/** One plugin/window's authenticated PRC-5e lane.
 *
 * Subscription snapshots survive reconnect, commands are serialized, and a command whose ack was
 * lost is replayed from the cached result rather than running plugin lifecycle twice. Candidate
 * credentials live in one private broker and their source lease is released exactly once.
 */
export class RendererUpdateChannel {
  static async open(
    pluginId: string,
    deps: RendererUpdateChannelDeps,
  ): Promise<RendererUpdateChannel> {
    const channel = new RendererUpdateChannel(pluginId, deps);
    await channel.subscribe();
    return channel;
  }

  private readonly log: RendererLogger;
  private readonly pending: PluginUpdateCommand[] = [];
  private readonly pendingKeys = new Set<string>();
  private readonly ackCache = new Map<string, PluginUpdateAckParams>();
  private subscription: SubscriptionHandle | undefined;
  private participant: RendererUpdateParticipant | undefined;
  private authorizedArtifact: PluginUpdateArtifact | undefined;
  private authorizeResolve!: (artifact: PluginUpdateArtifact) => void;
  private readonly authorized: Promise<PluginUpdateArtifact>;
  private drainTask: Promise<void> | undefined;
  private leaveTask: Promise<void> | undefined;
  private closed = false;

  private constructor(
    readonly pluginId: string,
    private readonly deps: RendererUpdateChannelDeps,
  ) {
    this.log = deps.logger ?? getRendererLogger().child({ component: "plugin.update" });
    this.authorized = new Promise((resolve) => {
      this.authorizeResolve = resolve;
    });
  }

  artifact(): Promise<PluginUpdateArtifact> {
    return this.authorized;
  }

  attach(runtime: RendererUpdateParticipantRuntime): void {
    if (this.closed) throw new Error(`${this.pluginId}: update channel is closed`);
    if (this.participant !== undefined)
      throw new Error(`${this.pluginId}: update participant is already attached`);
    this.participant = new RendererUpdateParticipant(runtime);
    this.scheduleDrain();
  }

  close(): Promise<void> {
    if (this.leaveTask !== undefined) return this.leaveTask;
    this.closed = true;
    this.participant?.close();
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    this.pending.length = 0;
    this.pendingKeys.clear();
    this.leaveTask = (async () => {
      const raw = await this.deps.request("plugins.update.leave", { pluginId: this.pluginId });
      PluginUpdateLeaveResult.parse(raw);
    })();
    return this.leaveTask;
  }

  private async subscribe(): Promise<void> {
    this.subscription = await this.deps.subscribe(
      "plugins.update.subscribe",
      { pluginId: this.pluginId },
      (payload, kind) => this.receive(payload, kind),
    );
    this.receive(this.subscription.snapshot, "snapshot");
  }

  private receive(payload: unknown, kind: "snapshot" | "delta"): void {
    if (this.closed) return;
    if (kind === "snapshot") {
      const parsed = PluginUpdateParticipantSnapshot.safeParse(payload);
      if (!parsed.success || parsed.data.pluginId !== this.pluginId) {
        this.log.warn(
          "renderer.plugins.update_snapshot_rejected",
          "An unreadable renderer update snapshot was rejected",
          { pluginId: this.pluginId, issue: parsed.error?.issues[0]?.message ?? "plugin mismatch" },
        );
        return;
      }
      if (parsed.data.status === "live" && parsed.data.artifact !== null) {
        this.authorize(parsed.data.artifact);
      }
      if (parsed.data.pendingCommand !== null) this.enqueue(parsed.data.pendingCommand);
      if (parsed.data.status === "live" && parsed.data.pendingCommand === null) {
        this.ackCache.clear();
      }
      return;
    }

    const parsed = PluginUpdateParticipantEvent.safeParse(payload);
    if (!parsed.success) {
      this.log.warn(
        "renderer.plugins.update_event_rejected",
        "An unreadable renderer update event was rejected",
        { pluginId: this.pluginId, issue: parsed.error.issues[0]?.message ?? "unknown" },
      );
      return;
    }
    if (parsed.data.kind === "admitted") {
      this.authorize(parsed.data.artifact);
      this.ackCache.clear();
      return;
    }
    this.enqueue(parsed.data.command);
  }

  private authorize(artifact: PluginUpdateArtifact): void {
    if (artifact.pluginId !== this.pluginId) return;
    if (this.authorizedArtifact !== undefined) return;
    this.authorizedArtifact = Object.freeze({ ...artifact });
    this.authorizeResolve(this.authorizedArtifact);
  }

  private enqueue(command: PluginUpdateCommand): void {
    const artifact =
      command.kind === "recover-old" ? command.oldArtifact : command.candidateArtifact;
    if (artifact.pluginId !== this.pluginId) return;
    const key = commandKey(command);
    if (this.pendingKeys.has(key)) return;
    this.pendingKeys.add(key);
    this.pending.push(command);
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.closed || this.participant === undefined || this.drainTask !== undefined) return;
    const task = this.drain();
    this.drainTask = task;
    void task.then(
      () => this.finishDrain(task),
      (error) => {
        this.log.error(
          "renderer.plugins.update_drain_failed",
          "The renderer update command queue stopped unexpectedly",
          error,
          { pluginId: this.pluginId },
        );
        this.finishDrain(task);
      },
    );
  }

  private finishDrain(task: Promise<void>): void {
    if (this.drainTask === task) this.drainTask = undefined;
    if (this.pending.length > 0) this.scheduleDrain();
  }

  private async drain(): Promise<void> {
    while (!this.closed && this.participant !== undefined && this.pending.length > 0) {
      const command = this.pending.shift()!;
      const key = commandKey(command);
      this.pendingKeys.delete(key);
      try {
        const cached = this.ackCache.get(key);
        const ack = cached ?? (await this.execute(command));
        if (this.closed) return;
        this.ackCache.set(key, ack);
        const raw = await this.deps.request("plugins.update.ack", ack);
        PluginUpdateAckResult.parse(raw);
        this.ackCache.delete(key);
      } catch (error) {
        if (this.closed) return;
        this.log.error(
          "renderer.plugins.update_command_failed",
          "A renderer update command could not be completed",
          error,
          { pluginId: this.pluginId, updateId: command.updateId, command: command.kind },
        );
        // A reconnect snapshot carries the still-pending command. Do not spin locally against a
        // failure that may be terminal until fieldd tells us the barrier still expects it.
      }
    }
  }

  private async execute(command: PluginUpdateCommand): Promise<PluginUpdateAckParams> {
    const participant = this.participant!;
    if (command.kind === "commit") return participant.commit(command);
    let source: RendererReplacementSource;
    try {
      source = await this.source(command);
    } catch (error) {
      return failedAck(
        command,
        "renderer-source-unavailable",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (this.closed) {
      await source.releaseAuthority?.();
      return failedAck(command, "renderer-left", "renderer left");
    }
    return command.kind === "prepare"
      ? await participant.prepare(command, source)
      : await participant.recoverOld(command, source);
  }

  private async source(
    command: Exclude<PluginUpdateCommand, { kind: "commit" }>,
  ): Promise<RendererReplacementSource> {
    const purpose = command.kind === "prepare" ? "candidate" : "recover-old";
    const expected = command.kind === "prepare" ? command.candidateArtifact : command.oldArtifact;
    const raw = await this.deps.request("plugins.update.source", {
      pluginId: this.pluginId,
      updateId: command.updateId,
      purpose,
    });
    const source = PluginUpdateSourceResult.parse(raw);
    if (source.updateId !== command.updateId || source.purpose !== purpose) {
      throw new Error(`${this.pluginId}: update source episode mismatch`);
    }
    assertArtifact(source.artifact, expected);
    const broker = this.deps.makeLeaseBroker?.() ?? new PluginClientLeaseBroker();
    broker.setBackend(this.deps.backend);
    let released = false;
    let releaseTask: Promise<void> | undefined;
    const releaseAuthority = (): Promise<void> => {
      if (releaseTask !== undefined) return releaseTask;
      released = true;
      broker.retire(this.pluginId);
      releaseTask = (async () => {
        const result = await this.deps.request("plugins.update.source.release", {
          pluginId: this.pluginId,
          updateId: command.updateId,
          leaseId: source.lease.leaseId,
        });
        PluginUpdateSourceReleaseResult.parse(result);
      })();
      return releaseTask;
    };
    let productClient: PluginProductClient;
    try {
      const seed: PluginClientLeaseSeed = source.lease;
      productClient = broker.createSeededProductClient(
        this.pluginId,
        {
          manifestHash: source.record.manifestHash,
          grantGeneration: source.record.grantGeneration,
        },
        seed,
      );
    } catch (error) {
      await releaseAuthority().catch(() => undefined);
      throw error;
    }
    return Object.freeze({
      record: source.record,
      module: source.module,
      load: createRendererModuleLoader(source.module.moduleUrl, this.deps.importModule),
      productClient,
      refreshCredential: async (
        observation: { readonly manifestHash: string; readonly grantGeneration: number },
        signal: AbortSignal,
      ) => await broker.refresh(this.pluginId, observation, signal),
      releaseAuthority: () => {
        if (released) return releaseTask;
        return releaseAuthority();
      },
    });
  }
}

function commandKey(command: PluginUpdateCommand): string {
  if (command.kind === "prepare") {
    return `${command.updateId}:prepare:${artifactKey(command.oldArtifact)}:${artifactKey(command.candidateArtifact)}`;
  }
  if (command.kind === "commit") {
    return `${command.updateId}:commit:${artifactKey(command.candidateArtifact)}:${command.commitEpoch}`;
  }
  return `${command.updateId}:recover-old:${artifactKey(command.oldArtifact)}`;
}

function artifactKey(artifact: PluginUpdateArtifact): string {
  return `${artifact.pluginId}:${artifact.installRevision}:${artifact.manifestHash}`;
}

function failedAck(
  command: Exclude<PluginUpdateCommand, { kind: "commit" }>,
  code: string,
  message: string,
): PluginUpdateAckParams {
  const artifact = command.kind === "prepare" ? command.candidateArtifact : command.oldArtifact;
  return PluginUpdateAckParamsSchema.parse({
    kind: "failed",
    updateId: command.updateId,
    pluginId: artifact.pluginId,
    at: command.kind === "prepare" ? "prepare" : "recover-old",
    error: { code, message: bounded(message) },
  });
}

function assertArtifact(actual: PluginUpdateArtifact, expected: PluginUpdateArtifact): void {
  if (
    actual.pluginId !== expected.pluginId ||
    actual.installRevision !== expected.installRevision ||
    actual.manifestHash !== expected.manifestHash
  ) {
    throw new Error(`${expected.pluginId}: update source artifact mismatch`);
  }
}

function bounded(value: string): string {
  const message = value.trim() || "renderer update failed";
  return message.slice(0, 500);
}
