// The pane's OWN WGSL and its program: `.wgsl` FILES, which plugin-build inlines into the renderer bundle as their text,
// byte for byte (`@vibefield/plugin-build`'s `wgsl()`). It asks the kit for the rest BY NAME (PT-1 ruling 6): the slot's
// view block (`view`), the portal chain's cover (`portal`), the card primitives (`sdf` — the outline and the page) and
// the mat's light (`light` — the lamp's gobo, the night, the value noise, the colour chain, and the mat's own maths the
// glass shows through itself: `mat_albedo` · `sample_gobo` · `mat_colour`; there is no `"mat"` piece, `light` IS the
// mat's module). The kit's text comes from the host's `ShaderText` (the desk's generated module in a browser).
//
// The reference below types the `.wgsl` imports wherever this module is compiled — in this package and in any program
// that reaches it (the host's suite imports the plugin to witness its compile).
/// <reference path="./wgsl.d.ts" />

import { type ComposeOptions, kitWgsl, type ShaderText } from "@vibefield/plugin-sdk/desk";
import BROWSER_WGSL from "./browser.wgsl";
import BROWSER_PASS_WGSL from "./browser-pass.wgsl";
import { Pane, PaneUniforms } from "./layout";

// `BROWSER_WGSL` — the pane as a material (`browser.wgsl`), a PURE module; `BROWSER_PASS_WGSL` — the pass's ENTRY
// (`browser-pass.wgsl`): its bindings, the vertex quad over each pane, the two fragments through the portal chain.
export { BROWSER_PASS_WGSL, BROWSER_WGSL };

/** The pane pass's program: the kit's view · portal · sdf · light by name, then the pane's records, module and entry. */
export function paneShaders(text?: ShaderText): ComposeOptions {
  return kitWgsl(
    ["view", "portal", "sdf", "light"],
    {
      structs: [PaneUniforms, Pane],
      modules: [{ label: "browser-pane/browser.wgsl", text: BROWSER_WGSL }],
      entry: { label: "browser-pane/browser-pass.wgsl", text: BROWSER_PASS_WGSL },
    },
    text,
  );
}
