// @vitest-environment node
// THE FAULT FIXTURE (ICE petition I24, ported at DK-7) breaks exactly as it says — and it is the SDK's
// KIND-CONFORMANCE HARNESS's negative fixture, beside the clock that passes it:
//  - the clock itself passes: its declaration, its program (READ), every declared state, its dispose;
//  - the FAULTY clock is refused by the states it breaks — its record from the third call
//    (`state-spawn-failed`) and its hit on every pick (`state-hit-missed`);
//  - the BROKEN clock's WGSL names what nothing declares, which only a compiler refuses: the harness READS
//    it, finds its entry points and bindings in order, and passes it — with the note that names that gap
//    (`object-wgsl-not-compiled`, the still that would compile it waits on ICE's ask I30). Its refusal at
//    create is ICE's, on the host: packages/field-app/test/desk-clock-faults.test.ts.
import { compose } from "@vibefield/plugin-sdk/desk";
import {
  holdGpuConstants,
  type KindReport,
  recordingGpu,
  runKindConformance,
} from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  BROKEN_CLOCK_ROWS,
  BROKEN_CLOCK_TYPE,
  BROKEN_WGSL_TOKEN,
  brokenClockKind,
  brokenClockShaders,
  CLOCK_TYPE,
  clock,
  clockBroken,
  clockFaulty,
  clockShaders,
  deskClockManifest,
  FAULTY_CLOCK_TYPE,
} from "../src";

const [BROKEN_ROW, FAULTY_ROW] = BROKEN_CLOCK_ROWS;
const CLOCK_ROW = deskClockManifest.contributes?.objects?.[0];
const refusals = (r: KindReport) =>
  r.verdicts.filter((v) => v.status === "refused").map((v) => v.code);

describe("the kind-conformance harness over the clock and its fault fixture (DK-7)", () => {
  it("PASSES the clock — 106 states: idle, selected, held, open, contained × 21 zooms, and once by night", async () => {
    if (CLOCK_ROW === undefined) throw new Error("the clock's manifest declares no object");
    const r = await runKindConformance({
      binding: clock,
      row: CLOCK_ROW,
      at: "/contributes/objects/0",
    });
    expect(refusals(r)).toEqual([]);
    expect(r.plan.modes).toEqual(["idle", "selected", "held", "open", "contained"]);
    expect(r.states).toBe(5 * 21 + 1);
    expect(r.verdicts.map((v) => v.code)).toEqual(["ok", "ok", "object-wgsl-not-compiled", "ok"]);
  });

  it("REFUSES the faulty clock by the states it breaks: its record from the third call, its hit on every pick", async () => {
    const r = await runKindConformance({ binding: clockFaulty, row: FAULTY_ROW as never });
    expect(refusals(r)).toEqual(["state-hit-missed", "state-spawn-failed"]);
    const said = (code: string) => r.verdicts.find((v) => v.code === code)?.detail ?? "";
    expect(said("state-hit-missed")).toContain(
      `its hit threw: ${FAULTY_CLOCK_TYPE}: its hit throws on purpose`,
    );
    // its first two states draw (and their picks throw); from the third every record throws
    expect(said("state-spawn-failed")).toMatch(
      new RegExp(
        `^default/idle@[^:]+: its record threw: ${FAULTY_CLOCK_TYPE.replaceAll(".", "\\.")}: its record throws on purpose \\(call 3\\) \\(and at ${r.states - 3} more`,
      ),
    );
  });

  it("PASSES the broken clock's READ — its WGSL is text, its entries and bindings in order — and NAMES the gap: nothing here compiles it", async () => {
    const r = await runKindConformance({ binding: clockBroken, row: BROKEN_ROW as never });
    expect(refusals(r)).toEqual([]);
    expect(r.verdicts.find((v) => v.code === "object-wgsl-not-compiled")?.detail).toContain(
      "an unresolved name or a type error passes here",
    );
    // the recording device was HANDED the token, and could not know nothing declares it
    const gpu = recordingGpu();
    const release = holdGpuConstants(); // the WebGPU constants Node lacks, for the create's own run
    await clockBroken.kind.create(
      gpu.device as never,
      "bgra8unorm" as never,
      {
        view: {},
        silhouette: {},
        noiseTexture: { createView: () => ({}) },
        glyphTexture: { createView: () => ({}) },
        assetVersion: 0,
      } as never,
    );
    release();
    expect(gpu.modules.map((m) => String(m.code).includes(BROKEN_WGSL_TOKEN))).toEqual([true]);
  });
});

describe("the fault fixture breaks exactly as it says (ICE's broken.test, through the SDK's door)", () => {
  it("its WGSL is the clock's with ONE function more, naming what nothing declares", () => {
    const whole = compose(clockShaders()).code;
    const broken = compose(brokenClockShaders()).code;
    expect(whole.includes(BROKEN_WGSL_TOKEN)).toBe(false);
    expect(broken).toContain(`fn desk_clock_broken() -> f32 { return ${BROKEN_WGSL_TOKEN}; }`);
    expect(broken.replace(/\/\/ ---- desk-clock\/broken\.wgsl\n[^\n]*\n\n/, "")).toBe(whole);
  });

  it("its record throws from the call it says — and not before — and its hit on every pick", () => {
    const kind = brokenClockKind({ name: "faulty", recordFrom: 3, hit: true });
    const ctx = {
      entity: 1,
      rect: { cx: 100, cy: 80, w: 150, h: 150 },
      props: { zone: "+00:00" },
      flux: { lift: 0, hover: 0, ring: 0, fade: 1 },
      look: undefined,
      theme: {},
      lamp: { dir: [0, 0, 1], height: 1 },
      view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 },
      grid: {},
      dt: 0,
    } as never;
    const G = kind.resolve(ctx);
    expect(() => kind.record(G, ctx)).not.toThrow();
    expect(() => kind.record(G, ctx)).not.toThrow();
    expect(() => kind.record(G, ctx)).toThrow("faulty: its record throws on purpose (call 3)");
    expect(() => kind.hit(G, 100, 80)).toThrow("faulty: its hit throws on purpose");
    expect(brokenClockKind({ name: "whole" }).hit(G, 100, 80)).toBe("content");
  });

  it("each is an object of its own beside the clock — its own type, a kind named by it, the clock's props, never opened, never on the tray", () => {
    expect([clockBroken.kind.name, clockFaulty.kind.name]).toEqual([
      BROKEN_CLOCK_TYPE,
      FAULTY_CLOCK_TYPE,
    ]);
    expect(BROKEN_CLOCK_ROWS.map((r) => [r.type, r.binding.kind])).toEqual([
      [BROKEN_CLOCK_TYPE, "clockBroken"],
      [FAULTY_CLOCK_TYPE, "clockFaulty"],
    ]);
    for (const row of BROKEN_CLOCK_ROWS) {
      expect(row.tray).toBeUndefined();
      expect(row.props).toEqual(CLOCK_ROW?.props);
      expect(row.size).toEqual(CLOCK_ROW?.size);
    }
    expect(clockBroken.kind.open).toBeUndefined();
    expect(clockFaulty.kind.open).toBeUndefined();
    // and never in the clock's own manifest: a first board never carries a fault
    expect((deskClockManifest.contributes?.objects ?? []).map((o) => o.type)).toEqual([CLOCK_TYPE]);
  });
});
