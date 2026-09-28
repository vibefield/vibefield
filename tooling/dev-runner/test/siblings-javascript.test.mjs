import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildJavaScript, fetchSibling, installJavaScript } from "../../../scripts/siblings.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "vf-sibling-js-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "consumer");
  mkdirSync(root);
  const writeLock = (entry) => {
    writeFileSync(
      join(root, "siblings.lock.json"),
      JSON.stringify({ siblings: { example: entry } }),
    );
  };
  return { dir, root, writeLock };
}

test("fetch uses the lock's path and revision, preserving existing dirty checkouts", (t) => {
  const { dir, root, writeLock } = fixture(t);
  const source = join(dir, "upstream");
  mkdirSync(source);
  const git = (...args) => execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim();
  git("init", "--quiet");
  writeFileSync(join(source, "version.txt"), "pinned");
  git("add", ".");
  const commit = () =>
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qam",
      "fixture",
    );
  commit();
  const pinned = git("rev-parse", "HEAD");
  writeFileSync(join(source, "version.txt"), "newer");
  commit();
  const tip = git("rev-parse", "HEAD");
  writeLock({ path: "../checkout with spaces", repository: source, sha: pinned });

  assert.equal(fetchSibling(root, "example"), 0);
  const checkout = join(dir, "checkout with spaces");
  assert.equal(readFileSync(join(checkout, "version.txt"), "utf8"), "pinned");
  writeFileSync(join(checkout, "version.txt"), "developer edit");
  assert.equal(fetchSibling(root, "example"), 0);
  assert.equal(readFileSync(join(checkout, "version.txt"), "utf8"), "developer edit");

  writeLock({ path: "../checkout with spaces", repository: source, sha: tip });
  assert.throws(() => fetchSibling(root, "example"), /refusing to change it/);
  assert.equal(readFileSync(join(checkout, "version.txt"), "utf8"), "developer edit");
});

test("frozen installation and ordered builds produce usable exports from a clean sibling", (t) => {
  const { dir, root, writeLock } = fixture(t);
  const checkout = join(dir, "renderer");
  const write = (path, text) => writeFileSync(join(checkout, path), text);
  for (const pkg of ["protocol", "renderer"]) mkdirSync(join(checkout, pkg), { recursive: true });
  write("package.json", JSON.stringify({ private: true, workspaces: ["protocol", "renderer"] }));
  for (const pkg of ["protocol", "renderer"]) {
    write(
      `${pkg}/package.json`,
      JSON.stringify({
        name: `fixture-${pkg}`,
        version: "1.0.0",
        type: "module",
        exports: "./dist/index.js",
        scripts: { build: "node build.mjs", preinstall: "node -e 'process.exit(42)'" },
        ...(pkg === "renderer" ? { dependencies: { "fixture-protocol": "1.0.0" } } : {}),
      }),
    );
  }
  write(
    "protocol/build.mjs",
    `import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.js", "export const protocol = 42;");
`,
  );
  write(
    "renderer/build.mjs",
    `import { protocol } from "fixture-protocol";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.js", "export const rendered = " + protocol + ";");
`,
  );
  execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: checkout, shell: process.platform === "win32", stdio: "pipe" },
  );
  const lock = readFileSync(join(checkout, "package-lock.json"), "utf8");
  writeLock({
    path: "../renderer",
    javascript: { workspaces: ["fixture-protocol", "fixture-renderer"] },
  });
  assert.equal(existsSync(join(checkout, "node_modules")), false);
  assert.equal(existsSync(join(checkout, "renderer/dist")), false);
  assert.equal(installJavaScript(root), 0);
  assert.equal(readFileSync(join(checkout, "package-lock.json"), "utf8"), lock);
  assert.equal(buildJavaScript(root), 0);
  assert.equal(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import { rendered } from 'fixture-renderer'; console.log(rendered)",
      ],
      { cwd: checkout, encoding: "utf8" },
    ).trim(),
    "42",
  );

  // A dependency build failure must stop before a stale consumer can be rebuilt.
  write("protocol/build.mjs", "process.exit(23)");
  write("renderer/build.mjs", "throw new Error('must not run')");
  assert.equal(buildJavaScript(root), 23);
});
