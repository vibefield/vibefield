import { join } from "node:path";
import {
  BROWSER_DESK_PROFILE_REF,
  type BrowserDataClearResult,
  type LiveSurfaceNavigationCommandV1,
} from "@vibefield/contracts";
import { browserSurfaceProfileName } from "./browser-security";

// BP-D4 (thinking-browser-profile.md §3·3, 2026-10-26) — Settings › General's "Clear browsing data", as main does it. The
// profiles cleared are THIS shell's own: the desk's (PT-4 ruling 3: one profile, every desk page's — named the way this
// shell names it, packaged or not, BP-D6) and any other persistent profile a page of this shell opened. A profile of the
// other kind is never opened, so an unpackaged shell never touches a signed build's encrypted store. A profile not on disk
// is not made in order to be cleared. Then every page on a cleared profile that has a window is reloaded, so none keeps a
// session it no longer has; a page at rest (paused, hibernated) loads from the cleared profile when it next starts.

/** What clearing needs of a browser surface (`BrowserLiveSurfaceRuntime`). */
export interface ClearableBrowserSurface {
  persistentProfilePath(): string | undefined;
  isClosed(): boolean;
  navigate(command: LiveSurfaceNavigationCommandV1): Promise<void>;
}

export async function clearBrowsingData(opts: {
  /** the attached user's profiles' root (`<user root>/browser/profiles`); absent: no persistent profile exists */
  readonly profilesRoot: string | undefined;
  /** this shell is packaged (BP-D6) */
  readonly packaged: boolean;
  readonly surfaces: Iterable<ClearableBrowserSurface>;
  readonly exists: (path: string) => boolean;
  readonly clearProfile: (path: string) => Promise<void>;
}): Promise<BrowserDataClearResult> {
  if (opts.profilesRoot === undefined) return { profiles: 0, pages: 0 };
  const open = [...opts.surfaces].filter((surface) => !surface.isClosed());
  const paths = new Set<string>([
    join(
      opts.profilesRoot,
      browserSurfaceProfileName(
        { profile: { mode: "persistent", ref: BROWSER_DESK_PROFILE_REF } },
        opts.packaged,
      ),
    ),
  ]);
  for (const surface of open) {
    const path = surface.persistentProfilePath();
    if (path !== undefined) paths.add(path);
  }
  let profiles = 0;
  const cleared = new Set<string>();
  for (const path of paths) {
    if (!opts.exists(path)) continue;
    await opts.clearProfile(path);
    cleared.add(path);
    profiles += 1;
  }
  let pages = 0;
  for (const surface of open) {
    const path = surface.persistentProfilePath();
    if (path === undefined || !cleared.has(path)) continue;
    try {
      await surface.navigate({ action: "reload" });
      pages += 1;
    } catch {
      // a page with no window to reload (at rest) starts from the cleared profile when it is next asked for
    }
  }
  return { profiles, pages };
}
