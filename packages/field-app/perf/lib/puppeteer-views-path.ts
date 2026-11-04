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

/**
 * The module at `dist/<path>` of the installed `@vibefield/puppeteer-views`:
 * `importPuppeteerViews<{ MONITOR_VIEWS: … }>("monitor/registry.js")`. It never leaves dist (no absolute path, no
 * `..`), loads only `.js`, and a path the installed package lacks rejects with the path and the version.
 */
export async function importPuppeteerViews<M>(_path: string): Promise<M> {
  throw new Error("PG-4t: the by-path loader is a skeleton");
}
