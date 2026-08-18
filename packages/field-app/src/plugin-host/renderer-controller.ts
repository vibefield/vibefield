import {
  computeEffectiveGrants,
  PLUGIN_LIMITS,
  type PluginManifestV1,
  type PluginModuleUrls,
  type PluginRecord,
  type PluginRegistrySnapshot,
  type PluginUpdateArtifact,
} from "@vibefield/contracts";
import { UnavailableState } from "@vibefield/design-kit";
import {
  type ActivationScope,
  projectPluginAuthority,
  type RendererRuntimeTarget,
  type RuntimeTargetCandidate,
  RuntimeTargetController,
  type RuntimeTargetControllerSnapshot,
  samePluginRuntimeObservation,
} from "@vibefield/plugin-runtime";
import type {
  PluginProductClient,
  RendererPluginModule,
  WidgetBinding,
} from "@vibefield/plugin-sdk";
import { type ComponentType, createElement, type ReactElement, useSyncExternalStore } from "react";
import { BehaviorBindingCatalog } from "./behavior-binding-catalog";
import { BehaviorBreakerLedger } from "./behavior-generation-host";
import { refreshPluginProductClient, retirePluginProductClient } from "./plugin-client";
import { stagePluginStyleLink } from "./plugin-style";
import {
  type ActivatedRenderer,
  type RendererActivationCandidate,
  type RendererActivationDeps,
  RendererActivationStageError,
  stageStagedRenderer,
} from "./renderer-harness";

export const DEFAULT_RENDERER_WINDOW_ID = "field";

interface ControlledRendererTarget extends RendererRuntimeTarget {
  /** Captured from this exact target's canonical projected authority. */
  readonly behaviorAuthorized: boolean;
}

interface ControlledRendererCandidate extends RuntimeTargetCandidate {
  readonly target: ControlledRendererTarget;
  readonly source: RendererReplacementSource;
  readonly activation: ActivatedRenderer;
  readonly inner: RendererActivationCandidate;
}

export interface RendererPluginControllerDeps extends RendererActivationDeps {
  readonly refreshCredential?: (
    pluginId: string,
    observation: { manifestHash: string; grantGeneration: number },
    signal: AbortSignal,
  ) => Promise<void>;
  readonly retireCredential?: (pluginId: string) => void;
  /** Host-mediated stylesheet publication for this exact imported artifact. */
  readonly style?: { readonly document: Document; readonly href: string };
}

/** One exact renderer artifact's activation authority. `load` is invoked by the
 * target controller only after old scope disposal; callers must not import the
 * module before handing this source to prepareReplacement(). */
export interface RendererReplacementSource {
  readonly record: PluginRecord;
  readonly module: PluginModuleUrls;
  readonly load: (signal: AbortSignal) => Promise<RendererPluginModule>;
  /** PRC-5e supplies an update-bound client. A candidate must never borrow the
   * retained old artifact's product credential during private activation. */
  readonly productClient?: PluginProductClient;
  /** Refresh the same authority that backs `productClient` after observation-only grant motion. */
  readonly refreshCredential?: (
    observation: { readonly manifestHash: string; readonly grantGeneration: number },
    signal: AbortSignal,
  ) => Promise<void>;
  /** Idempotent single-flight inverse for candidate module/client authority. Once activation
   * starts the exact ActivationScope owns it; boundary-required exits release it directly. */
  readonly releaseAuthority?: () => void | Promise<void>;
}

export interface PrepareRendererReplacementInput {
  readonly updateId: string;
  readonly oldArtifact: PluginUpdateArtifact;
  readonly candidateArtifact: PluginUpdateArtifact;
  readonly candidate: RendererReplacementSource;
}

export type PrepareRendererReplacementResult =
  | { readonly state: "prepared"; readonly activation: ActivatedRenderer }
  | { readonly state: "failed" | "boundary-required"; readonly error: string };

export interface CommitRendererReplacementInput {
  readonly updateId: string;
  readonly candidateArtifact: PluginUpdateArtifact;
  readonly commitEpoch: number;
}

export interface RecoverOldRendererInput {
  readonly updateId: string;
  readonly oldArtifact: PluginUpdateArtifact;
  readonly source: RendererReplacementSource;
}

export type RecoverOldRendererResult =
  | { readonly state: "recovered-old"; readonly activation: ActivatedRenderer }
  | { readonly state: "failed" | "boundary-required"; readonly error: string };

type RendererReplacementEpisodeState =
  | "preparing"
  | "prepared"
  | "failed"
  | "boundary-required"
  | "recovering-old"
  | "committed"
  | "commit-failed"
  | "left";

interface RendererReplacementEpisode {
  readonly updateId: string;
  readonly oldArtifact: PluginUpdateArtifact;
  readonly candidateArtifact: PluginUpdateArtifact;
  readonly oldSource: RendererReplacementSource;
  readonly oldTarget: ControlledRendererTarget;
  readonly candidateSource: RendererReplacementSource;
  readonly candidateTarget: ControlledRendererTarget;
  candidateObserved: boolean;
  state: RendererReplacementEpisodeState;
}

