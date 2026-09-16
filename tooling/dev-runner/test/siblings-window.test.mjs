// The sibling lock's THREE kinds of consumption, tested where the dev runner
// already depends on that module (it reads the same lock for rosettad).
//
// `pnpm preflight` is the gate for the live tree; these are the derivations it
// gates WITH — a parser that silently skips a row it cannot read, or a binary
// path spelled one component wrong, turns every one of those checks into a
// green that proves nothing. The RFC 025 window (2026-09-16) added two of the
// three, so they arrive with the seam.
//
// The staging rows below (UA-P-W3) are the fourth consumer: which truffle
// sidecar a PACKAGE ships. They are here and not beside stage-package.mjs
// because that script does its work at import time and cannot be loaded as a
// module — the decision it calls is what is testable, so the decision is what
// lives in siblings.mjs.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  cargoPatchRows,
  goSidecar,
  goSidecarState,
  patchPath,
  sidecarStagingSource,
  stamp,
} from "../../../scripts/siblings.mjs";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");

function fixtureRoot({ cargoToml = null, lock = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vf-siblings-"));
  if (cargoToml !== null) writeFileSync(join(root, "Cargo.toml"), cargoToml);
  if (lock !== null) writeFileSync(join(root, "siblings.lock.json"), JSON.stringify(lock, null, 2));
  return root;
}

test("cargoPatchRows reads one row per line and ignores everything outside the section", () => {
  const root = fixtureRoot({
    cargoToml: [
      "[workspace.dependencies]",
      'truffle-core = "=0.7.13"',
      "",
      "[patch.crates-io]",
      "# a comment, not a row",
      'truffle-core = { path = "../truffle-rfc025/crates/truffle-core" }',
      "",
      "[profile.dev]",
      "opt-level = 1",
      "",
    ].join("\n"),
  });
  const { rows, unreadable } = cargoPatchRows(root);
  assert.deepEqual([...rows], [["truffle-core", "../truffle-rfc025/crates/truffle-core"]]);
  assert.deepEqual(unreadable, []);
  // The requirement above the section is NOT a patch row, and the profile below
  // it is not one either: a reader that ran past either boundary would report a
  // patch nothing declares and fail the family rule on a healthy tree.
  assert.equal(rows.has("opt-level"), false);
});

test("cargoPatchRows REPORTS a row it cannot read rather than skipping it", () => {
  const root = fixtureRoot({
    cargoToml: ["[patch.crates-io]", "truffle-core = {", '  path = "../elsewhere"', "}", ""].join(
      "\n",
    ),
  });
  const { rows, unreadable } = cargoPatchRows(root);
  // Silence here is the dangerous answer: a multi-line row cargo honours would
  // be an unpinned path patch this checker never mentioned.
  assert.equal(rows.has("truffle-core"), false);
  assert.ok(unreadable.includes("truffle-core = {"));
});

test("cargoPatchRows records a non-path patch row with a null path", () => {
  const root = fixtureRoot({
    cargoToml: ["[patch.crates-io]", 'some-crate = { git = "https://example.invalid/x" }', ""].join(
      "\n",
    ),
  });
  const { rows } = cargoPatchRows(root);
  assert.deepEqual([...rows], [["some-crate", null]]);
});

test("cargoPatchRows is empty when the manifest has no patch section at all", () => {
  const root = fixtureRoot({ cargoToml: '[workspace]\nmembers = ["a"]\n' });
  const { rows, unreadable } = cargoPatchRows(root);
  assert.equal(rows.size, 0);
  assert.deepEqual(unreadable, []);
});

test("patchPath spells the crate directory the way the lock spells the checkout", () => {
  assert.equal(
    patchPath({ path: "../truffle-rfc025" }, "crates/truffle-core"),
    "../truffle-rfc025/crates/truffle-core",
  );
});

test("goSidecar lands the binary where the floor looks: <repo>/target/debug", () => {
  const lock = {
    siblings: {
      rosetta: { path: "../rosetta", sha: "a".repeat(40), cargo: { crate: "rosettad" } },
      truffle: {
        path: "../truffle-rfc025",
        sha: "b".repeat(40),
        go: { module: "packages/sidecar-slim", binary: "sidecar-slim" },
      },
    },
  };
  const root = fixtureRoot({ lock });
  const unix = goSidecar(root, "darwin");
  assert.equal(unix.name, "truffle");
  assert.equal(unix.path, join(root, "target", "debug", "sidecar-slim"));
  assert.equal(unix.moduleDir, join(root, "..", "truffle-rfc025", "packages/sidecar-slim"));
  // WIN-7: the sidecar ships sidecar-slim.exe, and a bare name would never
  // match the file beside field-native.exe (mesh.rs SIDECAR_NAMES says so).
  assert.equal(goSidecar(root, "win32").path, join(root, "target", "debug", "sidecar-slim.exe"));
  // A lock with no go sibling owes nothing.
  assert.equal(goSidecar(fixtureRoot({ lock: { siblings: {} } })), null);
});

test("the Nx stamp carries the go sibling's built state, absent included", () => {
  const lock = {
    siblings: {
      truffle: {
        path: "../truffle-rfc025",
        sha: "b".repeat(40),
        go: { module: "packages/sidecar-slim", binary: "sidecar-slim" },
      },
    },
  };
  const root = fixtureRoot({ lock });
  assert.match(stamp(root), /^truffle@missing\+sidecar-slim:absent$/);
  mkdirSync(join(root, "target", "debug"), { recursive: true });
  writeFileSync(join(root, "target", "debug", "sidecar-slim"), "x");
  assert.match(stamp(root), /^truffle@missing\+sidecar-slim:\d+$/);
});

test("nx.json actually CONSUMES the sibling stamp", async () => {
  // The named input existed from AR-0 and no target referenced it, so a sibling
  // edit missed no cache for three weeks. The stamp is only an input if
  // something names it; this is that assertion.
  const nx = JSON.parse(
    await import("node:fs/promises").then((fs) => fs.readFile(join(REPO_ROOT, "nx.json"), "utf8")),
  );
  assert.ok(
    nx.namedInputs.default.includes("siblings"),
    "nx.json namedInputs.default must reference `siblings` — typecheck/test/build all resolve through it",
  );
  assert.ok(
    nx.namedInputs.siblings.some((input) => input.runtime?.includes("siblings.mjs stamp")),
    "the siblings input must run the stamp, not just watch the lock file",
  );
});

/** A fixture tree with a go sibling: the checkout's module (one .go source) and,
 * optionally, a built binary under <root>/target/debug. `built: "stale"` makes
 * the binary older than the source, which is the only thing the freshness rule
 * looks at. */
function goFixture({ built = "fresh" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vf-stage-"));
  const checkout = join(root, "..", "truffle-fixture");
  const moduleDir = join(checkout, "packages/sidecar-slim");
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(moduleDir, "main.go"), "package main\n");
  writeFileSync(
    join(root, "siblings.lock.json"),
    JSON.stringify({
      siblings: {
        truffle: {
          path: "../truffle-fixture",
          sha: "c".repeat(40),
          go: { module: "packages/sidecar-slim", binary: "sidecar-slim" },
        },
      },
    }),
  );
  if (built !== "missing") {
    mkdirSync(join(root, "target/debug"), { recursive: true });
    const binary = join(root, "target/debug/sidecar-slim");
    writeFileSync(binary, "binary");
    if (built === "stale") {
      const before = Date.now() / 1000 - 600;
      utimesSync(binary, before, before);
    }
  }
  return root;
}

test("staging takes the REGISTRY sidecar when no window is open", () => {
  const root = fixtureRoot({ lock: { siblings: {} } });
  assert.deepEqual(sidecarStagingSource(root), { source: "npm" });
  // And with no lock at all — registry mode, the state the exit returns to.
  assert.deepEqual(sidecarStagingSource(fixtureRoot()), { source: "npm" });
});

test("staging takes the WINDOW's sidecar, by a repo-relative path", () => {
  const root = goFixture();
  const choice = sidecarStagingSource(root, "darwin");
  assert.equal(choice.source, "window");
  // Repo-relative, because a stage PLAN row is resolved against the repo root —
  // an absolute path here would stage correctly on this machine only.
  assert.equal(choice.from, "target/debug/sidecar-slim");
  assert.equal(goSidecarState(root, "darwin").state, "fresh");
});

test("staging REFUSES rather than falling back when the window's sidecar is missing", () => {
  const root = goFixture({ built: "missing" });
  const choice = sidecarStagingSource(root, "darwin");
  // The fallback is the dangerous answer: a released sidecar beside a floor
  // built from the window degrades every linked desktop at bring-up, under a
  // green build. So there is no `from` here at all.
  assert.equal(choice.source, "refuse");
  assert.equal(choice.from, undefined);
  assert.match(choice.reason, /missing/);
  assert.match(choice.reason, /pnpm siblings:build/);
  assert.match(choice.reason, /protocol 5/);
});

test("staging REFUSES when the window's sidecar is older than its source", () => {
  const root = goFixture({ built: "stale" });
  assert.equal(goSidecarState(root, "darwin").state, "stale");
  const choice = sidecarStagingSource(root, "darwin");
  assert.equal(choice.source, "refuse");
  assert.match(choice.reason, /stale/);
});

test("stage-package.mjs consults the decision and keeps its refusal", () => {
  // A source-level guard, deliberately narrow: this script cannot be imported
  // (it stages at import time), so the one thing worth pinning is that it still
  // asks and still refuses. Reintroducing an unconditional registry row would
  // be silent everywhere else.
  const script = readFileSync(join(REPO_ROOT, "scripts/stage-package.mjs"), "utf8");
  assert.match(script, /import \{ sidecarStagingSource \} from "\.\/siblings\.mjs"/);
  assert.match(script, /sidecarStagingSource\(repoRoot\)/);
  assert.match(script, /stage REFUSED/);
});
