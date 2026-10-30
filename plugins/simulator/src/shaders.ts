// The phone's OWN WGSL and its program: `.wgsl` FILES, which plugin-build inlines into the renderer bundle as their text, byte
// for byte (`@vibefield/plugin-build`'s `wgsl()`). It asks the kit for the rest BY NAME (the pane's PT-1 ruling 6): the
// slot's view block (`view`), the portal chain's cover (`portal`), the card primitives (`sdf` — `sdf_round_box`,
// `op_isect_round`) and the mat's light (`light` — the lamp's gobo, the night, the noise, the colour chain). The kit's text
// comes from the host's `ShaderText` (the desk's generated module in a browser).
//
// The reference below types the `.wgsl` imports wherever this module is compiled — in this package and in any program that
// reaches it.
/// <reference path="./wgsl.d.ts" />

import { type ComposeOptions, kitWgsl, type ShaderText } from "@vibefield/plugin-sdk/desk";
import { Phone, PhoneUniforms } from "./layout";
import PHONE_WGSL from "./phone.wgsl";
import PHONE_PASS_WGSL from "./phone-pass.wgsl";

// `PHONE_WGSL` — the phone as a material (`phone.wgsl`), a PURE module; `PHONE_PASS_WGSL` — the pass's ENTRY
// (`phone-pass.wgsl`): its bindings, the vertex quad over each phone, the phone's fragment and the night's spill.
export { PHONE_PASS_WGSL, PHONE_WGSL };

/** The phone pass's program: the kit's view · portal · sdf · light by name, then the phone's records, module and entry. */
export function phoneShaders(text?: ShaderText): ComposeOptions {
  return kitWgsl(
    ["view", "portal", "sdf", "light"],
    {
      structs: [PhoneUniforms, Phone],
      modules: [{ label: "simulator/phone.wgsl", text: PHONE_WGSL }],
      entry: { label: "simulator/phone-pass.wgsl", text: PHONE_PASS_WGSL },
    },
    text,
  );
}
