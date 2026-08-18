import { z } from "zod";
import { PluginErrorSummary, PluginRecordState, PublicEntryState } from "./plugin-registry";
import { PluginUpdateSnapshot } from "./plugin-update";
import { PluginId } from "./plugins";

/** PRC-6b wire ceilings. Controller detail is independently bounded so one renderer report never
 * approaches ProductAPI's 4 MiB inbound frame cap. Aggregate controller rows are a global budget,
 * not a per-plugin multiplier. */
export const PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS = Object.freeze({
  CONTROLLER_BYTES: 64 * 1024,
  REPORT_BYTES: 72 * 1024,
  SNAPSHOT_BYTES: 12 * 1024 * 1024,
  PLUGINS: 256,
  CONTROLLERS: 128,
  RENDERERS_PER_PLUGIN: 64,
  ISSUES_PER_PLUGIN: 64,
  EFFECTS: 128,
  CLEANUP_ERRORS: 32,
  HISTORY: 64,
  LABEL_CHARS: 120,
  CONTROLLER_LABEL_CHARS: 512,
  TEXT_CHARS: 512,
  PHASE_CHARS: 80,
  TARGET_PART_CHARS: 512,
  AUTHORITY_FINGERPRINT_CHARS: 8 * 1024,
} as const);

const limits = PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS;
const SafeCount = z.number().int().nonnegative().safe();
const SafePositive = z.number().int().positive().safe();
const DiagnosticText = z.string().max(limits.TEXT_CHARS);
const TargetPart = z.string().min(1).max(limits.TARGET_PART_CHARS);

export const PluginRuntimeArtifactIdentity = z
  .object({
    installRevision: TargetPart,
    manifestHash: TargetPart,
    approvedModuleGeneration: SafeCount.optional(),
  })
  .strict();
export type PluginRuntimeArtifactIdentity = z.infer<typeof PluginRuntimeArtifactIdentity>;

const RuntimeTargetBase = {
  pluginId: PluginId,
  artifact: PluginRuntimeArtifactIdentity,
  authorityFingerprint: z.string().min(1).max(limits.AUTHORITY_FINGERPRINT_CHARS),
  observedGrantGeneration: SafeCount,
  runtimeGeneration: TargetPart.optional(),
};

export const PluginRuntimeTarget = z.discriminatedUnion("face", [
  z
    .object({
      ...RuntimeTargetBase,
      face: z.literal("service"),
      instanceKey: z.object({ deviceId: TargetPart }).strict(),
    })
    .strict(),
  z
    .object({
      ...RuntimeTargetBase,
      face: z.literal("renderer"),
      instanceKey: z.object({ windowId: TargetPart }).strict(),
    })
    .strict(),
  z
    .object({
      ...RuntimeTargetBase,
      face: z.literal("behavior"),
      instanceKey: z
        .object({
          windowId: TargetPart,
          documentId: TargetPart,
          behaviorDeclarationId: TargetPart,
        })
        .strict(),
      runtimeGeneration: TargetPart,
    })
    .strict(),
]);
export type PluginRuntimeTarget = z.infer<typeof PluginRuntimeTarget>;

export const PluginRuntimeCloseKind = z.enum([
  "activation-failed",
  "activation-timeout",
  "crash",
  "disable",
  "grant-revoked",
  "host-shutdown",
  "manual",
  "parent-close",
  "quarantine",
  "reload",
  "target-changed",
  "uninstall",
  "window-close",
]);
export type PluginRuntimeCloseKind = z.infer<typeof PluginRuntimeCloseKind>;

export const PluginRuntimeCloseReason = z
  .object({ kind: PluginRuntimeCloseKind, detail: DiagnosticText.optional() })
  .strict();
export type PluginRuntimeCloseReason = z.infer<typeof PluginRuntimeCloseReason>;

export const PluginRuntimeCleanupError = z
  .object({
    label: z.string().min(1).max(limits.LABEL_CHARS),
    name: z.string().min(1).max(80),
    message: DiagnosticText,
  })
  .strict();
export type PluginRuntimeCleanupError = z.infer<typeof PluginRuntimeCleanupError>;

