// PORTED VERBATIM from ICE's worked third-party kind (`infinite-canvas-engine/examples/desk-clock/src/kind.ts`, design-016 K8b) — re-wrapped by this repo's formatter,
// its imports moved to the SDK's `/desk` door and its kind named by its type (ids.ts) — nothing else changed.

// The DESK CLOCK as a kind (design-016 K8b — a third party's, on the SDK alone): its render half (`clockProgram` — its own pass
// and WGSL, made on the root's mat, spawned into every other slot) and its world half — `resolve` the case where it lies (lifted
// in a hand, fading as a ghost) under the desk's one lamp, `record` its hands at THE TIME IT SHOWS, `hit` its round face (a press
// on the rect's corner is not the clock's), its chip in a container's face, the frame the desk's marks go round, its look from the
// palette, its desk state (the registered wake, local.ts) and its opening (picked up: its own held tools set it).
//
// THE TIME, in order: a still's pinned time (`ctx.asset` — `ClockAsset { at }`, the handle's generic `pinAsset`: the oracle's and
// the rigs' fixed hour, never waited on); else the desk's wall clock (`ctx.local` — and the clock says what it shows, so the desk
// wakes when a hand must move); else, with no desk state at all (a specimen on the pegboard, K5a's stateless drawing), the shop's
// 10:10:30.

import {
  type ChildShape,
  type HeldToolDef,
  type KindProgram,
  type Lamp,
  type MarkFrame,
  type ObjectContext,
  type ObjectHit,
  type ObjectKind,
  PAPER_FINISH,
  type Palette,
  type ShaderText,
  stringProp,
  type ThemeName,
} from "@vibefield/plugin-sdk/desk";
import {
  DIAL_GLYPH,
  RING24_GLYPH,
  SECONDS_GLYPH,
  ZONE_AHEAD_GLYPH,
  ZONE_BACK_GLYPH,
} from "./glyphs";
import { CLOCK_KIND } from "./ids";
import {
  CLOCK,
  CLOCK_STYLES,
  type ClockLaw,
  type ClockStyle,
  caseOf,
  clockReach,
  EARLY_MS,
  handAngles,
  keyAt,
  offsetAt,
  SHOP_TIME,
  stepOf,
  timeOfDay,
  zoneOf,
} from "./law";
import type { ClockGeometry, ClockInstance } from "./layout";
import { type ClockLocal, type ClockShown, createClockLocal } from "./local";
import { ClockPass } from "./pass";
import { clockShaders } from "./shaders";
import { CLOCK_PALETTE, type ClockLook, type ClockPalette, clockLook } from "./theme";

/** The clock's kind name (ids.ts — on VibeField's desk it IS the type, the host's rule). */
export { CLOCK_KIND };

/** A still's time on one clock (`handle.pinAsset(e, { at })`): epoch ms — the hands stand there, and the desk never waits on them. */
export interface ClockAsset {
  readonly at: number;
}
const asClockAsset = (a: unknown): ClockAsset | undefined =>
  typeof a === "object" &&
  a !== null &&
  typeof (a as ClockAsset).at === "number" &&
  Number.isFinite((a as ClockAsset).at)
    ? (a as ClockAsset)
    : undefined;

/** A boolean prop with a default — `numberProp`/`stringProp`'s kin. */
export const flagProp = (
  props: Readonly<Record<string, unknown>>,
  name: string,
  fallback: boolean,
): boolean => {
  const v = props[name];
  return typeof v === "boolean" ? v : fallback;
};
/** The clock's style from its props (an unknown one is the classic dial). */
export const styleOf = (props: Readonly<Record<string, unknown>>): ClockStyle => {
  const s = stringProp(props, "style", "classic");
  return (CLOCK_STYLES as readonly string[]).includes(s) ? (s as ClockStyle) : "classic";
};

