import { randomBytes } from "node:crypto";
import {
  type AgentMonitorMirror,
  type ComposeSparksCrewsFrame,
  type CrewId,
  SPARK_CREW_MEMBERS_MAX,
  SPARK_CREWS_KEPT,
  type SparkCrew,
  type SparkCrewMember,
  type SparkCrewWaiting,
  type SparkId,
  type SparkKeptRecord,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";

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
  /** SP-1e2's renderer half (SR-Q1 (a); item 180) — write a crew's act line into the spark's run the crew was made in:
   * daemon.ts hands the transcript recorder's act. Called after each kept change whose words differ from the last line
   * written for that crew (a start, a join, a model first named), never at an end. Absent: no line is written. */
  readonly act?:
    | ((spark: SparkId, sparkRun: string, crew: CrewId, text: string) => void)
    | undefined;
}

/** A crew's id: fieldd's, minted once, never reused. */
export const mintCrewId = (): CrewId => `cr-${randomBytes(8).toString("hex")}`;

/** A member's model and effort as its monitor row names them: the model's display name (else its id), and the effort's
 * value, which rides the mirror's passthrough and is read tolerantly (as agent-field's projectFieldRow reads it); each
 * cut to the contract's bound. */
export function crewFactsOf(
  mirror: AgentMonitorMirror | undefined,
): Pick<CrewRow, "model" | "effort"> {
  const model = mirror?.model?.displayName ?? mirror?.model?.id;
  const raw = (mirror as Record<string, unknown> | undefined)?.["effort"];
  const effort =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["value"] : undefined;
  return {
    ...(model !== undefined && model !== "" ? { model: model.slice(0, 128) } : {}),
    ...(typeof effort === "string" && effort !== "" ? { effort: effort.slice(0, 32) } : {}),
  };
}

/** SP-1e2's renderer half — a crew's act line in VibeField's words (DESIGN.md §9, the crew card): "Started 4 agents ·
 * Opus 5.5 · high", "Started 1 agent · …", the model alone when no member names an effort, and the count alone when
 * the members differ or a model is not named yet (`crewSharedModelOf`, the rule Chat's card head reads too).
 * (red: a skeleton) */
export function crewActText(_members: readonly SparkCrewMember[]): string {
  return "";
}

/** The newest SPARK_CREWS_KEPT crews, oldest first. */
const newest = (crews: readonly SparkCrew[]): SparkCrew[] =>
  crews.length > SPARK_CREWS_KEPT ? crews.slice(-SPARK_CREWS_KEPT) : [...crews];

const memberOf = (start: CrewStart, at: string): SparkCrewMember => ({
  runtimeRunId: start.runtimeRunId,
  at,
  agent: start.agent,
  ...(start.folder !== undefined ? { folder: start.folder } : {}),
});

/** `crews` with one crew's members replaced. */
const withMembers = (
  crews: readonly SparkCrew[],
  id: CrewId,
  members: SparkCrewMember[],
): SparkCrew[] => crews.map((crew) => (crew.id === id ? { ...crew, members } : crew));

export class SparkCrews {
  readonly #store: CrewsStore;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #mint: () => CrewId;
  /** each spark's open crew: the stretch of its own run's work that its spawns join now */
  readonly #open = new Map<SparkId, { readonly id: CrewId; readonly sparkRun: string }>();
  /** the spark's run each crew minted this lifetime was made in: a member's row seen before its start makes the crew */
  readonly #made = new Map<CrewId, string>();
  /** how many of each spark's talk calls are in flight */
  readonly #busy = new Map<SparkId, number>();
  /** each kept member's run, to its spark */
  readonly #members = new Map<string, SparkId>();
  /** the conversation each member's run continued, as its rows said this lifetime */
  readonly #conversations = new Map<string, string>();
  /** each spark's crews, as last read or written */
  readonly #crews = new Map<SparkId, readonly SparkCrew[]>();
  readonly #listeners = new Set<(spark: SparkId) => void>();

  constructor(opts: SparkCrewsOptions) {
    this.#store = opts.store;
    this.#logger = opts.logger ?? createNoopLogger();
    this.#now = opts.now ?? (() => new Date());
    this.#mint = opts.mintId ?? mintCrewId;
  }

