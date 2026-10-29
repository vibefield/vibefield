// THE PHONE as a kind (PT-S1 — PORTALS' iOS Simulator, written exactly as a third party writes a kind: through
// `@vibefield/plugin-sdk/desk` alone, ICE design-016 K-L1/K-L2): its RENDER half (`simulatorProgram` — its own pass and WGSL,
// made on the root's mat, spawned into every other slot) and its WORLD half — `resolve` the phone where it lies (its MODEL's
// shape on its rect, mid-morph a blend, lifted by the desk's flux, resting on its camera, seen from its own eye) under the
// desk's one lamp, `record` its glass, its band and its screen from its props and its look — its LIVE face where it is bound
// (live.ts), and the face's honest state (face.ts) — `hit` its slab as drawn (what is picked is what is drawn: at rest every
// point of it is the phone, so a drag anywhere on it carries it), the frame the desk's marks go round (its silhouette as its
// eye sees it), its look from the palette (theme.ts), its desk state (local.ts) and its OPENING: USE — double-click or ⏎, as
// the notebook, the board and the pane open (the PT-S design §6 Q-2) — picked up into the hand at the reading size, its
// stream asked native at 60 there. View-only until PT-S4's touch lands: in hand no tap, key or button reaches iOS; the held
// bar says "View only", in words, beside the device's name (its one tool's state, ICE I49), and the only press the kind takes
// is its face's act.

import {
  type HeldToolDef,
  type KindProgram,
  type LiveFace,
  type LiveSimulatorSpec,
  liveSimulatorFace,
  type MarkFrame,
  type ObjectContext,
  type ObjectHit,
  type ObjectKind,
  type OpenBinding,
  type ShaderText,
  stringProp,
} from "@vibefield/plugin-sdk/desk";
import { type Binding, bindingOf } from "./binding";
import { deviceName, type FacePlan, facePlan, faceWords, NO_FACE, VIEW_ONLY } from "./face";
import { DEFAULT_MODEL, PROP, SIMULATOR_KIND } from "./ids";
import {
  castPhone,
  finishOf,
  glowReach,
  modelOf,
  openExtent,
  PHONE,
  type PhoneGeometry,
  type PhoneLaw,
  type PhoneShape,
  phoneById,
  phoneReach,
  pickPhone,
  resolvePhone,
  shapeOf,
  silhouetteOf,
} from "./law";
import {
  type FinishValues,
  liveScreen,
  type PhoneInstance,
  type PhoneLookValues,
  SCREEN_OFF,
} from "./layout";
import { createSimulatorLocal, type SimulatorLocal } from "./local";
import type { PhoneModel } from "./model";
import { pinnedMorph, pinnedShown } from "./morph";
import { actAt } from "./notice";
import { PhonePass } from "./pass";
import { phoneShaders } from "./shaders";
import { phoneFinish, phoneLook, type SimulatorPalette } from "./theme";

/** The geometry the kind resolves: the law's, the finish it wears this frame (mid-morph, a blend), and — in hand — where its face's act lies. */
export interface SimulatorGeometry extends PhoneGeometry {
  readonly finish: FinishValues;
  /** In hand, the face's act's capsule: the lines its words took, on a screen of these points (notice.ts `actAt`). */
  readonly act?: { readonly lines: number; readonly points: readonly [number, number] };
}

/** The phone's `model` prop: a CoreSimulator device type (ids.ts). */
export const modelPropOf = (props: Readonly<Record<string, unknown>>): string =>
  stringProp(props, PROP.model, DEFAULT_MODEL);

/** The phone's `finish` prop ("" where none: its model's first). */
export const finishPropOf = (props: Readonly<Record<string, unknown>>): string =>
  stringProp(props, PROP.finish, "");

/** The spec a bound phone opens its face with (the SDK's `LiveSimulatorSpec`): its binding, its device's name, the desk's scheme. */
export const simulatorSpec = (
  binding: Binding,
  label: string,
  scheme: "light" | "dark",
): LiveSimulatorSpec => ({
  source: "ios-simulator",
  deviceType: binding.deviceType,
  runtime: binding.runtime,
  label,
  scheme,
});

/** The framebuffer a bound phone's stream is asked at in use: its bound type's (else its model's), px. */
export const nativeOf = (binding: Binding, model: PhoneModel): readonly [number, number] =>
  (phoneById(binding.deviceType) ?? model).screen.px;