/** A clock lying where its rect says under the lamp, in a hand by `lift` (0 … 1), fading by `fade` — the pass's geometry, the pick's too. */
export function resolveClock(
  rect: { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number },
  flux: { readonly lift: number; readonly fade: number },
  lamp: Lamp,
  law: ClockLaw = CLOCK,
): ClockGeometry {
  const c = caseOf(Math.min(rect.w, rect.h), flux.lift, law);
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
    radius: c.radius,
    face: law.face,
    lift: c.lift,
    scale: c.scale,
    slope: [sx, sy],
    lamp: [dx / len, dy / len, h / len],
    shadow: {
      sigma: law.shadow.sigma,
      alpha: law.shadow.alpha + (law.shadow.alphaHeld - law.shadow.alpha) * flux.lift,
      sigmaPerUnit: law.shadow.sigmaPerUnit,
    },
    relief: law.relief,
    heights: law.height,
    alpha: flux.fade,
  };
}

/** Is a world point on the clock's round face (the case as drawn)? The CPU mirror of the shader's `length(q) − R`. */
export const onClock = (G: ClockGeometry, wx: number, wy: number): boolean =>
  Math.hypot(wx - G.centre[0], wy - G.centre[1]) <= G.radius;

/**
 * THE CLOCK'S TOOLS IN HAND (its opening — design-015 §8 as a plugin declares it): picked up, the clock is SET — the seconds hand
 * on or off, the 24-hour ring, the zone an hour back or ahead, the next dial — each an ACTION (one transaction, one undo step), each
 * with its OWN glyph (K8a's `HeldGlyph { path }`) and its key while held.
 */
export const CLOCK_TOOLS: readonly HeldToolDef[] = [
  {
    id: "seconds",
    label: "Seconds hand",
    kind: "action",
    keys: ["s"],
    hint: "S",
    glyph: { path: SECONDS_GLYPH },
    run: (api) => {
      api.setProps({ seconds: !flagProp(api.props(), "seconds", true) });
    },
  },
  {
    id: "ring24",
    label: "24-hour ring",
    kind: "action",
    keys: ["h"],
    hint: "H",
    glyph: { path: RING24_GLYPH },
    run: (api) => {
      api.setProps({ ring24: !flagProp(api.props(), "ring24", false) });
    },
  },
  {
    id: "zone-back",
    label: "An hour back",
    kind: "action",
    keys: ["["],
    hint: "[",
    glyph: { path: ZONE_BACK_GLYPH },
    run: (api) => {
      api.setProps({
        zone: zoneOf(offsetAt(stringProp(api.props(), "zone", "local"), Date.now()) - 60),
      });
    },
  },
  {
    id: "zone-ahead",
    label: "An hour ahead",
    kind: "action",
    keys: ["]"],
    hint: "]",
    glyph: { path: ZONE_AHEAD_GLYPH },
    run: (api) => {
      api.setProps({
        zone: zoneOf(offsetAt(stringProp(api.props(), "zone", "local"), Date.now()) + 60),
      });
    },
  },
  {
    id: "dial",
    label: "Next dial",
    kind: "action",
    keys: ["f"],
    hint: "F",
    glyph: { path: DIAL_GLYPH },
    run: (api) => {
      const s = styleOf(api.props());
      api.setProps({ style: CLOCK_STYLES[(CLOCK_STYLES.indexOf(s) + 1) % CLOCK_STYLES.length] });
    },
  },
];

/**
 * The clock's WORD in hand (petition I22 — a plugin's readout, declared as a built-in's is): the time its hands show, as its last record
 * drew them (`ClockLocal.shown` — a still's pinned hour, or the wall's, moving with the hands: the desk draws a frame at every move and
 * recomposes the word with it) — "10:08", or "10:08:42" with its seconds hand; on the 24-hour ring the hour runs to 23, as the ring
 * reads. None before the clock has been drawn.
 */
export function clockWord(
  shown: Pick<ClockShown, "tod" | "seconds"> | undefined,
  ring24: boolean,
): string | undefined {
  if (shown === undefined) return undefined;
  const t = Math.floor(shown.tod);
  const h = Math.floor(t / 3600) % 24;
  const hour = ring24 ? String(h).padStart(2, "0") : String(h % 12 === 0 ? 12 : h % 12);
  const mm = String(Math.floor(t / 60) % 60).padStart(2, "0");
  return shown.seconds ? `${hour}:${mm}:${String(t % 60).padStart(2, "0")}` : `${hour}:${mm}`;
}

