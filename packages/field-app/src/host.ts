// FieldHost (ESR §5.4.1): the runtime-neutral capability seam between the
// field app and whatever hosts it. The Electron renderer-host adapter is one
// implementation (wrapping the preload bridge); browser harnesses and tests
// provide fakes. Product code NEVER touches window.vibefield — that global is
// the adapter's business (wall R1 keeps Electron out of this package).
//
// Slice 4 evolves getConnection into getBootstrap (the WindowBootstrap
// envelope with controlUrl); until that wire exists this mirrors today's
// bridge exactly.

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

/** The terminal transport seam (GT-D3). The renderer redeems its own ticket
 * over fieldd — the one product door — and hands the transport coordinates to a
 * host that can dial a unix socket, which a sandboxed page cannot. Optional
 * because a browser harness has no bridge to offer; the Godview reports that
 * honestly rather than drawing an empty deck. */
export interface FieldTerminalHost {
  /** Answers with the ports attached AND the shell identity only main can read
   * (GT-D10) — the workspace spawns every pane with `defaultShell` at `home`,
   * and neither is knowable in a sandboxed page. */
  connect(ticket: TerminalTicket): Promise<TerminalBackendAttachResult>;
  onStatus(handler: (status: TerminalBridgeStatus) => void): () => void;
}

/** The Godview overlay's open bit, which the HOST owns (GT-D2): ⇧⇧ is detected
 * in main and answered before this page is offered the keystroke, so the
 * renderer reads the state rather than keeping one. `set` with no argument is a
 * flip. */
export interface FieldGodviewHost {
  set(open?: boolean): Promise<GodviewState>;
  onState(handler: (state: GodviewState) => void): () => void;
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
  readonly diagnostics?: FieldDiagnosticsHost;
  readonly platform?: ShellPlatform;
  readonly terminal?: FieldTerminalHost;
  readonly godview?: FieldGodviewHost;
  /** The profile write seam (UA-3). `users.json` is SUPERVISOR-owned, not
   * fieldd's (UA-D10), so the one door to it is main — which is why this is a
   * host capability and not a product method. Every field is optional because
   * a caller changes one thing at a time; an EMPTY params object is the read,
   * and must not write.
   *
   * Optional like `diagnostics`/`terminal`/`godview`: a browser harness has no
   * supervisor to ask, and the Account surface renders its controls disabled
   * and says so rather than pretending it can write. */
  readonly usersUpdate?: (params: {
    name?: string;
    color?: string;
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
  readonly usersCreate?: (params: { name?: string; color?: string }) => Promise<FieldUserProfile>;
  /** UA-5 — attach to an existing user (UA-D15). Switching to the user already
   * attached is main's no-op. Same reload race as `usersCreate`. */
  readonly usersSwitch?: (params: { userId: string }) => Promise<FieldUserProfile>;
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
