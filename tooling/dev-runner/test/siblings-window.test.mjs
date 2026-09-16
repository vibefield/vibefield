// The sibling lock's THREE kinds of consumption, tested where the dev runner
// already depends on that module (it reads the same lock for rosettad).
//
// `pnpm preflight` is the gate for the live tree; these are the derivations it
// gates WITH — a parser that silently skips a row it cannot read, or a binary
// path spelled one component wrong, turns every one of those checks into a
// green that proves nothing. The RFC 025 window (2026-09-16) added two of the
// three, so they arrive with the seam.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cargoPatchRows, goSidecar, patchPath, stamp } from "../../../scripts/siblings.mjs";

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
