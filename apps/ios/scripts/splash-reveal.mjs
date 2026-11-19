// Apply the shipping desktop exit to the iPhone look before Metal translation.
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BAKED as desktop } from "../../../packages/field-app/src/boot/splash/vibefield-splash.js";

function replaceOnce(source, before, after) {
  assert.ok(before && source.split(before).length === 2, "expected one occurrence of " + before.slice(0, 80));
  return source.replace(before, () => after);
}

function wgslFunction(source, name) {
  const match = source.match(new RegExp("^fn " + name + "\\([\\s\\S]*?^}", "m"));
  assert.ok(match, "missing splash function " + name);
  return match[0];
}

const helpers = ["revealAt", "revealed"].map((name) => wgslFunction(desktop.field.wgsl, name)).join("\n");
const entries = new Map(["dustSpawn", "splashField", "splashMarkFragment"].map((name) => [name, wgslFunction(desktop.field.wgsl, name)]));
export const desktopRevealSource = [helpers, ...entries.values()].join("\n");

export async function applyShaderReveal(metal, upstream, bake) {
  const { wgslToMsl } = await import(pathToFileURL(join(upstream, "splash/msl.mjs")));
  for (const appearance of ["dark", "light"]) {
    const { BAKED } = await import(pathToFileURL(join(bake, "web-" + appearance, "vibefield-splash.js")));
    const field = BAKED.field.wgsl;
    const dyn = field.match(/^struct Dyn \{[\s\S]*?^}/m)?.[0];
    assert.ok(dyn, "missing iPhone field uniforms");
    let updated = replaceOnce(field, dyn, dyn.slice(0, -1) + "  reveal: vec4f,\n  revealInk: vec4f,\n}");
    for (const [name, entry] of entries) {
      updated = replaceOnce(updated, wgslFunction(field, name), entry);
    }
    const firstEntry = "@compute @workgroup_size";
    const insertAt = updated.indexOf(firstEntry);
    assert.ok(insertAt >= 0, "missing iPhone compute entry point");
    updated = updated.slice(0, insertAt) + helpers + "\n" + updated.slice(insertAt);
    const ns = "splash_" + appearance + "_field";
    const options = { ns, prefix: ns + "_" };
    const original = wgslToMsl(field, options);
    const installed = wgslToMsl(updated, options);
    assert.deepEqual(installed.entries, original.entries, "the iPhone runtime's resource bindings changed");
    metal = replaceOnce(metal, original.msl, installed.msl);
  }
  return replaceOnce(metal, "Regenerate, never edit: node splash/bake-metal.mjs --look=…",
    "Includes the desktop reveal. Regenerate with apps/ios/scripts/vendor-splash.mjs.");
}

// The baked runtime remains independently compilable for splash-stills.mjs. Its existing
// encode call keeps the field opaque, including on the privacy curtain.
export function bindShaderReveal(swift) {
  swift = replaceOnce(swift, "max(1, look.field.dyn.count)", "look.field.dyn.count + 2");
  swift = replaceOnce(swift, "public func encode(seconds: Double, pose: SplashPose, into target: MTLTexture, commandBuffer cb: MTLCommandBuffer) {",
    `/// The reveal packs front, noise time, mark opacity and rim strength. The ink packs RGB and tear strength.
  public func encode(
    seconds: Double, pose: SplashPose, reveal: SIMD4<Float> = SIMD4(0, 0, 1, 0),
    revealInk: SIMD4<Float> = .zero, into target: MTLTexture, commandBuffer cb: MTLCommandBuffer
  ) {`);
  const fill = "SplashClock.fill(look.field.dyn, values, into: &fieldData)";
  return replaceOnce(swift, fill, fill + "\n    fieldData[look.field.dyn.count] = reveal\n    fieldData[look.field.dyn.count + 1] = revealInk");
}
