// @vibefield/plugin-build — the authoring kit's build stage (plugin-
// architecture spec §5.4 item 1): manifest emit, canonical JSON, and the
// PA-29 host-singleton externals list. `"build": "plugin-build"` is meant
// to be the whole build script a plugin's package.json needs.
// NOT `export * from "./build"`. fieldd imports this package for `canonicalJson`
// (§9.2 hashes manifests with the authoring kit's own canonicalizer), and its
// daemon bundle is built with esbuild — so a barrel that reaches build.ts drags
// vite, Tailwind, and Tailwind's native oxide `.node` binary into a daemon
// artifact, which fails the build outright. The build stages are authoring-time
// tooling: reachable at `@vibefield/plugin-build/build`, never through the door
// the runtime uses.
export * from "./canonical";
export * from "./emit";
export * from "./externals";
export * from "./fixture-registry";
export * from "./pack";
export * from "./registry-sign";
