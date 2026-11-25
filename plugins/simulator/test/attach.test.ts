// @vitest-environment happy-dom
// THE SIMULATOR'S ACTS (track OM, OM-2, 2026-11-25; DESIGN.md §9 "The simulator's acts"): Simulator settings… and Finish, on
// the selection bar and in the tools in hand, each in the words §9 sets in bold. Simulator settings… picks the first
// selected phone up through the desk's hold and its sheet rises on the glass for every one of them once the hand has it;
// Finish is a choice of the model's finishes by name and swatch, one transaction for the whole selection.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  DeskHold,
  Entity,
  MenuActionApi,
  MenuActionStateContext,
  ObjectDomHost,
  SimulatorDevices,
  World,
} from "@vibefield/plugin-sdk/desk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseFinish,
  createSimulatorLocal,
  FINISH_ACT,
  finishChoices,
  finishName,
  modelOf,
  PHONE_ACTS,
  PHONE_HELD_ACTS,
  PHONES,
  type PhoneDriver,
  phoneCellOf,
  phoneDrivers,
  phoneLocalOf,
  SETTINGS_GLYPH,
  SETUP_ACT,
  SIMULATOR_FINISHES,
  simulator,
} from "../src";
import { configurationPatch, iosLabel, simulatorChoice } from "../src/setup";
import { fakeHost, TYPE } from "./fakes";

const DESIGN = readFileSync(resolve(import.meta.dirname, "../../../DESIGN.md"), "utf8");
/** §9's paragraph of the simulator's acts: from its head to the blank line that ends it. */
const MENU_WORDS = (() => {
  const at = DESIGN.indexOf("**The simulator's acts**");
  if (at < 0) throw new Error("DESIGN.md says nothing of the simulator's acts");
  const end = DESIGN.indexOf("\n\n", at);
  return end < 0 ? DESIGN.slice(at) : DESIGN.slice(at, end);
})();

const PRO = `${TYPE}iPhone-17-Pro`;
const SIXTEEN = `${TYPE}iPhone-16`;
const EIGHT = `${TYPE}iPhone-8`;
const IOS_26_1 = "com.apple.CoreSimulator.SimRuntime.iOS-26-1";
const IOS_18_6 = "com.apple.CoreSimulator.SimRuntime.iOS-18-6";

/** A desk's world as an act is handed it — a key the bridge holds, nothing more. */
const worldOf = (): World => ({}) as unknown as World;

/** A desk made on `world`: its local over a host that lends `devices` (or none), bridged by the driver factory. */
function deskOn(world: World, devices?: SimulatorDevices) {
  const local = createSimulatorLocal(fakeHost(devices === undefined ? {} : { devices }).host);
  const driver = simulator.drivers?.({ world, local } as never);
  return { local, driver };
}

type Hand = { entity: Entity; landing: boolean; frame: { cx: number; cy: number; s: number } };

/** The desks a test mounted, disposed after it (their key listeners off the document). */
const mounted: PhoneDriver[] = [];

/**
 * A desk with its DOM half mounted: phones by entity (their props in the type's one cell), a hand the test moves, the desk's
 * hold (or none) and the host's devices. Its acts are run as the bar runs them: a menu act's api over the world the bridge
 * holds, its writes counted by transaction.
 */
