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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  cargoBuildFreshness,
  cargoBuiltFrom,
  cargoPatchRows,
  devSidecar,
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

// The truffle bump (2026-10-17): the DEV floor's sidecar, by the staging rule.
// A debug field-native in a shared cargo target dir finds whatever sidecar the
// last truffle build left beside it, so the dev runner hands it this answer.

test("a dev floor runs the vendored registry sidecar when no window is open", () => {
  const root = fixtureRoot({ lock: { siblings: {} } });
  // before `pnpm install`: nothing on disk, so nothing to name
  assert.deepEqual(devSidecar(root, "darwin", "arm64"), { source: "npm", path: null });
  const bin = join(root, "apps/desktop/node_modules/@vibecook/truffle-sidecar-darwin-arm64/bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "sidecar-slim"), "binary");
  assert.deepEqual(devSidecar(root, "darwin", "arm64"), {
    source: "npm",
    path: join(bin, "sidecar-slim"),
  });
  // the package is per platform AND arch, and Windows ships the .exe
  const win = join(root, "apps/desktop/node_modules/@vibecook/truffle-sidecar-win32-x64/bin");
  mkdirSync(win, { recursive: true });
  writeFileSync(join(win, "sidecar-slim.exe"), "binary");
  assert.equal(devSidecar(root, "win32", "x64").path, join(win, "sidecar-slim.exe"));
  assert.equal(devSidecar(root, "darwin", "x64").path, null, "another arch's package is not ours");
});

test("a dev floor runs the WINDOW's sidecar while a window is open", () => {
  const root = goFixture();
  assert.deepEqual(devSidecar(root, "darwin", "arm64"), {
    source: "window",
    path: join(root, "target", "debug", "sidecar-slim"),
  });
});

test("a dev floor is handed nothing, with the reason, when the window's sidecar is not built", () => {
  for (const built of ["missing", "stale"]) {
    const choice = devSidecar(goFixture({ built }), "darwin", "arm64");
    assert.equal(choice.source, "window", built);
    // never the registry binary beside a window build, and never a path to nothing
    assert.equal(choice.path, null, built);
    assert.match(choice.reason, /pnpm siblings:build/, built);
  }
});

test("stage-package.mjs consults the decision and keeps its refusal", () => {
  // A source-level guard, deliberately narrow: this script cannot be imported
  // (it stages at import time), so the one thing worth pinning is that it still
  // asks and still refuses. Reintroducing an unconditional registry row would
  // be silent everywhere else.
  const script = readFileSync(join(REPO_ROOT, "scripts/stage-package.mjs"), "utf8");
  assert.match(script, /import \{[^}]*\bsidecarStagingSource\b[^}]*\} from "\.\/siblings\.mjs"/);
  assert.match(script, /sidecarStagingSource\(repoRoot\)/);
  assert.match(script, /stage REFUSED/);
});

test("stage-package.mjs stages the lock's own rosettad, optionally (AR-8, L3)", () => {
  // The same narrow guard for the other sibling binary a package carries: the
  // stage asks the lock's reader for rosettad (never a path of its own), and the
  // row stays optional — a package without it boots and says so in History.
  const script = readFileSync(join(REPO_ROOT, "scripts/stage-package.mjs"), "utf8");
  assert.match(script, /import \{[^}]*\brosettadBinary\b[^}]*\} from "\.\/siblings\.mjs"/);
  assert.match(script, /rosettadBinary\(repoRoot\)/);
  assert.match(script, /stage: `bin\/\$\{rosettadName\}`,[^}]*\boptional:/);
});

// Item 56 (2026-10-21) — rosettad's freshness is cargo's record, never a walk.
// Preflight warned "a Rust source is newer than the built rosettad" on every
// run since the RD-5a pin move, while `cargo build --release -p rosettad`
// called the binary fresh: the walk it asked counted every file under
// `crates/`, and the one newer file was a `#[cfg(test)]` module
// (rosetta-pin's `crates/pipeline/src/capture/tests/tolerance.rs`) that a
// release build never reads. Cargo writes what it compiled into the dep-info
// file beside the binary; that list is the question's only honest source.

/** A rosetta-shaped checkout and a cargo target holding a built rosettad and
 * the dep-info cargo wrote for it. Every recorded source is ten minutes older
 * than the binary unless a row moves one; `depInfo(binary)` overrides the
 * record — a function, because the record names the binary the fixture made. */
