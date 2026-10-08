import { createHash } from "node:crypto";
import type { IndexCatalogProject, IndexCatalogSession, PlaceFacts } from "@vibefield/contracts";
import { PLACE_FACTS } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import {
  type GroupingDevice,
  type GroupingIntents,
  type GroupingPlace,
  type GroupingResult,
  groupPlaces,
} from "./grouping";
import type { KeyJournal, KeyMove } from "./key-journal";
import { slashPath } from "./place-kind";

// PJ-1 §4 (`thinking-project-places.md` §9; PJ-D20 (a): the engine runs in
// fieldd) — the PROJECTS this desktop computes: the grouping engine
// (grouping.ts, pure) run over every place this desktop knows — its own, off
// its catalog's project rows (the place scanner's facts), and every peer's,
// off the mesh replica (index-mesh.ts) — with what the catalog says happened
// there: each session joins the place that holds its cwd by the LONGEST path
// (else a worktree place shows 0 sessions), and a local place the person
// acted in through VibeField (the files service's registry, L7) says so.
//
// Every daemon computes the same projects from the same facts (PJ-L1, DS-L4):
// a peer's place rides its row as its owner published it, and nothing here
// edits one. The result is HELD for PJ-3's `project.*` doors (`current()`,
// project-doors.ts), and a change of the grouping itself (which places form
// which project, the suggestions) says ONE summary line; a recompute that
// changes only a figure (a session's activity) is silent. No path, no remote
// and no name reaches the line (EL7). PJ-3 (D9): each change of the grouping
// is diffed into the key memory (key-journal.ts), so a key that moved answers
// `movedTo`, and every new grouping is heard by the doors' pings
// (`onChange`), with the moves it made.
//
// PJ-2 (build-pj23.md D4) — the person's records and intents reach the engine:
// read through a late-bound getter (this is built before the daemon mounts
// the library, which re-mounts on a relink), folded into the input digest, and
// followed — the library's `changed`, local or merged from a peer, regroups.
// A project's first record re-keys it (`p1:` → `r:`), a change of the
// grouping like any, so the key memory journals it.

/** A table as the grouping reads it (CatalogTable's surface). */
export interface GroupingTable<Row> {
  rows(): readonly Row[];
  onDelta(listener: () => void): () => void;
}

export interface ProjectGroupsOptions {
  /** this desktop's roster id, read at every regroup. Errata (PJ-2 §0,
   * 2026-10-08): it does not move "at most once" — the mesh ULID supersedes
   * the local fallback at every link and is minted anew at a relink — so a
   * place is never keyed by it (place-scanner.ts `deviceId`); here it only
   * names which device's places are this desktop's. */
  deviceId: () => string;
  /** this desktop's catalog: its project rows carry its places */
  local: {
    projects: GroupingTable<IndexCatalogProject>;
    sessions: GroupingTable<IndexCatalogSession>;
  };
  /** every PEER's replicated rows (IndexMesh.peerRows) */
  peers?: () => ReadonlyArray<{
    device: string;
    projects: readonly IndexCatalogProject[];
    sessions: readonly IndexCatalogSession[];
  }>;
  /** the local places the person acted in (PlaceScanner.acted): by placeId */
  acted?: () => ReadonlyMap<string, unknown>;
  /** PJ-3 (D9) — the key memory each change of the grouping is diffed into,
   * so a key that moved answers `movedTo` (persisted by the daemon) */
  journal?: KeyJournal;
  /** PJ-2 (D4) — the library's records and intents; null while none is mounted */
  intents?: () => GroupingIntents | null;
  /** test seam (default PLACE_FACTS.REGROUP_SETTLE_MS) */
  settleMs?: number;
  now?: () => number;
  logger?: Logger;
}

/** What follows the library's changes (LibraryDocService's surface). */
export interface IntentsSource {
  on(event: "changed", listener: () => void): unknown;
  off(event: "changed", listener: () => void): unknown;
}

/** What the grouping holds: the result, when, and of which input. */
export interface ProjectGroupsSnapshot {
  readonly result: GroupingResult;
  /** epoch ms of the computation */
  readonly at: number;
  /** equal inputs, equal result (the engine is pure) */
  readonly inputDigest: string;
  /** the grouping itself: which places form each project, the suggestions */
  readonly shapeDigest: string;
  /** PJ-3 — the places it grouped, per device (a session's place is read
   * against these by the same longest-path rule, `placeResolver`) */
  readonly devices: readonly GroupingDevice[];
}

/** PJ-3 — what a new grouping tells a listener: the snapshot, and the key
 * moves the journal inferred from it (empty when nothing moved). */
export interface ProjectGroupsChange {
  readonly snapshot: ProjectGroupsSnapshot;
  readonly moves: readonly KeyMove[];
}