/**
 * The held bar's tools — ONE, and it SAYS "View only" in words (ICE I49: its state, read with the anchor): touch, declared as
 * the act it will be when PT-S4's touch lands and disabled now, so the bar says beside the device's name why a tap reaches
 * nothing. It declares NO glyph, and its state none: the bar draws a slot with neither glyph nor swatch as its label, in
 * text (field-app's bar, R3) — so the state's label "View only" is what the bar SHOWS, not a tooltip under a pictogram
 * (DESIGN.md §9: "In hand the tools say **View only**").
 */
export const SIMULATOR_TOOLS: readonly HeldToolDef[] = [
  {
    id: "touch",
    label: "Touch",
    kind: "action",
    run: () => {
      // view-only until PT-S4's touch lands (the PT-S design §4) — a disabled tool's press does nothing
    },
    state: () => ({ enabled: false, label: VIEW_ONLY }),
  },
];

/** The phone's program for a host's shader text (the kit's pieces from it; its own from shaders.ts): its pass on the root's mat. */
export function simulatorProgram(text?: ShaderText): KindProgram<PhoneInstance> {
  return {
    name: SIMULATOR_KIND,
    stratum: "things",
    create: async (device, format, mat) =>
      PhonePass.create(device, format, phoneShaders(text), mat),
  };
}

export interface SimulatorKindOptions {
  /** The host's shader text for the kit's pieces; the desk's generated module unless a host says. */
  readonly text?: ShaderText;
  readonly law?: PhoneLaw;
}

/** The phone's OPENING: picked up into the hand at the reading size — its body — its word the device's name. */
export function simulatorOpening(): OpenBinding {
  return {
    extent: ({ rect, props }) => openExtent(rect, shapeOf(modelOf(modelPropOf(props)))),
    pose: "camera",
    tools: SIMULATOR_TOOLS,
    // the face's act is a part in hand: a pointer over it
    cursor: ({ part }) => (part === "act" ? "pointer" : undefined),
    // the device's name: the host's word for it, else the phone's
    readout: ({ props, entity, local }) => {
      const p = props();
      const said = liveSimulatorFace((local as SimulatorLocal | undefined)?.screen(entity)?.info);
      return said?.device ?? deviceName(bindingOf(p), modelOf(modelPropOf(p)));
    },
  };
}

/** What a phone's face shows now, read off its desk state (none: unbound, a specimen, no `LIVE` lent, no face yet). */
function planOf(
  local: SimulatorLocal | undefined,
  e: ObjectContext["entity"],
  name: string,
  law: PhoneLaw,
): FacePlan {
  const screen = local?.screen(e);
  if (screen === undefined) return NO_FACE;
  return facePlan(screen.info, screen.state, name, local?.texture(e) !== undefined, law);
}

/** What the hand points at on a phone IN HAND: its face's act (where it offers one), the phone (`content`), or nothing. */
export function heldPartAt(
  G: SimulatorGeometry,
  wx: number,
  wy: number,
  law: PhoneLaw = PHONE,
): ObjectHit | null {
  const pick = pickPhone(G, wx, wy, law);
  if (pick === null) return null;
  if (
    pick.part === "screen" &&
    G.act !== undefined &&
    actAt(G.act.points, G.act.lines, pick.point[0], pick.point[1])
  )
    return "act";
  return "content";
}

