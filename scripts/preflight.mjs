#!/usr/bin/env node
// Machine-coupling preflight: this repo builds only with its sibling checkouts
// present (README "Getting started", CLAUDE.md "Machine setup"). Hard-fails on
// missing pieces, warns on freshness/version drift. Run: `pnpm preflight`.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const problems = [];
const warnings = [];

// --- sibling revision pins (siblings.lock.json) ------------------------------
// The ice file: dep and the truffle cargo [patch] point at WORKING TREES —
// presence checks alone leave the build unreproducible: a green verify can't be
// replayed without knowing which sibling revisions it ran against. The lock
// records the SHAs; preflight verifies them. Updating the lock IS the deliberate
// upgrade event (EL8 spirit): sync the sibling, then `pnpm siblings:pin`. Dirty
// sibling trees only WARN — co-developing them is the normal state; the pin is
// about the base revision.
const SIBLINGS = {
  "infinite-canvas-engine": resolve(root, "../infinite-canvas-engine"),
  truffle: resolve(root, "../p008/truffle"),
};
const SIBLINGS_LOCK = join(root, "siblings.lock.json");

function siblingSha(dir) {
  return execSync("git rev-parse HEAD", { cwd: dir, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

function siblingDirty(dir) {
  return (
    execSync("git status --porcelain", { cwd: dir, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim().length > 0
  );
}

if (process.argv.includes("--pin-siblings")) {
  const pinned = {};
  for (const [name, dir] of Object.entries(SIBLINGS)) {
    try {
      pinned[name] = siblingSha(dir);
    } catch {
      console.error(`siblings:pin FAIL: ${name} is not a git checkout at ${dir}`);
      process.exit(1);
    }
  }
  const doc = {
    "//": "Machine-coupled sibling revisions. Verified by pnpm preflight; update deliberately via pnpm siblings:pin (EL8: upgrades are events, never drift).",
    siblings: pinned,
  };
  writeFileSync(SIBLINGS_LOCK, `${JSON.stringify(doc, null, 2)}\n`);
  for (const [name, sha] of Object.entries(pinned)) console.log(`pinned ${name} @ ${sha}`);
  process.exit(0);
}

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

// --- sibling revisions vs the lock -------------------------------------------
if (!existsSync(SIBLINGS_LOCK)) {
  problems.push("siblings.lock.json missing — run `pnpm siblings:pin` to record sibling revisions");
} else {
  const lock = JSON.parse(readFileSync(SIBLINGS_LOCK, "utf8"));
  for (const [name, dir] of Object.entries(SIBLINGS)) {
    if (!existsSync(dir)) continue; // presence failure already reported above
    let sha = null;
    try {
      sha = siblingSha(dir);
    } catch {
      warnings.push(`${name}: not a git checkout at ${dir} — revision pin unverifiable`);
      continue;
    }
    const pinned = lock.siblings?.[name];
    if (pinned === undefined) {
      problems.push(`${name} has no entry in siblings.lock.json — run \`pnpm siblings:pin\``);
    } else if (sha !== pinned) {
      problems.push(
        `${name} is at ${sha.slice(0, 12)} but siblings.lock.json pins ` +
          `${String(pinned).slice(0, 12)} — sync the sibling to the pin, or accept the new ` +
          "revision deliberately: `pnpm siblings:pin` (EL8)",
      );
    }
    try {
      if (siblingDirty(dir)) {
        warnings.push(`${name} working tree is dirty — verify runs against unpinned edits`);
      }
    } catch {
      // status unavailable: the SHA check above already covered the repo shape
    }
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
