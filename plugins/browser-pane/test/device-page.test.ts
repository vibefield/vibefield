// PT-4 — THE PAGE AS A DEVICE SEES IT, the pane's pure parts: the devices' ONE table says who each announces itself as (a
// phone's and a tablet's agent with its hints and its five fingers; a laptop's and a desktop's none — the engine's own is the
// host's to say, so no Chromium major is written here); the head says a page's favicon by an id — the page's own once its
// picture is decoded, the GENERIC mark where it has none, nothing where the host says nothing of favicons (a still's head,
// byte-stable); the pictures are decoded once a key; the generic mark is a globe engraved in the favicon's place.
import type { LiveInfo } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import {
  bandLayout,
  createFaviconPictures,
  cutOf,
  DEVICES,
  deviceById,
  deviceIdentity,
  drawHead,
  FAVICON_PICTURES_MAX,
  faviconId,
  GENERIC_FAVICON,
  type HeadContext,
  type HeadState,
  headKey,
  headRaster,
  headStateOf,
  type PageFavicon,
  pageFavicon,
  SAMPLE_URL,
  shapeOf,
  TOUCH_POINTS,
} from "../src";

const laptop = deviceById("laptop");
if (laptop === undefined) throw new Error("laptop");
const S = shapeOf(cutOf(laptop), laptop);
const PAGE = "https://example.org/";
const favicon = (key: string): PageFavicon => ({
  key,
  type: "image/png",
  bytes: new Uint8Array([137, 80, 78, 71]),
});

describe("PT-4 — the devices' one table: who each announces itself as", () => {
  it("a laptop and a desktop name NO agent (the engine's own, the host's to say) and no fingers; an iPad and an iPhone their own, with their hints and five fingers", () => {
    const told = Object.fromEntries(DEVICES.map((d) => [d.id, deviceIdentity(d)]));
    expect(told.laptop).toEqual({ mobile: false, touchPoints: 0, agent: null });
    expect(told.desktop).toEqual({ mobile: false, touchPoints: 0, agent: null });
    expect(TOUCH_POINTS).toBe(5);
    expect(told.phone).toEqual({
      mobile: true,
      touchPoints: 5,
      agent: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
        navigatorPlatform: "iPhone",
        platform: "iOS",
        platformVersion: "26.0",
        model: "iPhone",
      },
    });
    expect(told.tablet).toEqual({
      mobile: true,
      touchPoints: 5,
      agent: {
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
        navigatorPlatform: "iPad",
        platform: "iPadOS",
        platformVersion: "26.0",
        model: "iPad",
      },
    });
  });

  it("writes no engine's version: no device's agent names Chrome, Chromium or Electron (the bundled Chromium is read at the host)", () => {
    for (const d of DEVICES) {
      const agent = deviceIdentity(d).agent;
      expect(agent === null || !/Chrom|Electron|CriOS/.test(agent.userAgent), d.id).toBe(true);
      // a device that lays out as a phone's or a tablet's is a touch device, and says who it is
      expect(d.mobile === d.touch && d.touch === (agent !== null), d.id).toBe(true);
    }
  });
});

describe("PT-4 — the head says the page's favicon by an id", () => {
  it("what the host's face says of it: the favicon, null — the page has none (or what it said cannot be read) — or nothing at all", () => {
    const f = favicon("0123456789abcdef");
    expect(pageFavicon(undefined)).toBeUndefined();
    expect(pageFavicon({})).toBeUndefined();
    expect(pageFavicon({ extra: {} })).toBeUndefined();
    expect(pageFavicon({ extra: { favicon: null } })).toBeNull();
    expect(pageFavicon({ extra: { favicon: f } })).toEqual(f);
    // half a favicon, or one whose bytes are not bytes: none the head can print
    for (const bad of [{ key: "k", type: "image/png" }, { ...f, bytes: [1, 2, 3] }, "icon", 7])
      expect(pageFavicon({ extra: { favicon: bad } } as LiveInfo), JSON.stringify(bad)).toBeNull();
  });

  it("a live page's head says the id its desk state answers — its own, the generic mark, or none; a still's keeps the sample's and never another", () => {
    const info: LiveInfo = { address: PAGE };
    expect(headStateOf(PAGE, S, info, faviconId("0123456789abcdef")).favicon).toBe(
      "icon:0123456789abcdef",
    );
    expect(headStateOf(PAGE, S, info, GENERIC_FAVICON).favicon).toBe("generic");
    // the host says nothing of favicons: no mark at all (the committed live head's key stands)
    expect(headStateOf(PAGE, S, info).favicon).toBeNull();
    // a still's head: the sample's own mark, whatever is offered — and none for any other address
    expect(headStateOf(SAMPLE_URL, S, undefined, GENERIC_FAVICON).favicon).toBe("sample");
    expect(headStateOf(PAGE, S, undefined, GENERIC_FAVICON).favicon).toBeNull();
  });

  it("its key moves with the favicon it says: a head is cut again when the picture arrives, and when the page's mark changes", () => {
    const info: LiveInfo = { address: PAGE };
    const keys = [
      null,
      GENERIC_FAVICON,
      faviconId("0123456789abcdef"),
      faviconId("fedcba9876543210"),
    ].map((icon) => headKey(S, headStateOf(PAGE, S, info, icon), 2));
    expect(new Set(keys).size).toBe(4);
  });
});

