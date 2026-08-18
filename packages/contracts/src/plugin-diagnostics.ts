import { z } from "zod";
import { PluginErrorSummary, PluginRecordState, PublicEntryState } from "./plugin-registry";
import { PluginUpdateSnapshot } from "./plugin-update";
import { PluginId } from "./plugins";

/** PRC-6b wire ceilings. Controller detail is independently bounded so one renderer report never
 * approaches ProductAPI's 4 MiB inbound frame cap. Aggregate controller rows are a global budget,
 * not a per-plugin multiplier. */
export const PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS = Object.freeze({
  CONTROLLER_BYTES: 64 * 1024,
  BEHAVIOR_BYTES: 32 * 1024,
  REPORT_BYTES: 104 * 1024,
  SNAPSHOT_BYTES: 16 * 1024 * 1024,
  PLUGINS: 256,
  CONTROLLERS: 128,
  RENDERERS_PER_PLUGIN: 64,
  ISSUES_PER_PLUGIN: 64,
  EFFECTS: 128,
  CLEANUP_ERRORS: 32,
  HISTORY: 64,
  BEHAVIORS_PER_PLUGIN: 16,
  BEHAVIOR_RENDERER_TARGETS: 2,
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

export const PluginRuntimeBehaviorBlockedReason = z.enum([
  "canvas-write-denied",
  "presence-unavailable",
  "presence-budget-exceeded",
]);
export type PluginRuntimeBehaviorBlockedReason = z.infer<typeof PluginRuntimeBehaviorBlockedReason>;

export const PluginRuntimeBehaviorError = z
  .object({
    operation: z.enum(["register", "unregister", "rollback"]),
    message: DiagnosticText,
  })
  .strict();
export type PluginRuntimeBehaviorError = z.infer<typeof PluginRuntimeBehaviorError>;

export const PluginRuntimeBehaviorDeclarationDiagnostic = z
  .object({
    declarationId: TargetPart,
    rendererTarget: SafeCount,
    status: z.enum(["installed", "blocked", "failed", "inactive"]),
    blockedReason: PluginRuntimeBehaviorBlockedReason.optional(),
    error: PluginRuntimeBehaviorError.optional(),
    breaker: z.object({ strikes: SafeCount, suspended: z.boolean() }).strict().nullable(),
  })
  .strict()
  .superRefine((row, ctx) => {
    if ((row.status === "blocked") !== (row.blockedReason !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockedReason"],
        message: "only a blocked behavior declaration carries a blocked reason",
      });
    }
    if ((row.status === "failed") !== (row.error !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["error"],
        message: "only a failed behavior declaration carries an error",
      });
    }
  });
export type PluginRuntimeBehaviorDeclarationDiagnostic = z.infer<
  typeof PluginRuntimeBehaviorDeclarationDiagnostic
>;