/** The clock's program for a host's shader text (the kit's pieces from it; its own from shaders.ts): its pass on the root's mat. */
export function clockProgram(text?: ShaderText): KindProgram<ClockInstance> {
  return {
    name: CLOCK_KIND,
    stratum: "things",
    create: async (device, format, mat) =>
      ClockPass.create(device, format, clockShaders(text), mat),
  };
}

export interface ClockKindOptions {
  /** The host's shader text for the kit's pieces (the Node oracle hands the .wgsl files on disk); the desk's generated module unless a host says. */
  readonly text?: ShaderText;
  readonly law?: ClockLaw;
  /** The wall clock the desk's clocks read (epoch ms) — the host's `Date.now` unless a test says. */
  readonly now?: () => number;
}

// docs:begin kind
/** The desk clock's kind, whole (`ObjectKind`): its program and its world half. */
export function clockKind(
  opts: ClockKindOptions = {},
): ObjectKind<ClockGeometry, ClockInstance, ClockLook> {
  const law = opts.law ?? CLOCK;
  const fallback = clockLook(CLOCK_PALETTE);
  const lookOf = (ctx: Pick<ObjectContext, "look">): ClockLook =>
    (ctx.look as ClockLook | undefined) ?? fallback;
  return {
    ...clockProgram(opts.text),
    reach: clockReach(law),
    local: (): ClockLocal => createClockLocal(opts.now),
    resolve: (ctx: ObjectContext): ClockGeometry => resolveClock(ctx.rect, ctx.flux, ctx.lamp, law),
    record(G: ClockGeometry, ctx: ObjectContext): ClockInstance {
      const style = styleOf(ctx.props);
      const seconds = flagProp(ctx.props, "seconds", true);
      const zone = stringProp(ctx.props, "zone", "local");
      const local = ctx.local as ClockLocal | undefined;
      const pin = asClockAsset(ctx.asset);
      let tod = SHOP_TIME;
      if (pin !== undefined) tod = timeOfDay(pin.at, zone);
      else if (local !== undefined) {
        // the desk's wall clock — and the clock says what it shows, so the desk wakes exactly when a hand must move (local.ts)
        const wall = local.now();
        const step = stepOf(seconds);
        tod = timeOfDay(wall + EARLY_MS, zone);
        local.saw(ctx.entity, step, keyAt(wall, step));
      }
      const hands = handAngles(tod, seconds);
      local?.show(ctx.entity, { tod, ...hands, seconds, pinned: pin !== undefined });
      return {
        geometry: G,
        hands,
        seconds,
        style: CLOCK_STYLES.indexOf(style),
        ring24: flagProp(ctx.props, "ring24", false),
        colours: lookOf(ctx).styles[style],
      };
    },
    hit: (G: ClockGeometry, wx: number, wy: number): ObjectHit | null =>
      onClock(G, wx, wy) ? "content" : null,
    // far inside a container's face (K8a's generic chips): a disc of its dial in the paper finish — a container that draws paper chips shows it
    chip: (G: ClockGeometry, ctx: ObjectContext): ChildShape => ({
      finish: PAPER_FINISH,
      cx: G.centre[0],
      cy: G.centre[1],
      hx: G.radius,
      hy: G.radius,
      angle: 0,
      radius: G.radius,
      colour: lookOf(ctx).styles[styleOf(ctx.props)].dial,
      height: G.heights.case * 0.5,
    }),
    // the desk's marks go round the round case as drawn (its corner its radius)
    frame: (G: ClockGeometry): MarkFrame => ({
      cx: G.centre[0],
      cy: G.centre[1],
      hx: G.radius,
      hy: G.radius,
      angle: 0,
      r: G.radius,
    }),
    theme: (palette: Palette, _name: ThemeName): ClockLook =>
      clockLook((palette as ClockPalette).clocks ?? CLOCK_PALETTE),
    // picked up, it is set: the held bar's tools are its own (a flat kind: the held slot's camera frames the case); its word in hand
    // is the time it shows (I22)
    open: {
      extent: (c) => c.rect,
      tools: CLOCK_TOOLS,
      readout: (c) =>
        clockWord(
          (c.local as ClockLocal | undefined)?.shown(c.entity),
          flagProp(c.props(), "ring24", false),
        ),
    },
  };
}
// docs:end kind
