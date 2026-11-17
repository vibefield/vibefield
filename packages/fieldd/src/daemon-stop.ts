import type { Logger } from "@vibefield/logging";

// Item 486 — fieldd's stop, by its steps (design-02's Shutdown order: stop accepting product calls, withdraw
// providers, flush audits and docs, detach NativeLink, remove the run files, exit). Each step has a name from this
// closed list, and a record or a log line names a step by it, never by an error's words (an error's message can carry
// a path). Each step runs in its own try: a step that fails is logged by its name and the next one runs, so one failed
// step no longer skips the rest of the teardown; the stop rejects at its END, with the first failure.

/** Every step of the daemon's stop, in the order it runs. */
export const STOP_STEPS = [
  "shell-absence",
  "shell-lease",
  "product-record",
  "supervisor",
  "plugin-updates",
  "plugin-services",
  "runtime-diagnostics",
  "processes",
  "agent-usage",
  "gateway",
  "last-run",
  "monitor",
  "agents",
  "index-tail",
  "index",
  "index-catalog",
  "index-apps",
  "rosettad",
  "place-scanner",
  "project-records",
  "project-groups",
  "acted",
  "workspace",
  "transcript-host",
  "health-sources",
  "endpoints",
  "mcp",
  "settings-doc",
  "doc-holders",
  "system-doc-routes",
  "system-docs",
  "api",
  "doc-lane",
  "presence-rooms",
  "tool-plane",
  "needs-queue",
  "doc-sync",
  "lane-link",
  "docs",
  "artifacts",
  "made-apps",
  "board",
  "index-mesh",
  "apps-mesh",
  "federated-subs",
  "peers",
  "index-serve",
  "transcript-serve",
  "freeway-serve",
  "freeway-floor",
  "egress-rewriter",
  "index-forwarding",
  "egress-routes",
  "terminal-serve",
  "devices",
  "terminals",
  "services",
  "settings",
  "plugins",
  "diagnostics",
  "native-detach",
  "native-close",
  "artifacts-drain",
  "made-apps-drain",
  "token-file",
  "product-file",
  "last-exit",
  "audit",
] as const;
export type StopStep = (typeof STOP_STEPS)[number];

/** A step of the stop that failed: its name, and the error it threw (logged, never written to a record). */
export interface StopFailure {
  readonly step: StopStep;
  readonly error: unknown;
}

/** Runs each step in order, each in its own try. A failure is logged by the step's name and collected, and the next
 * step runs. `faultAt` (FielddConfig's `stopFaultAt`, a test seam) throws at that step before its body runs. */
export async function runStopSteps(
  steps: ReadonlyArray<readonly [StopStep, () => unknown]>,
  logger: Logger,
  faultAt?: StopStep,
): Promise<StopFailure[]> {
  const failures: StopFailure[] = [];
  for (const [step, body] of steps) {
    try {
      if (step === faultAt) throw new Error(`stop fault at ${step}`);
      await body();
    } catch (error) {
      failures.push({ step, error });
      logger.error(
        "fieldd.lifecycle.stop_step_failed",
        "A step of fieldd's stop failed; the stop goes on",
        error,
        { step },
      );
    }
  }
  return failures;
}

/** The stop's one rejection: the first failed step, naming the rest; the first failure is its cause. */
export function stopFailure(failures: readonly StopFailure[]): Error {
  const [first, ...rest] = failures;
  if (first === undefined) return new Error("fieldd's stop did not finish");
  const also = rest.length === 0 ? "" : `; also ${rest.map((f) => f.step).join(", ")}`;
  return new Error(`fieldd's stop did not finish: ${first.step} failed${also}`, {
    cause: first.error,
  });
}

/** bin.ts's stop on a signal or a shutdown request: the daemon stops, then the process exits, 0 when the stop
 * finished and 1 when it did not, so whatever started the process can learn of it. */
export function exitAfterStop(
  stop: () => Promise<void>,
  exit: (code: number) => void,
): Promise<void> {
  return stop().then(
    () => exit(0),
    () => exit(1),
  );
}
