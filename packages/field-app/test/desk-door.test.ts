/**
 * DK-2 — the SDK's canvas door on the desk build (desk/landing, ICE 0.14.0).
 *
 * The host compiles a legacy `widgets` row FACELESS (no field ICE refuses ever
 * reaches `defineWidget`) and an `objects` row through `defineObject` with the
 * kind its module exports; the engine is ICE's desk preset; the ghost-stub
 * filter reads the engine's full pack scope; an illegal tool is refused, never
 * thrown. All headless — a unit over the registry and the engine, no GPU.
 */
import {
  Camera,
  type CanvasEngine,
  type InputEvent,
  NO_MODS,
  selectedEntities,
  Viewport,
} from "@vibecook/ice";
import { objectKindOf } from "@vibecook/ice/desk";
import { type PluginManifestV1, WidgetContribution } from "@vibefield/contracts";
import type { ObjectBinding, ObjectKind } from "@vibefield/plugin-sdk/desk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRegistry,
  createFieldEngine,
  fieldPackScope,
  setFieldTool,
} from "../src/field-engine";
import { getRendererLogger, type RendererLogger, setRendererLogger } from "../src/logging";
import { buildObjectType, buildWidgetType } from "../src/plugin-host/build-widget";
import { buildGhostWidgetTypes } from "../src/plugin-host/ghost-stubs";

interface Logged {
  level: "warn" | "error";
  event: string;
  attrs?: Record<string, unknown>;
}

function recordingLogger(lines: Logged[]): RendererLogger {
  const logger: RendererLogger = {
    child: () => logger,
    trace() {},
    debug() {},
    info() {},
    warn(event, _message, attrs) {
      lines.push({ level: "warn", event, ...(attrs === undefined ? {} : { attrs }) });
    },
    error(event, _message, _error, attrs) {
      lines.push({ level: "error", event, ...(attrs === undefined ? {} : { attrs }) });
    },
    fatal() {},
    isLevelEnabled: () => true,
  };
  return logger;
}

/** A desk kind's shape, headless: `isObjectKind` holds it, and nothing here ever creates its pass. */
function fakeKind(name: string): ObjectKind {
  return {
    name,
    stratum: "things",
    reach: 0,
    create: () => Promise.reject(new Error("no GPU in a unit test")),
    resolve: () => ({}),
    record: () => ({}),
    hit: () => "content",
  };
}

function manifest(id: string, contributes: PluginManifestV1["contributes"]): PluginManifestV1 {
  const types = [...(contributes?.widgets ?? []), ...(contributes?.objects ?? [])].map(
    (row) => row.type,
  );
  return {
    manifestVersion: 1,
    id,
    version: "0.1.0",
    title: id,
    engines: { app: ">=0.0.0", contracts: "^0.1.0" },
    entries: { renderer: "./dist/renderer.js" },
    activation: types.map((type) => `onWidget:${type}`),
    capabilities: [],
    contributes,
  } as PluginManifestV1;
}

function ev(kind: InputEvent["kind"], x: number, y: number, buttons: number): InputEvent {
  return {
    kind,
    pointerId: "mouse",
    device: "mouse",
    screenX: x,
    screenY: y,
    buttons,
    mods: NO_MODS,
  };
}

function stepper(ce: CanvasEngine) {
  let now = 0;
  return (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 16;
      ce.step(now);
    }
  };
}

/** A tap at a world point under an identity camera — the headless pick: the input
 * stack's own picking system, which falls back to the box for a type with no kind. */
function tapAt(ce: CanvasEngine, x: number, y: number): void {
  const step = stepper(ce);
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  step(3);
  ce.stack.queue.enqueue(ev("down", x, y, 1));
  step(1);
  ce.stack.queue.enqueue(ev("up", x, y, 0));
  step(3);
}

const LEGACY = "com.example.dk2faceless.card";
const CLOCK = "com.example.dk2objects.clock";
const UNBOUND = "com.example.dk2objects.unbound";

