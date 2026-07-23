// @vibefield/plugin-field-tools — organizational actors (folder + comment).
// C1b: the manifest is CANONICAL V1; this package exports COMPONENTS — the
// host builds every prefab from the manifest (§12.2).
import { COMMENT_TYPE, CommentView } from "./comment";
import { FOLDER_TYPE, FolderView } from "./folder";

export { COMMENT_PALETTE, spawnCommentAroundSelection } from "./commands";
export { FOLDER_BG } from "./folder";
export { fieldToolsManifest } from "./manifest";

/** widget type → the opaque code-side binding the host's builder consumes. */
export const fieldToolsBindings = {
  [COMMENT_TYPE]: { component: CommentView },
  [FOLDER_TYPE]: { component: FolderView },
};