describe("PT-4 — the pages' favicons, decoded once a key", () => {
  /** A decoder the test settles by hand: each call's key, and its promise's two doors. */
  const decoder = () => {
    const calls: { key: string; done(picture: unknown): void; fail(): void }[] = [];
    const decode = (f: PageFavicon) =>
      new Promise<CanvasImageSource>((resolve, reject) => {
        calls.push({
          key: f.key,
          done: (picture) => resolve(picture as CanvasImageSource),
          fail: () => reject(new Error("unreadable")),
        });
      });
    return { calls, decode };
  };
  const settled = () => new Promise<void>((r) => setTimeout(r, 0));

  it("an offer starts ONE decode a key and answers false until it lands; every waiter is told once; then the picture is the id's", async () => {
    const d = decoder();
    const pictures = createFaviconPictures(d.decode);
    const told: string[] = [];
    const f = favicon("0123456789abcdef");
    expect(pictures.offer(f, () => told.push("a"))).toBe(false);
    expect(pictures.offer(f, () => told.push("b"))).toBe(false);
    expect(d.calls.map((c) => c.key)).toEqual(["0123456789abcdef"]);
    expect(pictures.byId(faviconId(f.key))).toBeNull();
    const picture = { a: "picture" };
    d.calls[0]?.done(picture);
    await settled();
    expect(told).toEqual(["a", "b"]);
    expect(pictures.offer(f, () => told.push("c"))).toBe(true);
    expect(pictures.byId(faviconId(f.key))).toBe(picture);
    // decoded once: no second decode, no further telling
    expect(d.calls).toHaveLength(1);
    expect(told).toEqual(["a", "b"]);
    // an id that is no page's favicon: no picture
    expect(pictures.byId("sample")).toBeNull();
    expect(pictures.byId(GENERIC_FAVICON)).toBeNull();
    expect(pictures.byId(faviconId("fedcba9876543210"))).toBeNull();
  });

  it("a favicon that cannot be read is never ready and never tried again: its head keeps the generic mark", async () => {
    const d = decoder();
    const pictures = createFaviconPictures(d.decode);
    const told: string[] = [];
    const f = favicon("badbadbadbadbad0");
    expect(pictures.offer(f, () => told.push("a"))).toBe(false);
    d.calls[0]?.fail();
    await settled();
    expect(pictures.offer(f, () => told.push("b"))).toBe(false);
    expect(d.calls).toHaveLength(1);
    expect(told).toEqual([]);
    expect(pictures.byId(faviconId(f.key))).toBeNull();
  });

  it(`keeps ${FAVICON_PICTURES_MAX} pictures: the oldest makes room, and is decoded again if its page comes back`, async () => {
    const d = decoder();
    const pictures = createFaviconPictures(d.decode);
    const key = (i: number) => i.toString(16).padStart(16, "0");
    for (let i = 0; i <= FAVICON_PICTURES_MAX; i += 1) {
      pictures.offer(favicon(key(i)), () => {});
      d.calls[i]?.done({ i });
      await settled();
    }
    expect(d.calls).toHaveLength(FAVICON_PICTURES_MAX + 1);
    // the first went to make room for the last; the second stands
    expect(pictures.byId(faviconId(key(0)))).toBeNull();
    expect(pictures.byId(faviconId(key(1)))).toEqual({ i: 1 });
    expect(pictures.byId(faviconId(key(FAVICON_PICTURES_MAX)))).toEqual({
      i: FAVICON_PICTURES_MAX,
    });
    expect(pictures.offer(favicon(key(0)), () => {})).toBe(false);
    expect(d.calls).toHaveLength(FAVICON_PICTURES_MAX + 2);
    // a decode that lands AFTER its entry made room is dropped — never a picture past the cap, its waiter never told
    const late = createFaviconPictures(d.decode);
    const told: number[] = [];
    const from = d.calls.length;
    for (let i = 0; i <= FAVICON_PICTURES_MAX; i += 1)
      late.offer(favicon(key(i)), () => told.push(i));
    for (let i = 0; i <= FAVICON_PICTURES_MAX; i += 1) d.calls[from + i]?.done({ i });
    await settled();
    expect(late.byId(faviconId(key(0)))).toBeNull();
    expect(told).not.toContain(0);
    expect(told).toHaveLength(FAVICON_PICTURES_MAX);
  });

  it("the head's raster is the DOM half's: none where the platform has no OffscreenCanvas (a Node still draws its committed head)", () => {
    expect(headRaster()).toBeUndefined();
  });
});

