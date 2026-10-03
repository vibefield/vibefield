/**
 * DK-3 — the Canvas stage mounts the DESK, and what it wires per mount (the host swap).
 *
 * `<Desk>` and `deskLayer` are ICE's and draw nothing in happy-dom (no WebGPU), so this file
 * stands each in by a double that keeps their contract — `<Desk>` makes the layer from the factory
 * it is handed and calls `onReady`, undoing it at unmount; the layer's handle has a status the test
 * moves — and holds what the STAGE does with them:
 *   the THEME BRIDGE — the layer made in the owner's theme (the first frame painted in it, no
 *     flash) and re-dressed by `setTheme(deskTheme, deskPalette)` on every change, only a change;
 *   DESK_READY — said once the layer is ready AND its first frame presented, after CANVAS_READY;
 *   `failed` — the unavailable card in ICE's words, Reload a REMOUNT (a new layer on this engine),
 *     none where reloading won't help; `degraded` — the status line's banner and its Reload;
 *   a board from before the desk — its card, and no desk mounted at all;
 *   `window.__vfDesk` — installed for the mount, gone with it.
 * The real `<Desk>` with no GPU at all is `smoke:canvas --disable-gpu`'s (the card, nothing crashed).
 */
import type { DeskLayerOptions, DeskLayerStatus } from "@vibecook/ice/desk";
import { deskPalette, deskTheme } from "@vibecook/ice/desk/objects";
import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeHandle {
  readonly opts: DeskLayerOptions;
  state: DeskLayerStatus;
  frames: number;
  presented: number | undefined;
  readonly listeners: Set<(s: DeskLayerStatus) => void>;
  readonly setTheme: ReturnType<typeof vi.fn>;
  disposed: boolean;
  move(next: DeskLayerStatus): void;
}

const layers: FakeHandle[] = [];

function fakeHandle(opts: DeskLayerOptions): FakeHandle & Record<string, unknown> {
  const h = {
    opts,
    state: { state: "pending" } as DeskLayerStatus,
    frames: 0,
    presented: undefined as number | undefined,
    listeners: new Set<(s: DeskLayerStatus) => void>(),
    setTheme: vi.fn(),
    disposed: false,
    move(next: DeskLayerStatus) {
      h.state = next;
      for (const fn of [...h.listeners]) fn(next);
    },
    status: () => h.state,
    onStatus(fn: (s: DeskLayerStatus) => void) {
      h.listeners.add(fn);
      return () => h.listeners.delete(fn);
    },
    available: () => h.state.state === "ready" || h.state.state === "degraded",
    perf: () => ({
      ticks: 0,
      ms: 0,
      frames: h.frames,
      frameMs: 0,
      kindTicks: {},
      driverAsks: 0,
      boot: h.presented === undefined ? {} : { device: 1, compiled: 2, presented: h.presented },
    }),
    submits: () => undefined,
    setGlyphs: vi.fn(),
    setPlate: vi.fn(),
    setAmbient: vi.fn(),
    gpuMemory: () => undefined,
    pick: () => null,
    capture: async () => undefined,
    dispose() {
      h.disposed = true;
    },
  };
  return h;
}

vi.mock("@vibecook/ice/desk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vibecook/ice/desk")>();
  return {
    ...actual,
    deskLayer: (opts: DeskLayerOptions) => () => {
      const h = fakeHandle(opts);
      layers.push(h);
      return h;
    },
  };
});

vi.mock("@vibecook/ice/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vibecook/ice/react")>();
  function Desk({
    layer,
    onReady,
  }: {
    layer: (ctx: unknown) => { dispose(): void };
    onReady?: (h: unknown) => (() => void) | undefined;
  }): ReactElement {
    useEffect(() => {
      const handle = layer({});
      const undo = onReady?.({ layer: handle });
      return () => {
        if (typeof undo === "function") undo();
        handle.dispose();
      };
    }, [layer, onReady]);
    return createElement("div", { "data-fake-desk": "" });
  }
  return { ...actual, Desk };
});

