import type { AgentSessionRecord, AgentSpawnedBy, TerminalInfo } from "@vibefield/contracts";
import {
  findOwningProcess,
  type ProcessTable,
  readProcessTable,
  watchProcessExit,
} from "@vibefield/puppeteer-runtime/spawn-through";

// A TYPED RUN, as the fold holds it (AR-7b/c; thinking-ar7-typed-agents.md
// §5.2–§5.3, §6): a run puppeteer adopted in a terminal the person's own shell
// owns. Three things set it apart from a run one of our doors started, and
// they are all here, beside the kit's functions they stand on:
//
//  · its PROCESS is the shell's child, not the floor's session: no exit event
//    reaches fieldd for it, so its pid is watched;
//  · its PANE is a live shell that outlives it: the row is withdrawn when the
//    agent ends and nothing of the terminal is ever ended for it;
//  · its RECORD is trusted on its own proof across a fieldd restart, because
//    AR-4b's rule — only PTYs born on the agent cell — refuses exactly the
//    terminal a typed run lives in.

/** The word a typed run's row and record carry (contracts `AGENT_SPAWNED_BY`). */
export const SPAWNED_BY_SHELL = "user-shell" satisfies AgentSpawnedBy;

/** Whether a row, a record or an entry is a typed run's. Absent reads `app`. */
export function isTypedRun(run: { spawnedBy?: string | undefined }): boolean {
  return run.spawnedBy === SPAWNED_BY_SHELL;
}

/** How often a typed run's pid is asked whether it still lives, and how long
 * the terminal's own exit report is given to arrive first (it carries what a
 * vanished pid cannot: whether the shell itself ended, and how — or, in the
 * shell's own command-end report, the status it reaped, Q06). */
export const TYPED_WATCH = { intervalMs: 250, graceMs: 250 } as const;

export interface TypedWatchOptions {
  intervalMs?: number | undefined;
  graceMs?: number | undefined;
}

/** Watch the process a typed run became. `onExit` fires once; the function
 * answered stops the watch. No timer of it holds fieldd's own exit. */
export function watchTypedProcess(
  pid: number,
  onExit: () => void,
  options: TypedWatchOptions = {},
): () => void {
  return watchProcessExit(
    pid,
    {
      intervalMs: options.intervalMs ?? TYPED_WATCH.intervalMs,
      graceMs: options.graceMs ?? TYPED_WATCH.graceMs,
    },
    onExit,
  );
}

/**
 * Q06 — a shell's report that a command it ran has ENDED: its integration's
 * command-end mark (OSC 133;D) with the status the shell reaped, and the
 * process group the command ran as. It is how a typed run's crash is told from
 * a clean quit, which a vanished pid cannot tell (the agent is the shell's
 * child, and only the shell reaps it).
 *
 * NOT ON ANY WIRE YET. ghosttea's protocol at the pin (0.13.7) has no such
 * event: a session's activity says `shell-idle` or `foreground-job` from its
 * process groups, and nothing carries a status. So nothing produces this
 * today; the floor's event, once it exists, is fanned out by the terminal
 * service and reaches `AgentRuntimeService.handleCommandFinished` as
 * `session-exited` reaches `handleTerminalExit`. Its wire shape is then a
 * contract (`packages/contracts`), this its reading.
 */
export interface TerminalCommandFinished {
  /** the floor session whose shell ran the command */
  sessionId: string;
  /** the status the shell reaped: 0 is a clean end; a shell reports a signal
   * as 128 plus its number, which a program's own exit code can also be */
  exitCode: number;
  /** the process group the command ran as, its job's leader; absent when the
   * floor cannot say, and then the report speaks for no run */
  processGroupId?: number | undefined;
}

/** A process's end as the fold stamps it and puppeteer reads it. */
export interface TypedExit {
  exitCode: number | null;
  signal: string | null;
  reason: string;
}

/** Q06 — the record's word for a typed run that FAILED by its shell's report:
 * the job's own non-zero status, as the shell reaped it — never a vanished
 * pid's `process-exited`, which says nothing of how, nor the terminal's own
 * end, which is the shell's and not the agent's. */
export const COMMAND_FAILED = "command-failed";

/** Q06 — a typed run's exit from its shell's report: 0 is the clean end the
 * floor words `completed`; any other status is the process's failure, carried
 * as its code and never decoded into a signal (above 128 is a shell's
 * convention, not evidence). puppeteer reads a non-zero code as a crash
 * (`processExitReason`: no signal, a code that is not 0). */
export function typedExitOf(report: Pick<TerminalCommandFinished, "exitCode">): TypedExit {
  return report.exitCode === 0
    ? { exitCode: 0, signal: null, reason: "completed" }
    : { exitCode: report.exitCode, signal: null, reason: COMMAND_FAILED };
}

