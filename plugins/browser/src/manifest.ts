import type { PluginManifestV1 } from "@vibefield/contracts";

export const ARTIFACT_SURFACE = "vibefield.browser.artifacts";

/** Artifact Hub is a built-in actor on a spine-owned stage. Its manifest is
 * deliberately the whole authority request: catalog read, local publication,
 * native folder selection, and validated external open.
 *
 * DK-5 (DK-D20): the panel is the plugin's ONLY contribution again. DT-3's
 * canvas browser card (`vibefield.browser.page`) retired with its card face, so
 * the two scopes only it requested — `surface.attach` to mint the attachment,
 * `surface.browser` to make it a browser — leave the grant with it (least power).
 * A board that still names the type holds an absent type (a faceless ghost stub,
 * its data kept); the page returns as an object kind under PORTALS. */
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
