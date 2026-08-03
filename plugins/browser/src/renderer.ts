import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { createElement } from "react";
import { ArtifactPanel } from "./ArtifactPanel";
import { ARTIFACT_SURFACE } from "./manifest";

export default defineRendererPlugin({
  activate(ctx) {
    ctx.logger.info("Renderer plugin activated");
    ctx.surfaces?.register(ARTIFACT_SURFACE, (props) =>
      createElement(ArtifactPanel, { client: ctx.client, surface: props }),
    );
  },
});