export const PluginRuntimeBehaviorGenerationDiagnostic = z
  .object({
    pluginId: PluginId,
    state: z.enum(["active", "failed", "closed"]),
    target: z
      .object({
        windowId: TargetPart,
        documentId: TargetPart,
        runtimeGeneration: TargetPart,
      })
      .strict(),
    /** Normally one exact committed renderer target. A failed old→new transition may need both. */
    rendererTargets: z.array(PluginRuntimeTarget).min(1).max(limits.BEHAVIOR_RENDERER_TARGETS),
    desiredCount: SafeCount,
    installedCount: SafeCount,
    blockedCount: SafeCount,
    failedCount: SafeCount,
    suspendedCount: SafeCount,
    declarations: z
      .array(PluginRuntimeBehaviorDeclarationDiagnostic)
      .max(limits.BEHAVIORS_PER_PLUGIN),
    omittedDeclarations: SafeCount,
    closeReason: DiagnosticText.optional(),
  })
  .strict()
  .superRefine((diagnostic, ctx) => {
    const rendererTargetKeys = new Set<string>();
    for (const [index, target] of diagnostic.rendererTargets.entries()) {
      if (target.face !== "renderer" || target.pluginId !== diagnostic.pluginId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rendererTargets", index],
          message: "behavior renderer targets must name the diagnostic plugin and renderer face",
        });
        continue;
      }
      if (target.instanceKey.windowId !== diagnostic.target.windowId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rendererTargets", index, "instanceKey", "windowId"],
          message: "behavior renderer targets must belong to the diagnostic window",
        });
      }
      const targetKey = JSON.stringify(target);
      if (rendererTargetKeys.has(targetKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rendererTargets", index],
          message: "behavior renderer target table entries must be unique",
        });
      }
      rendererTargetKeys.add(targetKey);
    }
    const declarations = new Set<string>();
    const detailedCounts = {
      installed: 0,
      blocked: 0,
      failed: 0,
    };
    const detailedSuspended = new Set<string>();
    for (const [index, declaration] of diagnostic.declarations.entries()) {
      const key = `${declaration.declarationId}\0${declaration.rendererTarget}`;
      if (declarations.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["declarations", index],
          message: "behavior declaration/target rows must be unique",
        });
      }
      declarations.add(key);
      if (declaration.rendererTarget >= diagnostic.rendererTargets.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["declarations", index, "rendererTarget"],
          message: "behavior declaration references a missing renderer target",
        });
      }
      if (!declaration.declarationId.startsWith(`${diagnostic.pluginId}:`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["declarations", index, "declarationId"],
          message: "behavior declaration must belong to the diagnostic plugin",
        });
      }
      if (declaration.status === "installed") detailedCounts.installed += 1;
      if (declaration.status === "blocked") detailedCounts.blocked += 1;
      if (declaration.status === "failed") detailedCounts.failed += 1;
      if (declaration.breaker?.suspended === true) {
        detailedSuspended.add(declaration.declarationId);
      }
    }
    if (diagnostic.desiredCount > limits.BEHAVIORS_PER_PLUGIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["desiredCount"],
        message: "behavior desired count exceeds the signed per-plugin declaration limit",
      });
    }
    if (diagnostic.failedCount > limits.BEHAVIORS_PER_PLUGIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failedCount"],
        message: "behavior failed count exceeds one bounded transition",
      });
    }
    if (diagnostic.installedCount > diagnostic.desiredCount + diagnostic.failedCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["installedCount"],
        message: "behavior installed count exceeds desired plus failed retained declarations",
      });
    }
    if (
      diagnostic.suspendedCount > limits.BEHAVIORS_PER_PLUGIN ||
      diagnostic.suspendedCount > diagnostic.desiredCount + diagnostic.failedCount
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["suspendedCount"],
        message: "behavior suspended count exceeds the bounded declaration union",
      });
    }
    if (diagnostic.blockedCount > diagnostic.desiredCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockedCount"],
        message: "behavior diagnostic count exceeds desired declarations",
      });
    }
    for (const [detail, count] of [
      ["installed", diagnostic.installedCount],
      ["blocked", diagnostic.blockedCount],
      ["failed", diagnostic.failedCount],
    ] as const) {
      if (detailedCounts[detail] > count) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["declarations"],
          message: `behavior ${detail} detail exceeds its exact aggregate count`,
        });
      }
    }
    if (detailedSuspended.size > diagnostic.suspendedCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["declarations"],
        message: "behavior suspended detail exceeds its exact aggregate count",
      });
    }
    if ((diagnostic.state === "failed") !== diagnostic.failedCount > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "behavior failed state and failed count must agree",
      });
    }
    if (
      diagnostic.declarations.length + diagnostic.omittedDeclarations >
      diagnostic.desiredCount + diagnostic.failedCount
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["omittedDeclarations"],
        message: "behavior detail exceeds desired plus failed transition rows",
      });
    }
  });
export type PluginRuntimeBehaviorGenerationDiagnostic = z.infer<
  typeof PluginRuntimeBehaviorGenerationDiagnostic
>;

/** Renderer identity is deliberately absent. The exact tuple comes from the authenticated
 * connection, and the handler additionally requires existing PRC-5 participant membership. */
export const PluginRuntimeReportParams = z
  .object({
    pluginId: PluginId,
    sequence: SafePositive,
    controller: PluginRuntimeControllerDiagnostic,
    behaviorGeneration: PluginRuntimeBehaviorGenerationDiagnostic.nullable().optional(),
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
    if (
      report.behaviorGeneration !== undefined &&
      report.behaviorGeneration !== null &&
      report.behaviorGeneration.pluginId !== report.pluginId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["behaviorGeneration", "pluginId"],
        message: "behavior generation must name the reported plugin",
      });
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
    behaviorGeneration: PluginRuntimeBehaviorGenerationDiagnostic.nullable(),
  })
  .strict();
export type PluginRuntimeRendererDiagnostic = z.infer<typeof PluginRuntimeRendererDiagnostic>;

export const PluginRuntimeDoctorIssueCode = z.enum([
  "cleanup-errors",
  "behavior-blocked",
  "behavior-generation-failed",
  "behavior-suspended",
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
    face: z.enum(["service", "renderer", "behavior", "update"]),
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
