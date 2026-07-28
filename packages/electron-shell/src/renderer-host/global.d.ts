import type { ShellCommand, ShellPlatform } from "@vibefield/contracts";
import type {
  CrashArtifactListV1,
  DiagnosticLeaseCreateV1,
  DiagnosticLeaseListV1,
  DiagnosticLeaseV1,
  DiagnosticLogDeltaV1,
  DiagnosticLogQueryV1,
  DiagnosticLogSnapshotV1,
  SupportBundleExportResultV1,
  SupportBundlePreviewV1,
  SupportBundleSelectionV1,
} from "@vibefield/contracts/diagnostics";

declare global {
  interface Window {
    vibefield: {
      readonly platform: ShellPlatform;
      submitRendererLogs(serializedBatch: string): boolean;
      getConnection(): Promise<{ port: number; token: string }>;
      onPrepareClose(handler: (requestId: string) => void): () => void;
      completeClose(result: { requestId: string; ok: boolean; error?: string }): void;
      onShellCommand(handler: (command: ShellCommand) => void): () => void;
      diagnostics: {
        query(query: DiagnosticLogQueryV1): Promise<DiagnosticLogSnapshotV1>;
        subscribe(
          query: DiagnosticLogQueryV1,
          onEvent: (
            event:
              | { kind: "delta"; payload: DiagnosticLogDeltaV1 }
              | { kind: "snapshot"; payload: DiagnosticLogSnapshotV1 },
          ) => void,
        ): Promise<{ subId: string; snapshot: DiagnosticLogSnapshotV1 }>;
        unsubscribe(subId: string): Promise<{ removed: boolean }>;
        createLease(request: DiagnosticLeaseCreateV1): Promise<DiagnosticLeaseV1>;
        listLeases(): Promise<DiagnosticLeaseListV1>;
        revokeLease(request: { leaseId: string }): Promise<{ revoked: boolean }>;
        openLogs(): Promise<void>;
        listCrashes(): Promise<CrashArtifactListV1>;
        markCrashViewed(request: { artifactId: string }): Promise<{ viewed: boolean }>;
        previewSupport(selection: SupportBundleSelectionV1): Promise<SupportBundlePreviewV1>;
        exportSupport(request: { previewId: string }): Promise<SupportBundleExportResultV1>;
        copyText(text: string): Promise<void>;
      };
    };
  }
}
