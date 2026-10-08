import { z } from "zod";
import { WORKSPACE_GIT, WORKSPACE_LIMITS, WORKSPACE_SERVICE } from "./registries";
import { RowsSubscribeParams, rowsDelta, rowsOpen } from "./rows";

// FS-1a — the files service's DOOR TIER (`thinking-files-service.md` §3,
// RULED 2026-10-05: FS-D1…D10, D12…D14 (a), D11 (b)). One files service per
// desktop — mille's engine in a fieldd-owned worker — and these are its
// bounded rows over fieldd's product API: the roots it exports, a folder's
// entries page by page, a search within one root, a root's git facts, and a
// rows subscription of the roots. The attached tier (a ticket → mille's own
// channel over a WebSocket, `workspace.openTicket`) follows below (FS-1b).
//
// THE PATH RULE (FS-D4 (a) as corrected 2026-10-05): a REQUEST names a root
// by its id and a path RELATIVE to that root — POSIX separators, no `..`, no
// absolute path, no drive letter, nothing that leaves the root through a
// symlink; the service refuses anything else. An ANSWER carries the absolute
// path on THIS desktop beside every root and entry, because the callers these
// doors admit are the owner's own (a window, the owner's phone, another of the
// owner's desktops) and the agent a person prompts reads that path.
//
// WHO (FS-D6 (a)): `workspace.read`, by PRINCIPAL — RO-13's rule. The scope is
// plugin-eligible and guards other doors, so these doors refuse a plugin
// (renderer or service), an MCP agent and a tailnet guest FORBIDDEN_SCOPE
// whatever it holds; a renderer participant window, a self phone and a self peer daemon
// are served. A tailnet caller's pages are cut at `WORKSPACE_LIMITS.TAILNET_PAGE`.
//
// TS-only, like the agent plane (gen-jsonschema.ts's header): field-native
// reads none of it, so no Rust is generated; the fixtures are parsed here and
// by fieldd's tests against the real worker's answers (EL9).

/** The shape every root id has: mille's export-id rule (mille-truffle
 * `exports.ts`), because FS-1b hands a root's id to mille AS its export id. */
export const WORKSPACE_ROOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A root's id: stable across restarts — a digest of the root's kind and
 * path — so a phone's kept id still names the same folder tomorrow. Always
 * a valid mille export id (`WORKSPACE_ROOT_ID_PATTERN`). */
export const WorkspaceRootId = z.string().regex(WORKSPACE_ROOT_ID_PATTERN);
export type WorkspaceRootId = z.infer<typeof WorkspaceRootId>;

/** What a root is (FS-D4): a PLACE — a folder an agent was spawned in, added
 * automatically — or a BROWSE export — the home directory or a mounted volume,
 * for walking the desktop's filesystem the way SFTP does. `picked` comes
 * from the native folder picker (FS-3). `project` (rosetta's project roots
 * on consent) remains reserved; readers render these selections as roots. */
export const WorkspaceRootKind = z.enum(["place", "browse", "picked", "project"]);
export type WorkspaceRootKind = z.infer<typeof WorkspaceRootKind>;

/** Which browse export a `browse` root is: the home directory or a volume. */
export const WorkspaceBrowseKind = z.enum(["home", "volume"]);
export type WorkspaceBrowseKind = z.infer<typeof WorkspaceBrowseKind>;

export const WorkspaceRoot = z
  .object({
    rootId: WorkspaceRootId,
    /** the folder's own name (its last path segment; a volume's name) */
    name: z.string().min(1).max(WORKSPACE_LIMITS.NAME_CHARS),
    /** the absolute path on `device` */
    path: z.string().min(1).max(WORKSPACE_LIMITS.PATH_CHARS),
    /** the desktop that holds it */
    device: z.string().min(1).max(256),
    kind: WorkspaceRootKind,
    /** present on a `browse` root */
    browse: WorkspaceBrowseKind.optional(),
    /** the folder is gone (saved roots are retained as missing) */
    missing: z.boolean(),
    /** a place: when an agent last started there (ISO 8601); null otherwise */
    lastActiveAt: z.string().min(1).max(64).nullable(),
  })
  .passthrough();
export type WorkspaceRoot = z.infer<typeof WorkspaceRoot>;

