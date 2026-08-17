import {
  computeEffectiveGrants,
  PLUGIN_LIMITS,
  type PluginManifestV1,
  type PluginModuleUrls,
  type PluginRecord,
  type PluginRegistrySnapshot,
} from "@vibefield/contracts";
import { UnavailableState } from "@vibefield/design-kit";
import {
  type ActivationScope,
  projectPluginAuthority,
  type RendererRuntimeTarget,
  type RuntimeTargetCandidate,
  RuntimeTargetController,
  samePluginRuntimeObservation,
} from "@vibefield/plugin-runtime";
import type { RendererPluginModule, WidgetBinding } from "@vibefield/plugin-sdk";
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

/** One imported artifact in one renderer/window realm. Artifact bytes remain boot-static until
 * PRC-5; this controller owns every lifetime and authority episode for that exact approved row. */
export class RendererPluginController {
  readonly pluginId: string;
  readonly windowId: string;

  private record: PluginRecord;
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
    private readonly module: PluginModuleUrls,
    private readonly pluginModule: RendererPluginModule,
    windowId = DEFAULT_RENDERER_WINDOW_ID,
    private readonly deps: RendererPluginControllerDeps = {},
  ) {
    this.pluginId = initialRecord.id;
    this.windowId = windowId;
    this.record = initialRecord;
    this.refreshCredential = deps.refreshCredential ?? refreshPluginProductClient;
    this.retireCredential = deps.retireCredential ?? retirePluginProductClient;
    this.controller = new RuntimeTargetController(`renderer:${this.pluginId}:${this.windowId}`, {
      activate: (target, scope, signal) => this.activate(target, scope, signal),
      refresh: async (_candidate, _previous, next, signal) => {
        await this.refreshCredential(
          this.pluginId,
          {
            manifestHash: next.artifact.manifestHash,
            grantGeneration: next.observedGrantGeneration,
          },
          signal,
        );
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

  /** Reconcile one durable observation. A record for new artifact bytes closes the old target but
   * cannot activate the old imported module under the new identity; PRC-5 supplies that barrier. */
  async reconcile(record: PluginRecord | null): Promise<ActivatedRenderer | null> {
    if (record !== null && record.id !== this.pluginId)
      throw new Error(`renderer controller ${this.pluginId} cannot observe ${record.id}`);
    if (record !== null) this.record = record;
    const target = this.targetFor(record);
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
    return this.activation;
  }

  async close(): Promise<void> {
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

  private targetFor(record: PluginRecord | null): ControlledRendererTarget | null {
    if (record === null || !record.enabled || record.renderer === "none") return null;
    if (
      record.installRevision !== this.module.installRevision ||
      record.manifestHash !== this.module.manifestHash
    ) {
      return null;
    }
    const authority = projectPluginAuthority("renderer", record.grantedCapabilities);
    return {
      face: "renderer",
      pluginId: record.id,
      artifact: {
        installRevision: this.module.installRevision,
        manifestHash: this.module.manifestHash,
      },
      instanceKey: { windowId: this.windowId },
      authorityFingerprint: authority.fingerprint,
      observedGrantGeneration: record.grantGeneration,
      behaviorAuthorized: authority.capabilities.includes("canvas.write"),
    };
  }

  private async activate(
    target: ControlledRendererTarget,
    scope: ActivationScope,
    signal: AbortSignal,
  ): Promise<ControlledRendererCandidate> {
    if (signal.aborted) throw new Error(`${this.pluginId}: renderer target superseded`);
    let candidate: ControlledRendererCandidate | undefined;
    let inner: RendererActivationCandidate;
    try {
      inner = await stageStagedRenderer(this.record, this.module, this.pluginModule, {
        ...this.deps,
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
      this.retireCredential(this.pluginId);
      throw error;
    }

    const style =
      this.deps.style === undefined
        ? undefined
        : stagePluginStyleLink(
            this.deps.style.document,
            this.pluginId,
            this.module.installRevision,
            this.deps.style.href,
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
      activation: inner.activation,
      inner,
      commit: () => {
        const current = candidate;
        if (current === undefined)
          throw new Error(`${this.pluginId}: renderer candidate was not constructed`);
        if (signal.aborted) throw new Error(`${this.pluginId}: stale renderer candidate`);
        this.assertBindingShapes(inner.activation.bindings);
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
        this.retireCredential(this.pluginId);
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
