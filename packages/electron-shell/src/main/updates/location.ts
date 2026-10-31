// AU-7 (AU-G8; LC-10; main-process.md §8.1) — where this bundle runs, on macOS. Squirrel.Mac replaces the bundle where
// it sits, so a copy macOS won't let replace itself can never update: App Translocation (a quarantined app opened where
// it was downloaded runs from a randomised read-only mount), a mounted disk image, a folder this user cannot write.
// That copy is `read-only`: decide holds it and the apply refuses before anything stops. A writable copy outside
// Applications updates as usual (`elsewhere`); only the Updates page names it, with Move to Applications beside it.
// Read ONCE per process (the controller's constructor): a bundle does not move under a running app; the move relaunches.

import { accessSync, constants } from "node:fs";
import { dirname } from "node:path";
import type { UpdateAppLocation } from "@vibefield/contracts";

/** What the classification reads, gathered by `readAppLocation` (the tests hand their own). */
export interface LocationFacts {
  /** `app.isInApplicationsFolder()`: /Applications or ~/Applications */
  readonly inApplications: boolean;
  /** `…/VibeField.app`, from `process.execPath` (`bundlePathOf`) */
  readonly bundlePath: string;
  /** the bundle's parent folder is writable by this user (`access(W_OK)` did not throw; a read-only volume throws) */
  readonly parentWritable: boolean;
}

/** Pure: the classification the tests drive. App Translocation first — its mount is read-only whatever else is said. */
export function classifyLocation(facts: LocationFacts): UpdateAppLocation {
  if (facts.bundlePath.includes("/AppTranslocation/")) return "read-only";
  if (facts.inApplications) return "applications";
  if (!facts.parentWritable) return "read-only";
  return "elsewhere";
}

/** The bundle that holds this executable: `…/VibeField.app/Contents/MacOS/VibeField` → `…/VibeField.app`. */
export function bundlePathOf(execPath: string): string {
  return dirname(dirname(dirname(execPath)));
}

function writable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** The Electron edge: macOS only (`undefined` elsewhere — no other platform's apply is wired). A throwing
 * `isInApplicationsFolder` reads as outside Applications, so the parent's own writability decides. */
export function readAppLocation(
  app: { isInApplicationsFolder(): boolean },
  options: {
    readonly platform?: NodeJS.Platform;
    readonly execPath?: string;
    readonly isWritable?: (path: string) => boolean;
  } = {},
): UpdateAppLocation | undefined {
  if ((options.platform ?? process.platform) !== "darwin") return undefined;
  const bundlePath = bundlePathOf(options.execPath ?? process.execPath);
  let inApplications = false;
  try {
    inApplications = app.isInApplicationsFolder();
  } catch {
    inApplications = false;
  }
  return classifyLocation({
    inApplications,
    bundlePath,
    parentWritable: (options.isWritable ?? writable)(dirname(bundlePath)),
  });
}