describe("PT-4 — the generic mark: a globe engraved in the favicon's place", () => {
  /** A 2D context that only RECORDS what it is asked: each call by name with its numbers, the text's letters measured 5 apiece. */
  const recorder = () => {
    const calls: { name: string; args: unknown[]; op: string }[] = [];
    const state: Record<string, unknown> = { globalCompositeOperation: "source-over" };
    const ctx = new Proxy(state, {
      get(target, name: string) {
        if (name in target) return target[name];
        if (name === "measureText") return (t: string) => ({ width: t.length * 5 });
        return (...args: unknown[]) => {
          calls.push({ name, args, op: String(target.globalCompositeOperation) });
        };
      },
      set(target, name: string, value) {
        target[name] = value;
        return true;
      },
    }) as unknown as HeadContext;
    return { ctx, calls };
  };
  const cut = (st: HeadState, picture: CanvasImageSource | null = null) => {
    const r = recorder();
    drawHead({ width: 0, height: 0 }, r.ctx, S, st, 2, picture);
    const text = r.calls.find((c) => c.name === "fillText" && c.args[0] === "example.org");
    if (text === undefined) throw new Error("no address cut");
    return { calls: r.calls, textAt: text.args[1] as number };
  };
  const info: LiveInfo = { address: PAGE };

  it("a head that says it has the globe CUT OUT of the capsule's frost — a rim, a meridian, the equator — and its address stands clear of it, as of a printed favicon", () => {
    const none = cut(headStateOf(PAGE, S, info));
    const generic = cut(headStateOf(PAGE, S, info, GENERIC_FAVICON));
    const meridian = generic.calls.filter((c) => c.name === "ellipse");
    expect(meridian).toHaveLength(1);
    expect(meridian[0]?.op).toBe("destination-out");
    expect(none.calls.filter((c) => c.name === "ellipse")).toEqual([]);
    // one more full circle than a head with no mark (the rim), cut out too
    const rims = (calls: typeof generic.calls) =>
      calls.filter((c) => c.name === "arc" && c.args[3] === 0 && c.args[4] === Math.PI * 2);
    expect(rims(generic.calls).length).toBe(rims(none.calls).length + 1);
    expect(rims(generic.calls).at(-1)?.op).toBe("destination-out");
    // nothing is PRINTED for it
    expect(generic.calls.filter((c) => c.name === "drawImage")).toEqual([]);
    // the address moves over for the mark exactly as it does for a printed favicon, and the mark sits where that would
    const printed = cut(headStateOf(PAGE, S, info, faviconId("0123456789abcdef")), {
      a: "picture",
    } as unknown as CanvasImageSource);
    expect(generic.textAt).toBeGreaterThan(none.textAt);
    expect(generic.textAt).toBeCloseTo(printed.textAt, 9);
    const drawn = printed.calls.find((c) => c.name === "drawImage");
    if (drawn === undefined) throw new Error("no favicon printed");
    const [, ix, , iw] = drawn.args as [unknown, number, number, number];
    expect(meridian[0]?.args[0]).toBeCloseTo(ix + iw / 2, 9);
    expect(printed.calls.filter((c) => c.name === "ellipse")).toEqual([]);
  });

  it("a head whose page's own favicon is said but whose picture is not in hand prints nothing rather than another's mark", () => {
    const pending = cut(headStateOf(PAGE, S, info, faviconId("0123456789abcdef")));
    expect(pending.calls.filter((c) => c.name === "ellipse" || c.name === "drawImage")).toEqual([]);
  });
});