/** One stable plugin slot in one renderer/window realm. The slot owns ICE-facing facades for the
 * window lifetime while exact artifact sources and activation scopes replace behind it. */
export class RendererPluginController {
  readonly pluginId: string;
  readonly windowId: string;

  private record: PluginRecord;
  private currentSource: RendererReplacementSource;
  private desiredSource:
    | { readonly target: ControlledRendererTarget; readonly source: RendererReplacementSource }
    | undefined;
  private replacementEpisode: RendererReplacementEpisode | undefined;
  private closed = false;
  private currentCandidate: ControlledRendererCandidate | null = null;
  private lastFailure: ActivatedRenderer | null = null;
  private committedBindings: ReadonlyMap<string, WidgetBinding> = new Map();
  private readonly bindingFacades = new Map<string, WidgetBinding>();
  private readonly bindingShapes = new Map<
    string,
    { required: boolean; animated?: boolean; chrome?: unknown; preview?: unknown }
  >();
  private readonly listeners = new Set<() => void>();
  private behaviorCatalog: BehaviorBindingCatalog | undefined;
  private revision = 0;
  private readonly controller: RuntimeTargetController<
    ControlledRendererTarget,
    ControlledRendererCandidate
  >;
  private readonly refreshCredential: NonNullable<
    RendererPluginControllerDeps["refreshCredential"]
  >;
  private readonly retireCredential: NonNullable<RendererPluginControllerDeps["retireCredential"]>;

  constructor(
    initialRecord: PluginRecord,
    module: PluginModuleUrls,
    pluginModule: RendererPluginModule,
    windowId = DEFAULT_RENDERER_WINDOW_ID,
    private readonly deps: RendererPluginControllerDeps = {},
  ) {
    this.pluginId = initialRecord.id;
    this.windowId = windowId;
    this.currentSource = freezeRendererSource({
      record: initialRecord,
      module,
      load: async () => pluginModule,
      ...(deps.productClient === undefined ? {} : { productClient: deps.productClient }),
    });
    this.record = this.currentSource.record;
    this.refreshCredential = deps.refreshCredential ?? refreshPluginProductClient;
    this.retireCredential = deps.retireCredential ?? retirePluginProductClient;
    this.controller = new RuntimeTargetController(`renderer:${this.pluginId}:${this.windowId}`, {
      activate: (target, scope, signal) => this.activate(target, scope, signal),
      refresh: async (_candidate, _previous, next, signal) => {
        const observation = {
          manifestHash: next.artifact.manifestHash,
          grantGeneration: next.observedGrantGeneration,
        };
        const desired = this.desiredSource;
        if (
          desired?.source.refreshCredential !== undefined &&
          samePluginRuntimeObservation(desired.target, next)
        ) {
          await desired.source.refreshCredential(observation, signal);
        } else {
          await this.refreshCredential(this.pluginId, observation, signal);
        }
        // `canvas.write` is part of renderer semantic authority, so it can never change in this
        // observation-only path. Do not recompute authorization from mutable registry state.
      },
      termination: { kind: "same-realm" },
      // The harness owns the exact §10.4 race. The small outer margin prevents two independent
      // timers from assigning different failure meanings to the same attempt.
      activationDeadlineMs: PLUGIN_LIMITS.RENDERER_ACTIVATE_DEADLINE_MS + 50,
      disposalDeadlineMs: PLUGIN_LIMITS.DEACTIVATE_DEADLINE_MS,
    });
  }

  get activation(): ActivatedRenderer | null {
    return this.currentCandidate?.activation ?? this.lastFailure;
  }

  get snapshot() {
    return this.controller.snapshot();
  }

  isActiveArtifact(artifact: PluginUpdateArtifact): boolean {
    const snapshot = this.controller.snapshot();
    return (
      snapshot.state === "active" &&
      snapshot.committed?.pluginId === artifact.pluginId &&
      snapshot.committed.artifact.installRevision === artifact.installRevision &&
      snapshot.committed.artifact.manifestHash === artifact.manifestHash
    );
  }

  /** Window-owner injection. Must happen before the first activation attempt. */
  attachBehaviorCatalog(catalog: BehaviorBindingCatalog): void {
    if (this.behaviorCatalog === catalog) return;
    if (this.behaviorCatalog !== undefined) {
      throw new Error(`${this.pluginId}: renderer controller already has a behavior catalog`);
    }
    const snapshot = this.controller.snapshot();
    if (snapshot.state !== "inactive" || snapshot.desired !== null) {
      throw new Error(`${this.pluginId}: behavior catalog must attach before renderer activation`);
    }
    this.behaviorCatalog = catalog;
  }

