import type { FlowHostEnding } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { FlowsHostLaunchChoice } from "./launch";

// CP-4a2a (CP-D8, CP-D9; 4A2-Q1 (a), 4A2-Q5 (a), 4A2-Q6 (b), 4A2-Q7 (a), ruled by VF-PM 2026-11-05 08:51Z) — ONE
// run's flow host: fieldd starts a child for the run (launch.ts), hands it the approved bytes rewritten into one script
// (module-script.ts), answers each call the script makes through a FlowCallHandler, pings it, and ends it. The child's
// environment is PATH alone. A run's calls reach the world only through the handler: in CP-4a2a a scripted one in the
// tests, behind the journal's replay (replay.ts); the runs (CP-4a2b) implement it.
//
// SKELETON (the red, commit 5): nothing is started; every run ends at once as a host that left.

/** A call the script made, as the host sent it: what it is (FLOW_CALL_WHATS, OPEN) and its arguments. */
export interface FlowHostCall {
  readonly what: string;
  readonly args: readonly unknown[];
}

/** A call's answer: the script's `await` resolves with `value`, or throws with `refused`'s words. */
export type FlowHostAnswer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly refused: string };

/** What answers a run's calls and hears its log lines. */
export interface FlowCallHandler {
  call(call: FlowHostCall): Promise<FlowHostAnswer>;
  log(text: string): void;
}

/** How a run's host ended:
 * - `done`: the default export returned (`value`, or `cut` when it was past FLOW_LIMITS.RESULT_MAX_BYTES);
 * - `threw`: it threw, or the script would not evaluate (SES's own refusals among them);
 * - `ended`: fieldd ended the host, for FLOW_HOST_ENDINGS' reason;
 * - `stopped`: fieldd stopped it when asked (`stop()`: the run's Stop, fieldd's own stop);
 * - `left`: the child left on its own (its pipe closed under it, killed alone);
 * - `fatal`: the host could not run a script (it would not start, never said READY, or said why);
 * - `refused`: no host was started for these bytes (too big, or not a flow fieldd can rewrite);
 * - `unconfigured`: this copy of VibeField cannot start a host (FLOW_HOST.STATE_UNCONFIGURED). */
export type FlowHostEnd =
  | { readonly kind: "done"; readonly value?: unknown; readonly cut?: true }
  | { readonly kind: "threw"; readonly message: string }
  | { readonly kind: "ended"; readonly why: FlowHostEnding }
  | { readonly kind: "stopped" }
  | { readonly kind: "left"; readonly code: number | null; readonly signal: string | null }
  | { readonly kind: "fatal"; readonly reason: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unconfigured"; readonly reason: string };

/** The host's clock, FLOW_LIMITS' by default; tests shorten it. `stopGraceMs`: how long a `shutdown` is given before
 * SIGKILL. */
export interface FlowHostTimings {
  readonly readyMs: number;
  readonly pingMs: number;
  readonly pingMisses: number;
  readonly stopGraceMs: number;
}

export interface FlowHostOptions {
  readonly launch: FlowsHostLaunchChoice;
  /** the approved bytes (the version the run runs, CP-D10) */
  readonly bytes: Uint8Array;
  readonly input: Readonly<Record<string, string>>;
  readonly handler: FlowCallHandler;
  readonly timings?: Partial<FlowHostTimings>;
  /** the environment the child's PATH is read from; fieldd's own by default */
  readonly environment?: NodeJS.ProcessEnv;
  readonly logger?: Logger;
}

export interface FlowHostRun {
  /** the child's pid once it said READY; undefined when no host started or it never did */
  readonly ready: Promise<number | undefined>;
  readonly ended: Promise<FlowHostEnd>;
  /** end the host: `shutdown`, then SIGKILL past the grace; answered with how it ended */
  stop(): Promise<FlowHostEnd>;
}

/** Start a run's host. */
export function startFlowHost(_opts: FlowHostOptions): FlowHostRun {
  const ended: Promise<FlowHostEnd> = Promise.resolve({ kind: "left", code: null, signal: null });
  return { ready: Promise.resolve(undefined), ended, stop: () => ended };
}
