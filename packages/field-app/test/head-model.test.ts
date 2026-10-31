// @vitest-environment happy-dom
/**
 * One Frame FR-3 — the head's model, below the views: which key presses which
 * zoom act (DK-D24's ⌘+ ⌘− ⌘0 ⇧1 on the Mac, Ctrl and Shift elsewhere), what
 * each act does to the camera, the palette's table of the frame's acts with
 * their keys, and the head's canvas door over a REAL engine (the nav path with
 * no synthesized "Root", the zoom as a percent). HN-8: the sheet's two shelves
 * in the one owner's value, the package's dot read from the catalog, and why
 * the Artifacts shelf has no Hub. The views are head.test's and
 * command-palette.test's; delivery from a focused pane is the godview smoke's
 * row 11i.
 */
import { createCanvasEngine, NavDepth, NavFrame, PrefabId } from "@vibecook/ice";
import { ZOOM_MAX, ZOOM_MIN } from "@vibecook/ice/desk";
import type {
  ArtifactAvailability,
  ArtifactView,
  PluginRecordState,
  PluginRegistrySnapshot,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { type FrameSurface, sheetShelf } from "../src/frame/frame-surface";
import { artifactsDotWords, hubWaits, unavailableSources } from "../src/frame/head-artifacts";
import { canvasHead, headPathEqual, readHeadPath } from "../src/frame/head-canvas";
import { chosenSessionAct, frameActGroups } from "../src/frame/palette-acts";
import {
  formatZoomPercent,
  runZoom,
  zoomActAvailable,
  zoomActForKey,
  zoomKeyLabel,
  zoomPercent,
} from "../src/frame/zoom";

type Key = Parameters<typeof zoomActForKey>[0];
const key = (init: Partial<Key> & { key: string }): Key => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
});

describe("the zoom's keys (DK-D24)", () => {
  it("presses each act with ⌘ on the Mac — the character for + and −, the key for 0", () => {
    expect(zoomActForKey(key({ key: "=", metaKey: true, code: "Equal" }), "mac")).toBe("in");
    expect(
      zoomActForKey(key({ key: "+", metaKey: true, shiftKey: true, code: "Equal" }), "mac"),
    ).toBe("in");
    expect(zoomActForKey(key({ key: "+", metaKey: true, code: "NumpadAdd" }), "mac")).toBe("in");
    expect(zoomActForKey(key({ key: "-", metaKey: true, code: "Minus" }), "mac")).toBe("out");
    expect(zoomActForKey(key({ key: "-", metaKey: true, code: "NumpadSubtract" }), "mac")).toBe(
      "out",
    );
    expect(zoomActForKey(key({ key: "0", metaKey: true, code: "Digit0" }), "mac")).toBe("actual");
    // A layout that types something else on the digit row still presses ⌘0.
    expect(zoomActForKey(key({ key: "à", metaKey: true, code: "Digit0" }), "mac")).toBe("actual");
  });

  it("presses Zoom to fit with ⇧1 alone — the physical 1, or the ! it types", () => {
    expect(zoomActForKey(key({ key: "!", shiftKey: true, code: "Digit1" }), "mac")).toBe("fit");
    expect(zoomActForKey(key({ key: "!", shiftKey: true }), "mac")).toBe("fit");
    expect(zoomActForKey(key({ key: "1", shiftKey: true, code: "Digit1" }), "other")).toBe("fit");
    expect(zoomActForKey(key({ key: "1", code: "Digit1" }), "mac")).toBeNull();
    expect(zoomActForKey(key({ key: "@", shiftKey: true, code: "Digit2" }), "mac")).toBeNull();
    expect(
      zoomActForKey(key({ key: "!", shiftKey: true, metaKey: true, code: "Digit1" }), "mac"),
    ).toBeNull();
  });

  it("leaves every other chord alone: ⌘1 is a view's, ⌃ is not ⌘ on the Mac, ⌥ never", () => {
    expect(zoomActForKey(key({ key: "1", metaKey: true, code: "Digit1" }), "mac")).toBeNull();
    expect(zoomActForKey(key({ key: "=", ctrlKey: true, code: "Equal" }), "mac")).toBeNull();
    expect(
      zoomActForKey(key({ key: "=", metaKey: true, altKey: true, code: "Equal" }), "mac"),
    ).toBeNull();
    expect(zoomActForKey(key({ key: "=", code: "Equal" }), "mac")).toBeNull();
    expect(
      zoomActForKey(key({ key: "_", metaKey: true, shiftKey: true, code: "Minus" }), "mac"),
    ).toBeNull();
    expect(
      zoomActForKey(key({ key: ")", metaKey: true, shiftKey: true, code: "Digit0" }), "mac"),
    ).toBeNull();
  });

  it("takes Ctrl, never ⌘, off the Mac", () => {
    expect(zoomActForKey(key({ key: "=", ctrlKey: true, code: "Equal" }), "other")).toBe("in");
    expect(zoomActForKey(key({ key: "-", ctrlKey: true, code: "Minus" }), "other")).toBe("out");
    expect(zoomActForKey(key({ key: "0", ctrlKey: true, code: "Digit0" }), "other")).toBe("actual");
    expect(zoomActForKey(key({ key: "=", metaKey: true, code: "Equal" }), "other")).toBeNull();
  });

  it("says each key the platform's way", () => {
    expect(
      (["in", "out", "fit", "actual"] as const).map((act) => zoomKeyLabel(act, "mac")),
    ).toEqual(["⌘+", "⌘−", "⇧1", "⌘0"]);
    expect(
      (["in", "out", "fit", "actual"] as const).map((act) => zoomKeyLabel(act, "other")),
    ).toEqual(["Ctrl+Plus", "Ctrl+Minus", "Shift+1", "Ctrl+0"]);
  });
});

