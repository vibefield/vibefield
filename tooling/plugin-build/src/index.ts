// @vibefield/plugin-build — the authoring kit's build stage (plugin-
// architecture spec §5.4 item 1): manifest emit, canonical JSON, and the
// PA-29 host-singleton externals list. `"build": "plugin-build"` is meant
// to be the whole build script a plugin's package.json needs.
export * from "./canonical";
export * from "./emit";
export * from "./externals";
export * from "./fixture-registry";
export * from "./pack";
export * from "./registry-sign";
