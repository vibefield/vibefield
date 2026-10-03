import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { setWidgetlabLogger } from "./logging";
import { StatusSurface } from "./StatusSurface";

// C1b·2/P3a — the renderer MODULE (spec §10.1): activation binds
// implementations for the manifest's declared types; the host builds the
// durable prefab (§12.2). Top-level code stays pure — everything starts in
// activate.
//
// DK-2 (desk/landing, ICE 0.14.0): the eighteen cards bind NO face. Their DOM
// cards stood on the SDK's cut `CardShell`/`WidgetComponentProps`, and the seven
// GL cards on ICE's R3F islands (`@vibecook/ice/r3f`, `GlLiftGroup`) — the desk
// draws object kinds and no DOM under the camera, so every card module went with
// the cut; the host compiles all eighteen types FACELESS from the manifest, and
// a dogfood board's widgetlab data survives. This plugin retires at DK-8 (the
// demo set is dropped, DK-D14); the status panel is screen-space and stays.

export default defineRendererPlugin({
  activate(ctx) {
    setWidgetlabLogger(ctx.logger);
    ctx.track({ dispose: () => setWidgetlabLogger(null) });
    ctx.logger.info("Renderer plugin activated");
    // P6 dogfood (§13.2) — bind the hud.panel status surface. ctx.surfaces is
    // present because the manifest declares the surfaces contribution (§10.2).
    ctx.surfaces?.register("vibefield.widgetlab.status", StatusSurface);
  },
});
