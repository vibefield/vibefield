import { randomUUID } from "node:crypto";
import { PROJECT_DOORS } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "../native-link";
import type { GroupedProject, GroupingIntents } from "./grouping";
import type { ProjectIntentWriter } from "./project-doors";
import type { ProjectGroupsChange, ProjectGroupsSnapshot } from "./project-groups";
import type { ProjectWrite } from "./records-doc";

// PJ-2 (build-pj23.md D7; `thinking-project-places.md` §3, §5, PJ-D19) — the
// person's ACTS on projects, written as RECORDS in the library
// (projects/records-doc.ts). An in-process fieldd service: PJ-3's
// `project.intent` door arrives over it (P2 (a), 2026-10-08: only desktop
// windows write intents; the phone reads), and fieldd itself records a launch
// or a resume into a place.
//
// A record is made ONLY by an act (PJ-D19): a project's first act — a rename,
// a pin, a hide, a link, a split, a dismissal, a launch or resume there —
// creates its record, anchored by the project's anchors at that moment (its
// first commits, its identity remote, its places), and FREEZES the project's
// provisional ink in it (P3 (a), 2026-10-08: nothing jumps on screen, and two
// desktops acting at once froze the same ink). Every later act adds the
// project's anchors as they stand (grow-only), so the record keeps finding its
// group as places come and go. One act is one library commit.
//
//   rename · pin · hide     the record's own keys (last writer wins)
//   link {place}            that place joins this project (E3; a suggestion's
//                           accept too), the act's time carried; the record
//                           takes both sides' anchors
//   split {place}           `{place, notRecord}`: the place leaves the side
//                           this record names (D2)
//   dismiss {with}          bound to the PAIR OF RECORDS (D3), so both
//                           projects get one
//   acted (a launch/resume) the place joins the record's places acted in (D6)
//
// Temporary is a bucket, not a project (PJ-L4): an act on it is refused, and
// a launch there makes no record. A desktop's Home is a project (J11,
// 2026-10-08) — renamed, pinned, hidden and launched into like any — but it
// groups by its desktop, not by evidence, so nothing links into it, splits
// out of it or is dismissed beside it. Acts are serialized, each
// reading the grouping after the last one's commit, and a key an act moved
// (`p1:` → `r:` at the project's first record) still names the project here.

export type ProjectIntentOp =
  | { readonly op: "rename"; readonly name: string }
  | { readonly op: "pin"; readonly pinned: boolean }
  | { readonly op: "hide"; readonly hidden: boolean }
  /** `place` (a placeId, any desktop's) joins this project */
  | { readonly op: "link"; readonly place: string }
  | { readonly op: "split"; readonly place: string }
  | { readonly op: "dismiss"; readonly with: string };

/** Why an act was not written. */
export type ProjectRefusalCode =
  /** no library is mounted yet, or no grouping computed */
  | "unavailable"
  /** no project answers to the key */
  | "not-found"
  /** no project holds the place a link names */
  | "no-such-place"
  /** Temporary (PJ-L4) */
  | "bucket"
  /** a link, split or dismissal with a desktop's Home (J11: it groups by its
   * desktop alone) */
  | "home"
  /** the place a split names is not one of the project's */
  | "not-in-project"
  /** a split of a project's only place */
  | "only-place"
  /** a link of a place already in the project; a dismissal of it with itself */
  | "same-project"
  /** a name that is empty or too long */
  | "invalid";

export class ProjectRecordsRefusal extends Error {
  constructor(
    readonly code: ProjectRefusalCode,
    message: string,
  ) {
    super(message);
  }
}

/** What an act answers: the project's key after it (`r:<record>`). */
export interface ProjectActResult {
  readonly key: string;
  readonly recordId: string;
  /** false when the act was already so (nothing committed) */
  readonly wrote: boolean;
}

/** The library as the records need it (LibraryDocService's surface). */
export interface RecordsLibrary {
  writeProjects(writes: readonly ProjectWrite[], by: string): Promise<boolean>;
  projectIntents(): GroupingIntents;
}

/** The grouping as the records need it (ProjectGroups' surface). */
export interface RecordsGroups {
  regroupNow(): ProjectGroupsSnapshot | null;
  onChange(listener: (change: ProjectGroupsChange) => void): () => void;
}

