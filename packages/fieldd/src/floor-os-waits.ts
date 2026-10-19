import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// WG-E5 (`draft/thinking-floor-wedge.md` §4; WG-D3, ruled 2026-10-19: Linux
// procfs now, macOS when a measurement shows it is needed) — what the OS says
// the floor waits on. A floor stalled on disk (§3.1's A) has threads in
// uninterruptible wait, or page-ins climbing; a deadlocked one (C) sleeps
// interruptibly, as an idle one does, and pages nothing in. The wedge ladder
// logs the reading on its episode and restart lines, and holds the headless
// restart while it shows a wait: a refinement, never the gate. Where the
// platform says nothing, reply silence and the floor's tick decide alone.

/** One reading of the floor's OS waits. */
export interface FloorOsWaits {
  /** threads in uninterruptible wait (Linux state `D`) */
  readonly uninterruptible: number;
  /** the process's major faults since it started (Linux `majflt`): its page-ins */
  readonly majorFaults: number;
}

/** The fields of a `stat` line after `comm`. `comm` is parenthesised and may
 * hold spaces and parentheses itself, so the count starts after the LAST `)`:
 * index 0 is field 3 (state), index 9 is field 12 (majflt). */
function statFields(text: string): string[] | undefined {
  const close = text.lastIndexOf(")");
  if (close < 0) return undefined;
  const after = text.slice(close + 1);
  return after.trim().split(/\s+/);
}

/** Linux: each thread's state from `/proc/<pid>/task/<tid>/stat`, and the
 * process's page-ins from `/proc/<pid>/stat`. procfs is kernel memory, never
 * disk, so these synchronous reads cannot stall fieldd's loop on the I/O they
 * measure. undefined when the process is gone or its files cannot be read.
 * `procRoot` is a test seam. */
export function readLinuxOsWaits(pid: number, procRoot = "/proc"): FloorOsWaits | undefined {
  try {
    const base = join(procRoot, String(pid));
    const majorFaults = Number(statFields(readFileSync(join(base, "stat"), "utf8"))?.[9]);
    if (!Number.isInteger(majorFaults) || majorFaults < 0) return undefined;
    let uninterruptible = 0;
    for (const tid of readdirSync(join(base, "task"))) {
      let text: string;
      try {
        text = readFileSync(join(base, "task", tid, "stat"), "utf8");
      } catch {
        continue; // a thread that exited between the listing and the read
      }
      if (statFields(text)?.[0] === "D") uninterruptible += 1;
    }
    return { uninterruptible, majorFaults };
  } catch {
    return undefined;
  }
}

/** The reader this platform has, or undefined where it says nothing (macOS
 * and Windows, by WG-D3). */
export function platformOsWaits(): ((pid: number) => FloorOsWaits | undefined) | undefined {
  return process.platform === "linux" ? (pid) => readLinuxOsWaits(pid) : undefined;
}
