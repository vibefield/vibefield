/**
 * PT-4 — the page as a device sees it, in the product (testing/smoke-device-pane.ts): the judges the device rows hold the
 * product to — LAPTOP, TITLE, FAVICON, PHONE, TOUCH, BACK, SCHEME and COOKIE — each passing what the product should do and
 * failing, in words with its numbers, what it should not; the favicon's pixel classifier; the head's band of a pane in hand;
 * and the desk's profile's name, said by the smoke on its own and by main the same.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { browserSurfaceProfileName } from "../src/main/live-surfaces/browser-security";
import {
  FIXTURE_EDGE,
  FIXTURE_HUE,
  FIXTURE_ICON_HUE,
  type FixtureReport,
} from "../src/testing/live-fixture";
import {
  DESK_PROFILE_DIR,
  DEVICE_ROWS,
  type DeviceSeen,
  EDGE_CLASSIFY,
  EDGE_HUE_DEG,
  headBand,
  ICON_CLASSIFY,
  ICON_HUE_DEG,
  judgeBack,
  judgeCookie,
  judgeFavicon,
  judgeLaptop,
  judgeLegacy,
  judgePhone,
  judgeScheme,
  judgeTitle,
  judgeTouch,
  type PageSaw,
  pageStrip,
  sawOf,
} from "../src/testing/smoke-device-pane";

const DESKTOP: PageSaw = {
  ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  platform: "MacIntel",
  uaData: { platform: "macOS", mobile: false, brands: ["Chromium", "Not?A_Brand"] },
  touchPoints: 0,
  view: [1280, 800],
  dpr: 2,
  dark: false,
};
const IPHONE: PageSaw = {
  ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  uaData: { platform: "iOS", mobile: true, brands: [] },
  touchPoints: 5,
  view: [402, 874],
  dpr: 3,
  dark: false,
};
const CHROME = "150.0.7871.114";
const LAID: DeviceSeen["laptop"] = { saw: DESKTOP, chrome: CHROME };

describe("the page as a device sees it — its rows", () => {
  it("LAPTOP: the engine's own desktop — Chrome at the bundled major, no app's token, hints with it, no fingers, 1280 × 800 @2", () => {
    expect(judgeLaptop(LAID)).toEqual([]);
    expect(judgeLaptop({ saw: null, chrome: CHROME })).toEqual([
      "LAPTOP: the page said nothing of how it is seen",
    ]);
    // Electron's own default agent: the app's and Electron's tokens in it
    const electron = DESKTOP.ua.replace(
      "Chrome/150.0.0.0",
      "VibeField/0.1.0 Chrome/150.0.7871.114 Electron/43.1.1",
    );
    expect(judgeLaptop({ ...LAID, saw: { ...DESKTOP, ua: electron } })[0]).toMatch(
      /LAPTOP: the page's agent is ".*Electron.*" — not a desktop Chrome's own/,
    );
    // a major written down, not read off the engine
    expect(judgeLaptop({ saw: DESKTOP, chrome: "151.0.1.2" })).toEqual([
      "LAPTOP: the page's agent says Chrome 150, not the bundled Chromium's 151",
    ]);
    expect(judgeLaptop({ ...LAID, saw: { ...DESKTOP, uaData: null } })).toEqual([
      "LAPTOP: the page's client hints are empty (null)",
    ]);
    expect(
      judgeLaptop({
        ...LAID,
        saw: { ...DESKTOP, uaData: { platform: "", mobile: false, brands: [] } },
      })[0],
    ).toMatch(/client hints are empty/);
    expect(
      judgeLaptop({
        ...LAID,
        saw: { ...DESKTOP, uaData: { platform: "macOS", mobile: true, brands: ["Chromium"] } },
      }),
    ).toEqual(["LAPTOP: the page's client hints say mobile on a desktop"]);
    expect(judgeLaptop({ ...LAID, saw: { ...DESKTOP, touchPoints: 5 } })).toEqual([
      "LAPTOP: the page has 5 touch points, not a desktop's 0",
    ]);
    expect(judgeLaptop({ ...LAID, saw: { ...DESKTOP, dpr: 1 } })).toEqual([
      "LAPTOP: the page's view is 1280 × 800 @1, not the laptop's 1280 × 800 @2",
    ]);
  });

  it("TITLE: the held bar's readout — the anchor's and the printed one — is the page's title, and the page is called by it", () => {
    const ok: DeviceSeen["title"] = {
      readout: "Portals fixture",
      bar: "Portals fixture",
      label: "Portals fixture",
      title: "Portals fixture",
    };
    expect(judgeTitle(ok)).toEqual([]);
    // the address, as PT-3 read it out
    expect(judgeTitle({ ...ok, readout: "127.0.0.1:50123", bar: "127.0.0.1:50123" })).toEqual([
      'TITLE: the held bar\'s readout is "127.0.0.1:50123", not the page\'s title "Portals fixture"',
      'TITLE: the held bar prints "127.0.0.1:50123", not "Portals fixture"',
    ]);
    expect(judgeTitle({ ...ok, label: "127.0.0.1:50123" })).toEqual([
      'TITLE: the page is called "127.0.0.1:50123", not by its title "Portals fixture" (its words say "Portals fixture")',
    ]);
    expect(judgeTitle({ readout: null, bar: null, label: null, title: null })).toHaveLength(3);
  });

  it("FAVICON: the head says the page's own and its hue is in the head's band; at a page that names none, the generic mark and no hue", () => {
    const ok: DeviceSeen["favicon"] = {
      said: "icon:0123456789abcdef",
      px: 180,
      of: 40_000,
      served: 1,
      none: { said: "generic", px: 0 },
    };
    expect(judgeFavicon(ok)).toEqual([]);
    expect(judgeFavicon({ ...ok, none: { said: "generic", px: 3 } })).toEqual([]);
    expect(judgeFavicon({ ...ok, said: "generic" })).toEqual([
      'FAVICON: the head says "generic", not the page\'s own favicon (served 1 times)',
    ]);
    expect(judgeFavicon({ ...ok, said: null, served: 0 })[0]).toMatch(
      /the head says null, not the page's own favicon \(served 0 times\)/,
    );
    // said, never printed
    expect(judgeFavicon({ ...ok, px: 4 })).toEqual([
      "FAVICON: 4 of the head's 40000 pixels are the icon's hue, under 20 — the favicon is not on the capsule",
    ]);
    expect(judgeFavicon({ ...ok, none: { said: null, px: 0 } })).toEqual([
      "FAVICON: at a page that names no icon the head says null, not the generic mark",
    ]);
    // the last page's favicon left on the next page's head
    expect(judgeFavicon({ ...ok, none: { said: "icon:0123456789abcdef", px: 180 } })).toEqual([
      'FAVICON: at a page that names no icon the head says "icon:0123456789abcdef", not the generic mark',
      "FAVICON: 180 pixels of the icon's hue still on the head of a page that names none",
    ]);
  });

  it("PHONE: an iPhone's agent, the mobile hint, five fingers, 402 × 874 @3 — the device written, the page loaded once more", () => {
    const ok: DeviceSeen["phone"] = {
      saw: IPHONE,
      device: "phone",
      loads: 1,
      favicon: "icon:0123456789abcdef",
      legacy: [980, 2131],
    };
    expect(judgePhone(ok)).toEqual([]);
    expect(judgePhone({ ...ok, saw: null })).toEqual([
      "PHONE: the page said nothing of how it is seen",
    ]);
    expect(judgePhone({ ...ok, device: "laptop" })).toEqual([
      "PHONE: the act wrote device laptop, not phone",
    ]);
    // the pane re-cut, the page never told: a desktop in a phone's view
    expect(judgePhone({ ...ok, saw: { ...DESKTOP, view: [402, 874], dpr: 3 } })).toEqual([
      `PHONE: the page's agent is ${JSON.stringify(DESKTOP.ua)}, not an iPhone's`,
      'PHONE: navigator.platform is "MacIntel", not iPhone',
      `PHONE: the page's client hints are ${JSON.stringify(DESKTOP.uaData)}, not a mobile's on iOS`,
      "PHONE: the page has 0 touch points, not 5",
    ]);
    // the agent with no hints (BW-5: `navigator.userAgentData` empty)
    expect(judgePhone({ ...ok, saw: { ...IPHONE, uaData: null } })).toEqual([
      "PHONE: the page's client hints are null, not a mobile's on iOS",
    ]);
    expect(judgePhone({ ...ok, saw: { ...IPHONE, touchPoints: 1 } })).toEqual([
      "PHONE: the page has 1 touch points, not 5",
    ]);
    expect(judgePhone({ ...ok, saw: { ...IPHONE, dpr: 2 } })).toEqual([
      "PHONE: the page's view is 402 × 874 @2, not the phone's 402 × 874 @3",
    ]);
    expect(judgePhone({ ...ok, loads: 0 })).toEqual([
      "PHONE: the switch loaded the page 0 times, not once",
    ]);
    expect(judgePhone({ ...ok, loads: 2 })).toEqual([
      "PHONE: the switch loaded the page 2 times, not once",
    ]);
    // the favicon lost at the load (a page naming the same icons says nothing of them)
    expect(judgePhone({ ...ok, favicon: "generic" })).toEqual([
      'PHONE: the head says "generic" of the favicon after the load, not the page\'s own',
    ]);
    expect(judgePhone({ ...ok, favicon: null })[0]).toMatch(/the head says null of the favicon/);
    // a phone's agent in a desktop's layout: the page that names no viewport laid out at the view's own width
    expect(judgePhone({ ...ok, legacy: [402, 874] })).toEqual([
      "PHONE: a page that names no viewport is laid out 402 × 874, not 980 px wide — the page is not laid out as a phone lays it",
    ]);
    expect(judgePhone({ ...ok, legacy: null })[0]).toMatch(
      /is laid out not at all, not 980 px wide/,
    );
  });

  it("TOUCH: a press in hand arrives as a touch; the wheel still scrolls; the pane stays in hand", () => {
    const ok: DeviceSeen["touch"] = {
      pointer: "touch",
      touches: 1,
      scrollY: 96,
      held: true,
      tapped: "/next",
    };
    expect(judgeTouch(ok)).toEqual([]);
    expect(judgeTouch({ ...ok, pointer: "mouse", touches: 0 })).toEqual([
      'TOUCH: the page\'s last pointer was "mouse", not a touch (0 touchstarts)',
    ]);
    expect(judgeTouch({ ...ok, pointer: null })[0]).toMatch(/last pointer was null, not a touch/);
    expect(judgeTouch({ ...ok, touches: 0 })).toEqual(["TOUCH: the page saw no touchstart"]);
    expect(judgeTouch({ ...ok, scrollY: 0 })).toEqual([
      "TOUCH: the wheel left the page's scroll at 0 — it did not scroll",
    ]);
    expect(judgeTouch({ ...ok, scrollY: null })[0]).toMatch(/scroll at null/);
    expect(judgeTouch({ ...ok, held: false })).toEqual(["TOUCH: the pane left the hand"]);
    // the finger sent somewhere the link is not drawn
    expect(judgeTouch({ ...ok, tapped: "/page" })).toEqual([
      "TOUCH: a tap on the page's link left it at /page, not /next — the finger did not land where the link is drawn",
    ]);
    expect(judgeTouch({ ...ok, tapped: null })[0]).toMatch(
      /left it at nothing it said, not \/next/,
    );
  });

  it("BACK: a desktop again — the agent it was laid with — no fingers, 1280 × 800 @2, loaded once more; a press is a mouse's", () => {
    const ok: DeviceSeen["back"] = {
      saw: DESKTOP,
      device: "laptop",
      loads: 1,
      favicon: "icon:0123456789abcdef",
      pointer: "mouse",
    };
    expect(judgeBack(ok, LAID)).toEqual([]);
    // still the phone's page
    const stuck = judgeBack({ ...ok, saw: IPHONE }, LAID);
    expect(stuck[0]).toMatch(/BACK: the page's agent is ".*iPhone.*" — not a desktop Chrome's own/);
    expect(stuck).toContain("BACK: the page has 5 touch points, not a desktop's 0");
    expect(stuck).toContain(
      "BACK: the page's view is 402 × 874 @3, not the laptop's 1280 × 800 @2",
    );
    expect(judgeBack({ ...ok, device: "phone" }, LAID)).toEqual([
      "BACK: the act wrote device phone, not laptop",
    ]);
    // a desktop, but not the one it was laid with
    const other = {
      ...DESKTOP,
      ua: DESKTOP.ua.replace("Intel Mac OS X 10_15_7", "Intel Mac OS X 11_0"),
    };
    expect(judgeBack({ ...ok, saw: other }, LAID)[0]).toMatch(
      /BACK: the page's agent is ".*11_0.*", not the one it was laid with/,
    );
    expect(judgeBack({ ...ok, loads: 0 }, LAID)).toEqual([
      "BACK: the switch loaded the page 0 times, not once",
    ]);
    expect(judgeBack({ ...ok, favicon: "generic" }, LAID)).toEqual([
      'BACK: the head says "generic" of the favicon after the load, not the page\'s own',
    ]);
    expect(judgeBack({ ...ok, pointer: "touch" }, LAID)).toEqual([
      'BACK: a press in hand arrived as "touch", not a mouse\'s',
    ]);
    expect(judgeBack({ ...ok, saw: null }, LAID)[0]).toBe(
      "BACK: the page said nothing of how it is seen",
    );
  });

  it("SCHEME: dark under a dark desk, light under a light one — told live, no load — and a pane fixed light stays light under dark", () => {
    const ok: DeviceSeen["scheme"] = {
      dark: true,
      light: false,
      loads: 0,
      fixed: { desk: "dark", dark: false },
      fixedDark: { desk: "light", dark: true },
    };
    expect(judgeScheme(ok)).toEqual([]);
    // the pane fixed dark followed the desk into the light (the app's theme turns every page; the pane's telling did not hold)
    expect(judgeScheme({ ...ok, fixedDark: { desk: "light", dark: false } })).toEqual([
      "SCHEME: a pane fixed dark says prefers-color-scheme: dark is false under a light desk",
    ]);
    expect(judgeScheme({ ...ok, fixedDark: { desk: "dark", dark: true } })).toEqual([
      "SCHEME: the desk was dark, not light, when the pane fixed dark was read — the row proved nothing",
    ]);
    expect(judgeScheme({ ...ok, dark: false })).toEqual([
      "SCHEME: under a dark desk the page's prefers-color-scheme: dark is false, not true",
    ]);
    expect(judgeScheme({ ...ok, dark: null })[0]).toMatch(/is null, not true/);
    expect(judgeScheme({ ...ok, light: true })).toEqual([
      "SCHEME: under a light desk the page's prefers-color-scheme: dark is true, not false",
    ]);
    expect(judgeScheme({ ...ok, loads: 2 })).toEqual([
      "SCHEME: the theme's turns loaded the page 2 times — it is told live",
    ]);
    // the fixed pane followed the desk
    expect(judgeScheme({ ...ok, fixed: { desk: "dark", dark: true } })).toEqual([
      "SCHEME: a pane fixed light says prefers-color-scheme: dark is true under a dark desk",
    ]);
    // the desk never turned: the fixed pane's light proves nothing
    expect(judgeScheme({ ...ok, fixed: { desk: "light", dark: false } })).toEqual([
      "SCHEME: the desk was light, not dark, when the fixed pane was read — the row proved nothing",
    ]);
  });

  it("COOKIE: the second pane's page reads what the first's stored — cookie, header and storage — the shell holds none, the profile stands under the user's data", () => {
    const dir = join("/tmp/vf-smoke/users/1", "browser", "profiles", DESK_PROFILE_DIR);
    const ok: DeviceSeen["cookie"] = {
      value: "vabc",
      stored: "pt4=vabc",
      read: { cookie: "other=1; pt4=vabc", stored: "vabc" },
      header: "pt4=vabc",
      shell: 0,
      profile: { dir, entries: 9 },
      faces: 2,
    };
    expect(judgeCookie(ok)).toEqual([]);
    expect(judgeCookie({ ...ok, stored: "" })).toEqual([
      'COOKIE: the first page\'s cookie is "" — it never kept pt4=vabc',
    ]);
    // a pane a profile: the second page reads nothing
    expect(judgeCookie({ ...ok, read: { cookie: "", stored: "" }, header: "" })).toEqual([
      "COOKIE: the second pane's page reads the cookie \"\", not pt4=vabc — the desk's pages do not share a profile",
      'COOKIE: the second pane\'s load came with the Cookie header "", not pt4=vabc',
      'COOKIE: the second pane\'s page reads "" from its storage, not "vabc"',
    ]);
    // another run's value is not this one's
    expect(judgeCookie({ ...ok, read: { cookie: "pt4=vabcd", stored: "vabc" } })[0]).toMatch(
      /reads the cookie "pt4=vabcd", not pt4=vabc/,
    );
    expect(judgeCookie({ ...ok, read: { cookie: null, stored: null }, header: null })).toHaveLength(
      3,
    );
    expect(judgeCookie({ ...ok, faces: 1 })).toEqual([
      "COOKIE: 1 pages were live on the desk, not the two panes'",
    ]);
    // the pages in the shell's own session
    expect(judgeCookie({ ...ok, shell: 1 })).toEqual([
      "COOKIE: the app's shell holds 1 cookies for the fixture's origin — the desk's pages are not partitioned from it",
    ]);
    expect(judgeCookie({ ...ok, shell: null })).toEqual([
      "COOKIE: the shell's cookies could not be read",
    ]);
    expect(judgeCookie({ ...ok, profile: null })).toEqual([
      "COOKIE: the desk's profile could not be read",
    ]);
    expect(judgeCookie({ ...ok, profile: { dir, entries: 0 } })).toEqual([
      `COOKIE: the desk's profile at ${dir} holds nothing`,
    ]);
    // under Electron's own userData, not the user's
    const elsewhere = join("/tmp/vf-smoke/electron/Partitions", DESK_PROFILE_DIR);
    expect(judgeCookie({ ...ok, profile: { dir: elsewhere, entries: 9 } })).toEqual([
      `COOKIE: the desk's profile is at ${elsewhere}, not browser/profiles/${DESK_PROFILE_DIR} under the user's data`,
    ]);
  });
});

describe("the device rows' instruments", () => {
  it("the desk's profile's directory is named as main names it: a digest of `persistent` and `desk`, 40 hex — no ref in a path", () => {
    expect(DESK_PROFILE_DIR).toMatch(/^[a-f0-9]{40}$/);
    expect(
      browserSurfaceProfileName({ profile: { mode: "persistent", ref: "desk" } } as never),
    ).toBe(DESK_PROFILE_DIR);
    expect(
      browserSurfaceProfileName({ profile: { mode: "ephemeral", ref: "desk" } } as never),
    ).not.toBe(DESK_PROFILE_DIR);
  });

  it("the favicon's classifier knows the icon's hue — printed through the pane's frost too — from the fixture's ground, the mat, white and grey", () => {
    const classify = new Function(`return ${ICON_CLASSIFY};`)() as (
      r: number,
      g: number,
      b: number,
    ) => number;
    const { r, g, b } = FIXTURE_ICON_HUE;
    expect(ICON_HUE_DEG).toBeGreaterThan(315);
    expect(ICON_HUE_DEG).toBeLessThan(325);
    expect(classify(r, g, b)).toBe(1);
    // the print at 70 % over a light frost, and dimmed by the pane's night look
    const over = (c: number, base: number, a: number): number => Math.round(c * a + base * (1 - a));
    expect(classify(over(r, 235, 0.7), over(g, 235, 0.7), over(b, 235, 0.7))).toBe(1);
    expect(classify(Math.round(r * 0.6), Math.round(g * 0.6), Math.round(b * 0.6))).toBe(1);
    // never the fixture's ground, its runner, the mat's green, white, grey or black
    expect(classify(FIXTURE_HUE.r, FIXTURE_HUE.g, FIXTURE_HUE.b)).toBe(0);
    expect(classify(255, 211, 77)).toBe(0);
    expect(classify(46, 125, 90)).toBe(0);
    expect(classify(255, 255, 255)).toBe(0);
    expect(classify(128, 128, 128)).toBe(0);
    expect(classify(0, 0, 0)).toBe(0);
    // a red and a violet either side of it: past its span
    expect(classify(226, 30, 40)).toBe(0);
    expect(classify(120, 30, 226)).toBe(0);
    expect(DEVICE_ROWS.icon.minPx).toBe(20);
  });

  it("the head's band of a pane in hand stands over its page: as wide as the extent, from its top to the page's", () => {
    // a laptop's page 1280 × 800 drawn 800 wide (k = 0.625): the page 500 tall, the extent 540 — a head of 40
    const band = headBand({ cx: 600, cy: 400, hx: 400, hy: 270 }, [1280, 800]);
    expect(band).toEqual({ x: 200, y: 130, width: 800, height: 40 });
    // a phone's, taller than wide
    const phone = headBand({ cx: 600, cy: 400, hx: 150, hy: 350 }, [402, 874]);
    expect(phone.x).toBe(450);
    expect(phone.y).toBe(50);
    expect(phone.width).toBe(300);
    expect(phone.height).toBe(Math.round(700 - 874 * (300 / 402)));
  });

  it("LEGACY (PT-5b ruling 5): the phone's page that names no viewport — 980 wide AND shown whole (its marker in the pane's last strip, nowhere two thirds across), the wheel scrolling the document, a tap landing, in a window of the phone's own", () => {
    const whole: DeviceSeen["legacy"] = {
      view: [980, 2130],
      dpr: 3,
      last: { px: 1900, of: 2000 },
      third: { px: 0, of: 8000 },
      told: { px: 1880, of: 2000 },
      scrollY: 390,
      pointer: "touch",
      tapped: "/next",
      windows: { laptop: 7, phone: 11 },
    };
    expect(judgeLegacy(whole)).toEqual([]);
    // PT-4's first failure: the scale forced to the view's — the page's top-left corner shown, no marker in sight, and
    // the wheel panning the view inside the layout (the document's scroll left at 0)
    expect(judgeLegacy({ ...whole, last: { px: 0, of: 2000 }, scrollY: 0 })).toEqual([
      "LEGACY: the page's right-edge marker fills 0.0% of the pane's last strip (0 of 2000 px), not 70% — the page is not shown whole",
      "LEGACY: the wheel left the document's scroll at 0 — it panned the view, or did nothing",
    ]);
    // …and the way it comes back: a page that LOADS whole (a new document takes its own scale) and loses it the first
    // time its layout is laid again under it — told its scheme, live
    expect(judgeLegacy({ ...whole, told: { px: 0, of: 2000 } })).toEqual([
      "LEGACY: told its scheme (its layout laid again under it), the page's marker fills 0.0% of the pane's last strip (0 of 2000 px), not 70% — its scale was forced: the page is not shown whole any more",
    ]);
    expect(judgeLegacy({ ...whole, told: { px: 0, of: 0 } })).toEqual([
      "LEGACY: the page's last strip could not be read once its scheme was told",
    ]);
    // PT-4's second: a window born at the laptop's density paints the phone's page at two thirds — the marker stands two
    // thirds across — and the window is the one the laptop was laid in
    expect(
      judgeLegacy({
        ...whole,
        last: { px: 0, of: 2000 },
        third: { px: 2600, of: 8000 },
        windows: { laptop: 7, phone: 7 },
      }),
    ).toEqual([
      "LEGACY: the page's right-edge marker fills 0.0% of the pane's last strip (0 of 2000 px), not 70% — the page is not shown whole",
      "LEGACY: the marker's hue is 32.5% of a strip two thirds across the pane — the page is painted at another scale than its view's",
      "LEGACY: the phone's page is in the window the laptop's was laid in (7) — a window born at @2 paints a phone's page at two thirds",
    ]);
    // the third: the page whole, and the hand's points not carried into its own px — the tap lands beside the link
    expect(judgeLegacy({ ...whole, tapped: "/legacy" })).toEqual([
      "LEGACY: a tap on the page's link left it at /legacy, not /next — the finger did not land where the link is drawn",
    ]);
    // a page laid out as a desktop lays it, at the laptop's density, pressed by a mouse, its windows unread
    expect(
      judgeLegacy({
        ...whole,
        view: [402, 874],
        dpr: 2,
        pointer: "mouse",
        windows: { laptop: null, phone: 11 },
      }),
    ).toEqual([
      "LEGACY: the page that names no viewport is laid out 402 × 874, not 980 px wide",
      "LEGACY: the page's density is 2, not the phone's 3",
      `LEGACY: the page's last pointer was "mouse", not a touch`,
      "LEGACY: the page's own window could not be found (as a laptop: null, as a phone: 11)",
    ]);
    expect(judgeLegacy({ ...whole, view: null, last: { px: 0, of: 0 }, scrollY: null })).toEqual([
      "LEGACY: the page that names no viewport is laid out not at all, not 980 px wide",
      "LEGACY: the page's last strip could not be read",
      "LEGACY: the wheel left the document's scroll at null — it panned the view, or did nothing",
    ]);
  });

  it("the marker's classifier finds its orange-red — at its own light and a photograph's dimmer one — and never the page's ground, its runner, its icon, the mat or a grey", () => {
    const classify = new Function(`return ${EDGE_CLASSIFY};`)() as (
      r: number,
      g: number,
      b: number,
    ) => number;
    const { r, g, b } = FIXTURE_EDGE.hue;
    expect(EDGE_HUE_DEG).toBeGreaterThan(8);
    expect(EDGE_HUE_DEG).toBeLessThan(18);
    expect(classify(r, g, b)).toBe(1);
    // through the pane's glass (a veil of its light) and at a still's dimmer light
    expect(classify(Math.round(r * 0.86), Math.round(g * 0.86), Math.round(b * 0.86))).toBe(1);
    expect(classify(244, 84, 44)).toBe(1);
    expect(classify(FIXTURE_HUE.r, FIXTURE_HUE.g, FIXTURE_HUE.b)).toBe(0);
    expect(classify(FIXTURE_ICON_HUE.r, FIXTURE_ICON_HUE.g, FIXTURE_ICON_HUE.b)).toBe(0);
    expect(classify(255, 211, 77)).toBe(0);
    expect(classify(46, 125, 90)).toBe(0);
    expect(classify(255, 255, 255)).toBe(0);
    expect(classify(128, 128, 128)).toBe(0);
    expect(classify(0, 0, 0)).toBe(0);
    // a dark red is not it (too dim), nor a yellow or a pure magenta either side of its span
    expect(classify(120, 30, 10)).toBe(0);
    expect(classify(255, 180, 24)).toBe(0);
    expect(classify(255, 24, 120)).toBe(0);
    // the marker is the page's last 4%, and the strips read it where a page shown whole has it — and where one painted at
    // two thirds would (0.96 × ⅔ … ⅔)
    expect(FIXTURE_EDGE.share).toBe(0.04);
    const [from, to] = DEVICE_ROWS.edgeStrip.last;
    expect(from).toBeGreaterThan(1 - FIXTURE_EDGE.share);
    expect(to).toBeLessThan(1);
    const [a, z] = DEVICE_ROWS.edgeStrip.third;
    expect(a).toBeLessThan((1 - FIXTURE_EDGE.share) * (2 / 3));
    expect(z).toBeGreaterThan(2 / 3);
  });

  it("a strip of the page of a pane in hand: the page stands at the extent's foot, as wide as it — shares of its width and height", () => {
    // a phone's page 402 × 874 drawn 300 wide: 652.24 tall, its foot at the extent's (cy + hy = 750)
    const f = { cx: 600, cy: 400, hx: 150, hy: 350 };
    const tall = (874 * 300) / 402;
    expect(pageStrip(f, [402, 874], [0, 1], [0, 1])).toEqual({
      x: 450,
      y: Math.round(750 - tall),
      width: 300,
      height: Math.round(tall),
    });
    const last = pageStrip(f, [402, 874], [0.972, 0.992], [0.04, 0.5]);
    expect(last.x).toBe(Math.round(450 + 0.972 * 300));
    expect(last.width).toBe(6);
    expect(last.y).toBe(Math.round(750 - tall + 0.04 * tall));
    expect(last.height).toBe(Math.round(0.46 * tall));
    // never an empty rect
    expect(pageStrip(f, [402, 874], [0.5, 0.5], [0.5, 0.5])).toMatchObject({ width: 1, height: 1 });
  });

  it("reads how a page is seen out of its report — nothing from a page that says none of it", () => {
    const report = {
      path: "/page",
      token: "t",
      ...IPHONE,
      pointer: "touch",
      touches: 1,
      cookie: "",
      stored: "",
      title: "Portals fixture",
    } as unknown as FixtureReport;
    expect(sawOf(report)).toEqual(IPHONE);
    expect(sawOf(null)).toBeNull();
    expect(sawOf({ path: "/page", token: "t" } as unknown as FixtureReport)).toBeNull();
  });
});