describe("the zoom's acts", () => {
  const target = (zoom: number) => ({
    zoom: () => zoom,
    zoomTo: vi.fn(),
    zoomToFit: vi.fn(),
  });

  it("steps in ×1.25 and out by its inverse (0.8), as the old − + did", () => {
    const at = target(1);
    runZoom(at, "in");
    expect(at.zoomTo).toHaveBeenLastCalledWith(1.25);
    runZoom(at, "out");
    expect(at.zoomTo).toHaveBeenLastCalledWith(0.8);
  });

  it("fits through the canvas's own fit, and actual size is 100%", () => {
    const at = target(2.5);
    runZoom(at, "fit");
    expect(at.zoomToFit).toHaveBeenCalledOnce();
    runZoom(at, "actual");
    expect(at.zoomTo).toHaveBeenLastCalledWith(1);
  });
});

describe("the palette's table of the frame's acts (One Frame §7)", () => {
  const rows = (view: Parameters<typeof frameActGroups>[0], keys: "mac" | "other") =>
    frameActGroups(view, keys).map((group) => [
      group.eyebrow,
      group.acts.map((act) => `${act.name}${act.key === null ? "" : ` ${act.key}`}`),
    ]);

  it("lists Views ⌘1–⌘4, Canvas's create and its zoom, and Settings — every act with its key", () => {
    expect(rows("canvas", "mac")).toEqual([
      ["Views", ["Canvas ⌘1", "Godview ⌘2", "History ⌘3", "Assistant ⌘4"]],
      [
        "On this view",
        ["Objects B", "Zoom in ⌘+", "Zoom out ⌘−", "Zoom to fit ⇧1", "Actual size ⌘0"],
      ],
      ["App", ["Settings… ⌘,"]],
    ]);
  });

  it("follows the view: Godview's New terminal ⌘T and System control, History's New terminal ⌘T and Resume waiting, no zoom off Canvas", () => {
    expect(rows("godview", "mac")[1]).toEqual([
      "On this view",
      ["New terminal ⌘T", "System control"],
    ]);
    // HN-7 (DESIGN.md §8 the palette): History's create is New terminal, which never waits,
    // and the chosen session's Resume follows it, waiting until a session is chosen
    expect(rows("history", "mac")[1]).toEqual([
      "On this view",
      ["New terminal ⌘T", "Resume this session"],
    ]);
    const history = frameActGroups("history", "mac")[1]?.acts ?? [];
    expect(history.map((act) => [act.id, act.glyph, act.waits, act.run.kind])).toEqual([
      ["create", "start", null, "create"],
      ["chosen-session", "resume", "choose a session first", "chosen-session"],
    ]);
    expect(rows("history", "other")[1]).toEqual([
      "On this view",
      ["New terminal Ctrl+T", "Resume this session"],
    ]);
  });

  it("says History's Jump to while the chosen session runs here — the room's reading, the line's create's until HN-7 (P3)", () => {
    const live = frameActGroups("history", "mac", null, true)[1]?.acts ?? [];
    expect(live.map((act) => [act.name, act.glyph, act.waits, act.run.kind])).toEqual([
      ["New terminal", "start", null, "create"],
      ["Jump to this session", "jump", null, "chosen-session"],
    ]);
    // the launcher's reason is said under Resume, whatever it is
    const waits = frameActGroups("history", "mac", "its folder is gone")[1]?.acts ?? [];
    expect(waits.find((act) => act.id === "chosen-session")?.waits).toBe("its folder is gone");
    // a live word from History never reaches another view's acts, and the chosen session's row
    // is History's alone
    expect(rows("godview", "mac")[1]).toEqual([
      "On this view",
      ["New terminal ⌘T", "System control"],
    ]);
    expect(frameActGroups("godview", "mac", null, true)[1]?.acts[0]?.glyph).toBe("start");
    for (const view of ["canvas", "godview", "assistant"] as const) {
      const acts = frameActGroups(view, "mac", null, true).flatMap((group) => group.acts);
      expect(
        acts.map((act) => act.id),
        view,
      ).not.toContain("chosen-session");
    }
  });

  it("names the chosen session's act as the line's create named it until HN-7: Resume, else Jump to while it runs here (P3)", () => {
    expect(chosenSessionAct(false)).toEqual({ glyph: "resume", name: "Resume this session" });
    expect(chosenSessionAct(true)).toEqual({ glyph: "jump", name: "Jump to this session" });
  });

  it("lists System control in Godview alone, with no key and no glyph, waiting only while its door is not there (GV-D1)", () => {
    const control = (view: Parameters<typeof frameActGroups>[0], waits?: string | null) =>
      frameActGroups(view, "mac", null, false, waits)
        .flatMap((group) => group.acts)
        .find((act) => act.id === "system-control");
    expect(control("godview")).toEqual({
      id: "system-control",
      name: "System control",
      glyph: null,
      key: null,
      waits: null,
      run: { kind: "system-control" },
    });
    // it has no key on any platform: the palette is its one door
    expect(
      frameActGroups("godview", "other")[1]?.acts.find((act) => act.id === "system-control")?.key,
    ).toBeNull();
    expect(control("godview", "Godview is still opening")?.waits).toBe("Godview is still opening");
    for (const view of ["canvas", "history", "assistant"] as const) {
      expect(control(view), view).toBeUndefined();
    }
    // it stands in the view's own group, after the create
    expect(frameActGroups("godview", "mac")[1]?.acts.map((act) => act.id)).toEqual([
      "create",
      "system-control",
    ]);
  });

  it("says the waiting Assistant waits, and the keys the Windows way", () => {
    const views = frameActGroups("canvas", "other")[0]?.acts ?? [];
    expect(views.find((act) => act.id === "view-assistant")?.waits).toBe("not built yet");
    expect(rows("canvas", "other")).toEqual([
      ["Views", ["Canvas Ctrl+1", "Godview Ctrl+2", "History Ctrl+3", "Assistant Ctrl+4"]],
      [
        "On this view",
        [
          "Objects B",
          "Zoom in Ctrl+Plus",
          "Zoom out Ctrl+Minus",
          "Zoom to fit Shift+1",
          "Actual size Ctrl+0",
        ],
      ],
      ["App", ["Settings… Ctrl+,"]],
    ]);
  });
});

