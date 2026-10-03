import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import type { CanvasEngine } from "@vibefield/plugin-sdk/canvas";
import { COMMENT_COMMAND, spawnCommentAroundSelection } from "./commands";

// C1b/P3a — the renderer MODULE (spec §10.1): activation binds implementations
// for the manifest's declared types; the host builds the durable prefab
// (§12.2). Top-level code stays pure — everything starts in activate.
// Registration follows the manifest's declared order (folder → comment).
//
// P6 (§13) — activation also binds the comment COMMAND handler. The spine
// invokes it (C key = canvas-context, or the ⌘K palette) and this handler acts
// on the §12.7 canvas handle. The former direct field-app import is retired.
//
// DK-2 (desk/landing, ICE 0.14.0): the folder and the comment bind NO face. The
// desk draws object kinds and no DOM under the camera, so their React cards
// (`FolderView`/`CommentView` on `CardShell`/`useDragLift`) have nowhere to mount
// and the SDK cut the card exports they were built on; the host compiles both
// types FACELESS from the manifest, so saved folders and comments keep their
// data. ICE's `desk.minimat` and the comment pad (DK-8) replace them, and this
// plugin retires at DK-8. The command stays: it is engine ops, not a face.

export default defineRendererPlugin({
  activate(ctx) {
    ctx.logger.info("Renderer plugin activated");
    // ctx.commands is present because the manifest declares the command;
    // ctx.canvas is present because it requests canvas.write (§10.2). The `?.`
    // keeps this honest if a future host withholds either (absent, not stubbed).
    ctx.commands?.register(COMMENT_COMMAND, () => {
      const engine = ctx.canvas?.engine() as CanvasEngine | null | undefined;
      if (engine === null || engine === undefined) {
        // Honest no-op: no canvas is mounted (daemon-away boot, doc switch gap).
        ctx.logger.warn("comment command invoked with no canvas engine — no-op");
        return;
      }
      spawnCommentAroundSelection(engine);
    });
  },
});
