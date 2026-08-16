import type {
  DesktopShellState,
  GodviewState,
  ShellCommand,
  ShellPlatform,
  TerminalBackendAttachResult,
  TerminalBridgeStatus,
  TerminalTicket,
} from "@vibefield/contracts";
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

/** The whole user, the way every users door answers — a caller never has to
 * guess what its call did to the rest of the record. Declared once here because
 * UA-5 gave the door four verbs; `usersUpdate` keeps its own inline shape
 * because that is the shape it shipped with. */
interface BridgeUserRecord {
  userId: string;
  fuid: number;
  name: string;
  color?: string;
  resident: boolean;
  onboarded: boolean;
}

declare global {
  /** Replaced by Vite. True only for the explicit `dev:onboarding` run mode. */
  const __VIBEFIELD_FORCE_ONBOARDING__: boolean;

  interface Window {
    vibefield: {
      readonly platform: ShellPlatform;
      claimLiveSurfacePortBridge(): string;
      submitRendererLogs(serializedBatch: string): boolean;
      getConnection(): Promise<{ port: number; token: string }>;
      /** UA-3 — one door, two verbs: empty params READ the current record. */
      usersUpdate(params: {
        name?: string;
        color?: string;
        resident?: boolean;
        onboarded?: boolean;
      }): Promise<{
        userId: string;
        fuid: number;
        name: string;
        color?: string;
        resident: boolean;
        onboarded: boolean;
      }>;
      /** UA-5 — the roster plus main's live attachment. */
      usersList(): Promise<{
        attachedUserId: string | null;
        users: BridgeUserRecord[];
      }>;
      /** UA-5 — mint, then attach. Both fields optional: the reloaded window's
       * Setup Assistant is where identity is decided. RELOAD RACE — see
       * `usersSwitch`. */
      usersCreate(params: { name?: string; color?: string }): Promise<BridgeUserRecord>;
      /** UA-5 — re-target the attachment and reload (UA-D15). This promise may
       * resolve, or may be torn down with the context it would resolve into;
       * callers fire-and-forget and gate nothing on it beyond disabling the
       * control they pressed. */
      usersSwitch(params: { userId: string }): Promise<BridgeUserRecord>;
      onPrepareClose(handler: (requestId: string) => void): () => void;
      completeClose(result: { requestId: string; ok: boolean; error?: string }): void;
      onShellCommand(handler: (command: ShellCommand) => void): () => void;
      onDesktopState(handler: (state: DesktopShellState) => void): () => void;
      terminal: {
        connect(ticket: TerminalTicket): Promise<TerminalBackendAttachResult>;
        onStatus(handler: (status: TerminalBridgeStatus) => void): () => void;
      };
      godview: {
        set(open?: boolean): Promise<GodviewState>;
        onState(handler: (state: GodviewState) => void): () => void;
      };
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