const { CanvasStage } = await import("../src/field/CanvasStage");
const { createFieldEngine, buildRegistry } = await import("../src/field-engine");
const { emitCanvasReadyMarker, resetDeskMarkersForTest } = await import(
  "../src/development-console"
);
const { getStatusNotice, resetStatusLineForTest } = await import("../src/frame/status-line");
const { resetAppThemeForTest, setAppTheme } = await import("../src/theme");
const { BEFORE_THE_DESK } = await import("../src/field/desk/desk-words");

const NO_GPU =
  "no desk — the adapter, the device or the pipelines were refused: WebGPU is unavailable here (no navigator.gpu)";
const NO_ADAPTER =
  "no desk — the adapter, the device or the pipelines were refused: WebGPU: requestAdapter() returned null";
const PIPELINES =
  "no desk — the adapter, the device or the pipelines were refused: GPUPipelineError: invalid shader module";

let host: HTMLDivElement;
let root: Root;
let logs: string[];

beforeEach(() => {
  layers.length = 0;
  resetDeskMarkersForTest();
  resetStatusLineForTest();
  resetAppThemeForTest();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function mountStage(refused: boolean = false) {
  const ce = createFieldEngine(buildRegistry());
  await act(async () =>
    root.render(
      createElement(CanvasStage, {
        ce,
        keymapOverrides: [],
        generation: 7,
        refused: refused ? BEFORE_THE_DESK : null,
      }),
    ),
  );
  return ce;
}

const current = (): FakeHandle => {
  const h = layers.at(-1);
  if (h === undefined) throw new Error("no layer was made");
  return h;
};

describe("the Canvas stage mounts the desk", () => {
  it("makes the layer in the owner's theme and re-dresses it on every change — only a change", async () => {
    await act(async () => setAppTheme("light"));
    await mountStage();
    expect(layers).toHaveLength(1);
    expect(current().opts.theme).toEqual(deskTheme("light"));
    expect(current().opts.palette).toEqual(deskPalette("light"));
    expect(current().setTheme).not.toHaveBeenCalled(); // the first frame is already in it
    await act(async () => setAppTheme("dark"));
    expect(current().setTheme).toHaveBeenCalledTimes(1);
    expect(current().setTheme).toHaveBeenLastCalledWith(deskTheme("dark"), deskPalette("dark"));
    await act(async () => setAppTheme("dark"));
    expect(current().setTheme).toHaveBeenCalledTimes(1);
    expect((globalThis as { __vfDesk?: { theme(): string } }).__vfDesk?.theme()).toBe("dark");
  });

  it("paints the first frame in the owner's state whatever it is — a dark owner, a dark layer", async () => {
    await act(async () => setAppTheme("dark"));
    await mountStage();
    expect(current().opts.theme).toEqual(deskTheme("dark"));
    expect(current().opts.palette).toEqual(deskPalette("dark"));
    expect(current().setTheme).not.toHaveBeenCalled();
  });

  it("mounts the layer with the field's wiring: the catalog's kinds, the hand, the document, the store, the grid", async () => {
    const ce = await mountStage();
    const opts = current().opts;
    expect(opts.objects).toEqual([]);
    expect(opts.docs).toBe(ce.docs);
    expect(opts.text).toBeDefined();
    expect(opts.blobs).toBeDefined();
    expect(opts.grid?.mat.ruler.on).toBe(true);
    expect(opts.grid?.mat.ruler.margin).toBe(60);
    expect(opts.cursors).toBeUndefined(); // ICE's remote cursors stay until DK-16 (ruling 3)
  });

  it("says DESK_READY once ready AND the first frame presented — and after CANVAS_READY", async () => {
    await mountStage();
    const h = current();
    await act(async () => h.move({ state: "ready" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(logs.some((l) => l.startsWith("DESK_READY "))).toBe(false); // no frame yet
    h.frames = 1;
    h.presented = 12;
    await new Promise((r) => setTimeout(r, 50));
    expect(logs.some((l) => l.startsWith("DESK_READY "))).toBe(false); // CANVAS_READY first
    emitCanvasReadyMarker(1, 1, 0);
    const said = logs.filter((l) => l.startsWith("CANVAS_READY ") || l.startsWith("DESK_READY "));
    expect(said.map((l) => l.split(" ")[0])).toEqual(["CANVAS_READY", "DESK_READY"]);
    expect(JSON.parse(said[1]?.slice("DESK_READY ".length) ?? "{}")).toMatchObject({
      generation: 7,
      mount: 0,
      frames: 1,
      boot: { presented: 12 },
    });
  });

  it("shows the card when the desk fails, ICE's message verbatim, and Reload REMOUNTS the layer", async () => {
    await mountStage();
    const first = current();
    await act(async () => first.move({ state: "failed", message: PIPELINES }));
    const card = host.querySelector("[data-desk-unavailable]");
    expect(card?.getAttribute("data-desk-unavailable")).toBe("refused");
    expect(card?.querySelector("strong")?.textContent).toBe("The desk couldn't start its graphics");
    expect(card?.querySelector(".vf-ui-unavailable-state__detail")?.textContent).toBe(PIPELINES);
    const reload = [...(card?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Reload",
    );
    expect(reload).toBeDefined();
    await act(async () => reload?.click());
    expect(layers).toHaveLength(2); // a new layer on the same engine
    expect(first.disposed).toBe(true);
    expect(host.querySelector("[data-desk-unavailable]")).toBeNull(); // pending again
  });

  it("offers no Reload where there is no WebGPU at all, nor where it finds no adapter (DK-4)", async () => {
    await mountStage();
    await act(async () => current().move({ state: "failed", message: NO_GPU }));
    const card = host.querySelector("[data-desk-unavailable]");
    expect(card?.querySelector("strong")?.textContent).toBe("This computer can't draw the desk");
    expect([...(card?.querySelectorAll("button") ?? [])]).toHaveLength(0);
    await act(async () => current().move({ state: "failed", message: NO_ADAPTER }));
    const adapterless = host.querySelector("[data-desk-unavailable]");
    expect(adapterless?.getAttribute("data-desk-unavailable")).toBe("no-adapter");
    expect(adapterless?.querySelector("strong")?.textContent).toBe(
      "This computer can't draw the desk",
    );
    expect(adapterless?.querySelector(".vf-ui-unavailable-state__detail")?.textContent).toBe(
      NO_ADAPTER,
    );
    expect([...(adapterless?.querySelectorAll("button") ?? [])]).toHaveLength(0);
  });

  it("puts a degraded desk on the status line with its Reload, and withdraws it when it clears", async () => {
    await mountStage();
    const message = "an uncaptured GPU error — GPUOutOfMemoryError: out of memory";
    await act(async () => current().move({ state: "degraded", message }));
    expect(host.querySelector("[data-desk-unavailable]")).toBeNull(); // the desk draws on
    expect(getStatusNotice()?.text).toBe(message);
    expect(getStatusNotice()?.act?.label).toBe("Reload");
    await act(async () => getStatusNotice()?.act?.run());
    expect(layers).toHaveLength(2);
    expect(getStatusNotice()).toBeNull(); // the old mount's notice went with it
  });

  it("shows a refused board's card and mounts no desk at all", async () => {
    await mountStage(true);
    expect(layers).toHaveLength(0);
    expect(host.querySelector("[data-fake-desk]")).toBeNull();
    const card = host.querySelector("[data-desk-unavailable]");
    expect(card?.getAttribute("data-desk-unavailable")).toBe("before-the-desk");
    expect(card?.querySelector("strong")?.textContent).toBe("This board is from before the desk");
  });

  it("installs window.__vfDesk for its mount and takes it away with it", async () => {
    await mountStage();
    const door = (globalThis as { __vfDesk?: { generation: number; mount: number } }).__vfDesk;
    expect(door).toMatchObject({ generation: 7, mount: 0 });
    await act(async () => root.render(createElement("div")));
    expect((globalThis as { __vfDesk?: unknown }).__vfDesk).toBeUndefined();
  });
});
