// {{packageName}} — the package surface: the MANIFEST (host-read,
// authoring-emitted) and the renderer MODULE (§10.1 activate shape).
// Implementations bind at activation; the host builds every prefab from the
// manifest (§12.2), never from anything exported here.
export { manifest } from "./manifest";
export { default as renderer } from "./renderer";
