import { defineRendererPlugin } from "@vibefield/plugin-sdk";

// The renderer MODULE (spec §10.1). The phone's code half is the NAMED export its manifest row's `binding.kind` names —
// `simulator` — which the host reads off this module's namespace and compiles through `defineObject` before the desk's first
// frame; nothing about the kind is registered here. `activate` stays the module's entry, as for every plugin, and the phone
// needs nothing of it.

export { simulator } from "./object";

export default defineRendererPlugin({
  activate() {
    // nothing to bind: the kind is a static export, and the phone asks for no command, surface or behavior
  },
});
