import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { MADE_APP_VIEW_TAIL, madeAppViewHead } from "@vibefield/contracts";
import { MADE_APP_VIEW } from "@vibefield/contracts/registries";
import { isWithin } from "../paths";
import type { BuildMadeViewArgs, BuildMadeViewValue, MadeViewRoots } from "../protocol";
import { WorkerFailure } from "./engine";

// DR-1b (`draft/thinking-drive.md` v0.3, DR-D11 (a) as its correction rules
// it; the wave-0 plan's DR-1 (A) map as its critic's VF-VIEW line corrects it)
// — a made app's VIEW, built by the files worker: `madeAppViewHead(theme)`,
// the stored page's bytes, then MADE_APP_VIEW_TAIL, written as
// MADE_APP_VIEW.FILE in the app's served folder. A desktop builds its own view
// and never syncs it, so a theme change rebuilds views and makes no object.
//
// TWO ROOTS, named by fieldd at `init` (`MadeViewRoots`): the export-source
// root, where rosetta's export places a page and nothing is served, and the
// served made root (`artifacts/made`), which holds views alone. fieldd makes
// both; the worker makes neither (a root that is not there is `root-missing`),
// so nothing is made before the roots are proved apart. A view never writes
// into the export's folder or over its link: the roots must not overlap
// (lexically, then by real path), and the view replaces its file by rename,
// never writing through it, so a hard link to an old view keeps the old bytes.
//
// THE PAGE: an absolute path below the export-source root. Every entry on the
// way is read with lstat and a symlink anywhere is refused, never followed; the
// page must be a regular file (a FIFO is never opened; a hard link is one, as
// R-1's `method: "link"` places a page); it is opened no-follow and no-block,
// then held to what was asked: its real path inside the root and its inode the
// one the open holds (a link swapped in after the walk reads nothing outside).
// At most MADE_APP_VIEW.PAGE_MAX_BYTES, by its stat and again while it is
// copied (a page that grows is refused, never cut).
//
// THE FOLDER: an absolute path below the served root, made here one folder at
// a time (0700) when it is not there, with no symlink on the way. The view is
// streamed into a 0600 temp beside it (created exclusive and no-follow),
// fsynced, renamed over MADE_APP_VIEW.FILE, and the folder fsynced. Anything
// that fails before the rename leaves the previous view whole and no temp.
//
// What is refused, and how: a theme `madeAppViewHead` cannot read is `invalid`
// before anything is touched; a path outside its root, a root itself, or a
// path with a NUL is `invalid` (the ask is malformed: fieldd names both,
// FS-D7); a root that is not there is `root-missing`; a page or folder behind
// a symlink, or a page gone, unreadable or not a regular file, is `not-found`
// (one answer, never a map of what lies outside); a folder that is a file is
// `not-a-directory`; a page past the bound is `too-large`; a worker started
// without roots answers `internal`, as does anything else the disk says (a
// full descriptor table, an I/O error): the worker's trouble, never a page
// that is not there.
//
// EL2 (DR-L4): the bytes stay in this process. The answer is the view's size.
// DR-L3: the page is not re-hashed here. The worker holds no blake3 before
// mille-drive (DR-2), so until then the view trusts rosetta's verified
// placement (R-1) — the wave-0 critic's missing_work 16, owed James's ruling
// BEFORE DR-1 (B) wires a caller: (a) R-1's placement suffices until DR-2,
// recorded at DR-L3, or (b) a blake3 dependency, and `BuildMadeViewArgs`
// carries R-1's `page.blake3`, checked while the page is copied.
// Windows has no O_NOFOLLOW or O_NONBLOCK (the walk and the post-open check
// stand alone there), and the rename is plain: `durableRename`, the cure for a
// reader holding the view at that instant, lives in @vibefield/logging, whose
// index would bring pino into this bundle.

/** POSIX's no-follow and no-block opens; Windows has neither (header). */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const NO_BLOCK = constants.O_NONBLOCK ?? 0;
/** The page is copied in pieces of this size. */
const CHUNK_BYTES = 64 * 1024;

