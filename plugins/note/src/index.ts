// @vibefield/plugin-note — the first plugin: one widget, no services, no scopes.
// Its structure (manifest + widgets record) is the shape every plugin follows.
import { NoteCard } from "./widget";

export { noteManifest } from "./manifest";
export const noteWidgets = { "note.card": NoteCard };
