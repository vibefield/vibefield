// PT-S2 — A BOUND SIMULATOR ON THE DESK'S LIVE SERVICE (surfaces/live/desk-live.ts's `openSimulator` lane; its pure words
// surfaces/live/simulator-face.ts), with the fixture's fakes (desk-live-fixture.ts):
//  - a spec that names a device opens its OWN lane: the gate asked for the source's scopes, the pool entry the face's key AND
//    its binding, paused with no viewport, minted by the BINDING (the ios-simulator-device source, the device's continuity
//    key — never a UDID); no input (view-only); the page verbs refuse it;
//  - main's facts said in the SDK's nine words (R2) through the kind's own reader (`liveSimulatorFace`): each condition by
//    name, `live` where its frames flow and `at-rest` where they do not; each state's ONE act (R4) — memoized, resolved by
//    the face's key when it runs, nothing once the words have moved, none while main runs one; a lost lane `stopped`, minted
//    again; a parked desk's words never move;
//  - it is a FACE of the pages' cap: it waits while the pages hold the slots, a page is rested for it in the hand, and a
//    device that stops gives its slot back;
//  - its still is filed under its BINDING (R15) — laid into a face reopened on the same device, never into one bound anew —
//    and never said (`extra.still`, R14);
//  - PT-S3 (D4): its row names the device main ATTACHED — name, type, runtime, each picked by name from main's facts.
import {
  LiveSurfaceDeviceVerbV1,
  LiveSurfaceIosSimulatorDeviceSourceV1,
  LiveSurfaceSimulatorConditionV1,
  SurfaceOpenParamsV1,
} from "@vibefield/contracts";
import { LIVE_SIMULATOR_STATES, liveSimulatorFace } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it, vi } from "vitest";
import {
  type DeskLiveDeps,
  type LiveFaceSource,
  type LiveGateAnswer,
  liveDemandIntent,
} from "../src/surfaces/live/desk-live";
import {
  SIMULATOR_ACTS,
  SIMULATOR_STATES,
  simulatorAddress,
  simulatorLiveState,
  simulatorReuseKey,
  simulatorSource,
  simulatorState,
} from "../src/surfaces/live/simulator-face";
import {
  DOC,
  fakePresentation,
  PAGE,
  PHONE_HELD,
  PHONE_REST,
  PHONE_UNSEEN,
  SEEN,
  SIM,
  SIM_OTHER,
  setup,
  simSays,
  stage,
} from "./desk-live-fixture";

const PHONE = "13918995204487956201-7";
/** Main's facts of a device streaming, its name as simctl says it. */
const STREAMING = { condition: "streaming", name: "iPhone 17 Pro" };
/** What a phone the cap makes wait (or a parked desk) is asked: paused as it was made — and no viewport, ever. */
const PHONE_PAUSED = { mode: "paused", targetFps: 0, priority: 0, interactive: false };
/** The gate answers by the key: the phone's plugin's type, else the pane's. */
const gate = (key: string): LiveGateAnswer => ({
  type: key === PHONE ? "vibefield.simulator" : "vibefield.browser-pane",
});

/** A phone's face opened on a fresh service, its lane attached live, main's facts said on its summary (null: none). */
function phone(
  over: Partial<DeskLiveDeps> = {},
  simulator: Record<string, unknown> | null = STREAMING,
) {
  const t = setup({ gate, ...over });
  const arrived = vi.fn();
  const face = t.live.open(PHONE, SIM, arrived);
  const handle = t.handles[0];
  if (handle === undefined) throw new Error("no handle");
  const presentation = fakePresentation();
  handle.set({ status: "live", presentation: presentation as never });
  simSays(presentation, handle, simulator);
  return { ...t, face, handle, presentation, arrived };
}

