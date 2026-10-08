import type {
  PlaceKind,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceGitFacts,
  WorkspaceListKinds,
} from "@vibefield/contracts";

// FS-1a — fieldd ↔ its files worker: the CONTROL pipe, Node's child IPC
// channel (JSON). Not mille's channel protocol: that one carries ONE mille
// session to ONE engine (`attachChannel`), and the door tier needs what it
// does not carry — a search (mille's search is in-process only, "not wired"
// over the port; M6), git (not mille at all), and one engine per export (mille
// refuses overlapping roots in one engine, and the home export holds every
// place). mille's channel enters at FS-1b, for the ATTACHED tier, on the
// worker's own listener. This pipe is fieldd's and the worker's only: one
// trust domain (FS-D7). FS-1b registers secret attach credentials on this pipe.
//
//   fieldd → worker  {t: "init", milleNative}            first, once
//                    {t: "req", id, op, args}              a door's question
//                    {t: "shutdown"}                       dispose the engines, exit 0
//   worker → fieldd  {t: "ready", pid, port, mille}             the READY line of a generation
//                    {t: "fatal", reason}                  it cannot run (the addon did not load)
//                    {t: "res", id, ok, value | error}     an answer
//                    {t: "log", level, event, message, fields?}
//                    {t: "session", event, attachId, rootId, clientId, reason?}
//                                                          an attachment established or ended (R6)
//
// The worker exits when the pipe closes (`disconnect`): fieldd's death takes
// it, so no orphan outlives the daemon that owned it (FS-D11 (b): it stops
// with fieldd).

export type WorkerErrorCode =
  /** the root's folder is not there (a place gone missing, a volume that left) */
  | "root-missing"
  /** no entry at the path, or one the service will not reach (a symlink on the
   * way, a real path outside the root) — one answer for both, never a map of
   * what lies outside */
  | "not-found"
  /** the path names a file where a folder was asked */
  | "not-a-directory"
  /** the request itself is malformed (the door checks first; the belt) */
  | "invalid"
  /** every engine is answering and the cap (`WORKSPACE_LIMITS.HOSTS_MAX`)
   * leaves no room for another: ask again shortly */
  | "busy"
  /** a folder read made no progress within `WORKSPACE_LIMITS.READ_TIMEOUT_MS`
   * (mille's `ETIMEDOUT`, M10: an iCloud folder downloading, a drive or share
   * that stopped answering) — nothing is known about it; ask again shortly */
  | "timed-out"
  /** the folder lives only in iCloud (mille's `EDATALESS`, macOS): its
   * contents are not on this machine, and the service does not download a
   * folder to list it (`WORKSPACE_LIMITS.MATERIALIZE_DATALESS`) */
  | "dataless"
  | "internal";

export interface WorkerError {
  code: WorkerErrorCode;
  message: string;
}

export interface ListArgs {
  /** the root's absolute path on this desktop (the engine's key) */
  rootPath: string;
  /** the folder below it, already read by the door (`parseRelativePath`) */
  segments: string[];
  offset: number;
  limit: number;
  kinds: WorkspaceListKinds;
}

export interface ListValue {
  /** the listed folder's absolute path */
  path: string;
  entries: WorkspaceEntry[];
  /** entries of the asked kinds in the folder */
  total: number;
  /** where the next page starts, or null on the last page */
  nextOffset: number | null;
}

export interface SearchArgs {
  rootPath: string;
  /** the subtree searched, below the root (`parseRelativePath`); [] = all */
  segments: string[];
  q: string;
  limit: number;
  kinds: WorkspaceListKinds;
}

/** A hit as the worker says it: its path RELATIVE to the export's root (as
 * mille's own search over the port will say it, M6). The door composes the
 * absolute `path` from the root's path. */
export interface WorkerSearchHit {
  id: number;
  name: string;
  /** below the export's root, POSIX separators */
  relativePath: string;
  kind: WorkspaceEntryKind;
}

export interface SearchValue {
  hits: WorkerSearchHit[];
  clipped: boolean;
  complete: boolean;
  /** entries the walk had seen when it stopped (the coverage's measure) */
  walked: number;
}

export interface GitFactsArgs {
  rootPath: string;
}

export type GitFactsValue = WorkspaceGitFacts | null;

