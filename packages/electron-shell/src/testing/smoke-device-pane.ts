// PT-4 — THE PAGE AS A DEVICE SEES IT, IN THE PRODUCT (smoke:canvas; the PORTALS brief PT-4 §2): a browser pane laid as PT-1's
// rows lay it, pointed at the smoke's own fixture page (testing/live-fixture.ts), and SWITCHED — its device, the desk's theme,
// its own scheme — as a person switches them. Judged by what the PAGE says it sees (the fixture's report with each ask: its
// user agent and client hints, its fingers, its view and density, its colour scheme, the type of its last pointer event, its
// cookie), the door's props and face rows, the head's own word and its pixels — never a hash:
//   LAPTOP  — the pane as laid: the ENGINE's own agent — Chrome at the bundled Chromium's major, no app's token — its hints
//             with it (never empty), no fingers, 1280 × 800 @2;
//   TITLE   — in hand, the held bar's readout says the fixture's TITLE (the address stays on the capsule), and the page is
//             called by it (the face's label — what "Send to…" prints);
//   FAVICON — the fixture's one-colour icon is on the head's capsule: the head says the page's own favicon and its hue is in the
//             head's band; at `/next`, which names none, the head says the generic mark and the hue is gone;
//   PHONE   — the bar's iPhone act: the page is told and loads ONCE more — it sees an iPhone's agent, the mobile hint, five
//             fingers, 402 × 874 @3 — its head keeps its favicon through the load (a page that names the same icons as the
//             one before says nothing of them: the first run of these rows lost it there) — and it is LAID OUT as a phone
//             lays a page: the fixture's `/legacy`, which names no viewport, is 980 px wide there;
//   TOUCH   — in hand, a press on the page arrives as a TOUCH (its pointer's type, a touchstart), the wheel still scrolls it,
//             and a tap on the page's link LANDS (the page at `/next`): a finger reaches the page where it is drawn;
//   LEGACY  — PT-5b (ruling 5): the phone's page that names NO viewport (`/legacy`), in hand: laid out 980 px wide AND SHOWN
//             WHOLE — its right-edge marker's hue fills the last of the pane's page, and is nowhere two thirds across
//             (where a window of another density painted it) — the wheel scrolls the DOCUMENT, and a tap on its link
//             LANDS: the hand's points reach a page drawn at 0.41 where it is drawn;
//   BACK    — the bar's Laptop act: a desktop's agent again (the one it was laid with), no fingers, 1280 × 800 @2, loaded ONCE
//             more — and a press in hand is a mouse's;
//   SCHEME  — the desk turned dark: the page says dark, LIVE (the same document — no load); turned light: light; the pane fixed
//             `light` stays light under a dark desk, and fixed `dark` it is dark under a light one (the app's theme alone
//             turns every page with it: the fixed panes are what the pane's own telling answers for);
//   COOKIE  — a value the pane's page stores (`/page?store=…`) is read by a SECOND pane's page on the same origin — its cookie
//             (the page's own word and the header its load came with) and its storage — and NOT by the app's shell (its
//             window's session and Electron's default hold no cookie for the origin); the desk's profile stands under the
//             user's data.
// Then both panes are deleted (⌫) and the board is as found. `--device-pane` beside `--smoke-canvas` runs these rows alone
// after the boot's (the author's loop).

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURE_COOKIE,
  FIXTURE_EDGE,
  FIXTURE_ICON_HUE,
  FIXTURE_TITLE,
  type FixtureReport,
} from "./live-fixture";
import { BARE_FOR, layPane, PANE, paneHands, paneToMiddle } from "./smoke-browser-pane";
import type { LiveRowsDriver } from "./smoke-live-pane";
import { type HeldFrameSeen, pageOnWindow } from "./smoke-use-pane";

/** The flag beside `--smoke-canvas` that runs these rows alone after the boot's (the author's loop). */
export const DEVICE_FLAG = "--device-pane";

/** The rows' numbers. */
export const DEVICE_ROWS = {
  /** how long a page's word is waited for (a device switch loads it again; its report rides an ask every quarter second) */
  withinMs: 20_000,
  /** how long a page that must NOT change is listened to */
  quietMs: 2_500,
  /** the devices as the page must see them (plugins/browser-pane/src/devices.ts) */
  laptop: { view: [1280, 800], dpr: 2, touchPoints: 0 },
  phone: { view: [402, 874], dpr: 3, touchPoints: 5 },
  /** a page that names no viewport, and how wide a PHONE lays it out (the engine's mobile layout; a desktop: its window's) */
  legacyPath: "/legacy",
  legacyWidth: 980,
  /** a pixel of the favicon: its hue within this many degrees of the icon's, this saturated, this bright; at least this many
   * of them in the head's band (the print is ~2.8 mm square on the capsule) */
  icon: { deg: 22, minSat: 0.3, minMax: 100, minPx: 20 },
  /** TOUCH's wheel: its travel on the screen (CSS px, in steps) */
  wheelPx: 160,
  wheelSteps: 4,
  /** LEGACY (PT-5b): a pixel of the marker — its hue within this many degrees, this saturated, this bright; the share of
   * the page's LAST strip it must fill where the page is shown whole, and the most of it a strip two thirds across may
   * hold; the strips, as shares of the page's width (the marker is its last 4%) and of its height */
  edge: { deg: 14, minSat: 0.55, minMax: 150, whole: 0.7, elsewhere: 0.05 },
  edgeStrip: { last: [0.972, 0.992], third: [0.6, 0.68], rows: [0.04, 0.5] },
  /** where the second pane's page stands, and the first's once it stores */
  readPath: "/page?read=1",
  storePath: (value: string): string => `/page?store=${value}`,
} as const;

/** The desk's pages' profile as its directory is named (main: `browserSurfaceProfileName` — a digest of its mode and ref, said
 * here again on its own): `<user root>/browser/profiles/<this>`. */
export const DESK_PROFILE_DIR = createHash("sha256")
  .update("persistent")
  .update("\0")
  .update("desk")
  .digest("hex")
  .slice(0, 40);

/** How a page says it is seen — the fixture's report, the part these rows read. */
export interface PageSaw {
  readonly ua: string;
  readonly platform: string;
  readonly uaData: {
    readonly platform: string;
    readonly mobile: boolean;
    readonly brands: readonly string[];
  } | null;
  readonly touchPoints: number;
  readonly view: readonly [number, number];
  readonly dpr: number;
  readonly dark: boolean;
}

export const sawOf = (r: FixtureReport | null): PageSaw | null =>
  r === null || typeof r.ua !== "string"
    ? null
    : {
        ua: r.ua,
        platform: r.platform,
        uaData: r.uaData,
        touchPoints: r.touchPoints,
        view: r.view,
        dpr: r.dpr,
        dark: r.dark,
      };

