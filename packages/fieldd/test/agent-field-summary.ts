import type { AgentSessionSummary } from "@vibefield/contracts";

// MF-1 — one managed row as fieldd's FOLD reports it (SessionSummary v2),
// shared by the projection's tests and the store publisher's.
//
// Built fieldd-side ON PURPOSE. The renderer's
// `packages/field-app/test/managed-session-fixture.ts` puts a blocker's `tool`
// at the blocker ROOT, which is a shape nothing upstream produces: puppeteer's
// `MonitorBlocker` nests it at `permission.tool`
// (packages/core/src/monitor/types.ts:76-77). A projection tested against that
// fixture would have pinned the bug instead of the behaviour.

export interface SummaryOptions {
  runtimeRunId?: string;
  status?: AgentSessionSummary["status"];
  statusSince?: string;
  stateChangedAt?: string;
  alive?: boolean;
  monitor?: false;
  pending?: string;
  permissionTool?: string | null;
  cumulativeTokens?: number;
  contextPercent?: number;
  effort?: Record<string, unknown>;
  cwd?: string;
  /** absent = nothing looked; null = looked, not a repo; object = a repo */
  git?: null | { branch?: string | null };
  lastAssistantText?: string;
  title?: string;
  terminal?: AgentSessionSummary["terminal"];
  /** no `terminal` key at all — an ingested row, or one the fold has no PTY for */
  noTerminal?: boolean;
  /** MF-1f — the record is stamped with an exit while the pane is still hosted */
  exited?: boolean;
}

export function managedSummary(options: SummaryOptions = {}): AgentSessionSummary {
  const runtimeRunId = options.runtimeRunId ?? "run-1";
  const createdAt = "2026-09-13T10:00:00.000Z";
  const stateChangedAt = options.stateChangedAt ?? "2026-09-13T10:05:00.000Z";
  const status = options.status ?? "idle";
  const cwd = options.cwd ?? "/repo";
  const monitor =
    options.monitor === false
      ? undefined
      : {
          schemaVersion: 3,
          runtimeEpoch: 1,
          revision: 4,
          runtimeRunId,
          status: status === "unknown" ? "idle" : status,
          statusSince: options.statusSince ?? "2026-09-13T10:04:00.000Z",
          blockers:
            options.permissionTool === undefined
              ? []
              : [
                  {
                    id: "perm-1",
                    kind: "permission",
                    since: "2026-09-13T10:04:00.000Z",
                    detail: "Claude wants to run a command",
                    // puppeteer's real shape: the tool is INSIDE `permission`,
                    // beside a requestId the field must not carry
                    ...(options.permissionTool === null
                      ? { permission: { requestId: "req-1" } }
                      : { permission: { requestId: "req-1", tool: options.permissionTool } }),
                  },
                ],
          ...(options.lastAssistantText !== undefined
            ? { lastAssistantMessage: { text: options.lastAssistantText, final: true } }
            : {}),
          ...(options.cumulativeTokens !== undefined
            ? {
                usage: {
                  cumulativeTokens: options.cumulativeTokens,
                  burnRatePerMin: 120,
                  // the history the phone keeps its own ledgers for
                  samples: [{ at: createdAt, cumulativeTokens: 10 }],
                  asOf: stateChangedAt,
                },
              }
            : {}),
          ...(options.contextPercent !== undefined
            ? {
                context: {
                  usedTokens: options.contextPercent * 2_000,
                  capacityTokens: 200_000,
                  usedPercent: options.contextPercent,
                  percentageSource: "provider",
                },
              }
            : {}),
          model: { id: "claude-opus-5", displayName: "Opus 5", intent: "observed" },
          ...(options.effort !== undefined ? { effort: options.effort } : {}),
          environment: {
            cwd,
            ...("git" in options ? { git: options.git } : {}),
            worktrees: ["/repo-wt"],
          },
          session: { nativeSessionId: `${runtimeRunId}-native` },
          freshness: { lastEvidenceAt: stateChangedAt, level: "native-hooks" },
          alive: options.alive ?? true,
        };
  return {
    sessionId: `${runtimeRunId}-native`,
    sessionIdBasis: "observed",
    kind: "claude",
    label: "Claude Code",
    device: "this-device",
    tier: "managed",
    runtimeRunId,
    runtimeEpoch: 1,
    ...(options.noTerminal === true
      ? {}
      : {
          terminal:
            options.terminal === undefined
              ? { hosted: "local", runtimeSessionId: `${runtimeRunId}-pty`, workloadClass: "agent" }
              : options.terminal,
        }),
    workspace: { mode: "direct", root: cwd, sourcePath: cwd },
    ...(monitor !== undefined ? { monitor } : {}),
    status,
    observationLevel: options.pending !== undefined ? "none" : "native-hooks",
    createdAt,
    stateChangedAt,
    ...(options.title !== undefined ? { title: options.title } : {}),
    continuation:
      options.pending !== undefined
        ? { persisted: true, resumable: true, pending: "resume-when-idle", reason: options.pending }
        : options.exited === true
          ? { persisted: true, resumable: true, exited: true }
          : { persisted: true, resumable: false },
  };
}
