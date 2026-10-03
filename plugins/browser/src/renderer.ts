import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { createElement } from "react";
import { ArtifactPanel } from "./ArtifactPanel";
import { ARTIFACT_SURFACE } from "./manifest";

// DK-2 (desk/landing, ICE 0.14.0): the page widget binds NO face — the desk draws
// no DOM under the camera, so the card (its controller, its tray tile) has
// nowhere to mount; the host compiles `vibefield.browser.page` FACELESS from the
// manifest. The Artifacts side panel is screen-space chrome and stays (DK-D20).

export default defineRendererPlugin({
  activate(ctx) {
    ctx.logger.info("Renderer plugin activated");
    ctx.surfaces?.register(ARTIFACT_SURFACE, (props) =>
      createElement(ArtifactPanel, { client: ctx.client, surface: props }),
    );
  },
});