  /** Stable ICE-facing binding. Code components dereference the currently committed activation;
   * artifact-scoped chrome/animation/preview metadata is sealed on first registry construction. */
  widgetBinding(type: string, surface: "dom" | "gl"): WidgetBinding {
    const cached = this.bindingFacades.get(type);
    if (cached !== undefined) return cached;
    const initial = this.committedBindings.get(type);
    const DynamicComponent = (props: Record<string, unknown>): ReactElement | null => {
      useSyncExternalStore(
        (notify) => this.subscribe(notify),
        () => this.revision,
        () => this.revision,
      );
      const component = this.committedBindings.get(type)?.component;
      if (component === undefined) {
        if (surface === "gl") return null;
        return createElement(UnavailableState, {
          title: type,
          description:
            this.lastFailure?.error === undefined
              ? "renderer unavailable — content preserved"
              : `renderer failed: ${this.lastFailure.error}`,
        });
      }
      return createElement(component as ComponentType<Record<string, unknown>>, props);
    };
    DynamicComponent.displayName = `RendererTarget(${type})`;
    const metadata = {
      ...(initial?.animated === undefined ? {} : { animated: initial.animated }),
      ...(initial?.chrome === undefined ? {} : { chrome: initial.chrome }),
      ...(initial?.preview === undefined ? {} : { preview: initial.preview }),
    };
    this.bindingShapes.set(type, { required: initial !== undefined, ...metadata });
    const facade: WidgetBinding = { component: DynamicComponent, ...metadata };
    this.bindingFacades.set(type, facade);
    return facade;
  }

  /** Reconcile one durable observation. During a replacement episode, exact old and candidate
   * observations are consumed by the episode instead of the boot-static live path: the candidate
   * pointer necessarily arrives before the later explicit commit command. */
  async reconcile(record: PluginRecord | null): Promise<ActivatedRenderer | null> {
    if (record !== null && record.id !== this.pluginId)
      throw new Error(`renderer controller ${this.pluginId} cannot observe ${record.id}`);
    const episode = this.replacementEpisode;
    if (episode !== undefined) return await this.reconcileReplacementObservation(record, episode);
    if (record !== null) this.record = record;

    const observedSource =
      record !== null && sourceMatchesRecord(this.currentSource, record)
        ? freezeRendererSource({ ...this.currentSource, record })
        : undefined;
    const target = this.targetFor(record, this.currentSource.module);
    this.desiredSource =
      target === null || observedSource === undefined
        ? undefined
        : { target, source: observedSource };
    this.controller.setDesired(target, {
      reason:
        target === null
          ? {
              kind: record?.enabled === false ? "disable" : "target-changed",
              detail: this.pluginId,
            }
          : { kind: "target-changed", detail: this.pluginId },
    });
    const settled = await this.controller.settle({ deadlineMs: this.settleDeadline() });
    if (!samePluginRuntimeObservation(this.controller.desired, target)) return this.activation;
    if (observedSource !== undefined) this.currentSource = observedSource;
    this.applySettledState(target, settled);
    return this.activation;
  }