/** The phone's kind, whole (`ObjectKind`): its program and its world half. */
export function simulatorKind(
  opts: SimulatorKindOptions = {},
): ObjectKind<SimulatorGeometry, PhoneInstance, PhoneLookValues> {
  const law = opts.law ?? PHONE;
  return {
    ...simulatorProgram(opts.text),
    reach: phoneReach(law),
    local: (host) => createSimulatorLocal(host),
    resolve(ctx: ObjectContext): SimulatorGeometry {
      const look = ctx.look as PhoneLookValues | undefined;
      if (look === undefined)
        throw new Error(
          "simulator: no look — the desk hands every kind the look its `theme` makes",
        );
      const local = ctx.local as SimulatorLocal | undefined;
      const model = modelOf(modelPropOf(ctx.props));
      const finish = phoneFinish(look, finishOf(model, finishPropOf(ctx.props)));
      // the shape it shows: a morph a still pinned; else its desk's morph clock (a change of model morphs it); else its model's.
      // The clock sees a change of model only here, when the phone is resolved — and the desk resolves only what lies within
      // a slot's reach — so a change that landed while the phone was culled morphs when the phone is next drawn, not when it
      // landed: the reveal shows what changed (accepted for v1, the orchestrator's R2 Q2, 2026-10-29; no ICE ask)
      const pin = pinnedMorph(ctx.asset);
      const shown =
        pin !== undefined
          ? pinnedShown(pin, model, finish, phoneFinish(look, pin.from.finishes[0] ?? ""), law)
          : (local?.shown(ctx.entity, model, finish) ?? { shape: shapeOf(model), finish });
      const S: PhoneShape = shown.shape;
      const binding = bindingOf(ctx.props);
      const plan =
        binding === undefined
          ? NO_FACE
          : planOf(local, ctx.entity, deviceName(binding, model), law);
      // by night a BOUND phone's glow may reach round it: the quad grows to hold it, read from the props alone (the pane's `lit`).
      // Not from the face: the first resolve runs before the record has opened one, and a quad sized then would clip the glow
      // when the stream lands. A screen that is off draws no glow in the larger quad (the shader scales it by `on`); a still
      // glows and spills at its brightness (0.7, or 0.16 under words — the shader scales it by that too), so the reach holds
      // for a still as for the stream.
      const glow = ctx.theme.name === "dark" && binding !== undefined ? glowReach(law) : 0;
      const held = ctx.held !== undefined;
      const G = resolvePhone(ctx.rect, ctx.flux, S, ctx.lamp, law, glow, held);
      // in hand, its face's act is a part where its words are drawn (the capsule lies under their lines)
      const lines = held && plan.act !== null ? local?.lines(ctx.entity) : undefined;
      return {
        ...G,
        finish: shown.finish,
        ...(lines === undefined ? {} : { act: { lines, points: S.points } }),
      };
    },
    record(G: SimulatorGeometry, ctx: ObjectContext): PhoneInstance {
      const look = ctx.look as PhoneLookValues | undefined;
      if (look === undefined)
        throw new Error(
          "simulator: no look — the desk hands every kind the look its `theme` makes",
        );
      const local = ctx.local as SimulatorLocal | undefined;
      const model = modelOf(modelPropOf(ctx.props));
      const binding = bindingOf(ctx.props);
      const name = deviceName(binding, model);
      // a BOUND phone's screen is a LIVE face the host opens by the phone's durable key; an unbound one closes the one it had
      let face: LiveFace | undefined;
      if (binding !== undefined)
        face = local?.face(
          ctx.entity,
          simulatorSpec(binding, name, ctx.theme.name),
          nativeOf(binding, model),
        );
      else local?.drop(ctx.entity);
      const plan = face === undefined ? NO_FACE : planOf(local, ctx.entity, name, law);
      local?.offer(ctx.entity, plan.act?.run);
      const t = face?.texture();
      // the face's words, light over the screen (drawn by the lent raster; none lent — a Node still — the committed raster
      // its key names, else no words)
      const said = faceWords(plan, look);
      const notice =
        said === undefined
          ? undefined
          : local?.notice(ctx.entity, G.shape.points, said.words, said.ink);
      return {
        geometry: G,
        finish: G.finish,
        look,
        // the stream, or its last still, at the face's brightness; else the panel, off — and a frame of another aspect
        // (another device's stream, mid-morph) cropped to fill, never stretched
        screen:
          plan.frame && t !== undefined
            ? liveScreen(t, plan.brightness, t.width / t.height)
            : SCREEN_OFF,
        mark: plan.mark,
        ...(notice === undefined ? {} : { notice }),
        ...(face === undefined || local === undefined
          ? {}
          : { live: { e: ctx.entity, face, sight: local.sight } }),
      };
    },
    // what is drawn is what is picked: the slab as its eye sees it. At rest every point of it is the phone itself (`content`):
    // a drag anywhere carries it. IN HAND its face's act is a part (`heldPartAt`), the rest the phone's.
    hit: (G: SimulatorGeometry, wx: number, wy: number): ObjectHit | null =>
      G.held === true
        ? heldPartAt(G, wx, wy, law)
        : castPhone(G, wx, wy, law) === null
          ? null
          : "content",
    // the desk's marks go round the silhouette as the phone's own eye sees it (its corner, magnified as it is)
    frame: (G: SimulatorGeometry): MarkFrame => {
      const s = silhouetteOf(G);
      return { cx: s.cx, cy: s.cy, hx: s.hx, hy: s.hy, angle: 0, r: s.r };
    },
    theme: (palette): PhoneLookValues => phoneLook(palette as SimulatorPalette),
    open: simulatorOpening(),
  };
}
