import {
  DEFAULT_GRID,
  type Entity,
  lampOf,
  type ObjectContext,
  rgb,
} from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import states from "../playground/states";
import { DEFAULT_COLOR, KIND_NAME, kind } from "../src/kind";
import type { DiscGeometry, DiscRecord } from "../src/record";
import { shaders } from "../src/shaders";

// THE KIND'S STILL TEST — stubbed to its SHAPE until DK-7 lands. DK-7's kind-conformance harness (the
// playground v2) drives a kind through `resolve` → `record` → `hit` over the states in
// playground/states.ts with no device, and holds a Dawn still of it to this plugin's golden. Until that
// harness ships, this file runs the same states through the same three calls by hand (one fake
// `ObjectContext` per state, no GPU), and the still itself is the `todo` at the bottom.

/** One object's context, as the desk's builder hands it each frame: a rect, its props, its flux. */
function ctxOf(props: Record<string, unknown>, extra: Partial<ObjectContext> = {}): ObjectContext {
  return {
    entity: 1 as Entity,
    rect: { cx: 100, cy: 80, w: 120, h: 120 },
    props,
    flux: { lift: 0, hover: 0, ring: 0, fade: 1 },
    look: undefined,
    theme: {} as never,
    lamp: lampOf(DEFAULT_GRID.mat.plane),
    view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 },
    grid: DEFAULT_GRID,
    dt: 0,
    ...extra,
  };
}

describe("{{title}}'s kind, over its playground states (the shape DK-7's harness drives)", () => {
  const k = kind();
  const table = (states as Record<string, Record<string, Record<string, unknown>>>)[KIND_NAME] ?? {};

  it("is named by its type and has a state to draw", () => {
    expect(k.name).toBe("{{widgetType}}");
    expect(Object.keys(table).length).toBeGreaterThan(0);
  });

  for (const [name, props] of Object.entries(table)) {
    it(`state "${name}": resolves where it lies, records its colour, and is picked by its round face`, () => {
      const c = ctxOf(props);
      const G = k.resolve(c) as DiscGeometry;
      expect(G).toEqual({ cx: 100, cy: 80, r: 60, alpha: 1 });
      const R = k.record(G, c) as DiscRecord;
      expect(R.colour).toEqual(rgb(typeof props["color"] === "string" ? props["color"] : DEFAULT_COLOR));
      expect(k.hit(G, 100, 80)).toBe("content");
      expect(k.hit(G, 100 + 59, 80)).toBe("content");
      expect(k.hit(G, 100 + 50, 80 + 50)).toBeNull(); // in the rect, off the disc
    });
  }

  it("held, it is a little bigger; going, it fades", () => {
    const held = k.resolve(ctxOf({}, { flux: { lift: 1, hover: 0, ring: 0, fade: 1 } })) as DiscGeometry;
    expect(held.r).toBeGreaterThan(60);
    const going = k.resolve(ctxOf({}, { flux: { lift: 0, hover: 0, ring: 0, fade: 0.25 } })) as DiscGeometry;
    expect(going.alpha).toBe(0.25);
  });

  it("its program carries its own WGSL as TEXT, after the kit's pieces it names", () => {
    const program = shaders();
    expect(program.entry?.text).toContain("@fragment");
    expect(program.entry?.text).toContain("portal_cover");
  });

  it.todo("its STILL — a Dawn frame of each state held to this plugin's golden (DK-7's harness)");
});
