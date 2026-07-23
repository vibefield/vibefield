#!/usr/bin/env node
// Machine-coupling preflight: this repo builds only with its sibling checkouts
// present (README "Getting started", CLAUDE.md "Machine setup"). Hard-fails on
// missing pieces, warns on freshness/version drift. Run: `pnpm preflight`.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const problems = [];
const warnings = [];

// --- sibling checkouts -------------------------------------------------------
const ICE = resolve(root, "../infinite-canvas-engine/packages/ice");
const TRUFFLE = resolve(root, "../p008/truffle/crates/truffle-core");
if (!existsSync(ICE)) {
  problems.push(
    `@vibecook/ice checkout missing at ${ICE} (file: dep in pnpm-workspace.yaml catalog)`,
  );
}
if (!existsSync(TRUFFLE)) {
  problems.push(`truffle-core checkout missing at ${TRUFFLE} (Cargo.toml [patch.crates-io])`);
}

// --- ice dist freshness (the B2 stale-dist class: missing ground.js) ---------
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    const t = entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs;
    if (t > newest) newest = t;
  }
  return newest;
}
if (existsSync(ICE)) {
  const src = join(ICE, "src");
  const dist = join(ICE, "dist");
  if (!existsSync(dist)) {
    problems.push(`ice has no dist/ — build it: cd ${ICE} && pnpm build`);
  } else if (existsSync(src) && newestMtime(src) > newestMtime(dist)) {
    warnings.push(
      "ice dist/ is older than its src/ — rebuild ice or you'll consume stale-dist bugs",
    );
  }
}

// --- cargo-typify (contracts gen; gen:check diffs are version-sensitive) -----
const TYPIFY_EXPECTED = "cargo-typify 0.7.0";
try {
  const v = execSync("cargo typify --version", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
  if (v !== TYPIFY_EXPECTED) {
    warnings.push(
      `${v} installed but contracts.rs was generated with ${TYPIFY_EXPECTED} — gen:check may diff spuriously`,
    );
  }
} catch {
  problems.push(
    "cargo-typify not installed (needed by pnpm gen / gen:check): cargo install cargo-typify",
  );
}

// --- import-boundary self-test (the checker's own fixtures) ------------------
// A rotten rule table makes --enforce meaningless — the 2026-07-23 review found
// the self-test red (stale R4-pending expectations) with nothing running it.
try {
  execSync("node scripts/check-import-boundaries.mjs --self-test", {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  const detail = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
  if (detail) console.error(detail);
  problems.push(
    "import-boundary self-test failed (node scripts/check-import-boundaries.mjs --self-test)",
  );
}

// --- import-boundary walls (spec §8.3; a hard gate since slice 2) ------------
// Enforce mode exits 1 on enforce-true violations. Quiet on success; on failure
// the checker's report (owning rule + file path) is surfaced alongside the
// problem.
try {
  execSync("node scripts/check-import-boundaries.mjs --enforce", {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  const detail = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
  if (detail) console.error(detail);
  problems.push(
    "import-boundary walls failed (node scripts/check-import-boundaries.mjs --enforce)",
  );
}

// --- report ------------------------------------------------------------------
for (const w of warnings) console.warn(`preflight WARN: ${w}`);
for (const p of problems) console.error(`preflight FAIL: ${p}`);
if (problems.length > 0) process.exit(1);
console.log(warnings.length > 0 ? `preflight OK (${warnings.length} warning(s))` : "preflight OK");
