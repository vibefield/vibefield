import { ObjectAtWork, type ObjectsPresenceSnapshot, SparkId } from "@vibefield/contracts";

// THE ROWS THE AT-WORK MARK READS (item 550, 2026-11-18; DESIGN.md §8 "At work on the mat"). One agent on one desk
// object as the presence feed says it (`objects.presence.subscribe`, the applier's own feed): contracts' `ObjectAtWork`,
// plus the three ids item 550a adds to it — the project, the spark whose own session this is, and the spark that started
// this run. `ObjectAtWork` is passthrough, so the ids already reach this window from a fieldd that sends them; until 550a
// lands they are read here, tolerantly, and kept only when each is well-typed. A row the contract cannot read is no row;
// a wrong id is no id, and the row stands without it. The ids are words and numbers, never a look: the ink is the
// model's (`at-work-ink.ts`).

/** A run's project, as item 550a carries it: Godview's deal (`seq`), its name as Godview shows it, and the PJ ink's deal
 * index (`ink`, carried so PJ-5 needs no second contract). Each is optional, and the object is absent when none is. */
export interface AtWorkProject {
  readonly name?: string;
  readonly seq?: number;
  readonly ink?: number;
}

/** The ids item 550a adds to `ObjectAtWork` (item 550, 2026-11-18). Widened here until 550a lands in contracts. */
export interface AtWorkIds {
  readonly project?: AtWorkProject;
  /** this run is that spark's own session (fieldd's launch memory, `bornFor`) */
  readonly spark?: SparkId;
  /** a spark started this run (its crew); absent after a fieldd restart, and then no printed star shows */
  readonly startedBy?: SparkId;
}

/** One agent on one object, as the renderer reads it: the contract's row and the 550a ids, nothing else. */
export type AtWorkRow = Pick<
  ObjectAtWork,
  "run" | "handle" | "agent" | "state" | "since" | "lastChange"
> &
  AtWorkIds;

/** One object agents are at work on, on one board. */
export interface AtWorkObject {
  readonly ref: string;
  readonly key: string;
  /** in the feed's order; an unreadable row is left out */
  readonly agents: readonly AtWorkRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isDeal = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A project as 550a spells one, or undefined when it says nothing well-typed. PURE. */
function projectOf(value: unknown): AtWorkProject | undefined {
  if (!isRecord(value)) return undefined;
  const name = typeof value.name === "string" && value.name.length > 0 ? value.name : undefined;
  const seq = isDeal(value.seq) ? value.seq : undefined;
  const ink = isDeal(value.ink) ? value.ink : undefined;
  if (name === undefined && seq === undefined && ink === undefined) return undefined;
  return {
    ...(name === undefined ? {} : { name }),
    ...(seq === undefined ? {} : { seq }),
    ...(ink === undefined ? {} : { ink }),
  };
}

const sparkOf = (value: unknown): SparkId | undefined => {
  const parsed = SparkId.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

/** One row as the mark reads it, or null when the contract cannot read it. The 550a ids are kept only when each is
 * well-typed (item 550, 2026-11-18: the widening stands until 550a lands). PURE. */
export function readAtWorkRow(raw: unknown): AtWorkRow | null {
  const parsed = ObjectAtWork.safeParse(raw);
  if (!parsed.success) return null;
  const { run, handle, agent, state, since, lastChange } = parsed.data;
  const project = projectOf(parsed.data.project);
  const spark = sparkOf(parsed.data.spark);
  const startedBy = sparkOf(parsed.data.startedBy);
  return {
    run,
    handle,
    agent,
    state,
    since,
    ...(lastChange === undefined ? {} : { lastChange: { label: lastChange.label } }),
    ...(project === undefined ? {} : { project }),
    ...(spark === undefined ? {} : { spark }),
    ...(startedBy === undefined ? {} : { startedBy }),
  };
}

/** The objects of one board that agents are at work on, keyed in the feed's order. An object with no readable agent is
 * left out. PURE. */
export function readAtWorkObjects(
  snapshot: ObjectsPresenceSnapshot,
  docId: string,
): readonly AtWorkObject[] {
  const out: AtWorkObject[] = [];
  for (const object of snapshot.objects) {
    if (object.docId !== docId) continue;
    const agents: AtWorkRow[] = [];
    for (const raw of object.agents) {
      const row = readAtWorkRow(raw);
      if (row !== null) agents.push(row);
    }
    if (agents.length > 0) out.push({ ref: object.ref, key: object.key, agents });
  }
  return out;
}
