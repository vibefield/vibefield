/**
 * PT-2, PT-3, PT-S2 — WHAT THE FIELD'S LAYER LENDS ITS KINDS (field/desk/desk-layer.ts): the desk's live pages under ICE's
 * `LIVE`, their navigation beside them under `BROWSER_NAVIGATION`, and — PT-S2 (R11) — this Mac's Simulator devices under
 * `SIMULATOR_DEVICES`, the phone's attach's read; and — track OM, OM-2 (2026-11-25) — the desk's hold under `DESK_HOLD`, a
 * kind's act picking one of the selected up (desk-hold.test.ts runs the hold itself). Each is lent only where the stage hands
 * it; a desk handed none lends no service at all. ICE's `deskLayer` is watched: what the field asks of it is the row
 * (pegboard-layer.test.ts's pattern).
 * IK (2026-11-25; ICE I59) — and its HAND: the desk's three faces baked, lent as `deskLayer({ hand })` (ICE lends them on as
 * `HAND_FACES`), every mount the page's one lender.
 */
import type { CanvasEngine } from "@vibecook/ice";
import { type HandFacesLender, PEN_FACES } from "@vibecook/ice/desk";
import { type Lent, LIVE } from "@vibecook/ice/desk/kit";
import {
  BROWSER_NAVIGATION,
  type BrowserNavigation,
  DESK_HOLD,
  type DeskHold,
  SIMULATOR_DEVICES,
  type SimulatorDevices,
} from "@vibefield/plugin-sdk/desk";
import { describe, expect, it, vi } from "vitest";

const asked: unknown[] = [];
vi.mock("@vibecook/ice/desk", async (original) => ({
  ...(await original<typeof import("@vibecook/ice/desk")>()),
  deskLayer: (opts: unknown) => {
    asked.push(opts);
    return () => ({});
  },
}));

const engine = { docs: {} } as unknown as CanvasEngine;
const navigation: BrowserNavigation = { navigate: () => false, respec: () => false };
const live = { open: () => ({}) as never, navigation };
const devices: SimulatorDevices = { attachable: () => undefined };
const deskHold: DeskHold = { pickUp: () => false };

/** The services the field's last layer asked ICE to lend: each key's name, and what it lends. */
const lent = (): { name: string; value: unknown }[] | undefined =>
  (asked.at(-1) as { services?: readonly Lent[] }).services?.map((l) => ({
    name: l.key.name,
    value: l.value,
  }));

describe("the field's desk layer lends its kinds what the stage hands it", () => {
  it("PT-S2, OM-2: the live pages, their navigation, this Mac's Simulator devices and the desk's hold — each under its own key", async () => {
    const { fieldDeskLayer } = await import("../src/field/desk/desk-layer");
    fieldDeskLayer({ engine, theme: "light", live, devices, deskHold });
    expect(lent()).toEqual([
      { name: LIVE.name, value: live },
      { name: BROWSER_NAVIGATION.name, value: navigation },
      { name: SIMULATOR_DEVICES.name, value: devices },
      { name: DESK_HOLD.name, value: deskHold },
    ]);
  });

  it("PT-S2: the devices alone are lent alone; with neither, the layer lends no service", async () => {
    const { fieldDeskLayer } = await import("../src/field/desk/desk-layer");
    fieldDeskLayer({ engine, theme: "light", devices });
    expect(lent()).toEqual([{ name: SIMULATOR_DEVICES.name, value: devices }]);
    fieldDeskLayer({ engine, theme: "light", live });
    expect(lent()?.map((l) => l.name)).toEqual([LIVE.name, BROWSER_NAVIGATION.name]);
    fieldDeskLayer({ engine, theme: "light" });
    expect(asked.at(-1)).not.toHaveProperty("services");
  });

  it("OM-2: the desk's hold alone is lent alone, and after the devices beside them", async () => {
    const { fieldDeskLayer } = await import("../src/field/desk/desk-layer");
    fieldDeskLayer({ engine, theme: "light", deskHold });
    expect(lent()).toEqual([{ name: DESK_HOLD.name, value: deskHold }]);
    fieldDeskLayer({ engine, theme: "light", devices, deskHold });
    expect(lent()?.map((l) => l.name)).toEqual([SIMULATOR_DEVICES.name, DESK_HOLD.name]);
  });

  it("IK: lends the desk's hand — the three baked faces by ICE's pen names, every mount the page's one lender", async () => {
    const { fieldDeskLayer } = await import("../src/field/desk/desk-layer");
    const { deskHand } = await import("../src/field/desk/desk-assets");
    fieldDeskLayer({ engine, theme: "light" });
    const hand = (asked.at(-1) as { hand?: HandFacesLender }).hand;
    expect(hand).toBe(deskHand());
    // lent, and none landed yet: each face the desk ships a file for is on its way. ICE's other two pen faces are the
    // platform's own (Marker Felt, Noteworthy: no file, so nothing to bake) and are not lent: their sheets keep the raster
    expect(Object.keys(PEN_FACES)).toEqual([
      "caveat",
      "caveat-bold",
      "kalam",
      "marker",
      "noteworthy",
    ]);
    const lent = Object.keys(PEN_FACES).filter((name) => hand?.loading(name) === true);
    expect(lent).toEqual(["caveat", "caveat-bold", "kalam"]);
    expect(hand?.loading("cursive")).toBe(false);
    // a remount lends the same faces: they load once a page
    fieldDeskLayer({ engine, theme: "dark", mount: 1 });
    expect((asked.at(-1) as { hand?: HandFacesLender }).hand).toBe(hand);
  });
});
