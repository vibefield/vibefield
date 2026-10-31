// PT-S2 (R11) — THE PHONE'S MENU (attach.ts; DESIGN.md §9 "The phone's two acts on the selection menu"): two acts, Attach and
// Finish, in the book's words and no Model act. ATTACH asks the host's device list (`SIMULATOR_DEVICES`, reached through the
// desk's local by the WORLD — the driver factory's bridge, which makes no driver) for the phone's own model and writes the
// answer, read through the contract, as `{ model, binding }` in ONE `setProps` a phone — nothing where the list is cold, not
// lent, refused by the contract, or where the phone is already bound there. FINISH turns each phone to the next of its model's
// launch colours, round to the first. Driven with a hand-made `MenuActionApi` (the pane's page.test.ts's way): no world, no desk.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  Entity,
  LiveSimulatorBinding,
  MenuActionApi,
  SimulatorDevices,
  World,
} from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import {
  ATTACH_ACT,
  attachPhones,
  createSimulatorLocal,
  DEFAULT_MODEL,
  DEFAULT_PHONE,
  FINISH_ACT,
  finishPhones,
  modelOf,
  nextFinish,
  PHONE_ACT_LABELS,
  PHONE_ACTS,
  phoneDrivers,
  phoneLocalOf,
  simulator,
  UNBOUND,
} from "../src";
import { fakeHost, TYPE } from "./fakes";

const DESIGN = readFileSync(resolve(import.meta.dirname, "../../../DESIGN.md"), "utf8");
/** §9's paragraph of the phone's menu: from its head to the blank line that ends it. */
const MENU_WORDS = (() => {
  const at = DESIGN.indexOf("**The phone's two acts on the selection menu**");
  if (at < 0) throw new Error("DESIGN.md says nothing of the phone's menu");
  const end = DESIGN.indexOf("\n\n", at);
  return end < 0 ? DESIGN.slice(at) : DESIGN.slice(at, end);
})();

const PRO = `${TYPE}iPhone-17-Pro`;
const SIXTEEN = `${TYPE}iPhone-16`;
const IOS_26_1 = "com.apple.CoreSimulator.SimRuntime.iOS-26-1";
const IOS_18_6 = "com.apple.CoreSimulator.SimRuntime.iOS-18-6";

/** A desk's world as a menu act is handed it — a key the bridge holds, nothing more. */
const worldOf = (): World => ({}) as unknown as World;

/** The host's device list, answering `answer` for every model it is asked (and recording what it was asked). */
const devicesOf = (answer: (prefer: string) => LiveSimulatorBinding | undefined) => {
  const asked: string[] = [];
  const devices: SimulatorDevices = {
    attachable: (prefer) => {
      asked.push(prefer);
      return answer(prefer);
    },
  };
  return { devices, asked };
};

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

describe("PT-S2 (R11) — the phone's menu: Attach and Finish, in the book's words", () => {
  it("is two acts — Attach, then Finish — and no Model act; each label is DESIGN.md §9's, and neither draws a glyph", () => {
    expect(PHONE_ACTS.map((a) => a.id)).toEqual([ATTACH_ACT, FINISH_ACT]);
    expect(PHONE_ACTS.map((a) => a.label)).toEqual(["Attach", "Finish"]);
    expect(PHONE_ACTS.every((a) => a.glyph === undefined)).toBe(true);
    for (const label of Object.values(PHONE_ACT_LABELS))
      expect(MENU_WORDS).toContain(`**${label}**`);
    expect(MENU_WORDS).toContain("There is no Model act");
    expect(PHONE_ACTS.some((a) => /model/i.test(a.id) || /model/i.test(a.label))).toBe(false);
    // the binding hands the host exactly this menu
    expect(simulator.menu).toBe(PHONE_ACTS);
  });

  it("its driver factory is a bridge: this desk's local kept by its world, and NO driver made (core's drag carries the phone)", () => {
    const world = worldOf();
    expect(phoneLocalOf(world)).toBeUndefined();
    const { local, driver } = deskOn(world);
    expect(driver).toBeUndefined();
    expect(phoneDrivers).toBe(simulator.drivers);
    expect(phoneLocalOf(world)).toBe(local);
    // a desk made with no local of the kind bridges nothing
    const bare = worldOf();
    expect(phoneDrivers({ world: bare, local: undefined } as never)).toBeUndefined();
    expect(phoneLocalOf(bare)).toBeUndefined();
  });
});

