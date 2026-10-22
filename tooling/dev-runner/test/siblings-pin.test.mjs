import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readLock } from "../../../scripts/siblings.mjs";

function fixture(t, otherName = "rosetta", gateExit = 0, typecheckExit = 0) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "vf-sibling-pin-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "consumer");
  const scripts = join(root, "scripts");
  mkdirSync(scripts, { recursive: true });
  const cli = join(scripts, "siblings.mjs");
  copyFileSync(new URL("../../../scripts/siblings.mjs", import.meta.url), cli);
  const gateMarker = join(root, "catalog-called.json");
  writeFileSync(
    join(scripts, "check-agent-catalog.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(gateMarker)}, JSON.stringify(process.argv.slice(2)));
process.exit(${gateExit});
`,
  );
  const checkout = (name) => {
    const cwd = join(dir, name);
    mkdirSync(cwd);
    const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    git("init", "--quiet");
    const commit = () => {
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--allow-empty",
        "-qm",
        name,
      );
      return git("rev-parse", "HEAD");
    };
    return { path: `../${name}`, sha: commit(), commit, cwd };
  };
  const renderer = checkout("renderer");
  const other = checkout(otherName);
  const lock = {
    siblings: {
      renderer: { path: renderer.path, sha: renderer.sha },
      [otherName]: { path: other.path, sha: other.sha },
    },
  };
  writeFileSync(join(root, "siblings.lock.json"), JSON.stringify(lock));
  const rendererHead = renderer.commit();
  // The consumers' typecheck (2026-10-04): `pin` runs `pnpm typecheck` in the
  // consumer root. This root has no workspace, so `pnpm` is shadowed on the
  // CLI's PATH by a stand-in that records where it ran and what it was asked,
  // then exits as the row says — the manual proof's PATH shadow, kept.
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const typecheckMarker = join(root, "typecheck-called.txt");
  const pnpm = join(bin, "pnpm");
  writeFileSync(
    pnpm,
    `#!/bin/sh\nprintf '%s\\n' "$(pwd -P)" "$@" > ${JSON.stringify(typecheckMarker)}\nexit ${typecheckExit}\n`,
  );
  chmodSync(pnpm, 0o755);
  const run = (...names) =>
    spawnSync(process.execPath, [cli, "pin", ...names], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
  const typecheckCall = () =>
    existsSync(typecheckMarker)
      ? readFileSync(typecheckMarker, "utf8").trimEnd().split("\n")
      : null;
  return { root, rendererHead, other, run, gateMarker, typecheckCall };
}

for (const sibling of ["rosetta", "puppeteer"]) {
  test(`named pin stops before building or checking a mismatched ${sibling}`, (t) => {
    const { root, rendererHead, other, run, gateMarker, typecheckCall } = fixture(t, sibling);
    other.commit();
    const result = run("renderer");
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${sibling} HEAD .* differs from pin`));
    assert.doesNotMatch(result.stdout, /building rosettad/);
    assert.equal(existsSync(gateMarker), false);
    assert.equal(typecheckCall(), null);
    assert.equal(readLock(root).siblings.renderer.sha, rendererHead);
    assert.equal(readLock(root).siblings[sibling].sha, other.sha);
  });
}

test("named pin refuses a missing unselected checkout without running the catalog gate", (t) => {
  const { root, other, run, gateMarker } = fixture(t);
  rmSync(other.cwd, { recursive: true });
  const result = run("renderer");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rosetta is not a git checkout/);
  assert.doesNotMatch(result.stdout, /building rosettad/);
  assert.equal(existsSync(gateMarker), false);
  assert.equal(readLock(root).siblings.rosetta.sha, other.sha);
});

test("named pin passes over an unselected sibling whose every plane is released and that has no checkout here", (t) => {
  // 2026-10-22 (the ghosttea 0.13.0 EL8): truffle after G28 is released on its one plane, so a machine without
  // ../truffle-rfc025 still pins the others; a bare pin (the case above) still refuses
  const { root, rendererHead, other, run, gateMarker } = fixture(t);
  const lockFile = join(root, "siblings.lock.json");
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  lock.siblings.rosetta = {
    ...lock.siblings.rosetta,
    swift: { manifest: "Package.swift", link: ".window/rosetta" },
    release: { swift: "1.0.0" },
  };
  writeFileSync(lockFile, JSON.stringify(lock));
  rmSync(other.cwd, { recursive: true });
  const result = run("renderer");
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /rosetta has no checkout here and needs none — every plane is released/,
  );
  assert.equal(readLock(root).siblings.renderer.sha, rendererHead);
  assert.equal(readLock(root).siblings.rosetta.sha, other.sha);
  assert.equal(existsSync(gateMarker), true);
});

test("named pin checks the catalog with enforcement once all checkouts match their pins", (t) => {
  const { root, rendererHead, other, run, gateMarker, typecheckCall } = fixture(t);
  const result = run("renderer");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(gateMarker, "utf8")), [
    "--enforce",
    "--require-rosetta",
  ]);
  // …and then typechecks the consumers, the gate's own step, in the consumer root.
  assert.deepEqual(typecheckCall(), [root, "typecheck"]);
  assert.match(result.stdout, /typechecking the consumers at the new pins/);
  assert.equal(readLock(root).siblings.renderer.sha, rendererHead);
  assert.equal(readLock(root).siblings.rosetta.sha, other.sha);
});

test("pinning all siblings updates their revisions before enforcing the catalog", (t) => {
  const { root, rendererHead, other, run, gateMarker } = fixture(t);
  const otherHead = other.commit();
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readLock(root).siblings.renderer.sha, rendererHead);
  assert.equal(readLock(root).siblings.rosetta.sha, otherHead);
  assert.equal(existsSync(gateMarker), true);
});

test("uncommitted sibling edits warn but do not change revision pinning policy", (t) => {
  const { other, run, gateMarker } = fixture(t);
  writeFileSync(join(other.cwd, "local-edit.txt"), "in progress");
  const result = run("renderer");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /rosetta working tree is dirty/);
  assert.equal(existsSync(gateMarker), true);
});

test("a catalog rejection remains fatal after recording the named pin", (t) => {
  const { root, rendererHead, run, gateMarker, typecheckCall } = fixture(t, "rosetta", 42);
  const result = run("renderer");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /wall R23 is red/);
  assert.equal(readLock(root).siblings.renderer.sha, rendererHead);
  assert.equal(existsSync(gateMarker), true);
  // R23 first: a red catalog is settled before the consumers are compiled.
  assert.equal(typecheckCall(), null);
});

test("a consumer that does not typecheck at the new pins keeps them recorded and fails loudly", (t) => {
  const { root, rendererHead, other, run, gateMarker, typecheckCall } = fixture(t, "rosetta", 0, 2);
  const result = run("renderer");
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /the new pins ARE recorded in siblings\.lock\.json, but the consumers do not typecheck at them — pnpm typecheck is red above/,
  );
  assert.equal(existsSync(gateMarker), true);
  assert.deepEqual(typecheckCall(), [root, "typecheck"]);
  assert.equal(readLock(root).siblings.renderer.sha, rendererHead);
  assert.equal(readLock(root).siblings.rosetta.sha, other.sha);
});

test("--skip-typecheck is the deliberate case: the pin stands, the catalog is proved, and the skip is said", (t) => {
  const { root, rendererHead, run, gateMarker, typecheckCall } = fixture(t, "rosetta", 0, 2);
  const result = run("--skip-typecheck", "renderer");
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stderr,
    /--skip-typecheck — the consumers were NOT typechecked at the new pins/,
  );
  assert.equal(typecheckCall(), null);
  assert.equal(existsSync(gateMarker), true);
  assert.equal(readLock(root).siblings.renderer.sha, rendererHead);
});

test("an unknown flag is refused before anything is pinned", (t) => {
  const { root, run, gateMarker, typecheckCall } = fixture(t);
  const before = readFileSync(join(root, "siblings.lock.json"), "utf8");
  const result = run("--skip-typechek", "renderer");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown flag --skip-typechek — the one flag is --skip-typecheck/);
  assert.equal(readFileSync(join(root, "siblings.lock.json"), "utf8"), before);
  assert.equal(existsSync(gateMarker), false);
  assert.equal(typecheckCall(), null);
});
