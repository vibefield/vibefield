// THE PHONE'S KIND, judged by the SDK's KIND-CONFORMANCE HARNESS (`@vibefield/plugin-sdk/testing` — the one `pnpm playground`
// and `vibefield-plugin check` run, no GPU and no DOM) WITH THE PRODUCT'S PALETTE: its declaration, its program on a recording
// device (four pipelines over one module — the phone and its spill, each lit from elsewhere too), every playground state in
// every mode it declares (idle, selected, held, open — it opens: ICE's pick-up) at every zoom, its dispose. Then what the
// harness cannot know: its slab is what is picked (never a part at rest), its marks go round the slab as its eye sees it, a
// held phone is higher and bigger, a BOUND phone opens its live face with its device's spec and an unbound one none, its
// screen shows each honest face (the stream; a still at 0.7 with its mark; a still at 0.16 under words; the panel off with
// words), its act is a part in hand and runs on its release, and its tools say "View only" beside the device's name.
import {
  defineObject,
  type Entity,
  type HeldToolStateContext,
  isObjectKind,
  type LiveSimulatorState,
  objectKindOf,
} from "@vibefield/plugin-sdk/desk";
import { type KindReport, productPalette, runKindConformance } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import states from "../playground/states";
import {
  castPhone,
  createSimulatorLocal,
  DEFAULT_PHONE,
  deviceName,
  glassOf,
  heldPartAt,
  modelOf,
  noticeLayout,
  PHONE,
  PHONE_SIZE,
  phoneById,
  pointAt,
  SCREEN_OFF,
  SIMULATOR_TOOLS,
  type SimulatorGeometry,
  seen,
  shapeOf,
  simulator,
  simulatorKind,
  simulatorManifest,
  VIEW_ONLY,
} from "../src";
import { boundTo, ctxOf, fakeHost, fakeWords, TYPE } from "./fakes";

const row = simulatorManifest.contributes?.objects?.[0];
const refusals = (r: KindReport) =>
  r.verdicts.filter((v) => v.status === "refused").map((v) => v.code);
const fixtures = (states as Record<string, Record<string, Record<string, unknown>>>)[
  "vibefield.simulator"
];

describe("the phone's kind, judged by the kind-conformance harness WITH the product's palette", () => {
  it("passes: its declaration, its program, every playground state in every mode and zoom, its dispose", async () => {
    if (row === undefined) throw new Error("the manifest declares no object");
    const r = await runKindConformance({
      binding: simulator,
      row,
      at: "/contributes/objects/0",
      states: fixtures,
      palette: productPalette,
    });
    expect(refusals(r)).toEqual([]);
    // it OPENS (ICE's pick-up), and goes into no mini mat (it provides no CONTAINABLE: no chip yet)
    expect(r.plan.modes).toEqual(["idle", "selected", "held", "open"]);
    expect(r.plan.fixtures).toEqual([
      "default",
      "silver",
      "iphone-8",
      "no-simulator",
      "no-permission",
      "no-device",
      "off",
      "booting",
      "no-window",
      "live",
      "at-rest",
      "stopped",
    ]);
    expect(r.states).toBe(12 * (4 * r.plan.zooms.length + 1));
    // the program: the phone and its spill, and their lit-from-elsewhere twins
    const program = r.verdicts.find((v) => v.subject === "program" && v.code === "ok");
    expect(program?.detail).toContain("vertex vs + fragment fs + fragment fs_spill");
    expect(program?.detail).toMatch(/4 pipeline\(s\)/);
  });

  it("passes under the harness's two-role default too: the phone reads the host's cast alone, every other colour its own", async () => {
    if (row === undefined) throw new Error("the manifest declares no object");
    const r = await runKindConformance({ binding: simulator, row, states: fixtures });
    expect(refusals(r)).toEqual([]);
  });

  it("the host's compile takes it: a desk kind named by its type, things, its opening and its one tool", () => {
    const kind = simulator.kind;
    expect(isObjectKind(kind)).toBe(true);
    expect(kind.name).toBe(row?.type);
    expect(kind.stratum).toBe("things");
    expect(kind.open?.pose).toBe("camera");
    const type = defineObject({
      type: "test.simulator-compile",
      kind: simulatorKind(),
      size: PHONE_SIZE,
    });
    expect(objectKindOf(type)?.name).toBe("vibefield.simulator");
    expect(type.openable).toBe(true);
    expect(type.heldTools.map((t) => t.id)).toEqual(["touch"]);
    // no driver of its own (core's drag carries it on the desk's springs) and no menu (the model's writer is PT-S2's attach)
    expect(simulator.drivers).toBeUndefined();
    expect(simulator.menu).toBeUndefined();
  });
});

