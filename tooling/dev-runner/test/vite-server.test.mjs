import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { resolveConfig } from "vite";
import { linkedPackages } from "../../../scripts/siblings.mjs";
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

test("product, Studio, and browser catalog share one dependency optimizer graph", async () => {
  const linkedIce = linkedPackages(workspacePaths.repoRoot).has("@vibecook/ice");
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
    assert.deepEqual(config.optimizeDeps.entries, [
      "index.html",
      "studio-product.html",
      "studio.html",
      "design-system.html",
    ]);
    // Registry ICE is optimized as one family; linked ICE stays in the source
    // graph so its desk and root entries cannot register the same core twice.
    assert.deepEqual(
      config.optimizeDeps.include.filter((id) => id.includes("@vibecook/ice")),
      linkedIce
        ? []
        : [
            "@vibefield/field-app > @vibecook/ice/desk",
            "@vibefield/field-app > @vibecook/ice/desk/engine",
            "@vibefield/field-app > @vibecook/ice/desk/objects",
            "@vibefield/field-app > @vibecook/ice/desk/kit",
          ],
    );
    assert.equal(config.optimizeDeps.exclude.includes("@vibecook/ice"), linkedIce);
    assert.ok(
      !config.optimizeDeps.include.some(
        (id) => id.includes("@react-three/") || id.endsWith("three"),
      ),
    );
  }
});

test("the production renderer and browser catalog have disjoint build outputs", async () => {
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

  // P8b-3 §11.6: the product document, plus one entry chunk per host singleton
  // so the import map has an address to name. The exact specifier list is
  // contracts' and is pinned there (electron-shell's host-singletons test);
  // what this row owns is the SHAPE — the product build carries them, the catalog
  // build carries none, and the two halves are asserted together because a
  // browser catalog getting a plugin loader it has no daemon for is the mistake.
  const productionInputs = Object.keys(production.build.rollupOptions.input);
  const singletonInputs = productionInputs.filter((name) => name.startsWith("singleton-"));
  assert.ok(singletonInputs.length > 0, "the production renderer emits host singleton chunks");
  assert.deepEqual(productionInputs, ["main", ...singletonInputs]);
  assert.equal(
    production.build.rollupOptions.input.main,
    join(workspacePaths.repoRoot, "packages/electron-shell/src/renderer-host/index.html"),
  );
  assert.equal(
    production.build.outDir,
    join(workspacePaths.repoRoot, "packages/electron-shell/dist/renderer"),
  );

  // The design build carries only the catalog, separate from product entries.
  assert.deepEqual(Object.keys(design.build.rollupOptions.input), ["design-system"]);
  assert.equal(
    design.build.rollupOptions.input["design-system"],
    join(workspacePaths.repoRoot, "packages/electron-shell/src/renderer-host/design-system.html"),
  );
  assert.equal(
    design.build.outDir,
    join(workspacePaths.repoRoot, ".vibefield/studio/catalog-renderer"),
  );
});
