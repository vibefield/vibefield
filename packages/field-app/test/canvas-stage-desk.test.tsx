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
 *   THE RELAUNCH HEAL (DK-5) by its RULE (DK-9) — a boot whose device never arrived is mounted again
 *     before any card (`DESK_RETRY`): a missing adapter three times over ~2 s, a refused device once;
 *     a device that arrived is never retried, nor a Reload the person asked for;
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
  /** The context the layer was mounted with — its structural `catalog` (DK-9). */
  ctx?: { catalog?: { widgetTypes(): readonly { type: string }[] } };
  state: DeskLayerStatus;
  frames: number;
  /** ms since the mount the device arrived — undefined until it does (ICE's `perf().boot.device`). */
  device: number | undefined;
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
    device: undefined as number | undefined,
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
      boot: {
        ...(h.device === undefined ? {} : { device: h.device }),
        ...(h.presented === undefined ? {} : { compiled: 2, presented: h.presented }),
      },
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
    deskLayer: (opts: DeskLayerOptions) => (ctx: FakeHandle["ctx"]) => {
      const h = fakeHandle(opts);
      if (ctx !== undefined) h.ctx = ctx;
      layers.push(h);
      return h;
    },
  };
});

vi.mock("@vibecook/ice/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vibecook/ice/react")>();
  function Desk({
    engine,
    layer,
    onReady,
  }: {
    engine?: { catalog: unknown };
    layer: (ctx: unknown) => { dispose(): void };
    onReady?: (h: unknown) => (() => void) | undefined;
  }): ReactElement {
    useEffect(() => {
      const handle = layer({ catalog: engine?.catalog });
      const undo = onReady?.({ layer: handle });
      return () => {
        if (typeof undo === "function") undo();
        handle.dispose();
      };
    }, [engine, layer, onReady]);
    return createElement("div", { "data-fake-desk": "" });
  }
  return { ...actual, Desk };
});

const { CanvasStage } = await import("../src/field/CanvasStage");
const { createFieldEngine, buildRegistry, seedField } = await import("../src/field-engine");
const { createDeskBlobStore } = await import("../src/field/desk/desk-blobs");
const { resetDeskNoticesForTest } = await import("../src/field/desk/desk-notices");
const { emitCanvasReadyMarker, resetDeskMarkersForTest } = await import(
  "../src/development-console"
);
const { getStatusNotice, resetStatusLineForTest, STATUS_STAND_MS, statusLineSaid } = await import(
  "../src/frame/status-line"
);
const { resetAppThemeForTest, setAppTheme } = await import("../src/theme");
const { BEFORE_THE_DESK } = await import("../src/field/desk/desk-words");
const { DEVICE_RETRY_MS, HEAL_DELAYS_MS, REFUSE_DEVICE, REFUSE_FIRST_DEVICE } = await import(
  "../src/field/desk/desk-gpu"
);

const NO_GPU =
  "no desk — the adapter, the device or the pipelines were refused: WebGPU is unavailable here (no navigator.gpu)";
const NO_ADAPTER =
  "no desk — the adapter, the device or the pipelines were refused: WebGPU: requestAdapter() returned null";
const PIPELINES =
  "no desk — the adapter, the device or the pipelines were refused: GPUPipelineError: invalid shader module";
/** A `requestDevice` rejected with no device in hand — an adapter lost mid-request. */
const REFUSED_DEVICE =
  "no desk — the adapter, the device or the pipelines were refused: OperationError: the adapter was lost";
const NO_ADAPTER_WAITS = HEAL_DELAYS_MS["no-adapter"];
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
const retries = (): Record<string, unknown>[] =>
  logs
    .filter((l) => l.startsWith("DESK_RETRY "))
    .map((l) => JSON.parse(l.slice("DESK_RETRY ".length)) as Record<string, unknown>);

let host: HTMLDivElement;
let root: Root;
let logs: string[];