let logged: Logged[] = [];
let previous: RendererLogger;
beforeEach(() => {
  logged = [];
  previous = getRendererLogger();
  setRendererLogger(recordingLogger(logged));
});
afterEach(() => setRendererLogger(previous));

describe("DK-2 — a legacy widgets row compiles FACELESS", () => {
  it("registers without a face though its manifest still carries the refused fields", () => {
    // `surface`/`sizeMode` are what ICE 0.14 REFUSES at definition; an old manifest
    // still says them (the contract tolerates them), and none may reach defineWidget.
    const row = WidgetContribution.parse({
      type: "com.example.dk2faceless.row",
      title: "Row",
      schemaVersion: 1,
      surface: "gl",
      sizeMode: "fixed",
      defaultSize: { w: 120, h: 80 },
    });
    const widget = buildWidgetType(row);
    expect(widget.type).toBe("com.example.dk2faceless.row");
    expect(widget.object).toBeUndefined();
    expect(objectKindOf(widget)).toBeUndefined();
  });

  it("its entity is pickable by its box on the desk engine — no kind, no GPU", () => {
    const registry = buildRegistry({
      generation: -1,
      staged: [],
      bundled: [
        {
          manifest: manifest("com.example.dk2faceless", {
            widgets: [
              {
                type: LEGACY,
                title: "Legacy",
                schemaVersion: 1,
                surface: "dom",
                sizeMode: "fixed",
                defaultSize: { w: 200, h: 100 },
                // placed on the desk like any object: the desk canvas places by this key
                provides: ["desk.object"],
                interaction: { selectable: true, movable: true },
                props: {},
                groups: {},
              },
            ],
          }),
          mod: { activate() {} },
        },
      ],
    });
    const faceless = registry.allWidgets().get(LEGACY);
    expect(faceless).toBeDefined();
    expect(objectKindOf(faceless)).toBeUndefined();

    const ce = createFieldEngine(registry);
    ce.docs.create();
    const entity = ce.ops.spawnWidget(LEGACY, { x: 100, y: 100, w: 200, h: 100, undoable: false });
    tapAt(ce, 200, 150);
    expect(selectedEntities(ce.world)).toEqual([entity]);
    ce.dispose();
  });
});

describe("DK-2 — an objects row compiles through defineObject", () => {
  const objectRow = (type: string, kind: string) => ({
    type,
    title: type,
    schemaVersion: 1,
    size: { w: 160, h: 160 },
    provides: ["desk.object"],
    interaction: { selectable: true, movable: true },
    props: {},
    groups: {},
    tray: {
      category: "things",
      label: "Clock",
      hang: { w: 110, h: 110, accessory: "hook" as const, pegs: [[0, -0.5]] as [number, number][] },
    },
    binding: { kind },
  });

  it("binds the exported kind; a row whose export is missing still registers, FACELESS", () => {
    const kind = fakeKind(CLOCK);
    const objectBindings = new Map<string, ObjectBinding>([[CLOCK, { kind }]]);
    const registry = buildRegistry({
      generation: -1,
      staged: [],
      bundled: [
        {
          manifest: manifest("com.example.dk2objects", {
            objects: [objectRow(CLOCK, "clock"), objectRow(UNBOUND, "missing")],
          }),
          mod: { activate() {} },
          objectBindings,
        },
      ],
    });
    expect(objectKindOf(registry.allWidgets().get(CLOCK))).toBe(kind);
    expect(registry.allWidgets().get(CLOCK)?.tray?.hang).toEqual({
      w: 110,
      h: 110,
      accessory: "hook",
      pegs: [[0, -0.5]],
    });
    // no export — the data survives: the type registers with no kind, and the host says why
    expect(registry.allWidgets().get(UNBOUND)).toBeDefined();
    expect(objectKindOf(registry.allWidgets().get(UNBOUND))).toBeUndefined();
    expect(logged).toContainEqual(
      expect.objectContaining({
        event: "renderer.plugins.object_kind_unbound",
        attrs: expect.objectContaining({ type: UNBOUND }),
      }),
    );
  });

  it("refuses a kind whose registry name is not its type, a non-kind, and a tray with no hang", () => {
    const row = objectRow("com.example.dk2objects.misnamed", "misnamed");
    expect(() => buildObjectType(row, { kind: fakeKind("misnamed") })).toThrow(
      /kind is named "misnamed" — a kind's registry name IS its type/,
    );
    // DK-6: `ObjectBinding` is typed at the SDK's `/desk` door, but a module's export is a plugin's
    // DATA at run time — one typed past the SDK here, and the host still refuses it.
    const notKind = objectRow("com.example.dk2objects.notkind", "notkind");
    const notABinding = { kind: { name: notKind.type } } as unknown as ObjectBinding;
    expect(() => buildObjectType(notKind, notABinding)).toThrow(/holds no desk kind/);
    // DK-3 (ruling 9): the contract requires the hang now, so a hangless entry is one that reached
    // the host some other way — typed past the schema here — and the host still refuses it.
    const { hang: _hang, ...unhung } = objectRow("com.example.dk2objects.unhung", "unhung").tray;
    const hangless = {
      ...objectRow("com.example.dk2objects.unhung", "unhung"),
      tray: unhung,
    } as unknown as Parameters<typeof buildObjectType>[0];
    expect(() =>
      buildObjectType(hangless, { kind: fakeKind("com.example.dk2objects.unhung") }),
    ).toThrow(/tray\.hang is required/);
  });
});

