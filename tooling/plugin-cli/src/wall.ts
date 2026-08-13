// The import wall for ONE plugin directory — wall R10 (§11.3: the SDK is the
// door), applied where the author is rather than where CI is.
//
// This is a deliberate SECOND implementation of R10's matcher, and the reason is
// mechanical: `scripts/check-import-boundaries.mjs` is a CLI that runs its own
// check and calls `process.exit` at module scope, so it cannot be imported. What
// it CAN be is pinned — `test/wall-parity.test.ts` reads the R10 rule out of that
// script and fails if this list and that list ever disagree. One authority, two
// copies that cannot drift silently, which is the arrangement the repo already
// uses for the singleton externals list.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { guidanceFor } from "./refusals";
import { pass, refuse, type Verdict } from "./verdict";

/** R10's forbidden modules, verbatim. Exact match or a subpath of one. */
export const R10_FORBIDDEN_MODULES = [
  "@vibecook/ice",
  "@vibefield/electron-shell",
  "@vibefield/field-app",
  "@vibefield/fieldd",
  "@vibefield/fieldd-client",
  "@vibefield/fieldd-supervisor",
  "@vibefield/plugin-runtime",
  "@vibefield/design-kit",
  "electron",
  "ws",
] as const;

/** R10's forbidden prefixes, verbatim: Node builtins have no renderer meaning. */
export const R10_FORBIDDEN_PREFIXES = ["node:"] as const;

/** What a plugin's runtime code MAY import — the door, stated positively for the
 * docs. Not a matcher: R10 gates on the deny list above, and a bare npm package
 * a plugin bundles in is legal (the artifact check owns whether it may stay
 * external). */
export const R10_ALLOWED_DOOR = [
  "@vibefield/plugin-sdk",
  "@vibefield/plugin-sdk/ui",
  "@vibefield/plugin-sdk/canvas",
  "@vibefield/contracts",
  "react",
] as const;

/** R10 exempts authoring-time subtrees: emit scripts (Node-side manifest emit)
 * and tests (vitest) are never part of the renderer artifact graph. */
const AUTHORING_SUBTREES = /(^|\/)(scripts|test)\//;

const SOURCE_EXT = /\.(?:ts|tsx|mts|mjs)$/;

/** Never walked: dependencies, build output, and the bundler's scratch dir. The
 * built artifact legitimately carries the bare specifiers the wall forbids in
 * SOURCE — it is generated, and `plugin-build` owns what it may contain. */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".build", "coverage", ".git"]);

const STATIC_IMPORT_PATTERNS = [/\bfrom\s*["'`]([^"'`]+)["'`]/g, /\bimport\s+["'`]([^"'`]+)["'`]/g];
const DYNAMIC_IMPORT_PATTERNS = [
  /\bimport\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g,
];
const IMPORT_PATTERNS = [...STATIC_IMPORT_PATTERNS, ...DYNAMIC_IMPORT_PATTERNS];

export function importSpecifiersOnLine(line: string): Set<string> {
  const specs = new Set<string>();
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    for (;;) {
      const m = re.exec(line);
      if (m === null) break;
      if (m[1] !== undefined) specs.add(m[1]);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return specs;
}

/** Exact package or a subpath of it ("react" or "react/jsx-runtime"), never a
 * same-prefix impostor ("reactive"). R10's own predicate. */
function importsModule(spec: string, mod: string): boolean {
  return spec === mod || spec.startsWith(`${mod}/`);
}

export function violatesR10(spec: string): boolean {
  if (R10_FORBIDDEN_MODULES.some((m) => importsModule(spec, m))) return true;
  return R10_FORBIDDEN_PREFIXES.some((p) => spec.startsWith(p));
}

export interface WallViolation {
  /** plugin-relative, forward-slash */
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
}

export function scanPluginSources(root: string): WallViolation[] {
  const out: WallViolation[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".build") continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(abs);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXT.test(entry.name)) continue;
      const rel = relative(root, abs).split(sep).join("/");
      if (AUTHORING_SUBTREES.test(rel)) continue;
      const lines = readFileSync(abs, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        for (const spec of importSpecifiersOnLine(lines[i] ?? "")) {
          if (violatesR10(spec)) out.push({ file: rel, line: i + 1, specifier: spec });
        }
      }
    }
  };
  if (statSync(root).isDirectory()) walk(root);
  return out;
}

export function checkWall(root: string): Verdict[] {
  const violations = scanPluginSources(root);
  if (violations.length === 0)
    return [pass("wall", "plugin sources import only through the SDK door (R10)")];
  return violations.map((v) =>
    refuse("wall", "wall-violation", `${v.specifier} is not reachable from plugin code (§11.3)`, {
      pointer: `${v.file}:${v.line}`,
      expected: `${guidanceFor("wall-violation")} — the forbidden module here is ${v.specifier}`,
    }),
  );
}