describe("PT-S2 (R11) — ATTACH: the host's answer for the phone's own model, { model, binding } in ONE setProps", () => {
  it("asks the list for the phone's own model and writes the answer — the model the device's type, so the phone morphs into it", () => {
    const world = worldOf();
    const { devices, asked } = devicesOf(() => ({ deviceType: SIXTEEN, runtime: IOS_18_6 }));
    deskOn(world, devices);
    const { api, writes } = selection(world, { 1: { model: PRO, binding: UNBOUND } });
    PHONE_ACTS.find((a) => a.id === ATTACH_ACT)?.run(api);
    expect(asked).toEqual([PRO]);
    expect(writes).toEqual([
      [1, { model: SIXTEEN, binding: { deviceType: SIXTEEN, runtime: IOS_18_6 } }],
    ]);
  });

  it("each selected phone is asked for by its OWN model and written once — one undo step a phone; no model, the default's", () => {
    const world = worldOf();
    const { devices, asked } = devicesOf((prefer) => ({ deviceType: prefer, runtime: IOS_26_1 }));
    deskOn(world, devices);
    const { api, writes } = selection(world, { 1: { model: SIXTEEN }, 2: {} });
    expect(attachPhones(api)).toBe(2);
    expect(asked).toEqual([SIXTEEN, DEFAULT_MODEL]);
    expect(writes.map(([e]) => e)).toEqual([1, 2]);
    expect(writes[1]?.[1]).toEqual({
      model: DEFAULT_MODEL,
      binding: { deviceType: DEFAULT_MODEL, runtime: IOS_26_1 },
    });
  });

  it("writes NOTHING while the list is cold, where none is lent, or on a world no phone's desk was made on", () => {
    const cold = worldOf();
    deskOn(cold, devicesOf(() => undefined).devices);
    const a = selection(cold, { 1: { model: PRO } });
    expect(attachPhones(a.api)).toBe(0);
    expect(a.writes).toEqual([]);
    const unlent = worldOf();
    deskOn(unlent);
    const b = selection(unlent, { 1: { model: PRO } });
    expect(attachPhones(b.api)).toBe(0);
    expect(b.writes).toEqual([]);
    const c = selection(worldOf(), { 1: { model: PRO } });
    expect(attachPhones(c.api)).toBe(0);
    expect(c.writes).toEqual([]);
  });

  it("reads the host's answer through the contract: a stray id binds nothing, and only the two ids are ever written", () => {
    const stray = worldOf();
    deskOn(stray, devicesOf(() => ({ deviceType: "iPhone 17 Pro", runtime: "iOS 26.1" })).devices);
    const a = selection(stray, { 1: { model: PRO } });
    expect(attachPhones(a.api)).toBe(0);
    expect(a.writes).toEqual([]);
    const extra = worldOf();
    const said = {
      deviceType: PRO,
      runtime: IOS_26_1,
      udid: "8A3F2C1E-0000-4000-8000-000000000000",
    };
    deskOn(extra, devicesOf(() => said).devices);
    const b = selection(extra, { 1: { model: PRO } });
    expect(attachPhones(b.api)).toBe(1);
    expect(b.writes[0]?.[1]).toEqual({
      model: PRO,
      binding: { deviceType: PRO, runtime: IOS_26_1 },
    });
  });

  it("a phone already bound there — its cell's JSON, as the product holds it — is not written again (no undo step for no change)", () => {
    const world = worldOf();
    deskOn(world, devicesOf(() => ({ deviceType: PRO, runtime: IOS_26_1 })).devices);
    const bound = JSON.stringify({ deviceType: PRO, runtime: IOS_26_1 });
    const { api, writes } = selection(world, {
      1: { model: PRO, binding: bound },
      // bound to the same device, but wearing another model: the model is the device's — written
      2: { model: SIXTEEN, binding: bound },
    });
    expect(attachPhones(api)).toBe(1);
    expect(writes.map(([e]) => e)).toEqual([2]);
  });

  it("a read-only document takes no write: counted as none", () => {
    const world = worldOf();
    deskOn(world, devicesOf(() => ({ deviceType: PRO, runtime: IOS_26_1 })).devices);
    const { api } = selection(world, { 1: { model: PRO } }, false);
    expect(attachPhones(api)).toBe(0);
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
