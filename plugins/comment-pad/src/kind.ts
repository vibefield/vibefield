// THE COMMENT PAD as a kind (DK-8, DK-D14 — VibeField's first own kind, written exactly as a third party writes
// one: through `@vibefield/plugin-sdk/desk` alone, ICE design-016 K-L1/K-L2): its RENDER half (`commentPadProgram`
// — its own pass and WGSL, made on the root's mat, spawned into every other slot) and its WORLD half — `resolve`
// the block where it lies (lifted in a hand, fading as a ghost) under the desk's one lamp, `record` its paper,
// rules, ink and caret from its look and its writing, `hit` its block (what is picked is what is drawn), its chip
// in a container's face (paper, its writing greeked), the frame the desk's marks go round, its look from the
// palette (the host's pens; its own paper — theme.ts), its rung (the ink's raster density), and its desk state
// (the writing — writing.ts).

import {
  type ChildShape,
  type KindProgram,
  type Lamp,
  type MarkFrame,
  type ObjectContext,
  type ObjectHit,
  type ObjectKind,
  PAPER_FINISH,
  type RGB,
  type RungContext,
  type ShaderText,
  sdRoundBox,
  stringProp,
} from "@vibefield/plugin-sdk/desk";
import { COMMENT_PAD_KIND, PAD_ACCENTS, type PadAccent } from "./ids";
import { bandFor, PAD, PAD_HAND, type PadLaw, padReach, writingBox } from "./law";
import type { PadGeometry, PadInstance } from "./layout";
import { PadPass } from "./pass";
import { padShaders } from "./shaders";
import { type CommentPadPalette, type PadLook, padLook } from "./theme";
import { createPadWriting, type PadWriting } from "./writing";

/** The pad's accent from its props (an unknown one is the first — indigo). */
export const accentOf = (props: Readonly<Record<string, unknown>>): PadAccent => {
  const a = stringProp(props, "accent", "indigo");
  return (PAD_ACCENTS as readonly string[]).includes(a) ? (a as PadAccent) : "indigo";
};

/** A pad lying where its rect says under the lamp, in a hand by `lift` (0 … 1), fading by `fade` — the pass's geometry, the pick's too. */
export function resolvePad(
  rect: { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number },
  flux: { readonly lift: number; readonly fade: number },
  lamp: Lamp,
  law: PadLaw = PAD,
): PadGeometry {
  const scale = 1 + (law.lift.scale - 1) * flux.lift;
  const dx = lamp.x - rect.cx;
  const dy = lamp.y - rect.cy;
  const h = Math.max(lamp.h, 1e-6);
  const len = Math.hypot(dx, dy, h);
  let sx = -dx / h;
  let sy = -dy / h;
  const s = Math.hypot(sx, sy);
  if (s > law.shadow.slopeMax) {
    sx *= law.shadow.slopeMax / s;
    sy *= law.shadow.slopeMax / s;
  }
  return {
    centre: [rect.cx, rect.cy],
    half: [(rect.w / 2) * scale, (rect.h / 2) * scale],
    size: { w: rect.w, h: rect.h },
    scale,
    lift: law.lift.height * flux.lift,
    radius: law.radius * scale,
    slope: [sx, sy],
    lamp: [dx / len, dy / len, h / len],
    shadow: {
      sigma: law.shadow.sigma,
      alpha: law.shadow.alpha + (law.shadow.alphaHeld - law.shadow.alpha) * flux.lift,
      sigmaPerUnit: law.shadow.sigmaPerUnit,
    },
    sheets: law.sheets,
    step: law.sheetStep,
    thickness: law.thickness,
    alpha: flux.fade,
  };
}

/** The pad's block as drawn — the top sheet and the sheets' edges under it — its centre and half extents, world units. */
function blockOf(G: PadGeometry): { cx: number; cy: number; hx: number; hy: number } {
  const down = (G.sheets * G.step * G.scale) / 2;
  return { cx: G.centre[0], cy: G.centre[1] + down, hx: G.half[0], hy: G.half[1] + down };
}

/** Is a world point on the pad's block (the CPU mirror of the shader's `sdf_round_box`)? */
export const onPad = (G: PadGeometry, wx: number, wy: number): boolean => {
  const b = blockOf(G);
  return sdRoundBox(wx - b.cx, wy - b.cy, b.hx, b.hy, G.radius) <= 0;
};