describe("the head's canvas door over a real engine", () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it("is ONE name at the field's top — no synthesized Root (F12)", () => {
    const engine = createCanvasEngine({});
    dispose = () => engine.dispose();
    expect(readHeadPath(engine)).toEqual([]);
    expect(canvasHead(engine).path()).toEqual([]);
  });

  it("reads the nav stack as folders, outermost first, and tells its readers once it moves", () => {
    const engine = createCanvasEngine({});
    dispose = () => engine.dispose();
    const head = canvasHead(engine);
    const heard = vi.fn();
    const stop = head.subscribePath(heard);
    const first = head.path();
    const folder = engine.world.spawn({ components: [[PrefabId, { id: "vibefield.folder" }]] });
    const entry = engine.world.spawn({ components: [[NavDepth, { d: 1 }]] });
    engine.world.setRelation(entry, NavFrame, folder);
    engine.world.reactive.notify();
    expect(heard).toHaveBeenCalled();
    // No widget names a title for this prefab, so its id is the honest label.
    expect(head.path()).toEqual([{ depth: 1, label: "vibefield.folder" }]);
    expect(head.path()).toBe(head.path());
    expect(head.path()).not.toBe(first);
    stop();
  });

  it("says the zoom as a whole percent", () => {
    const engine = createCanvasEngine({});
    dispose = () => engine.dispose();
    expect(canvasHead(engine).percent()).toBe(100);
  });

  it("reads the DESK engine's own band — scale-free, never a 0.25–3 constant (DK-3, ruling 5)", () => {
    const engine = createFieldEngine(buildRegistry());
    dispose = () => engine.dispose();
    const head = canvasHead(engine);
    expect(head.bounds?.()).toEqual({ min: ZOOM_MIN, max: ZOOM_MAX });
    head.zoomTo(0.004); // far below the old 0.25 clamp
    expect(head.zoom()).toBeCloseTo(0.004, 9);
    expect(head.percent()).toBe(0.4);
    head.zoomTo(40); // far above the old 3
    expect(head.percent()).toBe(4000);
    runZoom(head, "in");
    expect(head.zoom()).toBeCloseTo(50, 9);
  });

  it("compares paths by depth and name", () => {
    expect(headPathEqual([{ depth: 1, label: "A" }], [{ depth: 1, label: "A" }])).toBe(true);
    expect(headPathEqual([{ depth: 1, label: "A" }], [{ depth: 1, label: "B" }])).toBe(false);
    expect(headPathEqual([], [{ depth: 1, label: "A" }])).toBe(false);
  });
});