  /** PRC-5d: break old authority, import/evaluate the explicit candidate only after old scope
   * quiescence, and hold all candidate publication behind RuntimeTargetController.prepared. */
  async prepareReplacement(
    input: PrepareRendererReplacementInput,
  ): Promise<PrepareRendererReplacementResult> {
    this.assertOpen();
    assertUpdateId(input.updateId);
    if (this.replacementEpisode !== undefined)
      throw new Error(`${this.pluginId}: renderer replacement already owns an update episode`);
    assertSourceIdentity(input.candidate, input.candidateArtifact);
    if (input.candidateArtifact.pluginId !== this.pluginId)
      throw new Error(`${this.pluginId}: renderer replacement candidate belongs to another plugin`);
    if (!/^[0-9a-f]{64}$/.test(input.candidateArtifact.installRevision))
      throw new Error(`${this.pluginId}: candidate renderer requires a complete artifact revision`);
    assertArtifactIdentity(
      artifactForSource(this.currentSource),
      input.oldArtifact,
      "old artifact",
    );
    if (sameArtifactIdentity(input.oldArtifact, input.candidateArtifact))
      throw new Error(`${this.pluginId}: renderer replacement candidate equals retained old`);
    if (!sameFixedWidgetProjection(this.currentSource.record, input.candidate.record)) {
      throw new Error(
        `${this.pluginId}: renderer replacement changes the fixed widget projection; replace the document generation`,
      );
    }

    const oldTarget = this.targetFor(this.currentSource.record, this.currentSource.module);
    const candidateSource = freezeRendererSource(input.candidate);
    const candidateTarget = this.targetFor(candidateSource.record, candidateSource.module);
    if (oldTarget === null)
      throw new Error(`${this.pluginId}: retained old renderer artifact has no runnable target`);
    if (candidateTarget === null)
      throw new Error(`${this.pluginId}: candidate renderer artifact has no runnable target`);
    const episode: RendererReplacementEpisode = {
      updateId: input.updateId,
      oldArtifact: Object.freeze({ ...input.oldArtifact }),
      candidateArtifact: Object.freeze({ ...input.candidateArtifact }),
      oldSource: this.currentSource,
      oldTarget,
      candidateSource,
      candidateTarget,
      candidateObserved: false,
      state: "preparing",
    };
    this.replacementEpisode = episode;
    this.desiredSource = { target: candidateTarget, source: candidateSource };
    this.controller.prepareDesired(candidateTarget, {
      reason: { kind: "reload", detail: input.updateId },
    });
    const settled = await this.controller.settle({ deadlineMs: this.settleDeadline() });
    if (this.replacementEpisode !== episode || episode.state === "left") {
      return { state: "failed", error: `${this.pluginId}: renderer left during preparation` };
    }
    const prepared = this.controller.preparedCandidate;
    if (
      settled.state === "prepared" &&
      prepared !== undefined &&
      prepared.source === candidateSource &&
      samePluginRuntimeObservation(settled.desired, candidateTarget)
    ) {
      episode.state = "prepared";
      return { state: "prepared", activation: prepared.activation };
    }
    if (settled.state === "non-quiescent") {
      episode.state = "boundary-required";
      // A same-realm boundary verdict is terminal for this activation attempt. The generic target
      // controller normally resumes its desired target if cleanup becomes quiescent later; cancel
      // that desire now so a candidate cannot import after we have told the coordinator that only
      // renderer-boundary replacement may make progress.
      this.desiredSource = undefined;
      this.controller.setDesired(null, {
        reason: { kind: "target-changed", detail: `${input.updateId}:boundary-required` },
      });
      await releaseRendererSourceAuthority(candidateSource);
      this.applySettledState(candidateTarget, settled);
      return {
        state: "boundary-required",
        error: settled.error ?? "the previous renderer activation is still draining",
      };
    }
    episode.state = "failed";
    this.applySettledState(candidateTarget, settled);
    return {
      state: "failed",
      error: settled.error ?? this.lastFailure?.error ?? "candidate renderer activation failed",
    };
  }

  /** The synchronous renderer publication/ack edge. The authenticated command is fieldd's proof
   * that the candidate pointer is current; unrelated registry movement already invalidates the
   * episode in reconcileReplacementObservation(). */
  commitReplacement(input: CommitRendererReplacementInput): ActivatedRenderer {
    const episode = this.requireEpisode(input.updateId);
    if (episode.state !== "prepared")
      throw new Error(`${this.pluginId}: renderer candidate is not prepared`);
    assertArtifactIdentity(
      episode.candidateArtifact,
      input.candidateArtifact,
      "candidate artifact",
    );
    if (!Number.isSafeInteger(input.commitEpoch) || input.commitEpoch <= 0)
      throw new Error(`${this.pluginId}: renderer commit epoch must be positive`);
    try {
      const settled = this.controller.commitPrepared();
      if (
        settled.state !== "active" ||
        !samePluginRuntimeObservation(settled.committed, episode.candidateTarget)
      ) {
        throw new Error(`${this.pluginId}: renderer did not commit its exact candidate target`);
      }
    } catch (error) {
      episode.state = "commit-failed";
      throw error;
    }
    const activation = this.currentCandidate?.activation;
    if (activation === undefined)
      throw new Error(`${this.pluginId}: committed renderer candidate has no activation`);
    episode.state = "committed";
    if (episode.candidateObserved) this.replacementEpisode = undefined;
    return activation;
  }

  /** Pre-commit retained-old recovery. `source.module.moduleUrl` must be freshly minted so browser
   * ESM caching cannot return the disposed namespace from before the update. */
  async recoverOld(input: RecoverOldRendererInput): Promise<RecoverOldRendererResult> {
    const episode = this.requireEpisode(input.updateId);
    if (episode.state === "boundary-required") {
      return {
        state: "boundary-required",
        error: `${this.pluginId}: same-realm non-quiescence requires renderer boundary replacement`,
      };
    }
    if (episode.state !== "prepared" && episode.state !== "failed")
      throw new Error(`${this.pluginId}: retained-old recovery is not available`);
    assertSourceIdentity(input.source, input.oldArtifact);
    assertArtifactIdentity(episode.oldArtifact, input.oldArtifact, "old artifact");
    if (input.source.module.moduleUrl === episode.oldSource.module.moduleUrl) {
      throw new Error(`${this.pluginId}: retained-old recovery requires a fresh module URL`);
    }
    if (!sameFixedWidgetProjection(episode.oldSource.record, input.source.record)) {
      throw new Error(
        `${this.pluginId}: retained-old recovery changed the fixed widget projection`,
      );
    }
    const source = freezeRendererSource(input.source);
    const target = this.targetFor(source.record, source.module);
    if (target === null) throw new Error(`${this.pluginId}: retained old renderer is not runnable`);
    episode.state = "recovering-old";
    this.desiredSource = { target, source };
    this.controller.setDesired(target, {
      reason: { kind: "reload", detail: `${input.updateId}:recover-old` },
    });
    const settled = await this.controller.settle({ deadlineMs: this.settleDeadline() });
    const recovered = this.currentCandidate;
    if (
      settled.state === "active" &&
      samePluginRuntimeObservation(settled.committed, target) &&
      recovered?.source === source
    ) {
      const activation = recovered.activation;
      this.replacementEpisode = undefined;
      return { state: "recovered-old", activation };
    }
    if (settled.state === "non-quiescent") {
      episode.state = "boundary-required";
      this.applySettledState(target, settled);
      return {
        state: "boundary-required",
        error: settled.error ?? "the renderer realm is still draining",
      };
    }
    episode.state = "failed";
    this.applySettledState(target, settled);
    return {
      state: "failed",
      error: settled.error ?? this.lastFailure?.error ?? "retained old renderer recovery failed",
    };
  }

