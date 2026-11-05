import { randomBytes } from "node:crypto";
import type {
  ComposeSparksCrewsFrame,
  CrewId,
  SparkId,
  SparkKeptRecord,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";

// SP-1e2 (step0-sp1e2.md §4.1–§4.3; SPE-Q3 = RU-6, SPE-Q6′ (b), SPE-Q14 (a), SPE-Q28 (b), SPE-Q29 (a), SPE-Q30 (a),
// SPE-Q32 (a)) — a spark's crews: the agents it starts in one stretch of its own run's work, one card in Chat's thread.
// - The talk room mints a crew at a stretch's first `agent_spawn` and every spawn of that stretch joins it; the crew
//   closes at the spark's own run's first idle seen while none of its talk calls is in flight, so a row that reads
//   idle a moment inside a call never splits one turn into two cards. A held spawn keeps its crew in its needs record,
//   and Allow one more joins it, even after it closed. The open crew is in memory: a fieldd restart mid-turn splits
//   that turn's crew in two (a residual, said in the records).
// - Each crew is kept in the spark's kept record (item 159's SparkKeptStore, the `crews` section): its id, the spark's
//   run it was made in, when, and each member: its run, when it started, the catalog's agent id, its folder's name,
//   its model and effort as its board row first named them, and its end and fieldd's name for it then. A member is
//   kept after it ends (SPE-Q14 (a)); a member resumed in Godview follows its new run (`continues`, SPE-Q30 (a)); the
//   newest SPARK_CREWS_KEPT crews are kept (SPE-Q28 (b)). Ids, times and labels: never a task's words, never a path.
// - The crews are this service's alone, so it holds each spark's as last read or written; every write re-reads the
//   record (the store's update), so another slice's section survives. A write the disk refuses is logged and the
//   crews stay as the disk has them: the card then finds a live member by its board row (`origin.crew`).
// - No puppeteer and no rosetta (wall R29): daemon.ts hears the runs and tells this service.

/** The kept store's part the crews read and write (spark-kept.ts answers). */
export interface CrewsStore {
  get(spark: SparkId): SparkKeptRecord | undefined;
  list(): SparkKeptRecord[];
  update(spark: SparkId, fn: (kept: SparkKeptRecord) => SparkKeptRecord): SparkKeptRecord;
}

/** The crew a spawn joins, and the spark's own run it was asked in. */
export interface CrewJoin {
  readonly id: CrewId;
  readonly sparkRun: string;
}

/** A member as its spawn started it. */
export interface CrewStart {
  readonly runtimeRunId: string;
  /** the agent catalog's opaque id (R23) */
  readonly agent: string;
  /** its folder's basename, never a path */
  readonly folder?: string | undefined;
}

/** A crew member's board row, as daemon.ts reads it at each monitor row of a run whose origin names a crew. */
export interface CrewRow extends CrewStart {
  readonly spark: SparkId;
  readonly crew: CrewId;
  /** its model's label and its effort, when the row names them */
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
  /** the provider-native conversation the run continues (the fold's `sessionId`): a resumed member is known by it */
  readonly conversation?: string | undefined;
}

export interface SparkCrewsOptions {
  readonly store: CrewsStore;
  readonly logger?: Logger | undefined;
  readonly now?: () => Date;
  readonly mintId?: () => CrewId;
}

/** A crew's id: fieldd's, minted once, never reused. */
export const mintCrewId = (): CrewId => `cr-${randomBytes(8).toString("hex")}`;

export class SparkCrews {
  readonly #mint: () => CrewId;

  constructor(opts: SparkCrewsOptions) {
    this.#mint = opts.mintId ?? mintCrewId;
  }

  /** A talk call of this spark's begins: its crew stays open until the answer is called (SPE-Q29 (a)). */
  busy(_spark: SparkId): () => void {
    return () => undefined;
  }

  /** The crew this spark's spawn joins: its open crew in its own run `sparkRun`, else a new one (SPE-Q3 = RU-6). */
  join(_spark: SparkId, _sparkRun: string): CrewId {
    return this.#mint();
  }

  /** The spark's own run's row: its first idle seen while none of its talk calls is in flight closes its crew. */
  sparkRow(_spark: SparkId, _runtimeRunId: string, _idle: boolean): void {}

  /** A spawn of `crew` started: the member joins its crew in the kept record, and the crew too at its first start, made
   * in the spark's own run the spawn was asked in (a held start allowed after a restart names its crew's run so). */
  started(_spark: SparkId, _crew: CrewJoin, _start: CrewStart): void {}

  /** A crew member's board row: its model and effort as the row first names them; a member resumed in a new run
   * followed there (SPE-Q30 (a)); a member its spawn started and the record never kept, kept now (R4). */
  seen(_row: CrewRow): void {}

  /** A run ended: a spark's own run closes its open crew; a member is kept, Ended at its time, named as fieldd names
   * the run then (CO-Q4 (b)). */
  ended(_runtimeRunId: string, _name?: string): void {}

  /** Once the re-attach has settled: a member whose run fieldd no longer holds is Ended now. */
  reconcile(_holds: (runtimeRunId: string) => boolean): void {}

  /** The crews' door's frame: the spark's crews, whole, and how many tasks wait for each member on the board. */
  frame(
    spark: SparkId,
    _waiting: (runtimeRunId: string) => number | undefined,
  ): ComposeSparksCrewsFrame {
    return { spark, crews: [], waiting: [] };
  }

  /** Be told each change of a spark's crews, or of a member's row. */
  onChange(_listener: (spark: SparkId) => void): () => void {
    return () => undefined;
  }
}
