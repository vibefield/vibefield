import { z } from "zod";
import { AgentProviderId, IndexCatalogSession, IndexCatalogSource } from "./agent-index";
import { PROJECT_DOORS } from "./registries";
import { RowsSubscribeParams, rowsDelta, rowsOpen } from "./rows";

// PJ-3 — THE `project.*` DOORS (`thinking-project-places.md` §9; PJ-D15 (a)
// RULED 2026-10-07; `build-pj23.md` D8–D10; P1 and P2 RULED (a) 2026-10-08).
// A project is a set of places (PJ-L1) that every daemon groups the same way
// over every self desktop's place facts (fieldd `projects/grouping.ts`); these
// are the shapes a window and the person's phone read it through:
//
//   project.list      a page of projects, newest activity first, by keyset on
//                     `(lastAt, anchor)` — the anchor is the project's
//                     smallest `place:` anchor, which no key move changes
//   project.get       one project by key or by anchor; a key that regrouped
//                     answers the project it moved into and says `movedTo`
//   project.sessions  a project's sessions, each joined to its place by the
//                     longest cwd prefix (§9)
//   project.subscribe invalidation pings (`rows`, always empty) carrying the
//                     key moves as `regrouped {from, to}`
//   project.intent    an ACT (rename, pin, hide, link, split, dismiss) —
//                     desktop windows only (P2); its records are PJ-2's
//
// P1 (a), James, 2026-10-08 — the Files service's rule, replacing PJ-L9's "no
// path on the phone": a REQUEST never names a place by its path — only by
// `PlaceRef {device, placeId}` — and every request schema below refuses a
// path-carrying key (`PROJECT_PATH_KEYS`) wherever it sits; an ANSWER to the
// person's own devices (a window, a self phone) may carry a place's `path`;
// any other caller's answer carries none. D10: a place's other spellings
// (aliases) and what joined or relates two places (an edge's or a
// suggestion's `via`: a remote key, a root commit, a home-relative folder)
// never reach a tailnet caller, nor do the `root:` and `remote:` anchors that
// spell the same facts.
//
// TS-only, like the agent plane (gen-jsonschema.ts's header): field-native
// reads none of it.

/** The keys that name a folder by its path. A request carrying one anywhere
 * is refused (P1): the phone names a place by `PlaceRef` only. */
export const PROJECT_PATH_KEYS = [
  "path",
  "paths",
  "cwd",
  "folder",
  "dir",
  "rootPath",
  "rootPaths",
] as const;

/** The first path-carrying key in a request, as a dotted field (`places.0.path`),
 * or undefined. Walks objects and arrays four levels deep — every request
 * shape below is shallower, so a deeper key is no field any door reads. */
export function pathKeyIn(value: unknown, at = "", depth = 0): string | undefined {
  if (depth > 4 || value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = pathKeyIn(item, at === "" ? String(index) : `${at}.${index}`, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value)) {
    const field = at === "" ? key : `${at}.${key}`;
    if ((PROJECT_PATH_KEYS as readonly string[]).includes(key)) return field;
    const found = pathKeyIn(item, field, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The issue a request schema raises for a path (P1): its message is the
 * reason a door's refusal carries, `path-in-request`. */
function refusePaths(value: unknown, ctx: z.RefinementCtx): void {
  const field = pathKeyIn(value);
  if (field !== undefined)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "path-in-request",
      path: field.split("."),
    });
}

/** A place as a reader names it: the device that owns it and its opaque id
 * (`PlaceFacts.placeId`) — never its path (P1). */
export const PlaceRef = z
  .object({
    device: z.string().min(1).max(256),
    placeId: z.string().min(1).max(256),
  })
  .passthrough();
export type PlaceRef = z.infer<typeof PlaceRef>;

/** A project's key: `r:<record id>` once a record binds, else a provisional
 * `p1:` key (opaque; fieldd `projects/normalize.ts`). Readers compare it,
 * never parse it. */
export const ProjectKey = z.string().min(1).max(256).regex(/^\S+$/);
export type ProjectKey = z.infer<typeof ProjectKey>;

/** An anchor as a REQUEST names one (`project.get {anchor}`): a first
 * commit, an identity remote's key, or a place — and never a local-path
 * remote (`remote:local:…` spells a folder) nor a `place:` that is not an
 * opaque id. */
export const ProjectAnchorAsk = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^(?:root:[0-9a-f]{40}|root:[0-9a-f]{64}|remote:\S+|place:[^\s/\\]+)$/)
  .refine((anchor) => !anchor.startsWith("remote:local:"), "path-in-request");