  /** A talk call of this spark's begins: its crew stays open until the answer is called (SPE-Q29 (a)). */
  busy(spark: SparkId): () => void {
    this.#busy.set(spark, (this.#busy.get(spark) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const left = (this.#busy.get(spark) ?? 1) - 1;
      if (left > 0) this.#busy.set(spark, left);
      else this.#busy.delete(spark);
    };
  }

  /** The crew this spark's spawn joins: its open crew in its own run `sparkRun`, else a new one (SPE-Q3 = RU-6). */
  join(spark: SparkId, sparkRun: string): CrewId {
    const open = this.#open.get(spark);
    if (open !== undefined && open.sparkRun === sparkRun) return open.id;
    const id = this.#mint();
    this.#open.set(spark, { id, sparkRun });
    this.#made.set(id, sparkRun);
    return id;
  }

  /** The spark's own run's row: its first idle seen while none of its talk calls is in flight closes its crew. */
  sparkRow(spark: SparkId, runtimeRunId: string, idle: boolean): void {
    const open = this.#open.get(spark);
    if (open === undefined || open.sparkRun !== runtimeRunId || !idle) return;
    if ((this.#busy.get(spark) ?? 0) > 0) return;
    this.#open.delete(spark);
  }

  /** A spawn of `crew` started: the member joins its crew in the kept record, and the crew too at its first start, made
   * in the spark's own run the spawn was asked in (a held start allowed after a restart names its crew's run so). */
  started(spark: SparkId, crew: CrewJoin, start: CrewStart): void {
    const at = this.#now().toISOString();
    this.#keep(spark, (crews) => {
      const kept = crews.find((c) => c.id === crew.id);
      if (kept === undefined)
        return newest([
          ...crews,
          { id: crew.id, sparkRun: crew.sparkRun, at, members: [memberOf(start, at)] },
        ]);
      if (kept.members.some((m) => m.runtimeRunId === start.runtimeRunId)) return undefined;
      if (kept.members.length >= SPARK_CREW_MEMBERS_MAX) return this.#full(spark, crew.id);
      return withMembers(crews, crew.id, [...kept.members, memberOf(start, at)]);
    });
  }

  /** A crew member's board row: its model and effort as the row first names them; a member resumed in a new run
   * followed there (SPE-Q30 (a)); a member its spawn started and the record never kept, kept now (R4). Each row is a
   * change for the crews' door, whose `waiting` is read live. */
  seen(row: CrewRow): void {
    if (row.conversation !== undefined) this.#conversations.set(row.runtimeRunId, row.conversation);
    const at = this.#now().toISOString();
    const kept = this.#keep(row.spark, (crews) => {
      const crew = crews.find((c) => c.id === row.crew);
      if (crew === undefined) {
        const made = this.#made.get(row.crew);
        if (made === undefined) return undefined;
        const member = { ...memberOf(row, at), ...this.#facts(undefined, row) };
        return newest([...crews, { id: row.crew, sparkRun: made, at, members: [member] }]);
      }
      const known = crew.members.find((m) => m.runtimeRunId === row.runtimeRunId);
      if (known !== undefined) {
        const facts = this.#facts(known, row);
        if (facts.model === known.model && facts.effort === known.effort) return undefined;
        return withMembers(
          crews,
          crew.id,
          crew.members.map((m) => (m === known ? { ...m, ...facts } : m)),
        );
      }
      const resumed =
        row.conversation === undefined
          ? undefined
          : crew.members.find(
              (m) =>
                m.runtimeRunId !== row.runtimeRunId &&
                this.#conversations.get(m.runtimeRunId) === row.conversation,
            );
      if (resumed !== undefined) {
        const { endedAt: _ended, name: _name, ...rest } = resumed;
        const follows = {
          ...rest,
          ...this.#facts(resumed, row),
          runtimeRunId: row.runtimeRunId,
          continues: resumed.runtimeRunId,
        };
        return withMembers(
          crews,
          crew.id,
          crew.members.map((m) => (m === resumed ? follows : m)),
        );
      }
      if (crew.members.length >= SPARK_CREW_MEMBERS_MAX) return this.#full(row.spark, crew.id);
      return withMembers(crews, crew.id, [
        ...crew.members,
        { ...memberOf(row, at), ...this.#facts(undefined, row) },
      ]);
    });
    if (!kept) this.#emit(row.spark);
  }

  /** A run ended: a spark's own run closes its open crew; a member is kept, Ended at its time, named as fieldd names
   * the run then (CO-Q4 (b)). */
  ended(runtimeRunId: string, name?: string): void {
    for (const [spark, open] of this.#open)
      if (open.sparkRun === runtimeRunId) this.#open.delete(spark);
    const spark = this.#members.get(runtimeRunId);
    if (spark === undefined) return;
    const at = this.#now().toISOString();
    this.#keep(spark, (crews) => this.#end(crews, (run) => run === runtimeRunId, at, name));
  }

  /** Once the re-attach has settled: every kept crew is read, and a member whose run fieldd no longer holds (it ended
   * while fieldd was down, or did not come back) is Ended now. */
  reconcile(holds: (runtimeRunId: string) => boolean): void {
    const at = this.#now().toISOString();
    let records: SparkKeptRecord[];
    try {
      records = this.#store.list();
    } catch (err) {
      this.#logger.warn("fieldd.crews.reconcile_failed", "The kept crews could not be read", {
        reason: (err as Error).message,
      });
      return;
    }
    for (const record of records) {
      this.#remember(record.spark, record.crews ?? []);
      this.#keep(record.spark, (crews) => this.#end(crews, (run) => !holds(run), at));
    }
  }

  /** The crews' door's frame: the spark's crews, whole, and how many tasks wait for each member on the board. A store
   * that cannot be read throws here, so the door refuses honestly rather than answering no crews. */
  frame(
    spark: SparkId,
    waiting: (runtimeRunId: string) => number | undefined,
  ): ComposeSparksCrewsFrame {
    const crews = this.#read(spark);
    const live: SparkCrewWaiting[] = [];
    for (const crew of crews)
      for (const member of crew.members) {
        if (member.endedAt !== undefined) continue;
        const tasks = waiting(member.runtimeRunId);
        if (tasks !== undefined) live.push({ runtimeRunId: member.runtimeRunId, tasks });
      }
    return { spark, crews: [...crews], waiting: live.slice(0, SPARK_CREW_MEMBERS_MAX) };
  }

  /** Be told each change of a spark's crews, or of a member's row. */
  onChange(listener: (spark: SparkId) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The members `ends` names that have no end yet, Ended at `at`; undefined when there is none. */
  #end(
    crews: readonly SparkCrew[],
    ends: (runtimeRunId: string) => boolean,
    at: string,
    name?: string,
  ): SparkCrew[] | undefined {
    let changed = false;
    const next = crews.map((crew) => {
      if (!crew.members.some((m) => m.endedAt === undefined && ends(m.runtimeRunId))) return crew;
      changed = true;
      return {
        ...crew,
        members: crew.members.map((m) =>
          m.endedAt === undefined && ends(m.runtimeRunId)
            ? { ...m, endedAt: at, ...(name !== undefined ? { name } : {}) }
            : m,
        ),
      };
    });
    return changed ? next : undefined;
  }

  /** A member's model and effort: the first its rows named, never overwritten. */
  #facts(
    member: SparkCrewMember | undefined,
    row: CrewRow,
  ): Pick<SparkCrewMember, "model" | "effort"> {
    const model = member?.model ?? row.model;
    const effort = member?.effort ?? row.effort;
    return {
      ...(model !== undefined ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
    };
  }

  #full(spark: SparkId, crew: CrewId): undefined {
    this.#logger.warn(
      "fieldd.crews.full",
      "A crew holds the most members its record keeps; a later one is on the board alone",
      { spark, crew, max: SPARK_CREW_MEMBERS_MAX },
    );
    return undefined;
  }

  /** Change the spark's crews: written through the kept record, which the store re-reads first so every other
   * section survives. A change that answers undefined writes nothing. A store that cannot be read or written is logged
   * and never throws into the run's hooks: the card then finds the live members by their rows. Answers whether a
   * change was kept (and told). */
  #keep(spark: SparkId, change: (crews: readonly SparkCrew[]) => SparkCrew[] | undefined): boolean {
    try {
      const next = change(this.#read(spark));
      if (next === undefined) return false;
      const kept = this.#store.update(spark, (record) => ({ ...record, crews: next }));
      this.#remember(spark, kept.crews ?? []);
    } catch (err) {
      this.#logger.warn(
        "fieldd.crews.keep_failed",
        "A spark's crews could not be kept; the card finds its live members by their rows",
        { spark, reason: (err as Error).message },
      );
      return false;
    }
    this.#emit(spark);
    return true;
  }

  #read(spark: SparkId): readonly SparkCrew[] {
    const held = this.#crews.get(spark);
    if (held !== undefined) return held;
    const crews = this.#store.get(spark)?.crews ?? [];
    this.#remember(spark, crews);
    return crews;
  }

  /** Hold the spark's crews as read or written, and index each member's run to it (a run a crew no longer keeps
   * stays indexed: its end finds no member and keeps nothing). */
  #remember(spark: SparkId, crews: readonly SparkCrew[]): void {
    this.#crews.set(spark, crews);
    for (const crew of crews)
      for (const member of crew.members) this.#members.set(member.runtimeRunId, spark);
  }

  #emit(spark: SparkId): void {
    for (const listener of this.#listeners) {
      try {
        listener(spark);
      } catch (err) {
        this.#logger.warn("fieldd.crews.listener_failed", "A crews listener threw", {
          reason: (err as Error).message,
        });
      }
    }
  }
}
