import {
  type CallerContext,
  PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS,
  type PluginRecord,
  PluginRuntimeControllerDiagnostic,
  PluginRuntimeDiagnosticsGetParams,
  type PluginRuntimeDiagnosticsSnapshot,
  PluginRuntimeDiagnosticsSnapshot as PluginRuntimeDiagnosticsSnapshotSchema,
  PluginRuntimeDoctorIssue,
  type PluginRuntimeDoctorIssue as PluginRuntimeDoctorIssueValue,
  type PluginRuntimePluginDiagnostic,
  type PluginRuntimeRendererDiagnostic,
  PluginRuntimeReportParams,
  PluginRuntimeReportResult,
  type PluginRuntimeTarget,
  PluginUpdateSnapshot,
  type RendererParticipantIdentity,
} from "@vibefield/contracts";
import type { RuntimeTargetControllerDiagnostic } from "@vibefield/plugin-runtime";
import { RpcCallError } from "./native-link";
import type { PluginRegistryService } from "./plugin-registry";
import type { PluginUpdateCoordinator } from "./plugin-update-coordinator";
import { rendererIdentity } from "./plugin-update-transport";
import type { Handler, SubscriptionHandler } from "./product-api";

const limits = PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS;

export interface PluginRuntimeDiagnosticsRegistrar {
  register(method: string, handler: Handler): void;
  registerSubscription(method: string, handler: SubscriptionHandler): void;
}

export interface PluginRuntimeDiagnosticsOptions {
  readonly plugins: Pick<PluginRegistryService, "list" | "get" | "commitEpoch">;
  readonly serviceDiagnostic: (pluginId: string) => RuntimeTargetControllerDiagnostic | null;
  /** Observation-only: this callback must never create a coordinator. */
  readonly existingCoordinatorFor: (pluginId: string) => PluginUpdateCoordinator | undefined;
  readonly now?: () => number;
}

interface StoredRendererReport {
  readonly identity: RendererParticipantIdentity;
  readonly sequence: number;
  readonly receivedAt: number;
  readonly controller: ReturnType<typeof PluginRuntimeControllerDiagnostic.parse>;
}

interface DiagnosticsSubscription {
  readonly pluginId?: string;
  readonly emit: (payload: unknown, kind?: "delta" | "snapshot") => void;
}

/** fieldd-owned passive join of registry, service, renderer, and update runtime facts.
 *
 * Reports contain only parsed plain data. Exact renderer identity comes from the bearer and must
 * already exist in PRC-5's participant directory; this class has no coordinator mutator in its
 * dependency surface. */
export class PluginRuntimeDiagnostics {
  private readonly reports = new Map<string, Map<string, StoredRendererReport>>();
  private readonly listeners = new Set<DiagnosticsSubscription>();
  private readonly now: () => number;
  private generation = 0;
  private flushScheduled = false;
  private disposed = false;

  constructor(private readonly options: PluginRuntimeDiagnosticsOptions) {
    this.now = options.now ?? Date.now;
  }

  register(api: PluginRuntimeDiagnosticsRegistrar): void {
    api.register("plugins.runtime.report", (ctx, raw) => this.report(ctx, raw));
    api.register("plugins.runtime.get", (_ctx, raw) => this.get(raw));
    api.registerSubscription("plugins.runtime.subscribe", (_ctx, raw, emit) =>
      this.subscribe(raw, emit),
    );
  }

  /** Service lifecycle and update reachability/state observers call this. It changes only this
   * read model's generation; it cannot feed back into either lifecycle state machine. */
  notifyHostChanged(): void {
    if (this.disposed) return;
    this.changed();
  }

  /** Positive renderer retirement owns cache deletion. Socket disconnect intentionally does not. */
  retireRenderer(pluginId: string, identity: RendererParticipantIdentity): void {
    if (this.disposed) return;
    const pluginReports = this.reports.get(pluginId);
    const current = pluginReports?.get(identity.participantId);
    if (current?.identity.incarnation !== identity.incarnation) return;
    pluginReports?.delete(identity.participantId);
    if (pluginReports?.size === 0) this.reports.delete(pluginId);
    this.changed();
  }

  /** A positive uninstall removes every retained incarnation for the plugin. Disable and socket
   * disconnect deliberately do not call this: their last report remains useful stale evidence. */
  retirePlugin(pluginId: string): void {
    if (this.disposed || !this.reports.delete(pluginId)) return;
    this.changed();
  }

