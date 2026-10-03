import type {
  DesktopShellState,
  FrameView,
  FrameViewState,
  FrameZoomAct,
  ScreenshotCaptureResult,
  ScreenshotPreviewResult,
  ShellCommand,
  ShellPlatform,
  ThemePreference,
  ThemeState,
  WindowConnection,
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
import type { ProductAppearanceRendererApi } from "../studio/product-preload-bridge";
import type { StudioRendererApi } from "../studio/studio-preload-bridge";

/** The whole user, the way every users door answers — a caller never has to
 * guess what its call did to the rest of the record. Declared once here because
 * UA-5 gave the door four verbs; `usersUpdate` keeps its own inline shape
 * because that is the shape it shipped with. */
interface BridgeUserRecord {
  userId: string;
  fuid: number;
  name: string;
  /** UA-D17 — absent until pane 2 is passed, or a pre-v0.3 user's first
   * attach deals one. */
  face?: BridgeUserFace;
  /** @deprecated the pre-v0.3 accent; W6 reads its presence, nothing draws it. */
  color?: string;
  resident: boolean;
  onboarded: boolean;
}

/** UA-D17 — one emoji; an absent frame is a sticker. */
interface BridgeUserFace {
  emoji: string;
  frame?: "sticker" | "coin";
}

declare global {
  /** Replaced by Vite. True only for the explicit `dev:onboarding` run mode. */
  const __VIBEFIELD_FORCE_ONBOARDING__: boolean;

  /** Replaced by Vite. True only in the `terminal-perf-lab` build (TP-S0c), so
   * every other bundle folds the perf-lab branch away statically. */
  const __VIBEFIELD_TERMINAL_PERF_LAB__: boolean;

  interface Window {
    vibefieldStudio: StudioRendererApi;
    vibefieldStudioAppearance: ProductAppearanceRendererApi;
    vibefield: {
      readonly platform: ShellPlatform;
      claimLiveSurfacePortBridge(): string;
      submitRendererLogs(serializedBatch: string): boolean;
      getConnection(): Promise<WindowConnection>;
      /** UA-3 — one door, two verbs: empty params READ the current record. */
      usersUpdate(params: {
        name?: string;
        face?: BridgeUserFace;
        resident?: boolean;
        onboarded?: boolean;
      }): Promise<BridgeUserRecord>;
      /** UA-5 — the roster plus main's live attachment. */
      usersList(): Promise<{
        attachedUserId: string | null;
        users: BridgeUserRecord[];
      }>;
      /** UA-5 — mint, then attach. The name is optional and the face is never
       * minted: the reloaded window's Setup Assistant is where identity is
       * decided (UA-D17). RELOAD RACE — see `usersSwitch`. */
      usersCreate(params: { name?: string }): Promise<BridgeUserRecord>;
      /** UA-5 — re-target the attachment and reload (UA-D15). This promise may
       * resolve, or may be torn down with the context it would resolve into;
       * callers fire-and-forget and gate nothing on it beyond disabling the
       * control they pressed. */
      usersSwitch(params: { userId: string }): Promise<BridgeUserRecord>;
      onPrepareClose(handler: (requestId: string) => void): () => void;
      completeClose(result: { requestId: string; ok: boolean; error?: string }): void;
      onShellCommand(handler: (command: ShellCommand) => void): () => void;
      onDesktopState(handler: (state: DesktopShellState) => void): () => void;
      view: {
        set(view: FrameView): Promise<FrameViewState>;
        onState(handler: (state: FrameViewState) => void): () => void;
        /** FR-4 (3b) — the View menu's zoom, as an act for the head. */
        onZoom(handler: (act: FrameZoomAct) => void): () => void;
      };
      /** FR-4 — the app's one theme (FC-D5), which main owns. */
      theme: {
        set(preference: ThemePreference): Promise<ThemeState>;
        onState(handler: (state: ThemeState) => void): () => void;
      };
      /** SNAP-D3 — the native screenshot helper through main; the answer is
       * the contract's own result (still on disk + clipboard, cancel, or a
       * typed error). */
      screenshot: {
        preview(name: string): Promise<ScreenshotPreviewResult>;
        capture(): Promise<ScreenshotCaptureResult>;
        /** SNAP-3 — the result of a capture MAIN ran (the View menu's item);
         * the latest is retained until the renderer subscribes. */
        onResult(handler: (result: ScreenshotCaptureResult) => void): () => void;
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
