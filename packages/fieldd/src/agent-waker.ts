import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { AgentInputQueues } from "./agent-input-queue";

// CP-D4 and CP2-D6 A (`draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31) — the waker reads the monitor rows
// fieldd already hears, so it is the same for every agent. A run a spark started wakes it by itself (its origin names
// the spark); a run it watches wakes it once it asked (agent_watch). A wake says the run's state, never its words
// (CP-L5: "fieldd wakes them with facts, never with another agent's words"): finished, asking you, failed, ended. The
// spark reads the words itself with agent_read. A wake joins the spark's own input queue like any input, and wakes that
// wait there join into one line (AgentInputQueues.wake). A spark with no live session keeps its wakes until one opens.

/** A run's state as the monitor says it, in the four words a wake can carry. */
export type RunState = "working" | "idle" | "asking" | "failed";

/** The monitor row's shape the waker reads (contracts' AgentMonitorMirror). */
export interface MonitorRow {
  readonly status: string;
  readonly blockers: readonly { readonly kind: string }[];
}

export const stateOf = (row: MonitorRow): RunState =>
  row.status === "blocked" || row.blockers.length > 0
    ? row.blockers.some((b) => b.kind === "failure")
      ? "failed"
      : "asking"
    : row.status === "idle"
      ? "idle"
      : "working";

/** The monitor's idle: the turn has ended and nothing waits on the person (CP-L5). */
export const isIdleRow = (row: MonitorRow | undefined): boolean =>
  row !== undefined && row.status === "idle" && row.blockers.length === 0;

export interface WakerOptions {
  readonly queues: AgentInputQueues;
  /** the spark whose agent_spawn started a run, if one did (CP-D15's origin) */
  spawnerOf(runtimeRunId: string): string | undefined;
  /** a spark's own live session, where its wakes land */
  sparkSession(spark: string): string | undefined;
  /** how a run is named in a wake: its title, else its agent */
  label(runtimeRunId: string): string;
  readonly logger?: Logger;
}

export class AgentWaker {
  /** run → the sparks that asked to be woken by it */
  readonly #watchers = new Map<string, Set<string>>();
  readonly #state = new Map<string, RunState>();
  /** spark → wakes held while it has no live session */
  readonly #held = new Map<string, string[]>();
  readonly #logger: Logger;

  constructor(private readonly opts: WakerOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
  }

  watch(spark: string, runtimeRunId: string, on: boolean): void {
    const watchers = this.#watchers.get(runtimeRunId) ?? new Set<string>();
    if (on) watchers.add(spark);
    else watchers.delete(spark);
    if (watchers.size > 0) this.#watchers.set(runtimeRunId, watchers);
    else this.#watchers.delete(runtimeRunId);
  }

  /** A run's monitor row changed: a change of state is a wake for whoever it wakes. */
  onMonitor(runtimeRunId: string, row: MonitorRow | undefined): void {
    if (row === undefined) return;
    const next = stateOf(row);
    const prev = this.#state.get(runtimeRunId);
    this.#state.set(runtimeRunId, next);
    if (prev === undefined || prev === next) return;
    const label = this.opts.label(runtimeRunId);
    const fact =
      next === "idle" && prev === "working"
        ? `${label} finished`
        : next === "asking"
          ? `${label} is asking you`
          : next === "failed"
            ? `${label} failed`
            : undefined;
    if (fact !== undefined) this.#tell(runtimeRunId, fact);
  }

  /** A run ended: its last wake, and it is forgotten. */
  onEnded(runtimeRunId: string): void {
    this.#tell(runtimeRunId, `${this.opts.label(runtimeRunId)} ended`);
    this.#state.delete(runtimeRunId);
    this.#watchers.delete(runtimeRunId);
  }

  /** A send's receipt was uncertain: its sender is told, and never sent it again (CP2-D2). */
  uncertain(spark: string, runtimeRunId: string): void {
    this.#wake(
      spark,
      `your words to ${this.opts.label(runtimeRunId)} are uncertain: no echo came; read the session to see`,
    );
  }

  /** A spark's own session came alive: the wakes held for it land there. */
  onSparkLive(spark: string, runtimeRunId: string): void {
    const held = this.#held.get(spark);
    if (held === undefined) return;
    this.#held.delete(spark);
    for (const fact of held) this.opts.queues.wake(runtimeRunId, fact);
  }

  #tell(runtimeRunId: string, fact: string): void {
    const sparks = new Set(this.#watchers.get(runtimeRunId) ?? []);
    const spawner = this.opts.spawnerOf(runtimeRunId);
    if (spawner !== undefined) sparks.add(spawner);
    for (const spark of sparks) this.#wake(spark, fact);
  }

  #wake(spark: string, fact: string): void {
    const session = this.opts.sparkSession(spark);
    if (session !== undefined) {
      this.opts.queues.wake(session, fact);
      return;
    }
    const held = this.#held.get(spark) ?? [];
    held.push(fact);
    this.#held.set(spark, held);
    this.#logger.info("fieldd.waker.held", "A wake waits for its spark's session", {
      spark,
      held: held.length,
    });
  }
}