const CloseReportShape = {
  label: z.string().min(1).max(limits.LABEL_CHARS),
  state: z.enum(["open", "closing", "closed"]),
  reason: PluginRuntimeCloseReason.optional(),
  quiescent: z.boolean(),
  liveCount: SafeCount,
  pendingSetups: SafeCount,
  lateCleanups: SafeCount,
  stats: z
    .object({
      acquired: SafeCount,
      disposed: SafeCount,
      disposeErrors: SafeCount,
      lateArrivals: SafeCount,
    })
    .strict(),
  errors: z.array(PluginRuntimeCleanupError).max(limits.CLEANUP_ERRORS),
  omittedErrors: SafeCount,
};

export const PluginRuntimeCloseReport = z.object(CloseReportShape).strict();
export type PluginRuntimeCloseReport = z.infer<typeof PluginRuntimeCloseReport>;

export const PluginRuntimeDiagnosticEffect = z
  .object({
    id: SafePositive,
    parentId: SafePositive.nullable(),
    label: z.string().min(1).max(limits.LABEL_CHARS),
    kind: z.enum(["resource", "scope"]),
    status: z.enum(["live", "disposing"]),
  })
  .strict();
export type PluginRuntimeDiagnosticEffect = z.infer<typeof PluginRuntimeDiagnosticEffect>;

export const PluginRuntimeScopeDiagnostic = z
  .object({
    ...CloseReportShape,
    effects: z.array(PluginRuntimeDiagnosticEffect).max(limits.EFFECTS),
    omittedEffects: SafeCount,
  })
  .strict()
  .superRefine((scope, ctx) => {
    const seen = new Set<number>();
    for (const [index, effect] of scope.effects.entries()) {
      if (seen.has(effect.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["effects", index, "id"],
          message: "diagnostic effect ids must be unique",
        });
      }
      if (effect.parentId !== null && !seen.has(effect.parentId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["effects", index, "parentId"],
          message: "diagnostic parents must precede their children",
        });
      }
      seen.add(effect.id);
    }
  });
export type PluginRuntimeScopeDiagnostic = z.infer<typeof PluginRuntimeScopeDiagnostic>;

export const PluginRuntimeControllerState = z.enum([
  "inactive",
  "loading",
  "prepared",
  "active",
  "refreshing",
  "unloading",
  "failed",
  "non-quiescent",
]);
export type PluginRuntimeControllerState = z.infer<typeof PluginRuntimeControllerState>;

export const PluginRuntimeLifecycleEventKind = z.enum([
  "close-edge",
  "controller-error",
  "desired",
  "force-confirmed",
  "force-error",
  "force-unconfirmed",
  "late-quiescence",
  "load-commit",
  "load-failed",
  "load-prepared",
  "load-stale",
  "load-start",
  "load-timeout",
  "non-quiescent",
  "prepared-commit",
  "prepared-commit-failed",
  "prepared-commit-stale",
  "prepared-unloaded",
  "refresh-commit",
  "refresh-failed",
  "refresh-stale",
  "refresh-start",
  "unloaded",
]);
export type PluginRuntimeLifecycleEventKind = z.infer<typeof PluginRuntimeLifecycleEventKind>;

export const PluginRuntimeLifecycleTarget = z
  .object({
    face: z.enum(["service", "renderer", "behavior"]),
    pluginId: TargetPart,
    instanceKey: TargetPart,
    installRevision: TargetPart,
    manifestHash: TargetPart,
    observedGrantGeneration: SafeCount,
    runtimeGeneration: TargetPart.optional(),
  })
  .strict();
export type PluginRuntimeLifecycleTarget = z.infer<typeof PluginRuntimeLifecycleTarget>;

export const PluginRuntimeCloseSummary = z
  .object({
    reason: PluginRuntimeCloseReason.optional(),
    quiescent: z.boolean(),
    liveCount: SafeCount,
    pendingSetups: SafeCount,
    lateCleanups: SafeCount,
    disposeErrors: SafeCount,
    omittedErrors: SafeCount,
  })
  .strict();
export type PluginRuntimeCloseSummary = z.infer<typeof PluginRuntimeCloseSummary>;

export const PluginRuntimeBoundaryTermination = z
  .object({
    terminated: z.boolean(),
    forced: z.boolean(),
    detail: DiagnosticText.optional(),
  })
  .strict();
