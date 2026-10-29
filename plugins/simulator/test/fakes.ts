// The phone's units' FAKES (the browser pane's live.test.ts is their model): a face the test fills (its texture — ONE object
// for the face's life, as ICE's writer keeps it: a present moves its revision, a resize its epoch — its state, its words, the
// demands it was sent), a host lending `LIVE` and the words' raster (or not) and counting its doors (the durable key, wake,
// redraw, remake, the desk's frames), the root pass's words doors, a raster budget the test reads, and an object's context.
import {
  DEFAULT_GRID,
  type Entity,
  type KindHost,
  kindPalette,
  LIVE,
  type LiveDemand,
  type LiveFace,
  type LiveInfo,
  type LiveSimulatorFace,
  type LiveState,
  type LiveTexture,
  lampOf,
  type ObjectContext,
  type SlotContext,
} from "@vibefield/plugin-sdk/desk";
import { productPalette } from "@vibefield/plugin-sdk/testing";
import {
  type NoticeSpec,
  PHONE_SIZE,
  phoneLook,
  type SimulatorLocal,
  type SimulatorProps,
  WORDS_RASTER,
  type WordsRaster,
} from "../src";

/** A face the test fills. */
export function fakeFace(key: string, arrived: () => void) {
  let texture: { -readonly [K in keyof LiveTexture]: LiveTexture[K] } | undefined;
  let state: LiveState = { is: "starting" };
  let info: LiveInfo = {};
  let owed = false;
  const demands: LiveDemand[] = [];
  let closed = 0;
  const put = (t?: Partial<LiveTexture>): void => {
    if (texture === undefined)
      texture = {
        width: 603,
        height: 1311,
        format: "rgba8unorm-srgb",
        revision: 0,
        epoch: 0,
        logical: [402, 874],
        view: () => ({}) as never,
        prepare: () => {},
        bytes: 603 * 1311 * 4,
      };
    Object.assign(texture, { revision: texture.revision + 1, ...t });
  };
  const face: LiveFace & {
    hold(): void;
    land(t?: Partial<LiveTexture>): void;
    say(next: { state?: LiveState; info?: LiveInfo }): void;
    /** The host's word for the phone's honest face (`info.extra.simulator`). */
    is(words: LiveSimulatorFace): void;
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
      // a frame the host already holds when the face opens: owed, nothing told
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
    is(words) {
      face.say({ info: { extra: { simulator: words } } });
    },
    demands,
    closed: () => closed,
  };
  return face;
}

/** A words' raster that draws nothing but says what it was asked: a block of the screen, a line count from the words. */
export function fakeWords() {
  const asked: NoticeSpec[] = [];
  const raster: WordsRaster = {
    notice(spec) {
      asked.push(spec);
      const lines = spec.words.line.length > 30 ? 2 : 1;
      return {
        bytes: new Uint8Array(8 * 4 * 4),
        width: 8,
        height: 4,
        block: [spec.points[0] / 2, spec.points[1] * 0.45, spec.points[0] * 0.4, 60],
        lines,
      };
    },
  };
  return { raster, asked };
}

/** A host lending `LIVE` and the words' raster (or not), its doors counted; the desk's frames moved by the test. */
export function fakeHost(
  opts: {
    live?: boolean;
    keys?: Record<number, string>;
    holds?: boolean;
    words?: WordsRaster;
    pass?: boolean;
  } = {},
) {
  const pass = {
    noticed: undefined as ((entity: number, bytes: number) => void) | undefined,
    onNotice(fn: ((entity: number, bytes: number) => void) | undefined) {
      pass.noticed = fn;
    },
    unnoticed: [] as number[],
    unnotice(entity: number) {
      pass.unnoticed.push(entity);
      return true;
    },
    made: (_entity: number) => 0,
    forgot: [] as number[],
    forget(entity: number) {
      pass.forgot.push(entity);
    },
  };
  const opened: { key: string; spec: Record<string, unknown> }[] = [];
  const ledger = new Map<string, { bytes: number; evict: () => void }>();
  const said: string[] = [];
  const budget = {
    cap: 1 << 28,
    room: () => 1 << 28,
    charge(owner: string, key: string, bytes: number, evict: () => void) {
      said.push(`charge ${owner} ${key} ${bytes}`);
      ledger.set(`${owner} ${key}`, { bytes, evict });
    },
    reside() {},
    touch(owner: string, key: string) {
      said.push(`touch ${owner} ${key}`);
    },
    release(owner: string, key: string) {
      said.push(`release ${owner} ${key}`);
      ledger.delete(`${owner} ${key}`);
    },
    forget: () => 0,
    trim: () => 0,
    stats: () => ({}) as never,
  };
  /** The ledger evicts a row: it is dropped, then its owner's eviction runs. */
  const evict = (row: string): void => {
    const had = ledger.get(row);
    ledger.delete(row);
    had?.evict();
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
    pass: () => (opts.pass === true ? (pass as never) : undefined),
    use: <T>(key: { name: string }) =>
      opts.live !== false && key.name === LIVE.name
        ? (sources as T)
        : opts.words !== undefined && key.name === WORDS_RASTER.name
          ? (opts.words as T)
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
    budget,
  };
  return {
    host,
    opened,
    faces,
    n,
    ledger,
    said,
    evict,
    pass,
    /** A frame drawn: the slot's view tells the sight what it drew of `e`'s display (a 66.6 × 144.6 mm one at `zoom`), then the count moves. */
    draw(local: SimulatorLocal, e: Entity, zoom: number, target?: "hand") {
      const [width, height] = [4000, 4000];
      const slot = {
        view: { camX: -width / 2 / zoom, camY: -height / 2 / zoom, zoom, width, height, dpr: 2 },
        ...(target === undefined ? {} : { target }),
      };
      local.sight.saw(e, slot as unknown as SlotContext, { cx: 0, cy: 0, w: 174.8, h: 379.6 });
      frames += 1;
    },
    /** A frame drawn that did not show `e` (panned away). */
    skip() {
      frames += 1;
    },
  };
}

/** The look the product's palette makes, by day and by night. */
export const LOOK = {
  light: phoneLook(kindPalette(productPalette.light)),
  dark: phoneLook(kindPalette(productPalette.dark)),
};
const lamp = lampOf(DEFAULT_GRID.mat.plane);

/** An object's context: a phone with `props` on a rect at the desk's origin, at rest, by day unless the theme says. */
export const ctxOf = (
  props: Partial<SimulatorProps>,
  extra: Partial<ObjectContext> & { readonly night?: boolean } = {},
): ObjectContext => {
  const { night, ...rest } = extra;
  return {
    entity: 1 as Entity,
    rect: { cx: 0, cy: 0, w: PHONE_SIZE.w, h: PHONE_SIZE.h },
    props,
    flux: { lift: 0, hover: 0, ring: 0, fade: 1 },
    look: night === true ? LOOK.dark : LOOK.light,
    theme: { name: night === true ? "dark" : "light" } as ObjectContext["theme"],
    lamp,
    view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 },
    grid: DEFAULT_GRID,
    dt: 0,
    ...rest,
  } as ObjectContext;
};

/** A phone bound to the device type it is (a runtime this Mac holds). */
export const boundTo = (deviceType: string): Partial<SimulatorProps> => ({
  model: deviceType,
  binding: { deviceType, runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1" },
});
export const TYPE = "com.apple.CoreSimulator.SimDeviceType.";
