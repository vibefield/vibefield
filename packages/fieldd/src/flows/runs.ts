import type {
  FlowInput,
  FlowStarter,
  FlowsListResult,
  NeedsItemId,
  RunSummary,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { HoldSender } from "../tool-plane/rooms/talk/verbs";
import type { FlowChangedRaise } from "../tool-plane/rooms/you/queue";
import type { FlowLibrary } from "./library";
import type { FlowRecords } from "./records";
import type { FlowHostOptions } from "./supervisor";

// CP-4a2b (§13a slice 7) — RED skeleton: the runs. Nothing here starts, lists or reads a run yet.

/** fieldd's own interface to the runs (R32): what daemon.ts builds them from. Slice 7's part. */
export interface FlowRunPorts {
  /** the person's library: a run's flow is read here against its approval */
  readonly library: Pick<FlowLibrary, "read">;
  /** fieldd's flow records: approvals, kept bytes, each run's journal and record */
  readonly records: FlowRecords;
  /** the needs queue's changed-flow item (N5) */
  readonly needs: { flowChanged(raise: FlowChangedRaise): NeedsItemId };
  /** the Agent Profiles that exist now, by id: a run's frozen scope narrows to them (D8) */
  profiles(): readonly string[];
  /** how a run's host is started */
  readonly host: Pick<FlowHostOptions, "launch" | "environment" | "timings" | "heapMb" | "rssMb">;
  readonly logger?: Logger | undefined;
  readonly now?: (() => Date) | undefined;
}

/** A run's start, as a door asks for it. */
export interface FlowRunStartParams {
  readonly flow: string;
  readonly input: FlowInput;
  readonly starter: FlowStarter;
  /** the Agent Profiles the run may use, as the door chose them (CP4-Q20 (a)): frozen at start (D8) */
  readonly scope: readonly string[];
  /** a spark's flow_run: the spark and its session, who a changed flow's item tells (N5) and a spark's bound names */
  readonly from?: HoldSender | undefined;
}

/** A start's answer: the run it started, or the changed-flow item it waits in, having started nothing (CP4-Q5 (a)). */
export type FlowRunStarted = { readonly run: RunSummary } | { readonly waits: NeedsItemId };

/** The runs a list carries (FlowsListResult's `runs` and `earlier`, `flowsListOf`): the doors add the library. */
export type FlowRunsList = Pick<FlowsListResult, "runs" | "earlier">;

/** A run as the doors read it: its summary, who started it (CL-E7-12's check), and its scope as it stands now. */
export interface FlowRunView {
  readonly summary: RunSummary;
  readonly starter: FlowStarter;
  readonly scope: readonly string[];
}

export class FlowRuns {
  constructor(readonly ports: FlowRunPorts) {}

  /** RED skeleton. */
  async start(_params: FlowRunStartParams): Promise<FlowRunStarted> {
    throw new Error("CP-4a2b slice 7: the runs are not built");
  }

  /** RED skeleton. */
  list(): FlowRunsList {
    return { runs: [] };
  }

  /** RED skeleton. */
  onChange(_fn: (list: FlowRunsList) => void): () => void {
    return () => {};
  }

  /** RED skeleton. */
  read(_run: string): FlowRunView | undefined {
    return undefined;
  }

  /** RED skeleton. */
  async close(): Promise<void> {}
}
