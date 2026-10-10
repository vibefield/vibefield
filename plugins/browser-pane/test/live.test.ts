// PT-2 — THE PANE'S LIVE PAGE (src/live.ts, its local and its record): a FAKE host lending `LIVE` and counting its doors (the
// durable key, wake, redraw, remake, the desk's frames), a FAKE source whose faces a test fills — and ICE's own sight. A page
// opens by the pane's durable key with its spec, taken once at the open; a runtime entity, a desk with no `LIVE`, the sample and
// a blank page open none. An arrival wakes; the tick takes — a frame in the same texture REDRAWS, a new texture or new words
// REMAKE the pane — and answers false. The demand is the law's over the sight, change-only: at rest, held, unseen; a new
// viewport is sent at most once each PAGE_REMAKE_MS while the size moves, and once more when it rests. The record carries the
// face (the film before its first frame, its texture after), the head says the page's own words, the hand reads its address.
import {
  BROWSER_NAVIGATION,
  type BrowserNavigationCommand,
  DEFAULT_GRID,
  type Entity,
  type HeldEvent,
  type KindHost,
  LIVE,
  type LiveDemand,
  type LiveFace,
  type LiveInfo,
  type LiveInput,
  type LiveState,
  type LiveTexture,
  lampOf,
  type ObjectContext,
  type SlotContext,
} from "@vibefield/plugin-sdk/desk";
import { productPalette } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  bandLayout,
  browserPaneKind,
  createPaneLocal,
  cutOf,
  deviceById,
  deviceIdentity,
  faceOfPage,
  faviconId,
  GENERIC_FAVICON,
  HEAD_RASTER,
  type HeadRaster,
  isPageUrl,
  openExtent,
  PAGE_REMAKE_MS,
  PANE_SIZE,
  type PageFavicon,
  type PaneGeometry,
  type PaneInstance,
  paneDemand,
  paneLook,
  pointAt,
  SAMPLE_URL,
  seen,
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
  const inputs: LiveInput[] = [];
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
    inputs: LiveInput[];
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
    input: (e) => {
      inputs.push(e);
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
    inputs,
    closed: () => closed,
  };
  return face;
}

/** A host lending `LIVE` (or not), its doors counted; the desk's frames moved by the test. */
function fakeHost(
  opts: {
    live?: boolean;
    keys?: Record<number, string>;
    holds?: boolean;
    /** false: no navigation lent; "navigate-only": one that cannot `respec` (a host before PT-4). */
    nav?: boolean | "navigate-only";
    /** PT-4: the head's raster the DOM half lends. */
    head?: HeadRaster;
  } = {},
) {
  const opened: { key: string; spec: Record<string, unknown> }[] = [];
  /** PT-3: what the host's second service was asked — a page navigated by its key. PT-4: a spec moved under its page. */
  const navigations: { key: string; command: BrowserNavigationCommand }[] = [];
  const respecs: { key: string; spec: Record<string, unknown> }[] = [];
  const navigation = {
    navigate(key: string, command: BrowserNavigationCommand) {
      navigations.push({ key, command });
      return true;
    },
    respec(key: string, spec: Readonly<Record<string, unknown>>) {
      respecs.push({ key, spec: { ...spec } });
      return true;
    },
  };
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
      opts.live !== false && key.name === LIVE.name
        ? (sources as T)
        : opts.nav !== false && key.name === BROWSER_NAVIGATION.name
          ? ((opts.nav === "navigate-only" ? { navigate: navigation.navigate } : navigation) as T)
          : opts.head !== undefined && key.name === HEAD_RASTER.name
            ? (opts.head as T)
            : undefined,
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
    navigations,
    respecs,
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

  it("says the page's own words: the head its address, lock, loading and history; the loading line; the hand's word its TITLE — its address when it has none (PT-4 ruling 5)", () => {
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
    const word = (): unknown => {
      const readout = k.open?.readout;
      return typeof readout === "function"
        ? readout({
            world: undefined as never,
            entity: 1 as Entity,
            props: () => ({ url: PAGE }),
            local,
          })
        : readout;
    };
    // the page has a title: the hand's word (the address stays on the head's capsule, above)
    expect(word()).toBe("There");
    // a page with no title — or one of spaces: its address as printed
    for (const title of [undefined, "   "]) {
      t.faces.get("13918995204487956201-1")?.say({
        info: {
          address: "https://www.example.org/there",
          ...(title === undefined ? {} : { title }),
        },
      });
      local.tick?.(0);
      expect(word(), JSON.stringify(title)).toBe("example.org");
    }
  });
});

