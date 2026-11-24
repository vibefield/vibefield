// VT-2c (track VT, 2026-11-24) — the pids of children fieldd started itself and that have not exited yet, kept from
// the moment of the spawn to the child's own `exit`. The vitals recorder reads it at every sample to name them
// (`vitals-sources.ts`), so it answers from memory: a set, read, and never a process inspection (VT-D4).

/** The slice of a spawned child the census needs. `node:child_process`'s `ChildProcess` is one. */
export interface CensusChild {
  readonly pid?: number | undefined;
  once(event: "exit", listener: () => void): unknown;
}

export class ChildPidCensus {
  readonly #live = new Set<number>();

  /** Count a child from its spawn until it exits. A child that never got a pid (its spawn failed) is not counted. */
  note(child: CensusChild): void {
    const pid = child.pid;
    if (typeof pid !== "number" || pid <= 0) return;
    this.#live.add(pid);
    child.once("exit", () => {
      this.#live.delete(pid);
    });
  }

  /** The living children, oldest spawn first. */
  pids(): number[] {
    return [...this.#live];
  }
}
