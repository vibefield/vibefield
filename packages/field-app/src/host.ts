// FieldHost (ESR §5.4.1): the runtime-neutral capability seam between the
// field app and whatever hosts it. The Electron renderer-host adapter is one
// implementation (wrapping the preload bridge); browser harnesses and tests
// provide fakes. Product code NEVER touches window.vibefield — that global is
// the adapter's business (wall R1 keeps Electron out of this package).
//
// Slice 4 evolves getConnection into getBootstrap (the WindowBootstrap
// envelope with controlUrl); until that wire exists this mirrors today's
// bridge exactly.

import type { DesktopShellState, ShellCommand, ShellPlatform } from "@vibefield/contracts";
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
import type { RendererLogger } from "./logging";

export type FieldDiagnosticEvent =
  | { kind: "delta"; payload: DiagnosticLogDeltaV1 }
  | { kind: "snapshot"; payload: DiagnosticLogSnapshotV1 };

export interface FieldDiagnosticsHost {
  query(query: DiagnosticLogQueryV1): Promise<DiagnosticLogSnapshotV1>;
  subscribe(
    query: DiagnosticLogQueryV1,
    onEvent: (event: FieldDiagnosticEvent) => void,
  ): Promise<{
    snapshot: DiagnosticLogSnapshotV1;
    dispose(): Promise<void>;
  }>;
  createLease(request: DiagnosticLeaseCreateV1): Promise<DiagnosticLeaseV1>;
  listLeases(): Promise<DiagnosticLeaseListV1>;
  revokeLease(request: { leaseId: string }): Promise<{ revoked: boolean }>;
  openLogs(): Promise<void>;
  listCrashes(): Promise<CrashArtifactListV1>;
  markCrashViewed(request: { artifactId: string }): Promise<{ viewed: boolean }>;
  previewSupport(selection: SupportBundleSelectionV1): Promise<SupportBundlePreviewV1>;
  exportSupport(request: { previewId: string }): Promise<SupportBundleExportResultV1>;
  copyText(text: string): Promise<void>;
}

export interface FieldHost {
  readonly logger: RendererLogger;
  readonly diagnostics?: FieldDiagnosticsHost;
  readonly platform?: ShellPlatform;
  getConnection(): Promise<{ port: number; token: string }>;
  onPrepareClose(handler: (requestId: string) => void): () => void;
  completeClose(result: { requestId: string; ok: boolean; error?: string }): void;
  onShellCommand?(handler: (command: ShellCommand) => void): () => void;
  onDesktopState?(handler: (state: DesktopShellState) => void): () => void;
}

let current: FieldHost | null = null;

/** Wired once by mountFieldApp before anything else runs. */
export function setHost(host: FieldHost): void {
  current = host;
}

export function getHost(): FieldHost {
  if (current === null) throw new Error("FieldHost not set — mountFieldApp wires it first");
  return current;
}
