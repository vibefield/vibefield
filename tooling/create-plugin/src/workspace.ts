// Where the scaffold landed, and what that means for its dependencies.
//
// The template declares `workspace:*` and `catalog:` dependencies, because the
// SDK packages are not published — they exist in this repository and nowhere
// else. Inside the workspace that resolves after `pnpm install`; outside it,
// those protocols resolve to nothing at all. Both are true and the scaffolder
// says which one applies rather than writing a directory and letting the author
// discover it from a pnpm error.
//
// This is a NOTE, never a refusal: scaffolding outside the repository is a
// legitimate thing to do (the plugin is still a real plugin, and the dev-root
// override is how a running app finds one), and refusing it would make the
// scaffolder useless for exactly the case §5.3 was written for.

import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const WORKSPACE_FILE = "pnpm-workspace.yaml";

/** The env var a dev session reads for plugin roots outside the repo (§5.3). */
export const DEV_ROOTS_ENV = "FIELDD_PLUGIN_DEV_ROOTS";

export interface WorkspacePlacement {
  /** the workspace root that governs this path, if any */
  readonly root?: string;
  /** the glob the target matched, when it is a member */
  readonly glob?: string;
  readonly member: boolean;
}

/** Walk up for the file pnpm itself keys on. */
export function findWorkspaceRoot(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_FILE))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The `packages:` globs, read without a YAML dependency.
 *
 * Deliberately a line scanner and not a parser: the block is a flat list of
 * scalars in every workspace file pnpm accepts for this key, the scaffolder may
 * depend only on contracts and plugin-build (§5.4 item 3), and a wrong answer
 * here downgrades a note — it never writes a different scaffold.
 */
export function readWorkspaceGlobs(workspaceRoot: string): string[] {
  const file = join(workspaceRoot, WORKSPACE_FILE);
  if (!existsSync(file)) return [];
  const globs: string[] = [];
  let inPackages = false;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line.length === 0) continue;
    if (!/^\s/.test(line)) {
      // a top-level key ends the block we were reading
      inPackages = /^packages:\s*$/.test(line);
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s*-\s*(.+)$/.exec(line);
    if (item === null) continue;
    const value = stripComment(item[1] ?? "").trim();
    const unquoted = value.replace(/^["'](.*)["']$/, "$1");
    if (unquoted.length > 0) globs.push(unquoted);
  }
  return globs;
}

/** Comments only where a `#` follows whitespace — a `#` inside a glob is part of
 * the glob. */
function stripComment(value: string): string {
  const at = value.search(/\s#/);
  return at === -1 ? value : value.slice(0, at);
}

export function placementFor(targetDir: string, from?: string): WorkspacePlacement {
  const root = findWorkspaceRoot(from ?? targetDir);
  if (root === undefined) return { member: false };

  const rel = relative(root, resolve(targetDir)).split(sep).join("/");
  // Outside the workspace root entirely (`../…`), or the root itself.
  if (rel.length === 0 || rel.startsWith("../")) return { root, member: false };

  for (const glob of readWorkspaceGlobs(root)) {
    if (globToRegExp(glob).test(rel)) return { root, glob, member: true };
  }
  return { root, member: false };
}

/** pnpm's workspace globs, to the depth this needs: `*` is one path segment,
 * `**` is any number of them. */
export function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .split("/")
    .map((segment) =>
      segment === "**"
        ? "[^/]+(?:/[^/]+)*"
        : segment.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]+"),
    )
    .join("/");
  return new RegExp(`^${pattern}$`);
}