/** What the rows saw — the SMOKE_CANVAS_DEVICE line, and what the judges read. */
export interface DeviceSeen {
  /** the page as the pane was laid (a laptop), and the bundled Chromium's version as the host reads it */
  readonly laptop: { readonly saw: PageSaw | null; readonly chrome: string };
  readonly title: {
    /** the held anchor's readout, the bar's printed one, the face's label and the title its words carry */
    readonly readout: string | null;
    readonly bar: string | null;
    readonly label: string | null;
    readonly title: string | null;
  };
  readonly favicon: {
    /** what the head says of the favicon, the icon's-hue pixels in the head's band of so many; the favicon served */
    readonly said: string | null;
    readonly px: number;
    readonly of: number;
    readonly served: number;
    /** at `/next` (no icon named): what the head says, and the hue's pixels then */
    readonly none: { readonly said: string | null; readonly px: number };
  };
  readonly phone: {
    readonly saw: PageSaw | null;
    /** the `device` prop after the act; the fixture's loads of `/page` the switch made; what the head says of the favicon then */
    readonly device: string | null;
    readonly loads: number;
    readonly favicon: string | null;
    /** the view of the page that names no viewport (`/legacy`), as it says it */
    readonly legacy: readonly [number, number] | null;
  };
  readonly touch: {
    readonly pointer: string | null;
    readonly touches: number;
    readonly scrollY: number | null;
    readonly held: boolean;
    /** where a tap on the page's link left it */
    readonly tapped: string | null;
  };
  /** PT-5b (ruling 5) — the phone's page that names no viewport, in hand. */
  readonly legacy: {
    /** its view as it says it (980 wide), and its density */
    readonly view: readonly [number, number] | null;
    readonly dpr: number | null;
    /** the marker's-hue pixels in the page's LAST strip, and in a strip two thirds across — each of so many */
    readonly last: { readonly px: number; readonly of: number };
    readonly third: { readonly px: number; readonly of: number };
    /** the document's scroll after the wheel; the type of its last pointer; where a tap on its link left the page */
    readonly scrollY: number | null;
    readonly pointer: string | null;
    readonly tapped: string | null;
    /** the page's own window (main's offscreen WebContents, by its id) as the pane was laid — a laptop, @2 — and now, a
     * phone, @3: another one — a window's density is its own for life, so the switch made the page's window anew */
    readonly windows: { readonly laptop: number | null; readonly phone: number | null };
  };
  readonly back: {
    readonly saw: PageSaw | null;
    readonly device: string | null;
    readonly loads: number;
    readonly favicon: string | null;
    /** the type of a press in hand after the switch back */
    readonly pointer: string | null;
  };
  readonly scheme: {
    /** the page under a dark desk, then under a light one; the documents loaded meanwhile (0: told live) */
    readonly dark: boolean | null;
    readonly light: boolean | null;
    readonly loads: number;
    /** the pane fixed `light`: the desk's theme then, and the page's scheme under it */
    readonly fixed: { readonly desk: string | null; readonly dark: boolean | null };
    /** the pane fixed `dark`: the same, under a light desk */
    readonly fixedDark: { readonly desk: string | null; readonly dark: boolean | null };
  };
  readonly cookie: {
    readonly value: string;
    /** the first pane's page: its cookie once it stored */
    readonly stored: string | null;
    /** the second pane's page: its cookie and its storage as it says them, the Cookie header its load came with */
    readonly read: { readonly cookie: string | null; readonly stored: string | null };
    readonly header: string | null;
    /** the cookies the app's shell holds for the origin (null: the driver could not read them) */
    readonly shell: number | null;
    /** the desk's profile under the user's data: its directory's name and how much it holds */
    readonly profile: { readonly dir: string; readonly entries: number } | null;
    /** the pages live on the desk then */
    readonly faces: number;
  };
}

const major = (version: string): string => version.split(".")[0] ?? "";
const viewIs = (saw: PageSaw, want: { readonly view: readonly number[]; readonly dpr: number }) =>
  saw.view[0] === want.view[0] && saw.view[1] === want.view[1] && saw.dpr === want.dpr;

/** A desktop as the engine announces it: Chrome at the bundled major with no app's token, hints with it, no fingers, its view. */
function desktop(row: string, saw: PageSaw | null, chrome: string): string[] {
  if (saw === null) return [`${row}: the page said nothing of how it is seen`];
  const out: string[] = [];
  const said = /Chrome\/(\d+)\.0\.0\.0 Safari\/537\.36$/.exec(saw.ua)?.[1];
  if (said === undefined || /Electron|VibeField|vibefield|Mobile/.test(saw.ua))
    out.push(`${row}: the page's agent is ${JSON.stringify(saw.ua)} — not a desktop Chrome's own`);
  else if (said !== major(chrome))
    out.push(
      `${row}: the page's agent says Chrome ${said}, not the bundled Chromium's ${major(chrome)}`,
    );
  if (saw.uaData === null || saw.uaData.platform === "" || saw.uaData.brands.length === 0)
    out.push(`${row}: the page's client hints are empty (${JSON.stringify(saw.uaData)})`);
  else if (saw.uaData.mobile) out.push(`${row}: the page's client hints say mobile on a desktop`);
  if (saw.touchPoints !== 0)
    out.push(`${row}: the page has ${saw.touchPoints} touch points, not a desktop's 0`);
  if (!viewIs(saw, DEVICE_ROWS.laptop))
    out.push(
      `${row}: the page's view is ${saw.view.join(" × ")} @${saw.dpr}, not the laptop's 1280 × 800 @2`,
    );
  return out;
}

/** LAPTOP: the pane as laid sees the engine's own desktop. */
export const judgeLaptop = (seen: DeviceSeen["laptop"]): string[] =>
  desktop("LAPTOP", seen.saw, seen.chrome);

/** TITLE: the held bar's readout — the anchor's and the printed one — is the page's title, and the page is called by it. */
export function judgeTitle(seen: DeviceSeen["title"]): string[] {
  const out: string[] = [];
  if (seen.readout !== FIXTURE_TITLE)
    out.push(
      `TITLE: the held bar's readout is ${JSON.stringify(seen.readout)}, not the page's title "${FIXTURE_TITLE}"`,
    );
  if (seen.bar !== FIXTURE_TITLE)
    out.push(`TITLE: the held bar prints ${JSON.stringify(seen.bar)}, not "${FIXTURE_TITLE}"`);
  if (seen.label !== FIXTURE_TITLE)
    out.push(
      `TITLE: the page is called ${JSON.stringify(seen.label)}, not by its title "${FIXTURE_TITLE}" (its words say ${JSON.stringify(seen.title)})`,
    );
  return out;
}

/** FAVICON: the head says the page's own and its hue is in the head's band; at a page that names none, the generic mark and no hue. */
export function judgeFavicon(seen: DeviceSeen["favicon"]): string[] {
  const out: string[] = [];
  if (seen.said?.startsWith("icon:") !== true)
    out.push(
      `FAVICON: the head says ${JSON.stringify(seen.said)}, not the page's own favicon (served ${seen.served} times)`,
    );
  if (seen.px < DEVICE_ROWS.icon.minPx)
    out.push(
      `FAVICON: ${seen.px} of the head's ${seen.of} pixels are the icon's hue, under ${DEVICE_ROWS.icon.minPx} — the favicon is not on the capsule`,
    );
  if (seen.none.said !== "generic")
    out.push(
      `FAVICON: at a page that names no icon the head says ${JSON.stringify(seen.none.said)}, not the generic mark`,
    );
  if (seen.none.px >= DEVICE_ROWS.icon.minPx)
    out.push(
      `FAVICON: ${seen.none.px} pixels of the icon's hue still on the head of a page that names none`,
    );
  return out;
}