function mountedDesk(
  phones: Readonly<Record<number, Record<string, unknown>>>,
  opts: { hold?: boolean; devices?: SimulatorDevices } = {},
) {
  const cell = { name: "the props cell" };
  const values = new Map<number, Record<string, unknown>>(
    Object.entries(phones).map(([k, v]) => [Number(k), { ...v }]),
  );
  const world = {
    get: (e: Entity, c: unknown) => (c === cell ? values.get(e as number) : undefined),
  } as unknown as World;
  const picked: Entity[] = [];
  let refuse = false;
  const hold: DeskHold = {
    pickUp: (e) => {
      picked.push(e);
      return !refuse;
    },
  };
  const devices: SimulatorDevices = opts.devices ?? {
    configurations: async () => [
      {
        runtime: IOS_26_1,
        models: [
          { deviceType: PRO, name: "iPhone 17 Pro" },
          { deviceType: SIXTEEN, name: "iPhone 16" },
        ],
      },
    ],
    attachable: () => undefined,
  };
  const t = fakeHost({ devices, ...(opts.hold === false ? {} : { hold }) });
  const local = createSimulatorLocal(t.host);
  let hand: Hand | undefined;
  let wakes = 0;
  const driver = simulator.drivers?.({
    world,
    local,
    hand: () => hand,
    isKind: () => true,
    wake: () => {
      wakes += 1;
    },
  } as never) as PhoneDriver;
  const container = document.createElement("div");
  document.body.append(container);
  /** The sheet's document writes: each store transaction, and its edits. */
  const stored: [number, Record<string, unknown>][][] = [];
  const store = {
    keyOf: (e: Entity) => `phone-${e}`,
    transaction: (fn: (tx: unknown) => void) => {
      const edits: [number, Record<string, unknown>][] = [];
      stored.push(edits);
      fn({
        edit: (e: Entity) => ({
          set: (_c: unknown, v: Record<string, unknown>) => {
            edits.push([e as number, v]);
            values.set(e as number, v);
          },
        }),
      });
    },
  };
  const dom = {
    container,
    hand: () => hand,
    world,
    object: {
      propToGroup: { model: "props", finish: "props", binding: "props" },
      groups: [{ name: "props", component: cell }],
    },
    docs: {
      current: () => ({
        store,
        versionReport: () => ({
          docSchema: 1,
          localSchema: 1,
          newerInDoc: [],
          olderInDoc: [],
          renamedInDoc: {},
        }),
      }),
    },
    wake: () => {},
  } as unknown as ObjectDomHost;
  driver.join(dom);
  mounted.push(driver);
  /** The act's writes: each transaction, and its edits. */
  const acted: [number, Record<string, unknown>][][] = [];
  const api = (entities: readonly number[]): MenuActionApi =>
    ({
      world,
      entities: entities.map((e) => e as Entity),
      props: (e: Entity) => values.get(e as number) ?? {},
      setProps: () => {
        throw new Error("the phone's acts write in one transaction");
      },
      transact: (fn: (tx: unknown) => void) => {
        const edits: [number, Record<string, unknown>][] = [];
        acted.push(edits);
        fn({
          edit: (e: Entity) => ({
            set: (c: unknown, v: Record<string, unknown>) => {
              if (c !== cell) throw new Error("a write outside the props cell");
              edits.push([e as number, v]);
              values.set(e as number, v);
            },
          }),
        });
        return true;
      },
    }) as unknown as MenuActionApi;
  const ctx = (entities: readonly number[]): MenuActionStateContext =>
    ({
      world,
      entities: entities.map((e) => e as Entity),
      props: (e: Entity) => values.get(e as number) ?? {},
      local,
    }) as unknown as MenuActionStateContext;
  return {
    world,
    cell,
    local,
    driver,
    container,
    values,
    picked,
    stored,
    acted,
    api,
    ctx,
    refuse: () => {
      refuse = true;
    },
    wakes: () => wakes,
    hold: (
      entity: number | undefined,
      landing = false,
      frame: Hand["frame"] = { cx: 400, cy: 360, s: 1.1 },
    ) => {
      hand = entity === undefined ? undefined : { entity: entity as Entity, landing, frame };
    },
    sheet: () => container.querySelector<HTMLDialogElement>("dialog.vf-sim-setup")!,
  };
}

afterEach(() => {
  for (const driver of mounted.splice(0)) driver.dispose?.();
  document.body.replaceChildren();
});

const setupAct = PHONE_ACTS.find((a) => a.id === SETUP_ACT)!;
const finishAct = PHONE_ACTS.find((a) => a.id === FINISH_ACT)!;
const heldFinish = PHONE_HELD_ACTS.find((a) => a.id === FINISH_ACT)!;

