import type { AgentSessionOrigin } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { AgentInputQueues } from "./agent-input-queue";

// CP-D4 and CP2-D6 A (`draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31) — the waker reads the monitor rows
// fieldd already hears, so it is the same for every agent. A run a spark started wakes it by itself (its origin names
// the spark); a run it watches wakes it once it asked (agent_watch). A wake says the run's state, never its words
// (CP-L5: "fieldd wakes them with facts, never with another agent's words"): finished, asking you, failed, ended. The
// spark reads the words itself with agent_read. A wake joins the spark's own input queue like any input, and wakes that
// wait there join into one line (AgentInputQueues.wake). A spark with no live session keeps its wakes until one opens.
// SP-1e4 (S4, 2026-11-19) — a turn the person's Pause ended is said as paused by the user, never as finished.

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

/** CP-4a2b slice 11 (Q11, R35b; D6) — the spark a run's origin says started it (CP-D15): a spark's own `agent_spawn`
 * (`by: "spark"`) alone. A flow's step is the flow's (`by: "flow"`), though its origin names the spark whose run made
 * it (E5), and a spark's own session is yours (`by: "you"`), its spark beside the origin, never in it. So a step's
 * state change never wakes a spark as its spawner; a spark that watches the step is woken as any watcher (T5). Its
 * expression is daemon.ts's spawnerOf's, verbatim: daemon.ts reads it from slice 15, and its own lambda goes then. */
export const sparkOfOrigin = (origin: AgentSessionOrigin | undefined): string | undefined =>
  origin?.by === "spark" ? origin.spark : undefined;

export interface WakerOptions {
  readonly queues: AgentInputQueues;
  /** the spark whose agent_spawn started a run, if one did (CP-D15's origin) */
  spawnerOf(runtimeRunId: string): string | undefined;
  /** a spark's own live session, where its wakes land */
  sparkSession(spark: string): string | undefined;
  /** how a run is named in a wake: its title, else its agent in its folder, else its agent (daemon's runLabel) */
  label(runtimeRunId: string): string;
  /** SP-1e4 (S4) — the run's current turn was ended by the person's Pause (the runtime's own record, never a mark a
   * door sets): its idle is told as paused by the user. Absent: no turn is told paused. */
  pausedTurn?(runtimeRunId: string): boolean;
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
        ? this.opts.pausedTurn?.(runtimeRunId) === true
          ? `${label} was paused by the user`
          : `${label} finished`
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

  /** A send a fieldd restart broke into while it was being sent (item 158, TH-Q32 (a)): its sender is told, and it is
   * never sent again (DESIGN.md §9). Said once the run is known, so it is named by its label, never its id. */
  restarted(spark: string, runtimeRunId: string): void {
    this.#wake(
      spark,
      `VibeField restarted while your words to ${this.opts.label(runtimeRunId)} were being sent, and cannot tell whether they arrived (read the session to see); they will not be sent again`,
    );
  }

  /** CP-4a2b slice 11 (Q9, Q10) — a fact a flow run tells the spark that started it, worded by the runs
   * (flows/words.ts): no watcher, no spawner and no item; it lands in the spark's live session, or is held until one
   * opens (`onSparkLive`). The runs' `waker` port: a wake as any, and the runs check `sparkOf` before it, so a spark
   * that is gone holds none here. */
  flowFact(spark: string, fact: string): void {
    this.#wake(spark, fact);
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