  async close(): Promise<void> {
    if (this.closed && this.controller.state === "inactive") return;
    this.closed = true;
    if (this.replacementEpisode !== undefined) this.replacementEpisode.state = "left";
    this.desiredSource = undefined;
    this.controller.setDesired(null, {
      reason: { kind: "window-close", detail: this.windowId },
    });
    const settled = await this.controller.settle({ deadlineMs: this.settleDeadline() });
    if (
      settled.state !== "inactive" ||
      settled.committed !== null ||
      settled.activeScope !== null ||
      settled.blocked !== null
    ) {
      throw new Error(
        `${this.pluginId}: renderer target did not quiesce during window close (${settled.state})`,
      );
    }
  }

  private targetFor(
    record: PluginRecord | null,
    module: PluginModuleUrls,
  ): ControlledRendererTarget | null {
    if (record === null || !record.enabled || record.renderer === "none") return null;
    if (
      record.installRevision !== module.installRevision ||
      record.manifestHash !== module.manifestHash
    ) {
      return null;
    }
    const authority = projectPluginAuthority("renderer", record.grantedCapabilities);
    return {
      face: "renderer",
      pluginId: record.id,
      artifact: {
        installRevision: module.installRevision,
        manifestHash: module.manifestHash,
      },
      instanceKey: { windowId: this.windowId },
      authorityFingerprint: authority.fingerprint,
      observedGrantGeneration: record.grantGeneration,
      behaviorAuthorized: authority.capabilities.includes("canvas.write"),
    };
  }

  private async reconcileReplacementObservation(
    record: PluginRecord | null,
    episode: RendererReplacementEpisode,
  ): Promise<ActivatedRenderer | null> {
    const oldObservation = this.targetFor(record, episode.oldSource.module);
    const candidateObservation = this.targetFor(record, episode.candidateSource.module);
    if (samePluginRuntimeObservation(candidateObservation, episode.candidateTarget)) {
      episode.candidateObserved = true;
      if (record !== null) {
        this.record = record;
        if (episode.state === "committed") {
          this.currentSource = freezeRendererSource({ ...episode.candidateSource, record });
          this.replacementEpisode = undefined;
        }
      }
      return this.activation;
    }
    if (samePluginRuntimeObservation(oldObservation, episode.oldTarget)) {
      // An old snapshot may already be queued when the authenticated commit command arrives.
      // Preserve the committed candidate until the exact candidate observation catches up.
      if (episode.state !== "committed" && episode.state !== "commit-failed" && record !== null)
        this.record = record;
      return this.activation;
    }

    episode.state = "failed";
    this.desiredSource = undefined;
    this.controller.setDesired(null, {
      reason: { kind: "target-changed", detail: `${episode.updateId}:unrelated-observation` },
    });
    const settled = await this.controller.settle({ deadlineMs: this.settleDeadline() });
    this.applySettledState(null, settled);
    return this.activation;
  }

  private applySettledState(
    target: ControlledRendererTarget | null,
    settled: RuntimeTargetControllerSnapshot<ControlledRendererTarget>,
  ): void {
    if (settled.state === "non-quiescent") {
      this.lastFailure = {
        state: "non-quiescent",
        bindings: new Map(),
        behaviors: new Map(),
        error: "the previous renderer activation is still draining",
        ...(settled.blocked?.report === undefined ? {} : { cleanup: settled.blocked.report }),
      };
      this.publishBindings();
    } else if (target !== null && settled.state === "failed" && this.lastFailure === null) {
      this.lastFailure = {
        state: "failed",
        bindings: new Map(),
        behaviors: new Map(),
        error: settled.error ?? "renderer activation failed",
      };
      this.publishBindings();
    } else if (target === null && settled.state === "inactive" && this.lastFailure !== null) {
      this.lastFailure = null;
      this.publishBindings();
    }
  }

