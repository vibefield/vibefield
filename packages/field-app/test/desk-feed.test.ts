/**
 * Item 583 — WHAT A MOUNTED DESK IS FED (field/desk/desk-feed.ts; DESIGN.md §8 "Settings → Canvas"): the person's light
 * as the mat's gobo and the wind's policy, and the chosen plant's plate into slot `c`. The desk's handle is a stand-in
 * and the plates arrive when a row says so; what ICE draws from the config is ICE's own tests' (petition I56) and
 * smoke:canvas's.
 */
import type { CanvasEngine } from "@vibecook/ice";
import type { DeskLayerHandle } from "@vibecook/ice/desk";
import { type DeskLightValues, deskLightValues } from "@vibefield/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Bytes = Uint8Array<ArrayBuffer>;
/** Each plate asked for, with the two doors that end its load: a row decides when a plate arrives. */
const asked: { plant: string; deliver: (bytes: Bytes) => void; fail: (error: unknown) => void }[] =
  [];
vi.mock("../src/field/desk/desk-assets", async (original) => ({
  ...(await original<typeof import("../src/field/desk/desk-assets")>()),
  deskPlate: (plant: string) =>
    new Promise<Bytes>((deliver, fail) => {
      asked.push({ plant, deliver, fail });
    }),
}));

const { feedDesk } = await import("../src/field/desk/desk-feed");
const { DESK_WIND_IDLE_MS } = await import("../src/field/desk/desk-layer");
const { deskLightLook } = await import("../src/field/desk/desk-light");