const PAGE_UNREAD = "no page there that a view may read";
const FOLDER_UNREACHED = "no folder there that a view may be written in";
/** What the disk says of a page no view may read: gone, a folder or a link
 * swapped in after the walk, a device, no permission. Anything else is the
 * worker's own trouble, answered `internal` with its errno (module header). */
const PAGE_REFUSALS = new Set<unknown>([
  "ENOENT",
  "ENOTDIR",
  "ELOOP",
  "EACCES",
  "EPERM",
  "ENXIO",
  "EISDIR",
]);
/** What the disk says of a root that is not there (a file on its way is one). */
const ROOT_ABSENT = new Set<unknown>(["ENOENT", "ENOTDIR"]);

/** Build one made app's view (module header). */
export async function buildMadeView(
  roots: MadeViewRoots | null,
  args: BuildMadeViewArgs,
): Promise<BuildMadeViewValue> {
  if (roots === null || !isAbsolute(roots.sourceRoot) || !isAbsolute(roots.servedRoot))
    throw new WorkerFailure("internal", "this files worker was started with no made-view roots");
  if (typeof args?.source !== "string" || typeof args.folder !== "string")
    throw new WorkerFailure("invalid", "a view names its page and its folder by their paths");
  // the theme first: a theme the view cannot carry touches nothing
  const head = madeAppViewHead(args.theme);
  if (!head.ok)
    throw new WorkerFailure("invalid", `the view's theme is unreadable (${head.refused})`);
  const pageSegments = segmentsBelow(roots.sourceRoot, args.source, "page");
  const folderSegments = segmentsBelow(roots.servedRoot, args.folder, "folder");
  if (overlap(roots.sourceRoot, roots.servedRoot)) throw overlapping();
  const sourceRoot = await realRoot(roots.sourceRoot, "the export-source folder is not there");
  const servedRoot = await realRoot(roots.servedRoot, "the served made folder is not there");
  if (overlap(sourceRoot, servedRoot)) throw overlapping();
  const page = await openPage(sourceRoot, pageSegments);
  try {
    const folder = await viewFolder(servedRoot, folderSegments);
    return { bytes: await writeView(folder, head.head, page) };
  } finally {
    await page.close();
  }
}

/** The path's segments below its root, read without the disk: an absolute
 * path strictly below the root, or the ask is malformed. */
function segmentsBelow(root: string, path: string, what: "page" | "folder"): string[] {
  const below = isAbsolute(path) ? relative(root, path) : "";
  const segments = below.split(sep);
  const malformed = (s: string) => s === "" || s === ".." || s.includes("\0");
  if (below === "" || isAbsolute(below) || segments.some(malformed)) {
    const where = what === "page" ? "the export-source root" : "the served made root";
    throw new WorkerFailure("invalid", `a view's ${what} is an absolute path below ${where}`);
  }
  return segments;
}

function overlap(a: string, b: string): boolean {
  return isWithin(a, b, process.platform) || isWithin(b, a, process.platform);
}

function overlapping(): WorkerFailure {
  return new WorkerFailure("invalid", "the export-source and served roots overlap");
}

/** A root's real path, or `root-missing` while it is not there: fieldd makes
 * both roots and the worker neither, so nothing is made before they are proved
 * apart. Anything else the disk says of a root is the worker's own trouble,
 * answered `internal` with its errno (module header), never a missing root. */
async function realRoot(path: string, missing: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!ROOT_ABSENT.has(codeOf(error))) throw error;
    throw new WorkerFailure("root-missing", missing);
  }
}

/** The page, walked with lstat from its root, opened no-follow and no-block,
 * and held to the walk after the open (module header). */