/** home · temp · repo (git with an identity remote) · local (git without
 * one) · folder (no git) — the engine's `PlaceClass`. One this reader does
 * not know reads `folder`, the class that joins nothing. */
export const PROJECT_PLACE_CLASSES = ["repo", "local", "folder", "home", "temp"] as const;
export const ProjectPlaceClass = z.enum(PROJECT_PLACE_CLASSES).catch("folder");
export type ProjectPlaceClass = (typeof PROJECT_PLACE_CLASSES)[number];

/** One place of a project as an answer carries it. `name` is the folder's
 * own name; `path` (device-canonical) rides only an answer to the person's
 * own devices (P1). */
export const ProjectPlace = z
  .object({
    ref: PlaceRef,
    name: z.string(),
    path: z.string().min(1).optional(),
    class: ProjectPlaceClass,
    branch: z.string().min(1).optional(),
    /** the checkout whose `git worktree list` names this one (same device) */
    worktreeOf: PlaceRef.optional(),
    exists: z.boolean(),
    mounted: z.boolean(),
    /** top-level sessions whose cwd this place holds by the longest path */
    sessions: z.number().int().nonnegative(),
    /** epoch ms, the owner's clock: the newest of those sessions' activity */
    lastAt: z.number().finite().optional(),
  })
  .passthrough();
export type ProjectPlace = z.infer<typeof ProjectPlace>;

/** Where a project's name came from (§4.3): the person (a record), the
 * repository, a folder, a desktop's Home (J11), or the bucket it is
 * (Temporary). */
export const PROJECT_NAME_SOURCES = ["you", "repository", "folder", "home", "bucket"] as const;

/** PJ-D15's `ProjectSummary` v2 — one project as a door answers it. */
export const ProjectSummary = z
  .object({
    key: ProjectKey,
    /** no record binds it yet: its key and ink come from its anchors */
    provisional: z.boolean(),
    name: z.string(),
    nameFrom: z.enum(PROJECT_NAME_SOURCES).catch("folder"),
    /** the names other records on this group were given (PJ-L3) */
    alsoCalled: z.array(z.string()).optional(),
    /** two projects that read alike: the first place's parent folder's name */
    disambiguation: z.string().min(1).optional(),
    /** the deal index of the project's ink (§4.3; PJ-L7) */
    ink: z.number().int().nonnegative(),
    /** J11 (James, 2026-10-08; PJ-D3 amended for Home): a desktop's Home —
     * its home folder, `/`, its drive roots — is a PROJECT of that desktop,
     * `kind: "home"` on exactly one device, listed and acted on like any
     * other; the kind and its one device are how a surface names it and tells
     * the desktops' Homes apart */
    kind: ProjectPlaceClass,
    /** Temporary is the only bucket (PJ-L4), a row like any other; a project
     * is `null`. A value this reader does not know reads `null` */
    bucket: z.enum(["temp"]).nullable().catch(null),
    devices: z.array(z.string().min(1)),
    /** newest first */
    places: z.array(ProjectPlace),
    sessions: z.number().int().nonnegative(),
    firstAt: z.number().finite().optional(),
    lastAt: z.number().finite().optional(),
    /** every place's folder is gone (PJ-L6: listed, never dropped) */
    allGone: z.boolean(),
    /** `root:<sha>` · `remote:<key>` · `place:<placeId>`, sorted; a tailnet
     * caller is answered the `place:` anchors only (D10) */
    anchors: z.array(z.string().min(1)),
    /** device → when this desktop last heard that device's rows (ISO), for
     * each device the project has a place on; absent: never heard. Two
     * desktops' answers about one project are compared device by device. */
    asOf: z.record(z.string(), z.string().min(1)),
    /** the grouping rule that made it (`GROUPING_VERSION`) */
    groupingVersion: z.number().int().nonnegative(),
  })
  .passthrough();
export type ProjectSummary = z.infer<typeof ProjectSummary>;

/** What joined two places of one project (§4.1): the identity remote, recent
 * shared history, or the person's link. `via` (the remote key, the shared
 * first commit, `you`) never reaches a tailnet caller (D10). */
