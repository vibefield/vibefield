import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { COMMENT_TYPE, CommentView } from "./comment";
import { FOLDER_TYPE, FolderView } from "./folder";

// C1b/P3a — the renderer MODULE (spec §10.1): activation binds implementations
// for the manifest's declared types; the host builds the durable prefab
// (§12.2). Top-level code stays pure — everything starts in activate.
// Registration follows the manifest's declared order (folder → comment).

export default defineRendererPlugin({
  activate(ctx) {
    ctx.logger.info("Renderer plugin activated");
    ctx.widgets.register({ type: FOLDER_TYPE, binding: { component: FolderView } });
    ctx.widgets.register({ type: COMMENT_TYPE, binding: { component: CommentView } });
  },
});