describe("PT-S2 — a bound Simulator in the service's words (simulator-face.ts)", () => {
  it("its source is its BINDING re-validated — the auto crop, never a UDID; its continuity key the DEVICE's, CoreSimulator's prefixes off; its stills filed under the binding", () => {
    expect(simulatorSource(SIM)).toEqual({
      kind: "ios-simulator-device",
      binding: { deviceType: SIM.deviceType, runtime: SIM.runtime },
      crop: { mode: "auto" },
    });
    expect(LiveSurfaceIosSimulatorDeviceSourceV1.safeParse(simulatorSource(SIM)).success).toBe(
      true,
    );
    // ids that are not CoreSimulator's open nothing (the SDK's reader held only their shape as words)
    expect(simulatorSource({ deviceType: "iPhone-17-Pro", runtime: SIM.runtime })).toBeUndefined();
    expect(simulatorSource({ deviceType: SIM.deviceType, runtime: "iOS 26.1" })).toBeUndefined();
    expect(simulatorReuseKey(SIM)).toBe("sim:iPhone-17-Pro:iOS-26-1");
    // a key past the wire's bound is none: the mint goes without one
    expect(
      simulatorReuseKey({
        deviceType: `com.apple.CoreSimulator.SimDeviceType.${"X".repeat(80)}`,
        runtime: `com.apple.CoreSimulator.SimRuntime.${"Y".repeat(60)}`,
      }),
    ).toBeUndefined();
    expect(simulatorAddress(SIM)).toBe(
      "ios-simulator:com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro/com.apple.CoreSimulator.SimRuntime.iOS-26-1",
    );
    expect(simulatorAddress(SIM_OTHER)).not.toBe(simulatorAddress(SIM));
  });

  it("R2: main's facts in the SDK's nine words — each condition its own by name; streaming is live where the frames flow, at rest where they do not, stopped where its producer failed under it", () => {
    expect(Object.keys(SIMULATOR_STATES).sort()).toEqual(
      [...LiveSurfaceSimulatorConditionV1.options].sort(),
    );
    for (const is of Object.values(SIMULATOR_STATES)) expect(LIVE_SIMULATOR_STATES).toContain(is);
    // every word the SDK names is said: by a condition, or by the renderer's own knowledge
    const said = new Set<string>([...Object.values(SIMULATOR_STATES), "at-rest"]);
    expect(LIVE_SIMULATOR_STATES.filter((is) => !said.has(is))).toEqual([]);
    expect(simulatorState("streaming", { failed: false, flowing: true })).toBe("live");
    expect(simulatorState("streaming", { failed: false, flowing: false })).toBe("at-rest");
    expect(simulatorState("streaming", { failed: true, flowing: true })).toBe("stopped");
    expect(simulatorState("off", { failed: false, flowing: true })).toBe("off");
    expect(simulatorState("no-window", { failed: false, flowing: false })).toBe("no-window");
  });

  it("R4: each state's ONE act is main's verb; the coarse state, for a kind that reads no words, holds the last frame at rest and offers the stop's act as its retry", () => {
    expect(SIMULATOR_ACTS).toEqual({
      "no-simulator": null,
      "no-permission": "open-settings",
      "no-device": "create",
      off: "boot",
      booting: null,
      "no-window": "show",
      live: null,
      "at-rest": null,
      stopped: "retry",
    });
    for (const verb of Object.values(SIMULATOR_ACTS))
      if (verb !== null) expect(LiveSurfaceDeviceVerbV1.safeParse(verb).success).toBe(true);
    const retry = vi.fn();
    expect(simulatorLiveState("live")).toEqual({ is: "live" });
    expect(simulatorLiveState("at-rest")).toEqual({ is: "paused" });
    expect(simulatorLiveState("off")).toEqual({ is: "paused" });
    expect(simulatorLiveState("no-window")).toEqual({ is: "paused" });
    expect(simulatorLiveState("booting")).toEqual({ is: "starting" });
    expect(simulatorLiveState("stopped", retry)).toEqual({
      is: "failed",
      reason: "stopped",
      retry,
    });
    expect(simulatorLiveState("stopped")).toEqual({ is: "failed", reason: "stopped" });
    expect(simulatorLiveState("no-device")).toEqual({ is: "failed", reason: "no-device" });
  });
});

