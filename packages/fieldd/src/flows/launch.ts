import { dirname, join } from "node:path";
import { FLOWS_HOST_BUNDLE, FLOWS_HOST_ROLE_ARG } from "../roles";
import { type FilesHostFacts, ownFilesHostFacts } from "../workspace/launch";

// CP-4a2a (4A2-Q1 (a)) — how fieldd starts a run's flow host, the transcript worker's rule (transcripts/launch.ts): a
// packaged fieldd runs ITSELF in the `flows-host` role, its bundle sealed beside the executable; a development bundle
// runs `flows-host.cjs` beside `bin.cjs` under the runtime fieldd runs under; a source run has neither and reads
// `unconfigured`, honestly (FLOW_HOST.STATE_UNCONFIGURED). One child per run, started when the run starts, never with
// fieldd. The facts are the files worker's own (`ownFilesHostFacts`).

export { FLOWS_HOST_BUNDLE, FLOWS_HOST_ROLE_ARG };

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
  bundleDir: string | undefined,
): FlowsHostLaunchChoice {
  if (configured !== undefined) return { kind: "launch", launch: configured };
  return chooseFlowsHostLaunch(ownFilesHostFacts(bundleDir));
}

/** The rule above, over facts a test can state. */
export function chooseFlowsHostLaunch(
  facts: Pick<FilesHostFacts, "sea" | "execPath" | "bundleDir" | "exists">,
): FlowsHostLaunchChoice {
  if (facts.sea) {
    const bundle = join(dirname(facts.execPath), FLOWS_HOST_BUNDLE);
    if (!facts.exists(bundle))
      return {
        kind: "unconfigured",
        reason: `the flow host's bundle is not beside the executable (${bundle})`,
      };
    return { kind: "launch", launch: { command: facts.execPath, args: [FLOWS_HOST_ROLE_ARG] } };
  }
  if (facts.bundleDir === undefined)
    return {
      kind: "unconfigured",
      reason: "a source run has no flow host bundle beside it (a test hands the run a launch)",
    };
  const bundle = join(facts.bundleDir, FLOWS_HOST_BUNDLE);
  if (!facts.exists(bundle))
    return {
      kind: "unconfigured",
      reason: `the flow host's bundle is not beside fieldd's bundle (${bundle})`,
    };
  return { kind: "launch", launch: { command: facts.execPath, args: [bundle] } };
}
