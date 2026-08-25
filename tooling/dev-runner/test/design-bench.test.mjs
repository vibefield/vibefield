import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  designBenchLaunchSpec,
  designBenchPaths,
  designBenchRendererUrl,
} from "../src/design-bench.mjs";

// The bench paths are composed with `join`, so the fixture composes its
// expectations the same way: the LAYOUT is the property under test, never the
// host's separator.
const ROOT = "/repo";
const benchPath = (...segments) => join(ROOT, ".vibefield", "ui-bench", ...segments);

test("keeps all generated bench state under the ignored development root", () => {
  assert.deepEqual(designBenchPaths(ROOT), {
    runtimeRoot: benchPath(),
    appRoot: benchPath("app"),
    userData: benchPath("electron-user-data"),
    mainEntry: join(ROOT, "packages", "electron-shell", "src", "design-bench", "main.ts"),
    preloadEntry: join(ROOT, "packages", "electron-shell", "src", "design-bench", "preload.ts"),
    mainOutput: benchPath("app", "main.cjs"),
    preloadOutput: benchPath("app", "preload.cjs"),
    manifest: benchPath("app", "package.json"),
  });
});

test("targets the design-system document on the shared Vite renderer", () => {
  assert.equal(
    designBenchRendererUrl("http://127.0.0.1:43123/"),
    "http://127.0.0.1:43123/design-system.html",
  );
});

test("launches Electron with isolated state and no inherited Node-mode flag", () => {
  const paths = designBenchPaths(ROOT);
  const launch = designBenchLaunchSpec({
    electronExecutable: "/electron",
    paths,
    rendererUrl: "http://127.0.0.1:43123/",
    env: { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1" },
  });

  assert.equal(launch.command, "/electron");
  assert.deepEqual(launch.args, [
    `--user-data-dir=${benchPath("electron-user-data")}`,
    benchPath("app"),
  ]);
  assert.equal(
    launch.options.env.VIBEFIELD_UI_BENCH_URL,
    "http://127.0.0.1:43123/design-system.html",
  );
  assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(launch.options.cwd, benchPath("app"));
});