describe("PT-5b — the rest mark: two short bars cut at the capsule's leading end", () => {
  /** A 2D context that only RECORDS what it is asked, the text's letters measured 5 apiece. */
  const recorder = () => {
    const calls: { name: string; args: unknown[]; op: string }[] = [];
    const state: Record<string, unknown> = { globalCompositeOperation: "source-over" };
    const ctx = new Proxy(state, {
      get(target, name: string) {
        if (name in target) return target[name];
        if (name === "measureText") return (t: string) => ({ width: t.length * 5 });
        return (...args: unknown[]) => {
          calls.push({ name, args, op: String(target.globalCompositeOperation) });
        };
      },
      set(target, name: string, value) {
        target[name] = value;
        return true;
      },
    }) as unknown as HeadContext;
    return { ctx, calls };
  };
  /** A head cut: the upright strokes CUT OUT of its frost (a move, then a line straight down from it), and where its text is. */
  const cut = (shape: typeof S, st: HeadState) => {
    const r = recorder();
    drawHead({ width: 0, height: 0 }, r.ctx, shape, st, 2, null);
    const bars: { x: number; y0: number; y1: number }[] = [];
    r.calls.forEach((c, i) => {
      const next = r.calls[i + 1];
      if (c.name !== "moveTo" || next?.name !== "lineTo" || c.op !== "destination-out") return;
      const [x, y0] = c.args as [number, number];
      const [x1, y1] = next.args as [number, number];
      if (x === x1 && y1 > y0) bars.push({ x, y0, y1 });
    });
    const text = r.calls.find((c) => c.name === "fillText" && c.op === "destination-out");
    return { bars, textAt: text?.args[1] as number, said: text?.args[0] as string };
  };
  const info: LiveInfo = { address: PAGE };
  const phone = deviceById("phone");
  if (phone === undefined) throw new Error("no phone");
  const NARROW = shapeOf(cutOf(phone), phone);

  it("a head at rest carries two upright bars cut out of the capsule's frost at its leading end — inside the capsule, the address standing clear of them; a head that is not carries none", () => {
    for (const shape of [S, NARROW]) {
      const L = bandLayout(shape);
      const [cx, cy, chx, chy] = L.address;
      const plain = cut(shape, headStateOf(PAGE, shape, info));
      const rest = cut(shape, headStateOf(PAGE, shape, info, null, undefined, true));
      const tag = L.compact ? "a phone's head" : "a laptop's head";
      expect(plain.bars, tag).toEqual([]);
      expect(rest.bars, tag).toHaveLength(2);
      const [a, b] = rest.bars as [(typeof rest.bars)[number], (typeof rest.bars)[number]];
      // two bars of one height, side by side, centred on the capsule's middle line
      expect(b.x, tag).toBeGreaterThan(a.x);
      expect([b.y0, b.y1], tag).toEqual([a.y0, a.y1]);
      expect((a.y0 + a.y1) / 2, tag).toBeCloseTo(cy, 9);
      // inside the capsule, at its leading end
      expect(a.x, tag).toBeGreaterThan(cx - chx);
      expect(b.x, tag).toBeLessThan(cx - chx + 2 * chy + (b.x - a.x));
      expect(a.y0, tag).toBeGreaterThan(cy - chy);
      expect(a.y1, tag).toBeLessThan(cy + chy);
      // the address says what it said, clear of the mark
      expect(rest.said, tag).toBe(plain.said);
      expect(rest.textAt, tag).toBeGreaterThan(b.x);
      expect(rest.textAt, tag).toBeGreaterThanOrEqual(plain.textAt);
    }
    // a phone's head has no ↻ to carry a mark: the capsule alone carries it
    expect(bandLayout(NARROW).reload).toBeNull();
  });

  it("while the capsule SAYS something else (a download refused) it carries no mark: the words alone", () => {
    const saying = cut(S, { ...headStateOf(PAGE, S, info, null, "Download blocked", true) });
    expect(saying.said).toBe("Download blocked");
    expect(saying.bars).toEqual([]);
  });
});
