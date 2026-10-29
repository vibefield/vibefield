#!/usr/bin/env node
// AU-6 (AU-D10 A; LC-19; EDP §11.1 as amended 2026-10-29: "no remote markup; signed plain text only") — the release's
// NOTES, computed in the sign job before the merge, so they ride inside `release-manifest.json` under its one `release`
// signature (no new signature, no new key). The output is `ReleaseNotes` (packages/contracts/src/update-policy.ts),
// parsed here before it is written: a block this tool writes is a block `release-verify` accepts.
//   - a STABLE says what is in it by hand: `apps/desktop/packaging/notes/<X.Y.Z>.txt` (≤ 8 lines, the README there),
//     and REFUSES to publish without it (kind "written");
//   - a BETA uses that file when it is there, else the log form;
//   - a NIGHTLY reads the log since the channel's previous release (kind "log"): the non-merge commits in
//     `previous..commit`, how many are outside the docs (a `docs:` or `docs(…):` subject is the docs), and the newest
//     subject per track prefix ("AU-6: …", "FN: …"), newest first, at most 4, each cut at its first " — " and at
//     200 characters on a word boundary. A `Release-note:` trailer gives its commit's line its words.
// A first release of its channel (no previous manifest) carries no notes: nothing is written, and `merge` reads none.
// `since` is read from the SAME previous manifest `merge` names in `previous`, so the count and the manifest agree.
//
// usage: node scripts/release-notes.mjs --channel <nightly|beta|stable> --version <v> --commit <sha>
//          --previous <previous release-manifest.json> --out <notes.json> [--tag <tag>]
//          [--notes-dir apps/desktop/packaging/notes]

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The contracts' TypeScript runs as release-verify.mjs runs it: Node strips the types, and an extensionless relative
// import is retried as `.ts`. The sign job installs `@vibefield/contracts` alone (zod), with no lifecycle scripts.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !specifier.endsWith(".ts") &&
        context.parentURL !== undefined &&
        !context.parentURL.includes("/node_modules/")
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
const { RELEASE_NOTES_LIMITS, ReleaseNotes } = await import(
  pathToFileURL(join(repo, "packages/contracts/src/index.ts")).href
);