export type PluginRuntimeBoundaryTermination = z.infer<typeof PluginRuntimeBoundaryTermination>;

export const PluginRuntimeLifecycleEvent = z
  .object({
    sequence: SafePositive,
    event: PluginRuntimeLifecycleEventKind,
    state: PluginRuntimeControllerState,
    revision: SafeCount.optional(),
    phase: z.string().min(1).max(limits.PHASE_CHARS).optional(),
    target: PluginRuntimeLifecycleTarget.nullable().optional(),
    reason: PluginRuntimeCloseReason.optional(),
    error: DiagnosticText.optional(),
    close: PluginRuntimeCloseSummary.optional(),
    force: PluginRuntimeBoundaryTermination.optional(),
  })
  .strict();
export type PluginRuntimeLifecycleEvent = z.infer<typeof PluginRuntimeLifecycleEvent>;

export const PluginRuntimeBoundaryForceDiagnostic = z
  .object({
    state: z.enum(["confirmed", "unconfirmed", "error"]),
    phase: z.string().min(1).max(limits.PHASE_CHARS),
    target: PluginRuntimeTarget,
    outcome: PluginRuntimeBoundaryTermination.optional(),
    error: DiagnosticText.optional(),
  })
  .strict();
export type PluginRuntimeBoundaryForceDiagnostic = z.infer<
  typeof PluginRuntimeBoundaryForceDiagnostic
>;

export const PluginRuntimeControllerDiagnostic = z
  .object({
    label: z.string().min(1).max(limits.CONTROLLER_LABEL_CHARS),
    state: PluginRuntimeControllerState,
    desired: PluginRuntimeTarget.nullable(),
    committed: PluginRuntimeTarget.nullable(),
    desiredRevision: SafeCount,
    error: DiagnosticText.optional(),
    blocked: z
      .object({
        phase: z.string().min(1).max(limits.PHASE_CHARS),
        target: PluginRuntimeTarget,
      })
      .strict()
      .nullable(),
    scope: PluginRuntimeScopeDiagnostic.nullable(),
    lastClose: PluginRuntimeCloseReport.nullable(),
    force: z
      .object({
        confirmedCount: SafeCount,
        last: PluginRuntimeBoundaryForceDiagnostic.nullable(),
      })
      .strict(),
    history: z.array(PluginRuntimeLifecycleEvent).max(limits.HISTORY),
    omittedHistory: SafeCount,
  })
  .strict();
export type PluginRuntimeControllerDiagnostic = z.infer<typeof PluginRuntimeControllerDiagnostic>;

/** Renderer identity is deliberately absent. The exact tuple comes from the authenticated
 * connection, and the handler additionally requires existing PRC-5 participant membership. */
export const PluginRuntimeReportParams = z
  .object({
    pluginId: PluginId,
    sequence: SafePositive,
    controller: PluginRuntimeControllerDiagnostic,
  })
  .strict()
  .superRefine((report, ctx) => {
    const fullTargets = [
      report.controller.desired,
      report.controller.committed,
      report.controller.blocked?.target,
      report.controller.force.last?.target,
    ].filter((target): target is PluginRuntimeTarget => target !== null && target !== undefined);
    for (const target of fullTargets) {
      if (target.pluginId !== report.pluginId || target.face !== "renderer") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["controller"],
          message: "renderer report targets must name the reported plugin and renderer face",
        });
        break;
      }
    }
    for (const [index, event] of report.controller.history.entries()) {
      if (
        event.target !== undefined &&
        event.target !== null &&
        (event.target.pluginId !== report.pluginId || event.target.face !== "renderer")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["controller", "history", index, "target"],
          message: "renderer lifecycle target names another plugin or face",
        });
      }
    }
  });
export type PluginRuntimeReportParams = z.infer<typeof PluginRuntimeReportParams>;

export const PluginRuntimeReportResult = z
  .object({ accepted: z.boolean(), generation: SafeCount })
  .strict();
export type PluginRuntimeReportResult = z.infer<typeof PluginRuntimeReportResult>;

export const PluginRuntimeDiagnosticsGetParams = z
  .object({ pluginId: PluginId.optional() })
  .strict();
