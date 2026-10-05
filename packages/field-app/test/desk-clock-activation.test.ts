// @vitest-environment node
/**
 * DK-9 — `onObject:<type>`, TESTED WITH THE CLOCK (the plan's "DK-6 inputs" (h); renamed from `onWidget:` at DK-9):
 * an object's activation event keeps its meaning — the plugin is activated no later than its type's first
 * instance appearing in the document — and it is INDEPENDENT of the kind's pass, which the desk makes for every
 * registered kind at its mount, an instance on the board or not. This build activates every enabled renderer at
 * its boot, so the event has fired before any board opens; the first clock laid asks for nothing more.
 */
import { createSlotSet, objectKindOf } from "@vibecook/ice/desk";
import { validatePluginManifest } from "@vibefield/contracts";
import * as deskClock from "@vibefield/plugin-example-desk-clock";
import type { RendererPluginModule } from "@vibefield/plugin-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deskCensus } from "../src/field/desk/desk-door";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { objectBindingsFrom } from "../src/plugin-host/build-widget";

const { CLOCK_TYPE, ClockPass, deskClockManifest, deskClockRenderer } = deskClock;

/** A device every create answers — what the desk's `createSlotSet` makes its root's passes on. */
function device() {
  const labelled = (d?: { label?: string }) => ({ label: d?.label ?? "" });
  return {
    createBindGroupLayout: labelled,
    createBindGroup: labelled,
    createPipelineLayout: labelled,
    createSampler: labelled,
    createShaderModule: (d: { label?: string }) => ({
      ...labelled(d),
      getCompilationInfo: async () => ({ messages: [] }),
    }),
    createRenderPipelineAsync: async (d: { label?: string }) => labelled(d),
    createRenderPipeline: (d: { label?: string }) => labelled(d),
    createBuffer: (d: { label?: string; size: number }) => ({
      ...labelled(d),
      size: d.size,
      destroy: () => {},
    }),
    queue: { writeBuffer: () => {} },
    pushErrorScope: () => {},
    popErrorScope: async () => null,
  } as unknown as Parameters<typeof createSlotSet>[0];
}

const MAT = {
  view: {},
  silhouette: {},
  noiseTexture: { createView: () => ({}) },
  assetVersion: 0,
} as never;
const FLAGS = {
  GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
  GPUBufferUsage: { COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128 },
};
const installed: string[] = [];
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  for (const [k, v] of Object.entries(FLAGS))
    if (!(k in g)) {
      g[k] = v;
      installed.push(k);
    }
});
afterAll(() => {
  for (const k of installed) Reflect.deleteProperty(globalThis, k);
});

describe("onObject:<type>, with the clock (DK-6 input (h))", () => {
  it("the clock declares its object's activation event under the new name, and the manifest holds it owned", () => {
    expect(deskClockManifest.activation).toEqual([`onObject:${CLOCK_TYPE}`]);
    expect(validatePluginManifest(deskClockManifest).ok).toBe(true);
  });

  it("is activated before any board opens; the desk makes its PASS at the mount with no clock on the board; the first clock laid asks for nothing more", async () => {
    let activations = 0;
    const counted: RendererPluginModule = {
      ...deskClockRenderer,
      activate(ctx) {
        activations += 1;
        return deskClockRenderer.activate(ctx);
      },
    };
    const registry = buildRegistry({
      generation: -1,
      staged: [],
      bundled: [
        {
          manifest: deskClockManifest,
          mod: counted,
          objectBindings: objectBindingsFrom(
            deskClock,
            deskClockManifest.contributes?.objects ?? [],
          ),
        },
      ],
    });
    expect(activations).toBe(1); // the boot activated it: no document exists yet

    const ce = createFieldEngine(registry);
    ce.docs.create(); // a board with no clock on it
    ce.world.sync();
    expect(deskCensus(ce)[CLOCK_TYPE]).toBeUndefined();
    // the desk's mount makes a pass for EVERY registered kind — the clock's among them, no instance asked
    const programs = ce.catalog
      .widgetTypes()
      .map((widget) => objectKindOf(widget))
      .filter((kind) => kind !== undefined);
    const slot = await createSlotSet(device(), "bgra8unorm", MAT, programs as never);
    expect(slot.kinds.get(CLOCK_TYPE)?.pass).toBeInstanceOf(ClockPass);

    ce.ops.spawnWidget(CLOCK_TYPE, { x: 0, y: 0, undoable: false }); // the type's FIRST instance
    ce.world.sync();
    expect(deskCensus(ce)[CLOCK_TYPE]).toBe(1);
    expect(activations).toBe(1); // already active: the event had fired
    ce.dispose();
  });
});
