// FieldHost (ESR §5.4.1): the runtime-neutral capability seam between the
// field app and whatever hosts it. The Electron renderer-host adapter is one
// implementation (wrapping the preload bridge); browser harnesses and tests
// provide fakes. Product code NEVER touches window.vibefield — that global is
// the adapter's business (wall R1 keeps Electron out of this package).
//
// Electron's bootstrap includes an authenticated renderer participant identity;
// browser harnesses may omit it because they have no shell lifecycle witness.

import type {
  DesktopShellState,
  FrameView,
  FrameViewState,
  RendererParticipantIdentity,
  ScreenshotCaptureResult,
  ScreenshotPreviewResult,
  ShellCommand,
  ShellPlatform,
  WindowTerminalBootstrap,
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
import type { LiveSurfaceRendererTransport } from "@vibefield/live-surfaces/renderer";
import type { RendererLogger } from "./logging";

export type FieldDiagnosticEvent =
  | { kind: "delta"; payload: DiagnosticLogDeltaV1 }
  | { kind: "snapshot"; payload: DiagnosticLogSnapshotV1 };

export interface FieldConnection {
  port: number;
  token: string;
  /** Present on the production Electron bridge; absent in browser harnesses. */
  rendererParticipant?: RendererParticipantIdentity;
  /** Present on the TP-aware Electron bridge; absent on older/browser hosts. */
  terminal?: WindowTerminalBootstrap;
}

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

// The GT-D3 terminal bridge seam (`FieldTerminalHost` — connect + status)
// RETIRED at TP-S3e: the renderer dials the cells' T1 doors itself over the
// routed runtime, and shell/home policy rides the window bootstrap.

/** The window's active view, which the HOST owns (One Frame FR-1; GT-D2's
 * Godview bit grown into the four views): main's View menu marks it and lends
 * ⌘W to Godview's panes by it, so the renderer reads the view rather than
 * keeping one. `set` asks for a view by name and answers what main holds. */
export interface FieldViewHost {
  set(view: FrameView): Promise<FrameViewState>;
  onState(handler: (state: FrameViewState) => void): () => void;
}

/** The Live Surfaces seam (DT-2a). The renderer host claims the main-world port
 * handoff once per renderer generation — before product or plugin activation,
 * because the ports ARE the capability and a later listener must not see them —
 * and hands the resulting transport through here.
 *
 * A promise, not a transport: the claim happens at host bootstrap and the ports
 * arrive one window message later. Optional like `diagnostics`/`view`: the
 * browser-only catalog has no privileged main process to claim from, and
 * `getSurfacePool` answers null there rather than pretending.
 *
 * The HOST owns the transport's lifetime (it disposes on pagehide); the pool in
 * front of it owns only attachments. */
export interface FieldLiveSurfacesHost {
  readonly transport: Promise<LiveSurfaceRendererTransport<VideoFrame>>;
}

/** The profile record `usersUpdate` answers with — the whole user, so a caller
 * never has to guess what its write did to the rest of it. A structural subset
 * of the `UserRecord` contract (`contracts/src/users.ts`): the extra
 * `createdAt` a real record carries satisfies this shape, which is what lets
 * the adapter hand the parsed contract type straight through. */
export interface FieldUserProfile {
  userId: string;
  fuid: number;
  name: string;
  /** UA-D17 — the user's face. Absent until the Setup Assistant's pane 2 is
   * passed (W6), or for a pre-v0.3 user until main deals one on their first
   * attach; a face-less user is DRAWN with `effectiveFaces`' deal, never as a
   * blank. */
  face?: FieldUserFace;
  /** @deprecated the pre-v0.3 accent slot. W6 reads its presence as "pane 2
   * was answered once"; nothing draws it (UA-D17 — a person has no colour). */
  color?: string;
  resident: boolean;
  onboarded: boolean;
  /** UA-3w — set to "migrated" on the user the flat-v1 migration minted. A
   * PASSTHROUGH field on the record, deliberately absent from the `UserRecord`
   * schema: the Setup Assistant reads it to pick its two-decision variant, and
   * the tolerant reader carries it through untouched. Typed `string` because a
   * future writer may say something this build has never heard of. */
  setupVariant?: string;
}

/** UA-D17 — a face as the host carries it: one emoji, and a frame whose
 * absence means sticker. Structurally the contract's `UserFace`. */
export interface FieldUserFace {
  emoji: string;
  frame?: "sticker" | "coin";
}

/** UA-5 — the machine's roster as `usersList` answers it. `attachedUserId` is
 * main's LIVE attachment, not `users.json`'s `lastAttached` (which is only a
 * hint for the next boot), so the switcher's "current" marker is never a guess.
 * Null when the host cannot name one. */
export interface FieldUserRoster {
  attachedUserId: string | null;
  users: FieldUserProfile[];
}

export interface FieldHost {
  readonly logger: RendererLogger;
  /** Development renderer capability: reopen setup from its fresh-user pane on
   * every boot without changing the supervisor-owned durable profile. */
  readonly forceOnboarding?: boolean;
  readonly diagnostics?: FieldDiagnosticsHost;
  readonly platform?: ShellPlatform;
  readonly view?: FieldViewHost;
  readonly liveSurfaces?: FieldLiveSurfacesHost;
  /** The profile write seam (UA-3). `users.json` is SUPERVISOR-owned, not
   * fieldd's (UA-D10), so the one door to it is main — which is why this is a
   * host capability and not a product method. Every field is optional because
   * a caller changes one thing at a time; an EMPTY params object is the read,
   * and must not write.
   *
   * Optional like `diagnostics`/`terminal`/`view`: a browser harness has no
   * supervisor to ask, and the Account surface renders its controls disabled
   * and says so rather than pretending it can write. */
  readonly usersUpdate?: (params: {
    name?: string;
    /** UA-D17 — main refuses a face another user wears, a refused emoji, or
     * more than one grapheme, and the refusal's message is the sentence to
     * show (`faceProblem`). */
    face?: FieldUserFace;
    resident?: boolean;
    /** The §6 completion flag (UA-3w). Written ONCE, by the wizard's last pane,
     * and only after everything it promised to record actually landed. */
    onboarded?: boolean;
  }) => Promise<FieldUserProfile>;
  /** UA-5 — who else is on this machine. Optional for the same reason
   * `usersUpdate` is: absent means an older shell or a browser harness, and the
   * switcher says so rather than drawing an empty roster. */
  readonly usersList?: () => Promise<FieldUserRoster>;
  /** UA-5 — mint user N, then attach to it. No name is asked for here: the
   * reloaded window runs the Setup Assistant's second-user variant, which is
   * where identity is actually decided (§6.2).
   *
   * THE RELOAD RACE, shared with `usersSwitch`: attaching re-targets this
   * window and reloads it (UA-D15), tearing down the context this promise would
   * resolve into. It may resolve or it may never settle — a caller must treat
   * both as normal. Fire and forget: disable the control that was pressed and
   * gate nothing else on the answer, because the reload IS the feedback. There
   * is no success state to render; only a REJECTION is worth a face. */
  readonly usersCreate?: (params: { name?: string }) => Promise<FieldUserProfile>;
  /** UA-5 — attach to an existing user (UA-D15). Switching to the user already
   * attached is main's no-op. Same reload race as `usersCreate`. */
  readonly usersSwitch?: (params: { userId: string }) => Promise<FieldUserProfile>;
  /** SNAP-D3 — the native screenshot helper, through main. Optional like the
   * users doors: a browser harness has no helper to spawn, and a surface that
   * offers the capture renders disabled and says so. The answer is the
   * contract's own result — a still on disk (and on the clipboard), a cancel,
   * or a typed error such as `helper-missing` or `permission-denied`. How the
   * still reaches the canvas is a later slice; the clipboard tray calls this. */
  readonly screenshotCapture?: () => Promise<ScreenshotCaptureResult>;
  /** SNAP-3 — the answer to a capture MAIN ran on the page's behalf (the View
   * menu's item, its accelerator). A capture this page asked for through
   * `screenshotCapture` already answered it; this is how the other door stops
   * being invisible to the tray that holds the still. Optional like the door:
   * a browser harness has no menu. */
  readonly onScreenshotResult?: (handler: (result: ScreenshotCaptureResult) => void) => () => void;
  /** SNAP-3 — the URL a retained still is shown through: the shell-owned
   * `vibefield-still://` scheme, which only main can serve. A harness without
   * the shell leaves this undefined; a tile then renders without its image
   * and says so, rather than pretending. */
  readonly screenshotStillUrl?: (path: string) => string;
  /** Preview a retained still through the native host; no window navigation. */
  readonly screenshotPreview?: (path: string) => Promise<ScreenshotPreviewResult>;
  getConnection(): Promise<FieldConnection>;
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
