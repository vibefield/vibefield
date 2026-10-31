import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { createElement } from "react";
import { ArtifactPanel } from "./ArtifactPanel";
import { ARTIFACT_SURFACE } from "./manifest";

// DK-5 (DK-D20): the plugin is its Artifacts side panel alone — screen-space chrome.
// The canvas page widget (`vibefield.browser.page`, DT-3) retired with its card face
// and `BrowserPageView`: the desk draws no DOM under the camera, and the page returns
// as an object kind under PORTALS.

export default defineRendererPlugin({
  activate(ctx) {
    ctx.logger.info("Renderer plugin activated");
    ctx.surfaces?.register(ARTIFACT_SURFACE, () =>
      createElement(ArtifactPanel, { client: ctx.client }),
    );
  },
});