/** `workspace.roots {device?}` — places newest first, picks by path, then
 * the home directory and volumes by name. */
export const WorkspaceRootsParams = z
  .object({ device: z.string().min(1).max(256).optional() })
  .passthrough();
export type WorkspaceRootsParams = z.infer<typeof WorkspaceRootsParams>;

/** FS-3's service-owned prerequisite: the desktop's attended native picker.
 * No caller supplies a path or a remote device. The shell's choice becomes a
 * durable named export only after validation and required audit. */
export const WorkspacePickFolderParams = z.object({}).passthrough();
export type WorkspacePickFolderParams = z.infer<typeof WorkspacePickFolderParams>;
export const WorkspacePickFolderResult = z.union([
  z.object({ canceled: z.literal(true) }).passthrough(),
  z.object({ canceled: z.literal(false), root: WorkspaceRoot }).passthrough(),
]);
export type WorkspacePickFolderResult = z.infer<typeof WorkspacePickFolderResult>;

export const WorkspaceRootsResult = z
  .object({
    roots: z.array(WorkspaceRoot),
    /** the list was cut at the caller's page (oldest places go first) */
    clipped: z.boolean(),
  })
  .passthrough();
export type WorkspaceRootsResult = z.infer<typeof WorkspaceRootsResult>;

/** A request's path below a root: POSIX separators; "" (or absent) is the
 * root itself. The door checks the syntax (`..`, absolute, drive letters) and
 * the worker the symlinks. */
export const WorkspaceRelativePath = z.string().max(WORKSPACE_LIMITS.PATH_CHARS);
export type WorkspaceRelativePath = z.infer<typeof WorkspaceRelativePath>;

/** `dirs`: folders only (a picker's default); `all`: folders and files. */
export const WorkspaceListKinds = z.enum(["dirs", "all"]);
export type WorkspaceListKinds = z.infer<typeof WorkspaceListKinds>;

/** An entry's kind. A symlink is listed as one and never followed. */
export const WorkspaceEntryKind = z.enum(["dir", "file", "symlink", "other"]);
export type WorkspaceEntryKind = z.infer<typeof WorkspaceEntryKind>;

