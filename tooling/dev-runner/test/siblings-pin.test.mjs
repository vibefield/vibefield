import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
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

function fixture(t, otherName = "rosetta", gateExit = 0) {
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
  const run = (...names) =>
    spawnSync(process.execPath, [cli, "pin", ...names], { cwd: root, encoding: "utf8" });
  return { root, rendererHead, other, run, gateMarker };
}

for (const sibling of ["rosetta", "puppeteer"]) {
  test(`named pin stops before building or checking a mismatched ${sibling}`, (t) => {
    const { root, rendererHead, other, run, gateMarker } = fixture(t, sibling);
    other.commit();
    const result = run("renderer");
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${sibling} HEAD .* differs from pin`));
    assert.doesNotMatch(result.stdout, /building rosettad/);
    assert.equal(existsSync(gateMarker), false);
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

test("named pin checks the catalog with enforcement once all checkouts match their pins", (t) => {
  const { root, rendererHead, other, run, gateMarker } = fixture(t);
  const result = run("renderer");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(gateMarker, "utf8")), [
    "--enforce",
    "--require-rosetta",
  ]);
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
  const { root, rendererHead, run, gateMarker } = fixture(t, "rosetta", 42);
  const result = run("renderer");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /wall R23 is red/);
  assert.equal(readLock(root).siblings.renderer.sha, rendererHead);
  assert.equal(existsSync(gateMarker), true);
});
