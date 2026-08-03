import type { PluginManifestV1 } from "@vibefield/contracts";

export const ARTIFACT_SURFACE = "vibefield.browser.artifacts";

/** Artifact Hub is a built-in actor on a spine-owned stage. Its manifest is
 * deliberately the whole authority request: catalog read, local publication,
 * native folder selection, and validated external open. */
export const browserManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: "vibefield.browser",
  version: "0.1.0",
  title: "Browser",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: [`onSurface:${ARTIFACT_SURFACE}`],
  capabilities: ["artifact.publish", "workspace.read", "shell.dialog", "shell.open"],
  contributes: {
    surfaces: [
      {
        id: ARTIFACT_SURFACE,
        title: "Artifacts",
        slot: "hud.side-panel",
        order: 100,
      },
    ],
  },
};