  private requireEpisode(updateId: string): RendererReplacementEpisode {
    const episode = this.replacementEpisode;
    if (episode === undefined) throw new Error(`${this.pluginId}: no renderer update episode`);
    if (episode.updateId !== updateId)
      throw new Error(`${this.pluginId}: stale renderer update id ${updateId}`);
    return episode;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error(`${this.pluginId}: renderer controller is closed`);
  }

  private async activate(
    target: ControlledRendererTarget,
    scope: ActivationScope,
    signal: AbortSignal,
  ): Promise<ControlledRendererCandidate> {
    if (signal.aborted) throw new Error(`${this.pluginId}: renderer target superseded`);
    const desired = this.desiredSource;
    if (desired === undefined || !samePluginRuntimeObservation(desired.target, target)) {
      throw new Error(`${this.pluginId}: renderer activation has no exact artifact source`);
    }
    const source = desired.source;
    let candidate: ControlledRendererCandidate | undefined;
    let inner: RendererActivationCandidate;
    try {
      if (source.releaseAuthority !== undefined) {
        scope.track("renderer:source-authority", {
          dispose: source.releaseAuthority,
        });
      }
      const pluginModule = await source.load(signal);
      if (signal.aborted)
        throw new Error(`${this.pluginId}: renderer target superseded during import`);
      const { productClient: _controllerProductClient, ...activationDeps } = this.deps;
      inner = await stageStagedRenderer(source.record, source.module, pluginModule, {
        ...activationDeps,
        ...(source.productClient === undefined ? {} : { productClient: source.productClient }),
        ownerScope: scope,
        validateWidgetBinding: (type, binding) => this.assertBindingShape(type, binding),
        onWidgetBindingsChanged: () => {
          if (candidate !== undefined && this.currentCandidate === candidate) {
            this.publishBindings();
          }
        },
      });
      inner.setBehaviorAuthorization(target.behaviorAuthorized);
      if (inner.activation.behaviors.size > 0 && this.behaviorCatalog === undefined) {
        throw new Error(`${this.pluginId}: behavior bindings require a window catalog owner`);
      }
    } catch (error) {
      if (error instanceof RendererActivationStageError && !signal.aborted) {
        this.lastFailure = error.activation;
        this.publishBindings();
      }
      if (source.releaseAuthority === undefined) this.retireCredential(this.pluginId);
      throw error;
    }

    const style =
      this.deps.style === undefined || source.module.styleUrl === undefined
        ? undefined
        : stagePluginStyleLink(
            this.deps.style.document,
            this.pluginId,
            source.module.installRevision,
            source.module.styleUrl,
          );
    const candidateToken = {};
    const withdraw = (): void => {
      this.behaviorCatalog?.withdrawCandidate(this.pluginId, candidateToken);
      style?.dispose();
      if (candidate !== undefined && this.currentCandidate === candidate) {
        this.currentCandidate = null;
        this.committedBindings = new Map();
        this.publishBindings();
      }
    };
    signal.addEventListener("abort", withdraw, { once: true });
    candidate = {
      target,
      source,
      activation: inner.activation,
      inner,
      commit: () => {
        const current = candidate;
        if (current === undefined)
          throw new Error(`${this.pluginId}: renderer candidate was not constructed`);
        if (signal.aborted) throw new Error(`${this.pluginId}: stale renderer candidate`);
        this.assertBindingShapes(inner.activation.bindings);
        this.currentSource = source;
        this.record = source.record;
        this.currentCandidate = current;
        // Keep the exact attempt map: an open context may acquire/release declared bindings after
        // activation, and the controller hooks above advance the stable facade's revision.
        this.committedBindings = inner.activation.bindings;
        this.lastFailure = null;
        try {
          style?.commit();
          inner.commit();
          if (signal.aborted)
            throw new Error(`${this.pluginId}: renderer target changed during commit`);
          if (inner.activation.behaviors.size > 0) {
            this.behaviorCatalog?.publishCandidate(
              this.pluginId,
              candidateToken,
              target,
              inner.activation.behaviors,
            );
          }
          if (signal.aborted)
            throw new Error(`${this.pluginId}: renderer target changed during behavior commit`);
        } catch (error) {
          withdraw();
          throw error;
        }
        this.publishBindings();
      },
      dispose: async () => {
        signal.removeEventListener("abort", withdraw);
        withdraw();
        if (source.releaseAuthority === undefined) this.retireCredential(this.pluginId);
        await inner.dispose();
      },
    };
    return candidate;
  }

  private subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publishBindings(): void {
    this.revision += 1;
    for (const listener of [...this.listeners]) listener();
  }

  private assertBindingShapes(bindings: ReadonlyMap<string, WidgetBinding>): void {
    for (const [type, shape] of this.bindingShapes) {
      const next = bindings.get(type);
      if (next === undefined) {
        if (shape.required)
          throw new Error(`${this.pluginId}: renderer replacement omitted widget binding ${type}`);
        continue;
      }
      this.assertBindingShape(type, next);
    }
  }

