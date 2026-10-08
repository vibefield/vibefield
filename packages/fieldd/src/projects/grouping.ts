// PJ-1 — the project grouping engine (`thinking-project-places.md` §4;
// PJ-D1…D24 RULED (a) 2026-10-07; `build-pj.md` L7). A strict port of the
// prototype's `group()` under its `evidence` strategy plus the person's
// intents (`draft/project-places/grouping.js`, 511 lines; the `folder`,
// `origin` and `v1` strategies were comparisons and stay in the draft).
//
// It takes PLACES — a folder on a device, with the facts its own daemon
// observed (`PlaceFacts`) — and answers PROJECTS: groups of places joined by
// evidence (PJ-L2), never by a name:
//   E1 the identity remote (`PlaceFacts.identityRemote`);
//   E2 confirmed RECENT shared history: one place's desktop found another
//      place's sample from at most RECENT commits back in its own objects
//      (`hits`), and the two share their first-parent root;
//   E3 the person's links (and splits, which keep a place apart from the
//      project a record names — PJ-2).
// Temporary is a bucket, not a project (PJ-L4); each desktop's Home is a
// project of its own (PJ-L4 as amended, below). What evidence only
// suggests — old shared history, another remote in common, the same folder on
// two desktops, the same name — is a suggestion, one per pair of projects,
// never a merge. Records (the person's acts, PJ-2) bind to the group they
// share the most anchors with and keep its key, name and ink (PJ-L3).
//
// PJ-2 (build-pj23.md D2, D3; GROUPING_VERSION 2) — the person's intents as
// the library keeps them (projects/records-doc.ts):
//   - a SPLIT is bound to a record, `{place, notRecord}`: the place never
//     joins the side that record names (the places its `place:` anchors name,
//     less those split from it), and the record never binds to a group that
//     holds the place. It no longer takes the place out of all evidence — it
//     may still join another project, or be suggested to one;
//   - every link and split carries its act time, and for a pair the LATER act
//     wins: a link older than a split no longer re-joins the split place, and
//     a link made after the split lifts it;
//   - a dismissal binds to the PAIR OF RECORDS (§4.2), not to a suggestion id,
//     so no other reason surfaces for the same two projects; nor does any
//     suggestion between a split place and the record it was split from;
//   - a record's places acted in (D6) make those places `acted` on every
//     desktop, and its pinned and hidden ride the project it names.
//
// J11 (James, 2026-10-08 05:06; PJ-D3 AMENDED for Home only): a desktop's home
// folder, `/` and its drive roots are THAT DESKTOP'S HOME — a project like the
// others (named Home, keyed and inked by its own anchors, recorded, renamed,
// pinned), one per desktop, so two desktops' homes never join. Its places
// take part in no evidence and no suggestion: nothing links into Home or
// splits out of it. Temporary stays the one bucket.
//
// PURE: no I/O, no clock, no randomness — every daemon computes the same
// projects from the same facts (PJ-L1, DS-L4), so a change here is a lockstep
// event (GROUPING_VERSION). Where it departs from the prototype:
//   - it orders its input itself (devices by id, places by placeId): the
//     prototype took the page's order, but a daemon's replica arrives in any
//     order, and the busiest-folder name, the place a suggestion names and
//     the edge list read ties by order;
//   - the key is `projectKey` (L5: 128 bits of SHA-256, `p1:`), not the
//     prototype's 64-bit FNV, and a record-less ink comes from the same
//     digest (`provisionalInk`);
//   - a place spelled twice on one device answers to BOTH ids — a hit or a
//     link naming the second spelling reaches the place (the prototype
//     dropped it);
//   - suggestions carry what they share (`via`) instead of a sentence, and
//     no device labels: wording is the surface's.
import {
  GROUPING_VERSION,
  type PlaceFacts,
  type PlaceHit,
  PROJECT_GROUPING,
} from "@vibefield/contracts";
import { projectKey, provisionalInk } from "./normalize";
import { slashPath } from "./place-kind";

/** How recent a shared commit must be for shared history to JOIN (E2). */
export const RECENT: number = PROJECT_GROUPING.RECENT_DEPTH;

