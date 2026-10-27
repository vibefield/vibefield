import { randomUUID } from "node:crypto";
import {
  type CallerContext,
  type IndexCatalogSession,
  type IndexCatalogSource,
  type IndexProjectBackfill,
  type PlaceRef,
  PROJECT_DOORS,
  type ProjectEdge,
  type ProjectFiguresDayParams,
  type ProjectFiguresDayResult,
  type ProjectFiguresParams,
  type ProjectFiguresResult,
  type ProjectGetParams,
  type ProjectGetResult,
  type ProjectIntentParams,
  type ProjectIntentResult,
  type ProjectListParams,
  type ProjectListResult,
  type ProjectPlace,
  ProjectRecipe,
  type ProjectRefusal,
  type ProjectRegrouped,
  type ProjectSessionRow,
  type ProjectSessionsParams,
  type ProjectSessionsResult,
  type ProjectSubscribeParams,
  type ProjectSuggestion,
  type ProjectSummary,
  pathKeyIn,
  type RowsCursor,
} from "@vibefield/contracts";
import type { RosettaProjectBackfill } from "../agent-index";
import { sessionActivityAt } from "../index-catalog";
import { compareKeys, decodeCursor, pageOf, type SortKey } from "../index-mesh";
import { RpcCallError } from "../native-link";
import type { GroupedPlace, GroupedProject } from "./grouping";
import type { KeyMove } from "./key-journal";
import { slashPath } from "./place-kind";
import {
  type FiguresAsk,
  type FiguresPart,
  type FiguresPlan,
  projectFigures,
  projectFiguresDay,
} from "./project-figures";
import { type ProjectGroups, type ProjectGroupsSnapshot, placeResolver } from "./project-groups";

// PJ-3 — THE `project.*` DOORS (`thinking-project-places.md` §9; PJ-D15 (a);
// `build-pj23.md` D8–D10; P1 and P2 RULED (a) 2026-10-08). What this desktop
// groups (`ProjectGroups.current()`, PJ-1's engine over every self desktop's
// places) answered to the person's own devices:
//
//   1. WHO (D8, P2). The reads (`project.read`) answer a window, the shell and
//      the person's phone; a PEER DAEMON is refused whatever it holds (DS-L4:
//      a daemon never aggregates another's aggregate — and PEER_FIELDD_SCOPES
//      carries `project.read` only because it is derived from the phone's
//      preset), as are a guest, a plugin and an MCP agent (none can hold the
//      scope; the gate says so again). The ACT (`project.intent`,
//      `settings.manage`) answers a desktop window or the shell only — the
//      phone reads (P2).
//   2. WHAT. A request never names a place by its path (P1): any
//      path-carrying key is refused PRECONDITION_FAILED `path-in-request`
//      before the params are read; then the params (PRECONDITION_FAILED).
//   3. WHICH project. A key no project holds follows the key memory (D9): a
//      read answers the project it moved into with `movedTo`; an act is
//      refused `key-moved` (an act is never aimed at a project the person did
//      not see). Nothing at all: NOT_FOUND `no-such-project`.
//   4. WHETHER it can answer: UNAVAILABLE {service: "projects", state:
//      "grouping"} before this boot's first grouping (retryable), and from the
//      act {state: "records-unbuilt"} until PJ-2's records are wired.
//
// WHAT AN ANSWER CARRIES (D10, P1): every caller gets places by `PlaceRef`
// and the folder's own name; a self principal (a window, the shell, the
// phone whose login matched — `tailnet` with `self: true`) also gets each
// place's path and each session's cwd; a tailnet caller never gets an edge's
// or a suggestion's `via` (a remote key, a first commit, a home-relative
// folder) nor the `root:` and `remote:` anchors that spell the same facts.
// No answer carries a place's other spellings (aliases). A tailnet caller's
// `list` and `sessions` pages are cut at INDEX_TAILNET_LIMITS.MAX_ROWS by the
// daemon (`tailnetRowLimit`), a page with a cursor, never a silent cut.

/** What one caller may be told (D10, P1). */
export interface ProjectView {
  /** the answer may carry paths: the person's own devices (P1) */
  readonly paths: boolean;
  /** the caller crossed the tailnet: no `via`, place anchors only (D10) */
  readonly tailnet: boolean;
}

/** D8 — the readers' gate, and what the admitted caller may be told. */
export function admitProjectReader(ctx: CallerContext, method: string): ProjectView {
  const principal = ctx.principal;
  if (principal.kind === "local-token" || principal.kind === "shell-main")
    return { paths: true, tailnet: false };
  // the phone: a verified self device sees paths (P1); a pre-capture tailnet
  // principal (no stored login to compare) reads without them
  if (principal.kind === "tailnet") return { paths: principal.self === true, tailnet: true };
  throw new RpcCallError(
    "FORBIDDEN_SCOPE",
    principal.kind === "peer-fieldd"
      ? "the projects are this desktop's aggregate; a peer daemon groups its own (DS-L4)"
      : "the projects answer the person's own windows and devices only — never a plugin, an agent or a guest",
    false,
    { method, principal: principal.kind },
  );
}