describe("the simulator's acts — Simulator settings… and Finish, on the bar and in hand", () => {
  it("are the two DESIGN.md §9 names in bold, on the selection bar and beside Home in the tools in hand", () => {
    expect(PHONE_ACTS.map((a) => a.id)).toEqual([SETUP_ACT, FINISH_ACT]);
    expect(PHONE_HELD_ACTS.map((a) => a.id)).toEqual([SETUP_ACT, FINISH_ACT]);
    expect(simulator.kind.open?.tools?.map((a) => a.id)).toEqual(["home", SETUP_ACT, FINISH_ACT]);
    for (const act of [...PHONE_ACTS, ...PHONE_HELD_ACTS])
      expect(MENU_WORDS).toContain(`**${act.label}**`);
    expect(MENU_WORDS).toContain("**Home**");
    expect(simulator.menu).toBe(PHONE_ACTS);
    // Simulator settings… wears its own drawing (§13, a phone with a slider) on the bar and in hand; Finish is a swatch pill
    expect(setupAct.glyph).toBe(SETTINGS_GLYPH);
    expect(PHONE_HELD_ACTS[0]?.glyph).toBe(SETTINGS_GLYPH);
    expect(SETTINGS_GLYPH.path).toBe(
      "M8 3.5h8a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z M10.5 6.5h3M9.5 13h5M12 11.2v3.6",
    );
    expect(finishAct.glyph).toBeUndefined();
    expect(typeof finishAct.choices).toBe("function");
    expect(typeof heldFinish.choices).toBe("function");
    for (const t of PHONE_HELD_ACTS) expect(t.kind).toBe("action");
  });

  it("its driver factory is a bridge: this desk's local kept by its world, and NO driver made (core's drag carries the phone)", () => {
    const world = worldOf();
    expect(phoneLocalOf(world)).toBeUndefined();
    const { local, driver } = deskOn(world);
    expect(driver?.dispose).toBeTypeOf("function");
    expect(phoneDrivers).toBe(simulator.drivers);
    expect(phoneLocalOf(world)).toBe(local);
    // no DOM half mounted yet: no cell read
    expect(phoneCellOf(world)).toBeUndefined();
    // a desk made with no local of the kind bridges nothing
    const bare = worldOf();
    expect(phoneDrivers({ world: bare, local: undefined } as never)).toBeUndefined();
    expect(phoneLocalOf(bare)).toBeUndefined();
  });
});

describe("per-pane configurations", () => {
  const rows = [
    {
      runtime: IOS_26_1,
      models: [
        { deviceType: PRO, name: "iPhone 17 Pro" },
        { deviceType: SIXTEEN, name: "iPhone 16" },
      ],
    },
    { runtime: IOS_18_6, models: [{ deviceType: SIXTEEN, name: "iPhone 16" }] },
  ];
  it("accepts only the installed model and runtime pairs", () => {
    expect(iosLabel(IOS_18_6)).toBe("iOS 18.6");
    expect(simulatorChoice(rows, IOS_18_6, PRO)).toBeUndefined();
    expect(simulatorChoice(rows, "missing", SIXTEEN)).toBeUndefined();
    expect(simulatorChoice(rows, IOS_18_6, SIXTEEN)).toEqual({
      runtime: IOS_18_6,
      deviceType: SIXTEEN,
    });
  });
  it("creates an independent configuration and skips a redundant document edit", () => {
    const choice = { runtime: IOS_18_6, deviceType: SIXTEEN };
    const patch = { model: SIXTEEN, binding: { ...choice, dedicated: true } };
    expect(configurationPatch({}, choice)).toEqual(patch);
    expect(configurationPatch({ model: SIXTEEN, binding: JSON.stringify(choice) }, choice)).toEqual(
      patch,
    );
    expect(
      configurationPatch({ model: SIXTEEN, binding: JSON.stringify(patch.binding) }, choice),
    ).toBeUndefined();
    expect(configurationPatch(patch, { ...choice, runtime: IOS_26_1 })?.binding.runtime).toBe(
      IOS_26_1,
    );
  });
});