// PJ-1 (`thinking-project-places.md` §9; `build-pj.md` L3, L6) — PLACE FACTS:
// what the worker reads of a batch of folders the index names, for fieldd's
// scanner to publish on the catalog's project rows. Read-only git through the
// one hardened runner, and NO `git status` (a `.gitattributes` clean filter
// would run — build-fs M19). Remotes come back as git spells them (insteadOf
// applied); fieldd normalizes them.

/** One sample of a place's first-parent history: the commit `depth` first
 * parents back from its tip (PLACE_FACTS.SAMPLE_DEPTHS). */
export interface PlaceSample {
  sha: string;
  depth: number;
}

/** A place's samples, handed to the worker to look for in other places. */
export interface PlaceSampleSet {
  /** the place's id, as its owner publishes it (opaque here) */
  placeId: string;
  /** its first-parent root: only a place with the same root is searched */
  root: string;
  samples: PlaceSample[];
}

/** Another place's sample found in this place's history (`cat-file -e`, then
 * `merge-base --is-ancestor`): the shallowest one held. */
export interface PlaceHit {
  placeId: string;
  sha: string;
  depth: number;
}

/** Why git would not read a place (never overridden: `safe.directory` stays
 * the person's). */
export type PlaceGitRefusal = "dubious-ownership";

export interface PlaceRemote {
  name: string;
  /** the fetch URL as git uses it (`url.<base>.insteadOf` applied) */
  url: string;
}

/** What git says of a place in a repository. */
export interface PlaceGitRead {
  /** the tip, or null on an unborn branch */
  head: string | null;
  /** the branch HEAD names (an unborn one too), null when detached */
  branch: string | null;
  shallow: boolean;
  /** the first-parent root commit, GUARDED: null when shallow (a boundary is
   * no root), unborn, an empty-tree first commit, or a walk past its budget */
  root: string | null;
  remotes: PlaceRemote[];
  /** the identity remote's NAME: `branch.<b>.pushRemote` › `remote.pushDefault`
   * › `origin` › the only remote — null when none of them names one held */
  pushRemote: string | null;
  /** an ssh host a remote names → the HostName `ssh -G` resolves it to, where
   * they differ (C10's alias) */
  sshAliases: Record<string, string>;
  /** the working tree's top (the place may be a folder below it) */
  toplevel: string;
  /** the main worktree's path when this place is a LINKED worktree */
  worktreeOf: string | null;
  /** the repository's other worktrees that are there (the scanner's discovery:
   * real paths; never a bare main, never a prunable one) */
  worktrees: Array<{ path: string; branch: string | null }>;
  /** none when shallow or unborn */
  samples: PlaceSample[];
}

export interface PlaceFactsArgs {
  places: Array<{
    /** an absolute path on this desktop, as the index spells it */
    path: string;
    /** what the scanner holds for it: a `key` that still matches answers
     * `git: "unchanged"`, a `hitsKey` that still matches `hits: "unchanged"` */
    known?: { key: string | null; root: string | null; hitsKey: string | null };
  }>;
  /** every place's samples the scanner knows — this desktop's and its peers' */
  peers: PlaceSampleSet[];
  /** the agent catalog's task roots (`~/…` globs, `*` one segment) */
  taskRoots: string[];
}

export type PlaceRead =
  | {
      path: string;
      /** the question's budget ran out before this place: ask again */
      skipped: true;
    }
  | {
      path: string;
      skipped: false;
      /** its real path (`realpathSync.native`: the letter case on disk), or
       * the path as asked when it is not there */
      canonical: string;
      exists: boolean;
      /** false when the volume it lives on is not mounted */
      mounted: boolean;
      /** the volume ignores letter case */
      caseless: boolean;
      kind: PlaceKind;
      /** the path below this user's home, `/`-separated (`Projects/app`);
       * null when it is not below home (or is home) — what "the same folder
       * on two desktops" compares, without a home path on the wire (§4.2) */
      homeRelative: string | null;
      /** null: not in a repository, not there, or refused */
      git: PlaceGitRead | null | "unchanged";
      gitRefused: PlaceGitRefusal | null;
      /** the cheap read's digest (HEAD, branch, config and worktree list) */
      key: string | null;
      hits: PlaceHit[] | "unchanged";
      hitsKey: string | null;
    };

export interface PlaceFactsValue {
  places: PlaceRead[];
}

/** What the worker measures of itself (FS-1a's witness: the idle cost). */
export interface StatsValue {
  pid: number;
  rss: number;
  heapUsed: number;
  cpuUserMicros: number;
  cpuSystemMicros: number;
  engines: number;
}

