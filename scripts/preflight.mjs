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
import { readFileSync } from "node:fs";
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

// --- EL8 registry pins (the native-floor NF-0 pin event) ---------------------
// Pins are deliberate upgrade events (EL8); drift or deletion fails HERE, not as
// an Arc<Node> type split or a resolver surprise three slices later. Bumping a
// pin means editing the pin AND this table in one commit — that is the ritual.
const PIN_EXPECTATIONS = [
  { file: "Cargo.toml", re: /^truffle-core\s*=\s*"=0\.7\.11"/m, label: 'truffle-core = "=0.7.11"' },
  { file: "Cargo.toml", re: /^ghosttea\s*=\s*"=0\.8\.0"/m, label: 'ghosttea = "=0.8.0"' },
  {
    file: "pnpm-workspace.yaml",
    re: /"@vibecook\/ghosttea-client":\s*0\.8\.0/,
    label: '"@vibecook/ghosttea-client": 0.8.0',
  },
];
for (const { file, re, label } of PIN_EXPECTATIONS) {
  try {
    const text = readFileSync(resolve(root, file), "utf8");
    if (!re.test(text)) problems.push(`EL8 pin missing or drifted in ${file}: expected ${label}`);
  } catch {
    problems.push(`EL8 pin check could not read ${file}`);
  }
}
// chopsticks: every override in the family must carry ONE version, and that
// version is the pinned one — a drifted SUBSET (runtime bumped, adapters not)
// is the failure mode a per-line table would miss.
{
  const CHOPSTICKS_PIN = "0.1.4";
  try {
    const text = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
    const family = [...text.matchAll(/"@vibecook\/(chopsticks-[a-z-]+)":\s*(\S+)/g)];
    if (family.length === 0) {
      problems.push("EL8 pin missing: no @vibecook/chopsticks-* overrides in pnpm-workspace.yaml");
    }
    for (const [, name, version] of family) {
      if (version !== CHOPSTICKS_PIN) {
        problems.push(
          `EL8 pin drift: @vibecook/${name} pinned ${version}, expected ${CHOPSTICKS_PIN}`,
        );
      }
    }
  } catch {
    problems.push("EL8 pin check could not read pnpm-workspace.yaml");
  }
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

// --- installed desktop identity ---------------------------------------------
// The ledger, electron-builder and runtime AUMID are three consumers of one
// frozen identity. Run both the rule proof and the live comparison in the
// ordinary gate so drift cannot wait until packaging CI to be discovered.
for (const command of [
  "node scripts/check-release-identity.mjs --self-test",
  "node scripts/check-release-identity.mjs --enforce",
]) {
  try {
    execSync(command, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const detail = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    if (detail) console.error(detail);
    problems.push(`release identity check failed (${command})`);
  }
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
