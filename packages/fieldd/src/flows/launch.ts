import type { FilesHostFacts } from "../workspace/launch";

// CP-4a2a (4A2-Q1 (a)) — how fieldd starts a run's flow host, the transcript worker's rule (transcripts/launch.ts): a
// packaged fieldd runs ITSELF in the `flows-host` role, its bundle sealed beside the executable; a development bundle
// runs `flows-host.cjs` beside `bin.cjs` under the runtime fieldd runs under; a source run has neither and reads
// `unconfigured`, honestly (FLOW_HOST.STATE_UNCONFIGURED). One child per run, started when the run starts, never with
// fieldd. SKELETON (the red, commit 5): every choice reads `unconfigured` until the role lands.

export interface FlowsHostLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

export type FlowsHostLaunchChoice =
  | { kind: "launch"; launch: FlowsHostLaunch }
  | { kind: "unconfigured"; reason: string };

/** The daemon's word read: a launch is a test's own host, absent is this process's own rule. */
export function flowsHostLaunchSpec(
  configured: FlowsHostLaunch | undefined,
  _bundleDir: string | undefined,
): FlowsHostLaunchChoice {
  if (configured !== undefined) return { kind: "launch", launch: configured };
  return { kind: "unconfigured", reason: "the flow host is not built yet" };
}

/** The rule above, over facts a test can state. */
export function chooseFlowsHostLaunch(
  _facts: Pick<FilesHostFacts, "sea" | "execPath" | "bundleDir" | "exists">,
): FlowsHostLaunchChoice {
  return { kind: "unconfigured", reason: "the flow host is not built yet" };
}