describe("SIMULATOR SETTINGS… — the phone picked up through the desk's hold, its sheet on the glass for the whole selection", () => {
  it("picks the FIRST selected phone up, and its sheet rises once the hand has it, setting up every selected phone", async () => {
    const d = mountedDesk({ 1: { model: PRO }, 2: { model: PRO }, 3: { model: SIXTEEN } });
    expect(setupAct.state?.(d.ctx([1, 2, 3]))).toBeUndefined();
    const wakes = d.wakes();
    setupAct.run(d.api([1, 2, 3]));
    expect(d.picked).toEqual([1]);
    expect(d.wakes()).toBe(wakes + 1);
    // nothing open yet: the phone is on its way into the hand, and the driver follows it
    expect(d.sheet().open).toBe(false);
    expect(d.driver.idle?.()).toBe(false);
    d.driver.follow?.(0);
    expect(d.sheet().open).toBe(false);
    // the hand has it while it is still rising (a smaller frame, short of the centre): the sheet opens there
    d.hold(1, false, { cx: 520, cy: 300, s: 0.6 });
    d.driver.follow?.(16);
    expect(d.sheet().open).toBe(true);
    expect(d.sheet().hasAttribute("data-held")).toBe(true);
    // it says how many it sets up
    expect(d.sheet().querySelector("h2")?.textContent).toBe("Set up 3 simulators");
    const rising = { css: d.sheet().style.cssText, width: parseFloat(d.sheet().style.width) };
    // the ask is spent, but the open sheet keeps the driver following (found by the look, 2026-11-26: a driver that idled
    // here left the sheet where the rise was, beside the glass)
    expect(d.driver.idle?.()).toBe(false);
    d.hold(1, false, { cx: 400, cy: 360, s: 1.1 });
    d.driver.follow?.(32);
    const held = d.sheet().style.cssText;
    expect(held).not.toBe(rising.css);
    expect(parseFloat(d.sheet().style.width) / rising.width).toBeCloseTo(1.1 / 0.6, 5);
    d.hold(1);
    d.driver.follow?.(48);
    expect(d.sheet().style.cssText).toBe(held);
    const pill = (name: string) =>
      d.sheet().querySelector<HTMLButtonElement>(`[data-pill="${name}"]`)!;
    await vi.waitFor(() => expect(pill("runtime").disabled).toBe(false));
    expect(d.sheet().querySelector("[type=submit]")?.textContent).toBe("Create simulators");
    d.sheet().querySelector<HTMLButtonElement>("[type=submit]")!.click();
    // every selected phone, in ONE document transaction
    expect(d.stored).toHaveLength(1);
    expect(d.stored[0]?.map(([e]) => e)).toEqual([1, 2, 3]);
    for (const [, values] of d.stored[0] ?? []) {
      expect(values.model).toBe(PRO);
      expect(JSON.parse(String(values.binding))).toEqual({
        deviceType: PRO,
        runtime: IOS_26_1,
        dedicated: true,
      });
    }
    // the sheet closed, the phone stays in hand, and the driver has nothing left to follow
    expect(d.sheet().open).toBe(false);
    expect(d.driver.idle?.()).toBe(true);
  });

  it("stands faint where the desk lends no hold, and picks nothing up; a refused pick-up asks nothing of the hand", () => {
    const none = mountedDesk({ 1: { model: PRO } }, { hold: false });
    expect(setupAct.state?.(none.ctx([1]))).toEqual({ enabled: false });
    setupAct.run(none.api([1]));
    expect(none.driver.idle?.()).toBe(true);
    const refused = mountedDesk({ 1: { model: PRO }, 2: { model: PRO } });
    refused.refuse();
    setupAct.run(refused.api([1, 2]));
    expect(refused.picked).toEqual([1]);
    expect(refused.driver.idle?.()).toBe(true);
    // a desk with no local at all lends nothing either; one whose DOM half is not mounted has no sheet to raise
    expect(
      setupAct.state?.({
        world: worldOf(),
        entities: [],
        props: () => ({}),
        local: undefined,
      } as unknown as MenuActionStateContext),
    ).toEqual({ enabled: false });
    const unmounted = worldOf();
    const bare = createSimulatorLocal(fakeHost({ hold: { pickUp: () => true } }).host);
    simulator.drivers?.({ world: unmounted, local: bare } as never);
    expect(phoneLocalOf(unmounted)?.hold()).toBeDefined();
    expect(
      setupAct.state?.({
        world: unmounted,
        entities: [1 as Entity],
        props: () => ({}),
        local: bare,
      } as unknown as MenuActionStateContext),
    ).toEqual({ enabled: false });
  });

  it("a pick-up the hand never takes is let go after its frames, and the hand taking another phone lets it go at once", () => {
    const d = mountedDesk({ 1: { model: PRO }, 2: { model: PRO } });
    setupAct.run(d.api([1, 2]));
    for (let i = 0; i < 179; i += 1) d.driver.follow?.(i);
    expect(d.driver.idle?.()).toBe(false);
    d.driver.follow?.(180);
    expect(d.driver.idle?.()).toBe(true);
    setupAct.run(d.api([1, 2]));
    // another phone in hand (bound already, so it opens no setup of its own)
    d.values.set(2, {
      model: PRO,
      binding: JSON.stringify({ deviceType: PRO, runtime: IOS_26_1, dedicated: true }),
    });
    d.hold(2);
    d.driver.follow?.(0);
    expect(d.sheet().open).toBe(false);
    expect(d.driver.idle?.()).toBe(true);
  });

  it("double-clicking an unbound phone still opens its own setup on pick-up; already in hand, the act opens the sheet at once", () => {
    const d = mountedDesk({ 1: { model: PRO } });
    d.hold(1);
    d.driver.follow?.(0);
    expect(d.sheet().open).toBe(true);
    expect(d.sheet().querySelector("h2")?.textContent).toBe("Set up simulator");
    d.sheet().close();
    // the phone in hand: Simulator settings… raises its sheet with no pick-up
    expect(setupAct.state?.(d.ctx([1]))).toBeUndefined();
    setupAct.run(d.api([1]));
    expect(d.picked).toEqual([]);
    expect(d.sheet().open).toBe(true);
    d.sheet().close();
    // and the tool in hand is the same sheet
    PHONE_HELD_ACTS[0]?.run?.({ world: d.world, entity: 1 as Entity } as never);
    expect(d.sheet().open).toBe(true);
  });
});

