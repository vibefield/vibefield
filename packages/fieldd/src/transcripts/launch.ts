import { TRANSCRIPT_HOST_BUNDLE, TRANSCRIPT_HOST_ROLE_ARG } from "../roles";
import { type FilesHostFacts, ownFilesHostFacts } from "../workspace/launch";

// TH-1 (TH0-Q5 (b)) — how fieldd starts its transcript worker, the files worker's rule (workspace/launch.ts) without
// an engine: a packaged fieldd runs ITSELF in the `transcript-host` role, its bundle sealed beside the executable; a
// development bundle runs `transcript-host.cjs` beside `bin.cjs` under the runtime fieldd runs under; a source run has
// neither and reads `unconfigured`, honestly. The facts are the files worker's own (`ownFilesHostFacts`).

export { TRANSCRIPT_HOST_BUNDLE, TRANSCRIPT_HOST_ROLE_ARG };

export interface TranscriptHostLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

export type TranscriptHostLaunchChoice =
  | { kind: "launch"; launch: TranscriptHostLaunch }
  | { kind: "unconfigured"; reason: string };

export type TranscriptHostLaunchSpec = TranscriptHostLaunchChoice | { kind: "off" };

/** The daemon's word (`FielddConfig.transcriptHost`) read: `false` is OFF (a test-only knob), a launch is a test's own
 * worker, absent is this process's own rule. */
export function transcriptHostLaunchSpec(
  configured: false | TranscriptHostLaunch | undefined,
  bundleDir: string | undefined,
): TranscriptHostLaunchSpec {
  if (configured === false) return { kind: "off" };
  if (configured !== undefined) return { kind: "launch", launch: configured };
  return chooseTranscriptHostLaunch(ownFilesHostFacts(bundleDir));
}

/** The rule above, over facts a test can state. */
// TH-1 (red): a skeleton; the green commit builds it.
export function chooseTranscriptHostLaunch(
  _facts: Pick<FilesHostFacts, "sea" | "execPath" | "bundleDir" | "exists">,
): TranscriptHostLaunchChoice {
  return { kind: "unconfigured", reason: "not built" };
}
