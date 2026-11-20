// Item 550 (2026-11-18) — which spark THIS fieldd started a run for, so the run's mark on the desk can wear that
// spark's printed star. It is fieldd's own memory of its own spawn (the talk room's, `talkSpawn` in daemon.ts), never a
// record: a record an agent can rewrite must not put a spark's star on its run. It is not custody's launch memory
// (`bornFor`): nothing is granted by it and the floor is never told it, so a fieldd that restarts has forgotten it, and
// a run it started before then shows no star. Bounded as launch memory is, oldest out.

/** As many runs as launch memory remembers (agent-runtime.ts's BORN_MAX). */
export const SPARK_STARTS_MAX = 16_384;

export class SparkStarts {
  readonly #by = new Map<string, string>();

  constructor(private readonly max = SPARK_STARTS_MAX) {}

  /** fieldd started `run` for `spark`. */
  started(run: string, spark: string): void {
    this.#by.delete(run);
    this.#by.set(run, spark);
    for (const oldest of this.#by.keys()) {
      if (this.#by.size <= this.max) break;
      this.#by.delete(oldest);
    }
  }

  /** A resume continued `old` in `next`: the spark that started the one started the other. */
  replaced(old: string, next: string): void {
    const spark = this.#by.get(old);
    if (spark !== undefined) this.started(next, spark);
  }

  /** The spark this fieldd started `run` for, or undefined. */
  of(run: string): string | undefined {
    return this.#by.get(run);
  }
}
