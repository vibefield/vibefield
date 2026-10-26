// Electron's binary, fetched and proven (scripts/electron-binary.mjs): Electron 43 has no postinstall, so CI's verify job
// and `siblings use` run its own install.js here, and a binary that is not there and executable afterwards is refused in
// words. A fake Electron package stands in: its install.js says how it was run and writes what the case gives it.
import assert from "node:assert/strict";
import {
  chmodSync,
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
import { ensureElectronBinary } from "../../../scripts/electron-binary.mjs";

/** A tree whose desktop resolves a fake Electron; `install` is the body of its install.js, after a line counting runs. */
function tree(t, install) {
  const root = mkdtempSync(join(tmpdir(), "vf-electron-binary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "apps", "desktop"), { recursive: true });
  writeFileSync(join(root, "apps", "desktop", "package.json"), '{ "name": "desktop" }\n');
  const electron = join(root, "node_modules", "electron");
  mkdirSync(electron, { recursive: true });
  writeFileSync(join(electron, "package.json"), '{ "name": "electron" }\n');
  writeFileSync(
    join(electron, "install.js"),
    'const fs = require("node:fs"), path = require("node:path");\n' +
      'fs.appendFileSync(path.join(__dirname, "runs"), "x");\n' +
      install,
  );
  // the module names the package by its real path (macOS's tmpdir is a link into /private)
  const real = realpathSync(electron);
  return { root, electron: real, runs: () => readFileSync(join(real, "runs"), "utf8").length };
}

const WRITES_BINARY =
  'fs.mkdirSync(path.join(__dirname, "dist", "bin"), { recursive: true });\n' +
  'fs.writeFileSync(path.join(__dirname, "dist", "bin", "electron"), "#!/bin/sh\\n");\n' +
  'fs.chmodSync(path.join(__dirname, "dist", "bin", "electron"), 0o755);\n' +
  'fs.writeFileSync(path.join(__dirname, "path.txt"), "bin/electron");\n';

test("no Electron resolvable from apps/desktop is null, never a fetch", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vf-electron-binary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(ensureElectronBinary(root), null);
});

test("a package with no binary is fetched by its own install.js, proven, and then left alone", (t) => {
  const { root, electron, runs } = tree(t, WRITES_BINARY);
  const binary = join(electron, "dist", "bin", "electron");
  assert.deepEqual(ensureElectronBinary(root), { binary, installed: true });
  assert.deepEqual(ensureElectronBinary(root), { binary, installed: false });
  assert.equal(runs(), 1, "an executable binary is never fetched again");
});

test("path.txt naming a file that is not executable runs install.js again, and passes only if it then is", (t) => {
  const { root, electron, runs } = tree(t, WRITES_BINARY);
  ensureElectronBinary(root);
  chmodSync(join(electron, "dist", "bin", "electron"), 0o644);
  assert.equal(ensureElectronBinary(root).installed, true);
  assert.equal(runs(), 2);
});

test("an install.js that writes path.txt alone is refused in words: no executable binary", (t) => {
  const { root } = tree(t, 'fs.writeFileSync(path.join(__dirname, "path.txt"), "bin/electron");\n');
  assert.throws(
    () => ensureElectronBinary(root),
    /Electron's binary is not installed at .* \(no path\.txt\), and its install\.js did not restore it \(exit 0; path\.txt names dist\/bin\/electron, which is not an executable file\)/,
  );
});

test("an install.js that fails is refused in words with its exit code", (t) => {
  const { root } = tree(t, "process.exit(3);\n");
  assert.throws(
    () => ensureElectronBinary(root),
    /\(no path\.txt\), and its install\.js did not restore it \(exit 3; no path\.txt\) — run `node install\.js` there/,
  );
});