/** PJ-4 (A-D4) — whether the projects answer this caller at all (D8's rule,
 * without the refusal): the catalog's listings carry the join column
 * (`projectKey`) only for a caller the projects would answer — never a peer
 * daemon, which groups its own (DS-L4). */
export function readsProjects(ctx: CallerContext): boolean {
  const kind = ctx.principal.kind;
  return kind === "local-token" || kind === "shell-main" || kind === "tailnet";
}

/** P2 (a) — only a desktop window (or the shell) makes an act. */
export function admitProjectWriter(ctx: CallerContext, method: string): void {
  const kind = ctx.principal.kind;
  if (kind === "local-token" || kind === "shell-main") return;
  throw new RpcCallError(
    "FORBIDDEN_SCOPE",
    "a project's acts are a desktop window's (the phone reads)",
    false,
    { method, principal: kind },
  );
}

/** P1 then the params: a path anywhere is `path-in-request`, a shape this
 * door does not take is `expected`. */
export function parseProjectAsk<T>(
  schema: {
    safeParse(
      input: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: Array<{ message: string; path: PropertyKey[] }> } };
  },
  params: unknown,
  expected: string,
): T {
  const pathRefusal = (field: string) =>
    new RpcCallError(
      "PRECONDITION_FAILED",
      "a place is named by {device, placeId}, never by its path",
      false,
      { reason: "path-in-request", field } satisfies ProjectRefusal,
    );
  const field = pathKeyIn(params);
  if (field !== undefined) throw pathRefusal(field);
  const parsed = schema.safeParse(params ?? {});
  if (parsed.success) return parsed.data;
  // the schema's own P1 rule (an anchor that spells a folder)
  const spelled = parsed.error.issues.find((issue) => issue.message === "path-in-request");
  if (spelled !== undefined) throw pathRefusal(spelled.path.map(String).join("."));
  throw new RpcCallError("PRECONDITION_FAILED", expected, false);
}

/** The act's writer — PJ-2's `ProjectRecords`, late-bound: the door resolves
 * the project and the places, the writer makes or amends the record. */
export interface ProjectIntentWriter {
  act(
    project: GroupedProject,
    intent: ProjectIntentParams,
    context: { with?: GroupedProject; device: string },
  ): Promise<{ recordId: string }> | { recordId: string };
}

export interface ProjectDoorsOptions {
  groups: ProjectGroups;
  /** this desktop's id (its own sessions are read from `localSessions`) */
  deviceId: () => string;
  localSessions: () => readonly IndexCatalogSession[];
  /** every peer's replicated sessions (IndexMesh.peerRows) */
  peerSessions: () => ReadonlyArray<{
    device: string;
    sessions: readonly IndexCatalogSession[];
  }>;
  /** every desktop's standing (IndexMesh.sourcesFor("projects")) */
  sources: () => IndexCatalogSource[];
  /** PJ-2's records; null until they are wired (the act answers UNAVAILABLE) */
  records?: () => ProjectIntentWriter | null;
  /** PJ-4 — where a project's merged figures are asked (this desktop's index,
   * a peer's door); absent, the figures doors answer UNAVAILABLE */
  figures?: Omit<FiguresAsk, "self">;
  now?: () => number;
  /** the pings' floor (default PROJECT_DOORS.CHANGES_MIN_INTERVAL_MS) */
  changesMinIntervalMs?: number;
}

/** A place as the doors index it: its project and its own row. */
interface Held {
  project: GroupedProject;
  place: GroupedPlace;
}

/** What one grouping is read through, built once per snapshot. */
interface Indexed {
  readonly snapshot: ProjectGroupsSnapshot;
  /** every id a place answers to (aliases included) → its project and place */
  readonly places: Map<string, Held>;
  readonly byKey: Map<string, GroupedProject>;
  /** newest activity first, by `(lastAt, the smallest place anchor)` */
  readonly sorted: ReadonlyArray<{ project: GroupedProject; sort: SortKey }>;
  /** a device's longest-path rule over its places, built on first use */
  readonly resolvers: Map<string, (cwd: string) => string | undefined>;
}

/** One bump of the doors' revision, as a ping hears it: the key moves a new
 * grouping made, the desktop whose catalog moved, and — for a catalog move —
 * which table (PJ-4: a ping that only threads moved says so). `grouping` is
 * true for a new grouping, whose answer every page re-asks. */
interface DoorsChange {
  readonly moves: readonly KeyMove[];
  readonly device?: string;
  readonly table?: string;
  readonly grouping: boolean;
}

/** The subscribe log keeps this many key moves for a resuming reader. */
const MOVE_LOG_MAX = 256;