// ── the input ─────────────────────────────────────────────────────────────

/** One place with what the catalog says happened there. */
export interface GroupingPlace {
  readonly facts: PlaceFacts;
  /** sessions held for it (a session joins the place holding its cwd by the
   * longest path), and the first and last of their activity, epoch ms */
  readonly sessions?: number;
  readonly firstAt?: number;
  readonly lastAt?: number;
  /** the person acted here through VibeField (the files service's places
   * registry, by longest prefix — L7). An indexed session is not an act
   * (EL7): this never joins anything, it rides to the default-place rule */
  readonly acted?: boolean;
}

export interface GroupingDevice {
  readonly deviceId: string;
  readonly places: readonly GroupingPlace[];
}

/** The person's record of a project (PJ-2; the library holds it,
 * projects/records-doc.ts): made only by an act, holding the anchors its
 * group had at every act. */
export interface GroupingRecord {
  readonly id: string;
  /** OLDEST FIRST: a tie between two groups goes to the one holding the first */
  readonly anchors: readonly string[];
  readonly name?: string;
  /** dealt once, at the record's first act, and kept (P3: the project's
   * provisional ink at that act, frozen) */
  readonly ink?: number;
  readonly recipe?: unknown;
  readonly pinned?: boolean;
  readonly hidden?: boolean;
  /** D6 — the places the person acted in (a launch, a resume), with the
   * latest act there, epoch ms */
  readonly places?: ReadonlyArray<{ readonly placeId: string; readonly at: number }>;
  readonly createdAt: number;
}

/** E3: two places the person joined, and when (epoch ms). */
export interface GroupingLink {
  readonly a: string;
  readonly b: string;
  readonly at: number;
}

/** A place the person took out of the project a record names (§3:
 * `{place, notRecord}`), and when (epoch ms). */
export interface GroupingSplit {
  readonly place: string;
  readonly notRecord: string;
  readonly at: number;
}

export interface GroupingIntents {
  readonly links?: readonly GroupingLink[];
  readonly splits?: readonly GroupingSplit[];
  /** D3 — pairs of record ids whose projects' suggestions the person dismissed */
  readonly dismissals?: ReadonlyArray<readonly [string, string]>;
  readonly records?: readonly GroupingRecord[];
}

export interface GroupingInput {
  readonly devices: readonly GroupingDevice[];
  readonly intents?: GroupingIntents;
}

// ── the answer ────────────────────────────────────────────────────────────

/** home · temp · repo (git with an identity remote) · local (git without
 * one) · folder (no git) */
export type PlaceClass = "home" | "temp" | "repo" | "local" | "folder";
/** Temporary (PJ-L4). Home was one too until J11 (2026-10-08): now a project
 * per desktop, `kind: "home"`. */
export type ProjectBucket = "temp";

export interface GroupingEdge {
  readonly a: string;
  readonly b: string;
  readonly rule: "remote" | "history" | "linked";
  /** the remote key, the shared root, or `you` */
  readonly via: string;
  /** for `history`: how far before its tip the other place took the sample */
  readonly depth?: number;
}

export type SuggestionType = "related-history" | "shared-remote" | "same-folder" | "same-name";

export interface GroupingSuggestion {
  /** `hist:` · `rem:` · `rel:` · `name:` + the two placeIds, sorted */
  readonly id: string;
  readonly type: SuggestionType;
  readonly a: string;
  readonly b: string;
  /** the root, the remote, the home-relative folder or the name in common */
  readonly via: string;
}

export interface GroupedPlace {
  readonly placeId: string;
  readonly deviceId: string;
  readonly path: string;
  /** the folder's other spellings, and the placeIds that named them */
  readonly aliases: readonly string[];
  readonly aliasIds: readonly string[];
  readonly class: PlaceClass;
  readonly branch: string | null;
  readonly exists: boolean;
  readonly mounted: boolean;
  readonly sessions: number;
  readonly lastAt: number | null;
  readonly remote: string | null;
  readonly worktreeOf: string | null;
  readonly acted: boolean;
}

