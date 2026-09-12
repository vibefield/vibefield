import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMonitorState } from "@vibecook/puppeteer-core";
import type { AgentSessionInfo } from "@vibecook/puppeteer-runtime";
import {
  AGENT_SESSION_RECORD_FORMAT,
  AgentMonitorMirror,
  type AgentSessionRecord,
  AgentSessionRecord as AgentSessionRecordSchema,
  type AgentSessionSummary,
  type AgentStatus,
  type TerminalInfo,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";

// The managed-session records and the fold's projection (AR-3;
// thinking-ar-agent-plane.md §5/§7/§9 as ruled). Pure where it can be: the
// projection is a function of puppeteer's facts, the floor's inventory row
// and the record, so the seam is testable without a PTY.

/** `users/<fuid>/agents/sessions/<runtimeRunId>.json` — one record per
 * managed session (LAYOUT.AGENT_SESSIONS_DIR), 0600, temp + durable rename,
 * the directory 0700. Read at resume and (AR-4) at re-attach; a record that
 * cannot be read is set aside for a human, never overwritten and never a
 * boot failure. The continuation inside is puppeteer's and opaque. */
export class SessionRecordStore {
  private readonly logger: Logger;

  constructor(private readonly opts: { dir: string; now: () => Date; logger?: Logger }) {
    this.logger = opts.logger ?? createNoopLogger();
  }

  path(runtimeRunId: string): string {
    return join(this.opts.dir, `${encodeURIComponent(runtimeRunId)}.json`);
  }

  read(runtimeRunId: string): AgentSessionRecord | undefined {
    return this.readPath(this.path(runtimeRunId));
  }

  /** Every readable record, newest first. */
  list(): AgentSessionRecord[] {
    let names: string[];
    try {
      names = readdirSync(this.opts.dir).filter((name) => name.endsWith(".json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: AgentSessionRecord[] = [];
    for (const name of names) {
      const record = this.readPath(join(this.opts.dir, name));
      if (record !== undefined) records.push(record);
    }
    return records.sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    );
  }

  write(record: AgentSessionRecord): void {
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    const path = this.path(record.runtimeRunId);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    durableRenameSync(tmp, path);
  }

  /** Stamp the exit onto an existing record; a missing record is left missing. */
  stampExit(runtimeRunId: string, exit: NonNullable<AgentSessionRecord["exited"]>): boolean {
    const record = this.read(runtimeRunId);
    if (record === undefined) return false;
    this.write({ ...record, exited: exit, updatedAt: this.opts.now().toISOString() });
    return true;
  }

  remove(runtimeRunId: string): void {
    rmSync(this.path(runtimeRunId), { force: true });
  }

  private readPath(path: string): AgentSessionRecord | undefined {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const record = AgentSessionRecordSchema.safeParse(parsed);
    if (record.success) return record.data;
    const aside = `${path}.unreadable-${Date.now()}`;
    this.logger.error(
      "fieldd.agents.session_record_unreadable",
      "A managed-session record is unreadable; set aside",
      undefined,
      { aside, issue: record.error.issues[0]?.message ?? "invalid json" },
    );
    try {
      renameSync(path, aside);
    } catch {
      // nothing else to do: the next write of this id replaces it
    }
    return undefined;
  }
}

/** A fresh record for a run puppeteer just started (spawned or resumed). */
export function recordForRun(input: {
  info: AgentSessionInfo;
  cwd: string;
  title?: string | undefined;
  now: string;
}): AgentSessionRecord {
  const { info } = input;
  return {
    format: AGENT_SESSION_RECORD_FORMAT,
    runtimeRunId: info.runtimeRunId,
    runtimeEpoch: info.runtimeEpoch,
    provider: info.provider.id,
    ...(info.profileId !== undefined ? { profileId: info.profileId } : {}),
    cwd: input.cwd,
    ...(input.title !== undefined ? { title: input.title } : {}),
    terminalSessionId: info.terminalSessionId,
    continuation: { ...info.continuation },
    workspace: workspaceOf(info),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function workspaceOf(info: AgentSessionInfo): AgentSessionSummary["workspace"] {
  const { workspace } = info;
  return {
    mode: workspace.mode,
    root: workspace.root,
    sourcePath: workspace.sourcePath,
    ...(workspace.branch !== undefined ? { branch: workspace.branch } : {}),
  };
}

/** The one derived status (AR-D4): puppeteer's headline, `unknown` when
 * there is no state yet or the headline is a word this contract does not
 * know (the mirror keeps `status` open; the fold folds). */
export function foldStatus(monitor: AgentMonitorMirror | undefined): AgentStatus {
  if (monitor === undefined) return "unknown";
  switch (monitor.status) {
    case "idle":
    case "working":
    case "blocked":
      return monitor.status;
    default:
      return "unknown";
  }
}

/** puppeteer's monitor state as the contract's mirror, or undefined (logged
 * once per run by the caller) when the pinned shape and the running one
 * disagree — the row still exists, with `status: unknown`. */
export function mirrorOf(state: AgentMonitorState | undefined): {
  mirror: AgentMonitorMirror | undefined;
  issue?: string | undefined;
} {
  if (state === undefined) return { mirror: undefined };
  const parsed = AgentMonitorMirror.safeParse(state);
  if (parsed.success) return { mirror: parsed.data };
  return {
    mirror: undefined,
    issue: parsed.error.issues[0]?.message ?? "monitor state did not parse",
  };
}

export interface SummarizeInput {
  info: AgentSessionInfo;
  monitor: AgentMonitorMirror | undefined;
  observationLevel: string;
  device: string;
  /** the floor's inventory row for the run's terminal, when observed */
  terminal: TerminalInfo | undefined;
  /** whether the terminal is (still) known to be hosted here */
  hosted: boolean;
  record: { persisted: boolean; resumable: boolean };
  createdAt: string;
  stateChangedAt: string;
  lastActivityAt?: string | undefined;
  title?: string | undefined;
}

/** SessionSummary v2 for a managed run — pure. */
export function summarizeManaged(input: SummarizeInput): AgentSessionSummary {
  const { info, monitor } = input;
  // puppeteer's own claim about the native id and how it was learned
  // (configured at launch → observed from the vendor's evidence); never
  // inferred here from a field's presence
  return {
    sessionId: info.nativeSession.id,
    sessionIdBasis: info.nativeSession.basis,
    kind: info.provider.id,
    label: info.provider.label,
    device: input.device,
    tier: "managed",
    runtimeRunId: info.runtimeRunId,
    runtimeEpoch: info.runtimeEpoch,
    ...(info.profileId !== undefined ? { profileId: info.profileId } : {}),
    terminal: input.hosted
      ? {
          hosted: "local",
          runtimeSessionId: info.terminalSessionId,
          ...(input.terminal?.cell !== undefined
            ? {
                cellBootId: input.terminal.cell.cellBootId,
                ...(input.terminal.cell.workloadClass !== undefined
                  ? { workloadClass: input.terminal.cell.workloadClass }
                  : {}),
              }
            : {}),
        }
      : { hosted: "none" },
    workspace: workspaceOf(info),
    ...(monitor !== undefined ? { monitor } : {}),
    status: foldStatus(monitor),
    observationLevel: input.observationLevel,
    createdAt: input.createdAt,
    stateChangedAt: input.stateChangedAt,
    ...(input.lastActivityAt !== undefined ? { lastActivityAt: input.lastActivityAt } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    continuation: input.record,
  };
}
