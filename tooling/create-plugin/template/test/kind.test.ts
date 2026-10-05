import {
  DEFAULT_GRID,
  type Entity,
  lampOf,
  type ObjectContext,
} from "@vibefield/plugin-sdk/desk";
import { runKindConformance } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import states from "../playground/states";
import { kind } from "../src/kind";
import { manifest } from "../src/manifest";
import type { DiscGeometry } from "../src/record";
import { {{className}} } from "../src/renderer";

// THE KIND'S TEST — the SDK's KIND-CONFORMANCE HARNESS (`@vibefield/plugin-sdk/testing`), the one
// `plugin-playground` and `vibefield-plugin check` run, with no GPU and no DOM: your object's code half (the
// export the manifest's `binding.kind` names) against its durable half (the manifest row) — its
// declaration, its program (`create` on a recording device: its WGSL arrives as text and READS — its
// entry points, the bindings each stage uses laid in its layout — never compiled), every state in
// playground/states.ts (props validated first) in every mode the kind declares (idle, selected, held;
// open when it opens; contained when it provides `desk.containable`) at every zoom the desk's LOD
// names, through resolve → record → hit (it must hit its own box) → prepare → drawRange, and its
// dispose. Each refusal says what failed, where, and what would pass.

describe("{{title}}'s kind, judged by the kind-conformance harness", () => {
  const row = manifest.contributes?.objects?.[0];

  it("passes: its declaration, its program, every playground state in every mode and zoom, its dispose", async () => {
    if (row === undefined) throw new Error("the manifest declares no object");
    const report = await runKindConformance({
      binding: {{className}},
      row,
      at: "/contributes/objects/0",
      states: (states as Record<string, Record<string, Record<string, unknown>>>)[row.type],
    });
    expect(report.verdicts.filter((v) => v.status === "refused")).toEqual([]);
    // the three playground states, each driven in idle, selected and held at every zoom, and once by night
    expect(report.plan.fixtures).toEqual(["default", "coral", "unparsed"]);
    expect(report.states).toBe(3 * (3 * report.plan.zooms.length + 1));
  });

  // What the harness cannot know is YOURS to pin: here, that a disc is picked by its round face.
  it("is picked by its round face: inside the disc is the object, the corner of its rect is not", () => {
    const ctx = {
      entity: 1 as Entity,
      rect: { cx: 100, cy: 80, w: 120, h: 120 },
      props: {},
      flux: { lift: 0, hover: 0, ring: 0, fade: 1 },
      look: undefined,
      theme: {} as never,
      lamp: lampOf(DEFAULT_GRID.mat.plane),
      view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 },
      grid: DEFAULT_GRID,
      dt: 0,
    } as ObjectContext;
    const k = kind();
    const G = k.resolve(ctx) as DiscGeometry;
    expect(k.hit(G, 100 + 59, 80)).toBe("content");
    expect(k.hit(G, 100 + 50, 80 + 50)).toBeNull(); // in the rect, off the disc
  });

  // The STILL — a Dawn frame of each state on a bare mat, held to this plugin's golden — needs a headless GPU
  // still the kit does not carry yet (ICE's createStill, I30). Until it does the harness READS your WGSL and never
  // compiles it: `vibefield-plugin try <dir>` compiles and draws it in the app.
  it.todo("its STILL — a Dawn frame of each state held to this plugin's golden (when the kit carries a headless still, I30)");
});