const REST = deskLightValues(undefined);
const bytes = (): Bytes => new Uint8Array(4);
/** Let the plates' promises run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The desk's handle, as far as the feed reaches into it. */
function fakeHandle() {
  const listeners = new Set<() => void>();
  const h = {
    here: false,
    configureMat: vi.fn(),
    setAmbient: vi.fn(),
    setPlate: vi.fn(),
    setGlyphs: vi.fn(),
    submits: vi.fn(),
    available: () => h.here,
    onStatus(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** The mat is here: the layer says so to whoever listens. */
    arrive() {
      h.here = true;
      for (const fn of [...listeners]) fn();
    },
  };
  return h;
}

const engine = {
  world: { getResource: () => ({ dpr: 1 }) },
  engine: { addSystems: () => () => undefined },
} as unknown as CanvasEngine;

const feed = (h: ReturnType<typeof fakeHandle>, light?: DeskLightValues | null) =>
  light === undefined
    ? feedDesk(h as unknown as DeskLayerHandle, engine)
    : feedDesk(h as unknown as DeskLayerHandle, engine, light);

beforeEach(() => {
  asked.length = 0;
});

describe("the desk's feed wears the person's light (583)", () => {
  it("waits for the mat, then configures its gobo, sets the wind's policy and asks for the plant's plate", async () => {
    const h = fakeHandle();
    const f = feed(h, REST);
    expect(h.configureMat).not.toHaveBeenCalled();
    expect(asked).toHaveLength(0);
    h.arrive();
    expect(h.configureMat).toHaveBeenCalledTimes(1);
    expect(h.configureMat).toHaveBeenCalledWith({ gobo: deskLightLook(REST).gobo });
    expect(h.setAmbient).toHaveBeenCalledWith("idle", DESK_WIND_IDLE_MS);
    expect(asked.map((a) => a.plant)).toEqual(["monstera"]);
    expect(f.platesSet()).toBe(false);
    const plate = bytes();
    asked[0]?.deliver(plate);
    await settle();
    expect(h.setPlate).toHaveBeenCalledTimes(1);
    expect(h.setPlate).toHaveBeenCalledWith("c", plate);
    expect(f.platesSet()).toBe(true);
  });

  it("with no light given, wears every row at its rest (the catalog's desk)", () => {
    const h = fakeHandle();
    feed(h);
    h.arrive();
    expect(h.configureMat).toHaveBeenCalledWith({ gobo: deskLightLook(REST).gobo });
    expect(asked.map((a) => a.plant)).toEqual(["monstera"]);
  });

  it("while the light is not known, configures nothing and asks for no plate; then wears it at once", () => {
    const h = fakeHandle();
    const f = feed(h, null);
    h.arrive();
    expect(h.configureMat).not.toHaveBeenCalled();
    expect(h.setAmbient).not.toHaveBeenCalled();
    expect(asked).toHaveLength(0);
    expect(f.platesSet()).toBe(false);
    f.setLight({ ...REST, plant: "fan-palm" });
    expect(h.configureMat).toHaveBeenCalledTimes(1);
    expect(asked.map((a) => a.plant)).toEqual(["fan-palm"]);
  });

  it("a light that says the same again configures nothing; a row moved configures the mat and loads no plate", () => {
    const h = fakeHandle();
    const f = feed(h, REST);
    h.arrive();
    f.setLight({ ...REST });
    expect(h.configureMat).toHaveBeenCalledTimes(1);
    expect(h.setAmbient).toHaveBeenCalledTimes(1);
    const softer = { ...REST, softness: 2 };
    f.setLight(softer);
    expect(h.configureMat).toHaveBeenCalledTimes(2);
    expect(h.configureMat).toHaveBeenLastCalledWith({ gobo: deskLightLook(softer).gobo });
    expect(asked).toHaveLength(1);
  });

  it("Wind at Still asks for an ambient that never blows", () => {
    const h = fakeHandle();
    const f = feed(h, REST);
    h.arrive();
    f.setLight({ ...REST, wind: 0 });
    expect(h.setAmbient).toHaveBeenLastCalledWith("still", DESK_WIND_IDLE_MS);
  });

  it("open light owes no plate: None turns the gobo off and the plates are said set", () => {
    const h = fakeHandle();
    const none = { ...REST, plant: "none" as const };
    const f = feed(h, none);
    h.arrive();
    expect(h.configureMat).toHaveBeenCalledWith({ gobo: deskLightLook(none).gobo });
    expect(deskLightLook(none).gobo.opacity).toBe(0);
    expect(asked).toHaveLength(0);
    expect(h.setPlate).not.toHaveBeenCalled();
    expect(f.platesSet()).toBe(true);
  });

  it("a plant changed while its plate loads: the first plate is never worn", async () => {
    const h = fakeHandle();
    const f = feed(h, REST);
    h.arrive();
    f.setLight({ ...REST, plant: "canopy" });
    expect(asked.map((a) => a.plant)).toEqual(["monstera", "canopy"]);
    const [monstera, canopy] = [bytes(), bytes()];
    asked[0]?.deliver(monstera);
    await settle();
    expect(h.setPlate).not.toHaveBeenCalled();
    expect(f.platesSet()).toBe(false);
    asked[1]?.deliver(canopy);
    await settle();
    expect(h.setPlate).toHaveBeenCalledTimes(1);
    expect(h.setPlate).toHaveBeenCalledWith("c", canopy);
    expect(f.platesSet()).toBe(true);
  });

  it("a plate that does not load leaves the desk without it, and the plant can be asked for again", async () => {
    const h = fakeHandle();
    const f = feed(h, REST);
    h.arrive();
    asked[0]?.fail(new Error("no plate"));
    await settle();
    expect(h.setPlate).not.toHaveBeenCalled();
    expect(f.platesSet()).toBe(false);
    // the next light the desk is handed asks for the plant once more
    f.setLight({ ...REST, mirror: true });
    expect(asked.map((a) => a.plant)).toEqual(["monstera", "monstera"]);
  });

  it("once disposed, a plate that arrives is not set", async () => {
    const h = fakeHandle();
    const f = feed(h, REST);
    h.arrive();
    f.dispose();
    asked[0]?.deliver(bytes());
    await settle();
    expect(h.setPlate).not.toHaveBeenCalled();
    f.setLight({ ...REST, softness: 2 });
    expect(h.configureMat).toHaveBeenCalledTimes(1);
  });
});
