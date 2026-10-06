import {
  type ObjectContext,
  type ObjectHit,
  type ObjectKind,
  rgb,
  stringProp,
} from "@vibefield/plugin-sdk/desk";
import { DiscPass } from "./pass";
import type { DiscGeometry, DiscRecord } from "./record";
import { shaders } from "./shaders";

// THE KIND, whole — what the desk draws for every {{title}} on the mat: its PROGRAM (`create` makes its
// pass on the host's device, from its WGSL) and its WORLD HALF, called per object per frame, never
// reading the world or the DOM itself — everything arrives in `ctx`. A kind's geometry `G` is what
// `resolve` makes from the rect; its record `R` is what the pass draws; `hit` is the CPU mirror of
// the drawing, so what is picked is what is drawn. Grow it from here: `chip` (its far impostor inside
// a mini mat — then provide `desk.containable` in the manifest), `local` (state per desk, and when the
// desk must wake for it — ICE's desk clock is the worked example), `open` (picked up: held tools).

/** The kind's registry name — the host's rule: it IS the object's type, one id and no second namespace. */
export const KIND_NAME = "{{objectType}}";

/** The colour a new one has — the manifest's `color` default. */
export const DEFAULT_COLOR = "#e4c46a";

export function kind(): ObjectKind<DiscGeometry, DiscRecord> {
  return {
    name: KIND_NAME,
    stratum: "things",
    // how far the drawing may reach past its rect, world units — its shadow (the cull margin, the pick pad)
    reach: 16,
    create: (device, format, mat) => DiscPass.create(device, format, shaders(), mat),
    // the rect is CENTRED, world units; `flux` says how it is held (lift 0 … 1) and how present (fade)
    resolve: (ctx: ObjectContext): DiscGeometry => ({
      cx: ctx.rect.cx,
      cy: ctx.rect.cy,
      r: (Math.min(ctx.rect.w, ctx.rect.h) / 2) * (1 + 0.04 * ctx.flux.lift),
      alpha: ctx.flux.fade,
    }),
    // its props arrive cached from the document (never re-read per frame). `color` is a free string, and `rgb` never
    // throws: one it cannot parse (a named colour like "red") answers the desk's missing ink, `MISSING_INK`, and is said
    // once on the console — the object drawn, plainly not the colour asked for, and never a strike against the kind
    record: (G, ctx) => ({ geometry: G, colour: rgb(stringProp(ctx.props, "color", DEFAULT_COLOR)) }),
    // "content" is the object itself (a tap selects it, a drag moves it); null is a miss
    hit: (G, wx, wy): ObjectHit | null => (Math.hypot(wx - G.cx, wy - G.cy) <= G.r ? "content" : null),
  };
}
