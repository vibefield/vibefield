import { lstat, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { LAYOUT, MADE_APP_VIEW, ShellOpenMadeAppParams } from "@vibefield/contracts";

// MA-D16 (2026-11-24) — a made app's LOCAL view, found for `shell.openMadeApp`. A desktop with no
// linked login has no serve to carry an app, so fieldd's files worker writes the app's page as a
// file (MADE_APP_VIEW.LOCAL_FILE, its head carrying the page's own policy) and asks main to hand
// that file to the default browser. This module is main's ONE rule for which file that is.
//
// fieldd names an app and its page's digest, never a path, and main derives the file itself:
// `<user root>/artifacts/made/<appId>/<digest>/local.html`. Main then holds what it derived to the
// disk before anything opens, because a file handed to the browser runs there:
//  - both words are 64 lowercase hex again here (the contract's grammar), so neither can spell a
//    separator or a dot segment whatever reached this function;
//  - the app's folder and the digest's folder are real directories, read with lstat: a symlink in
//    either place is refused, never followed;
//  - the file is a regular file, read with lstat: a symlink, a folder or a device is refused;
//  - the file's real path is exactly where the made root's real path puts it. The root itself may
//    sit behind a link (a data root on another volume, macOS's /tmp), so the two real paths are
//    compared, never the spellings.
// Anything else the disk says (a folder not there yet, no permission) is the same answer: there is
// no such file to open. No refusal carries a path: the caller words it (`safeProviderError`).

/** Why main opens nothing: a malformed ask, or no such local view on this desktop. */
export type MadeAppLocalRefusal = "PRECONDITION_FAILED" | "NOT_FOUND";

export type MadeAppLocalFile = { ok: true; url: string } | { ok: false; kind: MadeAppLocalRefusal };

const NOT_FOUND = { ok: false, kind: "NOT_FOUND" } as const;

/** The `file:` URL of a made app's local view under `userRoot`, or why there is none (module
 * header). `userRoot` is main's own user root, never a caller's word. */
export async function madeAppLocalFile(
  userRoot: string,
  params: ShellOpenMadeAppParams,
): Promise<MadeAppLocalFile> {
  const asked = ShellOpenMadeAppParams.safeParse(params);
  if (!asked.success) return { ok: false, kind: "PRECONDITION_FAILED" };
  const { appId, digest } = asked.data;
  const root = join(userRoot, ...LAYOUT.ARTIFACT_MADE_DIR);
  const folders = [join(root, appId), join(root, appId, digest)];
  const file = join(root, appId, digest, MADE_APP_VIEW.LOCAL_FILE);
  try {
    for (const folder of folders) {
      const entry = await lstat(folder);
      if (entry.isSymbolicLink() || !entry.isDirectory()) return NOT_FOUND;
    }
    const entry = await lstat(file);
    if (entry.isSymbolicLink() || !entry.isFile()) return NOT_FOUND;
    const realRoot = await realpath(root);
    const real = await realpath(file);
    const below = relative(realRoot, real);
    if (below !== [appId, digest, MADE_APP_VIEW.LOCAL_FILE].join(sep)) return NOT_FOUND;
    return { ok: true, url: pathToFileURL(real).href };
  } catch {
    return NOT_FOUND;
  }
}
