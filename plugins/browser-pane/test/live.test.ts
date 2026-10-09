// PT-2 — THE PANE'S LIVE PAGE (src/live.ts, its local and its record): a FAKE host lending `LIVE` and counting its doors (the
// durable key, wake, redraw, remake, the desk's frames), a FAKE source whose faces a test fills — and ICE's own sight. A page
// opens by the pane's durable key with its spec, taken once at the open; a runtime entity, a desk with no `LIVE`, the sample and
// a blank page open none. An arrival wakes; the tick takes — a frame in the same texture REDRAWS, a new texture or new words
// REMAKE the pane — and answers false. The demand is the law's over the sight, change-only: at rest, held, unseen; a new
// viewport is sent at most once each PAGE_REMAKE_MS while the size moves, and once more when it rests. The record carries the
// face (the film before its first frame, its texture after), the head says the page's own words, the hand reads its address.
import {
  DEFAULT_GRID,
  type Entity,
  type KindHost,
  LIVE,
  type LiveDemand,
  type LiveFace,
  type LiveInfo,
  type LiveState,
  type LiveTexture,
  lampOf,
  type ObjectContext,
  type SlotContext,
} from "@vibefield/plugin-sdk/desk";
import { productPalette } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  browserPaneKind,
  createPaneLocal,
  deviceById,
  isPageUrl,
  PAGE_REMAKE_MS,
  PANE_SIZE,
  type PaneInstance,
  paneDemand,
  paneLook,
  SAMPLE_URL,
  shapeOf,
} from "../src";

const PAGE = "http://127.0.0.1:4321/page";

/** A face the test fills: its texture, its words, the demands it was sent, whether it was closed. */
function fakeFace(key: string, arrived: () => void) {
  let texture: { -readonly [K in keyof LiveTexture]: LiveTexture[K] } | undefined;
  let state: LiveState = { is: "starting" };
  let info: LiveInfo = {};
  let owed = false;
  const demands: LiveDemand[] = [];
  let closed = 0;
  /** The host's texture is ONE object for the face's life (ICE's writer): a present moves its revision, a resize its epoch. */
  const put = (t?: Partial<LiveTexture>): void => {
    if (texture === undefined)
      texture = {
        width: 2560,
        height: 1600,
        format: "rgba8unorm-srgb",
        revision: 0,
        epoch: 0,
        logical: [1280, 800],
        view: () => ({}) as never,
        prepare: () => {},
        bytes: 0,
      };
    Object.assign(texture, { revision: texture.revision + 1, ...t });
  };
  const face: LiveFace & {
    hold(): void;
    land(t?: Partial<LiveTexture>): void;
    say(next: { state?: LiveState; info?: LiveInfo }): void;
    demands: LiveDemand[];
    closed(): number;
  } = {
    key,
    texture: () => texture,
    take() {
      const was = owed;
      owed = false;
      return was;
    },
    state: () => state,
    info: () => info,
    demand: (d) => {
      demands.push(d);
    },
    close: () => {
      closed += 1;
    },
    hold() {
      // a frame the host already holds when the face opens (a page re-attached): owed, nothing told
      put();
      owed = true;
    },
    land(t) {
      put(t);
      owed = true;
      arrived();
    },
    say(next) {
      if (next.state !== undefined) state = next.state;
      if (next.info !== undefined) info = next.info;
      owed = true;
      arrived();
    },
    demands,
    closed: () => closed,
  };
  return face;
}

/** A host lending `LIVE` (or not), its doors counted; the desk's frames moved by the test. */
function fakeHost(opts: { live?: boolean; keys?: Record<number, string>; holds?: boolean } = {}) {
  const opened: { key: string; spec: Record<string, unknown> }[] = [];
  const faces = new Map<string, ReturnType<typeof fakeFace>>();
  const n = { wake: 0, redraw: 0, remake: [] as Entity[] };
  let frames = 0;
  const sources = {
    open(key: string, spec: Readonly<Record<string, unknown>>, arrived: () => void) {
      opened.push({ key, spec: { ...spec } });
      const f = fakeFace(key, arrived);
      if (opts.holds === true) f.hold();
      faces.set(key, f);
      return f;
    },
  };
  const keys = opts.keys ?? { 1: "13918995204487956201-1" };
  const host: KindHost = {
    pass: () => undefined,
    use: <T>(key: { name: string }) =>
      opts.live !== false && key.name === LIVE.name ? (sources as T) : undefined,
    keyOf: (e: Entity) => keys[e as number],
    wake: () => {
      n.wake += 1;
    },
    redraw: () => {
      n.redraw += 1;
    },
    remake: (e: Entity) => {
      n.remake.push(e);
    },
    frames: () => frames,
  };
  return {
    host,
    opened,
    faces,
    n,
    /** A frame drawn: the slot's view tells the sight what it drew of `e`'s page, then the count moves. */
    draw(local: ReturnType<typeof createPaneLocal>, e: Entity, zoom: number, target?: "hand") {
      const S = shapeOf(PANE_SIZE);
      const slot = { view: { zoom, dpr: 2 }, ...(target === undefined ? {} : { target }) };
      local.sight.saw(e, slot as unknown as SlotContext, {
        cx: 0,
        cy: 0,
        w: 2 * S.page[2],
        h: 2 * S.page[3],
      });
      frames += 1;
    },
    /** A frame drawn that did not show `e` (panned away). */
    skip() {
      frames += 1;
    },
  };
}

