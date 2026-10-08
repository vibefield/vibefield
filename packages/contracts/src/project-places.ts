import { z } from "zod";

// PJ-1 — PLACE FACTS (`thinking-project-places.md` §3, §4, §9; PJ-D1…D24
// RULED (a) 2026-10-07; `build-pj.md` L1, L2, L6). A place is a folder on a
// device where work happens; a project is a set of places grouped by
// evidence (PJ-L1, PJ-L2). Each desktop observes its OWN places — git read
// hardened and read-only — and publishes these facts on its catalog's project
// rows (`IndexCatalogProject.places`, L1: one per root path, plus each
// checkout's worktrees), never as a second table. Every daemon then runs the
// same grouping over its own facts and its replica of the peers'
// (fieldd `projects/grouping.ts`, PJ-D20: the engine lives in fieldd; a client
// never groups, DS-L4); a change to how facts join is a GROUPING_VERSION bump.
//
// The OWNER says what kind a place is (L6): it knows its home, its temporary
// roots, its volumes' case rule and the agent catalog's task roots, so no
// home path rides the device roster and the engine reads no path pattern
// (AR-L1). The facts are sticky: an unplugged or deleted place keeps its
// last-known facts, `exists`/`mounted` say which, and `observedAt` moves only
// when the facts' digest does (L2 — a periodic scan of an unchanged place
// publishes no delta).
//
// TS-only, like the agent plane (gen-jsonschema.ts's header): field-native
// reads none of it.

/** A commit id in full, as git prints it: 40 hex (SHA-1) or 64 (SHA-256). A
 * sample or a hit is a SHA a desktop hands to `git cat-file`, so it is
 * hex-checked here, at the wire, before any reader can act on it (§9). */
export const CommitSha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
export type CommitSha = z.infer<typeof CommitSha>;

/** What the OWNER says a place is (L6), from its own knowledge:
 *  - `home` — the device's home folder itself, `/`, or a bare drive root
 *    (PJ-L4; a deeper folder under home is NOT home). Since J11
 *    (2026-10-08) these are THAT DEVICE'S Home, a project of its own — no
 *    longer one bucket across devices;
 *  - `temp` — under a system temporary root (`/tmp`, `/private/tmp`,
 *    `/var/folders`, `%LOCALAPPDATA%\Temp`, the OS temp dir). A git checkout
 *    there with an identity remote still belongs to its repository; the
 *    engine reads that from `identityRemote`;
 *  - `task` — under a task root an agent declares in the agent catalog
 *    (`taskRoots`, PJ-D21): Temporary whatever its git says;
 *  - `project` — anything else.
 * A kind this reader does not know reads `project`: an ordinary place joins
 * only by evidence, so the conservative reading never merges anything. */
export const PLACE_KINDS = ["home", "temp", "task", "project"] as const;
export const PlaceKind = z.enum(PLACE_KINDS);
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** One sample of a place's first-parent history: the commit `depth` commits
 * before its tip (0 = the tip), at `PROJECT_GROUPING.SAMPLE_DEPTHS`. A
 * shallow clone or an unborn head publishes none (§4.1 E2). */
export const PlaceSample = z
  .object({
    sha: CommitSha,
    depth: z.number().int().nonnegative(),
  })
  .passthrough();
export type PlaceSample = z.infer<typeof PlaceSample>;

/** Another place's sample, found in THIS place's own objects by this place's
 * own desktop (`cat-file -e`, then `merge-base --is-ancestor`) — a fact the
 * holder owns (DS-L2). `placeId` names the place that published the sample
 * (on any desktop, this one included) and `depth` is where that place took
 * it: a hit at `depth ≤ PROJECT_GROUPING.RECENT_DEPTH` joins the two. */
export const PlaceHit = z
  .object({
    placeId: z.string().min(1),
    sha: CommitSha,
    depth: z.number().int().nonnegative(),
  })
  .passthrough();
export type PlaceHit = z.infer<typeof PlaceHit>;

/** The refusals a place's git read can carry instead of facts. A repository
 * git will not read for this user (`safe.directory` is never overridden, L3)
 * is a FACT about the place, not an error: it groups as a repository with no
 * identity until someone fixes its ownership. Open on the wire. */
export const PLACE_GIT_REFUSALS = ["dubious-ownership"] as const;

/** One place as its OWNER publishes it (§9). The device is the row's: a place
 * rides its owner's catalog row, so it carries no device of its own. */
export const PlaceFacts = z
  .object({
    /** opaque and unique across the mesh; the engine never parses it */
    placeId: z.string().min(1),
    /** device-canonical (the real path, `realpathSync.native`'s spelling) */
    path: z.string().min(1),
    /** the other spellings that name this folder on its device — rosetta's
     * lexical roots (`C:\…\VibeField` beside `c:\…\vibefield`, C15) */
    aliases: z.array(z.string().min(1)),
    kind: PlaceKind.catch("project"),
    /** whether its volume compares paths without case (APFS's default,
     * NTFS) — two spellings that differ only in case are then one place */
    caseless: z.boolean(),
    exists: z.boolean(),
    mounted: z.boolean(),
    /** the folder is a git working tree's top (a worktree included). False
     * for a plain folder; true for a repository git refused (`gitRefused`) */
    git: z.boolean(),
    /** the path below its device's home, `/`-separated (`Projects/app`) —
     * absent when the place is not under home, or is home. What the "same
     * folder on two desktops" suggestion compares (§4.2); no home path
     * crosses the wire to compute it (L6) */
    homeRelative: z.string().min(1).optional(),
    /** E1 (§4.1): the push remote › `remote.pushDefault` › `origin` › the
     * only remote, NORMALIZED (fieldd `projects/normalize.ts`). Absent when
     * there is none, or it is a local path (`local:` never joins) */
    identityRemote: z.string().min(1).optional(),
    /** every remote, normalized and deduplicated. Any one other than the
     * identity only SUGGESTS (C8b, C8c); a `local:` key never joins */
    remotes: z.array(z.string().min(1)),
    /** the first-parent root commit, guarded: absent for a shallow clone, an
     * unborn head or an empty-tree first commit */
    root: CommitSha.optional(),
    branch: z.string().min(1).optional(),
    /** the placeId of the checkout whose `git worktree list` names this one */
    worktreeOf: z.string().min(1).optional(),
    samples: z.array(PlaceSample),
    hits: z.array(PlaceHit),
    /** why git would not read this place (`PLACE_GIT_REFUSALS`) */
    gitRefused: z.string().min(1).optional(),
    /** epoch ms, the owner's clock: when these facts last CHANGED (L2) */
    observedAt: z.number().finite(),
  })
  .passthrough();
export type PlaceFacts = z.infer<typeof PlaceFacts>;

/** A row's places as a reader takes them: a place it cannot read is dropped
 * and the rest kept, so a malformed place (a SHA that is not hex, a newer
 * peer's shape) never costs the row the session history it carries — nor
 * does a `places` that is not a list at all (pj1b, 2026-10-08: it refused the
 * whole row, so a newer peer that reshaped the field would have emptied its
 * projects from an older desktop's History). */
export const PlaceFactsList = z.unknown().transform((raw): PlaceFacts[] =>
  Array.isArray(raw)
    ? raw.flatMap((place) => {
        const parsed = PlaceFacts.safeParse(place);
        return parsed.success ? [parsed.data] : [];
      })
    : [],
);