describe("the pill's sheet in the one owner's value (HN-8, PL-D1)", () => {
  it("names the shelf that shows — Fields or Artifacts — and no other surface is the sheet", () => {
    expect(sheetShelf("fields")).toBe("fields");
    expect(sheetShelf("artifacts")).toBe("artifacts");
    const others: readonly (FrameSurface | null)[] = [
      null,
      "objects",
      "zoom",
      "palette",
      "me",
      "cards",
      "search",
      "selection",
    ];
    for (const surface of others) {
      expect(sheetShelf(surface), String(surface)).toBeNull();
    }
  });
});

/** A catalog row as `artifact.subscribe` sends it; only its title and state matter here. */
function row(title: string, availability: ArtifactAvailability): ArtifactView {
  return { title, availability } as unknown as ArtifactView;
}

describe("the package's dot (HN-8, PL-D1) — the catalog's standing state, in words", () => {
  it("is the source-unavailable artifacts alone, by title, in the catalog's order", () => {
    expect(
      unavailableSources([
        row("vibe-field", "source-unavailable"),
        row("Docs", "active"),
        row("Renderer preview", "source-unavailable"),
        row("Old site", "offline"),
        row("Fresh", "starting"),
        row("Broken", "error"),
      ]),
    ).toEqual(["vibe-field", "Renderer preview"]);
  });

  it("says one source by its title, past one how many, and nothing — no dot — while all are there", () => {
    expect(artifactsDotWords([])).toBeNull();
    expect(artifactsDotWords(["vibe-field"])).toBe(
      "Artifacts — vibe-field's source is unavailable",
    );
    expect(artifactsDotWords(["vibe-field", "Docs"])).toBe("Artifacts — 2 sources unavailable");
    expect(artifactsDotWords(["a", "b", "c"])).toBe("Artifacts — 3 sources unavailable");
  });
});

