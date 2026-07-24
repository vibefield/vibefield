import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import type { CanvasEngine } from "@vibefield/plugin-sdk/canvas";
import { COMMENT_COMMAND, spawnCommentAroundSelection } from "./commands";
import { COMMENT_TYPE, CommentView } from "./comment";
import { FOLDER_TYPE, FolderView } from "./folder";

// C1b/P3a — the renderer MODULE (spec §10.1): activation binds implementations
// for the manifest's declared types; the host builds the durable prefab
// (§12.2). Top-level code stays pure — everything starts in activate.
// Registration follows the manifest's declared order (folder → comment).
//
// P6 (§13) — activation also binds the comment COMMAND handler. The spine
// invokes it (C key = canvas-context, or the ⌘K palette) and this handler acts
// on the §12.7 canvas handle. The former direct field-app import is retired.

export default defineRendererPlugin({
  activate(ctx) {
    ctx.logger.info("Renderer plugin activated");
    ctx.widgets.register({ type: FOLDER_TYPE, binding: { component: FolderView } });
    ctx.widgets.register({ type: COMMENT_TYPE, binding: { component: CommentView } });
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
