// PT-2 — THE LIVE FACE'S GATE (surfaces/live/live-gate.ts; ruling 3): the HOST decides, by the OBJECT a face's durable key names —
// its entity, its type, the plugin that contributes it, that plugin's effective capabilities — never by a kind's spec. On a REAL
// engine and document: the browser pane (granted `surface.attach` + `surface.browser`) opens; the comment pad (granted neither) is
// refused in the plugin door's own words; a desk built-in and an unknown key open nothing; a staged plugin's grants are its
// record's. PT-S2 — the scopes are the SOURCE's: the phone (granted `surface.attach` + `surface.capture`, its manifest's since
// PT-S2's attach) opens a bound Simulator and no page; the pane opens no Simulator.
import {
  defineQuery,
  Not,
  Position,
  PrefabId,
  Size,
  Specimen,
  type WidgetType,
} from "@vibecook/ice";
import * as pane from "@vibefield/plugin-browser-pane";
import * as pad from "@vibefield/plugin-comment-pad";
import type { RegisteredPlugin } from "@vibefield/plugin-runtime";
import * as phone from "@vibefield/plugin-simulator";
import { describe, expect, it } from "vitest";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { objectBindingsFrom } from "../src/plugin-host/build-widget";
import {
  createLiveGate,
  grantsOf,
  LIVE_FACE_SCOPES,
  SIMULATOR_SCOPES,
} from "../src/surfaces/live/live-gate";

const objectsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

function board() {
  const registry = buildRegistry({
    generation: -1,
    staged: [],
    bundled: [
      {
        manifest: pane.browserPaneManifest,
        mod: pane.browserPaneRenderer,
        objectBindings: objectBindingsFrom(
          pane,
          pane.browserPaneManifest.contributes?.objects ?? [],
        ),
      },
      {
        manifest: pad.commentPadManifest,
        mod: pad.commentPadRenderer,
        objectBindings: objectBindingsFrom(pad, pad.commentPadManifest.contributes?.objects ?? []),
      },
      {
        manifest: phone.simulatorManifest,
        mod: phone.simulatorRenderer,
        objectBindings: objectBindingsFrom(
          phone,
          phone.simulatorManifest.contributes?.objects ?? [],
        ),
      },
    ],
  });
  const ce = createFieldEngine(registry);
  ce.docs.create();
  ce.ops.spawnWidget(pane.BROWSER_PANE_TYPE, { x: 0, y: 0, ...pane.PANE_SIZE, props: {} });
  ce.ops.spawnWidget(pad.COMMENT_PAD_TYPE, { x: 900, y: 0, w: 220, h: 280, props: {} });
  ce.ops.spawnWidget(phone.SIMULATOR_TYPE, { x: 1400, y: 0, ...phone.PHONE_SIZE, props: {} });
  ce.ops.spawnWidget("desk.note", { x: 0, y: 700, w: 200, h: 200, props: {} });
  ce.world.sync();
  const keyOf = (type: string): string => {
    let key: string | undefined;
    ce.world.query(objectsQ).each((batch) => {
      for (const row of batch) {
        const e = batch.entity(row);
        if (ce.world.get(e, PrefabId)?.id === type)
          key = ce.docs.current()?.store.keyOf(e) as string | undefined;
      }
    });
    if (key === undefined) throw new Error(`no durable ${type}`);
    return key;
  };
  return { ce, registry, gate: createLiveGate({ engine: ce, registry }), keyOf };
}

describe("the live face's gate — the host's, by the object (ruling 3)", () => {
  it("opens the browser pane's face: its plugin is granted surface.attach and surface.browser", () => {
    const { ce, gate, keyOf } = board();
    expect(gate(keyOf(pane.BROWSER_PANE_TYPE))).toEqual({ type: "vibefield.browser-pane" });
    ce.dispose();
  });

  it("refuses an object whose plugin is not granted them — the plugin door's own words", () => {
    const { ce, gate, keyOf } = board();
    expect(gate(keyOf(pad.COMMENT_PAD_TYPE))).toEqual({
      refused: "FORBIDDEN_SCOPE: plugin vibefield.comment-pad is not granted surface.attach",
    });
    ce.dispose();
  });

  it("refuses a desk built-in (no plugin's) and a key no object on the board holds", () => {
    const { ce, gate, keyOf } = board();
    expect(gate(keyOf("desk.note"))).toEqual({
      refused: "desk.note is no plugin's: it opens no page",
    });
    expect(gate("13918995204487956201-999")).toEqual({
      refused: "no object on this board holds this face",
    });
    ce.dispose();
  });

  it("reads a staged plugin's grants off its record, a bundled one's as its activation computes them", () => {
    const { ce, registry } = board();
    const bundled = registry.plugin(pane.BROWSER_PANE_TYPE);
    if (bundled === undefined) throw new Error("the pane is not registered");
    expect([...grantsOf(bundled)].sort()).toEqual(["surface.attach", "surface.browser"]);
    const staged = {
      record: { grantedCapabilities: ["surface.attach"] },
    } as unknown as RegisteredPlugin<WidgetType>;
    expect(grantsOf(staged)).toEqual(["surface.attach"]);
    ce.dispose();
  });

  it("PT-S2: the scopes are the SOURCE's — a page asks surface.attach + surface.browser (the default), a bound Simulator surface.attach + surface.capture", () => {
    expect(LIVE_FACE_SCOPES).toEqual({
      browser: ["surface.attach", "surface.browser"],
      "ios-simulator": ["surface.attach", "surface.capture"],
    });
    expect(SIMULATOR_SCOPES).toEqual(["surface.attach", "surface.capture"]);
  });

  it("PT-S2: opens the PHONE's Simulator — its plugin is granted surface.attach and surface.capture — and no page of it; the pane opens no Simulator", () => {
    const { ce, registry, gate, keyOf } = board();
    const phoneKey = keyOf(phone.SIMULATOR_TYPE);
    const bundled = registry.plugin(phone.SIMULATOR_TYPE);
    if (bundled === undefined) throw new Error("the phone is not registered");
    expect([...grantsOf(bundled)].sort()).toEqual(["surface.attach", "surface.capture"]);
    expect(gate(phoneKey, "ios-simulator")).toEqual({ type: "vibefield.simulator" });
    // asked as a page — the default — it is refused: capture grants no browser
    expect(gate(phoneKey)).toEqual({
      refused: "FORBIDDEN_SCOPE: plugin vibefield.simulator is not granted surface.browser",
    });
    // the pane's plugin is granted no capture: its object opens no Simulator, whatever a spec says
    expect(gate(keyOf(pane.BROWSER_PANE_TYPE), "ios-simulator")).toEqual({
      refused: "FORBIDDEN_SCOPE: plugin vibefield.browser-pane is not granted surface.capture",
    });
    // the comment pad is granted neither: refused at the first
    expect(gate(keyOf(pad.COMMENT_PAD_TYPE), "ios-simulator")).toEqual({
      refused: "FORBIDDEN_SCOPE: plugin vibefield.comment-pad is not granted surface.attach",
    });
    ce.dispose();
  });
});
