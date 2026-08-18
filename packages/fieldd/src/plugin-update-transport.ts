import {
  type CallerContext,
  PluginUpdateAckParams,
  PluginUpdateAckResult,
  type PluginUpdateArtifact,
  type PluginUpdateCommand,
  PluginUpdateLeaveParams,
  PluginUpdateLeaveResult,
  PluginUpdateParticipantEvent,
  PluginUpdateParticipantSnapshot,
  PluginUpdateSourceParams,
  PluginUpdateSourceReleaseParams,
  PluginUpdateSourceReleaseResult,
  PluginUpdateSourceResult,
  PluginUpdateSubscribeParams,
  type RendererParticipantIdentity,
  RendererParticipantIdentity as RendererParticipantIdentitySchema,
} from "@vibefield/contracts";
import { RpcCallError } from "./native-link";
import type { PluginUpdateCoordinator, PluginUpdateSourceFence } from "./plugin-update-coordinator";
import type { Handler, SubscriptionHandler } from "./product-api";

type ParticipantEvent = ReturnType<typeof PluginUpdateParticipantEvent.parse>;
type ParticipantSnapshot = ReturnType<typeof PluginUpdateParticipantSnapshot.parse>;
type SourceResult = ReturnType<typeof PluginUpdateSourceResult.parse>;

/** ProductApi's registration slice. Keeping this structural lets the protocol be proven without a
 * listener or bearer mint while production still uses the exact static method registry. */
export interface PluginUpdateRegistrar {
  register(method: string, handler: Handler): void;
  registerSubscription(method: string, handler: SubscriptionHandler): void;
}

export interface PluginUpdateSourceRequest {
  readonly identity: RendererParticipantIdentity;
  readonly fence: PluginUpdateSourceFence;
  readonly signal?: AbortSignal;
}

export interface PluginUpdateSourceReleaseRequest {
  readonly identity: RendererParticipantIdentity;
  readonly pluginId: string;
  readonly updateId: string;
  readonly leaseId: string;
  readonly signal?: AbortSignal;
}

/** Source minting may perform asynchronous work. Until the transport rechecks the exact member
 * fence, the resulting authority is provisional and must remain synchronously revocable. */
export interface AcquiredPluginUpdateSource {
  readonly value: unknown;
  discard(): void | Promise<void>;
}

export interface PluginUpdateTransportOptions {
  coordinatorFor(pluginId: string): PluginUpdateCoordinator | undefined;
  acquireSource(
    request: PluginUpdateSourceRequest,
  ): AcquiredPluginUpdateSource | Promise<AcquiredPluginUpdateSource>;
  releaseSource(request: PluginUpdateSourceReleaseRequest): boolean | Promise<boolean>;
  retireRenderer(
    pluginId: string,
    identity: RendererParticipantIdentity,
  ): boolean | Promise<boolean>;
}

/** Authenticated Product API adapter for one renderer's PRC-5 update participation.
 *
 * Request bodies never carry participant identity. A shell-minted local window bearer supplies
 * the stable participant plus exact document incarnation, disconnect preserves that coordinator
 * member, and a late source is discarded unless the same pending command still fences it after
 * acquisition completes.
 */
export class PluginUpdateTransport {
  constructor(private readonly options: PluginUpdateTransportOptions) {}

  register(api: PluginUpdateRegistrar): void {
    api.registerSubscription("plugins.update.subscribe", (ctx, raw, emit) =>
      this.subscribe(ctx, raw, emit),
    );
    api.register("plugins.update.ack", (ctx, raw) => this.acknowledge(ctx, raw));
    api.register("plugins.update.source", (ctx, raw) => this.source(ctx, raw));
    api.register("plugins.update.source.release", (ctx, raw) => this.releaseSource(ctx, raw));
    api.register("plugins.update.leave", (ctx, raw) => this.leave(ctx, raw));
  }

