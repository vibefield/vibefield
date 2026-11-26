// @vitest-environment node
// Item 581 overturned (2026-11-24): THE PHONE'S AGENT HALF. Its manifest declares what an agent may do with a phone (place it
// and read what it is, no tool, no room), its binding carries the summary the kind harness asks of every kind that declares
// one, and the summary says the iPhone, its iOS, whether it is bound and whose device it shows, never a UDID. The kind
// contracts lets an agent place is this one, and the prop the desk door holds is the one this kind reads its device from.
import {
  AGENT_PLACEABLE_LIVE,
  OBJECT_LIMITS,
  SIMULATOR_BINDING_PROP,
  simulatorBindingOf,
  validatePluginManifest,
} from "@vibefield/contracts";
import { agentReadApi } from "@vibefield/plugin-sdk/desk";
import { runKindConformance } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import states from "../playground/states";
import {
  bindingOf,
  DEFAULT_PHONE,
  PROP,
  SIMULATOR_TYPE,
  simulator,
  simulatorManifest,
  simulatorSummary,
  UNBOUND,
} from "../src";

const row = simulatorManifest.contributes?.objects?.[0];
const IPHONE_17_PRO = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
const IOS_26_1 = "com.apple.CoreSimulator.SimRuntime.iOS-26-1";
const bound = { deviceType: IPHONE_17_PRO, runtime: IOS_26_1 };
const summaryOf = (props: Readonly<Record<string, unknown>>) =>
  simulatorSummary(agentReadApi(props));

describe("the phone's agent half (item 581 overturned, 2026-11-24)", () => {
  it("declares what an agent may do with a phone: place it and read what it is, with no tool, no room and no guide", () => {
    const agent = row?.agent;
    expect(agent).toBeDefined();
    expect(agent?.tools).toEqual([]);
    expect(agent?.concurrency).toBe("many");
    expect(agent?.faces).toEqual([{ type: "ref", id: "live", label: "Live" }]);
    expect(agent).not.toHaveProperty("room");
    expect(agent).not.toHaveProperty("guide");
    // its words are true: its own device, and nothing an agent can do to it yet
    expect(agent?.summary).toContain("on a device of its own, never one of the user's");
    expect(agent?.summary).toContain("you cannot tap, type into it or take its picture yet");
    expect(agent?.summary).toContain("waits for the user to choose an iPhone and an iOS version");
    const result = validatePluginManifest(simulatorManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
  });

  it("is the kind contracts lets an agent place, and keeps its device in the prop the desk door holds", () => {
    expect(AGENT_PLACEABLE_LIVE["ios-simulator"]).toEqual([SIMULATOR_TYPE]);
    expect(row?.type).toBe(SIMULATOR_TYPE);
    expect(PROP.binding).toBe(SIMULATOR_BINDING_PROP);
    // the door's reader and the kind's agree on every binding: "own" exactly where the kind binds its own device
    for (const value of [
      UNBOUND,
      bound,
      { ...bound, dedicated: true },
      { ...bound, dedicated: false },
      JSON.stringify({ ...bound, dedicated: true }),
      "{not json",
    ]) {
      const kind = bindingOf({ [PROP.binding]: value });
      const door = simulatorBindingOf(value);
      expect(door.device, JSON.stringify(value)).toBe(
        kind === undefined ? "none" : kind.dedicated === true ? "own" : "person",
      );
    }
  });

  it("says an unbound phone's model, and that it shows no device", () => {
    expect(summaryOf({})).toEqual({ model: DEFAULT_PHONE.name, bound: false, device: "none" });
    expect(summaryOf({ [PROP.binding]: UNBOUND })).toEqual({
      model: DEFAULT_PHONE.name,
      bound: false,
      device: "none",
    });
  });

  it("says a bound phone's iPhone and iOS, and whose device it shows: its own, or one of the user's", () => {
    expect(summaryOf({ [PROP.binding]: { ...bound, dedicated: true } })).toEqual({
      model: "iPhone 17 Pro",
      ios: "iOS 26.1",
      bound: true,
      device: "its own",
    });
    // the product's props hand the kind its cell's JSON
    expect(summaryOf({ [PROP.binding]: JSON.stringify({ ...bound, dedicated: true }) })).toEqual(
      summaryOf({ [PROP.binding]: { ...bound, dedicated: true } }),
    );
    // a binding written before setup gave each phone its own device
    expect(summaryOf({ [PROP.binding]: bound })).toMatchObject({
      bound: true,
      device: "the user's",
    });
  });

  it("never says a UDID or an instance, whatever rides along in its props", () => {
    const udid = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
    const said = JSON.stringify(
      summaryOf({ [PROP.binding]: { ...bound, dedicated: true, instance: udid, udid } }),
    );
    expect(said).not.toContain(udid);
    expect(said).not.toMatch(/udid|instance/i);
  });

  it("stays small: within what an object may say now, at the longest names its props hold", () => {
    const long = `com.apple.CoreSimulator.SimDeviceType.${"X".repeat(90)}`;
    const now = summaryOf({
      [PROP.model]: long,
      [PROP.binding]: {
        deviceType: long,
        runtime: `com.apple.CoreSimulator.SimRuntime.${"Y".repeat(90)}`,
      },
    });
    expect(new TextEncoder().encode(JSON.stringify(now)).byteLength).toBeLessThanOrEqual(
      OBJECT_LIMITS.NOW_BYTES,
    );
  });

  it("is driven by the kind harness over every playground state: its summary answers on each", async () => {
    if (row === undefined) throw new Error("the manifest declares no object");
    const fixtures = (states as Record<string, Record<string, Record<string, unknown>>>)[
      SIMULATOR_TYPE
    ];
    const r = await runKindConformance({ binding: simulator, row, states: fixtures });
    const refusals = r.verdicts.filter((v) => v.status === "refused").map((v) => v.code);
    expect(refusals).toEqual([]);
    const answered = r.verdicts.filter((v) =>
      v.detail.startsWith("its agent half answered its summary"),
    );
    expect(answered).toHaveLength(r.plan.fixtures.length);
  });
});