export const NOTES_DIR = join(repo, "apps/desktop/packaging/notes");
const CHANNELS = ["nightly", "beta", "stable"];
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const COMMIT = /^[0-9a-f]{40}$/;
/** LC-19: the docs are a `docs:` or `docs(…):` subject; they count in `commits`, never in `product` or the lines */
const DOCS = /^docs(\([^)]*\))?:/i;
/** what a note may not hold (ReleaseNoteText's rule): control, format, line and paragraph separators */
const NOT_PLAIN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/** a prefix that is a sentence's, not a track's: a quote (`Revert "AU-6: …"`), a backtick, or the dash */
const NOT_A_TRACK = /["'`]| — /;

export class ReleaseNotesError extends Error {}
const refuse = (message) => {
  throw new ReleaseNotesError(message);
};

/** The written notes' file for a version: its core, so a beta of 0.2.0 reads the 0.2.0 stable's words. */
export function notesFileOf(version) {
  const core = /^(\d+\.\d+\.\d+)/.exec(version)?.[1];
  if (core === undefined) refuse(`"${version}" is not a release version`);
  return `${core}.txt`;
}

export function isDocsSubject(subject) {
  return DOCS.test(subject.trim());
}

/** One line of plain text: format characters (bidi overrides, zero-width) removed, controls and separators made
 * spaces, runs of space collapsed. */
export function plainText(text) {
  return text
    .replace(/\p{Cf}/gu, "")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** A line cut to `max` characters on a word boundary, with "…" (measured subjects run to 488). A single word longer
 * than the room is cut where it stands, never inside a surrogate pair. */
export function capLine(text, max = RELEASE_NOTES_LIMITS.LINE_CHARS) {
  if (text.length <= max) return text;
  // one character is the ellipsis's; the room ends on a word when the next character is a space
  let cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  if (text[max - 1] !== " " && space > 0) cut = cut.slice(0, space);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut.replace(/[\s,;:—–-]+$/u, "")}…`;
}

/** A commit's line: its track (the subject's prefix before the first ": ", at most 24 characters) and its words
 * (the rest, cut at its first " — "), or its `Release-note:` trailer's words when it has one. Null for the docs and
 * for a commit that leaves nothing to say. */
export function noteLine({ subject, releaseNote }) {
  if (isDocsSubject(subject)) return null;
  const flat = plainText(subject);
  const colon = flat.indexOf(": ");
  const prefix = colon > 0 ? flat.slice(0, colon).trim() : "";
  const tracked =
    prefix !== "" && prefix.length <= RELEASE_NOTES_LIMITS.TRACK_CHARS && !NOT_A_TRACK.test(prefix);
  const rest = tracked ? flat.slice(colon + 2) : flat;
  const dash = rest.indexOf(" — ");
  const subjectWords = dash > 0 ? rest.slice(0, dash) : rest;
  // the trailer was written for the notes: it replaces the subject's words whole (never cut at a dash)
  const trailer = typeof releaseNote === "string" ? plainText(releaseNote) : "";
  const text = capLine((trailer !== "" ? trailer : subjectWords).trim());
  if (text === "") return null;
  return { ...(tracked ? { track: prefix } : {}), text };
}

/** The log form (a nightly, or a beta with no file): `commits` newest first, as `git log` lists them. At most one line
 * per track (the untracked count as one), up to LOG_LINES. */
export function logNotes({ since, commits }) {
  let product = 0;
  const seen = new Set();
  const lines = [];
  for (const commit of commits) {
    if (isDocsSubject(commit.subject)) continue;
    product += 1;
    if (lines.length === RELEASE_NOTES_LIMITS.LOG_LINES) continue;
    const line = noteLine(commit);
    if (line === null || seen.has(line.track ?? "")) continue;
    seen.add(line.track ?? "");
    lines.push(line);
  }
  return ReleaseNotes.parse({ kind: "log", since, commits: commits.length, product, lines });
}

/** The written form: one note per non-empty line, `#` lines ignored. Refuses what the window would not show as it
 * was written — more than WRITTEN_LINES lines, a line over LINE_CHARS, a control or format character — so a bad file
 * fails the release before signing, never a client after. */
export function writtenNotes(text, since, source = "the notes file") {
  const lines = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.length > RELEASE_NOTES_LIMITS.LINE_CHARS)
      refuse(
        `${source}: line ${index + 1} is ${line.length} characters; a note is at most ${RELEASE_NOTES_LIMITS.LINE_CHARS}`,
      );
    if (NOT_PLAIN.test(line))
      refuse(
        `${source}: line ${index + 1} holds a control or format character; a note is one line of plain text`,
      );
    lines.push(line);
  }
  if (lines.length === 0)
    refuse(
      `${source} says nothing: a written release has 1 to ${RELEASE_NOTES_LIMITS.WRITTEN_LINES} lines`,
    );
  if (lines.length > RELEASE_NOTES_LIMITS.WRITTEN_LINES)
    refuse(
      `${source} has ${lines.length} lines; a written release says at most ${RELEASE_NOTES_LIMITS.WRITTEN_LINES}`,
    );
  return ReleaseNotes.parse({ kind: "written", since, lines });
}

/** LC-19's decision. `previous` is the channel's previous release (its manifest's version, tag and commit) or null;
 * `written` the text of `<X.Y.Z>.txt`, or null when there is none; `log(from)` lists the non-merge commits in
 * `from..commit`, newest first, and is called only for the log form. Null: no notes (a first release). */
