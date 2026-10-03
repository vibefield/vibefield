import { defineRendererPlugin } from "@vibefield/plugin-sdk";

// P3a — the renderer MODULE (spec §10.1): activation binds implementations for
// the manifest's declared types; the host builds the durable prefab (§12.2).
// Top-level code stays pure — everything starts in activate.
//
// DK-2 (desk/landing, ICE 0.14.0): `vibefield.note` binds NO face. The desk draws
// object kinds and no DOM under the camera, so the note's React card
// (`NoteView` on `CardShell`) has nowhere to mount and the SDK cut the card
// exports it was built on; the host compiles the type FACELESS from the
// manifest, so every saved note's data survives. ICE's `desk.note` replaces it
// and this plugin retires at DK-8.

export default defineRendererPlugin({
  activate(ctx) {
    ctx.logger.info("Renderer plugin activated");
  },
});