describe("the phone's world half", () => {
  const kind = simulatorKind();

  it("is its model's own shape and size on its rect — a 17 Pro by default, an iPhone 8 when it says so — its finish its model's", () => {
    const G = kind.resolve(ctxOf({}));
    expect(G.shape).toBe(shapeOf(DEFAULT_PHONE));
    const eight = kind.resolve(ctxOf({ model: `${TYPE}iPhone-8`, finish: "silver-8" }));
    expect(eight.shape.model.name).toBe("iPhone 8");
    expect(eight.finish.white).toBe(1);
    // a finish not of its model is drawn in its model's first
    const odd = kind.resolve(ctxOf({ model: `${TYPE}iPhone-8`, finish: "cosmic-orange" }));
    expect(odd.finish).toEqual(
      kind.resolve(ctxOf({ model: `${TYPE}iPhone-8`, finish: "space-gray-8" })).finish,
    );
    // an id this build does not know: the default's shape
    expect(kind.resolve(ctxOf({ model: `${TYPE}iPhone-99` })).shape).toBe(shapeOf(DEFAULT_PHONE));
  });

  it("is picked where it is drawn: its slab at rest is the phone itself — never a part — and past it nothing", () => {
    const G = kind.resolve(ctxOf({}));
    const [cx, cy] = seen(G.eye, pointAt(G, 0, 0));
    expect(kind.hit(G, cx, cy)).toBe("content");
    const [bx, by] = seen(G.eye, pointAt(G, G.shape.half[0] - 0.5, 0, -G.shape.rim[1] * 0.5));
    expect(kind.hit(G, bx, by)).toBe("content");
    expect(kind.hit(G, G.shape.half[0] * 3, 0)).toBeNull();
  });

  it("puts the desk's marks round its silhouette as its eye sees it — larger lifted — and is never turned", () => {
    const rest = kind.frame?.(kind.resolve(ctxOf({})));
    const held = kind.frame?.(
      kind.resolve(ctxOf({}, { flux: { lift: 1, hover: 0, ring: 0, fade: 1 } })),
    );
    expect(rest?.angle).toBe(0);
    expect(rest?.hx ?? 0).toBeGreaterThan(PHONE_SIZE.w / 2);
    expect(held?.hx ?? 0).toBeGreaterThan(rest?.hx ?? Number.POSITIVE_INFINITY);
    expect(held?.r ?? 0).toBeGreaterThan(0);
  });

  it("an UNBOUND phone opens no face: its screen off, no mark, no words — a specimen's too, with no desk state at all", () => {
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    const ctx = ctxOf({}, { local });
    const r = kind.record(kind.resolve(ctx), ctx);
    expect(t.opened).toEqual([]);
    expect(r.live).toBeUndefined();
    expect(r.screen).toEqual(SCREEN_OFF);
    expect(r.mark).toBe("none");
    expect(r.notice).toBeUndefined();
    // a specimen (no local): drawn the same — the panel off
    const bare = ctxOf(boundTo(`${TYPE}iPhone-17-Pro`));
    expect(kind.record(kind.resolve(bare), bare).screen).toEqual(SCREEN_OFF);
  });

  it("a BOUND phone opens its live face by its durable key, with its device's spec — its name from the catalog, the desk's scheme", () => {
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    const ctx = ctxOf(boundTo(`${TYPE}iPhone-16-Pro`), { local, night: true });
    const r = kind.record(kind.resolve(ctx), ctx);
    expect(t.opened).toEqual([
      {
        key: "13918995204487956201-1",
        spec: {
          source: "ios-simulator",
          deviceType: `${TYPE}iPhone-16-Pro`,
          runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
          label: "iPhone 16 Pro",
          scheme: "dark",
        },
      },
    ]);
    expect(r.live?.face).toBe(t.faces.get("13918995204487956201-1"));
    // starting, nothing in it: the panel off, nothing said
    expect(r.screen).toEqual(SCREEN_OFF);
    // the binding in the product's cell form (ICE keeps a json prop as one string) reads alike
    const cell = ctxOf(
      {
        ...boundTo(`${TYPE}iPhone-16-Pro`),
        binding: JSON.stringify(boundTo(`${TYPE}iPhone-16-Pro`).binding),
      } as never,
      { local },
    );
    kind.record(kind.resolve(cell), cell);
    expect(t.opened).toHaveLength(1);
    // bound to ANOTHER device: the old face closes and a new one opens (the host resolves another simulator) — under the SAME
    // durable key, so the host's map now holds the new face: the old one is read from before the rebind
    const first = t.faces.get("13918995204487956201-1");
    const other = ctxOf(boundTo(`${TYPE}iPhone-15-Pro`), { local });
    kind.record(kind.resolve(other), other);
    expect(first?.closed()).toBe(1);
    const second = t.faces.get("13918995204487956201-1");
    expect(second).not.toBe(first);
    expect(second?.closed()).toBe(0);
    expect(t.opened.map((o) => o.spec.deviceType)).toEqual([
      `${TYPE}iPhone-16-Pro`,
      `${TYPE}iPhone-15-Pro`,
    ]);
    // unbound again: closed, and nothing reopens
    const none = ctxOf({}, { local });
    kind.record(kind.resolve(none), none);
    expect(local.faces()).toMatchObject({ opened: 2, closed: 2 });
  });

  it("shows each honest face: the stream; a still at 0.7 with its mark; a still at 0.16 under words; the panel off with words", () => {
    const words = fakeWords();
    const t = fakeHost({ words: words.raster });
    const local = createSimulatorLocal(t.host);
    const show = (state: LiveSimulatorState) => {
      const ctx = ctxOf(boundTo(`${TYPE}iPhone-17-Pro`), { local });
      kind.record(kind.resolve(ctx), ctx);
      const face = t.faces.get("13918995204487956201-1");
      if (face === undefined) throw new Error("no face");
      if (face.texture() === undefined) face.land();
      face.is({ is: state });
      local.tick(16);
      return kind.record(kind.resolve(ctx), ctx);
    };
    const live = show("live");
    expect(live.screen.on).toBe(1);
    expect(live.screen.brightness).toBe(1);
    expect(live.mark).toBe("none");
    expect(live.notice).toBeUndefined();
    const atRest = show("at-rest");
    expect([atRest.screen.on, atRest.screen.brightness, atRest.mark]).toEqual([
      1,
      PHONE.display.still,
      "rest",
    ]);
    const booting = show("booting");
    expect([booting.screen.brightness, booting.mark]).toEqual([PHONE.display.still, "boot"]);
    const off = show("off");
    expect([off.screen.on, off.screen.brightness, off.mark]).toEqual([
      1,
      PHONE.display.stillUnder,
      "none",
    ]);
    expect(words.asked.at(-1)?.words).toEqual({ line: "iPhone 17 Pro is off", act: null });
    const noDevice = show("no-device");
    // no still in this state, whatever the face holds: the panel off, the words alone
    expect(noDevice.screen).toEqual(SCREEN_OFF);
    expect(words.asked.at(-1)?.words.line).toBe("There's no iPhone 17 Pro on this Mac");
    expect(noDevice.notice?.points).toEqual(shapeOf(DEFAULT_PHONE).points);
  });

  it("offers its face's act only where the host can run it — a part in hand under the words, run on its release over it", () => {
    const words = fakeWords();
    const t = fakeHost({ words: words.raster });
    const local = createSimulatorLocal(t.host);
    const props = boundTo(`${TYPE}iPhone-17-Pro`);
    const held = { e: 1, open: true, grow: 1, snap: true };
    const at = (extra: Parameters<typeof ctxOf>[1] = {}) => ctxOf(props, { local, ...extra });
    kind.record(kind.resolve(at()), at());
    const face = t.faces.get("13918995204487956201-1");
    if (face === undefined) throw new Error("no face");
    face.land();
    let booted = 0;
    // "off" with no act the host can run: words, and no capsule
    face.is({ is: "off" });
    local.tick(16);
    kind.record(kind.resolve(at({ held })), at({ held }));
    expect(words.asked.at(-1)?.words).toEqual({ line: "iPhone 17 Pro is off", act: null });
    // "off" with its act: the capsule says "Boot"; the phone is resolved again once its words are drawn
    face.is({
      is: "off",
      act: () => {
        booted += 1;
      },
    });
    local.tick(32);
    kind.record(kind.resolve(at({ held })), at({ held }));
    expect(words.asked.at(-1)?.words).toEqual({ line: "iPhone 17 Pro is off", act: "Boot" });
    expect(local.lines(1 as Entity)).toBe(1);
    // in hand, the capsule under the line is the act; the rest of the glass is the phone's
    const G = kind.resolve(at({ held })) as SimulatorGeometry;
    expect(G.act).toEqual({ lines: 1, points: G.shape.points });
    const S = G.shape;
    const [cx, cy, , hy] = noticeLayout(S.points).capsule(1);
    const [u, v] = glassOf(S, cx, cy);
    const [wx, wy] = seen(G.eye, pointAt(G, u, v));
    expect(heldPartAt(G, wx, wy)).toBe("act");
    expect(kind.hit(G, wx, wy)).toBe("act");
    // six capsule heights under it: still the screen, no longer the act — the phone's
    const [ou, ov] = glassOf(S, cx, cy + 6 * hy);
    const [ox, oy] = seen(G.eye, pointAt(G, ou, ov));
    expect(kind.hit(G, ox, oy)).toBe("content");
    // at rest the same point is the phone (a drag carries it)
    expect(kind.hit(kind.resolve(at()), wx, wy)).toBe("content");
    // a press on the capsule and its release over it run the act — a release off it runs nothing
    local.held?.(1 as Entity, [
      { type: "pointer", phase: "down", x: 0, y: 0, part: "act", button: 0, buttons: 1, count: 1 },
    ]);
    local.held?.(1 as Entity, [
      {
        type: "pointer",
        phase: "up",
        x: 0,
        y: 0,
        part: "content",
        button: 0,
        buttons: 0,
        count: 1,
      },
    ]);
    expect(booted).toBe(0);
    local.held?.(1 as Entity, [
      { type: "pointer", phase: "down", x: 0, y: 0, part: "act", button: 0, buttons: 1, count: 1 },
      { type: "pointer", phase: "up", x: 0, y: 0, part: "act", button: 0, buttons: 0, count: 1 },
    ]);
    expect(booted).toBe(1);
    expect(local.acts).toBe(1);
  });

  it("in hand its bar says the device's name — the host's word for it, else its catalog's — and its one tool says View only", () => {
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    const props = boundTo(`${TYPE}iPhone-Air`);
    const readout = kind.open?.readout;
    if (typeof readout !== "function") throw new Error("no readout");
    const ctx = ctxOf(props, { local });
    kind.record(kind.resolve(ctx), ctx);
    const read = () =>
      readout({ world: {} as never, entity: 1 as Entity, props: () => props, local });
    expect(read()).toBe("iPhone Air");
    t.faces.get("13918995204487956201-1")?.is({ is: "live", device: "Test iPhone" });
    local.tick(16);
    expect(read()).toBe("Test iPhone");
    // an unbound phone says its model's name; a type this build lacks, its id's words
    expect(readout({ world: {} as never, entity: 2 as Entity, props: () => ({}), local })).toBe(
      "iPhone 17 Pro",
    );
    expect(deviceName({ deviceType: `${TYPE}iPhone-18-Pro`, runtime: "x" }, modelOf(""))).toBe(
      "iPhone 18 Pro",
    );
    // the one tool: touch, declared and DISABLED, saying View only (ICE I49)
    expect(SIMULATOR_TOOLS.map((tool) => tool.id)).toEqual(["touch"]);
    const state = SIMULATOR_TOOLS[0]?.state?.({} as HeldToolStateContext);
    expect(state).toEqual({ enabled: false, label: VIEW_ONLY });
    expect(VIEW_ONLY).toBe("View only");
  });

  it("asks for a native framebuffer of its BOUND device's own type (a stream of another device is cropped to fill its model)", () => {
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    // an iPhone 8 phone bound to a 17 Pro: its shape is the 8's, its stream the 17 Pro's
    const ctx = ctxOf(
      {
        model: `${TYPE}iPhone-8`,
        binding: {
          deviceType: `${TYPE}iPhone-17-Pro`,
          runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
        },
      },
      { local },
    );
    kind.record(kind.resolve(ctx), ctx);
    t.draw(local, 1 as Entity, 1, "hand");
    local.tick(16);
    expect(t.faces.get("13918995204487956201-1")?.demands.at(-1)?.raster).toEqual(
      phoneById(`${TYPE}iPhone-17-Pro`)?.screen.px,
    );
    const face = t.faces.get("13918995204487956201-1");
    face?.land();
    face?.is({ is: "live" });
    local.tick(32);
    const r = kind.record(kind.resolve(ctx), ctx);
    // the frame's aspect (the 17 Pro's) is not the 8's display's: the record carries it, and the display crops
    expect(r.screen.aspect).toBeCloseTo(603 / 1311, 9);
    expect(r.geometry.shape.model.name).toBe("iPhone 8");
  });

  it("by night a BOUND phone holds its glow's reach from its FIRST resolve — before any face is open — so a stream that lands is never clipped; by day, or unbound, it does not", () => {
    const t = fakeHost();
    const local = createSimulatorLocal(t.host);
    const night = ctxOf(boundTo(`${TYPE}iPhone-17-Pro`), { local, night: true });
    // the first resolve runs before the record opens a face: the quad is sized from the props alone (the pane's `lit`)
    const first = kind.resolve(night);
    expect(t.opened).toHaveLength(0);
    // its screen dark until a frame lands: the larger quad lights nothing (the shader and the spill gate on `on`)
    expect(kind.record(first, night).screen.on).toBe(0);
    expect(t.opened).toHaveLength(1);
    const face = t.faces.get("13918995204487956201-1");
    face?.land();
    face?.is({ is: "live" });
    local.tick(16);
    const lit = kind.resolve(night);
    // the stream landed and the quad did not move: it held the glow's reach already
    expect(lit.bounds).toEqual(first.bounds);
    expect(kind.record(lit, night).screen.on).toBe(1);
    const day = kind.resolve(ctxOf(boundTo(`${TYPE}iPhone-17-Pro`), { local }));
    const dark = kind.resolve(ctxOf({}, { night: true }));
    expect(first.bounds.x1 - first.bounds.x0).toBeGreaterThan(day.bounds.x1 - day.bounds.x0 + 100);
    expect(dark.bounds.x1 - dark.bounds.x0).toBeCloseTo(day.bounds.x1 - day.bounds.x0, 6);
    // the ray still finds the glass where it is drawn, lit or not
    const [cx, cy] = seen(lit.eye, pointAt(lit, 0, 0));
    expect(castPhone(lit, cx, cy)?.part).toBe("glass");
  });
});
