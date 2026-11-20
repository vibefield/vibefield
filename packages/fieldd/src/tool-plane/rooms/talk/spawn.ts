import type { AgentModelSelection, AgentSessionOrigin } from "@vibefield/contracts";
import { folderNameOf } from "../../../agent-field";
import type { SparkStarts } from "../../../objects/spark-starts";
import type { SparkCrews } from "../../crews";
import type { TalkDeps } from "./verbs";

// The one spawn a spark's agents start by: the talk room's, and the needs-you queue's Allow one more (daemon.ts binds
// it to the runtime). The crew it joins rides its origin (the card's rows find it there) and the crew's kept record
// takes the member (SP-1e2). Out of daemon.ts since item 550 (2026-11-18), so a row can hold what it does.
// Item 550: it remembers the spark it started each run for (`starts`), the printed star on the run's mark on the desk,
// which nothing else ever says.

/** What a spark's spawn asks of the runtime. A type, not an interface: the runtime's spawn takes the contract's
 * passthrough shape, which only a type's implicit index signature satisfies. */
export type SparkSpawnLaunch = {
  readonly provider: string;
  readonly cwd: string;
  readonly profileSet: string;
  readonly modelSelection?: AgentModelSelection;
};

export interface SparkSpawnDeps {
  /** the runtime's spawn, under the spark's own door principal, with the origin its record carries (daemon.ts) */
  spawn(
    launch: SparkSpawnLaunch,
    origin: AgentSessionOrigin,
  ): Promise<{ readonly runtimeRunId: string }>;
  /** item 550, 2026-11-18 — which spark this fieldd started each run for */
  readonly starts: SparkStarts;
  readonly crews: Pick<SparkCrews, "started">;
}

export function sparkSpawn(deps: SparkSpawnDeps): TalkDeps["spawn"] {
  return async (launch, spark, crew) => {
    const { runtimeRunId } = await deps.spawn(
      {
        provider: launch.agent,
        cwd: launch.cwd,
        profileSet: launch.profileSet,
        ...(launch.model !== undefined ? { modelSelection: launch.model } : {}),
      },
      { by: "spark", spark, ...(crew !== undefined ? { crew: crew.id } : {}) },
    );
    deps.starts.started(runtimeRunId, spark);
    if (crew !== undefined) {
      const folder = folderNameOf(launch.cwd);
      deps.crews.started(spark, crew, {
        runtimeRunId,
        agent: launch.agent,
        ...(folder !== undefined ? { folder } : {}),
      });
    }
    return { runtimeRunId };
  };
}