export interface ProjectRecordsOptions {
  /** the mounted library, late-bound (it re-mounts on a relink) */
  library: () => RecordsLibrary | null;
  groups: RecordsGroups;
  /** this desktop's place holding a folder by the longest prefix
   * (PlaceScanner.placeOf), for a launch's cwd */
  placeOf?: (path: string) => string | null;
  now?: () => number;
  newId?: () => string;
  logger?: Logger;
}

/** A name a person gives, at most this long. */
export const PROJECT_NAME_MAX = 200;
/** Launches whose place is not known yet, held at most this many. */
const PENDING_ACTS_MAX = 256;

const byStrength = (a: string, b: string): number => {
  const rank = (x: string) => (x.startsWith("root:") ? 0 : x.startsWith("remote:") ? 1 : 2);
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
};

export class ProjectRecords {
  readonly #opts: ProjectRecordsOptions;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #newId: () => string;
  #chain: Promise<unknown> = Promise.resolve();
  /** keys an act moved (a project's first record), old → new */
  readonly #moved = new Map<string, string>();
  /** launches into folders no grouped place holds yet */
  #pending: Array<{ cwd: string; at: number }> = [];
  readonly #offComputed: () => void;
  #disposed = false;

  constructor(opts: ProjectRecordsOptions) {
    this.#opts = opts;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "project_records" });
    this.#now = opts.now ?? Date.now;
    this.#newId = opts.newId ?? randomUUID;
    this.#offComputed = opts.groups.onChange(() => {
      if (this.#pending.length > 0) void this.#serial(() => this.#drainActs()).catch(() => {});
    });
  }

  /** Stop hearing the grouping and drop the launches still waiting for a
   * place. The act already running finishes: the promise settles once it has
   * (its library write landed or failed), so the owner closes the library —
   * or removes its folder — only after it. */
  dispose(): Promise<void> {
    this.#disposed = true;
    this.#offComputed();
    this.#pending = [];
    return this.#chain.then(() => undefined);
  }

  /** One act of the person's on the project `key` (PJ-3's `project.intent`). */
  intent(key: string, op: ProjectIntentOp, by: string): Promise<ProjectActResult> {
    return this.#serial(() => this.#intent(key, op, by));
  }

  /** PJ-6's seam: the recipe a confirmed launch used, kept on the record. */
  setRecipe(key: string, recipe: unknown, by: string): Promise<ProjectActResult> {
    return this.#serial(async () => {
      const { library, project } = this.#resolve(key);
      const at = this.#now();
      const { recordId, writes } = this.#ensure(project, at);
      writes.push({ kind: "recipe", record: recordId, recipe });
      return this.#write(library, key, recordId, writes, by);
    });
  }

  /** D6 — a person's launch or resume ran in `cwd` at `at` (epoch ms): the
   * place holding it joins its project's record. A folder no grouped place
   * holds yet waits for the grouping that has it. */
  actedIn(cwd: string, at: number): void {
    if (this.#disposed) return;
    this.#pending.push({ cwd, at });
    if (this.#pending.length > PENDING_ACTS_MAX) this.#pending.shift();
    void this.#serial(() => this.#drainActs()).catch(() => {});
  }

  // ---- internals ----

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(work);
    this.#chain = run.catch(() => undefined);
    return run;
  }

  async #intent(key: string, op: ProjectIntentOp, by: string): Promise<ProjectActResult> {
    const { library, project, snapshot } = this.#resolve(key);
    const at = this.#now();
    switch (op.op) {
      case "rename": {
        const name = op.name.trim();
        if (name.length === 0 || name.length > PROJECT_NAME_MAX)
          throw new ProjectRecordsRefusal("invalid", "a project's name is 1 to 200 characters");
        const { recordId, writes } = this.#ensure(project, at);
        writes.push({ kind: "name", record: recordId, name });
        return this.#write(library, key, recordId, writes, by);
      }
      case "pin":
      case "hide": {
        const { recordId, writes } = this.#ensure(project, at);
        writes.push(
          op.op === "pin"
            ? { kind: "pinned", record: recordId, value: op.pinned }
            : { kind: "hidden", record: recordId, value: op.hidden },
        );
        return this.#write(library, key, recordId, writes, by);
      }
      case "link": {
        const held = snapshot.result.projects.find((p) =>
          p.places.some((pl) => pl.placeId === op.place || pl.aliasIds.includes(op.place)),
        );
        if (held === undefined)
          throw new ProjectRecordsRefusal("no-such-place", "no project holds that place");
        const other = this.#other(project, held);
        const place = other.places.find(
          (pl) => pl.placeId === op.place || pl.aliasIds.includes(op.place),
        )!;
        const { recordId, writes } = this.#ensure(project, at, other.anchors);
        writes.push({ kind: "link", a: project.places[0]!.placeId, b: place.placeId, at });
        return this.#write(library, key, recordId, writes, by);
      }
      case "split": {
        if (project.kind === "home")
          throw new ProjectRecordsRefusal("home", "nothing splits out of a desktop's Home");
        const place = project.places.find(
          (pl) => pl.placeId === op.place || pl.aliasIds.includes(op.place),
        );
        if (place === undefined)
          throw new ProjectRecordsRefusal(
            "not-in-project",
            "the place is not one of this project's",
          );
        if (project.places.length < 2)
          throw new ProjectRecordsRefusal(
            "only-place",
            "a project's only place cannot be split from it",
          );
        const { recordId, writes } = this.#ensure(project, at);
        writes.push({ kind: "split", place: place.placeId, notRecord: recordId, at });
        return this.#write(library, key, recordId, writes, by);
      }
      case "dismiss": {
        const other = this.#other(project, this.#find(snapshot, op.with));
        const mine = this.#ensure(project, at);
        const theirs = this.#ensure(other, at);
        const writes = [
          ...mine.writes,
          ...theirs.writes,
          { kind: "dismiss", a: mine.recordId, b: theirs.recordId, at } as const,
        ];
        return this.#write(library, key, mine.recordId, writes, by);
      }
    }
  }

  /** The library and the project a key names, on a grouping that has read
   * every act before this one. */
  #resolve(key: string): {
    library: RecordsLibrary;
    project: GroupedProject;
    snapshot: ProjectGroupsSnapshot;
  } {
    const library = this.#opts.library();
    const snapshot = this.#opts.groups.regroupNow();
    if (library === null || snapshot === null)
      throw new ProjectRecordsRefusal("unavailable", "the projects are not read yet");
    const project = this.#find(snapshot, key);
    if (project.bucket !== null)
      throw new ProjectRecordsRefusal("bucket", "Temporary is not a project");
    return { library, project, snapshot };
  }

  #find(snapshot: ProjectGroupsSnapshot, key: string): GroupedProject {
    let at = key;
    for (let hops = 0; hops < 4; hops += 1) {
      const project = snapshot.result.projects.find((p) => p.key === at);
      if (project !== undefined) return project;
      const next = this.#moved.get(at);
      if (next === undefined) break;
      at = next;
    }
    throw new ProjectRecordsRefusal("not-found", "no project answers to that key");
  }

  /** The other project a link or a dismissal names, if it may be named. */
  #other(project: GroupedProject, other: GroupedProject): GroupedProject {
    if (other.bucket !== null)
      throw new ProjectRecordsRefusal("bucket", "Temporary is not a project");
    if (other === project)
      throw new ProjectRecordsRefusal("same-project", "that is this project already");
    if (project.kind === "home" || other.kind === "home")
      throw new ProjectRecordsRefusal("home", "a desktop's Home joins and is suggested to nothing");
    return other;
  }

  /** The project's record — its naming one, or a new one (its first act:
   * created now, P3's ink frozen) — and the writes that give it the
   * project's anchors as they stand (and `more`'s). */
  #ensure(
    project: GroupedProject,
    at: number,
    more: readonly string[] = [],
  ): { recordId: string; writes: ProjectWrite[] } {
    const writes: ProjectWrite[] = [];
    let recordId = project.recordId;
    if (recordId === undefined) {
      recordId = this.#newId();
      writes.push({ kind: "create", record: recordId, createdAt: at, ink: project.ink });
    }
    for (const anchor of [...new Set([...project.anchors, ...more])].sort(byStrength))
      writes.push({ kind: "anchor", record: recordId, anchor, at });
    return { recordId, writes };
  }

  async #write(
    library: RecordsLibrary,
    key: string,
    recordId: string,
    writes: readonly ProjectWrite[],
    by: string,
  ): Promise<ProjectActResult> {
    const wrote = await library.writeProjects(writes, by);
    const after = `r:${recordId}`;
    if (after !== key) this.#moved.set(key, after);
    this.#opts.groups.regroupNow();
    return { key: after, recordId, wrote };
  }

  /** D6 — the launches whose place the grouping now holds, recorded in one
   * commit; the rest wait. */
  async #drainActs(): Promise<void> {
    if (this.#disposed || this.#pending.length === 0) return;
    const library = this.#opts.library();
    const snapshot = this.#opts.groups.regroupNow();
    const placeOf = this.#opts.placeOf;
    if (library === null || snapshot === null || placeOf === undefined) return;
    const waiting: Array<{ cwd: string; at: number }> = [];
    const writes: ProjectWrite[] = [];
    const ensured = new Map<GroupedProject, string>();
    let recorded = 0;
    for (const act of this.#pending) {
      const placeId = placeOf(act.cwd);
      const project =
        placeId === null
          ? undefined
          : snapshot.result.projects.find((p) =>
              p.places.some((pl) => pl.placeId === placeId || pl.aliasIds.includes(placeId)),
            );
      if (placeId === null || project === undefined) {
        waiting.push(act);
        continue;
      }
      if (project.bucket !== null) continue;
      let recordId = ensured.get(project);
      if (recordId === undefined) {
        const ensure = this.#ensure(project, act.at);
        recordId = ensure.recordId;
        ensured.set(project, recordId);
        writes.push(...ensure.writes);
      }
      writes.push({ kind: "acted", record: recordId, place: placeId, at: act.at });
      recorded += 1;
    }
    this.#pending = waiting;
    if (writes.length === 0) return;
    try {
      await library.writeProjects(writes, "fieldd.launch");
      for (const [project, recordId] of ensured)
        if (project.key !== `r:${recordId}`) this.#moved.set(project.key, `r:${recordId}`);
    } catch (error) {
      this.#logger.warn("fieldd.projects.acts_unwritten", "Launches were not recorded", {
        acts: recorded,
        error: error instanceof Error ? error.message.slice(0, 200) : String(error),
      });
    }
  }
}

