// Types for release-notes.mjs (AU-6): the tests import it from TypeScript. The notes are `ReleaseNotes`
// (packages/contracts/src/update-policy.ts), which the script parses before it returns or writes them.
export interface NotesSince {
  version: string;
  tag: string;
}
/** the channel's previous release, read from its manifest */
export interface PreviousRelease extends NotesSince {
  commit: string;
}
/** one non-merge commit, as `git log` lists it */
export interface NotesCommit {
  subject: string;
  /** its `Release-note:` trailer's value, when it has one */
  releaseNote?: string;
}
export interface NoteLine {
  track?: string;
  text: string;
}
export interface WrittenNotes {
  kind: "written";
  since: NotesSince | null;
  lines: string[];
}
export interface LogNotes {
  kind: "log";
  since: NotesSince;
  commits: number;
  product: number;
  lines: NoteLine[];
}
export type ComputedNotes = WrittenNotes | LogNotes;

export declare const NOTES_DIR: string;
export declare class ReleaseNotesError extends Error {}
export declare function notesFileOf(version: string): string;
export declare function isDocsSubject(subject: string): boolean;
export declare function plainText(text: string): string;
export declare function capLine(text: string, max?: number): string;
export declare function noteLine(commit: NotesCommit): NoteLine | null;
export declare function logNotes(input: {
  since: NotesSince;
  commits: readonly NotesCommit[];
}): LogNotes;
export declare function writtenNotes(
  text: string,
  since: NotesSince | null,
  source?: string,
): WrittenNotes;
export declare function computeNotes(input: {
  channel: string;
  version: string;
  previous: PreviousRelease | null;
  written: string | null;
  log: (from: string) => NotesCommit[];
}): ComputedNotes | null;
export declare function readPrevious(path: string): PreviousRelease | null;
export declare function readCommits(from: string, to: string, cwd?: string): NotesCommit[];
