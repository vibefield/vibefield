import { defineRendererPlugin } from "@vibefield/plugin-sdk";

// The renderer MODULE (spec §10.1). The clock's code half is the NAMED export its manifest row's
// `binding.kind` names — `clock` — which the host reads off this module's namespace and compiles
// through `defineObject` before the desk's first frame; nothing about the kind is registered here.
// `activate` stays the module's entry, as for every plugin, and the clock needs nothing of it.

export { clock } from "./object";

export default defineRendererPlugin({
  activate() {
    // nothing to bind: the kind is a static export, and the clock asks for no command, surface or behavior
  },
});