describe("PT-S2 — a bound Simulator's lane on the desk's LIVE service", () => {
  it("opens on its OWN pool entry — the face's key AND its binding — paused with NO viewport until the kind's law has seen it", () => {
    const t = setup({ gate });
    t.live.open(PHONE, SIM, () => {});
    expect(t.handles[0]?.key).toBe(`desk:${PHONE}~${simulatorAddress(SIM)}`);
    expect(t.handles[0]?.opts.initialDemand).toEqual(PHONE_PAUSED);
  });

  it("mints the device by its BINDING on the window's client — the ios-simulator-device source, the auto crop, the device's continuity key — and never a UDID", async () => {
    const t = setup({ gate });
    t.live.open(PHONE, SIM, () => {});
    const grant = await t.handles[0]?.opts.tickets.mint();
    expect(grant?.surfaceId).toBe("surface_0123456789abcdef");
    expect(t.requests).toEqual([
      {
        method: "surface.open",
        params: {
          source: {
            kind: "ios-simulator-device",
            binding: { deviceType: SIM.deviceType, runtime: SIM.runtime },
            crop: { mode: "auto" },
          },
          reuseKey: "sim:iPhone-17-Pro:iOS-26-1",
        },
      },
    ]);
    expect(JSON.stringify(t.requests)).not.toContain("udid");
    // the wire's own open params read them
    expect(SurfaceOpenParamsV1.safeParse(t.requests[0]?.params).success).toBe(true);
    await t.handles[0]?.opts.tickets.close?.("surface_0123456789abcdef");
    expect(t.requests[1]).toEqual({
      method: "surface.close",
      params: { surfaceId: "surface_0123456789abcdef" },
    });
  });

  it("the gate is asked for the SOURCE's scopes (a page's when unsaid): a refusal is a failed face with the words, nothing acquired; no live surfaces in the window says `no-simulator`; a spec that names no device of this desk opens nothing", () => {
    const refusing = vi.fn(
      (_key: string, _source?: LiveFaceSource): LiveGateAnswer => ({
        refused: "FORBIDDEN_SCOPE: plugin vibefield.simulator is not granted surface.capture",
      }),
    );
    const t = setup({ gate: refusing });
    const face = t.live.open(PHONE, SIM, () => {});
    expect(refusing).toHaveBeenCalledWith(PHONE, "ios-simulator");
    expect(face.state()).toEqual({
      is: "failed",
      reason: "may-not: FORBIDDEN_SCOPE: plugin vibefield.simulator is not granted surface.capture",
    });
    expect(t.handles).toHaveLength(0);
    expect(t.live.faces()[0]).toMatchObject({
      key: PHONE,
      source: "ios-simulator",
      simulator: {
        is: null,
        act: null,
        condition: null,
        acting: null,
        degraded: false,
        name: null,
        deviceType: null,
        runtime: null,
      },
      acts: 0,
    });
    t.live.open("k-page", PAGE, () => {});
    expect(refusing).toHaveBeenLastCalledWith("k-page");
    // a window with no live surfaces: the kind's own reader says no Simulator here
    const none = setup({ gate, pool: () => null });
    const away = none.live.open(PHONE, SIM, () => {});
    expect(away.state()).toEqual({
      is: "failed",
      reason: "may-not: live surfaces are unavailable in this window",
    });
    expect(liveSimulatorFace(away.info())).toEqual({ is: "no-simulator" });
    away.close();
    expect(away.info()).toEqual({});
    // ids that are not CoreSimulator's, or a spec the SDK does not read as a device: refused, never parsed as a page
    const odd = setup({ gate });
    const bad = odd.live.open(PHONE, { ...SIM, deviceType: "iPhone-17-Pro" }, () => {});
    expect(bad.state()).toEqual({
      is: "failed",
      reason: "may-not: not a device this desk can open",
    });
    const half = odd.live.open("k-half", { source: "ios-simulator", label: "x" }, () => {});
    expect(half.state()).toEqual({
      is: "failed",
      reason: "may-not: not a device this desk can open",
    });
    expect(odd.handles).toHaveLength(0);
    expect(odd.live.faces().map((f) => f.source)).toEqual(["ios-simulator", "ios-simulator"]);
  });

  it("is VIEW-ONLY: its face takes no input (ICE: absent)", () => {
    const { face } = phone();
    expect(face.input).toBeUndefined();
    expect("input" in face).toBe(false);
  });

  it("the phone's law in the pool's words: in the hand 60 at its native raster, urgent; at rest 12 — bucketed to 10 — at priority 50; unseen paused; never a viewport", () => {
    const { face, handle } = phone();
    face.demand(PHONE_HELD);
    expect(handle.demands.at(-1)).toEqual({
      mode: "live",
      targetFps: 60,
      targetRasterSize: { width: 1206, height: 2622 },
      priority: 80,
      interactive: true,
    });
    face.demand(PHONE_REST);
    expect(handle.demands.at(-1)).toEqual({
      mode: "live",
      targetFps: 10,
      targetRasterSize: { width: 603, height: 1311 },
      priority: 50,
      interactive: false,
    });
    face.demand(PHONE_UNSEEN);
    expect(handle.demands.at(-1)).toEqual(PHONE_PAUSED);
  });

  it("R2: says each of main's conditions as the SDK's word, the device's name with it — read by the kind's own reader — each move an arrival; streaming is `live` where its frames flow; a crop fallen back (R6) is still `live`, a fact on the row", () => {
    const { face, handle, presentation, arrived, live } = phone({}, null);
    // nothing said yet (no facts): no words, the coarse state starting
    expect(liveSimulatorFace(face.info())).toBeUndefined();
    expect(face.state()).toEqual({ is: "starting" });
    face.demand(PHONE_REST);
    const rows = [
      ["no-simulator", "failed"],
      ["no-permission", "failed"],
      ["no-device", "failed"],
      ["off", "paused"],
      ["booting", "starting"],
      ["no-window", "paused"],
      ["stopped", "failed"],
    ] as const;
    for (const [condition, coarse] of rows) {
      const before = arrived.mock.calls.length;
      simSays(presentation, handle, { condition, name: "iPhone 17 Pro" });
      expect(arrived).toHaveBeenCalledTimes(before + 1);
      const said = liveSimulatorFace(face.info());
      expect(said?.is).toBe(condition);
      expect(said?.device).toBe("iPhone 17 Pro");
      // its act exactly where the state has one
      expect(said?.act === undefined).toBe(SIMULATOR_ACTS[condition] === null);
      expect(face.state().is).toBe(coarse);
      // a device that cannot stream holds no slot — yet its wire carries the kind's own ask: main withholds it there, and
      // looks for the window (or restarts the stream) only under a live one
      expect(handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_REST));
      expect(live.faces()[0]?.alive).toBe(false);
    }
    // streaming again and seen: woken into a free slot, its frames flowing — `live`
    simSays(presentation, handle, STREAMING);
    expect(liveSimulatorFace(face.info())).toEqual({ is: "live", device: "iPhone 17 Pro" });
    expect(face.state()).toEqual({ is: "live" });
    expect(handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_REST));
    // the crop fell back to the whole window: still live — the fact is the row's
    simSays(presentation, handle, { ...STREAMING, degraded: true });
    expect(liveSimulatorFace(face.info())?.is).toBe("live");
    expect(face.info().degraded).toBeUndefined();
    expect(live.faces()[0]?.simulator).toEqual({
      is: "live",
      act: null,
      condition: "streaming",
      acting: null,
      degraded: true,
      name: "iPhone 17 Pro",
      deviceType: null,
      runtime: null,
    });
    // off view: at rest (the last frame as a still)
    face.demand(PHONE_UNSEEN);
    expect(liveSimulatorFace(face.info())?.is).toBe("at-rest");
    expect(face.state()).toEqual({ is: "paused" });
  });

  it("R4: each state's ONE act runs main's verb down its own lane — memoized (the words do not churn), resolved by the face's key when it RUNS: a press on words that moved, or on a closed face, is nothing; none is offered while main runs one; a stopped face's is Try again", () => {
    const { face, handle, presentation, live } = phone(
      {},
      { condition: "off", name: "iPhone 17 Pro" },
    );
    const off = liveSimulatorFace(face.info());
    expect(off?.is).toBe("off");
    expect(off?.act).toBeTypeOf("function");
    expect(liveSimulatorFace(face.info())?.act).toBe(off?.act);
    off?.act?.();
    expect(handle.devices).toEqual([{ verb: "boot" }]);
    expect(live.stats().acts).toBe(1);
    // main runs it — the device still off: no act offered meanwhile (the row says which runs), and a press is nothing
    simSays(presentation, handle, { condition: "off", acting: "boot", name: "iPhone 17 Pro" });
    expect(liveSimulatorFace(face.info())).toEqual({ is: "off", device: "iPhone 17 Pro" });
    expect(live.faces()[0]?.simulator).toEqual({
      is: "off",
      act: null,
      condition: "off",
      acting: "boot",
      degraded: false,
      name: "iPhone 17 Pro",
      deviceType: null,
      runtime: null,
    });
    off?.act?.();
    expect(handle.devices).toHaveLength(1);
    // booting: the press on the words that moved is nothing
    simSays(presentation, handle, { condition: "booting", name: "iPhone 17 Pro" });
    expect(liveSimulatorFace(face.info())).toEqual({ is: "booting", device: "iPhone 17 Pro" });
    off?.act?.();
    expect(handle.devices).toHaveLength(1);
    expect(live.stats().acts).toBe(1);
    // the window went mid-stream: Try again, in its words and as the coarse state's retry
    simSays(presentation, handle, { condition: "stopped", name: "iPhone 17 Pro" });
    const stopped = liveSimulatorFace(face.info());
    expect(stopped?.is).toBe("stopped");
    expect(stopped?.act).toBeTypeOf("function");
    expect(face.state()).toMatchObject({ is: "failed", reason: "stopped" });
    expect(live.faces()[0]?.simulator?.act).toBe("retry");
    stopped?.act?.();
    expect(handle.devices.at(-1)).toEqual({ verb: "retry" });
    expect(live.faces()[0]?.acts).toBe(2);
    // a closed face's act is nothing
    face.close();
    stopped?.act?.();
    expect(handle.devices).toHaveLength(2);
    expect(live.stats().acts).toBe(2);
  });

  it("a device MAIN HOLDS (it cannot stream) holds no slot, yet its wire carries the kind's own ask — main looks for the window only under a live one, so Show it comes back; unseen, or on a parked desk, paused", () => {
    const { face, handle, presentation, live } = phone();
    face.demand(PHONE_REST);
    expect(handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_REST));
    simSays(presentation, handle, { condition: "no-window", name: "iPhone 17 Pro" });
    expect(handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_REST));
    expect(live.faces()[0]).toMatchObject({ alive: false, simulator: { is: "no-window" } });
    liveSimulatorFace(face.info())?.act?.();
    expect(handle.devices).toEqual([{ verb: "show" }]);
    expect(handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_REST));
    // picked up: the hand's ask goes down at once; unseen: nothing to look for
    face.demand(PHONE_HELD);
    expect(handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_HELD));
    face.demand(PHONE_UNSEEN);
    expect(handle.demands.at(-1)).toEqual(PHONE_PAUSED);
    face.demand(PHONE_REST);
    expect(handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_REST));
    live.park(true);
    expect(handle.demands.at(-1)).toEqual(PHONE_PAUSED);
    live.park(false);
    expect(handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_REST));
    // main found the window under it: streaming, and the plan wakes it into its free slot
    simSays(presentation, handle, STREAMING);
    expect(liveSimulatorFace(face.info())?.is).toBe("live");
    expect(live.faces()[0]).toMatchObject({ alive: true, simulator: { is: "live" } });
    expect(handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_REST));
  });

  it("a lane LOST is `stopped` — its act mints the lane again (the pool's retry), no device verb", () => {
    const { face, handle } = phone();
    handle.set({ status: "lost", presentation: null, error: new Error("transport closed") });
    const said = liveSimulatorFace(face.info());
    expect(said?.is).toBe("stopped");
    expect(face.state()).toMatchObject({ is: "failed", reason: "stopped" });
    said?.act?.();
    expect(handle.retried).toBe(1);
    expect(handle.devices).toEqual([]);
  });

  it("a PARKED desk pauses the phone and its words do not move (they would wake the desk); running again, it is asked its last ask", () => {
    const { face, handle, live, arrived } = phone();
    face.demand(PHONE_REST);
    expect(liveSimulatorFace(face.info())?.is).toBe("live");
    const told = arrived.mock.calls.length;
    live.park(true);
    expect(handle.demands.at(-1)).toEqual(PHONE_PAUSED);
    expect(arrived).toHaveBeenCalledTimes(told);
    expect(liveSimulatorFace(face.info())?.is).toBe("live");
    live.park(false);
    expect(handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_REST));
  });

  it("a face's ROW is what a smoke reads: its source, its words and main's facts by name, its acts — no emulation, no favicon, no input", () => {
    const { face, presentation, live } = phone();
    face.demand(PHONE_HELD);
    presentation.land();
    expect(face.take()).toBe(true);
    expect(live.faces()).toEqual([
      {
        key: PHONE,
        source: "ios-simulator",
        demand: PHONE_HELD,
        wire: null,
        surface: null,
        state: { is: "live" },
        info: {},
        favicon: null,
        label: "iPhone 17 Pro",
        emulation: null,
        arrivals: 1,
        presented: 1,
        dropped: 0,
        inputs: 0,
        lastInput: null,
        texture: { width: 2560, height: 1600, revision: 1, epoch: 0, bytes: 0 },
        veiled: false,
        refused: 0,
        current: true,
        faviconBytes: 0,
        alive: true,
        rested: false,
        still: null,
        stillAt: null,
        simulator: {
          is: "live",
          act: null,
          condition: "streaming",
          acting: null,
          degraded: false,
          name: "iPhone 17 Pro",
          deviceType: null,
          runtime: null,
        },
        acts: 0,
      },
    ]);
    expect(live.stats()).toMatchObject({ opened: 1, open: 1, presented: 1, acts: 0, alive: 1 });
  });

  it("PT-S3 (D4): the row names the device main ATTACHED — its name, its type and its runtime (R3: not the binding's where this Mac lacks it), each null while main has not said it; picked by name, so nothing else main's facts carry reaches a smoke", () => {
    const { presentation, handle, live } = phone({}, null);
    const row = () => live.faces()[0]?.simulator;
    // nothing said yet: no device named
    expect(row()).toMatchObject({ name: null, deviceType: null, runtime: null });
    // no device of the type on this Mac: its type's name, nothing attached
    simSays(presentation, handle, { condition: "no-device", name: "iPhone 17 Pro" });
    expect(row()).toMatchObject({
      is: "no-device",
      act: "create",
      name: "iPhone 17 Pro",
      deviceType: null,
      runtime: null,
    });
    // attached — on another runtime than the bound one: the row says what main attached, under the device's own name
    const udid = "1BD54690-0A1B-4C2D-8E3F-0123456789AB";
    simSays(presentation, handle, {
      condition: "off",
      name: "pts3-a1b2-1",
      deviceType: SIM.deviceType,
      runtime: SIM_OTHER.runtime,
      // a key the contract's passthrough would carry: never the row's
      stray: udid,
    });
    expect(row()).toEqual({
      is: "off",
      act: "boot",
      condition: "off",
      acting: null,
      degraded: false,
      name: "pts3-a1b2-1",
      deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-6",
    });
    expect(JSON.stringify(live.faces())).not.toContain(udid);
    // main says the device no more: none named again
    simSays(presentation, handle, { condition: "no-simulator" });
    expect(row()).toMatchObject({
      is: "no-simulator",
      name: null,
      deviceType: null,
      runtime: null,
    });
  });

  it("the page verbs REFUSE a device — a navigation (counted) and a re-spec; it is called by the device's name as main says it", () => {
    const { live, handle, presentation } = phone();
    expect(live.navigation.navigate(PHONE, { action: "reload" })).toBe(false);
    expect(handle.navigations).toEqual([]);
    expect(live.stats()).toMatchObject({ navigations: 0, navigationsRefused: 1 });
    expect(live.navigation.respec(PHONE, PAGE)).toBe(false);
    expect(live.navigation.respec(PHONE, SIM)).toBe(false);
    expect(live.stats().respecs).toBe(0);
    expect(live.label(PHONE)).toBe("iPhone 17 Pro");
    simSays(presentation, handle, { ...STREAMING, name: "Desk Phone" });
    expect(live.label(PHONE)).toBe("Desk Phone");
  });
});