export interface GroupedProject {
  /** `r:<record id>` once a record binds, else a provisional `p1:` key */
  key: string;
  provisional: boolean;
  /** `root:<sha>` · `remote:<key>` · `place:<placeId>`, sorted */
  readonly anchors: readonly string[];
  name: string;
  /** `home`: a desktop's Home, named so by the engine (J11) */
  nameFrom: "bucket" | "home" | "folder" | "repository" | "you";
  /** the deal index of the project's ink (§4.3) */
  ink: number;
  readonly kind: PlaceClass;
  readonly bucket: ProjectBucket | null;
  /** newest first */
  readonly places: readonly GroupedPlace[];
  readonly devices: readonly string[];
  readonly sessions: number;
  readonly firstAt: number | null;
  readonly lastAt: number | null;
  readonly allGone: boolean;
  readonly edges: readonly GroupingEdge[];
  /** two projects that read alike: the first place's parent folder */
  disambiguation?: string | null;
  alsoCalled?: string[];
  recordId?: string;
  recipe?: unknown;
  /** the naming record's (PJ-2) */
  pinned?: boolean;
  hidden?: boolean;
}

export interface GroupingResult {
  readonly groupingVersion: number;
  /** newest first; Temporary (the bucket) is a row like any other */
  readonly projects: readonly GroupedProject[];
  readonly suggestions: readonly GroupingSuggestion[];
  readonly edges: readonly GroupingEdge[];
}

// ── the engine ────────────────────────────────────────────────────────────

interface Place {
  readonly i: number;
  readonly id: string;
  readonly deviceId: string;
  readonly facts: PlaceFacts;
  readonly input: GroupingPlace;
  readonly cls: PlaceClass;
  readonly idRemote: string | null;
  readonly otherRemotes: readonly string[];
  readonly root: string | null;
  readonly hits: readonly PlaceHit[];
  readonly rel: string | null;
  readonly aliases: string[];
  readonly aliasIds: string[];
  extraSessions: number;
  extraLast: number;
}

type EdgeWhy = Omit<GroupingEdge, "a" | "b">;

const baseName = (path: string): string => slashPath(path).split("/").pop() ?? "";
const repoBase = (key: string): string => key.split("/").pop() ?? key;
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const pairId = (a: string, b: string): string => [a, b].sort(byString).join("|");

/** home · temp (a task folder whatever its git; a temp folder unless it
 * holds a real clone) · repo · local · folder — the prototype's `kindOf`
 * over facts its owner already classified (L6). */
function classOf(facts: PlaceFacts, idRemote: string | null): PlaceClass {
  if (facts.kind === "home") return "home";
  if (facts.kind === "task") return "temp";
  if (facts.git) {
    if (idRemote !== null) return "repo";
    return facts.kind === "temp" ? "temp" : "local";
  }
  return facts.kind === "temp" ? "temp" : "folder";
}

function makeUnionFind(n: number): {
  find: (i: number) => number;
  union: (a: number, b: number) => boolean;
} {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    const p = parent[i]!;
    if (p === i) return i;
    const root = find(p);
    parent[i] = root;
    return root;
  };
  const union = (a: number, b: number): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    return ra !== rb;
  };
  return { find, union };
}

