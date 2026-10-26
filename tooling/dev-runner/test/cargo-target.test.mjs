// Tooling (a), 2026-10-26 — scripts/cargo-target.mjs: where cargo puts THIS workspace's artifacts, asked of cargo.
// The stage (scripts/stage-package.mjs) and fieldd's native harness read field-native's binaries through it; both
// read `target/{release,debug}/<bin>` as path literals before, which CARGO_TARGET_DIR, CARGO_BUILD_TARGET_DIR or a
// config's `build.target-dir` (one shared directory on James's Mac) made a stale file or none. The stage does its
// work at import time and cannot be loaded as a module (siblings-window.test.mjs says why), so its shape is held by a
// source guard here, and the decision it calls is tested directly.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cargoBinaries, workspaceTargetDir } from "../../../scripts/cargo-target.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/** The run's own overrides out (a lane exports CARGO_TARGET_DIR), so each row's is the one cargo reads. */
function plainEnv() {
  const env = { ...process.env };
  delete env.CARGO_TARGET_DIR;
  delete env.CARGO_BUILD_TARGET_DIR;
  return env;
}

/** A one-crate cargo workspace, optionally with its own `.cargo/config.toml` `target-dir`. */
function workspace(targetDir) {
  const root = mkdtempSync(join(tmpdir(), "vf-cargo-target-"));
  writeFileSync(
    join(root, "Cargo.toml"),
    '[package]\nname = "probe"\nversion = "0.0.0"\nedition = "2021"\n',
  );
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "lib.rs"), "");
  if (targetDir !== undefined) {
    mkdirSync(join(root, ".cargo"));
    writeFileSync(join(root, ".cargo", "config.toml"), `[build]\ntarget-dir = "${targetDir}"\n`);
  }
  return root;
}

test("cargo's own answer: a config's target-dir, then CARGO_BUILD_TARGET_DIR over it, then CARGO_TARGET_DIR over both", (t) => {
  const root = workspace("/from-config");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = plainEnv();
  assert.equal(workspaceTargetDir(root, env), "/from-config");
  assert.equal(
    workspaceTargetDir(root, { ...env, CARGO_BUILD_TARGET_DIR: "/from-build-env" }),
    "/from-build-env",
  );
  assert.equal(
    workspaceTargetDir(root, {
      ...env,
      CARGO_BUILD_TARGET_DIR: "/from-build-env",
      CARGO_TARGET_DIR: "/from-env",
    }),
    "/from-env",
  );
});

test("never <root>/target by guess: with no override, the directory cargo names", (t) => {
  const root = workspace("/shared-target");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.notEqual(workspaceTargetDir(root, plainEnv()), join(root, "target"));
});

test("a root cargo cannot read is refused in words, never a guessed path", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vf-cargo-none-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => workspaceTargetDir(root, plainEnv()), /cargo could not say where .* builds/);
});

test("cargoBinaries is list-shaped: each name at <target>/<profile>/<file>, .exe on win32 only", (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...plainEnv(), CARGO_TARGET_DIR: "/t" };
  const names = ["field-native", "field-terminal-host", "a-third-binary"];
  assert.deepEqual(cargoBinaries(root, "release", names, { env, platform: "darwin" }), [
    { name: "field-native", file: "field-native", path: join("/t", "release", "field-native") },
    {
      name: "field-terminal-host",
      file: "field-terminal-host",
      path: join("/t", "release", "field-terminal-host"),
    },
    {
      name: "a-third-binary",
      file: "a-third-binary",
      path: join("/t", "release", "a-third-binary"),
    },
  ]);
  assert.deepEqual(
    cargoBinaries(root, "debug", ["field-native"], { env, platform: "win32" }).map((b) => b.path),
    [join("/t", "debug", "field-native.exe")],
  );
});

test("the stage reads field-native's binaries through it, as one list shipped as a SET — never target/release literals", () => {
  const source = readFileSync(join(REPO_ROOT, "scripts", "stage-package.mjs"), "utf8");
  assert.match(source, /import \{ cargoBinaries \} from "\.\/cargo-target\.mjs"/);
  assert.doesNotMatch(source, /from: `target\/release\//);
  assert.match(source, /name: "field-native"/);
  assert.match(source, /name: "field-terminal-host"/);
  assert.match(source, /`SET {2}\$\{nativeStaged\.join/);
  const harness = readFileSync(
    join(REPO_ROOT, "packages", "fieldd", "test", "native-harness.ts"),
    "utf8",
  );
  assert.match(harness, /cargoBinaries\(root, "debug", \["field-native"\]/);
  assert.doesNotMatch(harness, /join\(root, "target", "debug"/);
});
