import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { repoRoot } from "../src/paths.mjs";

// Item 620 (2026-11-20): biome turns its React rules on for a package only when that package's own
// manifest gives `react` a version in dependencies, devDependencies or peerDependencies; a
// `catalog:` version reads as none. So a package whose `react` is `catalog:` alone gets none of
// them by itself, and every such package must be named in a biome.jsonc override that sets the
// hook rule, or the next one goes silent the way three did. The day none is declared so, the second
// control fails to say that this guard and its override can go.

/** The workspace's package folders, from pnpm-workspace.yaml's `packages:` globs (`dir/*`). */
function workspacePackages() {
  const text = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const globs = [];
  let inPackages = false;
  for (const line of text.split("\n")) {
    if (/^packages:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (/^\S/.test(line)) break;
    const glob = line.match(/^\s*-\s*"?([^"#]+?)"?\s*$/);
    if (glob) globs.push(glob[1]);
  }
  const dirs = [];
  for (const glob of globs) {
    assert.ok(glob.endsWith("/*"), `a workspace glob this test cannot read: ${glob}`);
    const parent = glob.slice(0, -2);
    if (!existsSync(join(repoRoot, parent))) continue;
    for (const entry of readdirSync(join(repoRoot, parent), { withFileTypes: true })) {
      const dir = `${parent}/${entry.name}`;
      if (entry.isDirectory() && existsSync(join(repoRoot, dir, "package.json"))) dirs.push(dir);
    }
  }
  return dirs.sort();
}

/** Whether a package declares `react` at all, and whether biome can read a version from it. */
function reactOf(dir) {
  const manifest = JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));
  const any = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  const read = ["dependencies", "devDependencies", "peerDependencies"];
  return {
    declared: any.some((field) => typeof manifest[field]?.react === "string"),
    versioned: read.some((field) => {
      const version = manifest[field]?.react;
      return typeof version === "string" && !version.startsWith("catalog:");
    }),
  };
}

/** Parses JSONC, dropping comments outside strings and any comma before `}` or `]`. */
function parseJsonc(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      // a comma before a closing bracket, outside any string, is JSONC's and not JSON's
      if (ch === "}" || ch === "]") out = out.replace(/,(\s*)$/, "$1");
      out += ch;
      i += 1;
    }
  }
  return JSON.parse(out);
}

/** The `includes` patterns of every biome.jsonc override that sets the hook rule to a level. */
function hookRuleIncludes() {
  const config = parseJsonc(readFileSync(join(repoRoot, "biome.jsonc"), "utf8"));
  const patterns = new Set();
  for (const override of config.overrides ?? []) {
    const rule = override.linter?.rules?.correctness?.useHookAtTopLevel;
    const level = typeof rule === "string" ? rule : rule?.level;
    if (level === undefined || level === "off") continue;
    for (const pattern of override.includes ?? []) patterns.add(pattern);
  }
  return patterns;
}

test("a package whose react is catalog: alone is named in an override with the hook rule", () => {
  const named = hookRuleIncludes();
  const silent = workspacePackages().filter((dir) => {
    const react = reactOf(dir);
    return react.declared && !react.versioned && !named.has(`${dir}/**`);
  });
  assert.deepEqual(silent, [], `biome runs no React rule on: ${silent.join(", ")}`);
});

test("the reader sees the workspace's React packages, versioned and not (control)", () => {
  const packages = workspacePackages();
  assert.ok(packages.includes("packages/field-app"));
  assert.ok(packages.some((dir) => reactOf(dir).declared && reactOf(dir).versioned));
  assert.ok(
    packages.some((dir) => reactOf(dir).declared && !reactOf(dir).versioned),
    "no package declares react by catalog: alone now: this guard and its override can go",
  );
});

test("parseJsonc keeps a string's slashes, drops comments and a trailing comma (control)", () => {
  const text = '{ "a": "x//y, }", // note\n "b": [1, /* two */ 2,], }';
  assert.deepEqual(parseJsonc(text), { a: "x//y, }", b: [1, 2] });
});