/** The pad's program for a host's shader text (the kit's pieces from it; its own from shaders.ts): its pass on the root's mat. */
export function commentPadProgram(text?: ShaderText): KindProgram<PadInstance> {
  return {
    name: COMMENT_PAD_KIND,
    stratum: "things",
    create: async (device, format, mat) => PadPass.create(device, format, padShaders(text), mat),
  };
}

export interface CommentPadKindOptions {
  /** The host's shader text for the kit's pieces; the desk's generated module unless a host says. */
  readonly text?: ShaderText;
  readonly law?: PadLaw;
}

const penOf = (look: PadLook, props: Readonly<Record<string, unknown>>): RGB | undefined =>
  look.pens[stringProp(props, "pen", "ball")] ?? Object.values(look.pens)[0];

/** The pad's kind, whole (`ObjectKind`): its program and its world half. */
export function commentPadKind(
  opts: CommentPadKindOptions = {},
): ObjectKind<PadGeometry, PadInstance, PadLook> {
  const law = opts.law ?? PAD;
  return {
    ...commentPadProgram(opts.text),
    reach: padReach(law),
    // the record reads the view's zoom and dpr ONLY through the ink's band: a zoom within a rung remakes nothing
    rung: (c: RungContext): number => Math.round(Math.log2(bandFor(c.zoom * c.dpr, law))),
    local: (host) => createPadWriting(host, law),
    resolve: (ctx: ObjectContext): PadGeometry => resolvePad(ctx.rect, ctx.flux, ctx.lamp, law),
    record(G: PadGeometry, ctx: ObjectContext): PadInstance {
      const look = ctx.look as PadLook | undefined;
      const ink = look === undefined ? undefined : penOf(look, ctx.props);
      if (look === undefined || ink === undefined)
        throw new Error(
          "comment-pad: the pad's ink is the host's — the palette names no `pens` (theme.ts `CommentPadPalette`)",
        );
      const w = ctx.local as PadWriting | undefined;
      const drawn = w?.draw(ctx.entity, ctx.props, G.size, ctx.view.zoom * ctx.view.dpr);
      const box = writingBox(G.size.w, G.size.h, law);
      const pitch = PAD_HAND.size * PAD_HAND.lineHeight;
      return {
        geometry: G,
        paper: look.paper,
        sheet: look.sheet,
        accent: look.accents[accentOf(ctx.props)],
        ink,
        binding: law.binding,
        grain: law.grain,
        rules: drawn?.rules ?? {
          first: box.y + PAD_HAND.size * 0.9,
          pitch,
          last: box.y + box.h - PAD_HAND.size * 0.25,
        },
        ruleHalf: law.ruleHalf,
        ruleAlpha: look.ruleAlpha,
        margin: { x: law.marginRule, alpha: look.marginAlpha },
        caretWidth: law.caret.width,
        raster: drawn?.raster,
        caret: drawn?.caret,
      };
    },
    hit: (G: PadGeometry, wx: number, wy: number): ObjectHit | null =>
      onPad(G, wx, wy) ? "content" : null,
    // far inside a container's face (K8a's generic chips): a sheet of its paper, its writing greeked in its pen
    chip(G: PadGeometry, ctx: ObjectContext): ChildShape | null {
      const look = ctx.look as PadLook | undefined;
      if (look === undefined) return null;
      const ink = penOf(look, ctx.props) ?? look.accents[accentOf(ctx.props)];
      const laid = (ctx.local as PadWriting | undefined)?.layoutOf(ctx.entity);
      const box = writingBox(G.size.w, G.size.h, law);
      const lines = (laid?.lines ?? [])
        .filter((L) => L.width > 0)
        .map((L) => ({ y: box.y + L.y, width: L.width }));
      return {
        finish: PAPER_FINISH,
        cx: G.centre[0],
        cy: G.centre[1],
        hx: G.half[0],
        hy: G.half[1],
        angle: 0,
        radius: G.radius,
        colour: look.paper,
        height: G.thickness * 0.5,
        ...(lines.length > 0 ? { writing: { ink, x0: box.x, em: PAD_HAND.size, lines } } : {}),
      };
    },
    // the desk's marks go round the block as drawn (its corner its radius)
    frame: (G: PadGeometry): MarkFrame => {
      const b = blockOf(G);
      return { cx: b.cx, cy: b.cy, hx: b.hx, hy: b.hy, angle: 0, r: G.radius };
    },
    theme: (palette): PadLook => padLook(palette as CommentPadPalette),
  };
}
