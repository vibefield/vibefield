// THE HARNESS'S FIXTURE KIND (DK-7): a disc, written the way a plugin kind is — through the SDK's
// `/desk` door alone (its WGSL after the kit's `view`, `portal` and `light` pieces, its pass on the
// engine's `compile` / `renderPipeline` / `bindLayout` / `bindGroup`, its records in a record store) —
// and BREAKABLE: each switch of `DiscBreak` breaks it one way a plugin's kind breaks, so the harness's
// every verdict has a fixture that earns it (test/kind-harness.test.ts). Unbroken it is the
// create-plugin template's disc, and the harness passes it.

import type { ObjectContribution } from "@vibefield/contracts";
import {
  bindGroup,
  bindLayout,
  CONTAINABLE,
  type ComposedShader,
  compile,
  compose,
  createRecordStore,
  DESK_OBJECT,
  defineStruct,
  type KindExtra,
  type KindPass,
  kitWgsl,
  type MatPass,
  type ObjectContext,
  type ObjectHit,
  type ObjectKind,
  PAPER_FINISH,
  type RecordStore,
  type RGB,
  renderPipeline,
  rgb,
  type SlotContext,
  stringProp,
} from "../../src/desk";

export const DISC_TYPE = "vendor.fixture.disc";

const Disc = defineStruct("Disc", [
  ["centre", "vec2f"],
  ["radius", "f32"],
  ["alpha", "f32"],
  ["colour", "vec4f"],
] as const);

/** The template's own shader (tooling/create-plugin/template/src/shaders.wgsl), its tokens filled. */
export const DISC_WGSL = `
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
  let c = vec4f(D.colour.rgb * cover, cover);
  if (c.a < 0.002) { discard; }
  return c * (D.alpha * u.view.w * portal_cover(in.clip.xy / dpr, u.portals, u.clips, dpr));
}
`;

/** The ways the disc breaks — one per verdict the harness can say of a kind. */
export interface DiscBreak {
  /** its registry name (default: `DISC_TYPE`) */
  readonly name?: string;
  /** the kit pieces it names (default: view, portal, light) */
  readonly pieces?: readonly string[];
  /** its shader module's code, replaced: something that is not WGSL text */
  readonly code?: unknown;
  /** the fragment entry point its pipeline names (default `fs`) */
  readonly fragment?: string;
  /** its layout leaves out the draw list's binding (2), which the vertex stage reads */
  readonly layoutDropsOrder?: boolean;
  /** its bind group hands the view's UNIFORM buffer to the storage binding 1 */
  readonly groupMisfilled?: boolean;
  /** its drawRange draws without setting its bind group */
  readonly drawsUngrouped?: boolean;
  /** its create: rejects, resolves no pass, never settles, or reaches for a browser global Node lacks */
  readonly create?: "throws" | "no-pass" | "never" | "browser";
  /** its record throws */
  readonly recordThrows?: boolean;
  /** its hit misses everywhere (a pick that never finds what was drawn) */
  readonly hitNever?: boolean;
  /** its prepare throws */
  readonly prepareThrows?: boolean;
  /** its pass's dispose throws */
  readonly disposeThrows?: boolean;
  /** it has a chip (a mini mat's far impostor) — `bad`: a colour that is no RGB triple */
  readonly chip?: "good" | "bad";
  /** it opens (picked up into the hand) */
  readonly opens?: boolean;
  /** it opens with these held tools (`open.tools`, ICE's HeldToolDef) — DK-10 */
  readonly tools?: readonly unknown[];
}

export interface DiscGeometry {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly alpha: number;
}

export interface DiscRecord {
  readonly geometry: DiscGeometry;
  readonly colour: RGB;
}

const BLEND_PREMUL = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
} as const;

interface Shared {
  readonly layout: unknown;
  readonly pipeline: unknown;
}

type Device = Parameters<ObjectKind["create"]>[0];
type Format = Parameters<ObjectKind["create"]>[1];

class DiscPass implements KindPass<DiscRecord> {
  readonly name = "vendor.fixture/discs";
  private readonly store: RecordStore<DiscRecord>;
  private group: unknown;
  private count = 0;
  private readonly device: Device;
  private readonly shared: Shared;
  private readonly mat: MatPass;
  private readonly how: DiscBreak;

  private constructor(device: Device, shared: Shared, mat: MatPass, how: DiscBreak) {
    this.device = device;
    this.shared = shared;
    this.mat = mat;
    this.how = how;
    this.store = createRecordStore<DiscRecord, keyof typeof Disc.slots>({
      device,
      def: Disc,
      capacity: 16,
      max: 4096,
      label: "vendor.fixture/discs",
      pack: (d, _aux, into, slot) => {
        const G = d.geometry;
        into.set(
          {
            centre: [G.cx, G.cy],
            radius: G.r,
            alpha: G.alpha,
            colour: [d.colour[0], d.colour[1], d.colour[2], 1],
          },
          slot,
        );
        return 0;
      },
    });
    this.rebind();
  }