const baseName = (path: string): string => {
  const slashed = slashPath(path);
  return slashed.split("/").pop() || slashed;
};

function refOf(place: GroupedPlace): PlaceRef {
  return { device: place.deviceId, placeId: place.placeId };
}

/** The anchor a project is paged by: its smallest `place:` anchor — a key
 * move never changes it, and every project holds one. */
function pageAnchorOf(project: GroupedProject): string {
  return project.anchors.find((anchor) => anchor.startsWith("place:")) ?? `key:${project.key}`;
}

export class ProjectDoors {
  readonly #opts: ProjectDoorsOptions;
  readonly #now: () => number;
  readonly #floorMs: number;
  readonly #epoch = `projects-${randomUUID()}`;
  #revision = 0;
  readonly #moveLog: Array<{ revision: number; move: ProjectRegrouped }> = [];
  /** the newest revision whose key moves the log no longer holds */
  #trimmedThrough = 0;
  readonly #subscribers = new Set<(change: DoorsChange) => void>();
  #indexed: Indexed | null = null;
  readonly #off: () => void;

  constructor(opts: ProjectDoorsOptions) {
    this.#opts = opts;
    this.#now = opts.now ?? Date.now;
    this.#floorMs = opts.changesMinIntervalMs ?? PROJECT_DOORS.CHANGES_MIN_INTERVAL_MS;
    this.#off = opts.groups.onChange((change) =>
      this.#bump({ moves: change.moves, grouping: true }),
    );
  }

  dispose(): void {
    this.#off();
    this.#subscribers.clear();
  }

  /** A desktop's catalog moved (IndexMesh's `change`): its sessions, or its
   * standing — a visible page re-asks. PJ-4: `table` names which of its
   * tables moved (absent: its standing, or a table the event did not name),
   * so a ping can say when only this desktop's threads did. */
  catalogChanged(device?: string, table?: string): void {
    this.#bump({
      moves: [],
      grouping: false,
      ...(device !== undefined ? { device } : {}),
      ...(table !== undefined ? { table } : {}),
    });
  }

  // ── PJ-4: the join column (A-D4) ──

  /** The key of the project whose place holds `cwd` on `device` by the
   * longest path — the rule `project.sessions` reads a session's place by —
   * or undefined: before this boot's first grouping, for no cwd, or for a cwd
   * no place holds yet. Never a refusal: a listing keyed by it answers without
   * the column rather than not at all. */
  keyOf(device: string, cwd: string | undefined): string | undefined {
    return this.#joined(device, cwd)?.key;
  }

  /** The project's key and the place's ref a cwd joins (the longest path). */
  #joined(device: string, cwd: string | undefined): { key: string; place: PlaceRef } | undefined {
    if (cwd === undefined || cwd.length === 0 || this.#opts.groups.current() === null)
      return undefined;
    const indexed = this.#require();
    const placeId = this.#resolverFor(indexed, device)(cwd);
    const held = placeId === undefined ? undefined : indexed.places.get(placeId);
    return held === undefined ? undefined : { key: held.project.key, place: refOf(held.place) };
  }

  /** A listing's rows (`index.sessions`) with the join column: each row's own
   * desktop (this one's when it names none) and its cwd. A key already on a
   * row is never trusted — a peer's copy carries none, and this grouping is
   * the only one this desktop answers with (DS-L4). */
  keyed<Row extends { device?: string | undefined; cwd?: string | undefined }>(
    rows: readonly Row[],
  ): Array<Row & { projectKey?: string; place?: PlaceRef }> {
    const self = this.#opts.deviceId();
    return rows.map((row) => {
      const {
        projectKey: _stale,
        place: _stalePlace,
        ...rest
      } = row as Row & { projectKey?: unknown; place?: unknown };
      const joined = this.#joined(row.device ?? self, row.cwd);
      return {
        ...(rest as Row),
        ...(joined !== undefined ? { projectKey: joined.key, place: joined.place } : {}),
      };
    });
  }

  /** This desktop's delegated threads (`index.threads`) with their ROOT's
   * key: a child hangs under its root, whatever folder it worked in. */
  keyedThreads<Row extends { rootSessionId: string }>(
    rows: readonly Row[],
    rootOf: (sessionId: string) => { cwd?: string | undefined } | undefined,
  ): Array<Row & { projectKey?: string }> {
    const self = this.#opts.deviceId();
    const byRoot = new Map<string, string | undefined>();
    return rows.map((row) => {
      const { projectKey: _stale, ...rest } = row as Row & { projectKey?: unknown };
      if (!byRoot.has(row.rootSessionId))
        byRoot.set(row.rootSessionId, this.keyOf(self, rootOf(row.rootSessionId)?.cwd));
      const key = byRoot.get(row.rootSessionId);
      return { ...(rest as Row), ...(key !== undefined ? { projectKey: key } : {}) };
    });
  }

  /** AO-4 — the first reading's per-project fold, keyed the way History keys
   * its projects (`index.status`, for this desktop's own windows). rosetta
   * folds by ITS projects; this desktop's listed sessions say which of ours
   * holds each. One held whole by one project — or by no place, the room's
   * unassigned bucket (`key: null`) — is summed into it. One whose sessions
   * part across several is a total that cannot be cut, so every key it touches
   * is left out rather than drawn short. One with no session listed yet is left
   * out too: the room lists none of its sessions. Nothing before this boot's
   * first grouping, when no session has a key to join. */
  backfills(rows: readonly RosettaProjectBackfill[]): IndexProjectBackfill[] {
    if (this.#opts.groups.current() === null) return [];
    const self = this.#opts.deviceId();
    const keyOfCwd = new Map<string, string | null>();
    const holders = new Map<string | null, Set<string | null>>();
    for (const session of this.#opts.localSessions()) {
      const cwd = session.cwd ?? "";
      let key = keyOfCwd.get(cwd);
      if (key === undefined) {
        key = this.keyOf(self, cwd) ?? null;
        keyOfCwd.set(cwd, key);
      }
      const rosetta = session.projectId ?? null;
      const held = holders.get(rosetta) ?? new Set<string | null>();
      held.add(key);
      holders.set(rosetta, held);
    }
    const folds = new Map<string | null, IndexProjectBackfill>();
    const cut = new Set<string | null>();
    for (const row of rows) {
      const held = holders.get(row.projectId);
      if (held === undefined) continue;
      if (held.size > 1) {
        for (const key of held) cut.add(key);
        continue;
      }
      const [only] = [...held];
      const key = only ?? null;
      const fold = folds.get(key);
      folds.set(key, {
        key,
        sessionsTotal: (fold?.sessionsTotal ?? 0) + row.sessionsTotal,
        sessionsDone: (fold?.sessionsDone ?? 0) + row.sessionsDone,
        bytesTotal: (fold?.bytesTotal ?? 0) + row.bytesTotal,
        bytesStreamed: (fold?.bytesStreamed ?? 0) + row.bytesStreamed,
      });
    }
    return [...folds.values()].filter((fold) => !cut.has(fold.key));
  }

  // ── the reads ──

  /** `project.list` — a page of projects, newest activity first. */
  list(params: ProjectListParams, view: ProjectView, limit: number): ProjectListResult {
    const indexed = this.#require();
    const wanted = params.devices === undefined ? null : new Set(params.devices);
    const q = params.q?.toLowerCase();
    const { items, next } = pageOf(
      indexed.sorted,
      (item) => item.sort,
      decodeCursor(params.cursor),
      limit,
      ({ project }) =>
        (wanted === null || project.devices.some((device) => wanted.has(device))) &&
        (q === undefined || this.#matches(project, q)),
    );
    const sources = this.#opts.sources();
    return {
      rows: items.map(({ project }) => this.#summary(indexed, project, view, sources)),
      ...(next !== undefined ? { cursor: next } : {}),
      sources,
      groupingVersion: indexed.snapshot.result.groupingVersion,
    };
  }

  /** `project.get` — one project, its suggestions and its edges. */
  get(params: ProjectGetParams, view: ProjectView): ProjectGetResult {
    const indexed = this.#require();
    const { project, movedTo } =
      params.key !== undefined
        ? this.#resolveKey(indexed, params.key)
        : { project: this.#resolveAnchor(indexed, params.anchor ?? ""), movedTo: undefined };
    const sources = this.#opts.sources();
    return {
      project: this.#summary(indexed, project, view, sources),
      ...(movedTo !== undefined ? { movedTo } : {}),
      suggestions: this.#suggestionsOf(indexed, project, view),
      edges: project.edges.flatMap((edge): ProjectEdge[] => {
        const a = indexed.places.get(edge.a)?.place;
        const b = indexed.places.get(edge.b)?.place;
        if (a === undefined || b === undefined) return [];
        return [
          {
            a: refOf(a),
            b: refOf(b),
            rule: edge.rule,
            ...(view.tailnet ? {} : { via: edge.via }),
            ...(edge.depth !== undefined ? { depth: edge.depth } : {}),
          },
        ];
      }),
    };
  }

  /** `project.sessions` — a project's sessions, each joined to the place
   * that holds its cwd by the longest path (§9), one row per `{agent kind,
   * native session id}` however many desktops indexed it (DS-D10). */
  sessions(params: ProjectSessionsParams, view: ProjectView, limit: number): ProjectSessionsResult {
    const indexed = this.#require();
    const { project, movedTo } = this.#resolveKey(indexed, params.key);
    // the places asked for, by any id they answer to; every one when none
    let placeIds = new Set(project.places.map((place) => place.placeId));
    if (params.places !== undefined) {
      const asked = new Set<string>();
      for (const ref of params.places) {
        const held = indexed.places.get(ref.placeId);
        if (held?.project === project && held.place.deviceId === ref.device)
          asked.add(held.place.placeId);
      }
      placeIds = asked;
    }
    const wantedDevices = params.devices === undefined ? null : new Set(params.devices);
    const agents = params.agents === undefined ? null : new Set<string>(params.agents);
    const self = this.#opts.deviceId();
    const groups = new Map<
      string,
      Array<{ device: string; row: IndexCatalogSession; placeId: string }>
    >();
    for (const device of project.devices) {
      if (wantedDevices !== null && !wantedDevices.has(device)) continue;
      const placeOf = this.#resolverFor(indexed, device);
      const rows =
        device === self
          ? this.#opts.localSessions()
          : (this.#opts.peerSessions().find((peer) => peer.device === device)?.sessions ?? []);
      for (const row of rows) {
        if (typeof row.cwd !== "string" || row.cwd.length === 0) continue;
        if (agents !== null && (row.provider === undefined || !agents.has(row.provider))) continue;
        const resolved = placeOf(row.cwd);
        const canonical =
          resolved === undefined ? undefined : indexed.places.get(resolved)?.place.placeId;
        if (canonical === undefined || !placeIds.has(canonical)) continue;
        const key =
          row.kind !== undefined && row.nativeSessionId !== ""
            ? `${row.kind}\u0000${row.nativeSessionId}`
            : `\u0001${device}\u0000${row.sessionId}`;
        const members = groups.get(key) ?? [];
        members.push({ device, row, placeId: canonical });
        groups.set(key, members);
      }
    }
    const merged = [...groups.values()].map((members) => {
      members.sort((a, b) =>
        compareKeys(
          [sessionActivityAt(a.row) ?? null, a.device, a.row.sessionId],
          [sessionActivityAt(b.row) ?? null, b.device, b.row.sessionId],
        ),
      );
      const primary = members[0]!;
      const devices = [
        primary.device,
        ...[...new Set(members.map((member) => member.device))]
          .filter((device) => device !== primary.device)
          .sort(),
      ];
      const sort: SortKey = [
        sessionActivityAt(primary.row) ?? null,
        primary.device,
        primary.row.sessionId,
      ];
      return { primary, devices, sort };
    });
    merged.sort((a, b) => compareKeys(a.sort, b.sort));
    const { items, next } = pageOf(
      merged,
      (item) => item.sort,
      decodeCursor(params.cursor),
      limit,
      () => true,
    );
    return {
      key: project.key,
      ...(movedTo !== undefined ? { movedTo } : {}),
      rows: items.map(({ primary, devices }): ProjectSessionRow => {
        const { cwd, ...rest } = primary.row;
        return {
          ...rest,
          ...(view.paths && cwd !== undefined ? { cwd } : {}),
          device: primary.device,
          place: { device: primary.device, placeId: primary.placeId },
          devices,
        };
      }),
      ...(next !== undefined ? { cursor: next } : {}),
      sources: this.#opts.sources(),
    };
  }

  /** `project.subscribe` — invalidation pings (rows always empty) that carry
   * the key moves. A kept cursor resumes while the move log covers it. */
  subscribe(
    params: ProjectSubscribeParams,
    emit: (payload: unknown, kind: "delta" | "snapshot") => void,
  ): { open: unknown; start: () => void; dispose: () => void } {
    const floor = Math.max(params.minIntervalMs ?? this.#floorMs, this.#floorMs);
    const since: RowsCursor | undefined = params.since;
    // a kept cursor resumes while the log still holds every key move after it
    const resumes =
      since !== undefined &&
      since.epoch === this.#epoch &&
      since.revision <= this.#revision &&
      since.revision >= this.#trimmedThrough;
    let sent = resumes && since !== undefined ? since.revision : this.#revision;
    const open = resumes
      ? { resumed: { epoch: this.#epoch, revision: sent } }
      : { snapshot: { epoch: this.#epoch, revision: sent, rows: [] } };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAt = Number.NEGATIVE_INFINITY;
    let disposed = false;
    const devices = new Set<string>();
    // PJ-4 — the catalog tables that moved since the last ping; `null` once
    // anything else did (a grouping, a standing), which every page re-asks
    const tables: { names: Set<string> | null } = { names: new Set() };
    const clear = () => {
      devices.clear();
      tables.names = new Set();
    };
    const flush = () => {
      timer = null;
      if (disposed || this.#revision === sent) return;
      lastAt = this.#now();
      if (sent < this.#trimmedThrough) {
        // moves this reader never heard fell out of the log: a reset, and the
        // keys it holds resolve through `project.get`'s `movedTo`
        sent = this.#revision;
        clear();
        emit({ epoch: this.#epoch, revision: sent, rows: [] }, "snapshot");
        return;
      }
      const regrouped = this.#moveLog
        .filter((entry) => entry.revision > sent)
        .map((entry) => entry.move);
      const named = tables.names;
      emit(
        {
          epoch: this.#epoch,
          since: sent,
          revision: this.#revision,
          upserts: [],
          removed: [],
          ...(regrouped.length > 0 ? { regrouped } : {}),
          ...(devices.size > 0 ? { devices: [...devices] } : {}),
          ...(named !== null && named.size > 0 ? { tables: [...named].sort() } : {}),
        },
        "delta",
      );
      sent = this.#revision;
      clear();
    };
    const schedule = () => {
      if (disposed || timer !== null) return;
      timer = setTimeout(flush, Math.max(0, lastAt + floor - this.#now()));
      timer.unref?.();
    };
    const onChange = (change: DoorsChange) => {
      if (change.device !== undefined) devices.add(change.device);
      if (change.grouping || change.table === undefined) tables.names = null;
      else tables.names?.add(change.table);
      schedule();
    };
    return {
      open,
      start: () => {
        this.#subscribers.add(onChange);
        if (this.#revision !== sent) schedule();
      },
      dispose: () => {
        disposed = true;
        this.#subscribers.delete(onChange);
        if (timer !== null) clearTimeout(timer);
      },
    };
  }

  // ── PJ-4: the merged figures (H2 (a), A-D3) ──

  /** What a project's figures are asked of: every (desktop, rosetta project)
   * that files one of its sessions — keyed by BOTH (A4.1) — and whether the
   * project holds it WHOLE (every session it files on that desktop joins one
   * of this project's places by the longest path, the rule `project.sessions`
   * reads). A session with no rosetta project (rosetta's unassigned bucket)
   * has no figures door. A key that regrouped plans the project it moved
   * into (`movedTo`), as every read does. */
  figuresPlan(key: string): FiguresPlan {
    const indexed = this.#require();
    const { project, movedTo } = this.#resolveKey(indexed, key);
    const self = this.#opts.deviceId();
    const parts = new Map<
      string,
      { part: FiguresPart & { sessions: Set<string> }; others: number }
    >();
    const conversations = new Map<string, string>();
    for (const device of project.devices) {
      const placeOf = this.#resolverFor(indexed, device);
      const rows =
        device === self
          ? this.#opts.localSessions()
          : (this.#opts.peerSessions().find((peer) => peer.device === device)?.sessions ?? []);
      for (const row of rows) {
        if (row.projectId === undefined) continue;
        const id = `${device}\u0000${row.projectId}`;
        const held = parts.get(id) ?? {
          part: { device, projectId: row.projectId, whole: true, sessions: new Set<string>() },
          others: 0,
        };
        parts.set(id, held);
        const placeId =
          typeof row.cwd === "string" && row.cwd.length > 0 ? placeOf(row.cwd) : undefined;
        if (placeId !== undefined && indexed.places.get(placeId)?.project === project) {
          held.part.sessions.add(row.sessionId);
          if (row.kind !== undefined && row.nativeSessionId !== "")
            conversations.set(
              `${device}\u0000${row.sessionId}`,
              `${row.kind}\u0000${row.nativeSessionId}`,
            );
        } else held.others += 1;
      }
    }
    const order = (a: FiguresPart, b: FiguresPart): number =>
      project.devices.indexOf(a.device) - project.devices.indexOf(b.device) ||
      (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0);
    return {
      key: project.key,
      ...(movedTo !== undefined ? { movedTo } : {}),
      devices: [...project.devices],
      parts: [...parts.values()]
        .filter(({ part }) => part.sessions.size > 0)
        .map(({ part, others }): FiguresPart => ({ ...part, whole: others === 0 }))
        .sort(order),
      conversations,
    };
  }

  /** `project.figures` — the merged panels (contracts' project.figures). */
  async figures(
    params: ProjectFiguresParams,
    maxContributionRows?: number,
  ): Promise<ProjectFiguresResult> {
    const plan = this.figuresPlan(params.key);
    return await projectFigures(
      plan,
      { sinceMs: params.sinceMs, offsetMinutes: params.offsetMinutes },
      this.#figuresAsk(),
      maxContributionRows,
    );
  }

  /** `project.figuresDay` — one day's hours over the whole parts. */
  async figuresDay(params: ProjectFiguresDayParams): Promise<ProjectFiguresDayResult> {
    const plan = this.figuresPlan(params.key);
    return await projectFiguresDay(plan, params.day, params.offsetMinutes, this.#figuresAsk());
  }

  #figuresAsk(): FiguresAsk {
    const figures = this.#opts.figures;
    if (figures === undefined)
      throw new RpcCallError("UNAVAILABLE", "this desktop reads no figures", false, {
        service: PROJECT_DOORS.SERVICE,
        state: "figures-unwired",
      });
    return { ...figures, self: this.#opts.deviceId() };
  }

  // ── the act ──

  /** `project.intent` — resolve what the act names, then hand it to PJ-2's
   * records (UNAVAILABLE `records-unbuilt` until they are wired). */
  async intent(params: ProjectIntentParams): Promise<ProjectIntentResult> {
    const indexed = this.#require();
    const project = this.#current(indexed, params.key);
    let other: GroupedProject | undefined;
    if (params.op === "link" || params.op === "split") {
      const held = indexed.places.get(params.place.placeId);
      const ok =
        held !== undefined &&
        held.place.deviceId === params.place.device &&
        (params.op === "link" || held.project === project);
      if (!ok)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          params.op === "split"
            ? "that place is not one of this project's"
            : "no project holds that place",
          false,
          { reason: "no-such-place" } satisfies ProjectRefusal,
        );
    }
    if (params.op === "dismiss") other = this.#current(indexed, params.with);
    const writer = this.#opts.records?.() ?? null;
    if (writer === null)
      throw new RpcCallError("UNAVAILABLE", "a project's records are not built yet (PJ-2)", false, {
        service: PROJECT_DOORS.SERVICE,
        state: PROJECT_DOORS.STATE_RECORDS_UNBUILT,
      });
    const { recordId } = await writer.act(project, params, {
      ...(other !== undefined ? { with: other } : {}),
      device: this.#opts.deviceId(),
    });
    return { key: `r:${recordId}`, recordId };
  }

  // ── reading one grouping ──

  #require(): Indexed {
    const snapshot = this.#opts.groups.current();
    if (snapshot === null)
      throw new RpcCallError("UNAVAILABLE", "this desktop has not grouped its places yet", true, {
        service: PROJECT_DOORS.SERVICE,
        state: PROJECT_DOORS.STATE_GROUPING,
      });
    if (this.#indexed?.snapshot === snapshot) return this.#indexed;
    const places = new Map<string, Held>();
    const byKey = new Map<string, GroupedProject>();
    for (const project of snapshot.result.projects) {
      byKey.set(project.key, project);
      for (const place of project.places) {
        places.set(place.placeId, { project, place });
        for (const alias of place.aliasIds)
          if (!places.has(alias)) places.set(alias, { project, place });
      }
    }
    const sorted = snapshot.result.projects
      .map((project) => ({
        project,
        sort: [project.lastAt ?? null, pageAnchorOf(project), ""] as SortKey,
      }))
      .sort((a, b) => compareKeys(a.sort, b.sort));
    this.#indexed = { snapshot, places, byKey, sorted, resolvers: new Map() };
    return this.#indexed;
  }

  /** A read's key: the project holding it, or the one it moved into. */
  #resolveKey(
    indexed: Indexed,
    key: string,
  ): { project: GroupedProject; movedTo: string | undefined } {
    const project = indexed.byKey.get(key);
    if (project !== undefined) return { project, movedTo: undefined };
    const movedTo = this.#opts.groups.movedTo(key);
    const moved = movedTo === undefined ? undefined : indexed.byKey.get(movedTo);
    if (moved !== undefined) return { project: moved, movedTo };
    throw this.#notFound();
  }

  /** An act's key: the project holding it NOW — a moved key is refused. */
  #current(indexed: Indexed, key: string): GroupedProject {
    const project = indexed.byKey.get(key);
    if (project !== undefined) return project;
    const movedTo = this.#opts.groups.movedTo(key);
    if (movedTo !== undefined && indexed.byKey.has(movedTo))
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "the project regrouped; read it again before acting",
        false,
        { reason: "key-moved", movedTo } satisfies ProjectRefusal,
      );
    throw this.#notFound();
  }

  #resolveAnchor(indexed: Indexed, anchor: string): GroupedProject {
    if (anchor.startsWith("place:")) {
      const held = indexed.places.get(anchor.slice("place:".length));
      if (held !== undefined) return held.project;
      throw this.#notFound();
    }
    // a first commit or a remote two projects share (a suggestion) names the
    // newest of them — the listing's order, so every reader agrees
    const found = indexed.sorted.find(({ project }) => project.anchors.includes(anchor));
    if (found !== undefined) return found.project;
    throw this.#notFound();
  }

  #notFound(): RpcCallError {
    return new RpcCallError("NOT_FOUND", "no project holds that key or anchor", false, {
      reason: "no-such-project",
    } satisfies ProjectRefusal);
  }

  #resolverFor(indexed: Indexed, device: string): (cwd: string) => string | undefined {
    let resolver = indexed.resolvers.get(device);
    if (resolver === undefined) {
      const facts =
        indexed.snapshot.devices
          .find((input) => input.deviceId === device)
          ?.places.map((place) => place.facts) ?? [];
      resolver = placeResolver(facts);
      indexed.resolvers.set(device, resolver);
    }
    return resolver;
  }

  #matches(project: GroupedProject, q: string): boolean {
    const names = [
      project.name,
      ...(project.alsoCalled ?? []),
      project.disambiguation ?? "",
      ...project.places.map((place) => baseName(place.path)),
    ];
    return names.some((name) => name.toLowerCase().includes(q));
  }

  #suggestionsOf(
    indexed: Indexed,
    project: GroupedProject,
    view: ProjectView,
  ): ProjectSuggestion[] {
    const out: ProjectSuggestion[] = [];
    for (const suggestion of indexed.snapshot.result.suggestions) {
      const a = indexed.places.get(suggestion.a);
      const b = indexed.places.get(suggestion.b);
      if (a === undefined || b === undefined) continue;
      const [mine, theirs] = a.project === project ? [a, b] : b.project === project ? [b, a] : [];
      if (mine === undefined || theirs === undefined || theirs.project === project) continue;
      out.push({
        type: suggestion.type,
        with: theirs.project.key,
        a: refOf(mine.place),
        b: refOf(theirs.place),
        ...(view.tailnet ? {} : { via: suggestion.via }),
      });
    }
    return out;
  }

  /** PJ-D15's `ProjectSummary` v2, as this caller may be told it. */
  #summary(
    indexed: Indexed,
    project: GroupedProject,
    view: ProjectView,
    sources: readonly IndexCatalogSource[],
  ): ProjectSummary {
    const heard = new Map(sources.map((source) => [source.device, source.asOf]));
    const asOf: Record<string, string> = {};
    for (const device of project.devices) {
      const at = heard.get(device);
      if (at !== undefined) asOf[device] = at;
    }
    return {
      key: project.key,
      provisional: project.provisional,
      name: project.name,
      nameFrom: project.nameFrom,
      ...(project.alsoCalled !== undefined && project.alsoCalled.length > 0
        ? { alsoCalled: [...project.alsoCalled] }
        : {}),
      ...(project.disambiguation ? { disambiguation: project.disambiguation } : {}),
      ink: project.ink,
      kind: project.kind,
      // J11 (2026-10-08): Temporary is the only bucket; a desktop's Home is a
      // project (`kind: "home"`, one device) — pj2's engine emits it so, and an
      // older grouping's Home bucket reads as one here too
      bucket: project.bucket === "temp" ? "temp" : null,
      devices: [...project.devices],
      places: project.places.map((place): ProjectPlace => this.#place(place, view)),
      sessions: project.sessions,
      ...(project.firstAt !== null ? { firstAt: project.firstAt } : {}),
      ...(project.lastAt !== null ? { lastAt: project.lastAt } : {}),
      allGone: project.allGone,
      anchors: view.tailnet
        ? project.anchors.filter((anchor) => anchor.startsWith("place:"))
        : [...project.anchors],
      asOf,
      groupingVersion: indexed.snapshot.result.groupingVersion,
      // PJ-4 (H4) — the person's pin and hide, from the project's record
      ...(project.pinned === true ? { pinned: true } : {}),
      ...(project.hidden === true ? { hidden: true } : {}),
      // PJ-6 — the launch recipe on its record, when this daemon can read it
      ...recipeOf(project.recipe),
    };
  }

  #place(place: GroupedPlace, view: ProjectView): ProjectPlace {
    return {
      ref: refOf(place),
      name: baseName(place.path),
      ...(view.paths ? { path: place.path } : {}),
      class: place.class,
      ...(place.branch !== null ? { branch: place.branch } : {}),
      ...(place.worktreeOf !== null
        ? { worktreeOf: { device: place.deviceId, placeId: place.worktreeOf } }
        : {}),
      exists: place.exists,
      mounted: place.mounted,
      sessions: place.sessions,
      ...(place.lastAt !== null ? { lastAt: place.lastAt } : {}),
    };
  }

  /** Every change a page must hear: a new grouping (with its key moves) or a
   * desktop's catalog. */
  #bump(change: DoorsChange): void {
    this.#revision += 1;
    for (const move of change.moves)
      this.#moveLog.push({ revision: this.#revision, move: { from: move.from, to: move.to } });
    while (this.#moveLog.length > MOVE_LOG_MAX) {
      const dropped = this.#moveLog.shift();
      if (dropped !== undefined) this.#trimmedThrough = dropped.revision;
    }
    for (const subscriber of this.#subscribers) subscriber(change);
  }
}

/** PJ-6 — a record's recipe as a summary carries it: the contract's shape, or
 * nothing (a recipe a newer desktop wrote in a shape this one cannot read is
 * left on the record, unanswered — never a refused summary). */
function recipeOf(recipe: unknown): { recipe?: ProjectRecipe } {
  if (recipe === undefined) return {};
  const read = ProjectRecipe.safeParse(recipe);
  return read.success ? { recipe: read.data } : {};
}
