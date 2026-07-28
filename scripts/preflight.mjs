#!/usr/bin/env node
// Environment preflight: tool versions + the import-boundary walls. Hard-fails
// on missing pieces, warns on version drift. Run: `pnpm preflight`.
//
// The sibling-checkout machinery (SIBLINGS map, siblings.lock.json, `pnpm
// siblings:pin`) retired on 2026-07-28: truffle-core became an exact crates-io
// pin (version in the root Cargo.toml) when the T1 petition window closed,
// exactly as @vibecook/ice
// left on 2026-07-25 for npm. The repo builds standalone. If a new petition
// window reopens the ../p008/truffle [patch.crates-io], restore the machinery
// from git history — a path patch without a SHA pin makes verify unreplayable.
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const problems = [];
const warnings = [];

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

// --- tracked filenames stay whitespace-free ----------------------------------
// The dev-runner's Nx watch bridge (tooling/dev-runner/src/nx-watch-event.mjs)
// receives changed paths via NX_FILE_CHANGES, which Nx delimits with
// whitespace. A tracked path containing whitespace would fragment into
// phantom entries and silently mis-target affected typechecks, so the repo
// forbids the class here rather than guessing at reassembly there.
try {
  const tracked = execSync("git ls-files -z", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .split("\0")
    .filter(Boolean);
  const withWhitespace = tracked.filter((path) => /\s/.test(path));
  if (withWhitespace.length > 0) {
    problems.push(
      `tracked filenames contain whitespace (breaks the Nx watch event protocol): ${withWhitespace
        .slice(0, 5)
        .join(", ")}${withWhitespace.length > 5 ? ", …" : ""}`,
    );
  }
} catch {
  warnings.push("could not enumerate tracked files (git ls-files failed)");
}

// --- report ------------------------------------------------------------------
for (const w of warnings) console.warn(`preflight WARN: ${w}`);
for (const p of problems) console.error(`preflight FAIL: ${p}`);
if (problems.length > 0) process.exit(1);
console.log(warnings.length > 0 ? `preflight OK (${warnings.length} warning(s))` : "preflight OK");