interface Activity {
  sessions: number;
  firstAt: number | undefined;
  lastAt: number | undefined;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

/** The places a device's rows carry, one per placeId (two of its rosetta
 * projects can name one folder: the first row's place stands). */
function placesOf(rows: readonly IndexCatalogProject[]): PlaceFacts[] {
  const seen = new Map<string, PlaceFacts>();
  for (const row of rows)
    for (const place of row.places ?? [])
      if (!seen.has(place.placeId)) seen.set(place.placeId, place);
  return [...seen.values()];
}

/** §9 — a session joins the place that holds its cwd by the LONGEST path:
 * every spelling of a place (its path and its aliases) is a prefix, matched
 * without case on a caseless volume. A cwd no place holds joins none. */
export function sessionsByPlace(
  places: readonly PlaceFacts[],
  sessions: readonly IndexCatalogSession[],
): Map<string, Activity> {
  const placeOf = placeResolver(places);
  const out = new Map<string, Activity>();
  for (const session of sessions) {
    if (typeof session.cwd !== "string" || session.cwd.length === 0) continue;
    const placeId = placeOf(session.cwd);
    if (placeId === undefined) continue;
    const first = session.activity?.firstAt ?? session.startedAt;
    const last = session.activity?.lastAt ?? session.updatedAt;
    const held = out.get(placeId) ?? { sessions: 0, firstAt: undefined, lastAt: undefined };
    held.sessions += 1;
    if (first !== undefined && (held.firstAt === undefined || first < held.firstAt))
      held.firstAt = first;
    if (last !== undefined && (held.lastAt === undefined || last > held.lastAt)) held.lastAt = last;
    out.set(placeId, held);
  }
  return out;
}

/** The longest-path rule as a lookup over one device's places: a cwd → the
 * placeId of the place that holds it, or undefined (PJ-3's `project.sessions`
 * reads a session's place with it). */
export function placeResolver(places: readonly PlaceFacts[]): (cwd: string) => string | undefined {
  const exact = new Map<string, string>();
  const folded = new Map<string, string>();
  for (const place of places) {
    for (const spelling of [place.path, ...place.aliases]) {
      const key = slashPath(spelling);
      if (place.caseless) {
        if (!folded.has(key.toLowerCase())) folded.set(key.toLowerCase(), place.placeId);
      } else if (!exact.has(key)) exact.set(key, place.placeId);
    }
  }
  return (cwd: string): string | undefined => {
    let at = slashPath(cwd);
    for (;;) {
      const placeId = exact.get(at) ?? folded.get(at.toLowerCase());
      if (placeId !== undefined || at === "/" || /^[A-Za-z]:$/.test(at)) return placeId;
      const cut = at.lastIndexOf("/");
      if (cut < 0) return undefined;
      at = cut === 0 ? "/" : at.slice(0, cut);
    }
  };
}

/** One device's grouping input, in an order every reader agrees on. */
function deviceInput(
  deviceId: string,
  rows: readonly IndexCatalogProject[],
  sessions: readonly IndexCatalogSession[],
  acted: ReadonlyMap<string, unknown> | null,
): GroupingDevice {
  const places = placesOf(rows).sort((a, b) => byString(a.placeId, b.placeId));
  const activity = sessionsByPlace(places, sessions);
  return {
    deviceId,
    places: places.map((facts): GroupingPlace => {
      const held = activity.get(facts.placeId);
      return {
        facts,
        ...(held !== undefined ? { sessions: held.sessions } : {}),
        ...(held?.firstAt !== undefined ? { firstAt: held.firstAt } : {}),
        ...(held?.lastAt !== undefined ? { lastAt: held.lastAt } : {}),
        ...(acted?.has(facts.placeId) ? { acted: true } : {}),
      };
    }),
  };
}

/** The partition and the suggestions: what a regroup changes. */
function shapeOf(result: GroupingResult): unknown {
  return {
    projects: result.projects
      .map((project) => [project.key, project.places.map((place) => place.placeId).sort(byString)])
      .sort((a, b) => byString(String(a[0]), String(b[0]))),
    suggestions: result.suggestions.map((s) => s.id).sort(byString),
  };
}

export class ProjectGroups {
  readonly #opts: ProjectGroupsOptions;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #settleMs: number;
  #current: ProjectGroupsSnapshot | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #off: Array<() => void> = [];
  #offLibrary: (() => void) | null = null;
  #started = false;
  #disposed = false;
  #computed = 0;
  readonly #listeners = new Set<(change: ProjectGroupsChange) => void>();

