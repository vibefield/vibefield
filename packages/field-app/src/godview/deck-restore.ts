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

/** A persisted pane's cwd as a FILESYSTEM PATH, or null if there is not one.
 *
 * This exists because of what the floor actually reports, which is not what the
 * field name suggests: a session's `cwd` is whatever the shell announced over
 * OSC 7, verbatim, and that is a URL — `file://Jamess-MacBook-Pro.local/Users/
 * jamesyong`, percent-encoded, host and all. (It is also the ONLY source: a
 * session's spawn directory is not reported, so a shell with no integration
 * emitting OSC 7 has no cwd at all, and its restored pane honestly lands at
 * home.) Handing that string to a spawn's `cwd` would fail to chdir and the
 * pane would be dropped instead of relaunched — silently, because a failed
 * rehydration is a dropped pane by design.
 *
 * Both shapes are accepted, because a later ghosttea reporting a plain path
 * must not break this, and a tolerant reader does not insist on the shape it
 * happens to see today.
 *
 * Named residual: a `file://` URL carries the HOST that reported it, and this
 * ignores it. Every pane is local today (`enableRemoteSessions` is off until
 * GT-4), so there is nothing yet to confuse — but when remote panes light up, a
 * peer's path used locally is a real mistake and this is where it would be
 * caught, by comparing that host against this device's.
 */
export function paneCwd(meta: unknown): string | null {
  const value = (meta as { cwd?: unknown } | null)?.cwd;
  if (typeof value !== "string" || value === "") return null;
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;
    const path = decodeURIComponent(url.pathname);
    return path === "" ? null : path;
  } catch {
    return null;
  }
}

/** The consent face's fact line. Sentence-shaped rather than a template with
 * holes: "1 pane" and "2 panes" both have to read like English, and a user
 * about to relaunch shells in folders is owed a sentence, not a legend. */
export function restoreSentence(question: RestoreQuestion): string {
  const panes = (count: number): string => `${count} pane${count === 1 ? "" : "s"}`;
  const rejoin =
    question.alive === 0
      ? "none are still running"
      : `${panes(question.alive)} ${question.alive === 1 ? "is" : "are"} still running and rejoin`;
  const relaunch = `${panes(question.dead)} ended — restoring opens a new shell in ${
    question.dead === 1 ? "its folder" : "their folders"
  }`;
  return `${rejoin} · ${relaunch}`;
}