  private subscribe(
    ctx: CallerContext,
    raw: unknown,
    emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
  ): {
    readonly snapshot: ParticipantSnapshot;
    readonly dispose: () => void;
    readonly start: () => void;
  } {
    const identity = rendererIdentity(ctx);
    const parsed = PluginUpdateSubscribeParams.safeParse(raw);
    if (!parsed.success) throw invalidParams("plugins.update.subscribe");
    const coordinator = this.coordinator(parsed.data.pluginId);

    let stage: "installing" | "buffering" | "started" | "disposed" = "installing";
    let status: "live" | "held" = "held";
    let initialCommand: PluginUpdateCommand | null = null;
    let unsubscribeCoordinator = (): void => undefined;
    let registered = false;
    const queued: ParticipantEvent[] = [];

    const dispatch = (event: ParticipantEvent): void => {
      if (stage === "disposed") return;
      if (stage === "started") {
        emit(event);
        return;
      }
      queued.push(event);
    };

    const send = (command: PluginUpdateCommand): void => {
      const event = PluginUpdateParticipantEvent.parse({ kind: "command", command });
      if (event.kind !== "command") throw new Error("command projection changed discriminator");
      if (stage === "installing" && initialCommand === null) {
        initialCommand = event.command;
        return;
      }
      dispatch(event);
    };

    let disconnected = false;
    const dispose = (): void => {
      if (stage === "disposed") return;
      stage = "disposed";
      queued.length = 0;
      unsubscribeCoordinator();
      ctx.signal?.removeEventListener("abort", dispose);
      if (!registered || disconnected) return;
      disconnected = true;
      try {
        coordinator.disconnectRenderer(identity);
      } catch {
        // Disposal is idempotent transport cleanup. State conflicts remain visible in the
        // coordinator snapshot; a socket close must not throw into ProductApi's close path.
      }
    };

    try {
      status = coordinator.registerRenderer({
        identity,
        artifact: coordinator.currentArtifact,
        send,
      });
      registered = true;
      stage = "buffering";
      if (status === "held") initialCommand = null;

      const admitIfReady = (
        state: ReturnType<PluginUpdateCoordinator["snapshot"]>["state"],
        announce: boolean,
      ): boolean => {
        if (stage === "disposed" || status !== "held" || state !== "active") return true;
        // Set the local state before admitHeld(): that method emits a synchronous changed event.
        // The reentrant callback observes live and therefore cannot admit twice.
        status = "live";
        let admitted: { readonly artifact: PluginUpdateArtifact; readonly commitEpoch: number };
        try {
          admitted = coordinator.admitHeld(identity);
        } catch {
          status = "held";
          dispose();
          return false;
        }
        if (announce) {
          dispatch(
            PluginUpdateParticipantEvent.parse({
              kind: "admitted",
              artifact: admitted.artifact,
              commitEpoch: admitted.commitEpoch,
            }),
          );
        }
        return true;
      };
      unsubscribeCoordinator = coordinator.subscribe((snapshot) => {
        admitIfReady(snapshot.state, true);
      });
      // A held renderer can disconnect before convergence and reconnect after the final active
      // event was emitted. Admit that exact incumbent now; its subscribe snapshot is the notice.
      if (!admitIfReady(coordinator.snapshot().state, false)) {
        throw new Error("held renderer could not be admitted against the active artifact");
      }
      ctx.signal?.addEventListener("abort", dispose, { once: true });
      if (ctx.signal?.aborted) dispose();

      const snapshot = PluginUpdateParticipantSnapshot.parse(
        status === "held"
          ? {
              pluginId: coordinator.pluginId,
              status,
              artifact: null,
              commitEpoch: null,
              pendingCommand: null,
            }
          : {
              pluginId: coordinator.pluginId,
              status,
              artifact: coordinator.currentArtifact,
              commitEpoch: coordinator.commitEpoch,
              pendingCommand: initialCommand,
            },
      );
      return {
        snapshot,
        dispose,
        start: () => {
          if (stage !== "buffering") return;
          stage = "started";
          while (queued.length > 0 && stage === "started") emit(queued.shift()!);
        },
      };
    } catch (error) {
      dispose();
      if (error instanceof RpcCallError) throw error;
      throw conflict("renderer update subscription was refused", error);
    }
  }

  private async acknowledge(
    ctx: CallerContext,
    raw: unknown,
  ): Promise<ReturnType<typeof PluginUpdateAckResult.parse>> {
    const identity = rendererIdentity(ctx);
    const parsed = PluginUpdateAckParams.safeParse(raw);
    if (!parsed.success) throw invalidParams("plugins.update.ack");
    const coordinator = this.coordinator(parsed.data.pluginId);
    try {
      await coordinator.acknowledge(identity, parsed.data);
    } catch (error) {
      if (error instanceof RpcCallError) throw error;
      throw conflict("renderer update acknowledgement was refused", error);
    }
    return PluginUpdateAckResult.parse({ accepted: true });
  }

  private async source(ctx: CallerContext, raw: unknown): Promise<SourceResult> {
    const identity = rendererIdentity(ctx);
    const parsed = PluginUpdateSourceParams.safeParse(raw);
    if (!parsed.success) throw invalidParams("plugins.update.source");
    const coordinator = this.coordinator(parsed.data.pluginId);
    const firstFence = this.sourceFence(coordinator, identity, parsed.data);

    let acquired: AcquiredPluginUpdateSource;
    try {
      acquired = await this.options.acquireSource({
        identity,
        fence: firstFence,
        ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      });
    } catch (error) {
      if (error instanceof RpcCallError) throw error;
      throw conflict("renderer update source is unavailable", error);
    }

    const discardAndThrow = async (error: RpcCallError): Promise<never> => {
      try {
        await acquired.discard();
      } catch {
        throw new RpcCallError(
          "INTERNAL",
          "stale renderer update authority could not be revoked",
          false,
        );
      }
      throw error;
    };

    const result = PluginUpdateSourceResult.safeParse(acquired.value);
    if (!result.success) {
      return await discardAndThrow(
        new RpcCallError(
          "PRECONDITION_FAILED",
          "renderer update source produced an invalid path-free projection",
          false,
        ),
      );
    }
    if (
      result.data.updateId !== firstFence.updateId ||
      result.data.purpose !== firstFence.purpose ||
      !sameArtifact(result.data.artifact, firstFence.artifact)
    ) {
      return await discardAndThrow(
        new RpcCallError("CONFLICT", "renderer update source crossed its artifact fence", true),
      );
    }
    if (ctx.signal?.aborted) {
      return await discardAndThrow(
        new RpcCallError("CONFLICT", "renderer update source request was cancelled", true),
      );
    }

    let secondFence: PluginUpdateSourceFence;
    try {
      secondFence = coordinator.sourceFence(identity, parsed.data.updateId, parsed.data.purpose);
    } catch (error) {
      return await discardAndThrow(conflict("renderer update source barrier advanced", error));
    }
    if (!sameSourceFence(firstFence, secondFence)) {
      return await discardAndThrow(
        new RpcCallError("CONFLICT", "renderer update source barrier changed", true),
      );
    }
    return result.data;
  }