async function openPage(root: string, segments: readonly string[]): Promise<FileHandle> {
  const path = join(root, ...segments);
  let handle: FileHandle | null = null;
  try {
    let at = root;
    for (const [index, segment] of segments.entries()) {
      at = join(at, segment);
      const entry = await lstat(at);
      const last = index === segments.length - 1;
      if (entry.isSymbolicLink() || !(last ? entry.isFile() : entry.isDirectory()))
        throw new WorkerFailure("not-found", PAGE_UNREAD);
    }
    handle = await open(path, constants.O_RDONLY | NO_FOLLOW | NO_BLOCK);
    const opened = await handle.stat();
    const real = await realpath(path);
    const there = await lstat(real);
    if (
      !opened.isFile() ||
      !isWithin(root, real, process.platform) ||
      there.dev !== opened.dev ||
      there.ino !== opened.ino
    )
      throw new WorkerFailure("not-found", PAGE_UNREAD);
    if (opened.size > MADE_APP_VIEW.PAGE_MAX_BYTES) throw tooLarge();
    return handle;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof WorkerFailure || !PAGE_REFUSALS.has(codeOf(error))) throw error;
    throw new WorkerFailure("not-found", PAGE_UNREAD);
  }
}

/** The view's folder below the served root, made one folder at a time when it
 * is not there, with no symlink on the way. */
async function viewFolder(root: string, segments: readonly string[]): Promise<string> {
  let at = root;
  for (const segment of segments) {
    at = join(at, segment);
    try {
      await mkdir(at, { mode: 0o700 });
    } catch (error) {
      if (codeOf(error) !== "EEXIST") throw error;
    }
    const entry = await lstat(at);
    if (entry.isSymbolicLink()) throw new WorkerFailure("not-found", FOLDER_UNREACHED);
    if (!entry.isDirectory())
      throw new WorkerFailure("not-a-directory", "a view's folder names a file");
  }
  if (!isWithin(root, await realpath(at), process.platform))
    throw new WorkerFailure("not-found", FOLDER_UNREACHED);
  return at;
}

/** Stream the view into a 0600 temp beside it, fsync, rename it over the view
 * and fsync the folder; anything before the rename leaves the old view whole.
 * Answers the view's size. */
async function writeView(folder: string, head: string, page: FileHandle): Promise<number> {
  const temp = join(folder, `.${MADE_APP_VIEW.FILE}.${randomBytes(8).toString("hex")}.tmp`);
  const create = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW;
  let out: FileHandle | null = await open(temp, create, 0o600);
  let written = 0;
  try {
    written += await writeAll(out, Buffer.from(head, "utf8"));
    written += await copyPage(page, out);
    written += await writeAll(out, Buffer.from(MADE_APP_VIEW_TAIL, "utf8"));
    await out.sync();
    await out.close();
    out = null;
    await rename(temp, join(folder, MADE_APP_VIEW.FILE));
  } catch (error) {
    await out?.close().catch(() => undefined);
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncFolder(folder);
  return written;
}

/** Copy the page in pieces, never past MADE_APP_VIEW.PAGE_MAX_BYTES: a page
 * that grew after its stat is refused, never cut. Answers the bytes copied. */
async function copyPage(page: FileHandle, out: FileHandle): Promise<number> {
  const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
  let copied = 0;
  for (;;) {
    const { bytesRead } = await page.read(chunk, 0, CHUNK_BYTES, copied);
    if (bytesRead === 0) return copied;
    copied += bytesRead;
    if (copied > MADE_APP_VIEW.PAGE_MAX_BYTES) throw tooLarge();
    await writeAll(out, chunk.subarray(0, bytesRead));
  }
}

async function writeAll(out: FileHandle, bytes: Uint8Array): Promise<number> {
  let at = 0;
  while (at < bytes.length) {
    const { bytesWritten } = await out.write(bytes, at, bytes.length - at);
    at += bytesWritten;
  }
  return bytes.length;
}

/** The rename made durable: the folder fsynced where the platform allows it
 * (AH's atomic write, made-app-service.ts `atomicWritePrivate`). */
async function syncFolder(folder: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(folder, "r");
  try {
    await handle.sync();
  } catch (error) {
    const code = codeOf(error);
    if (code !== "EINVAL" && code !== "ENOTSUP") throw error;
  } finally {
    await handle.close();
  }
}

function tooLarge(): WorkerFailure {
  return new WorkerFailure(
    "too-large",
    `a made app's page holds at most ${MADE_APP_VIEW.PAGE_MAX_BYTES} bytes`,
  );
}

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}