  static async create(
    device: Device,
    format: Format,
    mat: MatPass,
    how: DiscBreak,
  ): Promise<DiscPass> {
    const layout = bindLayout(
      device,
      [
        { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
        { binding: 1, stages: ["vertex", "fragment"], buffer: "read-only-storage" },
        ...(how.layoutDropsOrder === true
          ? []
          : [{ binding: 2, stages: ["vertex"], buffer: "read-only-storage" } as const]),
      ],
      "vendor.fixture/discs",
    );
    const src = kitWgsl((how.pieces ?? ["view", "portal", "light"]) as never, {
      structs: [Disc],
      entry: { label: "vendor.fixture/disc.wgsl", text: DISC_WGSL },
    });
    const composed: ComposedShader =
      how.code === undefined ? compose(src) : { ...compose(src), code: how.code as string };
    const module = await compile(device, composed);
    const pipeline = await renderPipeline(device, {
      label: "vendor.fixture/discs",
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      module,
      format,
      blend: BLEND_PREMUL as never,
      ...(how.fragment !== undefined ? { fragment: how.fragment } : {}),
    });
    return new DiscPass(device, { layout, pipeline }, mat, how);
  }

  spawn(mat: MatPass): DiscPass {
    return new DiscPass(this.device, this.shared, mat, this.how);
  }

  private rebind(): void {
    const view = this.mat.view;
    this.group = bindGroup(
      this.device,
      this.shared.layout as never,
      this.how.groupMisfilled === true
        ? [view, view, this.store.order]
        : [view, this.store.records, this.store.order],
      "vendor.fixture/discs",
    );
  }

  prepare(
    _encoder: unknown,
    _slot: SlotContext,
    records: readonly DiscRecord[],
    extra?: KindExtra,
  ): number {
    if (this.how.prepareThrows === true) throw new Error("the disc's prepare throws on purpose");
    this.count = this.store.prepare(records, extra?.keys);
    this.rebind();
    return this.count;
  }

  drawRange(
    pass: {
      setPipeline(p: unknown): void;
      setBindGroup(i: number, g: unknown): void;
      draw(...n: number[]): void;
    },
    first: number,
    end: number,
  ): void {
    const hi = Math.min(end, this.count);
    if (first >= hi) return;
    pass.setPipeline(this.shared.pipeline);
    if (this.how.drawsUngrouped !== true) pass.setBindGroup(0, this.group);
    pass.draw(6, hi - first, 0, first);
  }

  dispose(): void {
    this.store.dispose();
    if (this.how.disposeThrows === true) throw new Error("the disc's dispose throws on purpose");
  }
}

/** The disc's kind, broken as `how` says (unbroken by default). */
export function discKind(how: DiscBreak = {}): ObjectKind<DiscGeometry, DiscRecord> {
  return {
    name: how.name ?? DISC_TYPE,
    stratum: "things",
    reach: 16,
    create: async (device, format, mat) => {
      if (how.create === "throws") throw new Error("the disc's create throws on purpose");
      if (how.create === "no-pass") return {} as never;
      if (how.create === "never") return new Promise<never>(() => {});
      // a browser global, named as a bundle names it — in Node an unbound identifier (ReferenceError)
      if (how.create === "browser") return new OffscreenCanvas(1, 1) as never;
      return DiscPass.create(device, format, mat, how) as never;
    },
    resolve: (ctx: ObjectContext): DiscGeometry => ({
      cx: ctx.rect.cx,
      cy: ctx.rect.cy,
      r: (Math.min(ctx.rect.w, ctx.rect.h) / 2) * (1 + 0.04 * ctx.flux.lift),
      alpha: ctx.flux.fade,
    }),
    record: (G, ctx) => {
      if (how.recordThrows === true) throw new Error("the disc's record throws on purpose");
      return { geometry: G, colour: rgb(stringProp(ctx.props, "color", "#e4c46a")) };
    },
    hit: (G, wx, wy): ObjectHit | null =>
      how.hitNever === true ? null : Math.hypot(wx - G.cx, wy - G.cy) <= G.r ? "content" : null,
    ...(how.chip === undefined
      ? {}
      : {
          chip: (G: DiscGeometry) => ({
            finish: PAPER_FINISH,
            cx: G.cx,
            cy: G.cy,
            hx: G.r,
            hy: G.r,
            angle: 0,
            radius: G.r,
            height: 0,
            colour: (how.chip === "bad" ? [Number.NaN, 0, 0] : [0.9, 0.8, 0.4]) as RGB,
          }),
        }),
    ...(how.opens === true || how.tools !== undefined
      ? {
          open: {
            ...(how.tools !== undefined ? { tools: how.tools } : {}),
            extent: ({
              rect,
            }: {
              readonly rect: {
                readonly cx: number;
                readonly cy: number;
                readonly w: number;
                readonly h: number;
              };
            }) => ({
              cx: rect.cx,
              cy: rect.cy,
              w: rect.w * 2,
              h: rect.h * 2,
            }),
          },
        }
      : {}),
  } as ObjectKind<DiscGeometry, DiscRecord>;
}

/** The disc's manifest row — the durable half — with `over` laid on top. */
export function discRow(over: Partial<ObjectContribution> = {}): ObjectContribution {
  return {
    type: DISC_TYPE,
    title: "Disc",
    schemaVersion: 1,
    size: { w: 120, h: 120 },
    interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
    provides: [DISC_TYPE, DESK_OBJECT],
    props: { color: { kind: "string", default: "#e4c46a", maxLength: 32 } },
    groups: {},
    tray: {
      category: "things",
      label: "Disc",
      hang: { w: 96, h: 96, accessory: "hook", pegs: [[0, -0.5]] },
    },
    binding: { kind: "Disc" },
    ...over,
  } as ObjectContribution;
}

/** …the same row, containable (a mini mat holds it: the harness drives it `contained`). */
export const containable = (): Partial<ObjectContribution> => ({
  provides: [DISC_TYPE, DESK_OBJECT, CONTAINABLE],
});
