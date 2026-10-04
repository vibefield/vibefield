// @vitest-environment node
// THE FAULT FIXTURE ON THE HOST (DK-7; ICE petition I24 — the clock's `broken.ts`, ported beside the example
// plugin's clock): what the PRODUCT does with a plugin kind that breaks. The host reads the fixture's exports
// by its rows' names and compiles them as it compiles any plugin's kind (`objectBindingsFrom` →
// `buildRegistry`); then ICE's own creation — `createSlotSet`, what the desk's `Ground.create` makes its
// root's passes with, each kind in its own error scope — on a device whose compiler refuses what nothing
// declares, as Tint does: the BROKEN clock is REFUSED at create (`faults` names it — what the layer's
// `status().faults` reports) and its objects get the MISSING face under its name and stratum, while the clock
// and the faulty clock beside it stand. (Its states — the faulty clock's record and hit — are the kind
// harness's: examples/plugins/desk-clock/test/broken.test.ts. The quarantine after three strikes needs
// frames: the running desk's, DK-9's.)
import { createSlotSet, objectKindOf } from "@vibecook/ice/desk";
import * as deskClock from "@vibefield/plugin-example-desk-clock";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRegistry } from "../src/field-engine";
import { objectBindingsFrom } from "../src/plugin-host/build-widget";

const {
  BROKEN_CLOCK_ROWS,
  BROKEN_CLOCK_TYPE,
  BROKEN_WGSL_TOKEN,
  CLOCK_TYPE,
  ClockPass,
  deskClockManifest,
  FAULTY_CLOCK_TYPE,
} = deskClock;

/** The clock's plugin with the fault fixture declared beside the clock — how a host registers it. */
const rows = [...(deskClockManifest.contributes?.objects ?? []), ...BROKEN_CLOCK_ROWS];
const manifest = {
  ...deskClockManifest,
  contributes: { ...deskClockManifest.contributes, objects: rows },
};

/** A device whose compiler refuses a module naming the token (into the open error scope, as WebGPU's
 * validation does) — every other call a stub (ICE's own `broken.test.ts` device). */
function compilerDevice() {
  const scopes: { error: { message: string } | null }[] = [];
  const labelled = (d?: { label?: string }) => ({ label: d?.label ?? "" });
  const device = {
    createBindGroupLayout: labelled,
    createBindGroup: labelled,
    createPipelineLayout: labelled,
    createSampler: labelled,
    createShaderModule: (d: { code: string; label?: string }) => {
      const refused = d.code.includes(BROKEN_WGSL_TOKEN);
      const top = scopes[scopes.length - 1];
      if (refused && top !== undefined)
        top.error ??= { message: `unresolved value '${BROKEN_WGSL_TOKEN}'` };
      return {
        ...labelled(d),
        getCompilationInfo: async () => ({
          messages: refused
            ? [
                {
                  type: "error",
                  lineNum: 1,
                  linePos: 1,
                  message: `unresolved value '${BROKEN_WGSL_TOKEN}'`,
                },
              ]
            : [],
        }),
      };
    },
    createRenderPipelineAsync: async (d: { label?: string }) => labelled(d),
    createRenderPipeline: (d: { label?: string }) => labelled(d),
    createBuffer: (d: { label?: string; size: number }) => ({
      ...labelled(d),
      size: d.size,
      destroy: () => {},
    }),
    queue: { writeBuffer: () => {} },
    pushErrorScope: () => {
      scopes.push({ error: null });
    },
    popErrorScope: async () => scopes.pop()?.error ?? null,
  };
  return device as unknown as Parameters<typeof createSlotSet>[0];
}

/** A mat as a pass binds it. */
const MAT = {
  view: {},
  silhouette: {},
  noiseTexture: { createView: () => ({}) },
  assetVersion: 0,
} as never;

const FLAGS = {
  GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
  GPUBufferUsage: {
    MAP_READ: 1,
    MAP_WRITE: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
    INDEX: 16,
    VERTEX: 32,
    UNIFORM: 64,
    STORAGE: 128,
    INDIRECT: 256,
    QUERY_RESOLVE: 512,
  },
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

describe("a plugin kind that breaks, on the host (the clock's fault fixture — DK-7, petition I24)", () => {
  const registry = buildRegistry({
    generation: -1,
    staged: [],
    bundled: [
      {
        manifest,
        mod: deskClock.deskClockRenderer,
        objectBindings: objectBindingsFrom(deskClock, rows),
      },
    ],
  });

  it("the host compiles each broken row as it compiles any plugin's kind: its export by name, a kind named by its type", () => {
    for (const type of [CLOCK_TYPE, BROKEN_CLOCK_TYPE, FAULTY_CLOCK_TYPE]) {
      const object = registry.allWidgets().get(type);
      expect(object, type).toBeDefined();
      expect(objectKindOf(object as never)?.name, type).toBe(type);
    }
  });

  it("ICE's creation REFUSES the broken clock (faults names it, the compiler's word its reason) and gives its objects the missing face; the clock and the faulty clock stand", async () => {
    const programs = [CLOCK_TYPE, BROKEN_CLOCK_TYPE, FAULTY_CLOCK_TYPE].map(
      (type) => objectKindOf(registry.allWidgets().get(type) as never) as never,
    );
    const slot = await createSlotSet(compilerDevice(), "bgra8unorm", MAT, programs);
    expect(slot.faults).toEqual([
      {
        kind: BROKEN_CLOCK_TYPE,
        reason: expect.stringMatching(
          new RegExp(`^refused at create — WGSL [\\s\\S]*unresolved value '${BROKEN_WGSL_TOKEN}'$`),
        ),
      },
    ]);
    expect(slot.kinds.get(CLOCK_TYPE)?.pass).toBeInstanceOf(ClockPass);
    // the faulty clock compiles: its faults are its frames' (its record, its pick) — the harness's, and the running desk's
    expect(slot.kinds.get(FAULTY_CLOCK_TYPE)?.pass).toBeInstanceOf(ClockPass);
    // the broken one's entry is the MISSING face's pass, under its name, in its stratum
    expect(slot.kinds.get(BROKEN_CLOCK_TYPE)?.pass).not.toBeInstanceOf(ClockPass);
    expect(slot.kinds.get(BROKEN_CLOCK_TYPE)?.stratum).toBe("things");
  });
});
