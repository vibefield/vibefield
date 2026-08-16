#!/usr/bin/env node
// EL8's runtime half: fail if any two workspace members would LOAD DIFFERENT
// COPIES of loro-crdt, @vibecook/ice, or @vibecook/strata-ecs.
//
// The pin table in preflight.mjs asserts what the manifests SAY. This asserts
// what Node will actually RESOLVE, and the two are not the same claim — an
// override can be silently inert. Upstream proved it: strata-ecs kept its
// overrides in package.json's "pnpm" key, pnpm >=10 reads workspace settings
// ONLY from pnpm-workspace.yaml, and its loro-crdt override was ignored for a
// window while every manifest still read correctly (strata commit 493e766).
// This repo keeps its overrides in the right file, so that exact failure is not
// live here — which is precisely when a backstop is cheap to add.
//
// Why these: loro-crdt is wasm with instance-identity checks, so a LoroDoc built
// by one copy fails `expected instance of LoroDoc` in another; ICE and strata
// each carry a process-global schema registry, so two copies mean two registries
// at one seam and components that silently do not match; react/react-dom keep
// hook state in module scope, so a second copy breaks hooks with an error that
// blames the component. Every one of these surfaces far from its cause, and no
// unit suite catches any of them — nothing in a single package's tests hands an
// object across a package seam.
//
// react joined 2026-08-16: PRC-4's E10 consumer-feasibility run found a direct
// sibling `pnpm link` duplicating React, and kept it as a negative control
// because release evidence has to prove PHYSICAL peer singletons, not declared
// ones. That is this file's whole job, so it should cover the case that actually
// bit — and the sibling-link workflow the ice pin comment recommends for
// co-developing ICE is exactly how a developer reaches it.
//
// Do NOT reimplement this by counting `node_modules/.pnpm/<name>@*` directories:
// that store retains orphaned versions from earlier installs and reports
// duplicates nothing links.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRACKED = ["loro-crdt", "@vibecook/ice", "@vibecook/strata-ecs", "react", "react-dom"];

/** Workspace member dirs from pnpm-workspace.yaml's `packages:` list, globs expanded. */
function members() {
  const out = [ROOT];
  const yaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  for (const line of yaml.split("\n")) {
    if (/^\S/.test(line) && !/^packages:/.test(line) && out.length > 1) break;
    const m = /^\s*-\s*["']?([^"'#\s]+)["']?\s*$/.exec(line);
    if (m === null) continue;
    const entry = m[1];
    if (!entry.endsWith("/*")) {
      out.push(join(ROOT, entry));
      continue;
    }
    const parent = join(ROOT, entry.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const d of readdirSync(parent, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(parent, d.name, "package.json"))) {
        out.push(join(parent, d.name));
      }
    }
  }
  return out;
}

/** Resolve `name` the way Node will for code living in `dir`; null when absent. */
function resolveFrom(dir, name) {
  try {
    return realpathSync(createRequire(join(dir, "package.json")).resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

const problems = [];
const report = [];
// Search roots are the workspace members PLUS each tracked package's own
// resolved directory — @vibecook/strata-ecs reaches this tree through ICE, so
// the ice→strata edge is the seam that matters and no member declares it.
const roots = members();
for (const name of TRACKED) {
  for (const dir of roots.slice()) {
    const hit = resolveFrom(dir, name);
    if (hit !== null && !roots.includes(dirname(hit))) roots.push(dirname(hit));
  }
}

for (const name of TRACKED) {
  const byPath = new Map(); // realpath -> { version, from[] }
  for (const dir of roots) {
    const hit = resolveFrom(dir, name);
    if (hit === null) continue;
    let entry = byPath.get(hit);
    if (entry === undefined) {
      entry = { version: JSON.parse(readFileSync(hit, "utf8")).version, from: [] };
      byPath.set(hit, entry);
    }
    entry.from.push(dir === ROOT ? "." : dir.startsWith(ROOT) ? dir.slice(ROOT.length + 1) : dir);
  }
  if (byPath.size === 0) continue;
  if (byPath.size > 1) {
    problems.push(
      `${byPath.size} distinct ${name} copies are resolvable:\n` +
        [...byPath]
          .map(([p, { version, from }]) => `      ${version}  ← ${from.join(", ")}\n        ${p}`)
          .join("\n"),
    );
    continue;
  }
  const [{ version }] = [...byPath.values()];
  report.push(`${name}@${version}`);
}

if (problems.length > 0) {
  process.stderr.write(`\n✗ EL8 single-copy law violated:\n\n  ${problems.join("\n\n  ")}\n\n`);
  process.stderr.write(
    "  These are ONE-VERSION packages: loro-crdt is wasm with instance-identity\n" +
      "  checks; ICE and strata carry process-global schema registries. Fix the\n" +
      "  overrides block in pnpm-workspace.yaml (NOT package.json — pnpm >=10 reads\n" +
      "  workspace settings only from the yaml) and reinstall.\n",
  );
  process.exit(1);
}

process.stdout.write(`check-single-copy: ok — one copy each of ${report.join(", ")}\n`);
