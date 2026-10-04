// The desk clock's OWN WGSL (ICE design-016 K8b) and its program — ICE's example ships its text as
// TypeScript template strings; a VibeField plugin ships it as `.wgsl` FILES, which plugin-build inlines
// into the renderer bundle as their text, byte for byte (`@vibefield/plugin-build`'s `wgsl()`: the shape
// ICE's own `shaders.gen.ts` carries the desk's WGSL in). It asks the kit for the rest BY NAME: the slot's
// view block (`view`), the portal chain's cover (`portal`), the card primitives (`sdf`) and the mat's
// light — the lamp's gobo, the night, the value noise, the colour chain (`light`). The kit's text comes
// from the host's `ShaderText` (the desk's generated module in a browser), byte for byte.
//
// The reference below types the `.wgsl` imports wherever this module is compiled — in this package and
// in any program that reaches it (the host's suite imports the plugin to witness its compile).
/// <reference path="./wgsl.d.ts" />

import { type ComposeOptions, kitWgsl, type ShaderText } from "@vibefield/plugin-sdk/desk";
import CLOCK_WGSL from "./clock.wgsl";
import CLOCK_PASS_WGSL from "./clock-pass.wgsl";
import { Clock } from "./layout";

// The two texts, as ICE's example names them: `CLOCK_WGSL` — THE DESK CLOCK as a material (`clock.wgsl`),
// a PURE module: the record `Clock`, the view block `MatUniforms` and the textures arrive as parameters;
// it names no colour (the dial's, the case's, the hands' are the record's, from the look); angles run
// CLOCKWISE from twelve, the screen's y runs down. `CLOCK_PASS_WGSL` — the pass's ENTRY
// (`clock-pass.wgsl`): its bindings, the vertex quad over each clock and its shadow, the fragment
// through the portal chain.
export { CLOCK_PASS_WGSL, CLOCK_WGSL };

/** The clock pass's program: the kit's view · portal · sdf · light by name, then the clock's record, module and entry. */
export function clockShaders(text?: ShaderText): ComposeOptions {
  return kitWgsl(
    ["view", "portal", "sdf", "light"],
    {
      structs: [Clock],
      modules: [{ label: "desk-clock/clock.wgsl", text: CLOCK_WGSL }],
      entry: { label: "desk-clock/clock-pass.wgsl", text: CLOCK_PASS_WGSL },
    },
    text,
  );
}
