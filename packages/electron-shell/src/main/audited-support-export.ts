import type { AuditAppendV1, SupportBundleExportResultV1 } from "@vibefield/contracts/diagnostics";
import type { SupportBundleAuditContext, SupportBundleService } from "./support-bundle";

export interface SupportSaveSelection {
  canceled: boolean;
  filePath?: string;
}

export interface AuditedSupportExportOptions {
  previewId: string;
  support: Pick<SupportBundleService, "auditContext" | "cancelled" | "export">;
  chooseDestination: () => Promise<SupportSaveSelection>;
  appendAudit: (record: AuditAppendV1) => Promise<void>;
}

function auditFields(context: SupportBundleAuditContext): {
  base: Pick<AuditAppendV1, "action" | "target" | "operationId">;
  attrs: NonNullable<AuditAppendV1["attrs"]>;
} {
  return {
    base: {
      action: "support.bundle.export",
      target: { kind: "support-bundle", id: context.bundleId },
      operationId: context.bundleId,
    },
    attrs: {
      rangeHours: context.rangeHours,
      sourceCount: context.sourceCount,
      pluginCount: context.pluginCount,
      crashCount: context.crashCount,
      includedAudit: context.includesAudit,
    },
  };
}

/** Required-attempt shell action. Destination paths and bundle contents never
 * cross the audit boundary; only bounded selection counts and archive size do. */
export async function runAuditedSupportExport(
  options: AuditedSupportExportOptions,
): Promise<SupportBundleExportResultV1> {
  const context = options.support.auditContext(options.previewId);
  const { base, attrs } = auditFields(context);
  await options.appendAudit({
    ...base,
    phase: "attempt",
    reasonCode: "USER_REQUESTED",
    attrs,
  });

  let selected: SupportSaveSelection;
  try {
    selected = await options.chooseDestination();
  } catch (error) {
    await options
      .appendAudit({
        ...base,
        phase: "outcome",
        outcome: "failed",
        reasonCode: "DIALOG_FAILED",
        attrs,
      })
      .catch(() => undefined);
    throw error;
  }

  if (selected.canceled || selected.filePath === undefined) {
    const result = options.support.cancelled(options.previewId);
    await options.appendAudit({
      ...base,
      phase: "outcome",
      outcome: "cancelled",
      reasonCode: "USER_CANCELLED",
      attrs,
    });
    return result;
  }

  let result: SupportBundleExportResultV1;
  try {
    result = await options.support.export(options.previewId, selected.filePath);
  } catch (error) {
    await options
      .appendAudit({
        ...base,
        phase: "outcome",
        outcome: "failed",
        reasonCode: "EXPORT_FAILED",
        attrs,
      })
      .catch(() => undefined);
    throw error;
  }
  await options.appendAudit({
    ...base,
    phase: "outcome",
    outcome: "succeeded",
    reasonCode: "USER_REQUESTED",
    attrs: {
      ...attrs,
      archiveBytes: result.archiveBytes ?? 0,
    },
  });
  return result;
}
