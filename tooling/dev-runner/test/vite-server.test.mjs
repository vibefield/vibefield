import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { resolveConfig } from "vite";
import { workspacePaths } from "../src/paths.mjs";
import { rendererDevelopmentDefines } from "../src/vite-server.mjs";

test("the ordinary renderer keeps forced onboarding disabled", () => {
  assert.deepEqual(rendererDevelopmentDefines(), {
    __VIBEFIELD_FORCE_ONBOARDING__: "false",
  });
});

test("the onboarding run mode compiles the renderer with the preview enabled", () => {
  assert.deepEqual(rendererDevelopmentDefines({ forceOnboarding: true }), {
    __VIBEFIELD_FORCE_ONBOARDING__: "true",
  });
});

test("the onboarding dev define overrides the packaged renderer default", async () => {
  const config = await resolveConfig(
    {
      configFile: workspacePaths.viteConfig,
      mode: "development",
      define: rendererDevelopmentDefines({ forceOnboarding: true }),
    },
    "serve",
    "development",
  );

  assert.equal(config.define?.__VIBEFIELD_FORCE_ONBOARDING__, "true");
});

test("product and UI Bench launches share one complete dependency optimizer graph", async () => {
  const configs = await Promise.all(
    ["development", "design"].map((mode) =>
      resolveConfig(
        {
          configFile: workspacePaths.viteConfig,
          mode,
        },
        "serve",
        mode,
      ),
    ),
  );

  for (const config of configs) {
    assert.deepEqual(config.optimizeDeps.entries, ["index.html", "design-system.html"]);
    assert.ok(config.optimizeDeps.include.includes("@vibefield/field-app > @react-three/fiber"));
  }
});

test("the production renderer and development UI Bench have disjoint build outputs", async () => {
  const [production, design] = await Promise.all(
    ["production", "design"].map((mode) =>
      resolveConfig(
        {
          configFile: workspacePaths.viteConfig,
          mode,
        },
        "build",
        mode,
      ),
    ),
  );

  assert.deepEqual(Object.keys(production.build.rollupOptions.input), ["main"]);
  assert.equal(
    production.build.rollupOptions.input.main,
    join(workspacePaths.repoRoot, "packages/electron-shell/src/renderer-host/index.html"),
  );
  assert.equal(
    production.build.outDir,
    join(workspacePaths.repoRoot, "packages/electron-shell/dist/renderer"),
  );

  assert.deepEqual(Object.keys(design.build.rollupOptions.input), ["design-system"]);
  assert.equal(
    design.build.rollupOptions.input["design-system"],
    join(workspacePaths.repoRoot, "packages/electron-shell/src/renderer-host/design-system.html"),
  );
  assert.equal(design.build.outDir, join(workspacePaths.repoRoot, ".vibefield/ui-bench/renderer"));
});