export function groupPlaces(input: GroupingInput): GroupingResult {
  const intents = input.intents ?? {};

  // one place per canonical path per device (a path spelled twice is one
  // place with aliases), in an order every daemon agrees on
  const devices = [...input.devices].sort((a, b) => byString(a.deviceId, b.deviceId));
  const P: Place[] = [];
  const byId = new Map<string, Place>();
  const seen = new Map<string, Place>();
  for (const device of devices) {
    const places = [...device.places].sort((a, b) => byString(a.facts.placeId, b.facts.placeId));
    for (const input of places) {
      const facts = input.facts;
      const path = slashPath(facts.path);
      const canonical = `${device.deviceId}:${facts.caseless ? path.toLowerCase() : path}`;
      const dup = seen.get(canonical);
      if (dup !== undefined) {
        dup.aliases.push(facts.path, ...facts.aliases);
        dup.aliasIds.push(facts.placeId);
        dup.extraSessions += input.sessions || 0;
        dup.extraLast = Math.max(dup.extraLast, input.lastAt || 0);
        if (!byId.has(facts.placeId)) byId.set(facts.placeId, dup);
        continue;
      }
      // a placeId is unique across the mesh; a second claimant is not a place
      if (byId.has(facts.placeId)) continue;
      const idRemote =
        facts.git &&
        facts.identityRemote !== undefined &&
        !facts.identityRemote.startsWith("local:")
          ? facts.identityRemote
          : null;
      const all = facts.git ? [...new Set(facts.remotes)] : [];
      const x: Place = {
        i: P.length,
        id: facts.placeId,
        deviceId: device.deviceId,
        facts,
        input,
        cls: classOf(facts, idRemote),
        idRemote,
        otherRemotes: all.filter((r) => !r.startsWith("local:") && r !== idRemote),
        root: facts.git && facts.root !== undefined ? facts.root : null,
        hits: facts.hits,
        rel: facts.homeRelative !== undefined ? slashPath(facts.homeRelative).toLowerCase() : null,
        aliases: [...facts.aliases],
        aliasIds: [],
        extraSessions: 0,
        extraLast: 0,
      };
      seen.set(canonical, x);
      P.push(x);
      byId.set(x.id, x);
    }
  }

  const uf = makeUnionFind(P.length);
  const edges: GroupingEdge[] = [];
  const link = (a: Place, b: Place, why: EdgeWhy): void => {
    if (uf.union(a.i, b.i)) edges.push({ a: a.id, b: b.id, ...why });
  };
  const bucketOf = (x: Place): ProjectBucket | null => (x.cls === "temp" ? x.cls : null);
  /** Temporary, and each desktop's Home (J11), join nothing by evidence */
  const out = (x: Place): boolean => bucketOf(x) !== null || x.cls === "home";

  // PJ-2 (D2) — the splits that bind: each keeps its place apart from the
  // SIDE its record names, the places the record's `place:` anchors name
  // less those split from it. A split whose place or record is unknown here
  // keeps nothing apart (yet).
  const records = intents.records ?? [];
  const recordIds = new Set(records.map((r) => r.id));
  const active = new Set(
    (intents.splits ?? []).filter((s) => byId.has(s.place) && recordIds.has(s.notRecord)),
  );
  const splitFrom = new Map<string, Set<Place>>();
  for (const s of active) {
    const held = splitFrom.get(s.notRecord) ?? new Set<Place>();
    held.add(byId.get(s.place)!);
    splitFrom.set(s.notRecord, held);
  }
  const sides = new Map<string, Place[]>();
  for (const r of records) {
    const side = new Set<Place>();
    for (const anchor of r.anchors) {
      if (!anchor.startsWith("place:")) continue;
      const x = byId.get(anchor.slice("place:".length));
      if (x !== undefined && !splitFrom.get(r.id)?.has(x)) side.add(x);
    }
    sides.set(r.id, [...side]);
  }
  const splitPlaces = new Set([...active].map((s) => byId.get(s.place)!));
  /** the active splits a union of a's and b's groups would break */
  const breaks = (a: Place, b: Place): GroupingSplit[] => {
    const ra = uf.find(a.i);
    const rb = uf.find(b.i);
    if (ra === rb) return [];
    const broken: GroupingSplit[] = [];
    for (const s of active) {
      const rp = uf.find(byId.get(s.place)!.i);
      if (rp !== ra && rp !== rb) continue;
      const other = rp === ra ? rb : ra;
      if (sides.get(s.notRecord)?.some((x) => uf.find(x.i) === other)) broken.push(s);
    }
    return broken;
  };
  // evidence never breaks a split; an edge touching a split place waits for
  // every other, so the place is the one left out, not its neighbours
  const first: Array<[Place, Place, EdgeWhy]> = [];
  const deferred: Array<[Place, Place, EdgeWhy]> = [];
  const evidence = (a: Place, b: Place, why: EdgeWhy): void => {
    (splitPlaces.has(a) || splitPlaces.has(b) ? deferred : first).push([a, b, why]);
  };

  // E1 the identity remote (through a member no split names, so the rest
  // still join one another when the split place cannot)
  const byRemote = new Map<string, Place[]>();
  for (const x of P) {
    if (out(x) || x.idRemote === null) continue;
    const xs = byRemote.get(x.idRemote);
    if (xs === undefined) byRemote.set(x.idRemote, [x]);
    else xs.push(x);
  }
  for (const [key, xs] of byRemote) {
    const hub = xs.find((x) => !splitPlaces.has(x)) ?? xs[0]!;
    for (const x of xs) if (x !== hub) evidence(hub, x, { rule: "remote", via: key });
  }

  // E2 confirmed RECENT shared history: one place's desktop found another
  // place's recent commit in its own objects, and the two share a root
  for (const x of P) {
    if (out(x)) continue;
    for (const hit of x.hits) {
      const y = byId.get(hit.placeId);
      if (y === undefined || out(y) || x.root === null || x.root !== y.root) continue;
      if (hit.depth <= RECENT) evidence(x, y, { rule: "history", via: x.root, depth: hit.depth });
    }
  }
  const heldBack: Array<[Place, Place, EdgeWhy]> = [];
  for (const edge of [...first, ...deferred]) {
    if (breaks(edge[0], edge[1]).length > 0) heldBack.push(edge);
    else link(...edge);
  }

  // what evidence only suggests: shared history far back or at the root
  // alone; another remote in common
  const suggestions: GroupingSuggestion[] = [];
  const suggest = (type: SuggestionType, prefix: string, a: Place, b: Place, via: string) => {
    suggestions.push({ id: `${prefix}:${pairId(a.id, b.id)}`, type, a: a.id, b: b.id, via });
  };
  const byRoot = new Map<string, Place[]>();
  for (const x of P) {
    if (x.root === null || out(x)) continue;
    const xs = byRoot.get(x.root);
    if (xs === undefined) byRoot.set(x.root, [x]);
    else xs.push(x);
  }
  for (const [sha, xs] of byRoot) {
    for (let a = 0; a < xs.length; a++) {
      for (let b = a + 1; b < xs.length; b++) {
        const A = xs[a]!;
        const B = xs[b]!;
        if (uf.find(A.i) === uf.find(B.i)) continue;
        suggest("related-history", "hist", A, B, sha);
      }
    }
  }
  const byOther = new Map<string, Set<Place>>();
  for (const x of P) {
    if (out(x)) continue;
    for (const r of x.idRemote === null ? x.otherRemotes : [...x.otherRemotes, x.idRemote]) {
      const set = byOther.get(r);
      if (set === undefined) byOther.set(r, new Set([x]));
      else set.add(x);
    }
  }
  for (const [remote, set] of byOther) {
    const xs = [...set];
    for (let a = 0; a < xs.length; a++) {
      for (let b = a + 1; b < xs.length; b++) {
        const A = xs[a]!;
        const B = xs[b]!;
        if (uf.find(A.i) === uf.find(B.i)) continue;
        suggest("shared-remote", "rem", A, B, remote);
      }
    }
  }

  // E3 the person's links, in the order they were made: one that would
  // break a split made LATER is not taken (the split is the later word); one
  // made after the split lifts it, and the evidence it held back is retried
  const links = [...(intents.links ?? [])].sort(
    (x, y) => x.at - y.at || byString(x.a, y.a) || byString(x.b, y.b),
  );
  let lifted = false;
  for (const l of links) {
    const A = byId.get(l.a);
    const B = byId.get(l.b);
    if (A === undefined || B === undefined) continue;
    const broken = breaks(A, B);
    if (broken.some((s) => s.at >= l.at)) continue;
    for (const s of broken) active.delete(s);
    lifted ||= broken.length > 0;
    link(A, B, { rule: "linked", via: "you" });
  }
  if (lifted) for (const edge of heldBack) if (breaks(edge[0], edge[1]).length === 0) link(...edge);

  // gather: the bucket, each desktop's Home, then each union
  const groups = new Map<string, Place[]>();
  for (const x of P) {
    const bucket = bucketOf(x);
    const key =
      bucket !== null
        ? `bucket:${bucket}`
        : x.cls === "home"
          ? `home:${x.deviceId}`
          : `uf:${uf.find(x.i)}`;
    const xs = groups.get(key);
    if (xs === undefined) groups.set(key, [x]);
    else xs.push(x);
  }
  const groupOf = new Map<string, string>();
  for (const [key, xs] of groups) for (const x of xs) groupOf.set(x.id, key);

  // suggestions that do not depend on git: the same home-relative folder on
  // two desktops; the same name where one side is a plain folder
  const folders = P.filter((x) => x.cls === "folder" || x.cls === "local");
  for (let a = 0; a < folders.length; a++) {
    for (let b = a + 1; b < folders.length; b++) {
      const A = folders[a]!;
      const B = folders[b]!;
      if (A.deviceId === B.deviceId || A.rel === null || A.rel !== B.rel) continue;
      if (groupOf.get(A.id) === groupOf.get(B.id)) continue;
      suggest("same-folder", "rel", A, B, A.rel);
    }
  }
  const byName = new Map<string, Place[]>();
  for (const x of P) {
    if (out(x)) continue;
    const name = baseName(x.facts.path).toLowerCase();
    const xs = byName.get(name);
    if (xs === undefined) byName.set(name, [x]);
    else xs.push(x);
  }
  for (const [name, xs] of byName) {
    for (let a = 0; a < xs.length; a++) {
      for (let b = a + 1; b < xs.length; b++) {
        const A = xs[a]!;
        const B = xs[b]!;
        if (groupOf.get(A.id) === groupOf.get(B.id)) continue;
        if (A.cls !== "folder" && B.cls !== "folder") continue;
        if ((A.rel !== null && A.rel === B.rel) || !A.facts.exists || !B.facts.exists) continue;
        suggest("same-name", "name", A, B, name);
      }
    }
  }

  // D6 — a place a record says the person acted in is acted everywhere
  const actedByRecord = new Set<Place>();
  for (const r of records) {
    for (const at of r.places ?? []) {
      const x = byId.get(at.placeId);
      if (x !== undefined) actedByRecord.add(x);
    }
  }

  // shape each project
  const projects: GroupedProject[] = [];
  const projectOf = new Map<string, GroupedProject>();
  const identities: string[] = [];
  for (const [key, xs] of groups) {
    const bucket: ProjectBucket | null = key.startsWith("bucket:")
      ? (key.slice("bucket:".length) as ProjectBucket)
      : null;
    const home = key.startsWith("home:");
    xs.sort((a, b) => (b.input.lastAt || 0) - (a.input.lastAt || 0));
    const anchors = new Set<string>();
    for (const x of xs) {
      if (x.root !== null) anchors.add(`root:${x.root}`);
      if (x.idRemote !== null) anchors.add(`remote:${x.idRemote}`);
      anchors.add(`place:${x.id}`);
    }
    const anyRepo = xs.find((x) => x.cls === "repo");
    const anyGit = xs.find((x) => x.cls === "repo" || x.cls === "local");
    const busiest = [...xs].sort((a, b) => (b.input.sessions || 0) - (a.input.sessions || 0))[0]!;
    const earliest = [...xs].sort(
      (a, b) =>
        (a.input.firstAt || Infinity) - (b.input.firstAt || Infinity) ||
        baseName(a.facts.path).length - baseName(b.facts.path).length,
    )[0]!;
    let name: string;
    let nameFrom: GroupedProject["nameFrom"];
    if (home) [name, nameFrom] = ["Home", "home"];
    else if (bucket === "temp") [name, nameFrom] = ["Temporary", "bucket"];
    else if (anyRepo !== undefined && anyRepo.idRemote !== null) {
      // the repository's name, spelled like its busiest folder when they are
      // the same word (`vibe-field` for `vibefield`)
      const repoName = repoBase(anyRepo.idRemote);
      const folder = baseName(busiest.facts.path);
      const word = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      [name, nameFrom] =
        word(folder) === word(repoName) ? [folder, "folder"] : [repoName, "repository"];
    } else [name, nameFrom] = [baseName(earliest.facts.path) || earliest.facts.path, "folder"];

    const firstAt = Math.min(...xs.map((x) => x.input.firstAt || Infinity));
    projects.push({
      key: "",
      provisional: true,
      anchors: [...anchors].sort(byString),
      name,
      nameFrom,
      ink: 0,
      kind:
        bucket ??
        (home
          ? "home"
          : anyRepo !== undefined
            ? "repo"
            : anyGit !== undefined
              ? "local"
              : "folder"),
      bucket,
      places: xs.map(
        (x): GroupedPlace => ({
          placeId: x.id,
          deviceId: x.deviceId,
          path: x.facts.path,
          aliases: x.aliases,
          aliasIds: x.aliasIds,
          class: x.cls,
          branch: x.facts.git ? (x.facts.branch ?? null) : null,
          exists: x.facts.exists,
          mounted: x.facts.mounted,
          sessions: (x.input.sessions || 0) + x.extraSessions,
          lastAt: Math.max(x.input.lastAt || 0, x.extraLast) || null,
          remote: x.idRemote,
          worktreeOf: x.facts.worktreeOf ?? null,
          acted: x.input.acted === true || actedByRecord.has(x),
        }),
      ),
      devices: [...new Set(xs.map((x) => x.deviceId))],
      sessions: xs.reduce((n, x) => n + (x.input.sessions || 0) + x.extraSessions, 0),
      firstAt: Number.isFinite(firstAt) ? firstAt : null,
      lastAt: Math.max(0, ...xs.map((x) => x.input.lastAt || 0)) || null,
      allGone: xs.every((x) => !x.facts.exists),
      edges: edges.filter((e) => xs.some((x) => x.id === e.a)),
    });
    projectOf.set(key, projects.at(-1)!);
    identities.push(bucket !== null ? `bucket:${bucket}` : "");
  }

  // A record-less group's provisional identity: its strongest anchor no
  // other group holds (a first commit outlives a remote, a remote outlives a
  // folder), the smallest of that kind; a place anchor is always its own. So
  // moving or deleting one clone leaves the key and the ink alone, and two
  // groups that share only old history never share a key.
  const held = new Map<string, number>();
  for (const p of projects) for (const a of p.anchors) held.set(a, (held.get(a) ?? 0) + 1);
  const weight = (a: string): number =>
    a.startsWith("root:") ? 0 : a.startsWith("remote:") ? 1 : 2;
  projects.forEach((p, n) => {
    const identity =
      identities[n] ||
      p.anchors
        .filter((a) => held.get(a) === 1)
        .sort((a, b) => weight(a) - weight(b) || byString(a, b))[0]!;
    p.key = projectKey(identity);
    p.ink = provisionalInk(identity);
  });
  // a record never binds where a place still split from it stands
  const excluded = new Map<string, Set<string>>();
  for (const s of active) {
    const ids = excluded.get(s.notRecord) ?? new Set<string>();
    const x = byId.get(s.place)!;
    for (const id of [x.id, ...x.aliasIds]) ids.add(id);
    excluded.set(s.notRecord, ids);
  }
  const bound = bindRecords(projects, records, excluded);

  // one suggestion per pair of projects; none where the person dismissed the
  // pair (D3: bound to the pair of records, so no next reason surfaces) or
  // split one from the other
  const dismissed = new Set((intents.dismissals ?? []).map(([a, b]) => pairId(a, b)));
  const apart = (a: GroupedProject, b: GroupedProject): boolean => {
    const ra = bound.get(a) ?? [];
    const rb = bound.get(b) ?? [];
    if (ra.some((x) => rb.some((y) => dismissed.has(pairId(x, y))))) return true;
    for (const s of active) {
      const at = groupOf.get(byId.get(s.place)!.id);
      const of = at === undefined ? undefined : projectOf.get(at);
      if ((of === a && rb.includes(s.notRecord)) || (of === b && ra.includes(s.notRecord)))
        return true;
    }
    return false;
  };
  const seenPairs = new Set<string>();
  const liveSuggestions: GroupingSuggestion[] = [];
  for (const s of suggestions) {
    const ga = groupOf.get(s.a);
    const gb = groupOf.get(s.b);
    if (ga === undefined || gb === undefined || ga === gb) continue;
    const pair = pairId(ga, gb);
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    if (apart(projectOf.get(ga)!, projectOf.get(gb)!)) continue;
    liveSuggestions.push(s);
  }

  projects.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  const byShown = new Map<string, GroupedProject[]>();
  for (const p of projects) {
    // a desktop's Home is told apart by its desktop (PJ-D24), not a folder
    if (p.kind === "home") continue;
    const shown = p.name.toLowerCase();
    const ps = byShown.get(shown);
    if (ps === undefined) byShown.set(shown, [p]);
    else ps.push(p);
  }
  for (const ps of byShown.values()) {
    if (ps.length < 2) continue;
    for (const p of ps) {
      p.disambiguation = slashPath(p.places[0]!.path).split("/").slice(-2, -1)[0] || null;
    }
  }
  return { groupingVersion: GROUPING_VERSION, projects, suggestions: liveSuggestions, edges };
}