export const WorkspaceEntry = z
  .object({
    /** the engine's id for the entry — stable while the root's engine lives in
     * this worker generation; a request names entries by path, not by id */
    id: z.number().int().nonnegative(),
    name: z.string().min(1).max(WORKSPACE_LIMITS.NAME_CHARS),
    kind: WorkspaceEntryKind,
    /** the absolute path on the root's desktop */
    path: z
      .string()
      .min(1)
      .max(WORKSPACE_LIMITS.PATH_CHARS * 2),
    /** bytes, a file's */
    size: z.number().int().nonnegative().optional(),
    /** last modified, ms since the epoch */
    mtime: z.number().nonnegative().optional(),
    /** a folder's: the entries directly inside it, hidden ones (a leading dot)
     * not counted; absent when the folder could not be read */
    childCount: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type WorkspaceEntry = z.infer<typeof WorkspaceEntry>;

/** An opaque page cursor (`nextCursor` of the page before). */
export const WorkspaceCursor = z.string().min(1).max(256);
export type WorkspaceCursor = z.infer<typeof WorkspaceCursor>;

/** `workspace.list {rootId, path?, cursor?, limit?, kinds?, device?}` — one
 * page of a folder's entries, folders first, then by name. */
export const WorkspaceListParams = z
  .object({
    rootId: WorkspaceRootId,
    path: WorkspaceRelativePath.optional(),
    cursor: WorkspaceCursor.optional(),
    limit: z.number().int().min(1).max(WORKSPACE_LIMITS.LIST_PAGE).optional(),
    kinds: WorkspaceListKinds.optional(),
    device: z.string().min(1).max(256).optional(),
  })
  .passthrough();
export type WorkspaceListParams = z.infer<typeof WorkspaceListParams>;

export const WorkspaceListResult = z
  .object({
    rootId: WorkspaceRootId,
    /** the listed folder's absolute path */
    path: z
      .string()
      .min(1)
      .max(WORKSPACE_LIMITS.PATH_CHARS * 2),
    entries: z.array(WorkspaceEntry),
    /** the next page's cursor, or null on the last page */
    nextCursor: WorkspaceCursor.nullable(),
    /** the page was cut: more entries follow at `nextCursor` */
    clipped: z.boolean(),
    /** the folder's entries in all (of the asked kinds) */
    total: z.number().int().nonnegative(),
  })
  .passthrough();
export type WorkspaceListResult = z.infer<typeof WorkspaceListResult>;

/** `workspace.search {rootId, path?, q, limit?, kinds?, device?}` — names
 * matching `q` (mille's fuzzy matcher) in the subtree at `path` (relative to
 * the root; absent = the whole root), best first. */
export const WorkspaceSearchParams = z
  .object({
    rootId: WorkspaceRootId,
    path: WorkspaceRelativePath.optional(),
    q: z.string().min(1).max(WORKSPACE_LIMITS.QUERY_CHARS),
    limit: z.number().int().min(1).max(WORKSPACE_LIMITS.SEARCH_HITS).optional(),
    kinds: WorkspaceListKinds.optional(),
    device: z.string().min(1).max(256).optional(),
  })
  .passthrough();
export type WorkspaceSearchParams = z.infer<typeof WorkspaceSearchParams>;

export const WorkspaceSearchHit = z
  .object({
    id: z.number().int().nonnegative(),
    name: z.string().min(1).max(WORKSPACE_LIMITS.NAME_CHARS),
    /** the absolute path on the root's desktop (the door composes it from the
     * root's path and `relativePath`) */
    path: z
      .string()
      .min(1)
      .max(WORKSPACE_LIMITS.PATH_CHARS * 2),
    /** the hit's path below the root, POSIX separators — what a
     * `workspace.list` of a folder hit asks with */
    relativePath: z.string().min(1).max(WORKSPACE_LIMITS.PATH_CHARS),
    kind: WorkspaceEntryKind,
  })
  .passthrough();
export type WorkspaceSearchHit = z.infer<typeof WorkspaceSearchHit>;

export const WorkspaceSearchResult = z
  .object({
    rootId: WorkspaceRootId,
    hits: z.array(WorkspaceSearchHit),
    /** more matched than the answer holds */
    clipped: z.boolean(),
    /** the search read every folder of the subtree it walks (hidden, ignored,
     * vendored and symlinked folders are not walked); false when the walk's
     * bounds (`WORKSPACE_LIMITS.SEARCH_WALK_*`) cut it — a miss is then not a
     * "no" */
    complete: z.boolean(),
  })
  .passthrough();
export type WorkspaceSearchResult = z.infer<typeof WorkspaceSearchResult>;

/** `workspace.gitFacts {rootId, device?}` */
export const WorkspaceGitFactsParams = z
  .object({
    rootId: WorkspaceRootId,
    path: WorkspaceRelativePath.optional(),
    device: z.string().min(1).max(256).optional(),
  })
  .passthrough();
export type WorkspaceGitFactsParams = z.infer<typeof WorkspaceGitFactsParams>;

/** One checkout of the repository a root belongs to (the room's `GitWorktree`). */
export const WorkspaceGitWorktree = z
  .object({
    path: z.string().min(1),
    /** absent on a detached HEAD */
    branch: z.string().min(1).nullable(),
  })
  .passthrough();
export type WorkspaceGitWorktree = z.infer<typeof WorkspaceGitWorktree>;

/** A root's git facts (the room's `GitFacts`): every field nullable, because a
 * git that could not answer one question is a fact, not a failure. */
export const WorkspaceGitFacts = z
  .object({
    /** null on a detached HEAD */
    branch: z.string().min(1).nullable(),
    /** how many paths `git status` names (staged, unstaged, untracked) */
    dirty: z.number().int().nonnegative().nullable(),
    worktrees: z.array(WorkspaceGitWorktree),
  })
  .passthrough();
export type WorkspaceGitFacts = z.infer<typeof WorkspaceGitFacts>;

/** null: the root is not in a git repository. */
export const WorkspaceGitFactsResult = WorkspaceGitFacts.nullable();
export type WorkspaceGitFactsResult = z.infer<typeof WorkspaceGitFactsResult>;

/** `workspace.subscribe {scope: "roots", since?, minIntervalMs?, device?}` — a
 * rows subscription of `WorkspaceRoot`s keyed by `rootId` (DS-L3): a place
 * appears when an agent is spawned in a new folder, a root flips `missing`, a
 * volume mounts or leaves. The door's floor is a FLOOR (methods.ts). */
export const WorkspaceSubscribeParams = RowsSubscribeParams.extend({
  scope: z.literal("roots"),
  device: z.string().min(1).max(256).optional(),
}).passthrough();
export type WorkspaceSubscribeParams = z.infer<typeof WorkspaceSubscribeParams>;

export const WorkspaceRootsOpen = rowsOpen(WorkspaceRoot);
export type WorkspaceRootsOpen = z.infer<typeof WorkspaceRootsOpen>;
export const WorkspaceRootsDelta = rowsDelta(WorkspaceRoot);
export type WorkspaceRootsDelta = z.infer<typeof WorkspaceRootsDelta>;

/** Every UNAVAILABLE a `workspace.*` door answers while its worker cannot. */
export const WorkspaceUnavailableDetails = z
  .object({
    service: z.literal(WORKSPACE_SERVICE.SERVICE),
    state: z.enum([
      WORKSPACE_SERVICE.STATE_STARTING,
      WORKSPACE_SERVICE.STATE_RESTARTING,
      WORKSPACE_SERVICE.STATE_OFF,
      WORKSPACE_SERVICE.STATE_UNCONFIGURED,
      WORKSPACE_SERVICE.STATE_FAILED,
      WORKSPACE_SERVICE.STATE_STOPPED,
    ]),
  })
  .passthrough();
export type WorkspaceUnavailableDetails = z.infer<typeof WorkspaceUnavailableDetails>;

// ── the roots registry on disk (`LAYOUT.WORKSPACE_ROOTS_FILE`) ──
//
// fieldd's own file (TerminalBindingsFile's precedent): places and picked
// directories persist; browse exports are enumerated live. Places also keep
// the last agent start. Saved roots are retained when missing (PJ's rule).

export const WorkspacePlaceRecord = z
  .object({
    path: z.string().min(1),
    addedAt: z.string().min(1).max(64),
    lastActiveAt: z.string().min(1).max(64),
    missing: z.boolean().optional(),
    /** R6 (2026-10-07), additive to v1 — the place's canonical identity: its
     * real path when a run last touched it. A place whose real path no longer
     * matches (the folder swapped for a link) or is a filesystem root reads
     * `missing`. `path` stays the key, the cwd as given (`/tmp/x` resolves to
     * `/private/tmp/x` on macOS and is still present). Absent on a place
     * recorded before the field: it adopts its real path at the first refresh
     * that finds the folder there and not a filesystem root (fieldd roots.ts). */
    realPath: z.string().min(1).max(WORKSPACE_LIMITS.PATH_CHARS).optional(),
  })
  .passthrough();
export type WorkspacePlaceRecord = z.infer<typeof WorkspacePlaceRecord>;

export const WorkspacePickedRecord = z
  .object({
    path: z.string().min(1).max(WORKSPACE_LIMITS.PATH_CHARS),
    addedAt: z.string().min(1).max(64),
    missing: z.boolean().optional(),
  })
  .passthrough();
export type WorkspacePickedRecord = z.infer<typeof WorkspacePickedRecord>;

export const WorkspaceRootsFile = z
  .object({
    version: z.literal(1),
    places: z.array(WorkspacePlaceRecord),
    // Additive to v1: older registries contain places alone.
    picked: z.array(WorkspacePickedRecord).optional(),
  })
  .passthrough();
export type WorkspaceRootsFile = z.infer<typeof WorkspaceRootsFile>;

// ── the git port (FS-D8's interim; L7) ──
//
// rosetta's room speaks to its git column over a second MessagePort with a
// plain request/response protocol — `{id, op, args}` in, `{id, ok, value}` or
// `{id, ok: false, error}` out, every failure a VALUE (`fx-host.mjs`). The
// files worker serves the same protocol, read-only (FS-D5), so FS-1b can hand
// the room a port that speaks it; `fixtures/workspace-git-port.valid.json`
// pins one exchange per op.

export const WorkspaceGitOp = z.enum([...WORKSPACE_GIT.READ_OPS, ...WORKSPACE_GIT.WRITE_OPS]);
export type WorkspaceGitOp = z.infer<typeof WorkspaceGitOp>;

export const WorkspaceGitPortRequest = z
  .object({
    id: z.number().int(),
    /** an op the port does not know is answered `unknown op: <op>` */
    op: z.string().min(1).max(64),
    args: z.unknown().optional(),
  })
  .passthrough();
export type WorkspaceGitPortRequest = z.infer<typeof WorkspaceGitPortRequest>;

export const WorkspaceGitPortResponse = z.union([
  z.object({ id: z.number().int(), ok: z.literal(true), value: z.unknown() }).passthrough(),
  z.object({ id: z.number().int(), ok: z.literal(false), error: z.string() }).passthrough(),
]);
export type WorkspaceGitPortResponse = z.infer<typeof WorkspaceGitPortResponse>;

/** One request and the answer's SHAPE (the fixture's values are examples; a
 * reader compares `ok` and the value's keys, never shas or dates). */
export const WorkspaceGitPortExchange = z
  .object({ request: WorkspaceGitPortRequest, response: WorkspaceGitPortResponse })
  .passthrough();
export type WorkspaceGitPortExchange = z.infer<typeof WorkspaceGitPortExchange>;

export const WorkspaceGitPortTranscript = z
  .object({ exchanges: z.array(WorkspaceGitPortExchange).min(1) })
  .passthrough();
export type WorkspaceGitPortTranscript = z.infer<typeof WorkspaceGitPortTranscript>;

/** FS-1b: an attached tree and git port on the same worker listener. */
const WorkspaceLoopbackSocket = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "ws:" &&
      url.hostname === "127.0.0.1" &&
      url.port !== "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  }, "expected a credential-free loopback WebSocket endpoint");
export const WorkspaceEndpointSet = z
  .object({
    treeUrl: WorkspaceLoopbackSocket,
    gitUrl: WorkspaceLoopbackSocket,
  })
  .passthrough();
export type WorkspaceEndpointSet = z.infer<typeof WorkspaceEndpointSet>;
export const WorkspaceOpenTicketParams = z
  .object({
    rootId: WorkspaceRootId,
    path: WorkspaceRelativePath.optional(),
    device: z.string().min(1).max(256).optional(),
  })
  .passthrough();
export type WorkspaceOpenTicketParams = z.infer<typeof WorkspaceOpenTicketParams>;
export const WorkspaceCredential = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const WorkspaceOpenTicketResult = z
  .object({
    device: z.string().min(1).max(256),
    rootId: WorkspaceRootId,
    rootPath: z.string().min(1).max(WORKSPACE_LIMITS.PATH_CHARS),
    endpoints: WorkspaceEndpointSet,
    ticket: WorkspaceCredential,
    gitTicket: WorkspaceCredential,
    expiresAt: z.number().int().positive(),
    generation: z.number().int().positive(),
    access: z.literal("read-only"),
  })
  .passthrough();
export type WorkspaceOpenTicketResult = z.infer<typeof WorkspaceOpenTicketResult>;
export const WorkspaceCloseTicketParams = z.object({ ticket: WorkspaceCredential }).passthrough();
export type WorkspaceCloseTicketParams = z.infer<typeof WorkspaceCloseTicketParams>;
export const WorkspaceCloseTicketResult = z.object({ closed: z.boolean() }).passthrough();
export type WorkspaceCloseTicketResult = z.infer<typeof WorkspaceCloseTicketResult>;

export const WorkspaceGitOpen = z
  .object({
    type: z.literal("open"),
    rootId: WorkspaceRootId,
    credential: WorkspaceCredential,
  })
  .passthrough();
export const WorkspaceGitOpened = z.object({ type: z.literal("ready") }).passthrough();

export const WorkspaceFileActionParams = z
  .object({
    rootId: WorkspaceRootId,
    path: WorkspaceRelativePath,
    action: z.enum(["copyPath", "revealInFileManager"]),
  })
  .passthrough();
export const WorkspaceFileActionResult = z.object({ path: z.string().min(1) }).passthrough();