export function computeNotes({ channel, version, previous, written, log }) {
  if (!CHANNELS.includes(channel)) refuse(`unknown channel "${channel}"`);
  const since = previous === null ? null : { version: previous.version, tag: previous.tag };
  if (channel === "stable" && written === null)
    refuse(
      `a stable says what is in it: apps/desktop/packaging/notes/${notesFileOf(version)} is missing (the format is that directory's README)`,
    );
  if (written !== null && channel !== "nightly")
    return writtenNotes(written, since, `notes/${notesFileOf(version)}`);
  if (since === null) return null;
  return logNotes({ since, commits: log(previous.commit) });
}

/** The previous release, from its manifest: null when there is none (a first release of its channel). */
export function readPrevious(path) {
  if (!existsSync(path)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    refuse(`${path}: not JSON (${error.message})`);
  }
  if (
    !SEMVER.test(doc?.version ?? "") ||
    typeof doc?.tag !== "string" ||
    !COMMIT.test(doc?.commit ?? "")
  )
    refuse(`${path}: not a release manifest (it needs version, tag and commit)`);
  return { version: doc.version, tag: doc.tag, commit: doc.commit };
}

/** The non-merge commits in `from..to`, newest first: each subject, and its `Release-note:` trailer as git reads
 * trailers (the message's last paragraph; folded lines unfolded). */
export function readCommits(from, to, cwd = repo) {
  if (!COMMIT.test(from) || !COMMIT.test(to)) refuse(`git log ${from}..${to}: not two commits`);
  let out;
  try {
    out = execFileSync(
      "git",
      [
        "log",
        "--no-merges",
        "-z",
        "--format=%s%x1f%(trailers:key=Release-note,valueonly,unfold)",
        `${from}..${to}`,
      ],
      { cwd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
    ).toString("utf8");
  } catch (error) {
    refuse(
      `git log ${from}..${to} failed — is the previous release's commit in this checkout (fetch-depth: 0)? ${error.stderr?.toString().trim() || error.message}`,
    );
  }
  return out
    .split("\0")
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [subject = "", trailers = ""] = record.replace(/^\n/, "").split("\x1f");
      const note = trailers
        .split("\n")
        .map((value) => value.trim())
        .find((value) => value !== "");
      return { subject, ...(note !== undefined ? { releaseNote: note } : {}) };
    });
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--")) refuse(`unexpected argument "${key}"`);
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const a = args(process.argv.slice(2));
    if (!a.channel || !a.version || !a.commit || !a.previous || !a.out)
      refuse("--channel, --version, --commit, --previous and --out are required");
    if (!SEMVER.test(a.version)) refuse(`--version "${a.version}" is not a semver version`);
    if (!COMMIT.test(a.commit)) refuse(`--commit "${a.commit}" is not a full commit sha`);
    const file = join(a["notes-dir"] ?? NOTES_DIR, notesFileOf(a.version));
    const previous = readPrevious(a.previous);
    const notes = computeNotes({
      channel: a.channel,
      version: a.version,
      previous,
      written: existsSync(file) ? readFileSync(file, "utf8") : null,
      log: (from) => readCommits(from, a.commit),
    });
    const name = a.tag ?? a.version;
    if (notes === null) {
      rmSync(a.out, { force: true });
      console.log(
        `release-notes: ${name} is its channel's first release (no previous manifest): no notes`,
      );
    } else {
      writeFileSync(a.out, `${JSON.stringify(notes, null, 2)}\n`);
      const counted =
        notes.kind === "log" ? `, ${notes.commits} commits, ${notes.product} outside the docs` : "";
      console.log(
        `release-notes: ${name} — ${notes.kind} since ${notes.since?.tag ?? "the start"}${counted}, ${notes.lines.length} lines:`,
      );
      for (const line of notes.lines)
        console.log(`  ${typeof line === "string" ? line : `${line.track ?? "·"}: ${line.text}`}`);
    }
  } catch (error) {
    console.error(
      `release-notes: ${error instanceof ReleaseNotesError ? error.message : error.stack}`,
    );
    process.exit(1);
  }
}
