import type { AgentSessionOrigin, SparkId } from "@vibefield/contracts";
import type { Agent } from "@vibefield/puppeteer-runtime";

// CP-4a2b (§13a slice 3; Q8, D6) — a run as it ENTERS the agent runtime (agent-runtime.ts's `enter`), heard by every
// listener of `onRunEntered`. Since TH-1 the hook told a spark's own runs alone, to their transcript; a flow's steps
// are heard by the same door (flow-step-events.ts), so every run is told, with who started it (`origin`) and the spark
// it is the own session of (`spark`). The two are different facts (D6): a spark's own session is
// `{origin: {by: "you"}, spark}` (daemon.ts's hatch), and a run a spark STARTED is `{origin: {by: "spark", spark}}`
// with no own spark. A transcript reads `spark` alone, never `origin`.

/** How a run came to be entered: a birth begins a conversation; a resume continues one; a re-attach is the same run
 * again after fieldd restarted; an adoption is a run typed in a pane. */
export type RunBegun = "spawn" | "resume" | "reattach" | "adopt";

/** What a listener hears a run by: puppeteer's Agent, its one `.on(...)` surface and its monitor. */
export type RunEnteredAgent = Pick<Agent, "on" | "monitor">;

/** A run that entered: its agent, its id, how it began, and its record's compose facts, when it has them. */
export interface RunEntered {
  readonly agent: RunEnteredAgent;
  readonly runtimeRunId: string;
  readonly begun: RunBegun;
  /** who started the run, as its record says (CP-D15); absent reads `you` */
  readonly origin?: AgentSessionOrigin;
  /** the spark this run is the OWN session of (CP-1c); never the spark that started it, which is `origin.spark` */
  readonly spark?: SparkId;
}

/** An event the run's own conversation made, live: never a subagent's (a non-root actor), never one reconstructed
 * from history (a replay). */
export const ownLive = (envelope: {
  readonly agentId?: string;
  readonly replay?: boolean;
}): boolean => envelope.agentId === undefined && envelope.replay !== true;
