import assert from "node:assert/strict";
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