  snapshot(pluginId?: string): PluginRuntimeDiagnosticsSnapshot {
    const allRecords = this.options.plugins
      .list()
      .filter((record) => pluginId === undefined || record.id === pluginId)
      .sort((left, right) => left.id.localeCompare(right.id));
    const records = allRecords.slice(0, limits.PLUGINS);
    let remainingControllers = limits.CONTROLLERS;
    let omittedControllers = 0;
    const plugins: PluginRuntimePluginDiagnostic[] = [];

    for (const record of records) {
      const coordinator = this.options.existingCoordinatorFor(record.id);
      const update =
        coordinator === undefined ? null : PluginUpdateSnapshot.parse(coordinator.snapshot());
      const serviceProjection = this.serviceDiagnosticProjection(record.id);
      const serviceCandidate = serviceProjection.controller;
      const serviceController =
        serviceCandidate !== null && remainingControllers > 0 ? serviceCandidate : null;
      const serviceControllerOmitted =
        serviceProjection.omitted || (serviceCandidate !== null && serviceController === null);
      if (serviceController !== null) remainingControllers -= 1;
      if (serviceControllerOmitted) omittedControllers += 1;

      const currentReports = this.currentRendererReports(record.id, coordinator);
      const rendererBudget = Math.min(limits.RENDERERS_PER_PLUGIN, remainingControllers);
      const renderers = currentReports.slice(0, rendererBudget);
      remainingControllers -= renderers.length;
      const omittedRenderers = currentReports.length - renderers.length;
      omittedControllers += omittedRenderers;

      const issueProjection = doctorIssues(record, serviceCandidate, currentReports, update);
      plugins.push({
        pluginId: record.id,
        registry: {
          state: record.state,
          installRevision: record.installRevision,
          manifestHash: record.manifestHash,
          grantGeneration: record.grantGeneration,
          renderer: record.renderer,
          service: record.service,
          ...(record.lastError === undefined ? {} : { lastError: record.lastError }),
        },
        commitEpoch: this.options.plugins.commitEpoch(record.id) ?? null,
        serviceController,
        serviceControllerOmitted,
        renderers,
        omittedRenderers,
        update,
        issues: issueProjection.issues,
        omittedIssues: issueProjection.omitted,
      });
    }

    const snapshot = PluginRuntimeDiagnosticsSnapshotSchema.parse({
      version: 1,
      generation: this.generation,
      capturedAt: safeNow(this.now()),
      plugins,
      omittedPlugins: allRecords.length - records.length,
      omittedControllers,
    });
    if (jsonBytes(snapshot) > limits.SNAPSHOT_BYTES) {
      throw new RpcCallError(
        "RESOURCE_EXHAUSTED",
        "bounded plugin runtime snapshot exceeded its byte invariant",
        true,
      );
    }
    return snapshot;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.reports.clear();
  }

  private report(
    ctx: CallerContext,
    raw: unknown,
  ): ReturnType<typeof PluginRuntimeReportResult.parse> {
    if (this.disposed)
      throw new RpcCallError("UNAVAILABLE", "plugin runtime diagnostics are stopping", true);
    const identity = rendererIdentity(ctx);
    const parsed = PluginRuntimeReportParams.safeParse(raw);
    if (!parsed.success)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "plugins.runtime.report: invalid bounded renderer report",
        false,
      );
    if (
      jsonBytes(parsed.data.controller) > limits.CONTROLLER_BYTES ||
      jsonBytes(parsed.data) > limits.REPORT_BYTES
    ) {
      throw new RpcCallError(
        "RESOURCE_EXHAUSTED",
        "plugin runtime report exceeds its byte limit",
        false,
      );
    }

    const coordinator = this.options.existingCoordinatorFor(parsed.data.pluginId);
    const status = coordinator?.rendererDiagnosticStatus(identity);
    if (status === undefined) {
      throw new RpcCallError(
        "CONFLICT",
        "plugin runtime report does not belong to a current renderer participant",
        true,
      );
    }

