// The kind's PROGRAM: its own WGSL (shaders.wgsl) after the kit's pieces it names — `view` (the slot's
// view block, `MatUniforms`), `portal` (the cover through a container's face) and `light` (the mat's
// helpers — the zoom and the device ratio the view block encodes, `mat_zoom` and `mat_dpr` — and its
// light: the lamp, the gobo, the night, which lights ICE's own clock) — and the record it draws
// (record.ts). The kit's text comes from the host's `ShaderText`: the desk's own, byte for byte. More
// pieces by name when the kind wants them: `sdf` (rounded boxes, their shadows and rims).
/// <reference path="./wgsl.d.ts" />

import { type ComposeOptions, kitWgsl, type ShaderText } from "@vibefield/plugin-sdk/desk";
import { Disc } from "./record";
import SHADERS_WGSL from "./shaders.wgsl";

export function shaders(text?: ShaderText): ComposeOptions {
  return kitWgsl(
    ["view", "portal", "light"],
    { structs: [Disc], entry: { label: "{{id}}/shaders.wgsl", text: SHADERS_WGSL } },
    text,
  );
}
