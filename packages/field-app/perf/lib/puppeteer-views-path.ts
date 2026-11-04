/**
 * PG-4t — A PUPPETEER-VIEWS MODULE BY ITS PATH (VF-PM 2026-11-04 01:23Z: one shared helper, so no view lane writes
 * its own). The package's exports map names only `.`, `./physics`, `./deck`, `./launcher` and `./lab`, and no
 * `./package.json`, so a view's own modules (`views/spend/…`) are reachable by their path under the INSTALLED
 * package's dist alone: the rule `puppeteerVersions()` (`phone-goldens.ts`) already reads the version by. Under
 * `pnpm siblings use puppeteer` the same path is the overlay's link.
 *
 * The caller names the module's type: a structural type, or a relative `typeof import(…)` of the dist's `.d.ts` (a
 * relative specifier bypasses the exports map, so tsc still checks what a lane calls).
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE = join(
  import.meta.dirname,
  "..",
  "..",
  "node_modules",
  "@vibefield",
  "puppeteer-views",
);

/**
 * The module at `dist/<path>` of the installed `@vibefield/puppeteer-views`:
 * `importPuppeteerViews<{ MONITOR_VIEWS: … }>("monitor/registry.js")`. It never leaves dist (no absolute path, no
 * `..`), loads only `.js`, and a path the installed package lacks rejects with the path and the version.
 */
export async function importPuppeteerViews<M>(path: string): Promise<M> {
  if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new Error(`importPuppeteerViews: "${path}" — the loader never leaves dist`);
  }
  if (!path.endsWith(".js")) {
    throw new Error(`importPuppeteerViews: "${path}" — the loader loads only .js`);
  }
  const file = join(PACKAGE, "dist", path);
  if (!existsSync(file)) {
    throw new Error(
      `importPuppeteerViews: puppeteer-views ${installedVersion()} has no dist/${path} — a puppeteer EL8 moved ` +
        "or removed it; name the module the installed package has",
    );
  }
  // By its REAL path: the root's own modules are loaded by theirs (pnpm's store, Vite's preserveSymlinks off, Node's
  // ESM resolver), so the link's path would load a second copy of the module, a registry of its own (L1, measured).
  return (await import(/* @vite-ignore */ pathToFileURL(realpathSync(file)).href)) as M;
}

/** The installed version, for a red's message (the exports map has no `./package.json`). */
function installedVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as { version: string })
      .version;
  } catch {
    return "(unreadable version)";
  }
}