/** PJ-3's `project.intent` door, met (project-doors.ts `ProjectIntentWriter`):
 * the door has resolved the key (a moved one is refused there, `key-moved`)
 * and checked each `PlaceRef`; the act runs here, on the grouping as it stands
 * after the last act, and a refusal becomes the door's typed answer. */
export function projectIntentWriter(records: ProjectRecords): ProjectIntentWriter {
  return {
    act: async (project, intent, context) => {
      const op: ProjectIntentOp =
        intent.op === "rename"
          ? { op: "rename", name: intent.name }
          : intent.op === "pin"
            ? { op: "pin", pinned: intent.pinned }
            : intent.op === "hide"
              ? { op: "hide", hidden: intent.hidden }
              : intent.op === "link"
                ? { op: "link", place: intent.place.placeId }
                : intent.op === "split"
                  ? { op: "split", place: intent.place.placeId }
                  : { op: "dismiss", with: context.with?.key ?? intent.with };
      try {
        const { recordId } = await records.intent(project.key, op, "project.intent");
        return { recordId };
      } catch (error) {
        throw error instanceof ProjectRecordsRefusal ? doorRefusal(error) : error;
      }
    },
  };
}

/** A refusal as the doors answer one (`PROJECT_REFUSALS`). */
function doorRefusal(refusal: ProjectRecordsRefusal): RpcCallError {
  const refuse = (reason: string) =>
    new RpcCallError("PRECONDITION_FAILED", refusal.message, false, { reason });
  switch (refusal.code) {
    case "unavailable":
      // a relink is swapping the library: the act is refused, never lost
      return new RpcCallError("UNAVAILABLE", refusal.message, true, {
        service: PROJECT_DOORS.SERVICE,
        state: PROJECT_DOORS.STATE_RECORDS_REMOUNTING,
      });
    case "not-found":
      return new RpcCallError("NOT_FOUND", refusal.message, false, { reason: "no-such-project" });
    case "no-such-place":
    case "not-in-project":
      return refuse("no-such-place");
    case "bucket":
      return refuse("not-a-project");
    case "home":
      return refuse("home");
    case "only-place":
      return refuse("only-place");
    case "same-project":
      return refuse("same-project");
    case "invalid":
      return new RpcCallError("PRECONDITION_FAILED", refusal.message, false);
  }
}