  private assertBindingShape(type: string, next: WidgetBinding): void {
    const shape = this.bindingShapes.get(type);
    if (shape === undefined) return;
    if (
      next.animated !== shape.animated ||
      !sameOpaqueBindingValue(next.chrome, shape.chrome) ||
      !sameOpaqueBindingValue(next.preview, shape.preview)
    ) {
      throw new Error(
        `${this.pluginId}: renderer replacement changed fixed binding metadata for ${type}`,
      );
    }
  }

  private settleDeadline(): number {
    return (
      PLUGIN_LIMITS.RENDERER_ACTIVATE_DEADLINE_MS + PLUGIN_LIMITS.DEACTIVATE_DEADLINE_MS * 2 + 100
    );
  }
}

function sameOpaqueBindingValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null)
    return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function freezeRendererSource(source: RendererReplacementSource): RendererReplacementSource {
  // The source has already crossed the contract boundary. Clone here instead of reparsing so this
  // ownership cut does not silently normalize it a second time. The recursive freeze makes
  // accidental host mutation visible too: validation and delayed activation must see one snapshot.
  const record = freezeSnapshot(structuredClone(source.record));
  const module = freezeSnapshot(structuredClone(source.module));
  return Object.freeze({
    record,
    module,
    load: source.load,
    ...(source.productClient === undefined ? {} : { productClient: source.productClient }),
    ...(source.refreshCredential === undefined
      ? {}
      : { refreshCredential: source.refreshCredential }),
    ...(source.releaseAuthority === undefined
      ? {}
      : { releaseAuthority: onceAsync(source.releaseAuthority) }),
  });
}

async function releaseRendererSourceAuthority(source: RendererReplacementSource): Promise<void> {
  await source.releaseAuthority?.();
}

function onceAsync(dispose: () => void | Promise<void>): () => Promise<void> {
  let task: Promise<void> | undefined;
  return () => {
    task ??= Promise.resolve().then(dispose);
    return task;
  };
}

function freezeSnapshot<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeSnapshot(child);
  return Object.freeze(value);
}

function sourceMatchesRecord(source: RendererReplacementSource, record: PluginRecord): boolean {
  return (
    source.module.pluginId === record.id &&
    source.module.installRevision === record.installRevision &&
    source.module.manifestHash === record.manifestHash
  );
}

function artifactForSource(source: RendererReplacementSource): PluginUpdateArtifact {
  return {
    pluginId: source.module.pluginId,
    installRevision: source.module.installRevision,
    manifestHash: source.module.manifestHash,
  };
}

function sameArtifactIdentity(left: PluginUpdateArtifact, right: PluginUpdateArtifact): boolean {
  return (
    left.pluginId === right.pluginId &&
    left.installRevision === right.installRevision &&
    left.manifestHash === right.manifestHash
  );
}

function assertArtifactIdentity(
  actual: PluginUpdateArtifact,
  expected: PluginUpdateArtifact,
  label: string,
): void {
  if (!sameArtifactIdentity(actual, expected)) {
    throw new Error(`${label} identity does not match the renderer source`);
  }
}

function assertSourceIdentity(
  source: RendererReplacementSource,
  expected: PluginUpdateArtifact,
): void {
  if (!sourceMatchesRecord(source, source.record)) {
    throw new Error(`${expected.pluginId}: renderer source record and module identity disagree`);
  }
  assertArtifactIdentity(artifactForSource(source), expected, "renderer source artifact");
}

function assertUpdateId(updateId: string): void {
  if (!/^pupd_[A-Za-z0-9_-]+$/.test(updateId) || updateId.length > 128)
    throw new Error("invalid plugin update id");
}

function canonicalOpaqueJson(value: unknown): string {
  const visit = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(visit);
    if (entry !== null && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, visit(child)]),
      );
    }
    return entry;
  };
  return JSON.stringify(visit(value));
}

function sameFixedWidgetProjection(old: PluginRecord, candidate: PluginRecord): boolean {
  return (
    canonicalOpaqueJson(old.contributions.widgets) ===
    canonicalOpaqueJson(candidate.contributions.widgets)
  );
}

/** One window's imported renderer set. It projects each registry snapshot onto only the artifacts
 * this boot actually approved and waits every exact controller during window close. */
export class RendererWindowController {
  /** Code-bearing renderer truth consumed by each committed document generation. */
  readonly behaviorCatalog = new BehaviorBindingCatalog();
  /** Chronic breaker state survives document/engine replacement within this window. */
  readonly behaviorLedger = new BehaviorBreakerLedger();

  private readonly controllers = new Map<string, RendererPluginController>();
  private readonly inFlight = new Set<Promise<void>>();
  private closeTask: Promise<void> | undefined;
  private closed = false;

  constructor(readonly windowId = DEFAULT_RENDERER_WINDOW_ID) {}

