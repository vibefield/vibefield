// CONTROL FIXTURE (DK-11) — object kinds that PASS the kind harness (no device: their WGSL is only read) and break one way
// each that only a STILL sees, drawn on Dawn by `plugin-playground --still`: a kind that compiles and draws nothing
// (`still-blank`), a WGSL type error the harness's reading cannot see (`still-failed`, the compiler's own line), a disc drawn
// half again past a reach of 0 (`still-past-reach`), a colour that changes at every record (`still-unsteady`) — beside one
// drawn WHOLE (the create-plugin template's disc), so a still's refusal is the kind's and never the fixture's.

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
  type RecordStore,
  renderPipeline,
} from "@vibefield/plugin-sdk/desk";

const ID = "vibefield.fixture-still-kinds";

const Disc = defineStruct("Disc", [
  ["centre", "vec2f"],
  ["radius", "f32"],
  ["alpha", "f32"],
  ["colour", "vec4f"],
] as const);

// the create-plugin template's disc (tooling/create-plugin/template/src/shaders.wgsl), its fragment's one line `FAULT`
const WGSL = `
@group(0) @binding(0) var<uniform> u: MatUniforms;
@group(0) @binding(1) var<storage, read> discs: array<Disc>;
@group(0) @binding(2) var<storage, read> order: array<u32>;

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) idx: u32,
}

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
  var out: VSOut;
  out.clip = vec4f(2.0, 2.0, 2.0, 1.0);
  let slot = order[iid];
  out.idx = slot;
  let D = discs[slot];
  let zoom = mat_zoom(u);
  let px = 1.0 / (zoom * mat_dpr(u));
  let ext = D.radius * 1.2 + 3.0 * px;
  let lo = (D.centre - vec2f(ext) - u.cam.xy) * zoom;
  let hi = (D.centre + vec2f(ext) - u.cam.xy) * zoom;
  if (hi.x < u.box.x || hi.y < u.box.y || lo.x > u.box.x + u.box.z || lo.y > u.box.y + u.box.w) { return out; }
  let pos = mix(lo, hi, CORNERS[vid] * 0.5 + 0.5);
  out.clip = vec4f(pos.x / u.view.x * 2.0 - 1.0, 1.0 - pos.y / u.view.y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let D = discs[in.idx];
  let dpr = mat_dpr(u);
  let px = 1.0 / (mat_zoom(u) * dpr);
  let p = in.clip.xy * px + u.cam.xy;
  let d = length(p - D.centre) - D.radius;
  let cover = clamp(0.5 - d / px, 0.0, 1.0);
  FAULT
  let c = vec4f(D.colour.rgb * cover, cover);
  if (c.a < 0.002) { discard; }
  return c * (D.alpha * u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
`;

interface Geometry {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly alpha: number;
}
interface DiscRecord {
  readonly geometry: Geometry;
  readonly colour: readonly [number, number, number];
}

/** One way a kind breaks for its still. */
interface Break {
  /** a line in its fragment: a type error the harness reads past */
  readonly fault?: string;
  /** its disc's radius over its rect's half side (1: the template's) */
  readonly scale?: number;
  /** how far past its rect it says it draws (16: the template's) */
  readonly reach?: number;
  /** drawn at no presence: it compiles and draws nothing */
  readonly invisible?: boolean;
  /** its colour moves at every record */
  readonly restless?: boolean;
}

const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

async function discPass(
  device: GPUDevice,
  format: GPUTextureFormat,
  mat: MatPass,
  how: Break,
  label: string,
): Promise<KindPass<DiscRecord>> {
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
        entry: { label: `${label}.wgsl`, text: WGSL.replace("FAULT", how.fault ?? "") },
      }),
    ),
  );
  const pipeline = await renderPipeline(device, {
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module,
    format,
    blend: BLEND_PREMUL,
  });
  const made = (m: MatPass): KindPass<DiscRecord> => {
    const store: RecordStore<DiscRecord> = createRecordStore<DiscRecord, keyof typeof Disc.slots>({
      device,
      def: Disc,
      capacity: 4,
      max: 64,
      label,
      pack: (d, _aux, into, slot) => {
        const G = d.geometry;
        into.set(
          { centre: [G.cx, G.cy], radius: G.r, alpha: G.alpha, colour: [...d.colour, 1] },
          slot,
        );
        return 0;
      },
    });
    let count = 0;
    let group: GPUBindGroup | undefined;
    let bound = -1;
    return {
      spawn: (next: MatPass) => made(next),
      prepare(_encoder, _slot, records, extra) {
        count = store.prepare(records, extra?.keys);
        if (group === undefined || bound !== store.version) {
          group = bindGroup(device, layout, [m.view, store.records, store.order], label);
          bound = store.version;
        }
        return count;
      },
      drawRange(pass, first, end) {
        const hi = Math.min(end, count);
        if (first >= hi || group === undefined) return;
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(6, hi - first, 0, first);
      },
      dispose: () => store.dispose(),
    } as KindPass<DiscRecord>;
  };
  return made(mat);
}

function disc(type: string, how: Break = {}): ObjectBinding<Geometry, DiscRecord> {
  let records = 0;
  const kind: ObjectKind<Geometry, DiscRecord> = {
    name: `${ID}.${type}`,
    stratum: "things",
    reach: how.reach ?? 16,
    create: (device, format, mat) => discPass(device, format, mat, how, `${ID}/${type}`),
    resolve: (ctx) => ({
      cx: ctx.rect.cx,
      cy: ctx.rect.cy,
      r: (Math.min(ctx.rect.w, ctx.rect.h) / 2) * (how.scale ?? 1),
      alpha: how.invisible === true ? 0 : ctx.flux.fade,
    }),
    record: (G) => {
      records += 1;
      return {
        geometry: G,
        colour: how.restless === true ? [(records % 7) / 7, 0.5, 0.5] : [0.89, 0.77, 0.42],
      };
    },
    hit: (G, x, y) => (Math.hypot(x - G.cx, y - G.cy) <= G.r ? "content" : null),
  };
  return { kind };
}

export const Drawn = disc("drawn");
export const Blank = disc("blank", { invisible: true });
export const Uncompiled = disc("uncompiled", { fault: "let wrong: f32 = 1u;" });
export const PastReach = disc("past-reach", { scale: 1.5, reach: 0 });
export const Unsteady = disc("unsteady", { restless: true });

export default defineRendererPlugin({ activate() {} });