beforeEach(() => {
  layers.length = 0;
  resetDeskMarkersForTest();
  resetStatusLineForTest();
  resetDeskNoticesForTest();
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

async function mountStage(refused: boolean = false, kinds?: unknown, seeded = false) {
  const ce = createFieldEngine(buildRegistry());
  // DK-11: a board laid with the first-run seed (the six and the pad), for the rows that read its census
  if (seeded) await seedField(ce, ce.docs.create(), createDeskBlobStore());
  await act(async () =>
    root.render(
      createElement(CanvasStage, {
        ce,
        keymapOverrides: [],
        generation: 7,
        refused: refused ? BEFORE_THE_DESK : null,
        ...(kinds === undefined ? {} : { kinds: kinds as never }),
      }),
    ),
  );
  return ce;
}

/** The window's kinds as the stage reads them (DK-9): the types left off the desk, and a version. */
function fakeKinds(off: readonly string[] = []) {
  const listeners = new Set<() => void>();
  let version = 0;
  let current = new Set(off);
  return {
    off: () => current,
    version: () => version,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** A plugin turned off or on: the off set moves and the stage is told. */
    move(next: readonly string[]) {
      current = new Set(next);
      version += 1;
      for (const fn of [...listeners]) fn();
    },
  };
}

const mountedTypes = (h: FakeHandle): string[] =>
  (h.ctx?.catalog?.widgetTypes() ?? []).map((type) => type.type);

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
    h.device = 1;
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
    first.device = 3; // the device arrived; its pipelines were refused — nothing late to retry
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

  it("offers no Reload — and no retry — where there is no WebGPU at all", async () => {
    await mountStage();
    await act(async () => current().move({ state: "failed", message: NO_GPU }));
    const card = host.querySelector("[data-desk-unavailable]");
    expect(card?.getAttribute("data-desk-unavailable")).toBe("no-webgpu");
    expect(card?.querySelector("strong")?.textContent).toBe("This computer can't draw the desk");
    expect([...(card?.querySelectorAll("button") ?? [])]).toHaveLength(0);
    expect(layers).toHaveLength(1); // a page with no WebGPU cannot grow one: no retry
    expect(logs.some((l) => l.startsWith("DESK_RETRY "))).toBe(false);
  });

  it("retries a boot whose adapter never answered — the late GPU process — after half a second, with no card meanwhile (the relaunch heal)", async () => {
    await mountStage();
    emitCanvasReadyMarker(1, 1, 0);
    const first = current();
    await act(async () => first.move({ state: "failed", message: NO_ADAPTER }));
    expect(host.querySelector("[data-desk-unavailable]")).toBeNull();
    expect(host.querySelector('[data-desk="retrying"]')).not.toBeNull();
    expect(layers).toHaveLength(1);
    expect(logs.some((l) => l.startsWith("DESK_UNAVAILABLE "))).toBe(false);
    expect(retries()).toEqual([
      {
        generation: 7,
        mount: 0,
        kind: "no-adapter",
        message: NO_ADAPTER,
        attempt: 1,
        of: 3,
        afterMs: NO_ADAPTER_WAITS[0],
      },
    ]);
    await wait((NO_ADAPTER_WAITS[0] ?? 0) + 60);
    expect(layers).toHaveLength(2); // a new mount on the same engine
    expect(first.disposed).toBe(true);
    const second = current();
    expect(second.opts.name).toBe("vibefield/desk#1");
    expect(host.querySelector("[data-desk-unavailable]")).toBeNull();
    await act(async () => second.move({ state: "ready" }));
    second.frames = 1;
    second.device = 2;
    second.presented = 9;
    await new Promise((r) => setTimeout(r, 50));
    const ready = logs.find((l) => l.startsWith("DESK_READY "));
    expect(JSON.parse(ready?.slice("DESK_READY ".length) ?? "{}")).toMatchObject({
      generation: 7,
      mount: 1,
    });
  });

  it("retries a missing adapter THREE times over ~2 s, then the card — no Reload where it finds none — and no more (DK-9's rule)", async () => {
    await mountStage();
    emitCanvasReadyMarker(1, 1, 0);
    expect(NO_ADAPTER_WAITS.reduce((a, b) => a + b, 0)).toBe(2_000);
    for (const [index, afterMs] of NO_ADAPTER_WAITS.entries()) {
      await act(async () => current().move({ state: "failed", message: NO_ADAPTER }));
      expect(host.querySelector("[data-desk-unavailable]")).toBeNull(); // no card while it retries
      expect(retries().at(-1)).toMatchObject({ mount: index, attempt: index + 1, of: 3, afterMs });
      await wait(afterMs + 60);
    }
    expect(layers).toHaveLength(4);
    await act(async () => current().move({ state: "failed", message: NO_ADAPTER }));
    const card = host.querySelector("[data-desk-unavailable]");
    expect(card?.getAttribute("data-desk-unavailable")).toBe("no-adapter");
    expect(card?.querySelector("strong")?.textContent).toBe("This computer can't draw the desk");
    expect(card?.querySelector(".vf-ui-unavailable-state__detail")?.textContent).toBe(NO_ADAPTER);
    expect([...(card?.querySelectorAll("button") ?? [])]).toHaveLength(0);
    expect(retries()).toHaveLength(3);
    expect(logs.filter((l) => l.startsWith("DESK_UNAVAILABLE "))).toHaveLength(1);
    await new Promise((r) => setTimeout(r, (NO_ADAPTER_WAITS.at(-1) ?? 0) + 60));
    expect(layers).toHaveLength(4); // three means three
  });

  it("retries a REFUSED device — an adapter lost mid-request — ONCE, then the card with its Reload; that Reload is never retried (DK-9's rule)", async () => {
    await mountStage();
    emitCanvasReadyMarker(1, 1, 0);
    await act(async () => current().move({ state: "failed", message: REFUSED_DEVICE }));
    expect(host.querySelector("[data-desk-unavailable]")).toBeNull();
    expect(retries()).toEqual([
      {
        generation: 7,
        mount: 0,
        kind: "refused",
        message: REFUSED_DEVICE,
        attempt: 1,
        of: 1,
        afterMs: DEVICE_RETRY_MS,
      },
    ]);
    await wait(DEVICE_RETRY_MS + 60);
    expect(layers).toHaveLength(2);
    await act(async () => current().move({ state: "failed", message: REFUSED_DEVICE }));
    const card = host.querySelector("[data-desk-unavailable]");
    expect(card?.getAttribute("data-desk-unavailable")).toBe("refused");
    expect(retries()).toHaveLength(1); // once means once
    expect(logs.filter((l) => l.startsWith("DESK_UNAVAILABLE "))).toHaveLength(1);
    const reload = [...(card?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Reload",
    );
    expect(reload).toBeDefined();
    await act(async () => reload?.click());
    expect(layers).toHaveLength(3);
    await act(async () => current().move({ state: "failed", message: REFUSED_DEVICE }));
    // the person's Reload is outside the heal's chain: its failure is the card at once
    expect(
      host.querySelector("[data-desk-unavailable]")?.getAttribute("data-desk-unavailable"),
    ).toBe("refused");
    expect(retries()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, DEVICE_RETRY_MS + 60));
    expect(layers).toHaveLength(3);
  });

  it("never retries a Reload the person asked for, even with the heal's budget unspent — it is outside the chain", async () => {
    await mountStage();
    emitCanvasReadyMarker(1, 1, 0);
    const first = current();
    first.device = 3; // the boot's device arrived; its pipelines were refused — not the heal's
    await act(async () => first.move({ state: "failed", message: PIPELINES }));
    const reload = [...host.querySelectorAll("[data-desk-unavailable] button")].find(
      (b) => b.textContent === "Reload",
    ) as HTMLButtonElement | undefined;
    await act(async () => reload?.click());
    expect(layers).toHaveLength(2);
    // the Reload's mount finds no adapter — healable by kind, but no heal mount: the card at once
    await act(async () => current().move({ state: "failed", message: NO_ADAPTER }));
    expect(
      host.querySelector("[data-desk-unavailable]")?.getAttribute("data-desk-unavailable"),
    ).toBe("no-adapter");
    expect(retries()).toHaveLength(0);
    await new Promise((r) => setTimeout(r, (NO_ADAPTER_WAITS[0] ?? 0) + 60));
    expect(layers).toHaveLength(2);
  });

  it("hands the boot's FIRST mount a GPU with no adapter under the smoke's door — and the retry the real one", async () => {
    const before = `${location.pathname}${location.search}`;
    const gpu = {
      requestAdapter: async () => ({ fake: true }),
      getPreferredCanvasFormat: () => "bgra8unorm",
      wgslLanguageFeatures: new Set<string>(),
    };
    Object.defineProperty(navigator, "gpu", { value: gpu, configurable: true });
    history.replaceState(
      null,
      "",
      `${location.pathname}?godviewMarkers=1&${REFUSE_FIRST_DEVICE}=1`,
    );
    try {
      await mountStage();
      const refusing = current().opts.gpu;
      expect(refusing).toBeDefined();
      expect(await refusing?.requestAdapter()).toBeNull();
      await act(async () => current().move({ state: "failed", message: NO_ADAPTER }));
      await wait((NO_ADAPTER_WAITS[0] ?? 0) + 60);
      expect(layers).toHaveLength(2);
      expect(current().opts.gpu).toBeUndefined(); // the layer's own navigator.gpu
    } finally {
      history.replaceState(null, "", before);
      Reflect.deleteProperty(navigator, "gpu");
    }
  });

  it("hands the first N mounts an adapter that REFUSES its device under the smoke's refusal door — the adapter otherwise its own", async () => {
    const before = `${location.pathname}${location.search}`;
    const adapter = {
      features: new Set(["timestamp-query"]),
      requestDevice: async () => ({ device: true }),
    };
    const gpu = {
      requestAdapter: async () => adapter,
      getPreferredCanvasFormat: () => "bgra8unorm",
      wgslLanguageFeatures: new Set<string>(),
    };
    Object.defineProperty(navigator, "gpu", { value: gpu, configurable: true });
    history.replaceState(null, "", `${location.pathname}?${REFUSE_DEVICE}=2`);
    try {
      await mountStage();
      const refusing = current().opts.gpu;
      expect(refusing).toBeDefined();
      const lent = (await refusing?.requestAdapter()) as unknown as typeof adapter;
      expect(lent.features.has("timestamp-query")).toBe(true); // the real adapter's own members
      await expect(lent.requestDevice()).rejects.toThrow(/the device was refused/);
      await act(async () => current().move({ state: "failed", message: REFUSED_DEVICE }));
      await wait(DEVICE_RETRY_MS + 60);
      expect(layers).toHaveLength(2);
      expect(current().opts.gpu).toBeDefined(); // mount 1 of 2 refused too
      await act(async () => current().move({ state: "failed", message: REFUSED_DEVICE }));
      const reload = [...host.querySelectorAll("[data-desk-unavailable] button")].find(
        (b) => b.textContent === "Reload",
      ) as HTMLButtonElement | undefined;
      await act(async () => reload?.click());
      expect(layers).toHaveLength(3);
      expect(current().opts.gpu).toBeUndefined(); // mount 2: the layer's own navigator.gpu
    } finally {
      history.replaceState(null, "", before);
      Reflect.deleteProperty(navigator, "gpu");
    }
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

  it("DK-9: mounts the layer WITHOUT the kinds of a plugin that is off — its objects wear ICE's missing face", async () => {
    await mountStage(false, fakeKinds(["vibefield.comment-pad"]));
    const types = mountedTypes(current());
    expect(types).toContain("desk.note"); // the desk's own, and every kind that is on
    expect(types).not.toContain("vibefield.comment-pad");
  });

  it("DK-9: REMOUNTS when the window's kinds change — a new mount, the layer made with the kinds of what is on", async () => {
    const kinds = fakeKinds();
    await mountStage(false, kinds);
    const first = current();
    expect(mountedTypes(first)).toContain("vibefield.comment-pad");
    await act(async () => kinds.move(["vibefield.comment-pad"])); // the pad's plugin turned off
    expect(layers).toHaveLength(2);
    expect(first.disposed).toBe(true);
    expect(current().opts.name).toBe("vibefield/desk#1");
    expect(mountedTypes(current())).not.toContain("vibefield.comment-pad");
    await act(async () => kinds.move([])); // and on again
    expect(layers).toHaveLength(3);
    expect(mountedTypes(current())).toContain("vibefield.comment-pad");
  });

  it('DK-9: the door says the bar\'s words — a kind that is off: its title and "plugin off"', async () => {
    await mountStage(false, fakeKinds(["vibefield.comment-pad"]));
    const door = (
      globalThis as { __vfDesk?: { words(type: string): { label: string; state: string | null } } }
    ).__vfDesk;
    expect(door?.words("vibefield.comment-pad")).toMatchObject({ state: "plugin off" });
    expect(door?.words("desk.note")).toMatchObject({ state: null });
    expect(door?.words("vendor.absent.thing")).toMatchObject({
      state: "no kind",
      label: "vendor.absent.thing · no kind",
    });
  });

  it("DK-11: says each type the desk draws as missing on the status line ONCE, at the mount's first frame — a remount says nothing again", async () => {
    const kinds = fakeKinds(["vibefield.comment-pad"]);
    await mountStage(false, kinds, true);
    const presented = async (h: FakeHandle): Promise<void> => {
      h.frames = 1;
      h.device = 1;
      h.presented = 12;
      await act(async () => h.move({ state: "ready" }));
      await wait(50);
    };
    expect(statusLineSaid()).toEqual([]); // nothing before the first frame
    await presented(current());
    const once = [
      {
        id: "missing:vibefield.comment-pad:plugin off",
        text: "vibefield.comment-pad · plugin off",
      },
    ];
    expect(statusLineSaid()).toEqual(once);
    expect(getStatusNotice()?.text).toBe("vibefield.comment-pad · plugin off");
    await wait(STATUS_STAND_MS + 50); // said, and gone: the line's own dedupe no longer stands in for "once"
    expect(getStatusNotice()).toBeNull();
    // the window's kinds move again with the pad still off — a new mount: its word is not said a second time
    await act(async () => kinds.move(["vibefield.comment-pad"]));
    expect(layers).toHaveLength(2);
    await presented(current());
    expect(statusLineSaid().filter((n) => n.id.startsWith("missing:"))).toEqual(once);
  });

  it("installs window.__vfDesk for its mount and takes it away with it", async () => {
    await mountStage();
    const door = (globalThis as { __vfDesk?: { generation: number; mount: number } }).__vfDesk;
    expect(door).toMatchObject({ generation: 7, mount: 0 });
    await act(async () => root.render(createElement("div")));
    expect((globalThis as { __vfDesk?: unknown }).__vfDesk).toBeUndefined();
  });
});
