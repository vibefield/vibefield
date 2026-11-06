import type { AgentSessionRecord, AgentSpawnedBy, TerminalInfo } from "@vibefield/contracts";
import {
  findOwningProcess,
  type ProcessRecord,
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
//    agent ends and nothing of the terminal is ever ended for it — its END is
//    its process's (`endTypedRun`, item 191), never the shell's;
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
 * vanished pid cannot: whether the shell itself ended, and how). */
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

/** How long a typed run's process is given to end on SIGTERM before what is
 * left of it is killed: the floor's own grace for the same step (ghosttea
 * =0.14.0, `session.rs:964`, `TERMINATE_GRACE`, 2 s), so a typed run is given
 * what a run in its own PTY is given. */
export const TYPED_END = { termGraceMs: 2_000 } as const;

export interface TypedEndDeps {
  /** the pid of the shell the run was typed in, as the floor lists it (B1) */
  shellPid: number | undefined;
  /** one read of the process table; undefined = it could not be read */
  readTable: () => Promise<ProcessTable | undefined>;
  /** test seam: the signal sent (default `process.kill`) */
  kill?: ((pid: number, signal: NodeJS.Signals) => void) | undefined;
  /** the pid watch (default `watchTypedProcess`, the watch the run's own
   * end is heard by) */
  watch?: typeof watchTypedProcess | undefined;
}

/** END A TYPED RUN (item 191; AR-7 §5.3) — its PROCESS, never its terminal,
 * which is the person's shell and outlives it (R1). The one ladder, every
 * signal on a pid proved by its start:
 *
 *  1. B1 — the shell is never the agent: the shell's own pid is refused
 *     before anything is read;
 *  2. one read of the process table proves the recorded pid IS the process
 *     the record names (a pid is handed on, a start time is not);
 *  3. SIGTERM to it, and then whichever comes FIRST: its pid watch hearing it
 *     end (an agent that obeys answers at once, and nothing more is done), or
 *     the grace;
 *  4. at the grace, a second read: if the same process still runs, SIGKILL to
 *     it and to its descendants in that read, each proved a child by its own
 *     start — the walk only ever descends from the agent, so the shell, an
 *     ancestor, is never in it, and nor is any other job of the person's. A
 *     second read that fails kills nothing and places nothing.
 *
 * `signalled`: the end was placed (the run's own watch closes it). `gone`:
 * there was nothing to end. `not-it`: what the pid holds now is not the run's
 * process. `unknown`: the end was NOT placed — the table could not be read
 * (before the SIGTERM, or at the grace after it, when the process may still
 * run), or the signal was refused. */
export async function endTypedRun(
  recorded: { pid: number; startedAt: string },
  deps: TypedEndDeps,
): Promise<TypedProcessEnd> {
  if (recorded.pid === deps.shellPid) return "not-it";
  const table = await deps.readTable();
  if (table === undefined) return "unknown";
  const found = table.get(recorded.pid);
  if (found === undefined) return "gone";
  if (found.startedAt !== recorded.startedAt) return "not-it";
  const kill = deps.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
  try {
    kill(recorded.pid, "SIGTERM");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? "gone" : "unknown";
  }
  const heard = await endedWithin(
    recorded.pid,
    deps.watch ?? watchTypedProcess,
    TYPED_END.termGraceMs,
  );
  if (heard) return "signalled";
  const again = await deps.readTable();
  // nothing says whether it still runs (a TUI that traps SIGTERM would): no end is placed
  if (again === undefined) return "unknown";
  // the pid gone or handed on: the run's process ended, and its watch closes the run
  if (again.get(recorded.pid)?.startedAt !== recorded.startedAt) return "signalled";
  for (const pid of [recorded.pid, ...descendantsOf(again, recorded.pid, deps.shellPid)]) {
    try {
      kill(pid, "SIGKILL");
    } catch {
      // gone meanwhile (ESRCH), or not ours to signal (EPERM): nothing of it to end
    }
  }
  return "signalled";
}

/** Whether the pid watch hears the process end before the grace is over. The
 * first to answer stops the other; no timer of it holds fieldd's own exit. */
function endedWithin(
  pid: number,
  watch: typeof watchTypedProcess,
  graceMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const stops: Array<() => void> = [];
    let settled = false;
    const settle = (heard: boolean): void => {
      if (settled) return;
      settled = true;
      for (const stop of stops) stop();
      resolve(heard);
    };
    const grace = setTimeout(() => settle(false), graceMs);
    grace.unref?.();
    stops.push(() => clearTimeout(grace));
    const unwatch = watch(pid, () => settle(true));
    // a watch that answered while it was being set up has settled already
    if (settled) unwatch();
    else stops.push(unwatch);
  });
}

/** The descendants of `root` in one read of the table, breadth first: each
 * one's parent is `root` or a descendant already found, and its start is known
 * and no earlier than its parent's — no child starts before the process that
 * forked it, so a row that says otherwise proves nothing. The shell's pid is
 * never among them (B1). */
function descendantsOf(table: ProcessTable, root: number, shellPid: number | undefined): number[] {
  const children = new Map<number, ProcessRecord[]>();
  for (const row of table.values()) {
    const siblings = children.get(row.parentPid);
    if (siblings === undefined) children.set(row.parentPid, [row]);
    else siblings.push(row);
  }
  const found: number[] = [];
  const seen = new Set<number>([root]);
  const queue: ProcessRecord[] = [];
  const rootRow = table.get(root);
  if (rootRow !== undefined) queue.push(rootRow);
  for (let parent = queue.shift(); parent !== undefined; parent = queue.shift()) {
    const parentStart = startOf(parent);
    if (parentStart === undefined) continue;
    for (const child of children.get(parent.pid) ?? []) {
      if (seen.has(child.pid) || child.pid === shellPid) continue;
      const start = startOf(child);
      if (start === undefined || start < parentStart) continue;
      seen.add(child.pid);
      found.push(child.pid);
      queue.push(child);
    }
  }
  return found;
}

/** A process's start, as milliseconds; undefined when `ps` gave none it could read. */
function startOf(row: ProcessRecord): number | undefined {
  if (row.startedAt === undefined) return undefined;
  const at = Date.parse(row.startedAt);
  return Number.isNaN(at) ? undefined : at;
}