describe("PT-3 — the pane in use: its hand's input, its controls, the url it follows", () => {
  const k = browserPaneKind();
  const KEY = "13918995204487956201-1";
  /** A pane IN HAND, recorded at the hand's zoom: its local, its face (a texture landed at `logical`), where its parts are. */
  const inHand = (logical: readonly [number, number] = [640, 400], zoom = 2) => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    const held = {
      ...ctxOf({ url: PAGE }, local),
      held: { e: 1, open: true, grow: 1, snap: true },
      view: { camX: 0, camY: 0, zoom, width: 1200, height: 800, dpr: 2 },
    } as unknown as ObjectContext;
    const G = k.resolve(held) as PaneGeometry;
    expect(G.held).toBe(true);
    k.record(G, held);
    const face = t.faces.get(KEY);
    if (face === undefined) throw new Error("no face");
    face.land({ logical });
    local.tick?.(0);
    const ext = openExtent(held.rect, G.shape);
    /** A face point (the pane's frame) as the hand tells it: the desk point the pane's own eye sees it at, from the extent's centre. */
    const hand = (u: number, v: number): readonly [number, number] => {
      const w = seen(G.eye, pointAt(G, u, v));
      return [w[0] - ext.cx, w[1] - ext.cy];
    };
    return { t, local, G, face, hand };
  };
  const press = (
    phase: "down" | "move" | "up",
    at: readonly [number, number],
    part: string | null,
    buttons: number,
    count = 1,
  ): HeldEvent =>
    ({
      type: "pointer",
      phase,
      x: at[0],
      y: at[1],
      part,
      button: phase === "move" ? -1 : 0,
      buttons,
      count: phase === "move" ? 0 : count,
    }) as HeldEvent;

  it("a press on the PAGE, its moves wherever they go and its release reach the face in the DISPLAYED frame's logical px; a hover over the page too, off it not", () => {
    const { local, G, face, hand } = inHand([640, 400]);
    const mid = hand(...faceOfPage(G.shape, 640, 400));
    const corner = hand(...faceOfPage(G.shape, 128, 80));
    const off = hand(G.shape.half[0] + 10, 0);
    local.held?.(1 as Entity, [
      press("down", mid, "page", 1, 2),
      press("move", off, null, 1),
      press("up", corner, "content", 0, 2),
      press("move", corner, "page", 0),
      press("move", off, "content", 0),
    ]);
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    const sent = face.inputs.map((i) =>
      i.kind === "pointer" ? [i.phase, i.x, i.y, i.buttons, i.count] : i.kind,
    );
    // the page's px scaled to the frame on display (640 × 400 of the 1280 × 800 page): halved
    expect(sent).toHaveLength(4);
    type Sent = [string, number, number, number, number];
    const [down, moved, up, hover] = sent as [Sent, Sent, Sent, Sent];
    expect(down[0]).toBe("down");
    expect(near(down[1], 320) && near(down[2], 200)).toBe(true);
    expect(down.slice(3)).toEqual([1, 2]);
    // the press's move off the page is still the page's (a drag selects past its edge)
    expect(moved[0]).toBe("move");
    expect(moved[1]).toBeGreaterThan(640);
    expect(up[0]).toBe("up");
    expect(near(up[1], 64) && near(up[2], 40)).toBe(true);
    // a hover over the page: the page's; a hover off it with nothing pressed: not
    expect(hover[0]).toBe("move");
    expect(local.faces()).toMatchObject({ sent: 4 });
  });

  it("the WHEEL over the page scrolls it by what the finger moved on the screen; a wheel off the page is not the page's", () => {
    const { local, G, face, hand } = inHand([1280, 800], 2.5);
    const mid = hand(...faceOfPage(G.shape, 640, 400));
    local.held?.(1 as Entity, [
      { type: "wheel", x: mid[0], y: mid[1], dx: 0, dy: 120 },
      { type: "wheel", x: G.shape.half[0] + 50, y: 0, dx: 0, dy: 120 },
    ]);
    expect(face.inputs).toHaveLength(1);
    const w = face.inputs[0];
    expect(w?.kind).toBe("wheel");
    if (w?.kind === "wheel") {
      // 120 CSS px of the hand at zoom 2.5, a page px being 2.5 × the density's desk units on screen
      expect(w.dy).toBeCloseTo(120 / (2.5 * G.shape.scale), 9);
      expect(w.dx).toBe(0);
    }
  });

  it("a CONTROL's press acts on its release over it — back, forward, reload (stop while it loads) through the page's navigation, the address the hand's — a release elsewhere nothing", () => {
    const { t, local, G, face, hand } = inHand();
    const L = bandLayout(G.shape);
    const at = (c: readonly [number, number] | null) => hand(c?.[0] ?? 0, c?.[1] ?? 0);
    const click = (part: string, c: readonly [number, number]) =>
      local.held?.(1 as Entity, [press("down", c, part, 1), press("up", c, part, 0)]);
    click("back", at(L.back));
    click("forward", at(L.forward));
    click("reload", at(L.reload));
    face.say({ state: { is: "live" }, info: { address: PAGE, loading: 0.5 } });
    local.tick?.(0);
    click("reload", at(L.reload));
    // a press on back released over the page: nothing
    local.held?.(1 as Entity, [
      press("down", at(L.back), "back", 1),
      press("up", at(L.back), "page", 0),
    ]);
    expect(t.navigations).toEqual([
      { key: KEY, command: { action: "back" } },
      { key: KEY, command: { action: "forward" } },
      { key: KEY, command: { action: "reload" } },
      { key: KEY, command: { action: "stop" } },
    ]);
    // a control's press is never the page's
    expect(face.inputs).toEqual([]);
    // the address: the hand's (its DOM half binds the door)
    const addressed: Entity[] = [];
    local.bind({ address: (e) => addressed.push(e) });
    click("address", hand(L.address[0], L.address[1]));
    expect(addressed).toEqual([1]);
    // with no navigation lent, a control does nothing and says so
    const bare = createPaneLocal(fakeHost({ nav: false }).host);
    expect(bare.navigate(1 as Entity, { action: "back" })).toBe(false);
  });

  it("the url its record reads: one that moved UNDER the live page is FOLLOWED, the page's own navigation never echoed — and `addressed` is where a page is that its record has not read", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    const NEXT = "http://127.0.0.1:4321/next";
    const PEER = "http://127.0.0.1:4321/peer";
    const recordAt = (url: string) => {
      const ctx = ctxOf({ url }, local);
      k.record(k.resolve(ctx), ctx);
    };
    recordAt(PAGE);
    const face = t.faces.get(KEY);
    if (face === undefined) throw new Error("no face");
    face.say({ state: { is: "live" }, info: { address: PAGE } });
    local.tick?.(0);
    expect([...local.addressed()]).toEqual([]);
    // the page went somewhere of its own: where it is, the record has not read — the hand writes it
    face.say({ state: { is: "live" }, info: { address: NEXT } });
    local.tick?.(0);
    expect([...local.addressed()]).toEqual([[1, NEXT]]);
    // the write lands: the record reads it — no navigation (it is where the page is), nothing addressed
    recordAt(NEXT);
    expect(t.navigations).toEqual([]);
    expect([...local.addressed()]).toEqual([]);
    // a peer's navigation arrives through the document: the page follows it, by its key — never re-opened
    recordAt(PEER);
    expect(t.navigations).toEqual([{ key: KEY, command: { action: "go", url: PEER } }]);
    expect(t.opened).toHaveLength(1);
    // the same url read again: nothing more
    recordAt(PEER);
    expect(t.navigations).toHaveLength(1);
  });

  it("`addressed` is the page's OWN navigation only: never its plumbing (the bootstrap about:blank, an error page), never a url the document moved that the page has not yet followed", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    const NEXT = "http://127.0.0.1:4321/next";
    const PEER = "http://127.0.0.1:4321/peer";
    const recordAt = (url: string) => {
      const ctx = ctxOf({ url }, local);
      k.record(k.resolve(ctx), ctx);
    };
    recordAt(PAGE);
    const face = t.faces.get(KEY);
    if (face === undefined) throw new Error("no face");
    // the page opening: its bootstrap document, then an error page — plumbing, never where the pane is
    for (const plumbing of ["about:blank", "chrome-error://chromewebdata/"]) {
      face.say({ state: { is: "live" }, info: { address: plumbing, loading: 0.1 } });
      local.tick?.(0);
      expect([...local.addressed()]).toEqual([]);
    }
    face.say({ state: { is: "live" }, info: { address: PAGE } });
    local.tick?.(0);
    expect([...local.addressed()]).toEqual([]);
    // a peer's url arrives: the page is told to go — and until it has gone, where it stands is not written back over the peer's
    recordAt(PEER);
    expect(t.navigations).toEqual([{ key: KEY, command: { action: "go", url: PEER } }]);
    expect([...local.addressed()]).toEqual([]);
    face.say({ state: { is: "live" }, info: { address: PEER } });
    local.tick?.(0);
    expect([...local.addressed()]).toEqual([]);
    // from there, a link: the page's own — addressed (a redraw's record, reading the same url, moves nothing); and back to where
    // it stood when the peer's url came: its own too
    face.say({ state: { is: "live" }, info: { address: NEXT } });
    local.tick?.(0);
    recordAt(PEER);
    expect([...local.addressed()]).toEqual([[1, NEXT]]);
    recordAt(NEXT);
    face.say({ state: { is: "live" }, info: { address: PEER } });
    local.tick?.(0);
    expect([...local.addressed()]).toEqual([[1, PEER]]);
  });

  it("a page's CURSOR that moves asks a frame — never a remake: the record does not read it", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    local.face(1 as Entity, spec, S);
    const face = t.faces.get(KEY);
    face?.say({ state: { is: "live" }, info: { address: PAGE } });
    local.tick?.(0);
    const remakes = t.n.remake.length;
    const redraws = t.n.redraw;
    face?.say({ state: { is: "live" }, info: { address: PAGE, cursor: "pointer" } });
    local.tick?.(1);
    expect(t.n.remake).toHaveLength(remakes);
    expect(t.n.redraw).toBe(redraws + 1);
    expect(local.page(1 as Entity)?.info.cursor).toBe("pointer");
  });
});

