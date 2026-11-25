import type {
  DriverFactory,
  Entity,
  KindDriver,
  ObjectDomHost,
  World,
} from "@vibefield/plugin-sdk/desk";
import { liveSimulatorFace } from "@vibefield/plugin-sdk/desk";
import { PROP } from "./ids";
import type { SimulatorLocal } from "./local";
import { mountSimulatorSetup } from "./setup-dialog";

/** The cell the phone's props live in (the type's one group: the manifest declares no other). */
export type PhoneCell = ObjectDomHost["object"]["groups"][number]["component"];

/**
 * A desk's phones as the acts reach them (a menu act is handed the world, never the desk), by the world they act on: the
 * desk's local, the cell its DOM half read the props from, the sheet on the glass, and Simulator settings…'s pick-up (track
 * OM, OM-2, 2026-11-25).
 */
interface PhoneDesk {
  readonly local: SimulatorLocal;
  cell: PhoneCell | undefined;
  /** The sheet opened on the phone in hand for `entities`, the first of them that phone; false where it is not in hand. */
  configure(entities: readonly Entity[]): boolean;
  /** Simulator settings… from the selection: the first picked up through the desk's hold, its sheet to rise on its glass for
   * every one of them once it is in hand. False where the desk lends no hold or refuses the phone. */
  settings(entities: readonly Entity[]): boolean;
}
const desks = new WeakMap<World, PhoneDesk>();

/** The sheet opened on the phone in hand for `entities` (the first of them that phone). False: no sheet on this desk yet, or
 * that phone is not in hand. */
export const configureSimulators = (world: World, entities: readonly Entity[]): boolean =>
  desks.get(world)?.configure(entities) ?? false;
/** Simulator settings… from the selection on `world`'s desk: the first phone picked up, the sheet to rise for them all. */
export const simulatorSettings = (world: World, entities: readonly Entity[]): boolean =>
  desks.get(world)?.settings(entities) ?? false;
/** The phones' local on `world`'s desk, or undefined: no desk of it has made the phone's kind. */
export const phoneLocalOf = (world: World): SimulatorLocal | undefined => desks.get(world)?.local;
/** The cell the phones' props live in on `world`'s desk, read by its DOM half; undefined until that half is mounted. */
export const phoneCellOf = (world: World): PhoneCell | undefined => desks.get(world)?.cell;

/** How many frames a pick-up asked by Simulator settings… waits for the phone to come into the hand (3 s at 60 Hz). */
const PICKUP_FRAMES = 180;

/** THE PHONE'S DRIVER FACTORY — the bridge, made once per desk: the desk's local and its scoped keyboard driver. */
export interface PhoneDriver extends KindDriver {
  join(dom: ObjectDomHost): void;
}

export const phoneDrivers: DriverFactory = (h) => {
  const local = h.local as SimulatorLocal | undefined;
  if (local === undefined) return undefined;
  const held = new Map<string, { e: Entity; key: string }>();
  let document: Document | undefined;
  let setup: ReturnType<typeof mountSimulatorSetup> | undefined;
  let previouslyHeld: Entity | undefined;
  let checkedFailure = false;
  /** Simulator settings… asked from the selection: the phone it picked up, every phone its sheet sets up, and the frames left
   * for the hand to take it. */
  let pending:
    | { readonly entity: Entity; readonly phones: readonly Entity[]; frames: number }
    | undefined;
  const heldPhone = () => {
    const hand = h.hand();
    return hand && !hand.landing && h.isKind(hand.entity) ? hand.entity : undefined;
  };
  const desk: PhoneDesk = {
    local,
    cell: undefined,
    configure: (entities) => setup?.configure(entities) ?? false,
    settings(entities) {
      const first = entities[0];
      if (first === undefined || setup === undefined) return false;
      // already in hand: its sheet rises now
      if (heldPhone() === first) return setup.configure(entities);
      const hold = local.hold();
      if (hold === undefined) return false;
      pending = { entity: first, phones: [...entities], frames: PICKUP_FRAMES };
      if (!hold.pickUp(first)) {
        pending = undefined;
        return false;
      }
      h.wake();
      return true;
    },
  };
  desks.set(h.world, desk);
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
        // the phone Simulator settings… picked up is in hand: its sheet rises for every phone the act was run on (track OM,
        // OM-2, 2026-11-25); the hand holding another lets the ask go
        const asked =
          pending !== undefined && pending.entity === entity ? pending.phones : undefined;
        if (entity !== undefined) pending = undefined;
        if (asked !== undefined && setup?.configure(asked)) checkedFailure = true;
        else if (entity !== undefined && setup && !setup.configured(entity)) {
          checkedFailure = true;
          setup.configure([entity]);
        }
      }
      // a pick-up the hand never took is let go after its frames
      if (pending !== undefined && --pending.frames <= 0) pending = undefined;
      const problem = setupProblem(entity);
      if (entity !== undefined && problem) {
        checkedFailure = true;
        if (problem === "configuration") setup?.configure([entity]);
        else void setup?.recover(entity);
      }
    },
    // An open sheet follows the phone every frame: Simulator settings… on the bar opens it while the phone is still rising
    // into the hand, and a driver that idled there left it where the rise was (track OM, OM-2, 2026-11-26).
    idle: () =>
      pending === undefined &&
      heldPhone() === previouslyHeld &&
      !setupProblem(previouslyHeld) &&
      !(setup?.showing() ?? false),
    join(dom) {
      setup = mountSimulatorSetup(dom, local.devices());
      desk.cell = dom.object.groups.find(
        (group) => group.name === dom.object.propToGroup[PROP.finish],
      )?.component;
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
      setup = undefined;
      pending = undefined;
      desks.delete(h.world);
    },
  };
  return driver;
};