  private async releaseSource(
    ctx: CallerContext,
    raw: unknown,
  ): Promise<ReturnType<typeof PluginUpdateSourceReleaseResult.parse>> {
    const identity = rendererIdentity(ctx);
    const parsed = PluginUpdateSourceReleaseParams.safeParse(raw);
    if (!parsed.success) throw invalidParams("plugins.update.source.release");
    try {
      const released = await this.options.releaseSource({
        identity,
        ...parsed.data,
        ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      });
      return PluginUpdateSourceReleaseResult.parse({ released });
    } catch (error) {
      if (error instanceof RpcCallError) throw error;
      throw conflict("renderer update source release was refused", error);
    }
  }

  private async leave(
    ctx: CallerContext,
    raw: unknown,
  ): Promise<ReturnType<typeof PluginUpdateLeaveResult.parse>> {
    const identity = rendererIdentity(ctx);
    const parsed = PluginUpdateLeaveParams.safeParse(raw);
    if (!parsed.success) throw invalidParams("plugins.update.leave");
    try {
      const retired = await this.options.retireRenderer(parsed.data.pluginId, identity);
      return PluginUpdateLeaveResult.parse({ retired });
    } catch (error) {
      if (error instanceof RpcCallError) throw error;
      throw conflict("renderer update departure was refused", error);
    }
  }

  private coordinator(pluginId: string): PluginUpdateCoordinator {
    const coordinator = this.options.coordinatorFor(pluginId);
    if (coordinator === undefined || coordinator.pluginId !== pluginId) {
      throw new RpcCallError("NOT_FOUND", `no update coordinator for ${pluginId}`, false);
    }
    return coordinator;
  }

  private sourceFence(
    coordinator: PluginUpdateCoordinator,
    identity: RendererParticipantIdentity,
    params: ReturnType<typeof PluginUpdateSourceParams.parse>,
  ): PluginUpdateSourceFence {
    try {
      return coordinator.sourceFence(identity, params.updateId, params.purpose);
    } catch (error) {
      throw conflict("renderer update source was refused", error);
    }
  }
}

/** Shared local-renderer bearer proof. Runtime diagnostics reuse the proof, not update traffic or
 * coordinator mutation. */
export function rendererIdentity(ctx: CallerContext): RendererParticipantIdentity {
  if (
    ctx.transport !== "ws-loopback" ||
    ctx.clientKind !== "renderer" ||
    ctx.principal.kind !== "local-token" ||
    ctx.principal.rendererParticipant === undefined
  ) {
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      "plugin update participation requires a shell-minted loopback renderer bearer",
      false,
    );
  }
  if (ctx.signal?.aborted) {
    throw new RpcCallError("CONFLICT", "renderer connection is closing", true);
  }
  const parsed = RendererParticipantIdentitySchema.safeParse(ctx.principal.rendererParticipant);
  if (!parsed.success) {
    throw new RpcCallError("PRECONDITION_FAILED", "renderer bearer identity is invalid", false);
  }
  return Object.freeze({
    participantId: parsed.data.participantId,
    incarnation: parsed.data.incarnation,
  });
}

function invalidParams(method: string): RpcCallError {
  return new RpcCallError("PRECONDITION_FAILED", `${method}: invalid parameters`, false);
}

function conflict(message: string, error: unknown): RpcCallError {
  const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : "";
  return new RpcCallError("CONFLICT", `${message}${detail}`, true);
}

function sameArtifact(left: PluginUpdateArtifact, right: PluginUpdateArtifact): boolean {
  return (
    left.pluginId === right.pluginId &&
    left.installRevision === right.installRevision &&
    left.manifestHash === right.manifestHash
  );
}

function sameSourceFence(left: PluginUpdateSourceFence, right: PluginUpdateSourceFence): boolean {
  return (
    left.updateId === right.updateId &&
    left.purpose === right.purpose &&
    sameArtifact(left.artifact, right.artifact)
  );
}
