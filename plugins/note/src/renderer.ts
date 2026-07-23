import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { NOTE_TYPE, NoteView } from "./widget";

// P3a — the renderer MODULE (spec §10.1): activation binds implementations for
// the manifest's declared types; the host builds the durable prefab (§12.2).
// Top-level code stays pure — everything starts in activate.

export default defineRendererPlugin({
  activate(ctx) {
    ctx.widgets.register({ type: NOTE_TYPE, binding: { component: NoteView } });
  },
});
