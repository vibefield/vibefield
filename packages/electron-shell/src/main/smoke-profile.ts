import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { isSmokeLike, type ShellMode } from "./modes";

// THE SMOKE PROFILE (DK-5). A smoke-like run never touches the app's SHARED Electron
// profile — the one the owner's own app keeps (`<appData>/VibeField`): its theme file,
// its renderer storage (localStorage, which the godview smoke and the perf lab CLEAR;
// IndexedDB; the desk's OPFS byte store with the explorer's stills), its GPU caches.
// Until DK-5 every smoke ran there, and the canvas smoke had to put back the theme
// file and the stills it wrote. Each run gets its OWN profile, fresh per run:
// `apps/desktop/packaging/run-smoke.mjs` (and the soak runners) mint it, pass it as
// `--user-data-dir`, and remove it once Electron has exited — Chromium writes the
// profile until its process is gone, so only a parent can remove it whole.
// A run started WITHOUT one (`electron . --smoke-canvas` by hand) mints its own here,
// before ready: isolated still, and left under the temp root for the OS to clear.
//
// THE SMOKE HOME (BP-1c; BP-D9 (a), `draft/thinking-browser-profile.md` §3·8). A desk browser profile writes its cookie
// database only inside Electron's userData (`session.fromPath`, four Electron 43.1.1 probes), and its profiles live under
// the data root (`<user root>/browser/profiles`, PT-4). A packaged app's userData and data root are one directory
// (`appData/VibeField`); a smoke's were two (a `vf-smoke-profile-*` under the OS temp, a `/tmp/vf-smoke-*` root), so no
// smoke ever wrote a desk cookie to disk. A smoke HOME is one fresh `vf-smoke-XXXXXX` directory under the short socket
// root that is both: run-smoke.mjs mints and hands it, main knows it by its name (`isSmokeHome`) and roots the run's
// daemons in it (main/fieldd.ts `dataRoot`), and a run handed none mints one here. The sockets under it keep their short
// path: the home is where `dataRoot` minted the root before.
// A HANDED home is taken only when it is this run's and fresh (`smokeHomeRefusal`): its name is the run's mark
// (`VF_SMOKE_RUN`, which run-smoke.mjs sets to it) and no run's data root is in it yet. A red run's kept home handed to a
// second run is that run's Chromium profile alone, and the run mints its data root apart, as before BP-1c, so its
// teardown never removes the evidence. A home minted here is Electron's userData until the process is gone: a green
// teardown leaves it whole for the OS to clear (testing/smoke-daemons.ts `removeSmokeRoot`), as DK-5's minted profile was.

export const SMOKE_PROFILE_PREFIX = "vf-smoke-profile-";

/** BP-1c — a smoke home's prefix: `mkdtemp` adds six letters or digits (`vf-smoke-hnUors`). The data root a smoke-like run
 * minted for itself has carried it since DK-18 (testing/smoke-daemons.ts `smokeHome`). */
export const SMOKE_HOME_PREFIX = "vf-smoke-";

/** A smoke home's name, exactly: the prefix and `mkdtemp`'s six. Never a `vf-smoke-profile-*` (a profile alone, under the
 * OS temp), a `vf-smoke-godview-*` scratch, or any other shape. */
const SMOKE_HOME_NAME = /^vf-smoke-[A-Za-z0-9]{6}$/u;

/** BP-1c — is this directory a smoke HOME (one minted as both the run's userData and its data root)? By its name. */
export function isSmokeHome(dir: string): boolean {
  return SMOKE_HOME_NAME.test(basename(dir));
}

/** BP-1c — where a smoke home is minted: `/tmp` on Unix (macOS's sun_path is 104 bytes, and its OS temp is ~50 already:
 * main/fieldd.ts `dataRoot`'s law), the OS temp on Windows (named pipes). The launcher's twin is packaging/smoke-profile.mjs. */
export function smokeHomeParent(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? tmpdir() : "/tmp";
}