/** A record is the person's: made only by an act (a launch, a name, a link, a
 * pin), it carries the anchors of its group at every act. Each record binds
 * to the group it shares the most anchors with (a first commit 4, a remote 2,
 * a place 1); on a tie, the group holding its oldest anchor — but never to a
 * group holding a place split from it (`excluded`, PJ-2). The oldest record
 * on a group keys and inks it; the oldest NAMED one names it (PJ-2), the
 * other names read "also called", and an unnamed record adds no word. Nothing is deleted, so a split gives each record back its side.
 * Answers the records each project took, its naming one first. */
export function bindRecords(
  projects: GroupedProject[],
  records: readonly GroupingRecord[],
  excluded: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): Map<GroupedProject, string[]> {
  const weight = (a: string): number =>
    a.startsWith("root:") ? 4 : a.startsWith("remote:") ? 2 : 1;
  const sorted = [...records].sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || byString(a.id, b.id),
  );
  const bound = new Map<GroupedProject, string[]>();
  for (const r of sorted) {
    let best: GroupedProject | null = null;
    let bestScore = 0;
    const oldest = r.anchors[0];
    const apart = excluded.get(r.id);
    for (const p of projects) {
      if (p.bucket !== null) continue;
      if (apart !== undefined && p.places.some((pl) => apart.has(pl.placeId))) continue;
      const has = new Set(p.anchors);
      const score = r.anchors.reduce((n, a) => n + (has.has(a) ? weight(a) : 0), 0);
      const tieOld =
        best !== null &&
        score === bestScore &&
        oldest !== undefined &&
        has.has(oldest) &&
        !best.anchors.includes(oldest);
      if (score > bestScore || tieOld) {
        best = p;
        bestScore = score;
      }
    }
    if (best === null) continue;
    bound.set(best, [...(bound.get(best) ?? []), r.id]);
    if (best.recordId !== undefined) {
      // PJ-2: a name the person gave beats one the engine derived, so under
      // an unnamed oldest record (two desktops' first acts at once) the
      // oldest NAMED record names the group; any later name is also called
      if (r.name && best.nameFrom !== "you") [best.name, best.nameFrom] = [r.name, "you"];
      else if (r.name) best.alsoCalled = [...(best.alsoCalled ?? []), r.name];
      continue;
    }
    best.recordId = r.id;
    best.key = `r:${r.id}`;
    best.provisional = false;
    if (r.name) [best.name, best.nameFrom] = [r.name, "you"];
    if (r.ink !== undefined) best.ink = r.ink;
    if (r.recipe !== undefined) best.recipe = r.recipe;
    if (r.pinned === true) best.pinned = true;
    if (r.hidden === true) best.hidden = true;
  }
  return bound;
}
