import assert from "node:assert/strict";
import test from "node:test";
import {
  designBenchLaunchSpec,
  designBenchPaths,
  designBenchRendererUrl,
} from "../src/design-bench.mjs";

test("keeps all generated bench state under the ignored development root", () => {
  assert.deepEqual(designBenchPaths("/repo"), {
    runtimeRoot: "/repo/.vibefield/ui-bench",
    appRoot: "/repo/.vibefield/ui-bench/app",
    userData: "/repo/.vibefield/ui-bench/electron-user-data",
    mainEntry: "/repo/packages/electron-shell/src/design-bench/main.ts",
    preloadEntry: "/repo/packages/electron-shell/src/design-bench/preload.ts",
    mainOutput: "/repo/.vibefield/ui-bench/app/main.cjs",
    preloadOutput: "/repo/.vibefield/ui-bench/app/preload.cjs",
    manifest: "/repo/.vibefield/ui-bench/app/package.json",
  });
});

test("targets the design-system document on the shared Vite renderer", () => {
  assert.equal(
    designBenchRendererUrl("http://127.0.0.1:43123/"),
    "http://127.0.0.1:43123/design-system.html",
  );
});

test("launches Electron with isolated state and no inherited Node-mode flag", () => {
  const paths = designBenchPaths("/repo");
  const launch = designBenchLaunchSpec({
    electronExecutable: "/electron",
    paths,
    rendererUrl: "http://127.0.0.1:43123/",
    env: { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1" },
  });

  assert.equal(launch.command, "/electron");
  assert.deepEqual(launch.args, [
    "--user-data-dir=/repo/.vibefield/ui-bench/electron-user-data",
    "/repo/.vibefield/ui-bench/app",
  ]);
  assert.equal(
    launch.options.env.VIBEFIELD_UI_BENCH_URL,
    "http://127.0.0.1:43123/design-system.html",
  );
  assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(launch.options.cwd, "/repo/.vibefield/ui-bench/app");
});
