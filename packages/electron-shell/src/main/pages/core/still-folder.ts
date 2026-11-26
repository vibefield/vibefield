// EY-1 (2026-11-19) — A STILL'S FOLDER AND FILE (track EY; BU-12, MT-D10). An agent's still is the engine's own
// screenshot, one frame, written by the engine into the run's private folder: one folder per run under fieldd's own
// state, 0700, forgotten with the run's record, or once its newest still is older than PAGES_STILLS_MAX_AGE_MS
// (provisional). fieldd names it on the control call (`folder`), never the agent.
// Private means out of the run's working folder and from other OS users, NOT from another run of the same person: an
// agent runs as the person's uid (EL7), so once a still is written it can list the folder and read it. The name below
// guards the write, never the read; real separation needs an agent sandbox or a second uid.
// Main judges the folder before the engine runs and the file after it wrote; the result names the file, and its
// bytes never cross (EL2).
//
// The engine writes with a plain create-and-truncate (`std::fs::write`): it follows a link at the name and does not
// refuse a name that exists. So THE NAME IS THE GUARD: main mints it from 128 random bits, and only main and the
// engine's socket ever know it before the file exists. A same-uid process (EL7) cannot plant a link at a name it
// cannot guess, and main checks the name is free just before the send. After the write, main judges what it OPENED
// (never through a link, by its handle): a regular file of ours, with one link, within an agent's still bound
// (PAGES_STILL_MAX_BYTES), a PNG.
//
// Pure: the facts are handed in (`lstat` of each part of the folder; `fstat` of the opened file and its first bytes).
// The broker reads them; this file decides.

import { PAGES_STILL_MAX_BYTES } from "@vibefield/contracts";

/** The random bytes a still's name is minted from: 128 bits. */
export const STILL_NAME_RANDOM_BYTES = 16;

/** The first bytes of a still main reads to judge it: the PNG signature and the IHDR chunk's size fields. */
export const STILL_HEAD_BYTES = 24;

/** The longest folder path main takes, and the longest part of one (POSIX's NAME_MAX). */
export const STILL_FOLDER_MAX = 4096;
const PART_MAX = 255;

/** Why a still's folder or file was refused. */
export type StillRefusal =
  | "folder-not-absolute"
  | "folder-bad-part"
  | "folder-too-long"
  | "folder-link"
  | "folder-not-directory"
  | "folder-not-ours"
  | "folder-shared"
  | "answered-path"
  | "not-a-file"
  | "not-ours"
  | "linked"
  | "too-large"
  | "not-png";

export type StillVerdict<T> =
  | ({ readonly ok: true } & T)
  | { readonly ok: false; readonly reason: StillRefusal };

/** What `lstat` says of one part of the folder: never followed through a link. */
export interface StillEntryFacts {
  readonly kind: "directory" | "file" | "link" | "other";
  readonly uid: number;
  readonly mode: number;
}

/** What the opened still's handle says (`fstat`). */
export interface StillFileFacts {
  readonly kind: "directory" | "file" | "link" | "other";
  readonly uid: number;
  readonly nlink: number;
  readonly size: number;
}