/** The registry with these plugins, each in the state the registry folds it to (§9.3) and each
 * offering the side panel unless it names another slot — only the fields read here. */
function registryOf(
  ...plugins: ReadonlyArray<readonly [state: PluginRecordState, slot?: string]>
): PluginRegistrySnapshot {
  return {
    generation: 1,
    problems: [],
    plugins: plugins.map(([state, slot = "hud.side-panel"], index) => ({
      id: `vibefield.plugin-${index}`,
      state,
      contributions: { surfaces: [{ slot }] },
    })),
  } as unknown as PluginRegistrySnapshot;
}

describe('why the Artifacts shelf has no Hub (HN-8; DESIGN.md §8 "Artifacts"; ruling 10)', () => {
  it("is off while the plugin that offers the side panel is `disabled` — the one state that turning it on would help", () => {
    expect(hubWaits(registryOf(["disabled"]))).toBe("off");
  });

  it("can't run while that plugin is `invalid` or `incompatible` — on or off alike — or while none offers the side panel", () => {
    expect(hubWaits(registryOf(["invalid"]))).toBe("cant-run");
    expect(hubWaits(registryOf(["incompatible"]))).toBe("cant-run");
    // a plugin that is on but offers another slot brings no Hub
    expect(hubWaits(registryOf(["enabled", "hud.panel"]))).toBe("cant-run");
    expect(hubWaits(registryOf())).toBe("cant-run");
  });

  it("is opening while that plugin is on and its Hub not yet bound — and before any registry", () => {
    expect(hubWaits(registryOf(["enabled"]))).toBe("opening");
    expect(hubWaits(null)).toBe("opening");
  });

  it("lets the plugin likelier to bring a Hub speak, should two offer it", () => {
    expect(hubWaits(registryOf(["invalid"], ["enabled"]))).toBe("opening");
    expect(hubWaits(registryOf(["incompatible"], ["disabled"]))).toBe("off");
  });
});

describe("the zoom's band and its readout (DK-3, ruling 5 — the desk's scale-free zoom)", () => {
  it("prints any zoom the desk allows as one number: whole from 10%, finer below, never 0%", () => {
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(1.25)).toBe(125);
    expect(zoomPercent(0.1)).toBe(10);
    expect(zoomPercent(0.042)).toBe(4.2);
    expect(zoomPercent(0.004)).toBe(0.4);
    expect(zoomPercent(ZOOM_MIN)).toBe(0.000001);
    expect(zoomPercent(ZOOM_MAX)).toBe(10_000_000_000);
    expect(formatZoomPercent(zoomPercent(ZOOM_MAX))).toBe("10,000,000,000");
    expect(formatZoomPercent(zoomPercent(ZOOM_MIN))).toBe("0.000001");
    expect(formatZoomPercent(125)).toBe("125");
  });

  it("steps in and out by 1.25 inside the engine's band, and says which acts the band's ends stop", () => {
    let zoom = 1;
    const target = {
      zoom: () => zoom,
      zoomTo: (z: number) => {
        zoom = z;
      },
      zoomToFit: () => undefined,
      bounds: () => ({ min: 0.5, max: 2 }),
    };
    runZoom(target, "in");
    expect(zoom).toBe(1.25);
    runZoom(target, "out");
    runZoom(target, "out");
    expect(zoom).toBeCloseTo(0.8, 9);
    zoom = 1.9;
    runZoom(target, "in");
    expect(zoom).toBe(2); // clamped to the band
    expect(zoomActAvailable("in", 2, target.bounds())).toBe(false);
    expect(zoomActAvailable("out", 2, target.bounds())).toBe(true);
    expect(zoomActAvailable("out", 0.5, target.bounds())).toBe(false);
    expect(zoomActAvailable("fit", 0.5, target.bounds())).toBe(true);
    expect(zoomActAvailable("in", 9, undefined)).toBe(true);
  });
});