export const ProjectEdge = z
  .object({
    a: PlaceRef,
    b: PlaceRef,
    rule: z.string().min(1),
    via: z.string().min(1).optional(),
    /** for shared history: how far before its tip the other place took the sample */
    depth: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type ProjectEdge = z.infer<typeof ProjectEdge>;

/** What only SUGGESTS a project is another's (§4.2), one per pair of
 * projects: `related-history` · `shared-remote` · `same-folder` ·
 * `same-name`. `with` is the other project's key; `a` is this project's place
 * and `b` the other's. `via` never reaches a tailnet caller (D10). */
export const ProjectSuggestion = z
  .object({
    type: z.string().min(1),
    with: ProjectKey,
    a: PlaceRef,
    b: PlaceRef,
    via: z.string().min(1).optional(),
  })
  .passthrough();
export type ProjectSuggestion = z.infer<typeof ProjectSuggestion>;

// ── project.list ──────────────────────────────────────────────────────────

/** `project.list` — a page of this desktop's projects over every self
 * desktop's places. `devices` keeps the projects with a place on any of them;
 * `q` matches a project's names and its places' folder names, never a path. */
export const ProjectListParams = z
  .object({
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.number().int().min(1).max(PROJECT_DOORS.PAGE_MAX_LIMIT).optional(),
    devices: z.array(z.string().min(1).max(256)).min(1).max(64).optional(),
    q: z.string().min(1).max(PROJECT_DOORS.QUERY_MAX).optional(),
  })
  .passthrough()
  .superRefine(refusePaths);
export type ProjectListParams = z.infer<typeof ProjectListParams>;

export const ProjectListResult = z
  .object({
    rows: z.array(ProjectSummary),
    cursor: z.string().min(1).optional(),
    /** every desktop's standing (DS-L8: asleep is a state) */
    sources: z.array(IndexCatalogSource),
    groupingVersion: z.number().int().nonnegative(),
  })
  .passthrough();
export type ProjectListResult = z.infer<typeof ProjectListResult>;

// ── project.get ───────────────────────────────────────────────────────────

/** `project.get {key | anchor}` — exactly one. */
export const ProjectGetParams = z
  .object({
    key: ProjectKey.optional(),
    anchor: ProjectAnchorAsk.optional(),
  })
  .passthrough()
  .superRefine(refusePaths)
  .refine((params) => (params.key === undefined) !== (params.anchor === undefined), {
    message: "exactly one of key or anchor",
  });
export type ProjectGetParams = z.infer<typeof ProjectGetParams>;

/** The project, the suggestions that name it, and why its places joined. A
 * key that regrouped is answered the project it moved into, with `movedTo`
 * (D9) — a reader re-keys what it holds. */
export const ProjectGetResult = z
  .object({
    project: ProjectSummary,
    movedTo: ProjectKey.optional(),
    suggestions: z.array(ProjectSuggestion),
    edges: z.array(ProjectEdge),
  })
  .passthrough();
export type ProjectGetResult = z.infer<typeof ProjectGetResult>;

// ── project.sessions ──────────────────────────────────────────────────────

/** `project.sessions` — a project's sessions, newest activity first by
 * keyset, narrowed to some of its places (by `PlaceRef`), some devices, some
 * agents (the catalog's ids). */
export const ProjectSessionsParams = z
  .object({
    key: ProjectKey,
    places: z.array(PlaceRef).min(1).max(256).optional(),
    devices: z.array(z.string().min(1).max(256)).min(1).max(64).optional(),
    agents: z.array(AgentProviderId).min(1).max(64).optional(),
    cursor: z.string().min(1).max(1024).optional(),
    limit: z.number().int().min(1).max(PROJECT_DOORS.PAGE_MAX_LIMIT).optional(),
  })
  .passthrough()
  .superRefine(refusePaths);
export type ProjectSessionsParams = z.infer<typeof ProjectSessionsParams>;

/** One session as `project.sessions` answers it: its owner's catalog row,
 * the place that holds its cwd, and every desktop that indexed it (DS-D10:
 * one row per `{agent kind, native session id}`; `device` is the copy that
 * speaks). `cwd` rides only an answer to the person's own devices (P1). */
export const ProjectSessionRow = IndexCatalogSession.extend({
  place: PlaceRef,
  devices: z.array(z.string().min(1)).min(1),
}).passthrough();
export type ProjectSessionRow = z.infer<typeof ProjectSessionRow>;

export const ProjectSessionsResult = z
  .object({
    /** the project answered — the asked key, or the one it moved into */
    key: ProjectKey,
    movedTo: ProjectKey.optional(),
    rows: z.array(ProjectSessionRow),
    cursor: z.string().min(1).optional(),
    sources: z.array(IndexCatalogSource),
  })
  .passthrough();
export type ProjectSessionsResult = z.infer<typeof ProjectSessionsResult>;

// ── project.subscribe ─────────────────────────────────────────────────────

/** `project.subscribe` — invalidation pings for a visible projects page: a
 * rows subscription whose rows are always EMPTY and whose revision moves when
 * the grouping's answer or any desktop's catalog moves. A reader re-asks what
 * it shows; a key it holds that moved arrives as `regrouped`. */
export const ProjectSubscribeParams = RowsSubscribeParams.passthrough();
export type ProjectSubscribeParams = z.infer<typeof ProjectSubscribeParams>;

/** A key move (D9): `from` regrouped into `to`. */
export const ProjectRegrouped = z.object({ from: ProjectKey, to: ProjectKey }).passthrough();
export type ProjectRegrouped = z.infer<typeof ProjectRegrouped>;

export const ProjectChangesOpen = rowsOpen(z.never());
export const ProjectChangesDelta = rowsDelta(z.never())
  .extend({
    /** the key moves since `since`, oldest first */
    regrouped: z.array(ProjectRegrouped).optional(),
    /** which desktops' catalogs moved, as a hint */
    devices: z.array(z.string().min(1)).optional(),
  })
  .passthrough();
export type ProjectChangesDelta = z.infer<typeof ProjectChangesDelta>;

// ── project.intent ────────────────────────────────────────────────────────

/** The acts a desktop window makes on a project (§5, PJ-D19): each becomes,
 * or amends, the project's RECORD (PJ-2) — the person's last word, which
 * travels (PJ-L3). `link` joins a place into this project (a suggestion's
 * accept too); `split` takes a place out of this project's record (`{place,
 * notRecord}`); `dismiss` hides the suggestions between this project and
 * another (bound to the pair, D3). */
export const PROJECT_INTENT_OPS = ["rename", "pin", "hide", "link", "split", "dismiss"] as const;
export type ProjectIntentOp = (typeof PROJECT_INTENT_OPS)[number];

const intentOf = <Op extends ProjectIntentOp, Shape extends z.ZodRawShape>(op: Op, shape: Shape) =>
  z.object({ key: ProjectKey, op: z.literal(op), ...shape }).passthrough();

export const ProjectIntentParams = z
  .discriminatedUnion("op", [
    intentOf("rename", { name: z.string().trim().min(1).max(PROJECT_DOORS.NAME_MAX) }),
    intentOf("pin", { pinned: z.boolean() }),
    intentOf("hide", { hidden: z.boolean() }),
    intentOf("link", { place: PlaceRef }),
    intentOf("split", { place: PlaceRef }),
    intentOf("dismiss", { with: ProjectKey }),
  ])
  .superRefine(refusePaths);
export type ProjectIntentParams = z.infer<typeof ProjectIntentParams>;

/** The project's key after the act — its record's, `r:<recordId>`. */
export const ProjectIntentResult = z
  .object({
    key: ProjectKey,
    recordId: z.string().min(1),
  })
  .passthrough();
export type ProjectIntentResult = z.infer<typeof ProjectIntentResult>;

// ── the refusals ──────────────────────────────────────────────────────────

/** Why a door said no, beside the error kind (a contract string a reader
 * branches on, never a sentence; open on the wire):
 *  - `path-in-request` (PRECONDITION_FAILED): the request named a folder by
 *    its path (`field` says where) — P1: a place is named by `PlaceRef`;
 *  - `no-such-project` (NOT_FOUND): no project holds the key or the anchor,
 *    and none it moved into does;
 *  - `key-moved` (PRECONDITION_FAILED, `project.intent` only): the key
 *    regrouped — an act is never aimed at a project the person did not see;
 *    `movedTo` names it, and the window re-reads before it acts again;
 *  - `no-such-place` (PRECONDITION_FAILED, `project.intent`): a `PlaceRef`
 *    no project holds.
 * Who may call is the error kind's (FORBIDDEN_SCOPE `{method, principal}`),
 * and a door that cannot answer yet is UNAVAILABLE {service:
 * PROJECT_DOORS.SERVICE, state}. */
export const PROJECT_REFUSALS = [
  "path-in-request",
  "no-such-project",
  "key-moved",
  "no-such-place",
] as const;

export const ProjectRefusal = z
  .object({
    reason: z.string().min(1),
    field: z.string().min(1).optional(),
    movedTo: ProjectKey.optional(),
  })
  .passthrough();
export type ProjectRefusal = z.infer<typeof ProjectRefusal>;