  add(controller: RendererPluginController): void {
    if (this.closed) throw new Error("renderer window controller is closed");
    if (controller.windowId !== this.windowId)
      throw new Error(
        `renderer controller window ${controller.windowId} does not belong to ${this.windowId}`,
      );
    if (this.controllers.has(controller.pluginId))
      throw new Error(`renderer controller already exists for ${controller.pluginId}`);
    controller.attachBehaviorCatalog(this.behaviorCatalog);
    this.controllers.set(controller.pluginId, controller);
  }

  controller(pluginId: string): RendererPluginController | undefined {
    return this.controllers.get(pluginId);
  }

  isActiveArtifact(artifact: PluginUpdateArtifact): boolean {
    return this.controllers.get(artifact.pluginId)?.isActiveArtifact(artifact) ?? false;
  }

  prepareReplacement(
    input: PrepareRendererReplacementInput,
  ): Promise<PrepareRendererReplacementResult> {
    if (this.closed) return Promise.reject(new Error("renderer window controller is closed"));
    const controller = this.requireController(input.candidateArtifact.pluginId);
    return this.track(controller.prepareReplacement(input));
  }

  commitReplacement(input: CommitRendererReplacementInput): ActivatedRenderer {
    if (this.closed) throw new Error("renderer window controller is closed");
    return this.requireController(input.candidateArtifact.pluginId).commitReplacement(input);
  }

  recoverOld(input: RecoverOldRendererInput): Promise<RecoverOldRendererResult> {
    if (this.closed) return Promise.reject(new Error("renderer window controller is closed"));
    const controller = this.requireController(input.oldArtifact.pluginId);
    return this.track(controller.recoverOld(input));
  }

  /** DEV-only fallback bridge. Production staged artifacts always publish through a controller. */
  publishBundled(manifest: PluginManifestV1, activation: ActivatedRenderer): void {
    if (this.closed) throw new Error("renderer window controller is closed");
    if (activation.state !== "active" || activation.behaviors.size === 0) return;
    const effective = computeEffectiveGrants({
      requested: manifest.capabilities,
      hasRenderer: manifest.entries?.renderer !== undefined,
      hasService: manifest.entries?.service !== undefined,
      source: "bundled",
    }).granted;
    const authority = projectPluginAuthority("renderer", effective);
    this.behaviorCatalog.publishCandidate(
      manifest.id,
      {},
      {
        face: "renderer",
        pluginId: manifest.id,
        artifact: {
          installRevision: `dev-bundled:${manifest.version}`,
          manifestHash: `dev-bundled:${manifest.id}@${manifest.version}`,
        },
        instanceKey: { windowId: this.windowId },
        authorityFingerprint: authority.fingerprint,
        observedGrantGeneration: 0,
      },
      activation.behaviors,
    );
  }

  reconcile(snapshot: PluginRegistrySnapshot): Promise<void> {
    if (this.closed) return this.closeTask ?? Promise.resolve();
    const records = new Map(snapshot.plugins.map((record) => [record.id, record]));
    // Calling each controller before the first await is load-bearing: setDesired closes stale
    // authority synchronously even while an earlier observation is still draining.
    const task = Promise.all(
      [...this.controllers.values()].map(async (controller) => {
        await controller.reconcile(records.get(controller.pluginId) ?? null);
      }),
    ).then(() => undefined);
    this.inFlight.add(task);
    void task.then(
      () => this.inFlight.delete(task),
      () => this.inFlight.delete(task),
    );
    return task;
  }

  private requireController(pluginId: string): RendererPluginController {
    const controller = this.controllers.get(pluginId);
    if (controller === undefined)
      throw new Error(`renderer window ${this.windowId} has no participant for ${pluginId}`);
    return controller;
  }

  private track<T>(task: Promise<T>): Promise<T> {
    const fence = task.then(() => undefined);
    this.inFlight.add(fence);
    void fence.then(
      () => this.inFlight.delete(fence),
      () => this.inFlight.delete(fence),
    );
    return task;
  }

  close(): Promise<void> {
    if (this.closeTask !== undefined) return this.closeTask;
    this.closed = true;
    let resolveClose!: () => void;
    let rejectClose!: (error: unknown) => void;
    this.closeTask = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    const pending = [...this.inFlight];
    // Every close edge runs now; only observation waits are asynchronous.
    const closing = [...this.controllers.values()].map(async (controller) => controller.close());
    // Controller abort listeners have withdrawn their exact rows synchronously. This final fence
    // prevents any orphaned or reentrant publication from surviving window close.
    this.behaviorCatalog.close();
    void Promise.allSettled([...pending, ...closing]).then((results) => {
      const failures = results.flatMap((result) =>
        result.status === "rejected"
          ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
          : [],
      );
      if (failures.length > 0) {
        rejectClose(
          new Error(
            `renderer window ${this.windowId} did not close cleanly: ${failures.join("; ")}`,
          ),
        );
      } else {
        resolveClose();
      }
    });
    return this.closeTask;
  }
}
