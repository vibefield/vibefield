import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSmokeLike, type ShellMode } from "./modes";

// THE SMOKE PROFILE (DK-5). A smoke-like run never touches the app's SHARED Electron
// profile — the one the owner's own app keeps (`<appData>/VibeField`): its theme file,
// its renderer storage (localStorage, which the godview smoke and the perf lab CLEAR;
// IndexedDB; the desk's OPFS byte store with the explorer's stills), its GPU caches.
// Until DK-5 every smoke ran there, and the canvas smoke had to put back the theme
// file and the stills it wrote. Each run gets its OWN profile under the OS temp,
// fresh per run: `apps/desktop/packaging/run-smoke.mjs` (and the soak runners) mint
// it, pass it as `--user-data-dir`, and remove it once Electron has exited — Chromium
// writes the profile until its process is gone, so only a parent can remove it whole.
// A run started WITHOUT one (`electron . --smoke-canvas` by hand) mints its own here,
// before ready: isolated still, and left under the OS temp for the OS to clear.

export const SMOKE_PROFILE_PREFIX = "vf-smoke-profile-";

/** The `--user-data-dir=` a run was handed (the one spelling Chromium's switch parser reads). */
export function userDataDirArg(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    if (!arg.startsWith("--user-data-dir=")) continue;
    const value = arg.slice("--user-data-dir=".length);
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

export interface SmokeProfile {
  /** The Electron profile this run uses — never the shared one. */
  readonly userData: string;
  /** True when this process minted it because no `--user-data-dir` was handed. */
  readonly minted: boolean;
}

/**
 * Give a smoke-like run its own profile: the one it was handed, else a fresh one under the
 * OS temp, set as Electron's `userData` (which must happen before ready — every storage of
 * the default session lives under it). Null, and nothing touched, for any other mode.
 */
export function isolateSmokeProfile(
  mode: ShellMode,
  argv: readonly string[],
  deps: {
    readonly setUserData: (path: string) => void;
    readonly mintDir?: () => string;
  },
): SmokeProfile | null {
  if (!isSmokeLike(mode)) return null;
  const given = userDataDirArg(argv);
  if (given !== undefined) return { userData: given, minted: false };
  const userData = (deps.mintDir ?? (() => mkdtempSync(join(tmpdir(), SMOKE_PROFILE_PREFIX))))();
  deps.setUserData(userData);
  return { userData, minted: true };
}

/** The app's shared profile — what `userData` is when nothing redirects it. */
export function sharedProfilePath(appData: string, appName: string): string {
  return join(appData, appName);
}
