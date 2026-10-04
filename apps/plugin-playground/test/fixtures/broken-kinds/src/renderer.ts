// CONTROL FIXTURE (DK-7) — object kinds broken one way each, through the SDK's `/desk` door, so the
// playground's kind harness answers each with its OWN verdict: a wrong name (`object-kind-misnamed`), a
// row whose export does not exist (`object-export-missing`), a pass naming a kit piece the kit does not
// carry (`object-kit-piece-unknown`), a pipeline naming an entry point its WGSL never declares
// (`object-wgsl-unread`), a hit that never hits its own box (`state-hit-missed`), a world half that
// throws (`state-spawn-failed`), a pass whose prepare throws (`state-render-failed`) — beside one WHOLE
// kind that passes, so a refusal is the kind's and never the fixture's.

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

const ID = "vibefield.fixture-broken-kinds";

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

interface Break {
  readonly name?: string;
  readonly piece?: string;
  readonly fragment?: string;
  readonly hitNever?: boolean;
  readonly recordThrows?: boolean;
  readonly prepareThrows?: boolean;
}

type Device = Parameters<ObjectKind["create"]>[0];

async function discPass(
  device: Device,
  format: Parameters<ObjectKind["create"]>[1],
  mat: MatPass,
  how: Break,
): Promise<KindPass<Geometry>> {
  const layout = bindLayout(device, [
    { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
    { binding: 1, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
    { binding: 2, stages: ["vertex"], buffer: "read-only-storage" },
  ]);
  const pieces = ["view", "portal", "light", ...(how.piece !== undefined ? [how.piece] : [])];
  const module = await compile(
    device,
    compose(
      kitWgsl(pieces as never, {
        structs: [Disc],
        entry: { label: `${ID}/disc.wgsl`, text: WGSL },
      }),
    ),
  );
  const pipeline = await renderPipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module,
    format,
    ...(how.fragment !== undefined ? { fragment: how.fragment } : {}),
  });
  const made = (m: MatPass): KindPass<Geometry> => {
    const store = createRecordStore<Geometry, keyof typeof Disc.slots>({
      device,
      def: Disc,
      capacity: 4,
      max: 64,
      label: `${ID}/discs`,
      pack: (G, _aux, into, slot) => {
        into.set({ centre: [G.cx, G.cy], radius: G.r, alpha: G.alpha }, slot);
        return 0;
      },
    });
    let count = 0;
    return {
      spawn: (next: MatPass) => made(next),
      prepare(_encoder, _slot, records, extra) {
        if (how.prepareThrows === true) throw new Error("its prepare throws on purpose");
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

function disc(type: string, how: Break = {}): ObjectBinding<Geometry, Geometry> {
  return {
    kind: {
      name: how.name ?? `${ID}.${type}`,
      stratum: "things",
      reach: 0,
      create: (device, format, mat) => discPass(device, format, mat, how),
      resolve: (ctx) => ({
        cx: ctx.rect.cx,
        cy: ctx.rect.cy,
        r: Math.min(ctx.rect.w, ctx.rect.h) / 2,
        alpha: ctx.flux.fade,
      }),
      record: (G) => {
        if (how.recordThrows === true) throw new Error("its record throws on purpose");
        return G;
      },
      hit: (G, x, y) =>
        how.hitNever !== true && Math.hypot(x - G.cx, y - G.cy) <= G.r ? "content" : null,
    },
  };
}

export const Whole = disc("whole");
export const Misnamed = disc("misnamed", { name: `${ID}.circle` });
export const UnknownPiece = disc("unknown-piece", { piece: "lens" });
export const Unread = disc("unread", { fragment: "fs_main" });
export const MissingHit = disc("missing-hit", { hitNever: true });
export const Throws = disc("throws", { recordThrows: true });
export const Render = disc("render", { prepareThrows: true });

export default defineRendererPlugin({ activate() {} });