/** PHONE: an iPhone's agent, the mobile hint, five fingers, 402 × 874 @3 — the device written, the page loaded ONCE more. */
export function judgePhone(seen: DeviceSeen["phone"]): string[] {
  const out: string[] = [];
  if (seen.device !== "phone") out.push(`PHONE: the act wrote device ${seen.device}, not phone`);
  const saw = seen.saw;
  if (saw === null) return [...out, "PHONE: the page said nothing of how it is seen"];
  if (!/\(iPhone; CPU iPhone OS /.test(saw.ua) || !/Mobile\//.test(saw.ua) || /Chrome/.test(saw.ua))
    out.push(`PHONE: the page's agent is ${JSON.stringify(saw.ua)}, not an iPhone's`);
  if (saw.platform !== "iPhone")
    out.push(`PHONE: navigator.platform is ${JSON.stringify(saw.platform)}, not iPhone`);
  if (saw.uaData === null || !saw.uaData.mobile || saw.uaData.platform !== "iOS")
    out.push(
      `PHONE: the page's client hints are ${JSON.stringify(saw.uaData)}, not a mobile's on iOS`,
    );
  if (saw.touchPoints !== DEVICE_ROWS.phone.touchPoints)
    out.push(`PHONE: the page has ${saw.touchPoints} touch points, not 5`);
  if (!viewIs(saw, DEVICE_ROWS.phone))
    out.push(
      `PHONE: the page's view is ${saw.view.join(" × ")} @${saw.dpr}, not the phone's 402 × 874 @3`,
    );
  if (seen.loads !== 1) out.push(`PHONE: the switch loaded the page ${seen.loads} times, not once`);
  if (seen.favicon?.startsWith("icon:") !== true)
    out.push(
      `PHONE: the head says ${JSON.stringify(seen.favicon)} of the favicon after the load, not the page's own`,
    );
  if (seen.legacy?.[0] !== DEVICE_ROWS.legacyWidth)
    out.push(
      `PHONE: a page that names no viewport is laid out ${seen.legacy === null ? "not at all" : `${seen.legacy.join(" × ")}`}, not ${DEVICE_ROWS.legacyWidth} px wide — the page is not laid out as a phone lays it`,
    );
  return out;
}

/** TOUCH: a press in hand arrives as a touch; the wheel still scrolls the page; the pane stays in hand. */
export function judgeTouch(seen: DeviceSeen["touch"]): string[] {
  const out: string[] = [];
  if (seen.pointer !== "touch")
    out.push(
      `TOUCH: the page's last pointer was ${JSON.stringify(seen.pointer)}, not a touch (${seen.touches} touchstarts)`,
    );
  else if (seen.touches < 1) out.push("TOUCH: the page saw no touchstart");
  if (seen.scrollY === null || seen.scrollY <= 0)
    out.push(`TOUCH: the wheel left the page's scroll at ${seen.scrollY} — it did not scroll`);
  if (!seen.held) out.push("TOUCH: the pane left the hand");
  if (seen.tapped !== "/next")
    out.push(
      `TOUCH: a tap on the page's link left it at ${seen.tapped ?? "nothing it said"}, not /next — the finger did not land where the link is drawn`,
    );
  return out;
}

/** LEGACY (PT-5b ruling 5): laid out 980 wide and SHOWN WHOLE — the marker at the pane's right edge and nowhere else — the
 * wheel scrolls the document, a tap on its link lands. */
export function judgeLegacy(seen: DeviceSeen["legacy"]): string[] {
  const out: string[] = [];
  if (seen.view?.[0] !== DEVICE_ROWS.legacyWidth)
    out.push(
      `LEGACY: the page that names no viewport is laid out ${seen.view === null ? "not at all" : seen.view.join(" × ")}, not ${DEVICE_ROWS.legacyWidth} px wide`,
    );
  if (seen.dpr !== DEVICE_ROWS.phone.dpr)
    out.push(`LEGACY: the page's density is ${seen.dpr}, not the phone's ${DEVICE_ROWS.phone.dpr}`);
  const share = (s: { px: number; of: number }): number => (s.of === 0 ? 0 : s.px / s.of);
  if (seen.last.of === 0) out.push("LEGACY: the page's last strip could not be read");
  else if (share(seen.last) < DEVICE_ROWS.edge.whole)
    out.push(
      `LEGACY: the page's right-edge marker fills ${(share(seen.last) * 100).toFixed(1)}% of the pane's last strip (${seen.last.px} of ${seen.last.of} px), not ${DEVICE_ROWS.edge.whole * 100}% — the page is not shown whole`,
    );
  if (share(seen.third) > DEVICE_ROWS.edge.elsewhere)
    out.push(
      `LEGACY: the marker's hue is ${(share(seen.third) * 100).toFixed(1)}% of a strip two thirds across the pane — the page is painted at another scale than its view's`,
    );
  if (seen.scrollY === null || seen.scrollY <= 0)
    out.push(
      `LEGACY: the wheel left the document's scroll at ${seen.scrollY} — it panned the view, or did nothing`,
    );
  if (seen.pointer !== "touch")
    out.push(`LEGACY: the page's last pointer was ${JSON.stringify(seen.pointer)}, not a touch`);
  if (seen.tapped !== "/next")
    out.push(
      `LEGACY: a tap on the page's link left it at ${seen.tapped ?? "nothing it said"}, not /next — the finger did not land where the link is drawn`,
    );
  if (seen.windows.laptop === null || seen.windows.phone === null)
    out.push(
      `LEGACY: the page's own window could not be found (as a laptop: ${seen.windows.laptop}, as a phone: ${seen.windows.phone})`,
    );
  else if (seen.windows.laptop === seen.windows.phone)
    out.push(
      `LEGACY: the phone's page is in the window the laptop's was laid in (${seen.windows.phone}) — a window born at @2 paints a phone's page at two thirds`,
    );
  return out;
}

/** BACK: a desktop again — the agent it was laid with — no fingers, 1280 × 800 @2, loaded ONCE more; a press is a mouse's. */
export function judgeBack(seen: DeviceSeen["back"], laid: DeviceSeen["laptop"]): string[] {
  const out = desktop("BACK", seen.saw, laid.chrome);
  if (seen.device !== "laptop") out.push(`BACK: the act wrote device ${seen.device}, not laptop`);
  if (seen.saw !== null && laid.saw !== null && seen.saw.ua !== laid.saw.ua)
    out.push(
      `BACK: the page's agent is ${JSON.stringify(seen.saw.ua)}, not the one it was laid with (${JSON.stringify(laid.saw.ua)})`,
    );
  if (seen.loads !== 1) out.push(`BACK: the switch loaded the page ${seen.loads} times, not once`);
  if (seen.favicon?.startsWith("icon:") !== true)
    out.push(
      `BACK: the head says ${JSON.stringify(seen.favicon)} of the favicon after the load, not the page's own`,
    );
  if (seen.pointer !== "mouse")
    out.push(`BACK: a press in hand arrived as ${JSON.stringify(seen.pointer)}, not a mouse's`);
  return out;
}

/** SCHEME: dark under a dark desk, light under a light one — told live, no load — and a pane fixed light stays light under dark. */
export function judgeScheme(seen: DeviceSeen["scheme"]): string[] {
  const out: string[] = [];
  if (seen.dark !== true)
    out.push(
      `SCHEME: under a dark desk the page's prefers-color-scheme: dark is ${seen.dark}, not true`,
    );
  if (seen.light !== false)
    out.push(
      `SCHEME: under a light desk the page's prefers-color-scheme: dark is ${seen.light}, not false`,
    );
  if (seen.loads !== 0)
    out.push(`SCHEME: the theme's turns loaded the page ${seen.loads} times — it is told live`);
  if (seen.fixed.desk !== "dark")
    out.push(
      `SCHEME: the desk was ${seen.fixed.desk}, not dark, when the fixed pane was read — the row proved nothing`,
    );
  if (seen.fixed.dark !== false)
    out.push(
      `SCHEME: a pane fixed light says prefers-color-scheme: dark is ${seen.fixed.dark} under a dark desk`,
    );
  if (seen.fixedDark.desk !== "light")
    out.push(
      `SCHEME: the desk was ${seen.fixedDark.desk}, not light, when the pane fixed dark was read — the row proved nothing`,
    );
  if (seen.fixedDark.dark !== true)
    out.push(
      `SCHEME: a pane fixed dark says prefers-color-scheme: dark is ${seen.fixedDark.dark} under a light desk`,
    );
  return out;
}

/** COOKIE: the second pane's page reads what the first's stored — cookie, header and storage — and the shell holds none. */
export function judgeCookie(seen: DeviceSeen["cookie"]): string[] {
  const out: string[] = [];
  const kept = `${FIXTURE_COOKIE}=${seen.value}`;
  const has = (s: string | null): boolean => s?.split("; ").includes(kept) === true;
  if (!has(seen.stored))
    out.push(
      `COOKIE: the first page's cookie is ${JSON.stringify(seen.stored)} — it never kept ${kept}`,
    );
  if (!has(seen.read.cookie))
    out.push(
      `COOKIE: the second pane's page reads the cookie ${JSON.stringify(seen.read.cookie)}, not ${kept} — the desk's pages do not share a profile`,
    );
  if (!has(seen.header))
    out.push(
      `COOKIE: the second pane's load came with the Cookie header ${JSON.stringify(seen.header)}, not ${kept}`,
    );
  if (seen.read.stored !== seen.value)
    out.push(
      `COOKIE: the second pane's page reads ${JSON.stringify(seen.read.stored)} from its storage, not ${JSON.stringify(seen.value)}`,
    );
  if (seen.faces < 2)
    out.push(`COOKIE: ${seen.faces} pages were live on the desk, not the two panes'`);
  if (seen.shell === null) out.push("COOKIE: the shell's cookies could not be read");
  else if (seen.shell !== 0)
    out.push(
      `COOKIE: the app's shell holds ${seen.shell} cookies for the fixture's origin — the desk's pages are not partitioned from it`,
    );
  if (seen.profile === null) out.push("COOKIE: the desk's profile could not be read");
  else {
    if (!seen.profile.dir.endsWith(join("browser", "profiles", DESK_PROFILE_DIR)))
      out.push(
        `COOKIE: the desk's profile is at ${seen.profile.dir}, not browser/profiles/${DESK_PROFILE_DIR} under the user's data`,
      );
    if (seen.profile.entries < 1)
      out.push(`COOKIE: the desk's profile at ${seen.profile.dir} holds nothing`);
  }
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The rows' driver: PT-2's, the shell's cookies for an origin, and the desk's profile under the user's data. */
export interface DeviceRowsDriver extends LiveRowsDriver {
  /** The cookies the app's SHELL holds for `url`: its window's session and Electron's default, counted. */
  shellCookies(url: string): Promise<number>;
  /** The directory `<user root>/browser/profiles/<name>` and how many entries it holds (0: none, or no such directory). */
  profile(name: string): { readonly dir: string; readonly entries: number };
  /** The bundled Chromium's version as the host reads it (`process.versions.chrome`). */
  readonly chrome: string;
  /** PT-5b: the id of main's offscreen WebContents whose address begins with `prefix` — a page's own window — or null. */
  pageId?(prefix: string): number | null;
}

/** A face's row by its key, off the door. */
const FACE_ROW = (key: string): string =>
  `((globalThis.__vfDesk.live()?.faces ?? []).find((f) => f.key === ${JSON.stringify(key)}) ?? null)`;

/** The icon's hue angle (degrees). */
export const ICON_HUE_DEG = ((): number => {
  const { r, g, b } = FIXTURE_ICON_HUE;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
})();

/** The pixel classifier, as source: 1 the favicon's hue, 0 anything else. The renderer runs it over a capture (a bitmap never
 * crosses) and the rows' units run the same text. */
export const ICON_CLASSIFY = `((r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (max < ${DEVICE_ROWS.icon.minMax} || d === 0 || d / max < ${DEVICE_ROWS.icon.minSat}) return 0;
  const h = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  const off = Math.abs(h - ${ICON_HUE_DEG.toFixed(2)});
  return Math.min(off, 360 - off) <= ${DEVICE_ROWS.icon.deg} ? 1 : 0;
})`;

/** The marker's hue angle (degrees). */
export const EDGE_HUE_DEG = ((): number => {
  const { r, g, b } = FIXTURE_EDGE.hue;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
})();

/** The pixel classifier, as source: 1 the marker's hue, 0 anything else. */
export const EDGE_CLASSIFY = `((r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (max < ${DEVICE_ROWS.edge.minMax} || d === 0 || d / max < ${DEVICE_ROWS.edge.minSat}) return 0;
  const h = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  const off = Math.abs(h - ${EDGE_HUE_DEG.toFixed(2)});
  return Math.min(off, 360 - off) <= ${DEVICE_ROWS.edge.deg} ? 1 : 0;
})`;

/** A region of the desk captured without the marks: how many of its pixels are the marker's hue. */
const EDGE_HUE = (rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string => `(async () => {
  const shot = await globalThis.__vfDesk.capture({ rect: ${JSON.stringify(rect)}, marks: false });
  if (shot === undefined) return null;
  const w = shot.width, h = shot.height;
  const c = new OffscreenCanvas(w, h); const x = c.getContext("2d"); x.drawImage(shot, 0, 0, w, h); shot.close();
  const b = x.getImageData(0, 0, w, h).data;
  const classify = ${EDGE_CLASSIFY};
  let px = 0;
  for (let i = 0; i < b.length; i += 4) px += classify(b[i], b[i + 1], b[i + 2]);
  return { px, of: w * h };
})()`;

/**
 * A strip of the PAGE of a pane in hand, desk CSS px: the open extent is the page and the head — as wide as the page, ending
 * at its foot — so the page stands at the extent's foot, its height its view's by the extent's scale. `cols` and `rows`:
 * shares of the page's width and of its height.
 */
export function pageStrip(
  f: Pick<HeldFrameSeen, "cx" | "cy" | "hx" | "hy">,
  view: readonly [number, number],
  cols: readonly [number, number],
  rows: readonly [number, number],
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const w = 2 * f.hx;
  const tall = (view[1] * w) / view[0];
  const top = f.cy + f.hy - tall;
  return {
    x: Math.round(f.cx - f.hx + cols[0] * w),
    y: Math.round(top + rows[0] * tall),
    width: Math.max(1, Math.round((cols[1] - cols[0]) * w)),
    height: Math.max(1, Math.round((rows[1] - rows[0]) * tall)),
  };
}

/** A region of the desk captured without the marks: how many of its pixels are the favicon's hue. */
const ICON_HUE = (rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string => `(async () => {
  const shot = await globalThis.__vfDesk.capture({ rect: ${JSON.stringify(rect)}, marks: false });
  if (shot === undefined) return null;
  const w = shot.width, h = shot.height;
  const c = new OffscreenCanvas(w, h); const x = c.getContext("2d"); x.drawImage(shot, 0, 0, w, h); shot.close();
  const b = x.getImageData(0, 0, w, h).data;
  const classify = ${ICON_CLASSIFY};
  let px = 0;
  for (let i = 0; i < b.length; i += 4) px += classify(b[i], b[i + 1], b[i + 2]);
  return { px, of: w * h };
})()`;

/**
 * The HEAD's band of a pane in hand, desk CSS px: the open extent is the page and the head — as wide as the page, ending at
 * its foot (the pane's law `openExtent`) — so the head is what stands over the page.
 */
export function headBand(
  f: Pick<HeldFrameSeen, "cx" | "cy" | "hx" | "hy">,
  view: readonly [number, number],
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const k = (2 * f.hx) / view[0];
  return {
    x: Math.floor(f.cx - f.hx),
    y: Math.floor(f.cy - f.hy),
    width: Math.ceil(2 * f.hx),
    height: Math.max(1, Math.round(2 * f.hy - view[1] * k)),
  };
}

/** PT-4's rows (above). Returns the problems, each in words. */
export async function devicePaneRows(d: DeviceRowsDriver): Promise<string[]> {
  const { say, win } = d;
  const h = paneHands(d);
  const { js, until, press, move, key, drag, census, rows } = h;
  const problems: string[] = [];
  const said: Partial<Record<keyof DeviceSeen, unknown>> = {};
  const ambient = await js<string>("globalThis.__vfDesk.ambient()");
  const themeWas = await js<string>("globalThis.__vfDesk.theme()");
  await h.theme("light");
  await js(`globalThis.__vfDesk.ambient("still")`);
  d.fixture.setPlaying(false);
  const before = await census();
  const panes: number[] = [];

  const report = (): FixtureReport | null => d.fixture.report();
  /** Each laid pane's durable key (its face's key). */
  const keys = new Map<number, string>();
  const paneKeyOf = (e: number): string => keys.get(e) ?? "";
  /** The page's word that `ok` accepts, waited for; the last one it said (logged) if none does in time. */
  const hear = async (
    label: string,
    ok: (r: FixtureReport) => boolean,
    from: () => FixtureReport | null = report,
  ): Promise<FixtureReport | null> => {
    const deadline = Date.now() + DEVICE_ROWS.withinMs;
    while (Date.now() < deadline) {
      const r = from();
      if (r !== null && ok(r)) return r;
      await sleep(100);
    }
    say(`SMOKE_CANVAS_DEVICE_UNHEARD ${JSON.stringify({ label, last: from() })}`);
    return null;
  };
  const propsOf = async (e: number): Promise<Readonly<Record<string, unknown>> | null> =>
    (await rows()).find((r) => r.entity === e)?.props ?? null;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const held = (): Promise<number | null> =>
    js<number | null>("globalThis.__vfDesk.held()?.entity ?? null");
  const heldFrame = (): Promise<HeldFrameSeen | null> =>
    js<HeldFrameSeen | null>("globalThis.__vfDesk.held()?.frame ?? null");
  const headSays = (e: number): Promise<string | null> =>
    js<string | null>(
      `globalThis.__vfDesk.local(${JSON.stringify(PANE.type)})?.said?.(${e})?.favicon ?? null`,
    );
  /** The camera once it holds still (a put-down flies home): two reads 250 ms apart, the same. */
  const settledCamera = async (): Promise<void> => {
    let last = "";
    for (let i = 0; i < 24; i += 1) {
      const now = JSON.stringify(await js("globalThis.__vfDesk.camera()"));
      if (now === last) return;
      last = now;
      await sleep(250);
    }
  };
  /** The pane's middle at rest on the window — its rect off the door, through the camera. */
  const middleOf = async (e: number): Promise<{ x: number; y: number } | null> => {
    const r = (await rows()).find((x) => x.entity === e)?.rect;
    if (r === undefined) return null;
    const c = await js<{ x: number; y: number; zoom: number }>("globalThis.__vfDesk.camera()");
    const at = await h.deskAt();
    return {
      x: at.left + (r.x + r.w / 2 - c.x) * c.zoom,
      y: at.top + (r.y + r.h / 2 - c.y) * c.zoom,
    };
  };
  /** A point of the page (a share of its view) on the window, the pane in hand. */
  const onPage = async (sx: number, sy: number): Promise<{ x: number; y: number }> => {
    const f = await heldFrame();
    const r = report();
    if (f === null || r === null) throw new Error("no page in hand to point at");
    return pageOnWindow(f, r.view, await h.deskAt(), r.view[0] * sx, r.view[1] * sy);
  };
  /** The pane selected at rest: a press on its middle, the selection bar over it. */
  const select = async (e: number): Promise<void> => {
    await settledCamera();
    const at = await middleOf(e);
    if (at === null) throw new Error("the pane left the board");
    await press(at);
    await until("the pane selected", 10_000, "(globalThis.__vfDesk.anchor()?.count ?? 0) === 1");
    await sleep(300);
  };
  /** The pane picked up: selected, ⏎, in hand, settled. */
  const pickUp = async (e: number): Promise<void> => {
    await select(e);
    await key("Return");
    await until("the pane in hand", 10_000, `globalThis.__vfDesk.held()?.entity === ${e}`);
    await until(
      "the pick-up settled",
      10_000,
      "globalThis.__vfDesk.held()?.frame?.settled === true",
    );
    await sleep(400);
  };
  /** The held bar's Done: the pane put down by the hand's own act. */
  const done = async (): Promise<void> => {
    await h.pressSelector('[data-selection-bar] [data-act="done"]');
    await until("the pane put down by Done", 5_000, "globalThis.__vfDesk.held() === null");
    await settledCamera();
  };
  /** The selection bar's device act pressed on the pane at rest; the fixture's loads of `/page` it made once `ok` is heard. */
  const switchTo = async (
    e: number,
    device: "phone" | "laptop",
    ok: (r: FixtureReport) => boolean,
  ): Promise<{ heard: FixtureReport | null; loads: number; favicon: string | null }> => {
    await select(e);
    const act = `[data-selection-bar] .vf-bar-row [data-act="act:device-${device}"]`;
    await until(
      `the bar's ${device} act`,
      10_000,
      `document.querySelector(${JSON.stringify(act)}) !== null && document.querySelector("[data-selection-bar]")?.getAttribute("data-shown") === "true"`,
    );
    await sleep(300);
    const loads = d.fixture.served("/page");
    await h.pressSelector(act);
    const heard = await hear(`the page seen as a ${device}`, ok);
    // a second load would follow the first within a moment: listened for before the count is read
    await sleep(1500);
    say(
      `SMOKE_CANVAS_DEVICE_SWITCHED ${JSON.stringify({ device, head: await headSays(e), face: await js(`(() => { const f = ${FACE_ROW(paneKeyOf(e))}; return f === null ? null : { favicon: f.favicon, emulation: f.emulation, demand: f.demand, state: f.state, info: f.info }; })()`), icons: d.fixture.icons(), live: await js("globalThis.__vfDesk.live()?.stats ?? null") })}`,
    );
    return { heard, loads: d.fixture.served("/page") - loads, favicon: await headSays(e) };
  };
  /** The page's scroll once it holds (a wheel's scroll is animated): two of its words 600 ms apart, the same. */
  const scrollHeld = async (): Promise<number | null> => {
    let last = report()?.scrollY ?? null;
    for (let i = 0; i < 10; i += 1) {
      await sleep(600);
      const now = report()?.scrollY ?? null;
      if (now === last) return now;
      last = now;
    }
    return last;
  };
  /** The head's band of the pane in hand: the icon's-hue pixels in it. */
  const headHue = async (): Promise<{ px: number; of: number }> => {
    const f = await heldFrame();
    const r = report();
    if (f === null || r === null) return { px: 0, of: 0 };
    return (
      (await js<{ px: number; of: number } | null>(ICON_HUE(headBand(f, r.view)))) ?? {
        px: 0,
        of: 0,
      }
    );
  };
  const shoot = async (name: string): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await win.capturePage()).toPNG());
  };
  /** A press on the held bar's tool. */
  const pressTool = async (id: string): Promise<void> => {
    const p = await js<{ x: number; y: number } | null>(`(() => {
      const row = document.querySelector('[data-selection-bar] [data-face-row="hand"]');
      const el = [...(row?.querySelectorAll("[data-tool]") ?? [])].find((t) => t.getAttribute("data-tool") === ${JSON.stringify(id)});
      if (el === undefined) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (p === null) throw new Error(`the held bar has no ${id}`);
    await press(p);
  };
  /** The view panned by drags on the bare mat until the pane's middle stands in the window (its delete's press needs it). */
  const bringBack = async (e: number): Promise<void> => {
    const view = await js<{ w: number; h: number }>("({ w: innerWidth, h: innerHeight })");
    const off = await h.deskAt();
    for (let i = 0; i < 16; i += 1) {
      const at = await middleOf(e);
      if (at === null) return;
      const by = { dx: view.w / 2 - at.x, dy: view.h * 0.5 - at.y };
      if (Math.hypot(by.dx, by.dy) < 120) return;
      const step = {
        dx: Math.max(-500, Math.min(500, by.dx)),
        dy: Math.max(-300, Math.min(300, by.dy)),
      };
      const mat = await js<{ x: number; y: number } | null>(BARE_FOR(step.dx, step.dy));
      if (mat === null) throw new Error("no bare mat to pan the desk from");
      const from = { x: off.left + mat.x, y: off.top + mat.y };
      await drag(from, { x: from.x + step.dx, y: from.y + step.dy }, 8, 300);
      await sleep(500);
    }
  };
  const phoneSeen = (r: FixtureReport): boolean =>
    r.path === "/page" && /iPhone/.test(r.ua) && r.view[0] === 402 && r.dpr === 3;
  const laptopSeen = (r: FixtureReport): boolean =>
    r.path === "/page" && !/iPhone/.test(r.ua) && r.view[0] === 1280 && r.dpr === 2;

  try {
    // ── the pane laid alone on clear ground, at actual size, brought to the middle, pointed at the fixture, live ───────
    const at = await layPane(h, before, (e) => {
      panes.push(e);
    });
    if (at.pane === undefined) throw new Error("no new pane on the board after the take");
    const e = at.pane;
    await paneToMiddle(h, e, at);
    await settledCamera();
    const paneKey = (await rows()).find((r) => r.entity === e)?.key;
    if (paneKey === undefined || paneKey === null)
      throw new Error("the door gives the pane no durable key");
    keys.set(e, paneKey);
    if (
      !(await js<boolean>(
        `globalThis.__vfDesk.writeProps(${e}, { url: ${JSON.stringify(d.fixture.url)} })`,
      ))
    )
      throw new Error("the door could not point the pane at the fixture");
    try {
      await until(
        "the page live on the face",
        30_000,
        `(() => { const f = ${FACE_ROW(paneKey)}; return f !== null && f.state.is === "live" && f.presented >= 1; })()`,
      );
    } catch (error) {
      say(
        `SMOKE_CANVAS_DEVICE_FACE ${JSON.stringify({ live: await js("globalThis.__vfDesk.live()"), props: await propsOf(e) })}`,
      );
      throw error;
    }

    // ── LAPTOP: the page as the pane was laid — the engine's own desktop ─────────────────────────────────────────────
    const first = await hear(
      "the page's first word",
      (r) => r.path === "/page" && r.ua !== undefined,
    );
    if (first === null) throw new Error("the fixture page never spoke");
    const laptop: DeviceSeen["laptop"] = { saw: sawOf(first), chrome: d.chrome };
    // PT-5b: the page's own window as it was laid (LEGACY reads it against the phone's)
    const laptopWindow = d.pageId?.(d.fixture.origin) ?? null;
    said.laptop = laptop;
    problems.push(...judgeLaptop(laptop));

    // ── TITLE: in hand, the bar's readout is the page's title; the page is called by it ──────────────────────────────
    await pickUp(e);
    await until(
      "the readout the page's title",
      10_000,
      `globalThis.__vfDesk.anchor()?.held?.readout === ${JSON.stringify(FIXTURE_TITLE)}`,
    ).catch(() => undefined);
    const title: DeviceSeen["title"] = {
      readout: await js<string | null>("globalThis.__vfDesk.anchor()?.held?.readout ?? null"),
      bar: await js<string | null>(
        `document.querySelector('[data-selection-bar] [data-face-row="hand"] [data-readout]')?.textContent ?? null`,
      ),
      label: await js<string | null>(`${FACE_ROW(paneKey)}?.label ?? null`),
      title: await js<string | null>(`${FACE_ROW(paneKey)}?.info?.title ?? null`),
    };
    said.title = title;
    problems.push(...judgeTitle(title));

    // ── FAVICON: the head says the page's own and prints its hue; at /next (no icon named) the generic mark, no hue ──
    await until(
      "the head saying the page's favicon",
      10_000,
      `String(globalThis.__vfDesk.local(${JSON.stringify(PANE.type)})?.said?.(${e})?.favicon ?? "").startsWith("icon:")`,
    ).catch(() => undefined);
    await sleep(600);
    const own = { said: await headSays(e), ...(await headHue()) };
    await shoot("pt-4-pane-favicon.png");
    const link = report()?.parts.link;
    if (link === undefined) throw new Error("the page said nothing of its link");
    const view0 = report()?.view ?? [1280, 800];
    await press(await onPage((link.x + link.w / 2) / view0[0], (link.y + link.h / 2) / view0[1]));
    await hear("the page at /next", (r) => r.path === "/next");
    await until(
      "the head saying the generic mark",
      10_000,
      `globalThis.__vfDesk.local(${JSON.stringify(PANE.type)})?.said?.(${e})?.favicon === "generic"`,
    ).catch(() => undefined);
    await sleep(600);
    const none = { said: await headSays(e), px: (await headHue()).px };
    await shoot("pt-4-pane-generic.png");
    const favicon: DeviceSeen["favicon"] = { ...own, served: d.fixture.icons(), none };
    said.favicon = favicon;
    problems.push(...judgeFavicon(favicon));
    await pressTool("back");
    await hear("the page back at /page", (r) => r.path === "/page");
    await done();

    // ── PHONE: the bar's iPhone act — the page told and loaded once more: an iPhone's agent, hints, fingers, view ─────
    const toPhone = await switchTo(e, "phone", phoneSeen);
    const phoneProps = await propsOf(e);
    // the phone's LAYOUT: the page that names no viewport, then back to the fixture's own
    await js(
      `globalThis.__vfDesk.writeProps(${e}, { url: ${JSON.stringify(d.fixture.origin + DEVICE_ROWS.legacyPath)} })`,
    );
    const legacy = await hear(
      "the page that names no viewport",
      (r) => r.view !== undefined,
      () => d.fixture.reportAt(DEVICE_ROWS.legacyPath),
    );
    const tokenLegacy = legacy?.token;
    await js(`globalThis.__vfDesk.writeProps(${e}, { url: ${JSON.stringify(d.fixture.url)} })`);
    await hear(
      "the fixture's own page again",
      (r) => r.path === "/page" && r.token !== tokenLegacy,
    );
    const phone: DeviceSeen["phone"] = {
      saw: sawOf(toPhone.heard ?? report()),
      device: str(phoneProps?.device),
      loads: toPhone.loads,
      favicon: toPhone.favicon,
      legacy: legacy?.view ?? null,
    };
    said.phone = phone;
    problems.push(...judgePhone(phone));

    // ── TOUCH: in hand, a press on the page's ground is a touch; the wheel still scrolls the page ────────────────────
    await pickUp(e);
    await shoot("pt-4-pane-phone-in-hand.png");
    await press(await onPage(0.85, 0.3));
    const touched = await hear("the page touched", (r) => r.pointer !== "");
    const mid = await onPage(0.5, 0.4);
    move(mid.x, mid.y);
    await sleep(150);
    for (let i = 0; i < DEVICE_ROWS.wheelSteps; i += 1) {
      win.webContents.sendInputEvent({
        type: "mouseWheel",
        x: Math.round(mid.x),
        y: Math.round(mid.y),
        deltaX: 0,
        deltaY: -DEVICE_ROWS.wheelPx / DEVICE_ROWS.wheelSteps,
        canScroll: true,
      });
      await sleep(40);
    }
    await hear("the touch page scrolled", (r) => r.scrollY > 0);
    const scrolled = await scrollHeld();
    // a tap on the link, where the page draws it now (its box as the page says it, after the scroll)
    const linkNow = report()?.parts.link;
    const viewNow = report()?.view ?? DEVICE_ROWS.phone.view;
    let tapped: string | null = null;
    if (linkNow !== undefined) {
      await press(
        await onPage(
          (linkNow.x + linkNow.w / 2) / viewNow[0],
          (linkNow.y + linkNow.h / 2) / viewNow[1],
        ),
      );
      tapped =
        (await hear("the phone page's link tapped", (r) => r.path === "/next"))?.path ??
        report()?.path ??
        null;
    }
    const touch: DeviceSeen["touch"] = {
      pointer: touched?.pointer ?? null,
      touches: touched?.touches ?? 0,
      scrollY: scrolled,
      held: (await held()) === e,
      tapped,
    };
    said.touch = touch;
    problems.push(...judgeTouch(touch));

    // ── LEGACY (PT-5b ruling 5): the page that names no viewport, on the phone, in hand — 980 wide AND shown whole ────
    const legacyAt = (): FixtureReport | null => d.fixture.reportAt(DEVICE_ROWS.legacyPath);
    const legacyWas = legacyAt()?.token;
    await js(
      `globalThis.__vfDesk.writeProps(${e}, { url: ${JSON.stringify(d.fixture.origin + DEVICE_ROWS.legacyPath)} })`,
    );
    const wide = await hear(
      "the page that names no viewport, in hand",
      (r) => r.token !== legacyWas && r.view !== undefined,
      legacyAt,
    );
    // its frame drawn at the hand's raster, then read where it is drawn
    await sleep(1200);
    await shoot("pt-5b-legacy-in-hand.png");
    const frameNow = await heldFrame();
    const strip = async (cols: readonly [number, number]): Promise<{ px: number; of: number }> =>
      frameNow === null
        ? { px: 0, of: 0 }
        : ((await js<{ px: number; of: number } | null>(
            EDGE_HUE(pageStrip(frameNow, DEVICE_ROWS.phone.view, cols, DEVICE_ROWS.edgeStrip.rows)),
          )) ?? { px: 0, of: 0 });
    const last = await strip(DEVICE_ROWS.edgeStrip.last);
    const third = await strip(DEVICE_ROWS.edgeStrip.third);
    // the wheel over it scrolls the DOCUMENT (forced to the view's scale it panned the view inside the layout instead)
    const over = await onPage(0.5, 0.4);
    move(over.x, over.y);
    await sleep(150);
    for (let i = 0; i < DEVICE_ROWS.wheelSteps; i += 1) {
      win.webContents.sendInputEvent({
        type: "mouseWheel",
        x: Math.round(over.x),
        y: Math.round(over.y),
        deltaX: 0,
        deltaY: -DEVICE_ROWS.wheelPx / DEVICE_ROWS.wheelSteps,
        canScroll: true,
      });
      await sleep(40);
    }
    await hear("the legacy page scrolled", (r) => r.scrollY > 0, legacyAt);
    let legacyScroll = legacyAt()?.scrollY ?? null;
    for (let i = 0; i < 10; i += 1) {
      await sleep(600);
      const now = legacyAt()?.scrollY ?? null;
      if (now === legacyScroll) break;
      legacyScroll = now;
    }
    // a tap on its link, where the page draws it now: its box in the page's own px (980 across), through the view
    const wideLink = legacyAt()?.parts.link;
    const wideView = legacyAt()?.view ?? [DEVICE_ROWS.legacyWidth, 2131];
    let wideTapped: string | null = null;
    let widePointer: string | null = null;
    if (wideLink !== undefined && frameNow !== null) {
      const before = d.fixture.served("/next");
      const point = pageOnWindow(
        frameNow,
        wideView,
        await h.deskAt(),
        wideLink.x + wideLink.w / 2,
        wideLink.y + wideLink.h / 2,
      );
      await press(point);
      const landed = await hear("the legacy page's link tapped", (r) => r.path === "/next");
      wideTapped =
        landed?.path ?? (d.fixture.served("/next") > before ? "/next" : (report()?.path ?? null));
      widePointer = legacyAt()?.pointer ?? null;
    }
    const legacyRow: DeviceSeen["legacy"] = {
      view: wide?.view ?? legacyAt()?.view ?? null,
      dpr: wide?.dpr ?? null,
      last,
      third,
      scrollY: legacyScroll,
      pointer: widePointer,
      tapped: wideTapped,
      windows: { laptop: laptopWindow, phone: d.pageId?.(d.fixture.origin) ?? null },
    };
    said.legacy = legacyRow;
    problems.push(...judgeLegacy(legacyRow));
    await js(`globalThis.__vfDesk.writeProps(${e}, { url: ${JSON.stringify(d.fixture.url)} })`);
    await hear("the fixture's own page after the tap", (r) => r.path === "/page");
    await done();

    // ── BACK: the bar's Laptop act — a desktop again, loaded once more; a press in hand is a mouse's ─────────────────
    const toLaptop = await switchTo(e, "laptop", laptopSeen);
    await pickUp(e);
    await press(await onPage(0.85, 0.3));
    const clicked = await hear("the page pressed", (r) => r.pointer !== "");
    const back: DeviceSeen["back"] = {
      saw: sawOf(toLaptop.heard ?? report()),
      device: str((await propsOf(e))?.device),
      loads: toLaptop.loads,
      favicon: toLaptop.favicon,
      pointer: clicked?.pointer ?? null,
    };
    said.back = back;
    problems.push(...judgeBack(back, laptop));
    await done();

    // ── SCHEME: the desk dark — the page dark, live; light — light; the pane fixed light under a dark desk ───────────
    const loadsScheme = d.fixture.served("/page");
    await h.theme("dark");
    const dark = await hear("the page dark", (r) => r.dark === true);
    await h.theme("light");
    const light = await hear("the page light", (r) => r.dark === false);
    const schemeLoads = d.fixture.served("/page") - loadsScheme;
    if (!(await js<boolean>(`globalThis.__vfDesk.writeProps(${e}, { scheme: "light" })`)))
      throw new Error("the door could not fix the pane's scheme");
    await sleep(400);
    await h.theme("dark");
    await sleep(DEVICE_ROWS.quietMs);
    const scheme: DeviceSeen["scheme"] = {
      dark: dark?.dark ?? report()?.dark ?? null,
      light: light?.dark ?? report()?.dark ?? null,
      loads: schemeLoads,
      fixed: {
        desk: await js<string | null>("globalThis.__vfDesk.theme()"),
        dark: report()?.dark ?? null,
      },
      fixedDark: await (async () => {
        await js(`globalThis.__vfDesk.writeProps(${e}, { scheme: "dark" })`);
        await sleep(400);
        await h.theme("light");
        await hear("the pane fixed dark under a light desk", (r) => r.dark === true);
        await sleep(600);
        return {
          desk: await js<string | null>("globalThis.__vfDesk.theme()"),
          dark: report()?.dark ?? null,
        };
      })(),
    };
    said.scheme = scheme;
    problems.push(...judgeScheme(scheme));
    await h.theme("light");
    await js(`globalThis.__vfDesk.writeProps(${e}, { scheme: "desk" })`);
    await sleep(400);

    // ── COOKIE: the page stores a value; a SECOND pane's page on the origin reads it; the app's shell does not ───────
    const value = `v${Date.now().toString(36)}`;
    const storeAt = DEVICE_ROWS.storePath(value);
    if (
      !(await js<boolean>(
        `globalThis.__vfDesk.writeProps(${e}, { url: ${JSON.stringify(d.fixture.origin + storeAt)} })`,
      ))
    )
      throw new Error("the door could not send the pane to store its value");
    const stored = await hear(
      "the first page's cookie",
      (r) => r.cookie.includes(`${FIXTURE_COOKIE}=`),
      () => d.fixture.reportAt(storeAt),
    );
    const second = await layPane(h, await census(), (p) => {
      panes.push(p);
    });
    if (second.pane === undefined) throw new Error("no second pane on the board after the take");
    await settledCamera();
    if (
      !(await js<boolean>(
        `globalThis.__vfDesk.writeProps(${second.pane}, { url: ${JSON.stringify(d.fixture.origin + DEVICE_ROWS.readPath)} })`,
      ))
    )
      throw new Error("the door could not point the second pane at the fixture");
    const read = await hear(
      "the second pane's page",
      (r) => typeof r.cookie === "string",
      () => d.fixture.reportAt(DEVICE_ROWS.readPath),
    );
    // its storage and its cookie as it says them a moment on (its first word may come before either is read back)
    await sleep(600);
    const readNow = d.fixture.reportAt(DEVICE_ROWS.readPath) ?? read;
    let shell: number | null = null;
    try {
      shell = await d.shellCookies(d.fixture.origin);
    } catch {
      shell = null;
    }
    let profile: DeviceSeen["cookie"]["profile"] = null;
    try {
      profile = d.profile(DESK_PROFILE_DIR);
    } catch {
      profile = null;
    }
    const cookie: DeviceSeen["cookie"] = {
      value,
      stored: stored?.cookie ?? d.fixture.reportAt(storeAt)?.cookie ?? null,
      read: { cookie: readNow?.cookie ?? null, stored: readNow?.stored ?? null },
      header: d.fixture.cookieSeen(DEVICE_ROWS.readPath),
      shell,
      profile,
      faces: await js<number>("(globalThis.__vfDesk.live()?.faces ?? []).length"),
    };
    said.cookie = cookie;
    problems.push(...judgeCookie(cookie));
    await shoot("pt-4-two-panes.png");
  } catch (error) {
    // a step that cannot go on ends the rows — never what the rows before it found (they are said with it)
    problems.push(`PT-4 DEVICE: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    d.fixture.setPlaying(false);
    say(`SMOKE_CANVAS_DEVICE ${JSON.stringify(said)}`);
    try {
      if ((await held()) !== null) await done();
      await h.theme("light");
      // the last laid first (it stands in the view); the view panned back for the first
      for (const pane of [...panes].reverse()) {
        await key("Escape");
        await bringBack(pane);
        await settledCamera();
        const at = await middleOf(pane);
        if (at === null) continue;
        await press(at);
        await sleep(300);
        if ((await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0")) === 1)
          await key("Backspace");
        await sleep(500);
      }
    } catch {
      /* a row that cannot go on ends the rows, never what the earlier rows found */
    }
    const after = await census();
    if (after !== before)
      problems.push(
        `CLEARED: ${after} panes on the board after the device rows, not the ${before} found`,
      );
    say(`SMOKE_CANVAS_DEVICE_CLEARED ${JSON.stringify({ before, after })}`);
    await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient)})`);
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(themeWas)})`);
  }
  return problems;
}
