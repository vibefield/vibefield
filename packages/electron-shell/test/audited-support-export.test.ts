import type { AuditAppendV1, SupportBundleExportResultV1 } from "@vibefield/contracts/diagnostics";
import { describe, expect, it, vi } from "vitest";
import { runAuditedSupportExport } from "../src/main/audited-support-export";

const context = {
  bundleId: "bundle_audit_01",
  rangeHours: 24,
  sourceCount: 2,
  pluginCount: 1,
  crashCount: 1,
  includesAudit: true,
};

const exported: SupportBundleExportResultV1 = {
  v: 1,
  status: "exported",
  bundleId: context.bundleId,
  archiveBytes: 4_096,
};

function support() {
  return {
    auditContext: vi.fn(() => context),
    cancelled: vi.fn(
      (): SupportBundleExportResultV1 => ({
        v: 1,
        status: "cancelled",
        bundleId: context.bundleId,
      }),
    ),
    export: vi.fn(async () => exported),
  };
}

describe("audited support export", () => {
  it("records a required attempt and successful outcome without the destination path", async () => {
    const service = support();
    const records: AuditAppendV1[] = [];
    await expect(
      runAuditedSupportExport({
        previewId: "preview_01",
        support: service,
        chooseDestination: async () => ({
          canceled: false,
          filePath: "/Users/private/Support Secret.tar.gz",
        }),
        appendAudit: async (record) => {
          records.push(record);
        },
      }),
    ).resolves.toEqual(exported);
    expect(records.map((record) => record.phase)).toEqual(["attempt", "outcome"]);
    expect(records[1]).toMatchObject({
      outcome: "succeeded",
      attrs: { archiveBytes: 4_096, includedAudit: true },
    });
    expect(JSON.stringify(records)).not.toContain("Support Secret");
  });

  it("fails closed before opening a destination dialog when the attempt is unavailable", async () => {
    const service = support();
    const chooseDestination = vi.fn(async () => ({ canceled: true }));
    await expect(
      runAuditedSupportExport({
        previewId: "preview_01",
        support: service,
        chooseDestination,
        appendAudit: async () => {
          throw new Error("audit unavailable");
        },
      }),
    ).rejects.toThrow("audit unavailable");
    expect(chooseDestination).not.toHaveBeenCalled();
    expect(service.export).not.toHaveBeenCalled();
  });

  it("preserves the export failure even if its outcome record also fails", async () => {
    const service = support();
    const actionError = new Error("archive failed");
    service.export.mockRejectedValueOnce(actionError);
    let appends = 0;
    await expect(
      runAuditedSupportExport({
        previewId: "preview_01",
        support: service,
        chooseDestination: async () => ({ canceled: false, filePath: "/private/result.tar.gz" }),
        appendAudit: async () => {
          appends += 1;
          if (appends === 2) throw new Error("audit outcome failed");
        },
      }),
    ).rejects.toBe(actionError);
  });

  it("reports an outcome durability failure after the archive was exported", async () => {
    const service = support();
    let appends = 0;
    await expect(
      runAuditedSupportExport({
        previewId: "preview_01",
        support: service,
        chooseDestination: async () => ({ canceled: false, filePath: "/private/result.tar.gz" }),
        appendAudit: async () => {
          appends += 1;
          if (appends === 2) throw new Error("audit outcome failed");
        },
      }),
    ).rejects.toThrow("audit outcome failed");
    expect(service.export).toHaveBeenCalledOnce();
  });
});