describe("PT-S2 — a bound Simulator shares the pages' cap and their stills", () => {
  /** How far each face lies from the view's centre: the page `a` farther than `b`. */
  const FAR: Record<string, number> = { a: 2, b: 1, [PHONE]: 3 };
  const far = (key: string): number => FAR[key] ?? Number.POSITIVE_INFINITY;

  /** Two pages seen and alive under a cap of two; a phone on the desk, nothing made of it yet, its device streaming. */
  async function crowded() {
    const s = stage({ gate, far });
    s.live.cap(2);
    const a = s.open("a", true, "created");
    const b = s.open("b", true, "created");
    const p = s.open(PHONE, true, "created", SIM);
    p.sim(STREAMING);
    for (const pane of [a, b]) {
      s.clock.advance(100);
      pane.face.demand(SEEN);
    }
    await s.pump();
    return { s, a, b, p };
  }

  it("seen while two pages hold the two slots it WAITS — paused, saying at-rest, counted not alive; picked up, it comes alive AT ONCE and the page farthest out is put to rest for it", async () => {
    const { s, a, b, p } = await crowded();
    expect(a.wire()).toBe("live");
    expect(b.wire()).toBe("live");
    p.face.demand(PHONE_REST);
    await s.pump();
    expect(p.handle.demands.at(-1)).toEqual(PHONE_PAUSED);
    expect(liveSimulatorFace(p.face.info())).toEqual({ is: "at-rest", device: "iPhone 17 Pro" });
    expect(s.live.faces().find((f) => f.key === PHONE)).toMatchObject({
      source: "ios-simulator",
      alive: false,
      rested: false,
    });
    p.face.demand(PHONE_HELD);
    // at once: the phone asked live at its native rate, its words live
    expect(p.handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_HELD));
    expect(liveSimulatorFace(p.face.info())?.is).toBe("live");
    await s.pump();
    expect(a.wire()).toBe("hibernated");
    expect(b.wire()).toBe("live");
    expect(s.live.stats()).toMatchObject({ cap: 2, alive: 2, rests: 1 });
  });

  it("a device that STOPS streaming gives its slot back at once (the page rested for it is woken) and says so with its act; streaming again in the hand, the plan wakes it", async () => {
    const { s, a, p } = await crowded();
    p.face.demand(PHONE_HELD);
    await s.pump();
    expect(a.wire()).toBe("hibernated");
    p.sim({ condition: "no-window", name: "iPhone 17 Pro" });
    // no slot held — but the kind's own ask stays on its wire: main withholds the device, and looks for its window under it
    expect(p.wire()).toBe("live");
    expect(s.live.faces().find((f) => f.key === PHONE)?.alive).toBe(false);
    const said = liveSimulatorFace(p.face.info());
    expect(said).toMatchObject({ is: "no-window", device: "iPhone 17 Pro" });
    said?.act?.();
    expect(p.handle.devices).toEqual([{ verb: "show" }]);
    await s.pump();
    expect(a.wire()).toBe("live");
    // Show it ran: the live ask main looks for the window under is still the kind's
    expect(p.handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_HELD));
    p.sim(STREAMING);
    await s.pump();
    expect(p.handle.demands.at(-1)).toEqual(liveDemandIntent(PHONE_HELD));
    expect(liveSimulatorFace(p.face.info())?.is).toBe("live");
    expect(s.live.stats()).toMatchObject({ acts: 1, alive: 2 });
  });

  it("R15, R14: its still is filed under its BINDING — taken at the put-down, laid into a face reopened on the same device, never into one bound anew (another pool entry); and never said (`extra.still`)", async () => {
    const s = stage({ gate });
    const p = s.open(PHONE, true, "live", SIM);
    p.sim(STREAMING);
    p.face.demand(PHONE_HELD);
    expect(p.frame()).toBe(true);
    // put down: the best pixels it will have are taken, filed under its binding
    p.face.demand(PHONE_REST);
    await s.live.settled();
    expect(s.shelf.shelf.get(`${DOC}/${PHONE}`)).toMatchObject({
      address: simulatorAddress(SIM),
      takenAt: s.clock.now(),
    });
    expect(s.live.stats().stillsTaken).toBe(1);
    expect(p.face.info().extra).not.toHaveProperty("still");
    // reopened on the SAME device: its still is laid before its first frame — at rest, and never said
    p.face.close();
    const again = s.open(PHONE, true, "live", SIM);
    await s.live.settled();
    expect(again.handle.key).toBe(p.handle.key);
    expect(again.face.texture()).toBeDefined();
    expect(s.live.faces().find((f) => f.key === PHONE)).toMatchObject({
      still: s.clock.now(),
      simulator: { is: "at-rest" },
    });
    expect(again.face.info().extra).not.toHaveProperty("still");
    expect(s.live.stats().stillsShown).toBe(1);
    // bound anew: another pool entry — the device it left is let go, never re-held — and no picture of the other device
    again.face.close();
    const other = s.open(PHONE, true, "live", SIM_OTHER);
    await s.live.settled();
    expect(other.handle.key).toBe(`desk:${PHONE}~${simulatorAddress(SIM_OTHER)}`);
    expect(other.face.texture()).toBeUndefined();
    expect(s.live.faces().find((f) => f.key === PHONE)).toMatchObject({ still: null });
    expect(s.live.stats().stillsShown).toBe(1);
    expect(s.shelf.decodeStill).toHaveBeenCalledTimes(1);
  });
});
