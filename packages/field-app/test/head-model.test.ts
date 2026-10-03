// @vitest-environment happy-dom
/**
 * One Frame FR-3 — the head's model, below the views: which key presses which
 * zoom act (DK-D24's ⌘+ ⌘− ⌘0 ⇧1 on the Mac, Ctrl and Shift elsewhere), what
 * each act does to the camera, the palette's table of the frame's acts with
 * their keys, and the head's canvas door over a REAL engine (the nav path with
 * no synthesized "Root", the zoom as a percent). The views are head.test's and
 * command-palette.test's; delivery from a focused pane is the godview smoke's
 * row 11i.
 */
import { createCanvasEngine, NavDepth, NavFrame, PrefabId } from "@vibecook/ice";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasHead, headPathEqual, readHeadPath } from "../src/frame/head-canvas";
import { frameActGroups } from "../src/frame/palette-acts";
import { runZoom, zoomActForKey, zoomKeyLabel } from "../src/frame/zoom";

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

  it("follows the view: Godview's New terminal ⌘T, History's Resume waiting, no zoom off Canvas", () => {
    expect(rows("godview", "mac")[1]).toEqual(["On this view", ["New terminal ⌘T"]]);
    const history = frameActGroups("history", "mac")[1]?.acts ?? [];
    expect(history.map((act) => [act.name, act.waits])).toEqual([
      ["Resume this session", "choose a session first"],
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

  it("compares paths by depth and name", () => {
    expect(headPathEqual([{ depth: 1, label: "A" }], [{ depth: 1, label: "A" }])).toBe(true);
    expect(headPathEqual([{ depth: 1, label: "A" }], [{ depth: 1, label: "B" }])).toBe(false);
    expect(headPathEqual([], [{ depth: 1, label: "A" }])).toBe(false);
  });
});