    let pluginReports = this.reports.get(parsed.data.pluginId);
    if (pluginReports === undefined) {
      if (this.reports.size >= limits.PLUGINS) {
        throw new RpcCallError(
          "RESOURCE_EXHAUSTED",
          "plugin runtime report plugin limit reached",
          true,
        );
      }
      pluginReports = new Map();
      this.reports.set(parsed.data.pluginId, pluginReports);
    }
    const previous = pluginReports.get(identity.participantId);
    if (
      previous?.identity.incarnation === identity.incarnation &&
      parsed.data.sequence <= previous.sequence
    ) {
      return PluginRuntimeReportResult.parse({ accepted: false, generation: this.generation });
    }
    if (previous === undefined && pluginReports.size >= limits.RENDERERS_PER_PLUGIN) {
      throw new RpcCallError(
        "RESOURCE_EXHAUSTED",
        "plugin runtime renderer report limit reached",
        true,
      );
    }
    pluginReports.set(identity.participantId, {
      identity: Object.freeze({ ...identity }),
      sequence: parsed.data.sequence,
      receivedAt: safeNow(this.now()),
      controller: parsed.data.controller,
    });
    this.changed();
    return PluginRuntimeReportResult.parse({ accepted: true, generation: this.generation });
  }

  private get(raw: unknown): PluginRuntimeDiagnosticsSnapshot {
    const parsed = PluginRuntimeDiagnosticsGetParams.safeParse(raw ?? {});
    if (!parsed.success)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "plugins.runtime.get: expected { pluginId? }",
        false,
      );
    if (
      parsed.data.pluginId !== undefined &&
      this.options.plugins.get(parsed.data.pluginId) === undefined
    ) {
      throw new RpcCallError("NOT_FOUND", `no such plugin: ${parsed.data.pluginId}`, false);
    }
    return this.snapshot(parsed.data.pluginId);
  }

  private subscribe(
    raw: unknown,
    emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
  ): { readonly snapshot: PluginRuntimeDiagnosticsSnapshot; readonly dispose: () => void } {
    const parsed = PluginRuntimeDiagnosticsGetParams.safeParse(raw ?? {});
    if (!parsed.success)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "plugins.runtime.subscribe: expected { pluginId? }",
        false,
      );
    if (
      parsed.data.pluginId !== undefined &&
      this.options.plugins.get(parsed.data.pluginId) === undefined
    ) {
      throw new RpcCallError("NOT_FOUND", `no such plugin: ${parsed.data.pluginId}`, false);
    }
    const subscription: DiagnosticsSubscription = {
      ...(parsed.data.pluginId === undefined ? {} : { pluginId: parsed.data.pluginId }),
      emit,
    };
    const snapshot = this.snapshot(parsed.data.pluginId);
    this.listeners.add(subscription);
    return {
      snapshot,
      dispose: () => this.listeners.delete(subscription),
    };
  }

  private serviceDiagnosticProjection(pluginId: string): {
    readonly controller: ReturnType<typeof PluginRuntimeControllerDiagnostic.parse> | null;
    readonly omitted: boolean;
  } {
    const raw = this.options.serviceDiagnostic(pluginId);
    if (raw === null) return { controller: null, omitted: false };
    const parsed = PluginRuntimeControllerDiagnostic.safeParse(raw);
    if (
      !parsed.success ||
      !controllerBelongsTo(parsed.data, pluginId, "service") ||
      jsonBytes(parsed.data) > limits.CONTROLLER_BYTES
    ) {
      return { controller: null, omitted: true };
    }
    return { controller: parsed.data, omitted: false };
  }

  private currentRendererReports(
    pluginId: string,
    coordinator: PluginUpdateCoordinator | undefined,
  ): PluginRuntimeRendererDiagnostic[] {
    if (coordinator === undefined) return [];
    const rows: PluginRuntimeRendererDiagnostic[] = [];
    for (const report of this.reports.get(pluginId)?.values() ?? []) {
      const status = coordinator.rendererDiagnosticStatus(report.identity);
      if (status === undefined) continue;
      rows.push({
        participantId: report.identity.participantId,
        incarnation: report.identity.incarnation,
        connected: status.connected,
        status: status.status,
        sequence: report.sequence,
        receivedAt: report.receivedAt,
        controller: report.controller,
      });
    }
    return rows.sort((left, right) => left.participantId.localeCompare(right.participantId));
  }

  private changed(): void {
    this.generation = Math.min(Number.MAX_SAFE_INTEGER, this.generation + 1);
    if (this.flushScheduled || this.listeners.size === 0) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.disposed) return;
    for (const listener of [...this.listeners]) {
      try {
        listener.emit(this.snapshot(listener.pluginId));
      } catch {
        // A broken/closed diagnostics observer cannot affect runtime or other observers.
      }
    }
  }
}

