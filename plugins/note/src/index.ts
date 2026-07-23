// @vibefield/plugin-note — the first plugin: one widget, no services, no scopes.
// P3a: the package exports its MANIFEST (host-read, authoring-emitted) and its
// renderer MODULE (§10.1 activate shape); implementations bind at activation,
// the host builds every prefab from the manifest (§12.2).
export { noteManifest } from "./manifest";
export { default as noteRenderer } from "./renderer";