function cargoFixture({ depInfo } = {}) {
  const checkout = mkdtempSync(join(tmpdir(), "vf-rosetta-"));
  const sources = {
    lib: join(checkout, "crates/pipeline/src/lib.rs"),
    capture: join(checkout, "crates/pipeline/src/capture/mod.rs"),
    test: join(checkout, "crates/pipeline/src/capture/tests/tolerance.rs"),
    main: join(checkout, "crates/rosettad/src/main.rs"),
  };
  for (const file of Object.values(sources)) {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "// source\n");
  }
  const release = join(checkout, "target/release");
  mkdirSync(release, { recursive: true });
  const binary = join(release, "rosettad");
  writeFileSync(binary, "binary");
  // cargo's record: what rustc read for the binary and its local crates — the
  // test module is not in it, because a release build never compiles it
  const recorded = [sources.lib, sources.capture, sources.main];
  writeFileSync(`${binary}.d`, depInfo?.(binary) ?? `${binary}: ${recorded.join(" ")}\n`);
  const now = Date.now() / 1000;
  utimesSync(binary, now - 600, now - 600);
  for (const file of Object.values(sources)) utimesSync(file, now - 1200, now - 1200);
  return { checkout, binary, sources, now };
}

test("item 56: a test-only file newer than rosettad is no source of it — the build is fresh", () => {
  const { checkout, binary, sources, now } = cargoFixture();
  // the RD-5a shape: the pin move touched only the `#[cfg(test)]` module
  utimesSync(sources.test, now, now);
  assert.deepEqual(cargoBuildFreshness(binary, checkout), { state: "fresh" });
  assert.ok(!cargoBuiltFrom(binary, checkout).includes(sources.test));
});

test("a source cargo recorded, newer than rosettad, is stale and named", () => {
  const { checkout, binary, sources, now } = cargoFixture();
  utimesSync(sources.capture, now, now);
  assert.deepEqual(cargoBuildFreshness(binary, checkout), {
    state: "stale",
    source: sources.capture,
  });
});

test("a source cargo recorded that is gone is stale — cargo rebuilds for a missing file", () => {
  const { checkout, binary, sources } = cargoFixture();
  rmSync(sources.lib);
  assert.deepEqual(cargoBuildFreshness(binary, checkout), {
    state: "stale",
    source: sources.lib,
    gone: true,
  });
});

test("a binary with no dep-info beside it is unrecorded, never called fresh", () => {
  const { checkout, binary } = cargoFixture();
  rmSync(`${binary}.d`);
  assert.equal(cargoBuiltFrom(binary, checkout), null);
  assert.deepEqual(cargoBuildFreshness(binary, checkout), { state: "unrecorded" });
});

test("the dep-info reader: continuations, escaped spaces, relative paths, comments, empty rules, .exe", () => {
  const { checkout, binary } = cargoFixture({
    depInfo: (built) =>
      [
        "# a comment line is no rule",
        `${built}: crates/a\\ b/src/lib.rs \\`,
        `  /abs/one.rs`,
        "crates/a\\ b/src/lib.rs:",
        "",
      ].join("\n"),
  });
  assert.deepEqual(cargoBuiltFrom(binary, checkout), [
    join(checkout, "crates/a b/src/lib.rs"),
    "/abs/one.rs",
  ]);
  // Windows: the record of `rosettad.exe` is `rosettad.d`, beside it
  assert.deepEqual(cargoBuiltFrom(`${binary}.exe`, checkout), cargoBuiltFrom(binary, checkout));
});

test("every rosettad freshness reader asks cargo's record, and the checkout walk is gone", async () => {
  // The walk is not kept beside the record: two freshness rules are a rule
  // that disagrees with itself (as `goSidecarState`'s doc says of three).
  const exported = await import("../../../scripts/siblings.mjs");
  assert.equal(exported.newestSourceMtime, undefined);
  const read = (file) => readFileSync(join(REPO_ROOT, file), "utf8");
  assert.match(read("scripts/preflight.mjs"), /rosettadState\(root\)/);
  assert.match(read("scripts/stage-package.mjs"), /cargoBuildFreshness\(rosettadBuilt\.path/);
  assert.match(
    read("scripts/check-agent-catalog.mjs"),
    /freshness: cargoBuildFreshness\(bin\.path/,
  );
});