/** The still a call wrote, as the control result carries it (DR's ShellSurfacesStill). */
export interface StillAnswer {
  readonly path: string;
  readonly mime: "image/png";
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

/** The folder's shape, before any disk is read: POSIX absolute, no NUL, no empty, `.` or `..` part, no trailing
 * slash, within the bounds. Its answer lists every path from the first part down to the folder itself, in order:
 * each one the broker `lstat`s. */
export function folderShape(
  folder: string,
): StillVerdict<{ readonly prefixes: readonly string[] }> {
  if (!folder.startsWith("/")) return { ok: false, reason: "folder-not-absolute" };
  if (folder.length > STILL_FOLDER_MAX) return { ok: false, reason: "folder-too-long" };
  if (folder.includes("\0")) return { ok: false, reason: "folder-bad-part" };
  const parts = folder.slice(1).split("/");
  const prefixes: string[] = [];
  let at = "";
  for (const part of parts) {
    if (part === "" || part === "." || part === ".." || part.length > PART_MAX) {
      return { ok: false, reason: "folder-bad-part" };
    }
    at = `${at}/${part}`;
    prefixes.push(at);
  }
  return { ok: true, prefixes };
}

/** The folder judged from its parts' `lstat` facts, one per prefix in `folderShape`'s order. No part is a link and
 * each is a directory. The parts above the folder are ours or root's, and none is writable by others unless sticky.
 * The folder itself is ours and its owner's alone: no group or other bit at all. */
export function judgeFolder(parts: readonly StillEntryFacts[], uid: number): StillVerdict<object> {
  if (parts.length === 0) return { ok: false, reason: "folder-bad-part" };
  for (const [i, part] of parts.entries()) {
    if (part.kind === "link") return { ok: false, reason: "folder-link" };
    if (part.kind !== "directory") return { ok: false, reason: "folder-not-directory" };
    const last = i === parts.length - 1;
    if (last) {
      if (part.uid !== uid) return { ok: false, reason: "folder-not-ours" };
      // fieldd makes the run's folder 0700 and main refuses anything wider: a picture of an agent's page is for no
      // other account on the Mac, to read or to write.
      if ((part.mode & 0o077) !== 0) return { ok: false, reason: "folder-shared" };
    } else {
      if (part.uid !== uid && part.uid !== 0) return { ok: false, reason: "folder-not-ours" };
      if ((part.mode & 0o002) !== 0 && (part.mode & 0o1000) === 0) {
        return { ok: false, reason: "folder-shared" };
      }
    }
  }
  return { ok: true };
}

/** A still's name from 128 random bits (the caller's `randomBytes`). Never the agent's, never a time. */
export function mintStillName(random: Uint8Array): string {
  if (random.length !== STILL_NAME_RANDOM_BYTES) {
    throw new RangeError(`a still's name takes ${STILL_NAME_RANDOM_BYTES} random bytes`);
  }
  let hex = "";
  for (const byte of random) hex += byte.toString(16).padStart(2, "0");
  return `still-${hex}.png`;
}

/** The still's path: the name directly in the folder. */
export function stillPath(folder: string, name: string): string {
  return `${folder}/${name}`;
}

/** The engine's command for a still: the call's checked `screenshot` command with `path` set to the minted path,
 * PNG forced, and every way the engine could choose another place or format taken out. */
export function stillCommand(
  command: { readonly action: string; readonly [field: string]: unknown },
  path: string,
): { readonly action: "screenshot"; readonly [field: string]: unknown } {
  if (command.action !== "screenshot") throw new TypeError("a still's command is a screenshot");
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(command)) {
    if (
      key === "path" ||
      key === "screenshotDir" ||
      key === "format" ||
      key === "type" ||
      key === "quality"
    ) {
      continue;
    }
    out[key] = value;
  }
  out.path = path;
  out.format = "png";
  return out as { readonly action: "screenshot"; readonly [field: string]: unknown };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const IHDR = [0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52] as const;

/** A PNG's size from its first 24 bytes: the signature, then the IHDR chunk (length 13), its width and height
 * big-endian. Null for anything else, a zero side or one past PNG's 2^31 − 1. */
export function pngSize(
  head: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  if (head.length < STILL_HEAD_BYTES) return null;
  for (const [i, byte] of PNG_SIGNATURE.entries()) if (head[i] !== byte) return null;
  for (const [i, byte] of IHDR.entries()) if (head[8 + i] !== byte) return null;
  const view = new DataView(head.buffer, head.byteOffset, STILL_HEAD_BYTES);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const max = 2 ** 31 - 1;
  if (width === 0 || height === 0 || width > max || height > max) return null;
  return { width, height };
}

/** The still the engine wrote, judged by what main opened. The engine answered the very path main sent; the file
 * opened is a regular file of ours with one link, within the still cap, and a PNG. Its answer is the control
 * result's `still`. Its cap is an agent's still bound, PAGES_STILL_MAX_BYTES, never SCREENSHOT_STILL.MAX_BYTES, which
 * bounds the person's own screenshot: the two are kept apart, so either may move without the other. */
export function judgeWritten(o: {
  readonly facts: StillFileFacts;
  readonly head: Uint8Array;
  readonly sent: string;
  readonly answered: unknown;
  readonly uid: number;
  readonly maxBytes?: number;
}): StillVerdict<{ readonly still: StillAnswer }> {
  if (o.answered !== o.sent) return { ok: false, reason: "answered-path" };
  if (o.facts.kind !== "file") return { ok: false, reason: "not-a-file" };
  if (o.facts.uid !== o.uid) return { ok: false, reason: "not-ours" };
  if (o.facts.nlink !== 1) return { ok: false, reason: "linked" };
  if (o.facts.size > (o.maxBytes ?? PAGES_STILL_MAX_BYTES))
    return { ok: false, reason: "too-large" };
  const size = pngSize(o.head);
  if (size === null || o.facts.size < STILL_HEAD_BYTES) return { ok: false, reason: "not-png" };
  return {
    ok: true,
    still: {
      path: o.sent,
      mime: "image/png",
      width: size.width,
      height: size.height,
      bytes: o.facts.size,
    },
  };
}
