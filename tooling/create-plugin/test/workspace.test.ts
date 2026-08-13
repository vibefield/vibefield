// The placement probe. Its parser is homegrown (the scaffolder may depend only
// on contracts and plugin-build, so there is no YAML library here), which is
// exactly why it is tested against the REAL pnpm-workspace.yaml rather than
// against a tidy fixture: this repository's own file is comment-heavy, has
// several keys after `packages:`, and is the file the answer actually depends on.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findWorkspaceRoot,
  globToRegExp,
  placementFor,
  readWorkspaceGlobs,
} from "../src/workspace";
import { freshDir } from "./fixtures";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

describe("reading this repository's own workspace file", () => {
  it("finds the root from inside a package", () => {
    expect(findWorkspaceRoot(import.meta.dirname)).toBe(REPO_ROOT);
  });

  it("reads every packages glob, and stops at the next key", () => {
    const globs = readWorkspaceGlobs(REPO_ROOT);
    expect(globs).toEqual([
      "packages/*",
      "plugins/*",
      "examples/plugins/*",
      "tooling/*",
      "apps/*",
      "services/*",
    ]);
    // `allowBuilds`, `overrides` and `catalog` all follow `packages:` in that
    // file; a scanner that ran past the block would drag their values in.
    for (const glob of globs) expect(glob).not.toContain(":");
  });

  it("places a plugin directory as a member, and names the glob it matched", () => {
    const placement = placementFor(join(REPO_ROOT, "plugins", "demo"));
    expect(placement).toEqual({ root: REPO_ROOT, glob: "plugins/*", member: true });
  });

  it("places a path one level too deep as a non-member", () => {
    // `plugins/*` is ONE segment; a nested directory is not a workspace package,
    // and telling an author to run pnpm install for it would be a lie.
    expect(placementFor(join(REPO_ROOT, "plugins", "demo", "inner")).member).toBe(false);
    expect(placementFor(join(REPO_ROOT, "docs")).member).toBe(false);
    expect(placementFor(REPO_ROOT).member).toBe(false);
  });

  it("places a path outside the repository as a non-member", () => {
    expect(placementFor(freshDir()).member).toBe(false);
  });
});

describe("the glob dialect", () => {
  it.each([
    ["packages/*", "packages/contracts", true],
    ["packages/*", "packages/contracts/src", false],
    ["packages/*", "packages", false],
    ["examples/plugins/*", "examples/plugins/widgetlab", true],
    ["examples/plugins/*", "examples/other/widgetlab", false],
    ["apps/**", "apps/desktop/renderer", true],
    ["apps/**", "apps", false],
  ])("%s matches %s → %s", (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });

  it("treats regex metacharacters in a glob as literals", () => {
    expect(globToRegExp("packages/a.b").test("packages/a.b")).toBe(true);
    expect(globToRegExp("packages/a.b").test("packages/axb")).toBe(false);
  });
});

describe("a workspace file this repository does not have", () => {
  it("reads a quoted, commented block", () => {
    const root = freshDir();
    writeFileSync(
      join(root, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  # a comment line",
        '  - "plugins/*"   # trailing comment',
        "  - 'apps/*'",
        "  - services/*",
        "onlyBuiltDependencies:",
        "  - esbuild",
        "",
      ].join("\n"),
    );
    expect(readWorkspaceGlobs(root)).toEqual(["plugins/*", "apps/*", "services/*"]);
  });

  it("answers honestly when there is no packages key at all", () => {
    const root = freshDir();
    writeFileSync(join(root, "pnpm-workspace.yaml"), "catalog:\n  react: ^19.0.0\n");
    expect(readWorkspaceGlobs(root)).toEqual([]);
    expect(placementFor(join(root, "plugins", "demo"))).toEqual({ root, member: false });
  });
});
