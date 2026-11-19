import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Entity, MenuActionApi, SimulatorDevices, World } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import {
  createSimulatorLocal,
  DEFAULT_PHONE,
  FINISH_ACT,
  finishPhones,
  modelOf,
  nextFinish,
  PHONE_ACTS,
  phoneDrivers,
  phoneLocalOf,
  SETUP_ACT,
  simulator,
} from "../src";
import { configurationPatch, iosLabel, simulatorChoice } from "../src/setup";
import { fakeHost, TYPE } from "./fakes";

const DESIGN = readFileSync(resolve(import.meta.dirname, "../../../DESIGN.md"), "utf8");
/** §9's paragraph of the simulator's menu: from its head to the blank line that ends it. */
const MENU_WORDS = (() => {
  const at = DESIGN.indexOf("**The simulator's selection menu**");
  if (at < 0) throw new Error("DESIGN.md says nothing of the simulator's menu");
  const end = DESIGN.indexOf("\n\n", at);
  return end < 0 ? DESIGN.slice(at) : DESIGN.slice(at, end);
})();

const PRO = `${TYPE}iPhone-17-Pro`;
const SIXTEEN = `${TYPE}iPhone-16`;
const IOS_26_1 = "com.apple.CoreSimulator.SimRuntime.iOS-26-1";
const IOS_18_6 = "com.apple.CoreSimulator.SimRuntime.iOS-18-6";

/** A desk's world as a menu act is handed it — a key the bridge holds, nothing more. */
const worldOf = (): World => ({}) as unknown as World;

/** A desk made on `world`: its local over a host that lends `devices` (or none), bridged by the driver factory. */
function deskOn(world: World, devices?: SimulatorDevices) {
  const local = createSimulatorLocal(fakeHost(devices === undefined ? {} : { devices }).host);
  const driver = simulator.drivers?.({ world, local } as never);
  return { local, driver };
}

/** The selection as a menu act is handed it: these phones' props, and the writes the act made (false: a read-only document). */
function selection(
  world: World,
  phones: Readonly<Record<number, Readonly<Record<string, unknown>>>>,
  writable = true,
) {
  const writes: [Entity, Record<string, unknown>][] = [];
  const api: MenuActionApi = {
    world,
    entities: Object.keys(phones).map((k) => Number(k) as Entity),
    props: (e) => phones[e as number] ?? {},
    setProps: (e, props) => {
      writes.push([e, { ...props }]);
      return writable;
    },
    transact: () => {
      throw new Error("the phone's acts write by setProps alone");
    },
  };
  return { api, writes };
}

describe("phone setup and finish controls", () => {
  it("offers simulator settings from the object menu and held phone", () => {
    expect(PHONE_ACTS.map((a) => a.id)).toEqual([SETUP_ACT, FINISH_ACT]);
    expect(simulator.kind.open?.tools?.map((a) => a.id)).toContain(SETUP_ACT);
    for (const act of PHONE_ACTS) expect(MENU_WORDS).toContain(`**${act.label}**`);
    expect(simulator.menu).toBe(PHONE_ACTS);
  });

  it("its driver factory is a bridge: this desk's local kept by its world, and NO driver made (core's drag carries the phone)", () => {
    const world = worldOf();
    expect(phoneLocalOf(world)).toBeUndefined();
    const { local, driver } = deskOn(world);
    expect(driver?.dispose).toBeTypeOf("function");
    expect(phoneDrivers).toBe(simulator.drivers);
    expect(phoneLocalOf(world)).toBe(local);
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

describe("PT-S2 — FINISH: the next of the model's launch colours, round to the first", () => {
  it("steps through its model's own finishes in their order, and round", () => {
    const m = modelOf(PRO);
    expect(m.finishes.length).toBeGreaterThan(1);
    m.finishes.forEach((f, i) => {
      expect(nextFinish(PRO, f), f).toBe(m.finishes[(i + 1) % m.finishes.length]);
    });
  });

  it("a finish that is none of its model's reads as the model's first — so the next is its second", () => {
    expect(nextFinish(PRO, "no such colour")).toBe(modelOf(PRO).finishes[1]);
    // a model this build's catalog lacks wears the default's
    expect(nextFinish(`${TYPE}iPhone-99`, DEFAULT_PHONE.finishes[0] ?? "")).toBe(
      DEFAULT_PHONE.finishes[1],
    );
  });

  it("the act writes each phone's next finish in one setProps — nothing else of it", () => {
    const world = worldOf();
    const [first, second] = modelOf(PRO).finishes;
    const [eightFirst, eightSecond] = modelOf(`${TYPE}iPhone-8`).finishes;
    const { api, writes } = selection(world, {
      1: { model: PRO, finish: first },
      2: { model: `${TYPE}iPhone-8`, finish: eightFirst },
    });
    PHONE_ACTS.find((a) => a.id === FINISH_ACT)?.run(api);
    expect(writes).toEqual([
      [1, { finish: second }],
      [2, { finish: eightSecond }],
    ]);
    // and the act asks no device list: it needs none
    expect(finishPhones(selection(worldOf(), { 1: { model: PRO, finish: second } }).api)).toBe(1);
  });
});
