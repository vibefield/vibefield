import assert from "node:assert/strict";
import { isAbsolute, join, relative } from "node:path";
import test from "node:test";
import { commandEndpointFor, devLayoutFor, devRootFor, workspacePaths } from "../src/paths.mjs";

test("uses a repository-local Unix socket on POSIX hosts", () => {
  assert.equal(
    commandEndpointFor("/repo", "/repo/.vibefield/dev", "darwin"),
    "/repo/.vibefield/dev/runner.sock",
  );
  assert.equal(
    commandEndpointFor("/repo", "/repo/.vibefield/dev", "linux"),
    "/repo/.vibefield/dev/runner.sock",
  );
});

test("derives a stable repository-scoped Windows named pipe", () => {
  const first = commandEndpointFor("C:\\src\\vibe-field", "unused", "win32");
  const repeated = commandEndpointFor("C:\\src\\vibe-field", "elsewhere", "win32");
  const other = commandEndpointFor("C:\\src\\other", "unused", "win32");
  const prefix = String.raw`\\.\pipe\vibefield-dev-`;

  assert.equal(first.startsWith(prefix), true);
  assert.match(first.slice(prefix.length), /^[a-f0-9]{20}$/);
  assert.equal(repeated, first);
  assert.notEqual(other, first);
});

test("DK-18: keeps its state in the checkout unless VIBEFIELD_DEV_ROOT moves it whole", () => {
  assert.equal(devRootFor("/repo", {}), "/repo/.vibefield/dev");
  assert.equal(devRootFor("/repo", { VIBEFIELD_DEV_ROOT: "" }), "/repo/.vibefield/dev");
  assert.equal(devRootFor("/repo", { VIBEFIELD_DEV_ROOT: "/tmp/vf-studio-x" }), "/tmp/vf-studio-x");
});

test("BP-1c: a dev run's data root lies inside Electron's userData — the dev root itself — and stays where it was", () => {
  const dev = join("/repo", ".vibefield", "dev");
  const layout = devLayoutFor(dev);
  assert.equal(layout.electronUserData, dev);
  assert.equal(layout.dataRoot, join(dev, "data"));
  assert.equal(layout.legacyElectronUserData, join(dev, "electron-user-data"));
  // the desk browser's profiles (`<data root>/users/<fuid>/browser/profiles`) lie inside userData: Chromium writes their
  // cookie database only there (BP-D9)
  const profiles = join(layout.dataRoot, "users", "1", "browser", "profiles");
  const rel = relative(layout.electronUserData, profiles);
  assert.ok(rel !== "" && !rel.startsWith("..") && !isAbsolute(rel), rel);
  // a moved dev root (DK-18's VIBEFIELD_DEV_ROOT) nests the same way
  const moved = devLayoutFor(join("/tmp", "vf-studio-x"));
  assert.equal(moved.electronUserData, join("/tmp", "vf-studio-x"));
  assert.equal(moved.dataRoot, join("/tmp", "vf-studio-x", "data"));
});

test("BP-1c: the runner's own paths follow the layout — userData is the dev root, the old folder is named apart", () => {
  assert.equal(workspacePaths.electronUserData, workspacePaths.devRoot);
  assert.equal(workspacePaths.dataRoot, join(workspacePaths.devRoot, "data"));
  assert.equal(
    workspacePaths.legacyElectronUserData,
    join(workspacePaths.devRoot, "electron-user-data"),
  );
});