function controllerBelongsTo(
  controller: ReturnType<typeof PluginRuntimeControllerDiagnostic.parse>,
  pluginId: string,
  face: PluginRuntimeTarget["face"],
): boolean {
  const targets = [
    controller.desired,
    controller.committed,
    controller.blocked?.target,
    controller.force.last?.target,
  ].filter((target): target is PluginRuntimeTarget => target !== null && target !== undefined);
  if (targets.some((target) => target.pluginId !== pluginId || target.face !== face)) return false;
  return controller.history.every(
    (event) =>
      event.target === undefined ||
      event.target === null ||
      (event.target.pluginId === pluginId && event.target.face === face),
  );
}

function doctorIssues(
  record: PluginRecord,
  service: ReturnType<typeof PluginRuntimeControllerDiagnostic.parse> | null,
  renderers: readonly PluginRuntimeRendererDiagnostic[],
  update: ReturnType<typeof PluginUpdateSnapshot.parse> | null,
): { readonly issues: PluginRuntimeDoctorIssueValue[]; readonly omitted: number } {
  const issues: PluginRuntimeDoctorIssueValue[] = [];
  const currentArtifact = update?.currentArtifact ?? {
    pluginId: record.id,
    installRevision: record.installRevision,
    manifestHash: record.manifestHash,
  };
  if (service !== null) appendControllerIssues(issues, service, "service", currentArtifact);
  for (const renderer of renderers) {
    appendControllerIssues(
      issues,
      renderer.controller,
      "renderer",
      currentArtifact,
      renderer.participantId,
    );
    if (!renderer.connected) {
      issues.push(
        PluginRuntimeDoctorIssue.parse({
          code: "renderer-disconnected",
          severity: "warning",
          face: "renderer",
          participantId: renderer.participantId,
          message: "Renderer diagnostics are retained but the participant is disconnected.",
        }),
      );
    }
  }
  if (update?.state === "failed") {
    issues.push(
      PluginRuntimeDoctorIssue.parse({
        code: "update-failed",
        severity: "error",
        face: "update",
        message: "The plugin update coordinator is failed and ingress remains closed.",
      }),
    );
  }
  for (const participant of update?.episode?.participants ?? []) {
    if (participant.expected === "settled") continue;
    issues.push(
      PluginRuntimeDoctorIssue.parse({
        code: "update-unacknowledged",
        severity: "warning",
        face: "update",
        participantId: participant.participantId,
        message: `Update participant is waiting for ${participant.expected}.`,
      }),
    );
  }
  const projected = issues.slice(0, limits.ISSUES_PER_PLUGIN);
  return { issues: projected, omitted: issues.length - projected.length };
}

function appendControllerIssues(
  issues: PluginRuntimeDoctorIssueValue[],
  controller: ReturnType<typeof PluginRuntimeControllerDiagnostic.parse>,
  face: "service" | "renderer",
  currentArtifact: { readonly installRevision: string; readonly manifestHash: string },
  participantId?: string,
): void {
  const base = { face, ...(participantId === undefined ? {} : { participantId }) };
  if (controller.state === "failed") {
    issues.push(
      PluginRuntimeDoctorIssue.parse({
        ...base,
        code: "controller-failed",
        severity: "error",
        message: controller.error ?? `${face} runtime controller failed.`,
      }),
    );
  }
  if (
    controller.state === "non-quiescent" ||
    (controller.lastClose !== null && !controller.lastClose.quiescent)
  ) {
    issues.push(
      PluginRuntimeDoctorIssue.parse({
        ...base,
        code: "scope-non-quiescent",
        severity: "error",
        message: `${face} activation scope has not reached quiescence.`,
      }),
    );
  }
  const disposeErrors =
    controller.scope?.stats.disposeErrors ?? controller.lastClose?.stats.disposeErrors ?? 0;
  if (disposeErrors > 0) {
    issues.push(
      PluginRuntimeDoctorIssue.parse({
        ...base,
        code: "cleanup-errors",
        severity: "warning",
        message: `${disposeErrors} cleanup operation${disposeErrors === 1 ? "" : "s"} failed.`,
      }),
    );
  }
  const committed = controller.committed;
  if (
    controller.state === "active" &&
    committed !== null &&
    (committed.artifact.installRevision !== currentArtifact.installRevision ||
      committed.artifact.manifestHash !== currentArtifact.manifestHash)
  ) {
    issues.push(
      PluginRuntimeDoctorIssue.parse({
        ...base,
        code: "target-not-current",
        severity: "error",
        message: `${face} runtime is committed to a non-current plugin artifact.`,
      }),
    );
  }
}

function safeNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
