// @vibefield/plugin-note — the first plugin: one widget, no services, no scopes.
// C1a: the manifest is CANONICAL V1 (the full durable contract); this package
// exports COMPONENTS — the host builds every prefab from the manifest (§12.2).
import { NOTE_TYPE, NoteView } from "./widget";

export { noteManifest } from "./manifest";
/** widget type → the opaque code-side binding the host's builder consumes. */
export const noteBindings = { [NOTE_TYPE]: { component: NoteView } };
