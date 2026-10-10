// THE OBJECT DOOR (DK-6; ICE design-016 K-L1/K-L2/K-L4): `@vibefield/plugin-sdk/desk` hands a plugin
// kind everything ICE's six built-ins are written against — from the umbrella's PUBLISHED entries and
// nowhere else, never the built-ins' own entry — and nothing of the host's half.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as iceRoot from "@vibecook/ice";
import * as iceDesk from "@vibecook/ice/desk";
import * as iceEngine from "@vibecook/ice/desk/engine";
import * as iceKit from "@vibecook/ice/desk/kit";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ObjectBinding, ObjectContext, ObjectHit, ObjectKind } from "../src/desk";
import * as door from "../src/desk";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The live face's host half (PT-2): ICE's kit has them; the door hides them. */
const HOST_HALF = ["createLiveTexture", "stillLive"];
const SOURCE = readFileSync(join(HERE, "..", "src", "desk.ts"), "utf8");

/** Every module specifier the door's source names (static, re-export and type-only alike). */
const specifiers = (source: string): string[] =>
  [...source.matchAll(/\bfrom\s*"([^"]+)"/g)].map((m) => m[1] ?? "");

describe("the SDK's /desk door", () => {
  it("re-exports from the umbrella's published entries alone — never the built-ins' (K-L4)", () => {
    const named = new Set(specifiers(SOURCE));
    expect(named).toEqual(
      new Set([
        "@vibecook/ice",
        "@vibecook/ice/desk",
        "@vibecook/ice/desk/kit",
        "@vibecook/ice/desk/engine",
      ]),
    );
    expect(SOURCE).not.toMatch(/["']@vibecook\/ice\/desk\/objects["']/);
    expect(SOURCE).not.toMatch(/["']@ice\//);
  });

  it("hands over the render kit WHOLE, the same bindings ICE's kinds use (one copy) — but the live face's host half", () => {
    for (const name of Object.keys(iceKit)) {
      if (HOST_HALF.includes(name)) continue;
      expect(door, `kit name ${name}`).toHaveProperty(name);
      expect((door as Record<string, unknown>)[name], name).toBe(
        (iceKit as Record<string, unknown>)[name],
      );
    }
  });

  it("PT-2: hands a kind the LIVE FACE it reads, never the host's writer nor a still's source (PA-22)", () => {
    // what a kind reads: the key a host lends its sources under, the sight, the depth a face is read at
    expect(door.LIVE).toBe(iceKit.LIVE);
    expect(door.createSight).toBe(iceKit.createSight);
    expect(door.liveDepth).toBe(iceKit.liveDepth);
    expectTypeOf<door.LiveFace>().toEqualTypeOf<iceKit.LiveFace>();
    expectTypeOf<door.LiveTexture>().toEqualTypeOf<iceKit.LiveTexture>();
    // the host's half is in ICE's kit and NOT through this door
    for (const name of HOST_HALF) {
      expect(typeof (iceKit as Record<string, unknown>)[name], name).toBe("function");
      expect((door as Record<string, unknown>)[name], name).toBeUndefined();
    }
    // and a kind reaches a live page's keys, its redraw and the desk's frames through its host
    expectTypeOf<door.KindHost["keyOf"]>().toEqualTypeOf<iceDesk.KindHost["keyOf"]>();
    expectTypeOf<door.KindHost["redraw"]>().toEqualTypeOf<iceDesk.KindHost["redraw"]>();
    expectTypeOf<door.KindHost["frames"]>().toEqualTypeOf<iceDesk.KindHost["frames"]>();
  });

  it("PT-3: types a kind's hand by ICE's names, and keys a browser page's navigation beside LIVE", () => {
    // what the hand tells a kind in hand, and what its cursor reads — ICE's own types, by name (LT2's question 6)
    expectTypeOf<door.HeldEvent>().toEqualTypeOf<iceDesk.HeldEvent>();
    expectTypeOf<door.HeldCursorContext>().toEqualTypeOf<iceDesk.HeldCursorContext>();
    // the second service (ruling 10): its own key, never LIVE's — navigation goes through the face's page, by its key
    expect(door.BROWSER_NAVIGATION.name).toBe("vibefield.browser.navigation");
    expect(door.BROWSER_NAVIGATION).not.toBe(door.LIVE);
    expectTypeOf<door.BrowserNavigation["navigate"]>().toEqualTypeOf<
      (key: string, command: door.BrowserNavigationCommand) => boolean
    >();
    expectTypeOf<{ action: "go"; url: string }>().toMatchTypeOf<door.BrowserNavigationCommand>();
    expectTypeOf<{ action: "stop" }>().toMatchTypeOf<door.BrowserNavigationCommand>();
  });

  it("PT-4: the page's second service re-specs a face under its open page; the spec names the device the page is seen as", () => {
    expectTypeOf<door.BrowserNavigation["respec"]>().toEqualTypeOf<
      (key: string, spec: Readonly<Record<string, unknown>>) => boolean
    >();
    expectTypeOf<door.LiveBrowserSpec["device"]>().toEqualTypeOf<
      door.LiveBrowserDevice | undefined
    >();
    expectTypeOf<door.LiveBrowserDevice["agent"]>().toEqualTypeOf<door.LiveBrowserAgent | null>();
    expectTypeOf<{
      mobile: true;
      touchPoints: 5;
      agent: null;
    }>().toMatchTypeOf<door.LiveBrowserDevice>();
  });

  it("hands over the kind contract, the placement keys and the service keys", () => {
    expect(door.defineObject).toBe(iceDesk.defineObject);
    expect(door.isObjectKind).toBe(iceDesk.isObjectKind);
    expect(door.objectKindOf).toBe(iceDesk.objectKindOf);
    expect(door.createRecordStore).toBe(iceDesk.createRecordStore);
    expect([door.DESK_OBJECT, door.CONTAINABLE, door.PINNABLE]).toEqual([
      "desk.object",
      "desk.containable",
      "desk.pinnable",
    ]);
    for (const key of [door.TEXT_RASTER, door.PICTURE_DECODER, door.BLOB_STORE])
      expect(key).toBeDefined();
    // the engine a pass is built with
    for (const name of [
      "compose",
      "compile",
      "defineStruct",
      "bindLayout",
      "bindGroup",
      "renderPipeline",
    ])
      expect((door as Record<string, unknown>)[name], name).toBe(
        (iceEngine as Record<string, unknown>)[name],
      );
  });

  it("hands over the colour parse and the ink it answers for a colour it cannot read — never a throw in a kind's record (I32, DK-12)", () => {
    expect(door.rgb).toBe(iceDesk.rgb);
    expect(door.cssColor).toBe(iceDesk.cssColor);
    expect(door.MISSING_INK).toBe(iceDesk.MISSING_INK);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // a free-string prop can hold anything: a name the parser does not read is the desk's missing ink, said once
      const said = "dk-12 a colour no parser reads";
      expect(door.rgb(said)).toEqual(door.MISSING_INK.slice(0, 3));
      expect(door.rgb(said)).toEqual(door.MISSING_INK.slice(0, 3));
      expect(warn.mock.calls.filter((c) => String(c[0]).includes(said))).toHaveLength(1);
      // the throw is the author's to ask for
      expect(() => door.rgb(said, { strict: true })).toThrow(/unparsed colour/);
    } finally {
      warn.mockRestore();
    }
  });

  it("hands a kind's DOM half the two core names ICE's own halves read — the camera and the frame — and nothing else of core's (DK-8)", () => {
    // the desk's one editor is placed in screen space from where the camera is (`world.getResource(Camera)`),
    // and a lease ends when its object leaves the frame (`Active`) — the note's body and the calendar's line
    // read these two; a plugin kind's text part reads the same bindings, one copy
    expect(door.Camera).toBe(iceRoot.Camera);
    expect(door.Active).toBe(iceRoot.Active);
    // core's writers stay core's: a kind commits through `writable(docs)`, never a raw transaction door
    for (const name of ["guardedTransaction", "Editing", "Grab", "setWidgetProps", "Position"]) {
      expect(iceRoot, name).toHaveProperty(name);
      expect(door, name).not.toHaveProperty(name);
    }
  });

  it("withholds the host's half and a device of a kind's own (DK-D22)", () => {
    for (const name of ["acquire", "adopt"]) {
      expect(iceEngine, name).toHaveProperty(name);
      expect(door, name).not.toHaveProperty(name);
    }
    for (const name of ["deskLayer", "Ground", "createDeskBuilder", "createGpuProfiler"]) {
      expect(iceDesk, name).toHaveProperty(name);
      expect(door, name).not.toHaveProperty(name);
    }
    // and nothing of a built-in by any name
    expect(door).not.toHaveProperty("DESK_OBJECTS");
    expect(door).not.toHaveProperty("DESK_ENGINE");
    expect(door).not.toHaveProperty("paperKind");
    expect(iceRoot).toHaveProperty("defineWidget");
    expect(door).not.toHaveProperty("defineWidget");
  });

  it("types ObjectBinding for real: the kind's geometry and record flow through it", () => {
    interface Geometry {
      readonly cx: number;
      readonly r: number;
    }
    interface Record_ {
      readonly cx: number;
    }
    const kind: ObjectKind<Geometry, Record_> = {
      name: "com.example.dot",
      stratum: "things",
      reach: 0,
      create: () => Promise.reject(new Error("no device in a unit")),
      resolve: (ctx: ObjectContext): Geometry => ({ cx: ctx.rect.cx, r: ctx.rect.w / 2 }),
      record: (g) => ({ cx: g.cx }),
      hit: (g, wx): ObjectHit | null => (Math.abs(wx - g.cx) <= g.r ? "content" : null),
    };
    const binding: ObjectBinding<Geometry, Record_> = { kind };
    expectTypeOf(binding.kind.resolve).returns.toEqualTypeOf<Geometry>();
    expectTypeOf(binding.kind.record).returns.toEqualTypeOf<Record_>();
    // a typed binding is still a binding the host takes as is
    const host: ObjectBinding = binding;
    expect(door.isObjectKind(host.kind)).toBe(true);
  });
});
