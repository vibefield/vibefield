import { CommentCard } from "./comment";
import { FolderCard } from "./folder";

export { COMMENT_PALETTE, spawnCommentAroundSelection } from "./commands";
export { CommentCard } from "./comment";
export { FOLDER_BG, FolderCard } from "./folder";
export { fieldToolsManifest } from "./manifest";

/** defineWidget registers into ICE's module-level catalog as an import side-effect. */
export const fieldToolsWidgets = {
  "field.comment": CommentCard,
  "field.folder": FolderCard,
};