const S = shapeOf(PANE_SIZE);
const spec = {
  source: "browser",
  url: PAGE,
  viewport: S.viewport,
  deviceScaleFactor: S.device.dpr,
  scheme: "light",
  label: "127.0.0.1:4321",
} as const;

describe("the pane's live page — its faces", () => {
  it("opens a face per pane by its DURABLE key with the page's spec, taken once at the open; none for a runtime entity or with no LIVE", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    const face = local.face(1 as Entity, spec, S);
    expect(t.opened).toEqual([{ key: "13918995204487956201-1", spec: { ...spec } }]);
    expect(face).toBe(t.faces.get("13918995204487956201-1"));
    // the same pane asks again: the same face, no second open
    expect(local.face(1 as Entity, spec, S)).toBe(face);
    expect(t.opened).toHaveLength(1);
    // a runtime entity (a tray's ghost): no durable key, no face
    expect(local.face(2 as Entity, spec, S)).toBeUndefined();
    // a desk with no LIVE lent: none
    expect(
      createPaneLocal(fakeHost({ live: false }).host).face(1 as Entity, spec, S),
    ).toBeUndefined();
    expect(local.faces()).toMatchObject({ opened: 1, closed: 0 });
    // what the host already holds (a page re-attached) lands in the frame that opens it: TAKEN at the open, nothing told
    const held = fakeHost({ holds: true });
    const opener = createPaneLocal(held.host);
    expect(opener.face(1 as Entity, spec, S)?.texture()?.width).toBe(2560);
    expect(opener.faces()).toMatchObject({ opened: 1, landed: 1 });
    expect(held.n).toEqual({ wake: 0, redraw: 0, remake: [] });
  });

  it("an ARRIVAL wakes the desk; the tick TAKES — a frame in the same texture asks a REDRAW, a new texture or new words a REMAKE — and answers false", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    const face = local.face(1 as Entity, spec, S);
    const f = t.faces.get("13918995204487956201-1");
    if (face === undefined || f === undefined) throw new Error("no face");
    // the first frame: a new texture — the record reads its size: a remake
    f.land();
    expect(t.n.wake).toBe(1);
    expect(local.tick?.(0)).toBe(false);
    expect(t.n.remake).toEqual([1]);
    expect(t.n.redraw).toBe(0);
    // the next frame in the same texture: a redraw, no record remade
    f.land();
    local.tick?.(16);
    expect(t.n.redraw).toBe(1);
    expect(t.n.remake).toEqual([1]);
    // a new size: a new texture (its epoch moves) — a remake
    f.land({ width: 1280, height: 800, epoch: 1, revision: 3 });
    local.tick?.(32);
    expect(t.n.remake).toEqual([1, 1]);
    // new words (the page loading): a remake — the head and the loading line are the record's
    f.say({ info: { address: PAGE, loading: 0.5 } });
    local.tick?.(48);
    expect(t.n.remake).toEqual([1, 1, 1]);
    expect(local.page(1 as Entity)?.info).toEqual({ address: PAGE, loading: 0.5 });
    // nothing arrived: nothing taken
    local.tick?.(64);
    expect(t.n.redraw).toBe(1);
    expect(local.faces()).toMatchObject({ landed: 4, redraws: 1, remakes: 3 });
  });

  it("asks the LAW over the SIGHT, change-only: at rest the halving that covers the page, in the hand native at 60, unseen paused", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    local.face(1 as Entity, spec, S);
    const f = t.faces.get("13918995204487956201-1");
    if (f === undefined) throw new Error("no face");
    // nothing drawn yet: nothing asked
    local.tick?.(0);
    expect(f.demands).toEqual([]);
    // drawn at rest at a quarter size: the law's ask, once
    t.draw(local, 1 as Entity, 0.25);
    expect(local.due?.(10)).toBe(10); // a frame drawn: its sight's step is owed now
    local.tick?.(10);
    const atRest = paneDemand(
      local.sight.of(1 as Entity) ?? { seen: false, px: [0, 0], held: false },
      S,
    );
    expect(f.demands).toEqual([atRest]);
    expect(atRest).toMatchObject({
      mode: "live",
      fps: 30,
      interactive: false,
      viewport: S.viewport,
    });
    expect(atRest.raster[0]).toBeLessThan(S.viewport[0] * S.device.dpr);
    // drawn the same again: no new ask
    t.draw(local, 1 as Entity, 0.25);
    local.tick?.(26);
    expect(f.demands).toHaveLength(1);
    // drawn a hair bigger: the sight moves, but the law's ask is the same (its rung, its rate) — sent once, not again
    t.draw(local, 1 as Entity, 0.26);
    local.tick?.(28);
    expect(f.demands).toHaveLength(1);
    expect(local.due?.(30)).toBe(Number.POSITIVE_INFINITY); // stepped: nothing owed, nothing polled
    // in the hand: native at 60, interactive
    t.draw(local, 1 as Entity, 1, "hand");
    local.tick?.(42);
    expect(f.demands.at(-1)).toMatchObject({
      mode: "live",
      fps: 60,
      interactive: true,
      raster: [S.viewport[0] * S.device.dpr, S.viewport[1] * S.device.dpr],
    });
    // panned away — a frame drawn without it: paused, its layout kept
    t.skip();
    local.tick?.(58);
    expect(f.demands.at(-1)).toEqual({
      mode: "paused",
      fps: 0,
      raster: [0, 0],
      viewport: S.viewport,
      interactive: false,
    });
    expect(local.faces().demands).toBe(3);
  });

  it("a new size asks the law again: its VIEWPORT is the source's relayout — once each PAGE_REMAKE_MS while it moves, and once more at rest", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    local.face(1 as Entity, spec, S);
    const f = t.faces.get("13918995204487956201-1");
    if (f === undefined) throw new Error("no face");
    t.draw(local, 1 as Entity, 0.5);
    local.tick?.(0);
    expect(f.demands).toHaveLength(1);
    const wider = (dw: number) => shapeOf({ w: PANE_SIZE.w + dw, h: PANE_SIZE.h });
    // the hand drags the size: each frame a new viewport
    local.face(1 as Entity, spec, wider(20));
    local.tick?.(10); // within PAGE_REMAKE_MS of the last viewport: held back
    expect(f.demands).toHaveLength(1);
    expect(local.due?.(10)).toBe(PAGE_REMAKE_MS);
    local.face(1 as Entity, spec, wider(40));
    local.tick?.(PAGE_REMAKE_MS); // due: the latest size's viewport is sent
    expect(f.demands).toHaveLength(2);
    expect(f.demands.at(-1)?.viewport).toEqual(wider(40).viewport);
    local.face(1 as Entity, spec, wider(60));
    local.tick?.(PAGE_REMAKE_MS + 16);
    expect(f.demands).toHaveLength(2);
    // the size rests: once more, when due
    local.tick?.(2 * PAGE_REMAKE_MS);
    expect(f.demands.at(-1)?.viewport).toEqual(wider(60).viewport);
    expect(local.due?.(2 * PAGE_REMAKE_MS + 1)).toBe(Number.POSITIVE_INFINITY);
    expect(local.faces().held).toBe(2);
    // a device switch is a new viewport too
    const phone = shapeOf({ w: 201.03, h: 421.99 }, deviceById("phone"));
    local.face(1 as Entity, spec, phone);
    local.tick?.(4 * PAGE_REMAKE_MS);
    expect(f.demands.at(-1)?.viewport).toEqual(phone.viewport);
  });

  it("closes a face when its pane leaves, when its address stops being a page, and when the desk goes", () => {
    const t = fakeHost({ keys: { 1: "k-1", 2: "k-2" } });
    const local = createPaneLocal(t.host);
    local.face(1 as Entity, spec, S);
    local.face(2 as Entity, spec, S);
    local.forget?.(1 as Entity);
    expect(t.faces.get("k-1")?.closed()).toBe(1);
    expect(local.page(1 as Entity)).toBeUndefined();
    local.drop(2 as Entity);
    expect(t.faces.get("k-2")?.closed()).toBe(1);
    local.face(2 as Entity, spec, S);
    local.dispose?.();
    expect(t.faces.get("k-2")?.closed()).toBe(1); // the reopened face — a new one — closed with the desk
    expect(local.faces()).toMatchObject({ opened: 3, closed: 3 });
  });

  it("knows a web page from the sample and a blank page", () => {
    expect(isPageUrl(PAGE, SAMPLE_URL)).toBe(true);
    expect(isPageUrl("https://example.com/", SAMPLE_URL)).toBe(true);
    expect(isPageUrl(SAMPLE_URL, SAMPLE_URL)).toBe(false);
    expect(isPageUrl("about:blank", SAMPLE_URL)).toBe(false);
    expect(isPageUrl("file:///tmp/a.html", SAMPLE_URL)).toBe(false);
  });
});

