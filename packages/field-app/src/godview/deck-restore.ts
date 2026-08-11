// The restore question, as arithmetic (GT-3, GT-D8 as amended).
//
// Layer 1 of restore is the workspace's own localStorage layout; layer 2 —
// the "manifest of meaning" — is `paneMeta`, cwd and title riding that same
// document. There is no fieldd-side manifest: the settings-doc refused it (its
// law admits only user-scope keys, and a pane's cwd is device state), and a
// device-scope store gets built when a READER exists that `paneMeta` cannot
// serve. Today none does.
//
// What lives here is the part that must be true before any pixel is drawn: how
// many panes the last session had, how many of them the floor still holds, and
// how many would have to be RELAUNCHED. Only the third number justifies asking
// the user anything, and it is the whole reason this is a pure function — the
// consent face is a claim about the floor, and a claim is worth testing.

/** What a restore would do, in the numbers the consent face states. */
export interface RestoreQuestion {
  /** panes the saved layout holds */
  saved: number;
  /** of those, sessions the floor still lists — they rejoin by id, untouched */
  alive: number;
  /** of those, sessions that are gone — restoring relaunches a shell for each */
  dead: number;
}

/** The pane session ids a saved deck layout references, in tree order.
 *
 * Deliberately its own tiny reader rather than an import of ghosttea's
 * `decodeWorkspaceDocument`: this runs BEFORE the workspace mounts, it must
 * survive a document from an older (or newer) schema without throwing, and it
 * needs exactly one field. A shape it does not recognise yields no ids, which
 * makes the caller's answer "no layout" — GT-D8's malformed-manifest rule,
 * arrived at by reading rather than by catching.
 *
 * Both persisted pane shapes are read: `sessionId`, and the pre-v1 nested
 * `session.id` that ghosttea's own `restoreNode` still accepts. Believing only
 * the modern one would call a restorable layout empty and start clean without
 * asking.
 */
export function savedPaneSessionIds(raw: string | null): string[] {
  if (raw === null) return [];
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return [];
  }
  const root = (document as { root?: unknown; layout?: unknown } | null)?.root;
  const legacy = (document as { layout?: unknown } | null)?.layout;
  const ids: string[] = [];
  collect(root ?? legacy, ids);
  return ids;
}

function collect(node: unknown, into: string[]): void {
  if (node === null || typeof node !== "object") return;
  const candidate = node as Record<string, unknown>;
  if (candidate["kind"] === "pane") {
    const direct = candidate["sessionId"];
    if (typeof direct === "string") {
      into.push(direct);
      return;
    }
    const nested = (candidate["session"] as { id?: unknown } | undefined)?.id;
    if (typeof nested === "string") into.push(nested);
    return;
  }
  if (candidate["kind"] !== "split") return;
  collect(candidate["first"], into);
  collect(candidate["second"], into);
}

/** Saved panes against the live floor. Duplicate ids are counted once — two
 * panes cannot hold one session in a restored layout (ghosttea's `restoreNode`
 * maps ids to sessions, so a repeated id would revive as the same session), and
 * counting it twice would over-state the question. */
export function restoreQuestion(
  savedIds: readonly string[],
  liveIds: readonly string[],
): RestoreQuestion {
  const live = new Set(liveIds);
  const unique = [...new Set(savedIds)];
  const alive = unique.filter((id) => live.has(id)).length;
  return { saved: unique.length, alive, dead: unique.length - alive };
}

/** Where this device's own shells say they are, remembered from a pane the deck
 * knew was local. Viewer-local device state, so it lives beside the deck's
 * layout rather than in any document a daemon owns. */
const DEVICE_HOST_STORAGE_KEY = "vf-godview-device-host-v1";

/** The host a `file://` URL names, normalized for comparison: lower-cased, with
 * the trailing dot an FQDN may carry removed. Empty for a plain path, for a
 * hostless `file:///…`, and for `localhost` — RFC 8089 reads all three as "the
 * machine reading this", which is what makes them safe to spawn on. */
export function paneCwdHost(value: string): string {
  if (value.startsWith("/")) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return "";
    const host = url.hostname.replace(/\.$/, "").toLowerCase();
    return host === "localhost" ? "" : host;
  } catch {
    return "";
  }
}

/**
 * This device's name as its own shells announce it, or null before one has.
 *
 * There is no contract that hands the renderer a hostname — main answers the
 * connect with `defaultShell` and `home` and nothing else — so this is learned
 * rather than asked for: the first LOCAL pane whose shell emits OSC 7 names
 * this machine in its own cwd, and that name is kept. A machine renamed later
 * heals on the next save; until it does, its panes restore at home, which is
 * the degraded answer and not the wrong one.
 */
