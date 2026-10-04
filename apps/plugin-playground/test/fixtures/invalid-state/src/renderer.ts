// CONTROL FIXTURE — the KIND is correct; its state fixtures are not.
//
// One whole kind through the SDK's `/desk` door (the shape of broken-kinds' `Whole`): it draws any
// props it is handed, so every red row this plugin produces is the fixture's fault. That is the
// distinction the harness has to make: `state-invalid` (your fixture contradicts your declaration)
// diagnoses, `state-spawn-failed` (your kind threw) only describes. DK-8: this fixture was a WIDGET
// (a React card registered through `ctx.widgets`) until `contributes.widgets` retired; its fixtures
// are judged by the kind harness now, before anything draws them.

import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import {
  bindGroup,
  bindLayout,
  compile,
  compose,
  createRecordStore,
  defineStruct,
  type KindPass,
  kitWgsl,
  type MatPass,
  type ObjectBinding,
  type ObjectKind,
  renderPipeline,
} from "@vibefield/plugin-sdk/desk";

const TYPE = "vibefield.fixture-invalid.card";

const Disc = defineStruct("Disc", [
  ["centre", "vec2f"],
  ["radius", "f32"],
  ["alpha", "f32"],
] as const);

const WGSL = `
@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<storage, read> discs: array<Disc>;
@group(0) @binding(2) var<storage, read> order: array<u32>;

struct VSOut { @builtin(position) clip: vec4f, @location(0) @interpolate(flat) idx: u32 }

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  let D = discs[order[iid]];
  let zoom = mat_zoom(u);
  let p = (D.centre - u.cam.xy) * zoom;
  out.clip = vec4f(p.x / u.view.x * 2.0 - 1.0, 1.0 - p.y / u.view.y * 2.0, 0.0, 1.0);
  out.idx = order[iid];
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let D = discs[in.idx];
  return vec4f(1.0, 1.0, 1.0, 1.0) * D.alpha * portal_cover(in.clip.xy, u.portals, u.clips, mat_dpr(u));
}
`;

interface Geometry {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly alpha: number;
}

type Device = Parameters<ObjectKind["create"]>[0];

async function discPass(
  device: Device,
  format: Parameters<ObjectKind["create"]>[1],
  mat: MatPass,
): Promise<KindPass<Geometry>> {
  const layout = bindLayout(device, [
    { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
    { binding: 1, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
    { binding: 2, stages: ["vertex"], buffer: "read-only-storage" },
  ]);
  const module = await compile(
    device,
    compose(
      kitWgsl(["view", "portal", "light"], {
        structs: [Disc],
        entry: { label: `${TYPE}/disc.wgsl`, text: WGSL },
      }),
    ),
  );
  const pipeline = await renderPipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module,
    format,
  });
  const made = (m: MatPass): KindPass<Geometry> => {
    const store = createRecordStore<Geometry, keyof typeof Disc.slots>({
      device,
      def: Disc,
      capacity: 4,
      max: 64,
      label: `${TYPE}/discs`,
      pack: (G, _aux, into, slot) => {
        into.set({ centre: [G.cx, G.cy], radius: G.r, alpha: G.alpha }, slot);
        return 0;
      },
    });
    let count = 0;
    return {
      spawn: (next: MatPass) => made(next),
      prepare(_encoder, _slot, records, extra) {
        count = store.prepare(records, extra?.keys);
        return count;
      },
      drawRange(pass, first, end) {
        if (first >= Math.min(end, count)) return;
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup(device, layout, [m.view, store.records, store.order]));
        pass.draw(3, Math.min(end, count) - first, 0, first);
      },
      dispose: () => store.dispose(),
    } as KindPass<Geometry>;
  };
  return made(mat);
}

/** The strict card: a disc whatever its props say — the fixtures are what is wrong. */
export const Card: ObjectBinding<Geometry, Geometry> = {
  kind: {
    name: TYPE,
    stratum: "things",
    reach: 0,
    create: (device, format, mat) => discPass(device, format, mat),
    resolve: (ctx) => ({
      cx: ctx.rect.cx,
      cy: ctx.rect.cy,
      r: Math.min(ctx.rect.w, ctx.rect.h) / 2,
      alpha: ctx.flux.fade,
    }),
    record: (G) => G,
    hit: (G, x, y) => (Math.hypot(x - G.cx, y - G.cy) <= G.r ? "content" : null),
  },
};

export default defineRendererPlugin({ activate() {} });