describe("PT-4 — the page as a device sees it: the pane's spec, its respec, its favicon", () => {
  const k = browserPaneKind();
  const KEY = "13918995204487956201-1";
  const phone = deviceById("phone");
  if (phone === undefined) throw new Error("phone");
  const phoneCut = cutOf(phone);
  /** A pane's record under a theme, cut to a device. */
  const recordOf = (
    local: unknown,
    props: Record<string, unknown>,
    theme: "light" | "dark" = "light",
    rect = { cx: 100, cy: 80, w: PANE_SIZE.w, h: PANE_SIZE.h },
  ): PaneInstance => {
    const ctx = {
      ...ctxOf(props, local),
      theme: { name: theme },
      rect,
    } as unknown as ObjectContext;
    return k.record(k.resolve(ctx), ctx) as PaneInstance;
  };
  const phoneRect = { cx: 100, cy: 80, w: phoneCut.w, h: phoneCut.h };

  it("its record's spec says the DEVICE it is cut to — its layout, its fingers, its agent — and a laptop's names none", () => {
    const t = fakeHost();
    recordOf(createPaneLocal(t.host), { url: PAGE });
    expect(t.opened[0]?.spec.device).toEqual({ mobile: false, touchPoints: 0, agent: null });
    const p = fakeHost();
    recordOf(createPaneLocal(p.host), { url: PAGE, device: "phone" }, "light", phoneRect);
    expect(p.opened[0]?.spec).toMatchObject({
      viewport: [402, 874],
      deviceScaleFactor: 3,
      device: deviceIdentity(phone),
    });
    expect(JSON.stringify(p.opened[0]?.spec.device)).toMatch(/"userAgent":"[^"]*iPhone/);
  });

  it("a device SWITCHED under the open page is told through the host's respec — the whole spec, by the page's key — never by re-opening it; the same record again tells nothing", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    recordOf(local, { url: PAGE });
    expect(t.respecs).toEqual([]);
    // the same record again (a redraw's): nothing told
    recordOf(local, { url: PAGE });
    expect(t.respecs).toEqual([]);
    recordOf(local, { url: PAGE, device: "phone" }, "light", phoneRect);
    expect(t.respecs).toHaveLength(1);
    expect(t.respecs[0]?.key).toBe(KEY);
    expect(t.respecs[0]?.spec).toMatchObject({
      source: "browser",
      url: PAGE,
      viewport: [402, 874],
      deviceScaleFactor: 3,
      scheme: "light",
      device: deviceIdentity(phone),
    });
    // back to the laptop: told again
    recordOf(local, { url: PAGE });
    expect(t.respecs).toHaveLength(2);
    expect(t.respecs[1]?.spec).toMatchObject({
      viewport: [1280, 800],
      deviceScaleFactor: 2,
      device: { mobile: false, touchPoints: 0, agent: null },
    });
    expect(local.respecs).toBe(2);
    // one page throughout
    expect(t.opened).toHaveLength(1);
    expect(t.faces.get(KEY)?.closed()).toBe(0);
  });

  it("the SCHEME follows the desk's theme, live — the desk goes dark, the page is told — and a pane fixed `light` stays light under a dark desk", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    recordOf(local, { url: PAGE }, "light");
    expect(t.opened[0]?.spec.scheme).toBe("light");
    recordOf(local, { url: PAGE }, "dark");
    expect(t.respecs.map((r) => r.spec.scheme)).toEqual(["dark"]);
    recordOf(local, { url: PAGE }, "light");
    expect(t.respecs.map((r) => r.spec.scheme)).toEqual(["dark", "light"]);
    // fixed light: opened light under a dark desk, and the desk's turns tell it nothing
    const f = fakeHost();
    const fixed = createPaneLocal(f.host);
    recordOf(fixed, { url: PAGE, scheme: "light" }, "dark");
    expect(f.opened[0]?.spec.scheme).toBe("light");
    recordOf(fixed, { url: PAGE, scheme: "light" }, "light");
    recordOf(fixed, { url: PAGE, scheme: "light" }, "dark");
    expect(f.respecs).toEqual([]);
    // fixed dark under a light desk: dark
    const d = fakeHost();
    recordOf(createPaneLocal(d.host), { url: PAGE, scheme: "dark" }, "light");
    expect(d.opened[0]?.spec.scheme).toBe("dark");
  });

  it("an ADDRESS that moves is never a respec's business (it is followed); a face dropped and opened again is opened on its spec, not told; a host that cannot respec is asked nothing", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    const phoneSpec = { ...spec, viewport: [402, 874], device: deviceIdentity(phone) } as const;
    local.face(1 as Entity, spec, S);
    // the url alone: nothing told
    local.face(1 as Entity, { ...spec, url: "http://127.0.0.1:4321/next" }, S);
    expect(t.respecs).toEqual([]);
    local.face(1 as Entity, phoneSpec, S);
    expect(t.respecs).toHaveLength(1);
    // dropped (its address no longer a page), opened again on another spec: an open, never a respec
    local.drop(1 as Entity);
    local.face(1 as Entity, spec, S);
    expect(t.opened).toHaveLength(2);
    expect(t.respecs).toHaveLength(1);
    // forgotten (the object gone) and back (an undo): the same
    local.forget?.(1 as Entity);
    local.face(1 as Entity, phoneSpec, S);
    expect(t.respecs).toHaveLength(1);
    // a host before PT-4 — a navigation with no respec — and one lending none: the page keeps the device it was opened on
    for (const nav of ["navigate-only", false] as const) {
      const old = fakeHost({ nav });
      const bare = createPaneLocal(old.host);
      bare.face(1 as Entity, spec, S);
      expect(() => bare.face(1 as Entity, phoneSpec, S)).not.toThrow();
      expect(bare.respecs).toBe(0);
    }
  });

  /** A head's raster that PRINTS pictures: each favicon offered, its waiters, and a door to land its decode. */
  const printer = () => {
    const offered: string[] = [];
    const ready = new Set<string>();
    const waiting = new Map<string, (() => void)[]>();
    const head: HeadRaster = {
      raster: () => ({ bytes: new Uint8Array(8 * 6 * 4), width: 8, height: 6, h: 2, at: 4 }),
      picture(favicon, tell) {
        offered.push(favicon.key);
        if (ready.has(favicon.key)) return true;
        waiting.set(favicon.key, [...(waiting.get(favicon.key) ?? []), tell]);
        return false;
      },
    };
    return {
      head,
      offered,
      land(key: string) {
        ready.add(key);
        for (const tell of waiting.get(key) ?? []) tell();
        waiting.delete(key);
      },
    };
  };
  const icon = (key: string): PageFavicon => ({
    key,
    type: "image/png",
    bytes: new Uint8Array([137, 80, 78, 71]),
  });

  it("its head says the page's FAVICON: nothing where the host says nothing, the GENERIC mark where the page has none or its picture is not ready — and the page's own once it is decoded, the pane remade to say it", () => {
    const p = printer();
    const t = fakeHost({ head: p.head });
    const local = createPaneLocal(t.host);
    recordOf(local, { url: PAGE });
    const face = t.faces.get(KEY);
    if (face === undefined) throw new Error("no face");
    // the page has not spoken (no `extra.favicon`): no mark
    face.say({ state: { is: "live" }, info: { address: PAGE } });
    local.tick?.(0);
    recordOf(local, { url: PAGE });
    expect(local.said(1 as Entity)?.favicon).toBeNull();
    // it has none: the generic mark
    face.say({ info: { address: PAGE, extra: { favicon: null } } });
    local.tick?.(1);
    recordOf(local, { url: PAGE });
    expect(local.said(1 as Entity)?.favicon).toBe(GENERIC_FAVICON);
    expect(p.offered).toEqual([]);
    // it has one: offered to the head's service — the generic mark while it is decoded
    const remakes = t.n.remake.length;
    face.say({ info: { address: PAGE, extra: { favicon: icon("0123456789abcdef") } } });
    local.tick?.(2);
    expect(t.n.remake).toHaveLength(remakes + 1); // its favicon's key is a word the record reads
    recordOf(local, { url: PAGE });
    expect(p.offered).toEqual(["0123456789abcdef"]);
    expect(local.said(1 as Entity)?.favicon).toBe(GENERIC_FAVICON);
    // decoded: the pane is remade and the desk woken — and its head says the page's own
    const wakes = t.n.wake;
    p.land("0123456789abcdef");
    expect(t.n.remake).toHaveLength(remakes + 2);
    expect(t.n.wake).toBe(wakes + 1);
    recordOf(local, { url: PAGE });
    expect(local.said(1 as Entity)?.favicon).toBe(faviconId("0123456789abcdef"));
    // a host whose head prints no pictures (a Node still's): the generic mark
    const plain = fakeHost();
    const bare = createPaneLocal(plain.host);
    expect(bare.icon(1 as Entity, { extra: { favicon: icon("0123456789abcdef") } })).toBe(
      GENERIC_FAVICON,
    );
    expect(bare.icon(1 as Entity, { extra: { favicon: null } })).toBe(GENERIC_FAVICON);
    expect(bare.icon(1 as Entity, {})).toBeNull();
    expect(bare.icon(1 as Entity, undefined)).toBeNull();
  });

  it("a favicon is a word by its KEY: the same key in new bytes remakes nothing (a frame's redraw), another key remakes the pane", () => {
    const t = fakeHost();
    const local = createPaneLocal(t.host);
    local.face(1 as Entity, spec, S);
    const face = t.faces.get(KEY);
    face?.say({
      state: { is: "live" },
      info: { address: PAGE, extra: { favicon: icon("0123456789abcdef") } },
    });
    local.tick?.(0);
    const remakes = t.n.remake.length;
    const redraws = t.n.redraw;
    // the host's face answers a NEW object of the same key (its bytes decoded again): not a new word
    face?.say({ info: { address: PAGE, extra: { favicon: icon("0123456789abcdef") } } });
    local.tick?.(1);
    expect(t.n.remake).toHaveLength(remakes);
    expect(t.n.redraw).toBe(redraws + 1);
    // another favicon; then none: new words
    face?.say({ info: { address: PAGE, extra: { favicon: icon("fedcba9876543210") } } });
    local.tick?.(2);
    expect(t.n.remake).toHaveLength(remakes + 1);
    face?.say({ info: { address: PAGE, extra: { favicon: null } } });
    local.tick?.(3);
    expect(t.n.remake).toHaveLength(remakes + 2);
    // the host stops saying anything of favicons: a new word too
    face?.say({ info: { address: PAGE } });
    local.tick?.(4);
    expect(t.n.remake).toHaveLength(remakes + 3);
  });
});
