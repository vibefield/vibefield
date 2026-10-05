import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";
import type { WorkspaceRootKind } from "@vibefield/contracts";
import { WORKSPACE_LIMITS } from "@vibefield/contracts/registries";

// FS-1a — the files service's PATH RULE, in one place for both sides of the
// worker's pipe (`thinking-files-service.md` §6; FS-D4 (a) as corrected
// 2026-10-05). A REQUEST names a root by id and a path RELATIVE to it, POSIX
// separators on the wire on every platform; this module is the door's syntax
// check of that path. The worker checks what syntax cannot: a symlink on the
// way (never followed) and the folder's real location (never outside the
// root's). An ANSWER carries the absolute path on this desktop.
//
// Nothing here touches the disk, so the rules are unit-tested per platform.

export type RelativePathVerdict =
  | { ok: true; segments: string[] }
  | { ok: false; reason: "absolute" | "parent" | "invalid" | "too-long" };

/** A request's path, read: the segments below the root, or why it is refused.
 * "" and "." are the root itself; empty and "." segments fold away ("a//b",
 * "a/./b"). Refused: an absolute path (a leading "/" or "\", a drive letter, a
 * UNC prefix), any ".." segment, a backslash or a NUL or another control
 * character in a segment, and anything longer than `WORKSPACE_LIMITS.PATH_CHARS`.
 * A backslash is refused on every platform — it is a separator on Windows,
 * so a request that carries one means something the wire does not. */
export function parseRelativePath(raw: string | undefined): RelativePathVerdict {
  if (raw === undefined) return { ok: true, segments: [] };
  if (raw.length > WORKSPACE_LIMITS.PATH_CHARS) return { ok: false, reason: "too-long" };
  if (raw.startsWith("/") || raw.startsWith("\\")) return { ok: false, reason: "absolute" };
  if (/^[A-Za-z]:/.test(raw)) return { ok: false, reason: "absolute" };
  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return { ok: false, reason: "parent" };
    // biome-ignore lint/suspicious/noControlCharactersInRegex: a path segment carrying a control character is refused on purpose
    if (/[\u0000-\u001f\u007f\\]/.test(segment)) return { ok: false, reason: "invalid" };
    if (segment.length > WORKSPACE_LIMITS.NAME_CHARS) return { ok: false, reason: "too-long" };
    segments.push(segment);
  }
  return { ok: true, segments };
}

/** The words a refusal says, per reason (the caller's to fix). */
export function relativePathRefusal(
  reason: Exclude<RelativePathVerdict, { ok: true }>["reason"],
): string {
  switch (reason) {
    case "absolute":
      return "a path names a folder below its root, relative to it — never an absolute path";
    case "parent":
      return "a path may not climb out of its root (`..`)";
    case "too-long":
      return `a path holds at most ${WORKSPACE_LIMITS.PATH_CHARS} characters`;
    default:
      return "a path's segments may not carry a backslash or a control character";
  }
}

/** A root's id: a digest of its kind and its path — stable across restarts
 * and reinstalls, so a phone's kept id names the same folder tomorrow, and
 * two roots of different kinds over one folder (a place in the home directory)
 * stay two. */
export function rootIdFor(kind: WorkspaceRootKind, path: string): string {
  const digest = createHash("sha256").update(`${kind}\u0000${path}`).digest("hex");
  return `r_${digest.slice(0, 20)}`;
}

/** The folders that are never exports (`thinking-files-service.md` §6): the
 * operating system's own. Checked against the root's REAL path, so an alias
 * (`/tmp` → `/private/tmp`, `/etc` → `/private/etc` on macOS) is caught. The
 * filesystem's root is never one either — it would hold all three. */
const EXCLUDED_POSIX = ["/System", "/Library", "/private"] as const;

export function isExcludedRoot(realPath: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    // a drive's root is a browse export of its own (the enumerator's); a
    // place there would duplicate it, and nothing else on Windows is named
    return false;
  }
  const normalized = posix.normalize(realPath);
  if (normalized === "/") return true;
  return EXCLUDED_POSIX.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

/** Is `candidate` the folder `root` or below it — both REAL paths, the
 * platform's separators? The worker's last check before it lists. */
export function isWithin(root: string, candidate: string, platform: NodeJS.Platform): boolean {
  const path = platform === "win32" ? win32 : posix;
  const relative = path.relative(root, candidate);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/** The folder's own name: its last segment, or the path itself for a root
 * (`/`, `C:\`). */
export function displayName(path: string, platform: NodeJS.Platform): string {
  const p = platform === "win32" ? win32 : posix;
  const base = p.basename(path);
  return base.length > 0 ? base : path;
}

/** A place may be anywhere work ran, except a whole filesystem root (FS-1b). */
export function isFilesystemRoot(realPath: string, platform: NodeJS.Platform): boolean {
  const paths = platform === "win32" ? win32 : posix;
  const normalized = paths.normalize(realPath);
  return normalized === paths.parse(normalized).root;
}
