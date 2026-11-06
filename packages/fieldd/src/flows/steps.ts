import type { AgentInputSender, AgentModelSelection } from "@vibefield/contracts";

// CP-4a2b (§13a slice 8) — RED skeleton: a flow's steps. Nothing here starts a step yet.

/** What a step's agent is started with: the runtime's spawn, by fieldd's own interface (R32). */
export interface FlowStepLaunch {
  readonly agent: string;
  readonly cwd: string;
  /** "‹flow› · ‹label›", or ‹flow› for a step with no label (D9) */
  readonly title: string;
  readonly profileSet?: string | undefined;
  readonly model?: AgentModelSelection | undefined;
}

/** Who started a step's session, as its record says it (CP-D15): the run and its call (D2's lookup reads it). */
export interface FlowStepOrigin {
  readonly by: "flow";
  readonly run: string;
  readonly call: number;
}

/** fieldd's own interface to a run's steps (R32): the runtime's spawn and each session's input queue. */
export interface FlowStepPorts {
  readonly agents: {
    spawn(launch: FlowStepLaunch, origin: FlowStepOrigin): Promise<{ runtimeRunId: string }>;
  };
  readonly inputs: {
    enqueue(
      runtimeRunId: string,
      text: string,
      from: AgentInputSender,
    ): { id: string; position: number };
  };
}