  constructor(opts: ProjectGroupsOptions) {
    this.#opts = opts;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "project_groups" });
    this.#now = opts.now ?? Date.now;
    this.#settleMs = opts.settleMs ?? PLACE_FACTS.REGROUP_SETTLE_MS;
  }

  /** Follow this desktop's tables; the daemon adds the peers' and the acts'. */
  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    const soon = () => this.regroupSoon();
    this.#off = [this.#opts.local.projects.onDelta(soon), this.#opts.local.sessions.onDelta(soon)];
    this.regroupSoon();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const off of this.#off) off();
    this.#off = [];
    this.#offLibrary?.();
    this.#offLibrary = null;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** D4 — follow this library's changes (both origins); a relink hands the
   * re-mounted library here and the old one is no longer heard. */
  followLibrary(library: IntentsSource | null): void {
    this.#offLibrary?.();
    this.#offLibrary = null;
    if (library !== null && !this.#disposed) {
      const soon = () => this.regroupSoon();
      library.on("changed", soon);
      this.#offLibrary = () => library.off("changed", soon);
    }
    this.regroupSoon();
  }

  /** What PJ-3's doors will answer from (null before the first regroup). */
  current(): ProjectGroupsSnapshot | null {
    return this.#current;
  }

  /** PJ-3 — hear every new grouping (a figure moving included) and the key
   * moves it made; the doors' pings ride it. */
  onChange(listener: (change: ProjectGroupsChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** PJ-3 (D9) — where a key no project holds went, or undefined. */
  movedTo(key: string): string | undefined {
    const projects = this.#current?.result.projects ?? [];
    return this.#opts.journal?.movedTo(key, (to) => projects.some((p) => p.key === to));
  }

  /** Computations so far (a witness: an unchanged input computes nothing). */
  get computed(): number {
    return this.#computed;
  }

  /** Regroup after the settle: a burst of changes is one computation. */
  regroupSoon(): void {
    if (this.#disposed || !this.#started || this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.regroupNow();
    }, this.#settleMs);
    this.#timer.unref?.();
  }

  /** The engine over every place this desktop knows, now. An input equal to
   * the last one's is not computed again. */
  regroupNow(): ProjectGroupsSnapshot | null {
    if (this.#disposed) return this.#current;
    const self = this.#opts.deviceId();
    const devices: GroupingDevice[] = [
      deviceInput(
        self,
        this.#opts.local.projects.rows(),
        this.#opts.local.sessions.rows(),
        this.#opts.acted?.() ?? null,
      ),
    ];
    for (const peer of this.#opts.peers?.() ?? [])
      if (peer.device !== self)
        devices.push(deviceInput(peer.device, peer.projects, peer.sessions, null));
    devices.sort((a, b) => byString(a.deviceId, b.deviceId));
    const intents = this.#opts.intents?.() ?? null;
    const input = {
      devices: devices.filter((device) => device.places.length > 0),
      ...(intents !== null ? { intents } : {}),
    };
    const inputDigest = digest(input);
    if (this.#current?.inputDigest === inputDigest) return this.#current;
    const started = this.#now();
    const result = groupPlaces(input);
    this.#computed += 1;
    const shapeDigest = digest(shapeOf(result));
    const before = this.#current;
    this.#current = { result, at: started, inputDigest, shapeDigest, devices: input.devices };
    // D9 — a change of the grouping is diffed into the key memory
    const moves =
      before?.shapeDigest !== shapeDigest
        ? (this.#opts.journal?.observe(
            result.projects.map((project) => ({
              key: project.key,
              placeIds: project.places.flatMap((place) => [place.placeId, ...place.aliasIds]),
            })),
          ) ?? [])
        : [];
    if (before?.shapeDigest !== shapeDigest) {
      const buckets: Record<string, number> = {};
      for (const project of result.projects)
        if (project.bucket !== null) buckets[project.bucket] = project.places.length;
      const listed = result.projects.filter((project) => project.bucket === null);
      this.#logger.info("fieldd.projects.regrouped", "Projects regrouped", {
        groupingVersion: result.groupingVersion,
        devices: input.devices.length,
        places: input.devices.reduce((n, device) => n + device.places.length, 0),
        rows: result.projects.length,
        acrossDevices: listed.filter((project) => project.devices.length > 1).length,
        homePlaces: buckets["home"] ?? 0,
        tempPlaces: buckets["temp"] ?? 0,
        suggestions: result.suggestions.length,
        moved: moves.length,
        records: intents?.records?.length ?? 0,
        ms: this.#now() - started,
      });
    }
    const change: ProjectGroupsChange = { snapshot: this.#current, moves };
    for (const listener of this.#listeners) {
      try {
        listener(change);
      } catch (error) {
        this.#logger.warn("fieldd.projects.listener_failed", "A projects listener failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return this.#current;
  }
}
