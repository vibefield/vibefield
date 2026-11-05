import { NEEDS_NAME_MAX } from "./compose";

// SP-1e2's renderer half (SR-Q4 (a), VF-PM 2026-11-05 11:03Z) — how VibeField names a session where it can say no
// handle, ONE rule for fieldd and the window: fieldd's wakes, items and notices (CO-1b, CO-Q4 (b); fieldd's
// `rooms/you/words.ts` re-exports these), and Chat's crew card for a member @ does not offer. Lifted from fieldd's words
// unchanged. Pure; no I/O.

/** `s` cut to at most `n` UTF-16 units, the last of them "…", never splitting a surrogate pair (zod's `max` counts the
 * same units). */
export function clipWords(s: string, n: number): string {
  if (s.length <= n) return s;
  let cut = s.slice(0, Math.max(0, n - 1));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Whitespace runs, line breaks among them, said as one space; trimmed. */
export const collapseWords = (s: string): string => s.replace(/\s+/g, " ").trim();

/** One line of at most `n`. */
export const oneLineWords = (s: string, n: number): string => clipWords(collapseWords(s), n);

/** A name as an item or a fact says it: a session's title, an agent's label, a spark's name. */
export const nameWords = (s: string): string => oneLineWords(s, NEEDS_NAME_MAX);

/** What a session is named by: fieldd reads them from the run's row (daemon.ts's runLabel); the window reads the
 * field row, which carries no title (it is content-free), so the window's name is the label in the folder. */
export interface SessionNaming {
  /** the session's own title */
  readonly title?: string | undefined;
  /** its agent's label in the catalog (AC-D4) */
  readonly label?: string | undefined;
  /** the folder it works in, as @ and the board name it (agent-field.ts's folderNameOf; the row's `project.name`) */
  readonly folder?: string | undefined;
  readonly id: string;
}

/** CO-1b (CO-Q4 (b)) — a session as VibeField names it: its title, else its agent's label in its folder ("Claude Code
 * in vibe-field"), else that label, else its id; one line, cut at NEEDS_NAME_MAX. Two untitled sessions in one folder
 * still read alike here (the handle tells them apart where @ offers one). */
export function sessionName(run: SessionNaming): string {
  const said = (s: string | undefined): string | undefined =>
    s === undefined || collapseWords(s) === "" ? undefined : collapseWords(s);
  const title = said(run.title);
  if (title !== undefined) return nameWords(title);
  const label = said(run.label);
  if (label === undefined) return nameWords(run.id);
  const folder = said(run.folder);
  return nameWords(folder === undefined ? label : `${label} in ${folder}`);
}
