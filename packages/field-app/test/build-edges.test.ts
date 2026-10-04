// @vitest-environment node
// DK-8 (the orchestrator's ruling 2) — EVERY RENDERER PLUGIN A DEV RUN STAGES IS BUILT BY `build:all`.
// fieldd stages `<repo>/plugins` (bundled) and `<repo>/examples/plugins` (dev-linked) from each one's
// `dist/` (packages/electron-shell/src/main/resources.ts), and the smokes' censuses count what it
// staged. `build:all` is `nx run @vibefield/desktop:build`, whose `^build` reaches a package only
// through the dependency graph: desktop → electron-shell → field-app → … . A renderer plugin with no
// edge into that graph is staged from whatever `dist/` its last hand build or test left — the
// behavior-conformance carrier was, until DK-8 (DK-6's open question 2), and the browser plugin's
// stale artifact named a deleted design-kit module for a slice. field-app is the edge: each renderer
// plugin is one of its dependencies (a product plugin the dev fallback imports) or devDependencies.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "..", "..", "..");

interface Pkg {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** Every plugin directory a dev run stages, with its package name and whether it ships a renderer. */
function stagedPlugins(): { dir: string; name: string; renderer: boolean }[] {
  const out: { dir: string; name: string; renderer: boolean }[] = [];
  for (const root of ["plugins", "examples/plugins"]) {
    for (const entry of readdirSync(join(REPO, root), { withFileTypes: true })) {
      const dir = join(root, entry.name);
      const manifest = join(REPO, dir, "vibefield.plugin.json");
      if (!entry.isDirectory() || !existsSync(manifest)) continue;
      const m = readJson<{ entries?: { renderer?: string } }>(manifest);
      out.push({
        dir,
        name: readJson<Pkg>(join(REPO, dir, "package.json")).name,
        renderer: m.entries?.renderer !== undefined,
      });
    }
  }
  return out;
}

describe("build:all builds every renderer plugin a dev run stages (DK-8, ruling 2)", () => {
  const fieldApp = readJson<Pkg>(join(REPO, "packages/field-app/package.json"));
  const edges = new Set([
    ...Object.keys(fieldApp.dependencies ?? {}),
    ...Object.keys(fieldApp.devDependencies ?? {}),
  ]);

  it("finds the staged plugins, the renderer ones among them", () => {
    const renderers = stagedPlugins().filter((p) => p.renderer);
    expect(renderers.map((p) => p.dir)).toContain("examples/plugins/behavior-conformance");
    expect(renderers.length).toBeGreaterThan(2);
  });

  it("each renderer plugin is a field-app dependency — the edge `nx run @vibefield/desktop:build` builds it by", () => {
    // desktop → electron-shell → field-app: the chain `^build` walks
    const shell = readJson<Pkg>(join(REPO, "packages/electron-shell/package.json"));
    const desktop = readJson<Pkg>(join(REPO, "apps/desktop/package.json"));
    expect(Object.keys(shell.dependencies ?? {})).toContain("@vibefield/field-app");
    expect(Object.keys(desktop.devDependencies ?? {})).toContain("@vibefield/electron-shell");
    const unbuilt = stagedPlugins()
      .filter((p) => p.renderer && !edges.has(p.name))
      .map((p) => `${p.dir} (${p.name})`);
    expect(unbuilt).toEqual([]);
  });
});