/** A pair of independent, single-use credentials under one lease. Its
 * `expiresAt` bounds REDEMPTION (R1, 2026-10-07): a pair not established by
 * then is dropped; an established session ends only on a real loss. */
export interface AttachRegistration {
  /** the session's audit id (R6): not a credential — the mint's rows and the
   * session's own carry it as their `sessionId` */
  attachId: string;
  rootId: string;
  rootPath: string;
  clientId: string;
  ticket: string;
  gitTicket: string;
  expiresAt: number;
}

/** R6 (2026-10-07) — why an ESTABLISHED attachment ended. The worker says the
 * first six; fieldd says `worker-exited` for a session its generation took
 * down without a word (a crash, a kill). A pair that was never established
 * has no end to record: its mint row is its whole story. */
export const ATTACH_END_REASONS = [
  /** `workspace.closeTicket` */
  "closed",
  /** either leg's socket closed: the renderer's Worker went, or the link did */
  "leg-closed",
  /** the bounded root check (`ATTACHED_ROOT_CHECK_MS`) found the folder gone
   * or its real path moved */
  "root-lost",
  /** the window's token was revoked */
  "principal-revoked",
  /** the root left the exported set (`retainRoots`) */
  "root-withdrawn",
  /** the worker's listener closed: fieldd's stop, or the listener failing */
  "worker-stopped",
  /** the generation exited with the session open */
  "worker-exited",
] as const;
export type AttachEndReason = (typeof ATTACH_END_REASONS)[number];

/** One attachment as its audit rows name it — ids only, never a path. */
export interface AttachSession {
  attachId: string;
  rootId: string;
  clientId: string;
}

export type AttachEvent =
  | ({ event: "established" } & AttachSession)
  | ({ event: "ended"; reason: AttachEndReason } & AttachSession);

export interface WorkerOps {
  resolve: { args: { rootPath: string; segments: string[]; file?: boolean }; value: string };
  registerTicket: { args: AttachRegistration; value: { port: number } };
  closeTicket: { args: { clientId: string; ticket: string }; value: boolean };
  revokeClient: { args: { clientId: string }; value: null };
  retainRoots: { args: { rootIds: string[] }; value: null };
  list: { args: ListArgs; value: ListValue };
  search: { args: SearchArgs; value: SearchValue };
  gitFacts: { args: GitFactsArgs; value: GitFactsValue };
  placeFacts: { args: PlaceFactsArgs; value: PlaceFactsValue };
  stats: { args: Record<string, never>; value: StatsValue };
}

export type WorkerOp = keyof WorkerOps;

export const WORKER_OPS: readonly WorkerOp[] = [
  "list",
  "search",
  "gitFacts",
  "placeFacts",
  "stats",
  "resolve",
  "registerTicket",
  "closeTicket",
  "revokeClient",
  "retainRoots",
];

export type ToWorker =
  | { t: "init"; milleNative: string }
  | { t: "req"; id: number; op: WorkerOp; args: unknown }
  | { t: "shutdown" };

export type FromWorker =
  | {
      t: "ready";
      pid: number;
      port: number;
      mille: { packageVersion: string; nativeVersion: string };
    }
  | { t: "fatal"; reason: string }
  | { t: "res"; id: number; ok: true; value: unknown }
  | { t: "res"; id: number; ok: false; error: WorkerError }
  | {
      t: "log";
      level: "info" | "warn";
      event: string;
      message: string;
      fields?: Record<string, unknown>;
    }
  | ({ t: "session" } & AttachEvent);

function attachEventOf(raw: Record<string, unknown>): boolean {
  if (![raw["attachId"], raw["rootId"], raw["clientId"]].every((v) => typeof v === "string"))
    return false;
  if (raw["event"] === "established") return true;
  return (
    raw["event"] === "ended" && (ATTACH_END_REASONS as readonly unknown[]).includes(raw["reason"])
  );
}

/** A message from the worker, read tolerantly: the shape or null. */
export function readFromWorker(raw: unknown): FromWorker | null {
  if (typeof raw !== "object" || raw === null) return null;
  const message = raw as { t?: unknown; id?: unknown; ok?: unknown };
  switch (message.t) {
    case "ready":
    case "fatal":
    case "log":
      return raw as FromWorker;
    case "res":
      return typeof message.id === "number" && typeof message.ok === "boolean"
        ? (raw as FromWorker)
        : null;
    case "session":
      return attachEventOf(raw as Record<string, unknown>) ? (raw as FromWorker) : null;
    default:
      return null;
  }
}
