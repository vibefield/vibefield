import type { AgentSessionSummary, AgentStatus } from "@vibefield/contracts";

/**
 * A managed session's row as fieldd's fold reports it (SessionSummary v2,
 * AR-3) — test-local, real-shaped (DESIGN.md §9), and honest about what a row
 * carries: the provider's OPEN id and label, the run identity, the floor
 * session the pane join reads, and puppeteer's monitor projection under
 * `monitor` only when the fixture asks for one.
 */
export interface ManagedSummaryOptions {
  runtimeRunId?: string;
  /** the floor session id (`terminal.runtimeSessionId`); null = no terminal */
  terminalSessionId?: string | null;
  kind?: string;
  label?: string;
  status?: AgentStatus;
  alive?: boolean;
  cwd?: string;
  branch?: string | null | undefined;
  /** absent = no git observation at all; null = observed "not a repo" */
  gitObserved?: boolean;
  model?: { id: string; displayName?: string };
  contextPercent?: number;
  /** A pending interaction, built in CORE'S OWN SHAPE: a permission carries
   * `permission: {requestId, tool?}` nested, never a root `tool` (puppeteer
   * `core/src/monitor/types.ts:74–78`). The fixture used to invent the flat
   * shape, which is why a renderer reading the root field passed its tests and
   * said a bare "permission" on every real board (GT-6 review). */
  blocker?: { kind: string; tool?: string; detail?: string; question?: string };
  lastAssistantText?: string;
  createdAt?: string;
  profileId?: string;
  /** AR-S5 — the Agent Profile fieldd says the run was born under */
  profileSet?: string;
  /** omit the monitor projection entirely (a run before its first state) */
  monitor?: false;
  /**
   * AR-4 — a PENDING row: a live PTY fieldd could not re-attach to, with
   * fieldd's reason; the row is then unobserved (no monitor, status unknown).
   *
   * Unless `alive` is asked for explicitly, which builds the one row this
   * fixture otherwise cannot: pending AND carrying a monitor mirror from before
   * — the shape that decides whether the classifier's drop is asked first.
   */
  pending?: string;
  /** AR-4 — this run was re-attached across a fieldd restart */
  reattached?: boolean;
  /** AR-4 — the floor session this run replaced at a resume-when-idle */
  replaced?: string;
}

export function managedSummary(options: ManagedSummaryOptions = {}): AgentSessionSummary {
  const runtimeRunId = options.runtimeRunId ?? "run-1";
  const terminalSessionId =
    options.terminalSessionId === undefined ? `${runtimeRunId}-pty` : options.terminalSessionId;
  const status = options.pending !== undefined ? "unknown" : (options.status ?? "idle");
  const createdAt = options.createdAt ?? "2026-09-12T10:00:00.000Z";
  const cwd = options.cwd ?? "/project/vibe-field";
  const monitor =
    options.monitor === false || (options.pending !== undefined && options.alive === undefined)
      ? undefined
      : {
          schemaVersion: 3,
          runtimeEpoch: 1,
          revision: 3,
          runtimeRunId,
          status: status === "unknown" ? "idle" : status,
          statusSince: createdAt,
          blockers:
            options.blocker === undefined
              ? []
              : [
                  {
                    id: "blocker-1",
                    kind: options.blocker.kind,
                    since: createdAt,
                    ...(options.blocker.detail !== undefined
                      ? { detail: options.blocker.detail }
                      : {}),
                    // a question's prompt rides under `questions`, as Core's
                    // does (`MonitorStructuredQuestion`), never at the root
                    ...(options.blocker.question !== undefined
                      ? { questions: [{ prompt: options.blocker.question }] }
                      : {}),
                    // Only a permission carries one, and Core nests it: the
                    // tool rides under `permission`, beside the request id the
                    // verdict door will answer with.
                    ...(options.blocker.kind === "permission"
                      ? {
                          permission: {
                            requestId: "req-1",
                            ...(options.blocker.tool !== undefined
                              ? { tool: options.blocker.tool }
                              : {}),
                          },
                        }
                      : {}),
                  },
                ],
          ...(options.lastAssistantText !== undefined
            ? { lastAssistantMessage: { text: options.lastAssistantText } }
            : {}),
          ...(options.model !== undefined ? { model: options.model } : {}),
          ...(options.contextPercent !== undefined
            ? {
                context: {
                  usedTokens: options.contextPercent * 2_000,
                  capacityTokens: 200_000,
                  usedPercent: options.contextPercent,
                },
              }
            : {}),
          environment: {
            cwd,
            ...(options.gitObserved === true
              ? { git: options.branch === null ? null : { branch: options.branch } }
              : {}),
            worktrees: [],
          },
          session: { nativeSessionId: `${runtimeRunId}-native` },
          freshness: { lastEvidenceAt: createdAt, level: "native-hooks" },
          alive: options.alive ?? true,
        };
  return {
    sessionId: `${runtimeRunId}-native`,
    sessionIdBasis: "observed",
    kind: options.kind ?? "codex",
    label: options.label ?? (options.kind === undefined ? "Codex" : options.kind),
    device: "this-device",
    tier: "managed",
    runtimeRunId,
    runtimeEpoch: 1,
    ...(options.profileId !== undefined ? { profileId: options.profileId } : {}),
    ...(options.profileSet !== undefined ? { profileSet: options.profileSet } : {}),
    terminal:
      terminalSessionId === null
        ? { hosted: "none" }
        : {
            hosted: "local",
            runtimeSessionId: terminalSessionId,
            workloadClass: "agent",
            ...(options.replaced !== undefined ? { replaced: options.replaced } : {}),
          },
    workspace: {
      mode: "direct",
      root: cwd,
      sourcePath: cwd,
      ...(typeof options.branch === "string" && options.gitObserved !== true
        ? { branch: options.branch }
        : {}),
    },
    ...(monitor !== undefined ? { monitor } : {}),
    status,
    observationLevel: options.pending !== undefined ? "none" : "native-hooks",
    createdAt,
    stateChangedAt: createdAt,
    continuation:
      options.pending !== undefined
        ? { persisted: true, resumable: true, pending: "resume-when-idle", reason: options.pending }
        : {
            persisted: true,
            resumable: false,
            ...(options.reattached === true ? { reattached: true } : {}),
          },
  };
}