const lamp = lampOf(DEFAULT_GRID.mat.plane);
const look = paneLook(productPalette.light);
const ctxOf = (props: Record<string, unknown>, local: unknown): ObjectContext =>
  ({
    entity: 1 as Entity,
    rect: { cx: 100, cy: 80, w: PANE_SIZE.w, h: PANE_SIZE.h },
    props,
    flux: { lift: 0, hover: 0, ring: 0, fade: 1 },
    look,
    theme: { name: "light" },
    lamp,
    view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 },
    grid: DEFAULT_GRID,
    dt: 0,
    local,
  }) as unknown as ObjectContext;

describe("the pane's live page — its record", () => {
  const k = browserPaneKind();

  it("carries the face: the film before its first frame, its texture after; the sample keeps its still and opens nothing", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    const G = k.resolve(ctxOf({ url: PAGE }, local));
    const before = k.record(G, ctxOf({ url: PAGE }, local)) as PaneInstance;
    expect(before.live?.face).toBe(t.faces.get("13918995204487956201-1"));
    expect(before.live?.sight).toBe(local.sight);
    expect(before.page).toBeNull(); // the film
    expect(before.loading).toBe(-1);
    // the page the record opened: its address, its viewport at its device's own density, the desk's scheme
    expect(t.opened[0]?.spec).toMatchObject({
      source: "browser",
      url: PAGE,
      viewport: S.viewport,
      deviceScaleFactor: S.device.dpr,
      scheme: "light",
    });
    t.faces.get("13918995204487956201-1")?.land({ width: 1280, height: 800 });
    local.tick?.(0);
    const after = k.record(G, ctxOf({ url: PAGE }, local)) as PaneInstance;
    expect(after.page).toEqual({
      key: "live|0|1280x800",
      viewport: S.viewport,
      scheme: "light",
      width: 1280,
      height: 800,
    });
    // the sample: its still, no face; the page it had is closed
    const sample = k.record(G, ctxOf({}, local)) as PaneInstance;
    expect(sample.live).toBeUndefined();
    expect(sample.page?.key).toMatch(/^sample\|/);
    expect(t.faces.get("13918995204487956201-1")?.closed()).toBe(1);
    // a blank page: the film, no face
    const blank = k.record(G, ctxOf({ url: "about:blank" }, local)) as PaneInstance;
    expect(blank.live).toBeUndefined();
    expect(blank.page).toBeNull();
    expect(t.opened).toHaveLength(1);
  });

  it("says the page's own words: the head its address, lock, loading and history; the loading line; the hand's word its address", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    const G = k.resolve(ctxOf({ url: PAGE }, local));
    k.record(G, ctxOf({ url: PAGE }, local));
    t.faces.get("13918995204487956201-1")?.say({
      state: { is: "live" },
      info: {
        address: "https://www.example.org/there",
        title: "There",
        loading: 0.5,
        back: true,
        forward: false,
      },
    });
    local.tick?.(0);
    const r = k.record(G, ctxOf({ url: PAGE }, local)) as PaneInstance;
    expect(r.loading).toBe(0.5);
    expect(local.said(1 as Entity)).toMatchObject({
      display: "example.org",
      secure: true,
      favicon: null,
      loading: true,
      canBack: true,
      canForward: false,
    });
    const word = k.open?.readout;
    expect(
      typeof word === "function"
        ? word({
            world: undefined as never,
            entity: 1 as Entity,
            props: () => ({ url: PAGE }),
            local,
          })
        : word,
    ).toBe("example.org");
  });
});
