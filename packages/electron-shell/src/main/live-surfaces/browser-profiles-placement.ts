import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DesktopBrowserSignIns } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";

// BP-1c (BP-D9 (a), `draft/thinking-browser-profile.md` §3·8) — THE LAW: a desk browser profile lives inside Electron's
// userData. Chromium writes a `session.fromPath` profile's cookie database only there (four Electron 43.1.1 probes,
// 2026-10-26: outside it, `cookies.get` answers and no `Cookies` file is ever written, even after `flushStore()` and a
// quit), and the desk's profiles live under the user's data (`<user root>/browser/profiles`, PT-4). The default layouts
// nest them: a packaged app's userData and data root are one directory (`appData/VibeField`), the dev runner's userData is
// its dev root with the data root under it, and a smoke's HOME is both (main/smoke-profile.ts). A shell started with a
// FIELDD_DATA_DIR or a `--user-data-dir` set apart does not, and its desk forgets every sign-in when it quits. Main checks
// it ONCE, at start, and says it: in the log, and as the desktop's capability truth (`DesktopShellState.browser`), which
// Settings › General's Browsing data card says in the person's words. Never silent, and nothing refuses: the pages work,
// their sign-ins last until VibeField quits (§3·8's shape (c), the honest UX where (a) cannot hold).

export interface BrowserProfilesPlacement {
  /** `kept`: the profiles root lies inside userData, and the desk keeps its sign-ins across restarts. `until-quit`: it does
   * not, and they last until VibeField quits. */
  readonly signIns: DesktopBrowserSignIns;
  /** The two paths as checked (the log says them; the renderer is told only `signIns`). */
  readonly profilesRoot: string;
  readonly userData: string;
}

/** The seams a placement reads the filesystem through (node's by default). */
export interface PlacementFs {
  readonly exists: (path: string) => boolean;
  readonly realpath: (path: string) => string;
}

const nodeFs: PlacementFs = { exists: existsSync, realpath: (path) => realpathSync.native(path) };

/**
 * A path as the filesystem names it: its nearest existing ancestor's REAL path (links resolved — `/tmp` is
 * `/private/tmp` on macOS), with the part not made yet joined back on. The profiles root does not exist before a desk's
 * first page, and its parents may not either.
 */
export function realOrPending(path: string, fs: PlacementFs = nodeFs): string {
  const absolute = resolve(path);
  const pending: string[] = [];
  let at = absolute;
  while (!fs.exists(at)) {
    const parent = dirname(at);
    if (parent === at) return absolute;
    pending.unshift(basename(at));
    at = parent;
  }
  return join(fs.realpath(at), ...pending);
}

/** Whether `child` lies inside `parent`, or is it — read by `relative`, never by a string prefix (`/a/bc` is not in `/a/b`,
 * and `/a/..b` is in `/a`). */
export function liesWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Where this shell's desk profiles lie, against its userData: both read as the filesystem names them. */
export function browserProfilesPlacement(
  profilesRoot: string,
  userData: string,
  fs: PlacementFs = nodeFs,
): BrowserProfilesPlacement {
  const inside = liesWithin(realOrPending(userData, fs), realOrPending(profilesRoot, fs));
  return { signIns: inside ? "kept" : "until-quit", profilesRoot, userData };
}

/** The log's line for a placement, once, at start: a warning when the desk cannot keep sign-ins, a fact when it can. */
export function sayBrowserProfilesPlacement(
  placement: BrowserProfilesPlacement,
  logger: Pick<Logger, "info" | "warn">,
): void {
  const attrs = { profilesRoot: placement.profilesRoot, userData: placement.userData };
  if (placement.signIns === "kept") {
    logger.info(
      "desktop.live_surfaces.browser_sign_ins_kept",
      "the desk browser's profiles lie inside Electron's userData: its sign-ins are kept across restarts",
      attrs,
    );
    return;
  }
  logger.warn(
    "desktop.live_surfaces.browser_sign_ins_until_quit",
    "the desk browser can't keep sign-ins here: its profiles lie outside Electron's userData, where Chromium writes no cookie database, so sites stay signed in only until VibeField quits (BP-D9; a FIELDD_DATA_DIR or --user-data-dir set apart)",
    attrs,
  );
}