export function readDeviceHost(): string | null {
  try {
    const stored = localStorage.getItem(DEVICE_HOST_STORAGE_KEY);
    return stored === null || stored === "" ? null : stored;
  } catch {
    return null;
  }
}

/** Learn this device's host from a pane the caller KNOWS is local. Callers must
 * not pass a replica's cwd: a peer's name stored here would make every one of
 * that peer's paths look like ours. */
export function rememberDeviceHost(cwd: string | null | undefined): void {
  if (typeof cwd !== "string" || cwd === "") return;
  const host = paneCwdHost(cwd);
  // Compared against STORAGE rather than a module cache: this runs on the
  // persist path, so the read is worth its cost to keep the answer a fact about
  // what is stored instead of about what this module last did.
  if (host === "" || host === readDeviceHost()) return;
  try {
    localStorage.setItem(DEVICE_HOST_STORAGE_KEY, host);
  } catch {
    // A page with no storage restores at home. Honest, and not worth a face.
  }
}

/** A persisted pane's cwd as a LOCAL FILESYSTEM PATH, or null if there is not
 * one — including the case this function exists to catch: a path on ANOTHER
 * MACHINE.
 *
 * What the floor reports is not what the field name suggests: a session's `cwd`
 * is whatever the shell announced over OSC 7, verbatim, and that is a URL —
 * `file://Jamess-MacBook-Pro.local/Users/jamesyong`, percent-encoded, host and
 * all. (It is also the ONLY source: a session's spawn directory is not
 * reported, so a shell with no integration emitting OSC 7 has no cwd at all,
 * and its restored pane honestly lands at home.) Handing that string to a
 * spawn's `cwd` would fail to chdir and the pane would be dropped instead of
 * relaunched — silently, because a failed rehydration is a dropped pane by
 * design.
 *
 * Both shapes are accepted, because a later ghosttea reporting a plain path
 * must not break this, and a tolerant reader does not insist on the shape it
 * happens to see today.
 *
 * THE HOST IS CONSULTED, in two ways, and this is no longer the conditional the
 * GT-3 comment left here (see the 2026-08-06 erratum: the spec read that TODO
 * as a safeguard that existed, and GT-4 then lit up remote panes against it):
 *
 *   1. `remoteDevice` — stamped into the meta by the deck at persist time for a
 *      pane showing a PEER'S replica. Positive knowledge, taken at the one
 *      moment it is certain, and the branch that makes the promise true.
 *   2. the URL's own host against `localHost`. A foreign host is refused; an
 *      empty host and `localhost` are this machine by RFC 8089.
 *
 * With no `localHost` learned yet, a hosted URL is accepted — the pre-GT-5c
 * behaviour, reachable only by a layout persisted before this slice, and by
 * then rule 1 covers every pane written since.
 */
export function paneCwd(meta: unknown, localHost?: string | null): string | null {
  const record = meta as { cwd?: unknown; remoteDevice?: unknown } | null;
  // A peer's pane. Its path is a path on that peer, and a local shell opened in
  // it is either the wrong machine's directory or a spawn failure — which is a
  // silently dropped pane. Home is the honest answer for both.
  if (typeof record?.remoteDevice === "string" && record.remoteDevice !== "") return null;
  const value = record?.cwd;
  if (typeof value !== "string" || value === "") return null;
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;
    const host = paneCwdHost(value);
    const here = localHost === undefined || localHost === null ? "" : localHost.toLowerCase();
    if (host !== "" && here !== "" && host !== here.replace(/\.$/, "")) return null;
    const path = decodeURIComponent(url.pathname);
    return path === "" ? null : path;
  } catch {
    return null;
  }
}

/** The consent face's fact line. Sentence-shaped rather than a template with
 * holes: "1 pane" and "2 panes" both have to read like English, and a user
 * about to relaunch shells in folders is owed a sentence, not a legend.
 *
 * `on this machine` is the correction the erratum asked for and not a flourish:
 * a pane can only be relaunched in the folder it left when that folder is HERE,
 * and a pane that was a peer's — or whose shell never announced one — starts at
 * home instead. The old sentence promised the folder unconditionally. */
export function restoreSentence(question: RestoreQuestion): string {
  const panes = (count: number): string => `${count} pane${count === 1 ? "" : "s"}`;
  const rejoin =
    question.alive === 0
      ? "none are still running"
      : `${panes(question.alive)} ${question.alive === 1 ? "is" : "are"} still running and rejoin`;
  const relaunch = `${panes(question.dead)} ended — restoring opens a new shell in ${
    question.dead === 1 ? "its folder" : "their folders"
  } on this machine, at home where there is none`;
  return `${rejoin} · ${relaunch}`;
}
