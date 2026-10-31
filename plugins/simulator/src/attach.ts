// THE PHONE'S MENU (PT-S2; R11 — PT-S1's R2 Q5: "a Model or Finish act is PT-S2's, with the attach"; DESIGN.md §9 "The
// phone's two acts on the selection menu", quoted exactly): ICE's `MenuActionDef`s, each phone an act changes ONE undo step
// (`setProps` — one transaction a call, its props validated, the json binding written as its cell's string by ICE itself).
//  - ATTACH binds each selected phone to a Simulator of THIS Mac's own: the device the host answers for the phone's own model
//    (`SIMULATOR_DEVICES.attachable` — synchronous, the host's last read of this Mac's devices): its booted device, else the
//    first booted iPhone, else the model on the newest iOS here, whose face then says off or no device honestly. It writes
//    `{ model, binding }` in ONE `setProps`: the model IS the device's type, so the phone morphs into the device it shows
//    (morph.ts — a change of model). The answer is read through the contract (the binding's one schema) before it is written;
//    nothing answered — the host has not read this Mac's devices, or holds none — and nothing is written, nor for a phone
//    already bound there (no undo step for no change).
//  - FINISH turns each selected phone to the next of its model's launch colours (PHONE.md §7's `f`), and round to the first.
//  - NO MODEL ACT (R11): a bound phone's model is its device's — a model unlike its binding would show another device's screen
//    in its frame — so only Attach writes it.
// They declare NO glyph: the bar prints a kind's act without one as its label alone, in text (field-app's bar, R3) — the words
// §9 says, never a pictogram the book has not ruled (the phone's one tool says "View only" the same way).
//
// A menu act is handed the world and the selection, never the desk: it reaches this desk's local — and through it the host's
// device list — by the WORLD, as the pane's held tools reach its hand (`handOf`). The phone's DRIVER FACTORY is that bridge:
// it keeps the desk's local by its world and returns NO driver (core's drag carries the phone; a kind with no driver is
// never ticked for one, so the idle law of I52 holds by absence).

import { LiveSurfaceIosSimulatorBindingV1 } from "@vibefield/contracts";
import type {
  DriverFactory,
  MenuActionApi,
  MenuActionDef,
  World,
} from "@vibefield/plugin-sdk/desk";
import { bindingOf } from "./binding";
import { DEFAULT_MODEL, PROP } from "./ids";
import { finishOf, modelOf } from "./law";
import type { SimulatorLocal } from "./local";

/** The phones' local on each desk, by the world it acts on — what a menu act (handed the world, never the desk) reaches. */
const locals = new WeakMap<World, SimulatorLocal>();
/** The phones' local on `world`'s desk, or undefined: no desk of it has made the phone's kind. */
export const phoneLocalOf = (world: World): SimulatorLocal | undefined => locals.get(world);

/** THE PHONE'S DRIVER FACTORY — the bridge, made once per desk: the desk's local kept by its world, and no driver. */
export const phoneDrivers: DriverFactory = (h) => {
  const local = h.local as SimulatorLocal | undefined;
  if (local !== undefined) locals.set(h.world, local);
  return undefined;
};

/** The acts' ids — what `ops.runMenuAction` names. */
export const ATTACH_ACT = "attach";
export const FINISH_ACT = "finish";

/** Each act's word on the menu (DESIGN.md §9, quoted exactly — attach.test.ts reads them there). */
export const PHONE_ACT_LABELS = { [ATTACH_ACT]: "Attach", [FINISH_ACT]: "Finish" } as const;

/** What a menu act reads and writes of the selection (ICE's `MenuActionApi`, less the transaction it never needs). */
type PhoneActApi = Pick<MenuActionApi, "world" | "entities" | "props" | "setProps">;

/** The phone's model as its props hold it — a free string (an id this build's catalog lacks stays the phone's own); none, the default. */
const modelProp = (props: Readonly<Record<string, unknown>>): string => {
  const model = props[PROP.model];
  return typeof model === "string" && model.length > 0 ? model : DEFAULT_MODEL;
};

/**
 * ATTACH — each phone of `api.entities` bound to the device the host's list answers for its model, `{ model, binding }` in ONE
 * `setProps` (one undo step a phone; the morph follows the model). How many phones were written: none where no list is lent,
 * the host answers nothing a binding can be made of, or a phone is already bound there as its model.
 */
export function attachPhones(api: PhoneActApi): number {
  const devices = phoneLocalOf(api.world)?.devices();
  if (devices === undefined) return 0;
  let wrote = 0;
  for (const e of api.entities) {
    const props = api.props(e);
    const model = modelProp(props);
    // the host's answer, through the contract — never written unread: its two ids alone, each the shape Xcode names
    const read = LiveSurfaceIosSimulatorBindingV1.safeParse(devices.attachable(model));
    if (!read.success) continue;
    const binding = { deviceType: read.data.deviceType, runtime: read.data.runtime };
    const was = bindingOf(props);
    if (
      model === binding.deviceType &&
      was?.deviceType === binding.deviceType &&
      was.runtime === binding.runtime
    )
      continue;
    if (api.setProps(e, { [PROP.model]: binding.deviceType, [PROP.binding]: binding })) wrote += 1;
  }
  return wrote;
}

/** The next of `model`'s launch colours after the one `finish` names (its model's first, where it names none of them), or
 * undefined: the model has one colour, or none. */
export function nextFinish(model: string, finish: string): string | undefined {
  const m = modelOf(model);
  if (m.finishes.length < 2) return undefined;
  const at = m.finishes.indexOf(finishOf(m, finish));
  return m.finishes[(at + 1) % m.finishes.length];
}

/** FINISH — each phone of `api.entities` turned to its model's next launch colour (one undo step a phone). How many were written. */
export function finishPhones(api: PhoneActApi): number {
  let wrote = 0;
  for (const e of api.entities) {
    const props = api.props(e);
    const finish = props[PROP.finish];
    const next = nextFinish(modelProp(props), typeof finish === "string" ? finish : "");
    if (next === undefined || next === finish) continue;
    if (api.setProps(e, { [PROP.finish]: next })) wrote += 1;
  }
  return wrote;
}

/** THE PHONE'S MENU: Attach, then Finish (R11 — no Model act). */
export const PHONE_ACTS: readonly MenuActionDef[] = [
  {
    id: ATTACH_ACT,
    label: PHONE_ACT_LABELS[ATTACH_ACT],
    run: (api) => {
      attachPhones(api);
    },
  },
  {
    id: FINISH_ACT,
    label: PHONE_ACT_LABELS[FINISH_ACT],
    run: (api) => {
      finishPhones(api);
    },
  },
];
