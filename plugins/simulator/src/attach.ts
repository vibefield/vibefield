import type {
  DriverFactory,
  Entity,
  KindDriver,
  MenuActionApi,
  MenuActionDef,
  ObjectDomHost,
  World,
} from "@vibefield/plugin-sdk/desk";
import { liveSimulatorFace } from "@vibefield/plugin-sdk/desk";
import { DEFAULT_MODEL, PROP } from "./ids";
import { finishOf, modelOf } from "./law";
import type { SimulatorLocal } from "./local";
import { mountSimulatorSetup } from "./setup-dialog";

/** The phones' local on each desk, by the world it acts on — what a menu act (handed the world, never the desk) reaches. */
const locals = new WeakMap<World, SimulatorLocal>();
const setupByWorld = new WeakMap<World, (entities: readonly Entity[]) => void>();
export function configureSimulators(world: World, entities: readonly Entity[]): void {
  setupByWorld.get(world)?.(entities);
}
/** The phones' local on `world`'s desk, or undefined: no desk of it has made the phone's kind. */
export const phoneLocalOf = (world: World): SimulatorLocal | undefined => locals.get(world);

/** THE PHONE'S DRIVER FACTORY — the bridge, made once per desk: the desk's local and its scoped keyboard driver. */
export interface PhoneDriver extends KindDriver {
  join(dom: ObjectDomHost): void;
}

export const phoneDrivers: DriverFactory = (h) => {
  const local = h.local as SimulatorLocal | undefined;
  if (local === undefined) return undefined;
  locals.set(h.world, local);
  const held = new Map<string, { e: Entity; key: string }>();
  let document: Document | undefined;
  let setup: ReturnType<typeof mountSimulatorSetup> | undefined;
  let previouslyHeld: Entity | undefined;
  let checkedFailure = false;
  const heldPhone = () => {
    const hand = h.hand();
    return hand && !hand.landing && h.isKind(hand.entity) ? hand.entity : undefined;
  };
  const release = (): void => {
    for (const [code, { e, key }] of held)
      local?.send(e, { kind: "key", phase: "up", key, code, mods: 0, repeat: false });
    held.clear();
  };
  const key = (event: KeyboardEvent): void => {
    const hand = h.hand();
    if (!hand || hand.landing || !h.isKind(hand.entity) || !local?.interactive(hand.entity)) return;
    if (
      event.target instanceof Element &&
      event.target.closest('input,textarea,button,dialog,[contenteditable="true"],[role="dialog"]')
    )
      return;
    // Escape returns the phone to the canvas. The desktop owns command shortcuts.
    if (event.key === "Escape" || event.metaKey || event.isComposing) return;
    const down = event.type === "keydown";
    if (!down && !held.has(event.code)) return;
    if (down) held.set(event.code, { e: hand.entity, key: event.key });
    else held.delete(event.code);
    local.send(hand.entity, {
      kind: "key",
      phase: down ? "down" : "up",
      key: event.key,
      code: event.code,
      mods: Number(event.altKey) + 2 * Number(event.ctrlKey) + 8 * Number(event.shiftKey),
      repeat: event.repeat,
    });
    event.preventDefault();
    event.stopPropagation();
  };
  const setupProblem = (entity: Entity | undefined) => {
    if (checkedFailure || entity === undefined) return;
    const info = local.screen(entity)?.info;
    if (info?.extra?.configurationUnavailable === true) return "configuration";
    const state = liveSimulatorFace(info)?.is;
    if (state === "no-simulator") return "configuration";
    if (state === "stopped") return "check";
  };
  const driver: PhoneDriver = {
    follow() {
      const entity = heldPhone();
      setup?.follow(entity);
      if (previouslyHeld !== entity) {
        release();
        previouslyHeld = entity;
        checkedFailure = false;
        if (entity !== undefined && setup && !setup.configured(entity)) {
          checkedFailure = true;
          setup.configure([entity]);
        }
      }
      const problem = setupProblem(entity);
      if (entity !== undefined && problem) {
        checkedFailure = true;
        if (problem === "configuration") setup?.configure([entity]);
        else void setup?.recover(entity);
      }
    },
    idle: () => heldPhone() === previouslyHeld && !setupProblem(previouslyHeld),
    join(dom) {
      setup = mountSimulatorSetup(dom, local.devices());
      setupByWorld.set(h.world, setup.configure);
      document = dom.container.ownerDocument;
      document.addEventListener("keydown", key, true);
      document.addEventListener("keyup", key, true);
      document.defaultView?.addEventListener("blur", release);
    },
    dispose() {
      release();
      document?.removeEventListener("keydown", key, true);
      document?.removeEventListener("keyup", key, true);
      document?.defaultView?.removeEventListener("blur", release);
      setup?.dispose();
      setupByWorld.delete(h.world);
      locals.delete(h.world);
    },
  };
  return driver;
};

export const SETUP_ACT = "simulator-settings";
export const FINISH_ACT = "finish";

type PhoneActApi = Pick<MenuActionApi, "world" | "entities" | "props" | "setProps">;

/** The phone's model as its props hold it — a free string (an id this build's catalog lacks stays the phone's own); none, the default. */
const modelProp = (props: Readonly<Record<string, unknown>>): string => {
  const model = props[PROP.model];
  return typeof model === "string" && model.length > 0 ? model : DEFAULT_MODEL;
};

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

export const PHONE_ACTS: readonly MenuActionDef[] = [
  {
    id: SETUP_ACT,
    label: "Simulator settings…",
    run: (api) => configureSimulators(api.world, api.entities),
  },
  {
    id: FINISH_ACT,
    label: "Finish",
    run: (api) => {
      finishPhones(api);
    },
  },
];
