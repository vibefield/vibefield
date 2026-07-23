// @vibefield/plugin-field-tools — organizational actors (folder + comment).
// P3a: the package exports its MANIFEST (host-read, authoring-emitted) and its
// renderer MODULE (§10.1 activate shape); implementations bind at activation,
// the host builds every prefab from the manifest (§12.2).
export { COMMENT_PALETTE, spawnCommentAroundSelection } from "./commands";
export { FOLDER_BG } from "./folder";
export { fieldToolsManifest } from "./manifest";
export { default as fieldToolsRenderer } from "./renderer";