describe("FINISH — a choice of the model's finishes by name and swatch, one undo step for the selection", () => {
  it("names every finish by its colour alone: the token's last part, less the band's metal; (PRODUCT)RED kept whole", () => {
    for (const key of Object.keys(SIMULATOR_FINISHES)) {
      const name = finishName(key);
      expect(name.length, key).toBeGreaterThan(0);
      expect(name, key).not.toMatch(/ · | — |\((?:steel|titanium|aluminium)\)/u);
    }
    expect(finishName("cosmic-orange")).toBe("Cosmic Orange");
    expect(finishName("space-gray-x")).toBe("Space Gray");
    expect(finishName("sky-blue")).toBe("Sky Blue");
    expect(finishName("natural-titanium")).toBe("Natural Titanium");
    expect(finishName("red-7")).toBe("(PRODUCT)RED");
    // and every catalog model's finish has its row: every choice carries a swatch, so the bar draws a swatch pill
    for (const m of PHONES)
      for (const f of m.finishes) expect(SIMULATOR_FINISHES[f], f).toBeDefined();
  });

  it("offers the model's finishes in its order — name, dot, the current one checked — Mixed where they differ, none across models", () => {
    const pro = modelOf(PRO);
    const [first, second] = pro.finishes;
    const one = finishChoices([{ model: PRO, finish: second }]);
    expect(one.map((c) => c.id)).toEqual(pro.finishes);
    expect(one.map((c) => c.label)).toEqual(pro.finishes.map(finishName));
    expect(one.map((c) => c.swatch)).toEqual(pro.finishes.map((f) => SIMULATOR_FINISHES[f]?.css));
    expect(one.filter((c) => c.current).map((c) => c.id)).toEqual([second]);
    // a phone that names no finish (or another model's) wears its model's first
    expect(finishChoices([{ model: PRO }]).find((c) => c.current)?.id).toBe(first);
    expect(finishChoices([{ model: PRO, finish: "silver-8" }]).find((c) => c.current)?.id).toBe(
      first,
    );
    // two phones on one finish: it is current; on two: Mixed, none current, the same list
    expect(
      finishChoices([
        { model: PRO, finish: second },
        { model: PRO, finish: second },
      ]).find((c) => c.current)?.id,
    ).toBe(second);
    const mixed = finishChoices([
      { model: PRO, finish: first },
      { model: PRO, finish: second },
    ]);
    expect(mixed.map((c) => c.id)).toEqual(pro.finishes);
    expect(mixed.some((c) => c.current)).toBe(false);
    // phones of different models share no list: no choices, and Finish stands faint
    expect(finishChoices([{ model: PRO }, { model: EIGHT }])).toEqual([]);
    expect(finishChoices([])).toEqual([]);
    const d = mountedDesk({ 1: { model: PRO }, 2: { model: EIGHT }, 3: { model: PRO } });
    expect(finishAct.state?.(d.ctx([1, 2]))).toEqual({ enabled: false });
    expect(finishAct.choices?.(d.ctx([1, 2]))).toEqual([]);
    expect(finishAct.state?.(d.ctx([1, 3]))).toBeUndefined();
    expect(finishAct.choices?.(d.ctx([1, 3]))?.map((c) => c.id)).toEqual(pro.finishes);
    // before the desk's DOM half has read the props cell, it writes nothing, so it stands faint
    const unmounted = worldOf();
    const { local } = deskOn(unmounted);
    expect(
      finishAct.state?.({
        world: unmounted,
        entities: [1 as Entity],
        props: () => ({ model: PRO }),
        local,
      } as unknown as MenuActionStateContext),
    ).toEqual({ enabled: false });
  });

  it("a finish taken sets every selected phone in ONE transaction, each phone's props whole; an unknown one, nothing", () => {
    const pro = modelOf(PRO);
    const [first, second, third] = pro.finishes;
    const binding = JSON.stringify({ deviceType: PRO, runtime: IOS_26_1, dedicated: true });
    const d = mountedDesk({
      1: { model: PRO, finish: first, binding },
      2: { model: PRO, finish: second },
      3: { model: PRO, finish: third },
    });
    finishAct.run(d.api([1, 2, 3]), { id: second ?? "" });
    expect(d.acted).toHaveLength(1);
    // the one already wearing it is left as it is
    expect(d.acted[0]).toEqual([
      [1, { model: PRO, finish: second, binding }],
      [3, { model: PRO, finish: second }],
    ]);
    // an unknown finish, another model's, no choice at all, or one every phone wears: nothing written
    finishAct.run(d.api([1, 2, 3]), { id: "no such colour" });
    finishAct.run(d.api([1, 2, 3]), { id: "silver-8" });
    finishAct.run(d.api([1, 2, 3]));
    finishAct.run(d.api([1, 2, 3]), { id: second ?? "" });
    expect(d.acted).toHaveLength(1);
    // phones of different models: nothing written
    const mixed = mountedDesk({ 1: { model: PRO }, 2: { model: EIGHT } });
    expect(chooseFinish(mixed.api([1, 2]), [1 as Entity, 2 as Entity], { id: first ?? "" })).toBe(
      false,
    );
    expect(mixed.acted).toEqual([]);
  });

  it("in hand the same choice: the phone's finishes, its own checked, one transaction when taken", () => {
    const pro = modelOf(PRO);
    const [first, second] = pro.finishes;
    const d = mountedDesk({ 1: { model: PRO, finish: first } });
    const held = {
      world: d.world,
      entity: 1 as Entity,
      props: () => d.values.get(1) ?? {},
      local: d.local,
    };
    expect(heldFinish.choices?.(held as never)?.find((c) => c.current)?.id).toBe(first);
    expect(heldFinish.state?.(held as never)).toBeUndefined();
    const api = d.api([1]);
    heldFinish.run?.({ world: d.world, entity: 1 as Entity, transact: api.transact } as never, {
      id: second ?? "",
    });
    expect(d.acted).toEqual([[[1, { model: PRO, finish: second }]]]);
  });
});
