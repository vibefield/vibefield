/**
 * PT-2, PT-3, PT-S2 — WHAT THE FIELD'S LAYER LENDS ITS KINDS (field/desk/desk-layer.ts): the desk's live pages under ICE's
 * `LIVE`, their navigation beside them under `BROWSER_NAVIGATION`, and — PT-S2 (R11) — this Mac's Simulator devices under
 * `SIMULATOR_DEVICES`, the phone's attach's read. Each is lent only where the stage hands it; a desk handed none lends no
 * service at all. ICE's `deskLayer` is watched: what the field asks of it is the row (pegboard-layer.test.ts's pattern).
 */
import type { CanvasEngine } from "@vibecook/ice";
import { type Lent, LIVE } from "@vibecook/ice/desk/kit";
import {
  BROWSER_NAVIGATION,
  type BrowserNavigation,
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

/** The services the field's last layer asked ICE to lend: each key's name, and what it lends. */
const lent = (): { name: string; value: unknown }[] | undefined =>
  (asked.at(-1) as { services?: readonly Lent[] }).services?.map((l) => ({
    name: l.key.name,
    value: l.value,
  }));

describe("the field's desk layer lends its kinds what the stage hands it", () => {
  it("PT-S2: the live pages, their navigation and this Mac's Simulator devices — each under its own key", async () => {
    const { fieldDeskLayer } = await import("../src/field/desk/desk-layer");
    fieldDeskLayer({ engine, theme: "light", live, devices });
    expect(lent()).toEqual([
      { name: LIVE.name, value: live },
      { name: BROWSER_NAVIGATION.name, value: navigation },
      { name: SIMULATOR_DEVICES.name, value: devices },
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
});