describe("DK-2 — the engine is ICE's desk preset", () => {
  it("roots at desk.desk with the six reference kinds and the desk's two tools", () => {
    const ce = createFieldEngine(buildRegistry({ generation: -1, staged: [], bundled: [] }));
    expect(ce.catalog.rootCanvas.id).toBe("desk.desk");
    for (const kind of ["desk.note", "desk.minimat", "desk.board", "desk.photo"])
      expect(objectKindOf(ce.catalog.widget(kind))).toBeDefined();
    expect(ce.canvas.tools().map((tool) => tool.id)).toEqual(["desk.select", "pan"]);
    ce.dispose();
  });

  it("refuses a tool the desk does not allow — never a throw out of the renderer", () => {
    const ce = createFieldEngine(buildRegistry({ generation: -1, staged: [], bundled: [] }));
    ce.docs.create();
    expect(setFieldTool(ce, "connect")).toBe(false);
    expect(setFieldTool(ce, "select")).toBe(false);
    expect(logged.filter((line) => line.event === "renderer.canvas.tool_refused")).toHaveLength(2);
    expect(setFieldTool(ce, "pan")).toBe(true);
    expect(setFieldTool(ce, "desk.select")).toBe(true);
    ce.dispose();
  });
});

describe("DK-2 — ghost stubs read the engine's full pack scope", () => {
  it("never stubs the desk's kinds, its data prefabs, wire or a registered type; an absent one is faceless", () => {
    const registry = buildRegistry({ generation: -1, staged: [], bundled: [] });
    const scope = fieldPackScope(registry);
    for (const pack of ["desk.note", "desk.stroke", "desk.event", "desk.pin", "wire"])
      expect(scope.has(pack)).toBe(true);
    const stubs = buildGhostWidgetTypes(
      {
        "desk.stroke": 4,
        "desk.note": 1,
        wire: 1,
        // a dev-bundled plugin's type, registered
        "vibefield.note": 1,
        // DK-5: the host's built-in mirror retired with `terminal/widget/*` (DK-D19) — a board
        // that still names it holds an ABSENT type now, stubbed faceless like any other
        "vibefield.terminal.mirror": 1,
        "com.example.dk2ghost.gone": 2,
      },
      scope,
    );
    expect(stubs.map((stub) => [stub.type, stub.version])).toEqual([
      ["vibefield.terminal.mirror", 1],
      ["com.example.dk2ghost.gone", 2],
    ]);
    for (const stub of stubs) expect(objectKindOf(stub)).toBeUndefined();
  });
});
