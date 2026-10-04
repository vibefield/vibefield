// {{packageName}} — the package surface: the MANIFEST (host-read, authoring-emitted),
// the renderer MODULE (§10.1 activate shape) and the object's code half, the export its
// manifest row names. The host builds the object from the manifest (§12.2) and the kind
// from that export — never from anything else exported here.
export { manifest } from "./manifest";
export { {{className}}, default as renderer } from "./renderer";
