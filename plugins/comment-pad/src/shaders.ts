// The comment pad's OWN WGSL and its program: `.wgsl` FILES, which plugin-build inlines into the renderer
// bundle as their text, byte for byte (`@vibefield/plugin-build`'s `wgsl()`). It asks the kit for the rest BY
// NAME: the slot's view block (`view`), the portal chain's cover (`portal`), the card primitives (`sdf` — its
// rounded sheets) and the mat's light (`light` — the lamp's gobo, the night, the value noise, the colour
// chain). The kit's text comes from the host's `ShaderText` (the desk's generated module in a browser).
//
// The reference below types the `.wgsl` imports wherever this module is compiled — in this package and in any
// program that reaches it (the host's suite imports the plugin to witness its compile).
/// <reference path="./wgsl.d.ts" />

import { type ComposeOptions, kitWgsl, type ShaderText } from "@vibefield/plugin-sdk/desk";
import { Pad } from "./layout";
import PAD_WGSL from "./pad.wgsl";
import PAD_PASS_WGSL from "./pad-pass.wgsl";

// `PAD_WGSL` — the pad as a material (`pad.wgsl`), a PURE module; `PAD_PASS_WGSL` — the pass's ENTRY
// (`pad-pass.wgsl`): its bindings, the vertex quad over each pad and its shadow, the fragment through the portal chain.
export { PAD_PASS_WGSL, PAD_WGSL };

/** The pad pass's program: the kit's view · portal · sdf · light by name, then the pad's record, module and entry. */
export function padShaders(text?: ShaderText): ComposeOptions {
  return kitWgsl(
    ["view", "portal", "sdf", "light"],
    {
      structs: [Pad],
      modules: [{ label: "comment-pad/pad.wgsl", text: PAD_WGSL }],
      entry: { label: "comment-pad/pad-pass.wgsl", text: PAD_PASS_WGSL },
    },
    text,
  );
}