export type PluginRuntimeDiagnosticsGetParams = z.infer<typeof PluginRuntimeDiagnosticsGetParams>;

export const PluginRuntimeDiagnosticsSubscribeParams: typeof PluginRuntimeDiagnosticsGetParams =
  PluginRuntimeDiagnosticsGetParams;
export type PluginRuntimeDiagnosticsSubscribeParams = z.infer<
  typeof PluginRuntimeDiagnosticsSubscribeParams
>;

export const PluginRuntimeRendererDiagnostic = z
  .object({
    participantId: TargetPart,
    incarnation: TargetPart,
    connected: z.boolean(),
    status: z.enum(["live", "held"]),
    sequence: SafePositive,
    receivedAt: SafeCount,
    controller: PluginRuntimeControllerDiagnostic,
  })
  .strict();
export type PluginRuntimeRendererDiagnostic = z.infer<typeof PluginRuntimeRendererDiagnostic>;

export const PluginRuntimeDoctorIssueCode = z.enum([
  "cleanup-errors",
  "controller-failed",
  "renderer-disconnected",
  "scope-non-quiescent",
  "target-not-current",
  "update-failed",
  "update-unacknowledged",
]);
export type PluginRuntimeDoctorIssueCode = z.infer<typeof PluginRuntimeDoctorIssueCode>;

export const PluginRuntimeDoctorIssue = z
  .object({
    code: PluginRuntimeDoctorIssueCode,
    severity: z.enum(["warning", "error"]),
    face: z.enum(["service", "renderer", "update"]),
    participantId: TargetPart.optional(),
    message: DiagnosticText,
  })
  .strict();
export type PluginRuntimeDoctorIssue = z.infer<typeof PluginRuntimeDoctorIssue>;

export const PluginRuntimeRegistryDiagnostic = z
  .object({
    state: PluginRecordState,
    installRevision: TargetPart,
    manifestHash: TargetPart,
    grantGeneration: SafeCount,
    renderer: PublicEntryState,
    service: PublicEntryState,
    lastError: PluginErrorSummary.strip().optional(),
  })
  .strict();
export type PluginRuntimeRegistryDiagnostic = z.infer<typeof PluginRuntimeRegistryDiagnostic>;

export const PluginRuntimePluginDiagnostic = z
  .object({
    pluginId: PluginId,
    registry: PluginRuntimeRegistryDiagnostic,
    commitEpoch: SafePositive.nullable(),
    serviceController: PluginRuntimeControllerDiagnostic.nullable(),
    serviceControllerOmitted: z.boolean(),
    renderers: z.array(PluginRuntimeRendererDiagnostic).max(limits.RENDERERS_PER_PLUGIN),
    omittedRenderers: SafeCount,
    update: PluginUpdateSnapshot.nullable(),
    issues: z.array(PluginRuntimeDoctorIssue).max(limits.ISSUES_PER_PLUGIN),
    omittedIssues: SafeCount,
  })
  .strict();
export type PluginRuntimePluginDiagnostic = z.infer<typeof PluginRuntimePluginDiagnostic>;

export const PluginRuntimeDiagnosticsSnapshot = z
  .object({
    version: z.literal(1),
    generation: SafeCount,
    capturedAt: SafeCount,
    plugins: z.array(PluginRuntimePluginDiagnostic).max(limits.PLUGINS),
    omittedPlugins: SafeCount,
    omittedControllers: SafeCount,
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const controllers = snapshot.plugins.reduce(
      (total, plugin) =>
        total + plugin.renderers.length + (plugin.serviceController === null ? 0 : 1),
      0,
    );
    if (controllers > limits.CONTROLLERS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plugins"],
        message: "runtime controller budget is global across the snapshot",
      });
    }
    for (const [index, plugin] of snapshot.plugins.entries()) {
      if (plugin.serviceController !== null && plugin.serviceControllerOmitted) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plugins", index, "serviceControllerOmitted"],
          message: "an emitted service controller cannot also be omitted",
        });
      }
    }
  });
export type PluginRuntimeDiagnosticsSnapshot = z.infer<typeof PluginRuntimeDiagnosticsSnapshot>;
