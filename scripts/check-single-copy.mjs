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
import { milleAliases } from "./mille-aliases.mjs";
import { linkedPackages, readLock, siblingDir } from "./siblings.mjs";

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
  // AR-0 sibling mode: a `link:` package resolves its OWN dependencies from
  // the sibling checkout's node_modules, never from this tree's — exactly the
  // "direct sibling link duplicating React" case above. The linked package
  // directories are search roots too, so the law covers the seam a link opens.
  // RD-1: the packages LINKED in this tree (the committed dev rows and the local overlay's), never every package a
  // lock entry names — a released sibling's packages install from the registry, and its checkout is not a seam.
  for (const { dir } of linkedPackages(ROOT).values()) {
    if (existsSync(join(dir, "package.json"))) out.push(dir);
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

/** The one-version-per-tree rule has an exception with its own law (AR-5a,
 * 2026-09-13): a sibling `link:` package that declares react/react-dom as a
 * PEER resolves the sibling checkout's copy by Node's rules, and no override
 * here can change that — the renderer's Vite config and field-app's vitest
 * config `dedupe` react/react-dom to this tree, so ONE React loads where code
 * actually runs. What the dedupe cannot promise is that the sibling was
 * installed against the same VERSION: a peer range satisfied by a different
 * React, hidden by the dedupe, is hooks written against one React running
 * under another. So a sibling-resolved react is compared by version with this
 * tree's, never counted as a second copy; a mismatch, or an uninstalled
 * sibling that cannot resolve its peer at all, is the failure. */
const REACT_PEERS = new Set(["react", "react-dom"]);
const siblingRoots = new Set(roots.filter((dir) => !dir.startsWith(ROOT)));

for (const name of TRACKED) {
  const byPath = new Map(); // realpath -> { version, from[] }
  const siblingVersions = new Map(); // dir -> version, react/react-dom from a link: root
  for (const dir of roots) {
    if (REACT_PEERS.has(name) && siblingRoots.has(dir)) {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (!Object.keys(manifest.peerDependencies ?? {}).includes(name)) continue;
      const hit = resolveFrom(dir, name);
      if (hit === null) {
        problems.push(
          `${manifest.name} declares ${name} as a peer but cannot resolve it from ${dir} — run the sibling's install`,
        );
        continue;
      }
      siblingVersions.set(dir, JSON.parse(readFileSync(hit, "utf8")).version);
      continue;
    }
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
  for (const [dir, theirs] of siblingVersions) {
    if (theirs !== version) {
      problems.push(
        `${name}@${theirs} is what the sibling package at ${dir} resolves; this tree runs ${name}@${version} — the dedupe would run one under the other`,
      );
    }
  }
  report.push(
    `${name}@${version}${siblingVersions.size > 0 ? ` (+${siblingVersions.size} sibling link${siblingVersions.size === 1 ? "" : "s"} at the same version, deduped at bundle time)` : ""}`,
  );
}

/** AR-8c (2026-10-03) — the React peers' TYPES. A linked sibling ships its
 * SOURCE (puppeteer's views; rosetta's room until RD-5a), so this tree's TypeScript
 * compiles it in field-app's program, where each file's `react` resolves the
 * types installed beside IT — the sibling checkout's own `@types/react`. Two
 * installs are one to the compiler only at the same VERSION (it redirects a
 * second copy of name@version to the first); at two versions one program holds
 * two React type worlds. Physical copies are expected — every checkout has its
 * own install — so the members and the linked package directories are
 * compared by version alone, and a second version is the failure. */
const TYPE_PEERS = ["@types/react", "@types/react-dom"];
const typeRoots = members();
for (const name of TYPE_PEERS) {
  const versions = new Map(); // version -> dirs that resolve it
  for (const dir of typeRoots) {
    const hit = resolveFrom(dir, name);
    if (hit === null) continue;
    const version = JSON.parse(readFileSync(hit, "utf8")).version;
    const from = versions.get(version) ?? [];
    from.push(dir === ROOT ? "." : dir.startsWith(ROOT) ? dir.slice(ROOT.length + 1) : dir);
    versions.set(version, from);
  }
  if (versions.size > 1) {
    problems.push(
      `${name} resolves at ${versions.size} versions across this tree and its linked siblings — one program would hold two React type worlds:\n` +
        [...versions].map(([version, from]) => `      ${version}  ← ${from.join(", ")}`).join("\n"),
    );
  } else if (versions.size === 1) {
    const [version] = [...versions.keys()];
    report.push(`${name}@${version} (types: one version here and in every linked sibling)`);
  }
}

// FS-1b: the room brings a link to its own mille checkout. Both renderer
// resolvers must alias every exported entry to the locked checkout, and our
// direct consumers must resolve that same checkout. A version string alone
// cannot distinguish two unreleased builds.
const milleEntry = readLock(ROOT)?.siblings?.mille;
if (milleEntry) {
  const aliases = milleAliases(ROOT);
  for (const [consumer, name] of [
    ["packages/fieldd", "@vibecook/mille"],
    ["packages/field-app", "@vibecook/mille"],
    ["packages/field-app", "@vibecook/mille-ui"],
  ]) {
    const expected = aliases.find((alias) => alias.find === name)?.replacement;
    let actual;
    try {
      actual = realpathSync(join(ROOT, consumer, "node_modules", name));
    } catch {}
    const folder = milleEntry.packages[name];
    if (!expected || !actual || actual !== realpathSync(join(siblingDir(ROOT, milleEntry), folder)))
      problems.push(`${consumer} resolves ${name} outside the locked mille checkout`);
  }
  for (const config of [
    "packages/electron-shell/vite.config.ts",
    "packages/field-app/vitest.config.ts",
  ]) {
    const source = readFileSync(join(ROOT, config), "utf8");
    if (
      !source.includes('from "../../scripts/mille-aliases.mjs"') ||
      !/alias:\s*\[\s*\.\.\.milleAliases\(/.test(source)
    )
      problems.push(`${config} must install the locked mille aliases before other aliases`);
  }
  for (const alias of aliases) {
    if (!existsSync(alias.replacement))
      problems.push(
        `${alias.find} has no built export at ${alias.replacement}; build the pinned mille sibling`,
      );
  }
  report.push(`mille@${milleEntry.sha.slice(0, 8)} (daemon, renderer and room pinned together)`);
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