/** One read of the whole process table — the kit's (`ps`, once): every pid,
 * its parent, and when it started. Undefined when `ps` cannot say. */
export function readProcesses(): Promise<ProcessTable | undefined> {
  return readProcessTable();
}

/** Whether no process holds the pid now. A pid that belongs to someone else
 * (EPERM) is alive. */
export function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "EPERM";
  }
}

export type TypedRunVerdict =
  | { holds: true; shellPid: number }
  | {
      holds: false;
      why:
        | "unverified"
        | "no-process"
        | "no-shell"
        | "shell-named"
        | "table-unread"
        | "process-gone"
        | "process-reused"
        | "outside-terminal";
    };

/** THE PROOF a typed run's record gives before fieldd re-attaches to it
 * (AR-7c) — the whole rule, in one place.
 *
 * Why it exists: a session record is a CONTROL INPUT. The boot attaches to
 * the terminal a record names, and for a run fieldd spawned it may later END
 * that terminal (resume-when-idle, a resume by hand) — which is why AR-4b
 * trusts only terminals born on the agent cell. A typed run lives in the
 * person's own shell, off that cell by construction, so it is trusted on
 * other evidence and is given less:
 *
 *  1. the record VERIFIES — its signature, under this root's key (the store
 *     sets an unsigned or forged record aside before anything reads it; the
 *     caller says what the store said);
 *  2. the floor LISTS the terminal the record names, with a shell;
 *  3. the recorded PROCESS is alive AND started when the record says — a pid
 *     is handed on, a start time is not;
 *  4. that process's ANCESTRY reaches the terminal's shell — the kit's own
 *     walk, matched by pid and start — and is not the shell itself (B1: the
 *     shell is never the agent).
 *
 * All four, read from ONE read of the process table. And what a record that
 * passes may cause is one thing: an attach to a process already running in
 * that terminal. A typed run is never replaced — no resume-when-idle, no
 * replacement by hand — so nothing here can end a terminal, and nothing is
 * spawned, so nothing here can choose a working directory. The EL7 argument
 * in full: a forged or stale record can at worst stamp ITSELF exited. */
export async function typedRunProof(input: {
  record: AgentSessionRecord;
  /** the store's word on the record's signature */
  verified: boolean;
  /** the floor's row for the terminal the record names */
  terminal: TerminalInfo;
  /** one read of the process table; undefined = it could not be read */
  table: ProcessTable | undefined;
}): Promise<TypedRunVerdict> {
  const { record, terminal, table } = input;
  if (!input.verified) return { holds: false, why: "unverified" };
  if (record.process === undefined) return { holds: false, why: "no-process" };
  if (terminal.pid === undefined) return { holds: false, why: "no-shell" };
  // B1 — THE SHELL IS NEVER THE AGENT: a record naming the terminal's own
  // shell as its process would attach fieldd to the person's shell, and a
  // stop would signal it. The kit's walk would match it at depth 0.
  if (record.process.pid === terminal.pid) return { holds: false, why: "shell-named" };
  if (table === undefined) return { holds: false, why: "table-unread" };
  const recorded = table.get(record.process.pid);
  if (recorded === undefined) return { holds: false, why: "process-gone" };
  if (recorded.startedAt !== record.process.startedAt) {
    return { holds: false, why: "process-reused" };
  }
  const shell = table.get(terminal.pid);
  if (shell?.startedAt === undefined) return { holds: false, why: "no-shell" };
  const owner = await findOwningProcess({
    pid: record.process.pid,
    owners: [{ pid: terminal.pid, startedAt: shell.startedAt }],
    processTable: table,
  });
  return owner === undefined
    ? { holds: false, why: "outside-terminal" }
    : { holds: true, shellPid: terminal.pid };
}

export type TypedProcessEnd = "signalled" | "gone" | "not-it" | "unknown";

/** End the PROCESS of a typed run — never its terminal, which is the
 * person's shell. The signal goes to the recorded pid only after the process
 * table has shown that pid to be the process the record names: a pid the
 * system handed on is never signalled. */
export function endTypedProcess(
  recorded: { pid: number; startedAt: string },
  table: ProcessTable | undefined,
  signal: NodeJS.Signals = "SIGTERM",
): TypedProcessEnd {
  if (table === undefined) return "unknown";
  const found = table.get(recorded.pid);
  if (found === undefined) return "gone";
  if (found.startedAt !== recorded.startedAt) return "not-it";
  try {
    process.kill(recorded.pid, signal);
    return "signalled";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? "gone" : "unknown";
  }
}
