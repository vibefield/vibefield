// Reading a plugin directory, once, for every command that needs one. The
// manifest on disk is the canonical §5.2 artifact — the kit never re-derives it
// from TS source (that is `gen:manifest`'s job, and giving the artifact a second
// producer is exactly what P8a refused).

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLUGIN_LIMITS } from "@vibefield/contracts";

export const MANIFEST_NAME = "vibefield.plugin.json";

export interface LoadedPlugin {
  /** absolute plugin directory */
  readonly root: string;
  /** absolute path to vibefield.plugin.json */
  readonly manifestPath: string;
  /** the bytes exactly as committed — freshness compares against these */
  readonly raw: string;
  /** JSON.parse of `raw`, unvalidated (validation is the manifest row's job) */
  readonly parsed: unknown;
}

export type LoadPluginResult =
  | { ok: true; plugin: LoadedPlugin }
  | {
      ok: false;
      code: "plugin-dir-invalid" | "manifest-missing" | "manifest-unreadable";
      detail: string;
    };

export function loadPlugin(dir: string): LoadPluginResult {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory())
    return { ok: false, code: "plugin-dir-invalid", detail: `${root} is not a directory` };

  const manifestPath = join(root, MANIFEST_NAME);
  if (!existsSync(manifestPath))
    return { ok: false, code: "manifest-missing", detail: `no ${MANIFEST_NAME} in ${root}` };

  const raw = readFileSync(manifestPath, "utf8");
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > PLUGIN_LIMITS.MANIFEST_MAX_BYTES)
    return {
      ok: false,
      code: "manifest-unreadable",
      detail: `${MANIFEST_NAME} is ${bytes} bytes, over the ${PLUGIN_LIMITS.MANIFEST_MAX_BYTES}-byte limit`,
    };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      code: "manifest-unreadable",
      detail: `${MANIFEST_NAME} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ok: true, plugin: { root, manifestPath, raw, parsed } };
}

/** Walk up for the workspace root (the file pnpm itself keys on). Used only to
 * resolve the repo's dev-linked plugin root — never to reach into other
 * packages. */
export function findWorkspaceRoot(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return undefined;
    dir = parent;
  }
}