/** The `--user-data-dir=` a run was handed (the one spelling Chromium's switch parser reads). */
export function userDataDirArg(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    if (!arg.startsWith("--user-data-dir=")) continue;
    const value = arg.slice("--user-data-dir=".length);
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** A path as the filesystem names it (`/tmp` is `/private/tmp` on macOS), or resolved when it is not there. */
const realOrResolved = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** BP-1c — are `a` and `b` one directory, read as the filesystem names both (the users package roots a user under the
 * data root's real path; `/tmp` is `/private/tmp` on macOS)? `real` is the seam. */
export function sameDirectory(
  a: string,
  b: string,
  real: (path: string) => string = realOrResolved,
): boolean {
  return real(a) === real(b);
}

/** BP-1c — was `dir` handed to this run as its `--user-data-dir` (so its launcher removes it once Electron is gone)? Read
 * as the filesystem names both (`sameDirectory`). `real` is the seam. */
export function handedAsUserData(
  dir: string,
  argv: readonly string[],
  real: (path: string) => string = realOrResolved,
): boolean {
  const given = userDataDirArg(argv);
  return given !== undefined && sameDirectory(given, dir, real);
}

/** BP-1c — the run's mark (testing/smoke-census.mjs `SMOKE_RUN_ENV`; main may not import a testing module, wall R8):
 * run-smoke.mjs names the run after the home it minted for it. */
const SMOKE_RUN_MARK = "VF_SMOKE_RUN";

/** BP-1c — the entries by which a directory says a run's data root is already in it: main's logs (its first write there)
 * and the users file. Chromium writes neither name in a userData. The launcher's twin is packaging/smoke-profile.mjs
 * `DATA_ROOT_MARKS`. */
export const SMOKE_HOME_DATA_ROOT_MARKS = Object.freeze(["logs", "users.json"] as const);

/** BP-1c — why a handed directory named as a smoke home was not taken as this run's home: no launcher minted it for THIS
 * run (`not-this-run`: the mark names another, or none), or a run's data root is already in it (`already-used`: a red
 * run's kept evidence). */
export type SmokeHomeRefusal = "not-this-run" | "already-used";

const holdsDataRootOnDisk = (dir: string): boolean =>
  SMOKE_HOME_DATA_ROOT_MARKS.some((name) => existsSync(join(dir, name)));

/**
 * BP-1c — may this run take the handed `dir` (named as a smoke home, `isSmokeHome`) as its HOME, its data root too? Only
 * when a launcher minted it for this run (its name is the run's mark, `VF_SMOKE_RUN`) and it is fresh (no run's data root
 * is in it). Null when it may; else why not. The name alone never decides: `dataRoot` would root the run in it and the
 * teardown remove its user root, so a kept home re-handed by hand would lose its evidence. `env` and `holdsDataRoot` are
 * the seams.
 */
export function smokeHomeRefusal(
  dir: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  holdsDataRoot: (dir: string) => boolean = holdsDataRootOnDisk,
): SmokeHomeRefusal | null {
  if (env[SMOKE_RUN_MARK] !== basename(dir)) return "not-this-run";
  if (holdsDataRoot(dir)) return "already-used";
  return null;
}

/** BP-1c — mint a fresh smoke HOME under the short root, by its REAL path (`/private/tmp/…` on macOS): the users package
 * roots the run's users under the real path (`canonicalRoot`), so Electron's userData is spelled as the data root is. */
export function mintSmokeHome(parent: string = smokeHomeParent()): string {
  return mkdtempSync(join(realOrResolved(parent), SMOKE_HOME_PREFIX));
}

export interface SmokeProfile {
  /** The Electron profile this run uses — never the shared one. */
  readonly userData: string;
  /** True when this process minted it because no `--user-data-dir` was handed. */
  readonly minted: boolean;
  /** BP-1c — true when it is this run's smoke HOME (`isSmokeHome`; a handed one also `smokeHomeRefusal`-free): the run's
   * data root is this same directory (main/fieldd.ts `dataRoot`), so the desk browser's profiles lie inside userData. */
  readonly home: boolean;
  /** BP-1c — present when a handed directory is NAMED as a smoke home but was not taken as this run's (why: the run mints
   * its data root apart, and main's log says so). */
  readonly refusedHome?: SmokeHomeRefusal;
}

/**
 * Give a smoke-like run its own profile: the one it was handed, else a fresh smoke HOME under the short root, set as
 * Electron's `userData` (which must happen before ready — every storage of the default session lives under it). A handed
 * directory named as a home is this run's home only when `smokeHomeRefusal` finds no reason against it. Null, and nothing
 * touched, for any other mode. `env` and `holdsDataRoot` are `smokeHomeRefusal`'s seams.
 */
export function isolateSmokeProfile(
  mode: ShellMode,
  argv: readonly string[],
  deps: {
    readonly setUserData: (path: string) => void;
    readonly mintDir?: () => string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly holdsDataRoot?: (dir: string) => boolean;
  },
): SmokeProfile | null {
  if (!isSmokeLike(mode)) return null;
  const given = userDataDirArg(argv);
  if (given !== undefined) {
    if (!isSmokeHome(given)) return { userData: given, minted: false, home: false };
    const refused = smokeHomeRefusal(given, deps.env, deps.holdsDataRoot);
    return refused === null
      ? { userData: given, minted: false, home: true }
      : { userData: given, minted: false, home: false, refusedHome: refused };
  }
  const userData = (deps.mintDir ?? (() => mintSmokeHome()))();
  deps.setUserData(userData);
  return { userData, minted: true, home: isSmokeHome(userData) };
}

/** The app's shared profile — what `userData` is when nothing redirects it. */
export function sharedProfilePath(appData: string, appName: string): string {
  return join(appData, appName);
}
