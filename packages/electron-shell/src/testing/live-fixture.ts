// PT-2 — THE SMOKE'S FIXTURE PAGE, served by the smoke itself on 127.0.0.1 (the browser source's policy admits any http(s) host,
// loopback included — browser-security.ts `isAllowedBrowserTopLevelUrl`/`isAllowedBrowserRequest`, and the producer loads its
// `initialUrl` through the first): an owned page whose pixels the live-pane rows judge by colour count, contrast and the
// fixture's OWN KNOWN HUE, never a hash, and whose memory tells whether a window reload re-attached the SAME page.
//   /page — a ground of FIXTURE_HUE, a white headline block, three bars and a yellow runner. Its PACE is the smoke's: while the
//           fixture plays (`setPlaying(true)`) the runner crosses the ground every 33 ms — ~30 paints a second (the PLAYING
//           row); still, the page paints nothing once laid out (the IDLE row). It asks the server every 250 ms
//           (`/beacon?token=…`, answered `{ "play": … }`), so a change of pace lands within a quarter second, and the token it
//           beacons is one its memory made at load: the same token after a window reload is the same page (the RELOAD row —
//           the reuseKey proof); a new token is a new page.
// PT-3 — and a page IN USE: a LINK to `/next` (the HELD-CLICK row), a text FIELD (KEYS, IME), a line of WORDS (DOUBLE), and
// a page taller than its view (WHEEL) — each where the ground stays the page's (the PT-2 rows' shares hold). With each ask
// it REPORTS what it saw — its address, its scroll, its selection, its field and what has the focus — and the smoke reads
// the latest (`report()`). `/next` is the same page by another address (its headline narrower), where the link goes.
// PT-4 — and a page that says HOW IT IS SEEN: with each ask, its user agent and its client hints, its fingers, its view's
// density, its colour scheme, the type of the last pointer event it got and its touches; its TITLE is its own
// (`FIXTURE_TITLE`), its FAVICON one flat colour (`/icon.png`, `FIXTURE_ICON_HUE` — `/page`'s alone: `/next` names none, and
// the server has no `/favicon.ico`); `/page?store=<v>` keeps `<v>` in a cookie and in its storage, and every page says the
// cookie and the stored value it reads — each page's latest word kept by its address too (`reportAt`), and the Cookie header
// each load came with (`cookieSeen`). It names its VIEWPORT (`width=device-width, initial-scale=1`) as a page made for
// phones does: a phone's page with none is laid out 980 px wide (the PT-4 smoke's first PHONE row said so) — and `/legacy`
// is that page, by its own address: the same page naming NO viewport, which a phone lays out 980 wide and a desktop at
// its window's width (the witness of a phone's LAYOUT, beside its agent's word). PT-5b — `/legacy` alone carries a MARKER
// down its right edge (`FIXTURE_EDGE` — a hue of its own, the last 4% of the page's width): a page shown WHOLE has it at
// its pane's right edge; one shown at another scale has it elsewhere, or nowhere.
// PT-5a — and a page's HONEST LIFE:
//   /acts     — a page of what a page MAY ASK FOR, each a control the smoke presses where the page says it stands: a
//               `target=_blank` link and a `window.open` (POPUP), a button that calls `alert`, `confirm` and `prompt`
//               (ALERT), an `<input type=file>` that counts its `cancel` and `change` (PICKER), a button that plays a
//               TONE (HEARD — 30 Hz, a whisper: what the engine counts as audible and no speaker says), a link to a
//               DOWNLOAD (`/file.bin`), a link to `/slow` (BAR's Stop), and a text field (CARET). It says what came of
//               each with every ask (`acts`), names the favicon, and has a runner of its own that follows the smoke's pace
//               (PARKED: an animating page);
//   /slow     — the page, answered `FIXTURE_SLOW_MS` late; a load stopped before then is counted as given up;
//   /file.bin — bytes served as an attachment: a download;
//   refusing() — ANOTHER address on a port nobody listens on (a connection REFUSED), which `open()` then serves the page
//               at (`/revived`): the FAIL row's address, and what Try again finds.
// PT-5b — and a page the smoke HOLDS AT ITS DOOR:
//   /gate     — the page (its own address by its query: `/gate?p=a`), answered at once while the gate is open and held
//               while it is shut (`gate(false)`) until it opens — never longer than `FIXTURE_GATE_MS`: the STILL row's
//               page, whose reload after a rest waits there while its pane shows its still.
// PT-5b2 — and pages whose FIRST LOAD does not end as a plain load (what the grade found: no fixture page had ever
// navigated before its first load finished):
//   /loading     — the page, with an image that never arrives (`/hang.png`): its document commits and paints, its `load`
//                  never fires — a link clicked on it is a navigation BEFORE the first load finished (FIRST-CLICK);
//   /redirecting — the fixture's ground, the same hanging image, and a script that sends the page on to
//                  `/next?from=redirect` `FIXTURE_REDIRECT_MS` later (FIRST-REDIRECT: a login's, a locale's redirect);
//   /nothing     — an empty answer (204): a load that ends with no document (as `/file.bin`, an attachment, does);
//   /busy        — the page for a phone that keeps its thread BUSY `FIXTURE_BUSY_MS` at each `touchstart`, and logs every
//                  touchstart and touchend it hears (`touchLog`, said with each ask): two quick taps must read
//                  start, end, start, end (TAPS — the hand's events in the order they were sent).
// PT-5b3 — and what the second grade's rows need:
//   /cold        — the page for a phone that logs its touches (and WHEN: `touchAt`) and keeps its thread free at them;
//                  it is busy only on the smoke's word. `hold(path, ms)`: the next ask of a page at `path` is answered
//                  `hold: ms` — the page says it began (`/held`, a beacon), keeps its thread `ms`, and says when the
//                  hold began and ended (`held`): a page just loaded and hydrating, its scale never read (TAPS-COLD).
//   ?tidy=1      — on any page, on the smoke's word (`tidy(path)`: the next ask of a page at `path` is answered
//                  `tidy`): its script takes `tidy` out of its own address with `history.replaceState` — a move WITHIN
//                  the document — and paints nothing (TIDY).
// PT-5c2 — a page whose load fails AFTER its document committed:
//   /cut         — the page, its keys and its touches logged (`keyLog`, `touchLog`), whose BODY NEVER ENDS: answered at
//                  once and held open until the smoke CUTS it (`cut(path)`: its socket destroyed mid-body — the engine's
//                  load fails late, ERR_INCOMPLETE_CHUNKED_ENCODING, the document standing — its parser stopped, so neither
//                  its DOMContentLoaded nor its `load` ever fires, and its page says no word of its scale after: PT-5c2's
//                  probes `f1.cjs`, `cut.cjs`) (LATE-FAIL).
// PT-5d — PAGES OF THREE SITES, a frame of one in a page of another (the hand reaches every frame — another site's frame
// is another process, reached on its own session):
//   /frames/host  — at `hostOrigin` (`localhost`): the fixture's ground and, drawn at `FRAMES_BOX`, a frame of the fixture's
//                   own origin (`127.0.0.1`, another site): `/frames/frame`; a page three views tall (FRAME-HALF); what IT
//                   heard of the hand on the frame's element (`framed.heard` — a press the frame's own session took is
//                   never heard here: PT-5d's probe had the host hear every press over the frame, on its element);
//   /frames/frame — the frame: a button (its click and its point: FRAME-PRESS), a link (FRAME-HOVER), a field (FRAME-TYPE),
//                   a word (FRAME-DOUBLE), a range and the buttons its last move held (FRAME-DRAG), a scroller (FRAME-WHEEL),
//                   its touches (FRAME-TOUCH), a frame of a THIRD site (`[::1]`, `innerOrigin`): `/frames/inner`
//                   (FRAME-NESTED), and a frame of its OWN site: `/frames/same` (M6.1 — a document of its process, so on its
//                   session, drawn at another size); on the smoke's word (`goFrame`) it goes to `/frames/next` (FRAME-GONE);
//   /frames/same  — the frame's own child of its site: a button (its clicks and point — FRAME-PRESS presses it too);
//   /frames/covered — at `hostOrigin` (M7 H3): the frame under a FIXED header drawn over its top (FRAME-COVERED), and a
//                   menu button that opens a dropdown over the frame, its item (FRAME-MENU); it hears the hand on its
//                   header, its menu's button and item, and the frame's element; `&slot=1` (M12 J5): the frame held in
//                   an about:blank SLOT the page writes (a frame of its own process), the header over the slot;
//   /frames/clipped — at `hostOrigin`: a header across the top and, under it, a SCROLLER holding the frame
//                   (`/frames/frame`), scrolled so the frame's top half sits above the scroller's clip edge — under the
//                   header (FRAME-CLIPPED, M6.3a: a press there is the host's); it hears the hand on its header and the
//                   frame's element alone;
//   /frames/inner — the nested frame: a button (its clicks and point) and a file input counting its `cancel` and `change`
//                   (FRAME-PICKER — M2: the picker intercepted in a frame inside a frame);
//   /frames/next  — where the frame goes: a button, its clicks;
//   /frames/loop  — a page whose button starts an ENDLESS LOOP (STUCK).
// PT-6a (K1) — and the busy page and the engine's fact:
//   /frames/busy  — at `hostOrigin`: a page holding an AD-LIKE frame of another site and a field of its own, busy
//                   `FRAMES_BUSY_MS` in a task its field's press or tap POSTS (FRAME-BUSY: keys typed meanwhile land in
//                   order) — `&on=key`: its field's first KEY posts it instead (K1's hold, reached);
//   /frames/spin  — a FRAMELESS page whose button holds its thread `FRAMES_SPIN_MS` in its own mousedown (PRESS-ANSWER:
//                   is a press answered before its handler, or after?).
// PT-6a (M4, M5 — F1) — and a page whose editor cannot speak:
//   /frames/opened — at `hostOrigin`: a page holding an AD-LIKE frame of another site and a same-site EDITOR frame its
//                    script writes by `open()`/`write()`/`close()` after its load (FRAME-OPENED: the text typed into the
//                    editor's field lands, and the page is never said stopped).
// Each says what it saw with every ask (`framed`), its parts where they stand in its own view.
// PT-5c2 — a page whose FIRST PAINT the fixture holds:
//   /topaint     — the page, its link going to `/unpainted` (its name with it: `?p=<name>`);
//   /unpainted   — the page with a stylesheet in its head (`/held.css?p=<name>`) answered only on the smoke's word
//                  (`paint(name)`): it commits and does not paint; what reaches its document before then, the script at
//                  the head of it hears (`heard`, said with each ask once the page runs its own) (HELD-PAINT).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type AddressInfo, createServer as createTcpServer } from "node:net";
import { crc32, deflateSync } from "node:zlib";

/** The fixture's ground: a saturated blue, far from the mat's green and the sample page's warm whites. */
export const FIXTURE_HUE = { r: 29, g: 111, b: 216 } as const;

/** How often the page asks the server (ms) — its pace follows the answer. */
export const FIXTURE_ASK_MS = 250;
/** PT-5b2 — how long `/redirecting`'s script waits before it sends its page on (ms); how long `/busy` keeps its thread at
 * each touchstart (ms — longer than a tap and than the bound a press waits for its page's scale). */
export const FIXTURE_REDIRECT_MS = 250;
export const FIXTURE_BUSY_MS = 350;
/** PT-5b3 — how long `/cold` is held busy on the smoke's word (ms): long enough for two taps sent once it says so. */
export const FIXTURE_HOLD_MS = 1_500;

/** PT-4 — the page's title (`/next`'s says where it is). */
export const FIXTURE_TITLE = "Portals fixture";
/** PT-4 — the favicon's one flat colour: a magenta far from the ground's blue, the runner's yellow and the mat's green. */
export const FIXTURE_ICON_HUE = { r: 226, g: 30, b: 160 } as const;
/** PT-5b — `/legacy`'s right-edge marker: its one flat colour (an orange-red far from the ground's blue, the runner's
 * yellow, the icon's magenta and the mat's green) and its width as a share of the page's. */
export const FIXTURE_EDGE = { hue: { r: 255, g: 72, b: 24 }, share: 0.04 } as const;
/** PT-4 — the cookie (and the storage key) `/page?store=<v>` keeps `<v>` under. */
export const FIXTURE_COOKIE = "pt4";
/** PT-5a — how late `/slow` answers (ms): long enough to read the bar's Stop and press it. */
export const FIXTURE_SLOW_MS = 8_000;
/** PT-5b — the longest `/gate` holds a load while its gate is shut (ms): a row that forgot to open it still ends. */
export const FIXTURE_GATE_MS = 45_000;
/** PT-5a — the tone `/acts` plays: its pitch (Hz) and its gain — over the engine's silence threshold (about −72 dBFS) and
 * under anything a speaker says (30 Hz at −51 dBFS: a shared machine hears nothing). */
export const FIXTURE_TONE = { hz: 30, gain: 0.004 } as const;
/** PT-5a — `/acts`'s controls by id, in the order they stand (the page says each one's box with every ask). */
export const FIXTURE_ACT_IDS = [
  "popup",
  "open",
  "alert",
  "file",
  "tone",
  "download",
  "slow",
  "field",
] as const;
export type FixtureActId = (typeof FIXTURE_ACT_IDS)[number];

/** PT-4 — the favicon's bytes: a 32 × 32 PNG of `FIXTURE_ICON_HUE`, opaque (made here: signature, IHDR, one IDAT, IEND). */
export function fixtureIcon(size = 32): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits a channel, RGBA, deflate, no filter method, no interlace
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x += 1)
    row.set([FIXTURE_ICON_HUE.r, FIXTURE_ICON_HUE.g, FIXTURE_ICON_HUE.b, 255], 1 + x * 4);
  const rows = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface LiveFixture {
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  /** PT-5d — `http://localhost:<port>`: the frames' host page's site (another than `origin`'s). */
  readonly hostOrigin: string;
  /** PT-5d — `http://[::1]:<port>`: the nested frame's site (a third), where the loopback speaks IPv6 — else `hostOrigin`
   * (the nested frame then of the host's site: the rows say so). */
  readonly innerOrigin: string;
  /** The page's address. */
  readonly url: string;
  /** The page's pace from its next ask on: the runner crossing it ~30 times a second, or still. */
  setPlaying(on: boolean): void;
  /** How many times the page was served — a reload of the page itself serves it again. */
  loads(): number;
  /** The tokens the page's memory beaconed, in order of first arrival (one page, one token). */
  tokens(): readonly string[];
  /** PT-3 — what the page last said it saw (its latest ask), or null before any. */
  report(): FixtureReport | null;
  /** PT-3 — how many times each address was served (`/page`, `/next`). */
  served(path: "/page" | "/next"): number;
  /** PT-4 — the latest word of the page AT `path` (its path and query, as it says them), or null: two pages, two words. */
  reportAt(path: string): FixtureReport | null;
  /** PT-4 — the Cookie header the last load of `path` (its path and query) came with ("" for none), or null: never loaded. */
  cookieSeen(path: string): string | null;
  /** PT-5b3 — the User-Agent header the last load of `path` (its path and query) came with, or null: never loaded. */
  agentSeen(path: string): string | null;
  /** PT-4 — how many times the favicon was served. */
  icons(): number;
  /** PT-5a — `/slow`'s asks: how many came, how many were answered, how many were given up before the answer. */
  slow(): { readonly asked: number; readonly answered: number; readonly aborted: number };
  /** PT-5a — how many times the download (`/file.bin`) was asked for. */
  files(): number;
  /** PT-5b — `/gate`'s door: shut (`false`: its loads wait) or open (`true`: every load waiting is answered, and each
   * new one at once). Open at the start. */
  gate(open: boolean): void;
  /** PT-5b — `/gate`'s loads: how many were asked, how many answered, how many wait at the shut gate now. */
  gated(): { readonly asked: number; readonly answered: number; readonly waiting: number };
  /** PT-5b2 — how many times a path was asked for (its pathname: `/loading`, `/redirecting`, `/nothing`, `/busy`,
   * `/hang.png`, `/file.bin` — any). */
  asked(path: string): number;
  /** PT-5b3 — the next ask of a page whose path begins with `path` is answered `hold: ms`: the page keeps its thread
   * that long (and says so: `/held` is asked for as the hold begins; its `held` says when it began and ended). Once. */
  hold(path: string, ms: number): void;
  /** PT-5b3 — the next ask of a page whose path begins with `path` is answered `tidy`: the page takes `tidy` out of its
   * own address (`history.replaceState`), within its document. Once. */
  tidy(path: string): void;
  /** PT-5c2 — every page at a path that begins with `path` whose body `/cut` holds open is CUT (its socket destroyed
   * mid-body); how many were. */
  cut(path: string): number;
  /** PT-5c2 — how many of `/unpainted?p=<name>`'s stylesheets the fixture holds now (its first paint held). */
  unpainted(name: string): number;
  /** PT-5c2 — `name`'s held stylesheets answered, and every later one at once: its page may paint. */
  paint(name: string): void;
  /** PT-5d — the next ask of the page at `path` (its path and query) is answered `go: to`: the page goes there. Once. */
  goFrame(path: string, to: string): void;
  /** PT-5d — how many times the page at `path` (its path and query) has asked: a page that hangs asks no more. */
  reports(path: string): number;
  /** PT-5d (M7 H11) — how many times a frames page at `path` (its path and query) was served: a reload asked of a page that
   * hangs is served again though its document never comes. */
  framesServed(path: string): number;
  /** PT-5a — an address whose connection is REFUSED (a port nobody listens on) until `open()` serves the page there. */
  refusing(): Promise<FixtureRefusing>;
  close(): Promise<void>;
}

/** PT-5a — an address that refuses its connection until it is opened. */
export interface FixtureRefusing {
  /** `http://127.0.0.1:<port>/revived` */
  readonly url: string;
  /** `127.0.0.1:<port>` — the address as a head prints it. */
  readonly host: string;
  /** The page served there from now on (its word kept by its path, `/revived`, as every page's is). */
  open(): Promise<void>;
}

/** PT-5a — what came of each thing `/acts` asked for. */
export interface FixtureActs {
  /** `alert` calls that RETURNED (a page blocked behind a dialog never counts one). */
  readonly alerts: number;
  /** What `confirm` answered (null before it was asked), and `prompt` ("unasked" before; null: cancelled; "threw"). */
  readonly confirmed: boolean | null;
  readonly prompted: string | null;
  /** The file input's `cancel` and `change` events. */
  readonly cancels: number;
  readonly changes: number;
  /** The tone's audio context ("" before it was pressed, then "running" / "suspended"). */
  readonly tone: string;
  /** What `window.open` answered ("unasked" before; "null": no window). */
  readonly opened: string;
  /** Where each control stands in the page's view now (CSS px). */
  readonly parts: Readonly<Record<FixtureActId, FixtureRect>>;
}

/** PT-3 — what the page saw at its last ask. */
export interface FixtureReport {
  /** Its path and query (`/page`, `/next?typed=1`). */
  readonly path: string;
  readonly token: string;
  readonly scrollY: number;
  /** The words selected, as `getSelection()` says them. */
  readonly sel: string;
  /** The field's value, and the id of what has the focus ("" for nothing). */
  readonly field: string;
  readonly focused: string;
  /** How many times the field's form was submitted (⏎ in the field — the page keeps it, never goes). */
  readonly submitted: number;
  /** Its view, CSS px (`innerWidth`, `innerHeight`). */
  readonly view: readonly [number, number];
  /** Where its parts stand in its view now (CSS px, the view's own — what a press there lands on): the link, the field, the word. */
  readonly parts: {
    readonly link: FixtureRect;
    readonly field: FixtureRect;
    readonly word: FixtureRect;
  };
  /** PT-4 — how it is seen: `navigator.userAgent` and `.platform`; its client hints (`navigator.userAgentData` — null where
   * the engine gives none); `navigator.maxTouchPoints`; `devicePixelRatio`; whether `prefers-color-scheme: dark` matches. */
  readonly ua: string;
  readonly platform: string;
  readonly uaData: {
    readonly platform: string;
    readonly mobile: boolean;
    readonly brands: readonly string[];
  } | null;
  readonly touchPoints: number;
  readonly dpr: number;
  readonly dark: boolean;
  /** PT-4 — the `pointerType` of the last pointer event it got ("" before any), and its `touchstart`s counted. */
  readonly pointer: string;
  readonly touches: number;
  /** PT-4 — `document.cookie`, what its storage keeps under `FIXTURE_COOKIE` ("" for nothing), and `document.title`. */
  readonly cookie: string;
  readonly stored: string;
  readonly title: string;
  /** PT-5a — `/acts` alone: what came of what it asked for. */
  readonly acts?: FixtureActs;
  /** PT-5b2 — `/busy` (and PT-5b3's `/cold`) alone: every touchstart ("start") and touchend ("end") it heard, in order. */
  readonly touchLog?: readonly string[];
  /** PT-5b3 — when each of those was heard, and when the page's hold began and ended (its own clock, ms; null: never held). */
  readonly touchAt?: readonly number[];
  readonly held?: readonly [number, number] | null;
  /** PT-5c — its visual viewport: the scale it is drawn at, and its offset in its layout (CSS px); PT-5d (M22 D1) — a frames
   * page's, and the width and height it shows (CSS px: a phone's page that overflows its layout shows less than its
   * `innerWidth`) */
  readonly vv?: readonly [number, number, number, number?, number?];
  /** PT-5c2 — `/cut` alone: every keydown ("down <code>") and keyup ("up <code>") it heard, in order. */
  readonly keyLog?: readonly string[];
  /** PT-5c2 — `/unpainted` alone: what its head's script heard of the hand from the document's start (null: no such
   * script — any other page). */
  readonly heard?: readonly string[] | null;
  /** PT-5d — a page of the frames' rows alone: what it saw of the hand. */
  readonly framed?: FixtureFramed;
  /** PT-6a (K1) — `/frames/busy` and `/frames/spin` alone: what kept their thread, and when (their own clock, ms). */
  readonly busy?: FixtureBusy;
  /** PT-6a (F1) — `/frames/opened` alone: how often it wrote its editor frame, and what the editor's field holds (null:
   * unread) */
  readonly opened?: { readonly opens: number; readonly value: string | null };
}

/** PT-6a (K1) — what kept a page's thread: each spin a press or a tap posted ([began, ms, "press" | "tap"]), when its own
 * timer beside it fired, when its field heard each click (`/frames/busy`); each spin in its button's own mousedown
 * ([began, ms] — `/frames/spin`). */
export interface FixtureBusy {
  readonly spins?: readonly (readonly [number, number, string])[];
  readonly timers?: readonly number[];
  readonly clicks?: readonly number[];
  readonly downs?: readonly (readonly [number, number])[];
  /** PT-6a (K1): when the field heard the key that made it busy (`&on=key`) */
  readonly keys?: readonly number[];
}

/** PT-5d — what a page of the frames' rows saw of the hand (its own CSS px, its own view). */
export interface FixtureFramed {
  /** its buttons' clicks (`#b`, `#bl`, `#ib`, `#b2`), each at its point */
  readonly clicks: readonly (readonly [number, number])[];
  /** what its document heard, in order (`pointerdown #b`, `keydown h`, `touchstart #b`…) — the host's: on the frame's
   * element alone */
  readonly heard: readonly string[];
  /** the buttons its last pointermove held (null: none came) */
  readonly moveButtons: number | null;
  /** PT-5d (M15 F3): how many pointermoves it heard with its primary button held (a drag's) */
  readonly movesHeld: number;
  /** PT-5d (M15 F1, M18 A): its clicks on its own ground (not the frame's element, not a control), each at its point to the
   * tenth of a CSS px */
  readonly grounds: readonly (readonly [number, number])[];
  /** its file input's `cancel` and `change` (the nested frame's) */
  readonly cancels: number;
  readonly changes: number;
  /** its range's value, its field's caret, its scroller's scroll (null: it has none) */
  readonly range: number | null;
  readonly caret: number | null;
  readonly scroller: number | null;
  /** where its parts stand in its view (the host's: `frame`, the frame's content box) */
  readonly parts: Readonly<Record<string, FixtureRect>>;
  /** PT-5d (M6.5b): what it is told of its device — its own agent, touch points, whether its colours are dark (null:
   * unread) */
  readonly device: { readonly ua: string; readonly touch: number; readonly dark: boolean } | null;
}

/** A part's box in the page's view, CSS px. */
export interface FixtureRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** PT-3 — where the page's parts stand, in its CSS px for a laptop's 1280 × 800 view: what the smoke presses, the page lays out. */
export const FIXTURE_PARTS = {
  /** the link to `/next`: its box */
  link: { x: 102, y: 424, w: 179, h: 48 },
  /** the text field */
  field: { x: 384, y: 424, w: 307, h: 48 },
  /** the word a double-click selects (its box the page reports), and the line it stands on */
  word: "portals",
  wordAt: { x: 102, y: 700 },
} as const;

const hex = (c: { r: number; g: number; b: number }): string =>
  `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** The page's HTML: its ground, headline, bars and runner; its memory; its pace, asked of the server — and (PT-3) its link,
 * field and words, its height past its view, and what it saw, reported with each ask. `/next` narrows its headline. */
export function fixtureHtml(path: "/page" | "/next" | "/legacy" = "/page"): string {
  const head = path === "/next" ? 30 : 56;
  const px = (v: number, of: number): string => `${((v / of) * 100).toFixed(4)}%`;
  const { link, field, wordAt } = FIXTURE_PARTS;
  const title = path === "/page" ? FIXTURE_TITLE : `${FIXTURE_TITLE} — ${path.slice(1)}`;
  const icon = path === "/next" ? "" : '<link rel="icon" type="image/png" href="/icon.png">';
  const viewport =
    path === "/legacy"
      ? ""
      : '<meta name="viewport" content="width=device-width, initial-scale=1">';
  return `<!doctype html>
<html><head><meta charset="utf-8">${viewport}<title>${title}</title>${icon}
<style>
  html, body { margin: 0; background: ${hex(FIXTURE_HUE)}; }
  html { scrollbar-width: none; }
  .head { position: absolute; left: 8%; top: 10vh; width: ${head}%; height: 14vh; background: #ffffff; border-radius: 8px; }
  .bar { position: absolute; left: 8%; height: 4vh; background: rgba(255,255,255,0.72); border-radius: 4px; }
  #runner { position: absolute; left: 0; top: 62vh; width: 12%; height: 18vh; background: #ffd34d; border-radius: 6px; }
  #next { position: absolute; left: ${px(link.x, 1280)}; top: ${px(link.y, 800).replace("%", "vh")}; width: ${px(link.w, 1280)};
    height: ${px(link.h, 800).replace("%", "vh")}; line-height: ${px(link.h, 800).replace("%", "vh")}; color: #ffffff;
    font: 600 22px sans-serif; text-align: center; text-decoration: underline; }
  #field { position: absolute; left: ${px(field.x, 1280)}; top: ${px(field.y, 800).replace("%", "vh")}; width: ${px(field.w, 1280)};
    height: ${px(field.h, 800).replace("%", "vh")}; box-sizing: border-box; border: 0; border-radius: 6px; padding: 0 10px;
    font: 22px sans-serif; background: #e9f0fb; color: #10213f; }
  #words { position: absolute; left: 8%; top: ${px(wordAt.y - 16, 800).replace("%", "vh")}; margin: 0; color: #ffffff;
    font: 600 28px/32px sans-serif; white-space: nowrap; }
  #tall { height: 400vh; }
  #edge { position: absolute; right: 0; top: 0; width: ${FIXTURE_EDGE.share * 100}%; height: 400vh; background: ${hex(FIXTURE_EDGE.hue)}; }
</style></head>
<body>${path === "/legacy" ? '\n<div id="edge"></div>' : ""}
<div class="head"></div>
<div class="bar" style="top:32vh;width:64%"></div>
<div class="bar" style="top:40vh;width:58%"></div>
<div class="bar" style="top:48vh;width:40%"></div>
<div id="runner"></div>
<a id="next" href="/next">next page</a>
<form id="form" action="/next"><input id="field" type="text" autocomplete="off" spellcheck="false"></form>
<p id="words">alpha <span id="word">portals</span> omega</p>
<div id="tall"></div>
<script>
  const token = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  const runner = document.getElementById("runner");
  const field = document.getElementById("field");
  let x = 0, timer = null, submitted = 0, pointer = "", touches = 0;
  document.getElementById("form").addEventListener("submit", (e) => { e.preventDefault(); submitted += 1; });
  for (const type of ["pointerdown", "pointermove", "pointerup"])
    addEventListener(type, (e) => { pointer = e.pointerType; }, true);
  addEventListener("touchstart", () => { touches += 1; }, { capture: true, passive: true });
  const store = new URLSearchParams(location.search).get("store");
  if (store) {
    document.cookie = "${FIXTURE_COOKIE}=" + encodeURIComponent(store) + "; path=/; max-age=3600";
    try { localStorage.setItem("${FIXTURE_COOKIE}", store); } catch {}
  }
  const stored = () => { try { return localStorage.getItem("${FIXTURE_COOKIE}") || ""; } catch { return ""; } };
  const hints = () => navigator.userAgentData
    ? { platform: navigator.userAgentData.platform, mobile: navigator.userAgentData.mobile,
        brands: navigator.userAgentData.brands.map((b) => b.brand) }
    : null;
  const pace = (play) => {
    if (play && timer === null) timer = setInterval(() => { x = (x + 1.3) % 88; runner.style.left = x + "%"; }, 33);
    if (!play && timer !== null) { clearInterval(timer); timer = null; }
  };
  const box = (id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const report = () => encodeURIComponent(JSON.stringify({
    path: location.pathname + location.search,
    scrollY: Math.round(window.scrollY),
    sel: String(window.getSelection() || ""),
    field: field.value,
    focused: (document.activeElement && document.activeElement.id) || "",
    submitted,
    view: [innerWidth, innerHeight],
    parts: { link: box("next"), field: box("field"), word: box("word") },
    ua: navigator.userAgent,
    platform: navigator.platform,
    uaData: hints(),
    touchPoints: navigator.maxTouchPoints,
    dpr: devicePixelRatio,
    dark: matchMedia("(prefers-color-scheme: dark)").matches,
    pointer,
    touches,
    cookie: document.cookie,
    stored: stored(),
    title: document.title,
    touchLog: window.__touchLog || [],
    touchAt: window.__touchAt || [],
    keyLog: window.__keyLog || [],
    heard: window.__heard || null,
    held: window.__held || null,
    vv: window.visualViewport
      ? [visualViewport.scale, Math.round(visualViewport.offsetLeft), Math.round(visualViewport.offsetTop)]
      : [1, 0, 0],
  }));
  // PT-5b3 — HELD on the server's word: the page says it began (a beacon: it leaves though the thread is kept), keeps its
  // thread for as long as it was told, and says when the hold began and ended
  const hold = (ms) => {
    if (!(ms > 0)) return;
    navigator.sendBeacon("/held");
    const began = performance.now();
    while (performance.now() < began + ms) {}
    window.__held = [Math.round(began), Math.round(performance.now())];
  };
  // PT-5b3 — TIDIED on the server's word: the page takes "tidy" out of its own address — a move within the document —
  // and paints nothing
  const tidy = (go) => {
    const asked = new URLSearchParams(location.search);
    if (go !== true || !asked.has("tidy")) return;
    asked.delete("tidy");
    const rest = asked.toString();
    history.replaceState(null, "", location.pathname + (rest ? "?" + rest : ""));
  };
  const ask = () => fetch("/beacon?token=" + token + "&report=" + report(), { cache: "no-store" })
    .then((r) => r.json()).then((a) => { pace(a.play === true); tidy(a.tidy); hold(a.hold); }).catch(() => {});
  ask();
  setInterval(ask, ${FIXTURE_ASK_MS});
</script>
</body></html>`;
}

/** PT-5b2 — the image that never arrives: a page that carries it never finishes its first load. */
const HANGING =
  '<img src="/hang.png" alt="" style="position:absolute;left:0;top:0;width:1px;height:1px">';

/** PT-5b2 — `/loading`: the page, its `load` never firing. */
export const loadingHtml = (): string =>
  fixtureHtml("/page").replace("</body></html>", `${HANGING}\n</body></html>`);

/** PT-5b2 — `/redirecting`: the ground, the image that never arrives, and a script that sends the page on. */
export function redirectingHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${FIXTURE_TITLE} — redirecting</title>
<style>html, body { margin: 0; background: ${hex(FIXTURE_HUE)}; }</style></head>
<body>${HANGING}
<script>
  setTimeout(() => { location.href = "/next?from=redirect"; }, ${FIXTURE_REDIRECT_MS});
</script>
</body></html>`;
}

/** The script that logs a page's touches — each one's kind and when — keeping its thread `busyMs` at each touchstart. */
const touchLogScript = (busyMs: number): string => `<script>
  window.__touchLog = [];
  window.__touchAt = [];
  addEventListener("touchstart", () => {
    window.__touchLog.push("start");
    window.__touchAt.push(Math.round(performance.now()));${
      busyMs > 0
        ? `
    const until = performance.now() + ${busyMs};
    while (performance.now() < until) {}`
        : ""
    }
  }, { capture: true, passive: true });
  addEventListener("touchend", () => {
    window.__touchLog.push("end");
    window.__touchAt.push(Math.round(performance.now()));
  }, { capture: true, passive: true });
  // PT-5c: a finger's move ("move") and a gesture ended for it ("cancel") are heard too
  addEventListener("touchmove", () => {
    window.__touchLog.push("move");
    window.__touchAt.push(Math.round(performance.now()));
  }, { capture: true, passive: true });
  addEventListener("touchcancel", () => {
    window.__touchLog.push("cancel");
    window.__touchAt.push(Math.round(performance.now()));
  }, { capture: true, passive: true });
</script>
</body></html>`;

/** PT-5c2 — the script that logs the keys a page hears (`keyLog`, said with each ask): "down <code>", "up <code>". */
const KEY_LOG = `<script>
  window.__keyLog = [];
  addEventListener("keydown", (e) => { window.__keyLog.push("down " + e.code); }, true);
  addEventListener("keyup", (e) => { window.__keyLog.push("up " + e.code); }, true);
</script>`;

/** PT-5c2 — `/cut`: the page, logging its keys and its touches (its thread free). Its BODY is the fixture's to end — it
 * never does: the smoke cuts it (`cut`). */
export const cutHtml = (): string =>
  fixtureHtml("/page").replace("</body></html>", `${KEY_LOG}\n${touchLogScript(0)}`);

/** A page's name, as the fixture keeps it in an address: letters, digits and dashes only. */
const cleanName = (name: string): string => name.replace(/[^a-z0-9-]/giu, "");

/** PT-5c2 — the head's script that hears the hand from the document's start — before any stylesheet, so what reaches the
 * document before its first paint is heard: every pointerdown, mousedown, mouseup, click, keydown and touchstart. */
const HEARS =
  '<script>window.__heard = []; for (const type of ["pointerdown", "mousedown", "mouseup", "click", "keydown", "touchstart"]) addEventListener(type, (e) => window.__heard.push(e.type), { capture: true });</script>';

/** PT-5c2 — `/unpainted?p=<name>`: the page whose FIRST PAINT the fixture holds — its head's stylesheet
 * (`/held.css?p=<name>`) answered only on the smoke's word (`paint`); its head's script, before it, hears the hand. */
export const unpaintedHtml = (name: string): string =>
  fixtureHtml("/page").replace(
    "<title>",
    `${HEARS}<link rel="stylesheet" href="/held.css?p=${cleanName(name)}"><title>`,
  );

/** PT-5c2 — `/topaint?p=<name>`: the page whose LINK goes to `/unpainted?p=<name>`. */
export const toUnpaintedHtml = (name: string): string =>
  fixtureHtml("/page").replace(
    '<a id="next" href="/next">',
    `<a id="next" href="/unpainted?p=${cleanName(name)}">`,
  );

/** PT-5b2 — `/busy`: the page, keeping its thread busy at each touchstart and logging every touch it hears. */
export const busyHtml = (): string =>
  fixtureHtml("/page").replace("</body></html>", touchLogScript(FIXTURE_BUSY_MS));

/** PT-5b3 — `/cold`: the page, logging every touch it hears and when — its thread kept only on the smoke's word (`hold`). */
export const coldHtml = (): string =>
  fixtureHtml("/page").replace("</body></html>", touchLogScript(0));

/** PT-5c (ruling 1) — the scale `/zoom` zooms itself to at a double tap. */
export const ZOOM_SCALE = 2;

/**
 * PT-5c (ruling 1) — `/zoom`: a phone's page that ZOOMS ITSELF at a double tap (two touches ended within 400 ms): it
 * rewrites its viewport (a minimum scale of 2 — the engine draws it at 2, its visual viewport says so with a `resize`:
 * PT-5c's probe `zoom.cjs`); its field stands near its top-left, where the zoomed page still shows it.
 */
export const zoomHtml = (): string =>
  fixtureHtml("/page")
    .replace("</style>", "  #field { left: 5% !important; top: 4vh !important; }\n</style>")
    .replace(
      "</body></html>",
      `<script>
  let lastEnd = -1000;
  addEventListener("touchend", () => {
    const now = performance.now();
    if (now - lastEnd < 400)
      document.querySelector('meta[name="viewport"]').setAttribute("content", "width=device-width, initial-scale=${ZOOM_SCALE}, minimum-scale=${ZOOM_SCALE}");
    lastEnd = now;
  }, { capture: true, passive: true });
</script>
</body></html>`,
    );

/**
 * PT-5c (ruling 1) — `/pending?p=<name>`: the page whose LINK goes to the fixture's gate (`/gate?p=pending-<name>`), its
 * field beside it the page's own — a tap or a click on the link while the gate is shut leaves a navigation PENDING, the
 * page standing; what reaches the field then (its focus, its words, its touches) the page says with its report, and the
 * page the gate lets through says its own. `name`: letters, digits and dashes only.
 */
export const pendingHtml = (name: string): string =>
  fixtureHtml("/page").replace(
    '<a id="next" href="/next">',
    `<a id="next" href="/gate?p=pending-${name.replace(/[^a-z0-9-]/giu, "")}">`,
  );

/** PT-5d — where the host page draws its frame, CSS px (a laptop's 1280 × 800 view): what the frames' rows press through. */
export const FRAMES_BOX = { x: 160, y: 120, w: 640, h: 420 } as const;
/** PT-5d (M18 B) — the host page's OWN range, right of its frame: a drag on the page's own session (the defect every page
 * had: a move carried `button: "none"`). */
export const FRAMES_HOST_RANGE = { x: 880, y: 300, w: 260, h: 24 } as const;

/** PT-5d — the word the frame's double-click selects. */
export const FRAMES_WORD = "alpha";

/** PT-5d — a frames page's own script: what it hears of the hand, said with every ask; `go` sends it elsewhere. */
const framesScript = (ids: readonly string[], elementOnly?: readonly string[]): string => `<script>
  const token = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  const heard = [], clicks = [];
  let moveButtons = null, cancels = 0, changes = 0, movesHeld = 0;
  const grounds = [];
  const el = (id) => document.getElementById(id);
  const named = (t) => (t && t.id ? "#" + t.id : t && t.tagName ? t.tagName.toLowerCase() : "?");
  const only = ${JSON.stringify(elementOnly ?? null)};
  const hear = (e, what) => { if ((only === null || (e.target && only.includes(e.target.id))) && heard.length < 300) heard.push(what); };
  for (const type of ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "touchstart", "touchend", "touchcancel"])
    addEventListener(type, (e) => {
      hear(e, e.type + " " + named(e.target));
      if (e.type === "click" && e.target && ["b", "bl", "bm", "ib", "b2", "sb"].includes(e.target.id))
        clicks.push([Math.round(e.clientX), Math.round(e.clientY)]);
      // (M15 F1, M18 A: a click on its own ground — never the frame's element, never a control; a scroller's is ground
      // too — to the tenth: the window↔page mapping's own error, measured)
      else if (e.type === "click" && e.target && e.target.id !== "f" && !["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "IFRAME"].includes(e.target.tagName) && grounds.length < 50)
        grounds.push([Math.round(e.clientX * 10) / 10, Math.round(e.clientY * 10) / 10]);
    }, { capture: true, passive: true });
  addEventListener("keydown", (e) => hear(e, "keydown " + e.key), true);
  // (M7 H15: the pointer leaving its link — FRAME-HOVER's real leave)
  addEventListener("mouseout", (e) => { if (e.target && e.target.id === "l") hear(e, "mouseout #l"); }, true);
  // (M15 F3: and how many it heard with its primary button held — a drag's moves)
  addEventListener("pointermove", (e) => { moveButtons = e.buttons; if (e.buttons & 1) movesHeld += 1; }, true);
  if (el("if")) {
    el("if").addEventListener("cancel", () => { cancels += 1; });
    el("if").addEventListener("change", () => { changes += 1; });
  }
  // (its own rect, as the engine's: a page that replaces its DOM's methods later — FRAME-COVERED's sly leg — hides nothing from this)
  const rectOf = (() => { try { return Element.prototype.getBoundingClientRect; } catch { return null; } })();
  const box = (id) => {
    const n = el(id);
    if (!n) return null;
    const r = rectOf ? rectOf.call(n) : n.getBoundingClientRect();
    return { x: Math.round(r.left + n.clientLeft), y: Math.round(r.top + n.clientTop), w: Math.round(n.clientWidth || r.width), h: Math.round(n.clientHeight || r.height) };
  };
  const report = () => encodeURIComponent(JSON.stringify({
    path: location.pathname + location.search,
    scrollY: Math.round(scrollY),
    sel: String(getSelection() || ""),
    field: el("t") ? el("t").value : "",
    focused: (document.activeElement && document.activeElement.id) || "",
    view: [innerWidth, innerHeight],
    vv: (() => { try { const v = visualViewport; return v ? [v.scale, v.offsetLeft, v.offsetTop, v.width, v.height] : undefined; } catch { return undefined; } })(),
    busy: globalThis.__vfBusy,
    opened: globalThis.__vfOpened ? { opens: globalThis.__vfOpened.opens, value: (() => { try { const n = el("ed").contentDocument.getElementById("e"); return n ? n.value : null; } catch { return null; } })() } : undefined,
    framed: {
      clicks, heard, moveButtons, movesHeld, grounds, cancels, changes,
      range: el("r") ? Number(el("r").value) : null,
      caret: el("t") ? el("t").selectionStart : null,
      scroller: el("s") ? Math.round(el("s").scrollTop) : null,
      parts: Object.fromEntries(${JSON.stringify(ids)}.map((id) => [id === "f" ? "frame" : id, box(id)]).filter(([, b]) => b !== null)),
      device: (() => { try { return { ua: navigator.userAgent, touch: navigator.maxTouchPoints, dark: matchMedia("(prefers-color-scheme: dark)").matches }; } catch { return null; } })(),
    },
  }));
  const ask = () => fetch("/beacon?token=" + token + "&report=" + report(), { cache: "no-store" })
    .then((r) => r.json()).then((a) => { if (typeof a.go === "string") location.href = a.go; }).catch(() => {});
  ask();
  setInterval(ask, ${FIXTURE_ASK_MS});
</script>`;

const FRAMES_STYLE = `<style>
  html, body { margin: 0; }
  html { scrollbar-width: none; }
  button, a, input, p { position: absolute; margin: 0; box-sizing: border-box; font: 600 18px sans-serif; }
</style>`;

/** PT-5d — `/frames/host?p=<name>` at `hostOrigin` (`&noviewport=1`, M7 H11: naming no viewport — a phone lays it out at
 * 980 px and draws it whole, at about 0.41): the ground and a frame of `frameOrigin` at `FRAMES_BOX`, three views tall;
 * it hears the hand on the frame's element alone. PT-6a (M14, R2) — `&shadow=1`: the frame held in the OPEN SHADOW ROOT of
 * a web component (`<x-embed id="f">` at `FRAMES_BOX`, the frame filling it): the document's focus and the engine's hit
 * test name the HOST, as an embed's custom element makes them. */
export const framesHostHtml = (
  name: string,
  frameOrigin: string,
  viewport = true,
  shadow = false,
): string => `<!doctype html>
<html><head><meta charset="utf-8">${viewport ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ""}<title>${FIXTURE_TITLE} — frames</title>
${FRAMES_STYLE}<style>body { background: ${hex(FIXTURE_HUE)}; height: 300vh; } iframe, x-embed { position: absolute; display: block; border: 0; }</style></head>
<body>${
  shadow
    ? `<x-embed id="f" style="left:${FRAMES_BOX.x}px;top:${FRAMES_BOX.y}px;width:${FRAMES_BOX.w}px;height:${FRAMES_BOX.h}px"></x-embed>
<script>{ const frame = document.createElement("iframe"); frame.src = ${JSON.stringify(`${frameOrigin}/frames/frame?p=${cleanName(name)}`)}; frame.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;border:0"; document.getElementById("f").attachShadow({ mode: "open" }).append(frame); }</script>`
    : `<iframe id="f" src="${frameOrigin}/frames/frame?p=${cleanName(name)}" style="left:${FRAMES_BOX.x}px;top:${FRAMES_BOX.y}px;width:${FRAMES_BOX.w}px;height:${FRAMES_BOX.h}px"></iframe>`
}
<input id="r" type="range" min="0" max="100" value="10" style="left:${FRAMES_HOST_RANGE.x}px;top:${FRAMES_HOST_RANGE.y}px;width:${FRAMES_HOST_RANGE.w}px;height:${FRAMES_HOST_RANGE.h}px">
${framesScript(["f", "r"], ["f"])}
</body></html>`;

/** PT-5d — `/frames/frame?p=<name>`: the frame — its button, link, field, word, range and scroller, and a frame of
 * `innerOrigin` in it. Its document never scrolls (a wheel past its scroller's end is the host page's). */
export const framesFrameHtml = (name: string, innerOrigin: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>frame</title>
${FRAMES_STYLE}<style>body { background: #e9f0fb; height: 100vh; overflow: hidden; } iframe { position: absolute; border: 0; }</style></head>
<body>
<button id="b" style="left:20px;top:20px;width:140px;height:44px">press</button>
<button id="bl" style="left:20px;top:330px;width:140px;height:44px">low</button>
<button id="bm" style="left:470px;top:140px;width:140px;height:40px">middle</button>
<a id="l" href="#l" style="left:20px;top:84px;font-size:20px">a link here</a>
<input id="t" type="text" autocomplete="off" spellcheck="false" style="left:20px;top:130px;width:260px;height:36px">
<p id="w" style="left:20px;top:190px;font-size:28px;line-height:34px">${FRAMES_WORD} bravo</p>
<input id="r" type="range" min="0" max="100" value="10" style="left:20px;top:250px;width:260px;height:24px">
<div id="s" style="position:absolute;left:320px;top:20px;width:140px;height:180px;overflow:auto;background:#fff"><div style="height:1200px"></div></div>
<iframe id="n" src="${innerOrigin}/frames/inner?p=${cleanName(name)}" style="left:320px;top:230px;width:280px;height:160px"></iframe>
<iframe id="c" src="/frames/same?p=${cleanName(name)}" style="left:470px;top:20px;width:160px;height:100px"></iframe>
${framesScript(["b", "bl", "bm", "l", "t", "w", "r", "s", "n", "c"])}
</body></html>`;

/** PT-5d — `/frames/inner?p=<name>`: the nested frame — a button and a file input. */
export const framesInnerHtml = (): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>inner</title>${FRAMES_STYLE}<style>body { background: #ffd34d; }</style></head>
<body><button id="ib" style="left:0;top:0;width:140px;height:80px">inner</button>
<input id="if" type="file" style="left:150px;top:10px;width:120px;height:40px">
${framesScript(["ib", "if"])}
</body></html>`;

/** PT-5d (M6.3a) — FRAME-CLIPPED's host page: where its scroller stands, and how far it is scrolled (the frame's top half
 * then sits above the scroller's top edge, under the header). */
export const FRAMES_CLIPPED = { x: 160, y: 300, w: 680, h: 420, scrolled: 610 } as const;

/** PT-5d (M6.3a) — `/frames/clipped?p=<name>` at `hostOrigin`: a header across the top (80 → 300) and, under it, a
 * SCROLLER (`FRAMES_CLIPPED`) holding a frame of `frameOrigin` 400 px down its content, scrolled so the frame's top half
 * is clipped — where the header is drawn; it hears the hand on its header and the frame's element alone. */
export const framesClippedHtml = (name: string, frameOrigin: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${FIXTURE_TITLE} — clipped</title>
${FRAMES_STYLE}<style>body { background: ${hex(FIXTURE_HUE)}; } iframe { display: block; border: 0; }
#sc { position: absolute; left: ${FRAMES_CLIPPED.x}px; top: ${FRAMES_CLIPPED.y}px; width: ${FRAMES_CLIPPED.w}px; height: ${FRAMES_CLIPPED.h}px; overflow: auto; background: #fff; }</style></head>
<body><button id="hd" style="left:0;top:80px;width:100%;height:220px">header</button>
<div id="sc"><div style="height:400px"></div><iframe id="f" src="${frameOrigin}/frames/frame?p=${cleanName(name)}" style="width:${FRAMES_BOX.w}px;height:${FRAMES_BOX.h}px"></iframe><div style="height:400px"></div></div>
<script>document.getElementById("sc").scrollTop = ${FRAMES_CLIPPED.scrolled};</script>
${framesScript(["f", "hd", "sc"], ["f", "hd"])}
</body></html>`;

/** PT-5d (M7 H3) — FRAME-COVERED's host page: where its frame stands, and how far down its fixed header reaches (the frame's
 * top `header − y` px under it). */
export const FRAMES_COVERED = { x: 160, y: 60, header: 140 } as const;

/** PT-5d (M7 H3) — `/frames/covered?p=<name>` at `hostOrigin`: a frame of `frameOrigin` at `FRAMES_COVERED`, a FIXED header
 * across the top drawn over the frame's top, and a menu button that opens a dropdown (`#mn`) over the frame, its item
 * (`#mi`) over the frame's right; it hears the hand on its header, its menu's button and item, and the frame's element.
 * `&sly=1` (M8): the page replaces its OWN world's DOM methods to hide its header from a read — `getBoundingClientRect`
 * says nothing of it, `elementFromPoint` names the frame where the header is, `elementsFromPoint` drops it (after its
 * own words are set up: what it says of itself stays true). `&slot=1` (M12 J5): the frame is held in an about:blank SLOT
 * the page writes (`#f` — a frame of the page's own process, an ad server's friendly iframe) at the slot's own 0, 0, the
 * slot where the frame stood: the header is drawn over the SLOT. */
export const framesCoveredHtml = (
  name: string,
  frameOrigin: string,
  sly = false,
  slot = false,
): string => {
  const src = `${frameOrigin}/frames/frame?p=${cleanName(name)}`;
  const place = `left:${FRAMES_COVERED.x}px;top:${FRAMES_COVERED.y}px;width:${FRAMES_BOX.w}px;height:${FRAMES_BOX.h}px`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${FIXTURE_TITLE} — covered</title>
${FRAMES_STYLE}<style>body { background: ${hex(FIXTURE_HUE)}; } iframe { position: absolute; border: 0; } #mn { position: absolute; display: none; z-index: 3; background: #fff; box-shadow: 0 4px 16px #0004; }</style></head>
<body>${slot ? `<iframe id="f" style="${place}"></iframe>\n${slotScript(src)}` : `<iframe id="f" src="${src}" style="${place}"></iframe>`}
<button id="hd" style="position:fixed;left:0;top:0;width:100%;height:${FRAMES_COVERED.header}px;z-index:2">header</button>
<button id="mb" style="left:860px;top:200px;width:120px;height:40px">menu</button>
<div id="mn" style="left:600px;top:240px;width:240px;height:200px"><button id="mi" style="left:20px;top:80px;width:200px;height:40px">item</button></div>
<script>const mn = document.getElementById("mn"); document.getElementById("mb").addEventListener("click", () => { mn.style.display = mn.style.display === "block" ? "none" : "block"; });</script>
${framesScript(["f", "hd", "mb", "mn", "mi"], ["f", "hd", "mb", "mi"])}
${sly ? SLY_SCRIPT : ""}
</body></html>`;
};

/** PT-5d (M12 J5) — the page writes its about:blank slot `#f`: the frame of another site (`src`) at the slot's 0, 0,
 * filling it — as an ad server writes the creative's frame into its friendly iframe. */
const slotScript = (src: string): string => `<script>(() => {
  const d = document.getElementById("f").contentDocument;
  d.open();
  d.write(${JSON.stringify(`<!doctype html><html><head><style>html, body { margin: 0; overflow: hidden; } iframe { display: block; border: 0; }</style></head><body><iframe id="g" src="${src}" style="width:${FRAMES_BOX.w}px;height:${FRAMES_BOX.h}px"></iframe></body></html>`)});
  d.close();
})();</script>`;

/** PT-5d (M8) — a host page's own world lying about its header: what a read in the page's world would believe. */
const SLY_SCRIPT = `<script>(() => {
  const hd = document.getElementById("hd"), f = document.getElementById("f");
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () { return this === hd ? new DOMRect(0, 0, 0, 0) : rect.call(this); };
  const one = Document.prototype.elementFromPoint;
  Document.prototype.elementFromPoint = function (x, y) { const t = one.call(this, x, y); return t === hd ? f : t; };
  const all = Document.prototype.elementsFromPoint;
  Document.prototype.elementsFromPoint = function (x, y) { return all.call(this, x, y).filter((t) => t !== hd); };
})();</script>`;

/** PT-5d (M6.1) — `/frames/same?p=<name>`: the frame's own child of its site — a document of the frame's process, so
 * speaking on the frame's session, its viewport another size than the frame's — a button. */
export const framesSameHtml = (): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>same site</title>${FRAMES_STYLE}<style>body { background: #f4d8f0; }</style></head>
<body><button id="sb" style="left:10px;top:10px;width:120px;height:40px">same</button>
${framesScript(["sb"])}
</body></html>`;

/** PT-5d — `/frames/next?p=<name>`: where the frame goes on the smoke's word — a button. */
export const framesNextHtml = (): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>next frame</title>${FRAMES_STYLE}<style>body { background: #d8f0d8; }</style></head>
<body><button id="b2" style="left:20px;top:20px;width:140px;height:44px">again</button>
${framesScript(["b2"])}
</body></html>`;

/** PT-6a (K1) — how long `/frames/busy` keeps its thread after a press or a tap on its field (its own task, posted as a
 * framework's scheduler posts a render: after the press's handlers, before its word), and how long `/frames/spin`'s button
 * holds its thread in its OWN mousedown (ms). */
export const FRAMES_BUSY_MS = 1_500;
export const FRAMES_SPIN_MS = 3_000;
/** PT-6a (K1) — `/frames/busy`'s field and its ad-like frame of another site (its view's CSS px). */
export const FRAMES_BUSY = {
  field: { x: 40, y: 60, w: 320, h: 44 },
  ad: { x: 40, y: 160, w: 300, h: 250 },
} as const;

/**
 * PT-6a (K1) — `/frames/busy?p=<name>` at `hostOrigin`: a page holding an AD-LIKE frame of another site (`frameOrigin`'s
 * `/frames/next`) and a field of its OWN — a press on the field (its `pointerdown`), or a tap's end (`touchend`), POSTS
 * a task (a `MessageChannel` message, as a framework's scheduler posts its render) that keeps the thread
 * `FRAMES_BUSY_MS`, and a timer of its own (`setTimeout(0)`) posted WHERE THE WORDS' IS — in a capture listener on the
 * window, at the hint's own event, ahead of the busy task's post — so it fires when theirs does (PT-6a run 10: posted
 * after the busy task, it fired after the spin always, and `held` said a late word of every leg).
 * It says (`busy`, with every ask): each spin (when it began, how long, of a press or a tap), when its own timer fired,
 * and when its field heard each click — so a row knows whether the WORD of the hint waited behind the spin (its timer
 * after the spin) with the hint's gesture already answered (its click before the spin). `on: "key"` (`&on=key`): a press
 * or a tap posts nothing; the field's FIRST key's `keydown` requests a RENDER (`requestAnimationFrame`, busy
 * `FRAMES_BUSY_MS`, once) and says when it came (`keys`) — a key's down is answered at once, and Chromium runs the render
 * AHEAD of the words' 0-ms timer posted before it (run 11: "here@1465"), so the keys after it meet the page's doubt while
 * its word waits behind the render, nothing of the hand in flight before them: K1's hold. (A posted `MessageChannel` task
 * runs after the words' timer — runs 10, 11: the word first; a press's release and a tap's end are answered only after
 * the task, so their keys wait behind them, never on the word.)
 */
export const framesBusyHtml = (
  name: string,
  frameOrigin: string,
  on: "press" | "key" = "press",
): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${FIXTURE_TITLE} — busy</title>
${FRAMES_STYLE}<style>body { background: ${hex(FIXTURE_HUE)}; } iframe { position: absolute; border: 0; }</style></head>
<body><input id="t" type="text" autocomplete="off" spellcheck="false" style="left:${FRAMES_BUSY.field.x}px;top:${FRAMES_BUSY.field.y}px;width:${FRAMES_BUSY.field.w}px;height:${FRAMES_BUSY.field.h}px">
<iframe id="f" src="${frameOrigin}/frames/next?p=${cleanName(name)}" style="left:${FRAMES_BUSY.ad.x}px;top:${FRAMES_BUSY.ad.y}px;width:${FRAMES_BUSY.ad.w}px;height:${FRAMES_BUSY.ad.h}px"></iframe>
<script>(() => {
  const busy = { spins: [], timers: [], clicks: [], keys: [] };
  globalThis.__vfBusy = busy;
  const now = () => Math.round(performance.now());
  const mark = () => setTimeout(() => { busy.timers.push(now()); }, 0);
  const hold = (why) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { const at = performance.now(); while (performance.now() - at < ${FRAMES_BUSY_MS}) {} busy.spins.push([Math.round(at), Math.round(performance.now() - at), why]); };
    ch.port2.postMessage(0);
  };
  const render = (why) => requestAnimationFrame(() => { const at = performance.now(); while (performance.now() - at < ${FRAMES_BUSY_MS}) {} busy.spins.push([Math.round(at), Math.round(performance.now() - at), why]); });
  const t = document.getElementById("t");
  if (${JSON.stringify(on)} === "key") {
    let keyed = false;
    globalThis.addEventListener("keydown", (e) => { if (e.target === t && !keyed) mark(); }, true);
    t.addEventListener("keydown", () => { if (keyed) return; keyed = true; busy.keys.push(now()); render("key"); });
  } else {
    globalThis.addEventListener("pointerdown", (e) => { if (e.target === t && e.pointerType !== "touch") mark(); }, true);
    globalThis.addEventListener("touchend", (e) => { if (e.target === t) mark(); }, true);
    t.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") hold("press"); });
    t.addEventListener("touchend", () => hold("tap"));
  }
  t.addEventListener("click", () => { busy.clicks.push(now()); });
})();</script>
${framesScript(["t", "f"])}
</body></html>`;

/** PT-6a (M4, M5 — F1) — `/frames/opened`'s editor frame (same-site, written after the load), its field inside it (the
 * editor's own px), and its ad-like frame of another site (its view's CSS px). */
export const FRAMES_OPENED = {
  editor: { x: 40, y: 40, w: 400, h: 120 },
  field: { x: 10, y: 20, w: 360, h: 40 },
  ad: { x: 40, y: 300, w: 300, h: 200 },
} as const;

/**
 * PT-6a (M4, M5 — F1) — `/frames/opened?p=<name>` at `hostOrigin`: a page holding an AD-LIKE frame of another site
 * (`frameOrigin`'s `/frames/next` — the page is framed: its page-born doubts wait for a word) and a same-site EDITOR
 * frame its script WRITES by `open()`/`write()`/`close()` once the page has loaded — an iframe editor's way, an ad slot's
 * way. The document-open steps erase every listener of that frame's window (the focus words' too), so a press into its
 * field and the keys after it are heard there by no word. It says (`opened`, with every ask) how often it wrote the editor
 * and what the editor's field holds.
 */
export const framesOpenedHtml = (name: string, frameOrigin: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${FIXTURE_TITLE} — opened</title>
${FRAMES_STYLE}<style>body { background: ${hex(FIXTURE_HUE)}; } iframe { position: absolute; border: 0; }</style></head>
<body><iframe id="ed" style="left:${FRAMES_OPENED.editor.x}px;top:${FRAMES_OPENED.editor.y}px;width:${FRAMES_OPENED.editor.w}px;height:${FRAMES_OPENED.editor.h}px;background:#fff"></iframe>
<iframe id="f" src="${frameOrigin}/frames/next?p=${cleanName(name)}" style="left:${FRAMES_OPENED.ad.x}px;top:${FRAMES_OPENED.ad.y}px;width:${FRAMES_OPENED.ad.w}px;height:${FRAMES_OPENED.ad.h}px"></iframe>
<script>(() => {
  const opened = { opens: 0 };
  globalThis.__vfOpened = opened;
  const write = () => {
    const d = document.getElementById("ed").contentDocument;
    d.open();
    d.write('<!doctype html><html><body style="margin:0;background:#fff"><input id="e" type="text" autocomplete="off" spellcheck="false" style="position:absolute;left:${FRAMES_OPENED.field.x}px;top:${FRAMES_OPENED.field.y}px;width:${FRAMES_OPENED.field.w}px;height:${FRAMES_OPENED.field.h}px;box-sizing:border-box;font:600 18px sans-serif"></body></html>');
    d.close();
    opened.opens += 1;
  };
  if (document.readyState === "complete") setTimeout(write, 0);
  else addEventListener("load", () => setTimeout(write, 0));
})();</script>
${framesScript(["f", "ed"])}
</body></html>`;

/** PT-6a (K1, the engine's fact) — `/frames/spin?p=<name>`: a FRAMELESS page whose button holds its thread
 * `FRAMES_SPIN_MS` in its OWN `mousedown`; it says (`busy.downs`) when each began and how long it ran. */
export const framesSpinHtml = (): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${FIXTURE_TITLE} — spin</title>
${FRAMES_STYLE}<style>body { background: ${hex(FIXTURE_HUE)}; }</style></head>
<body><button id="b" style="left:120px;top:120px;width:220px;height:64px">spin</button>
<script>(() => {
  const busy = { downs: [] };
  globalThis.__vfBusy = busy;
  document.getElementById("b").addEventListener("mousedown", () => { const at = performance.now(); while (performance.now() - at < ${FRAMES_SPIN_MS}) {} busy.downs.push([Math.round(at), Math.round(performance.now() - at)]); });
})();</script>
${framesScript(["b"])}
</body></html>`;

/** PT-5d — `/frames/loop?p=<name>`: a page whose button starts an ENDLESS LOOP — its thread never answers again. */
export const framesLoopHtml = (): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${FIXTURE_TITLE} — loop</title>
${FRAMES_STYLE}<style>body { background: ${hex(FIXTURE_HUE)}; }</style></head>
<body><button id="b" style="left:120px;top:120px;width:220px;height:64px">loop</button>
<script>document.getElementById("b").addEventListener("click", () => { for (;;) {} });</script>
${framesScript(["b"])}
</body></html>`;

/**
 * PT-5a — `/acts`: what a page may ask for, each a control at a known place (a row of boxes on the fixture's ground, the
 * page's own word for where each stands), and what came of it said with every ask. Its report is the page's whole word
 * (`FixtureReport`) with `acts` beside it; the parts the other rows press (`link`, `field`, `word`) are its own field and
 * its pop-up link.
 */
export function actsHtml(): string {
  const box = (i: number): string => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    return `left:${8 + col * 22}%;top:${12 + row * 12}vh;width:18%;height:6vh;line-height:6vh`;
  };
  const at = (id: FixtureActId): string => box(FIXTURE_ACT_IDS.indexOf(id));
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${FIXTURE_TITLE} — acts</title><link rel="icon" type="image/png" href="/icon.png">
<style>
  html, body { margin: 0; background: ${hex(FIXTURE_HUE)}; }
  html { scrollbar-width: none; }
  .act { position: absolute; box-sizing: border-box; margin: 0; padding: 0 8px; border: 0; border-radius: 6px;
    background: #e9f0fb; color: #10213f; font: 600 16px sans-serif; text-align: center; text-decoration: none;
    white-space: nowrap; overflow: hidden; cursor: pointer; }
  input.act { cursor: text; text-align: left; }
  #runner { position: absolute; left: 0; top: 62vh; width: 12%; height: 18vh; background: #ffd34d; border-radius: 6px; }
</style></head>
<body>
<a class="act" id="popup" style="${at("popup")}" href="/next" target="_blank">new window</a>
<button class="act" id="open" style="${at("open")}">window.open</button>
<button class="act" id="alert" style="${at("alert")}">alert</button>
<input class="act" id="file" style="${at("file")}" type="file">
<button class="act" id="tone" style="${at("tone")}">tone</button>
<a class="act" id="download" style="${at("download")}" href="/file.bin" download>download</a>
<a class="act" id="slow" style="${at("slow")}" href="/slow">slow page</a>
<input class="act" id="field" style="${at("field")}" type="text" autocomplete="off" spellcheck="false">
<div id="runner"></div>
<script>
  const token = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  const ids = ${JSON.stringify(FIXTURE_ACT_IDS)};
  const el = (id) => document.getElementById(id);
  let alerts = 0, confirmed = null, prompted = "unasked", cancels = 0, changes = 0, opened = "unasked", audio = null;
  let pointer = "", touches = 0, x = 0, timer = null;
  el("alert").addEventListener("click", () => {
    alert("PT-5a: a page that alerts");
    alerts += 1;
    confirmed = confirm("PT-5a: a page that asks");
    try { prompted = prompt("PT-5a: a page that prompts"); } catch { prompted = "threw"; }
  });
  el("file").addEventListener("cancel", () => { cancels += 1; });
  el("file").addEventListener("change", () => { changes += 1; });
  el("open").addEventListener("click", () => {
    const w = window.open("/next?opened=1");
    opened = w === null ? "null" : "window";
    // said at once, and past this page's unload (the pane itself may be sent where the window was asked for)
    navigator.sendBeacon("/beacon?token=" + token + "&report=" + report());
  });
  el("tone").addEventListener("click", () => {
    if (audio === null) {
      audio = new AudioContext();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = ${FIXTURE_TONE.hz};
      gain.gain.value = ${FIXTURE_TONE.gain};
      osc.connect(gain).connect(audio.destination);
      osc.start();
    }
    audio.resume();
  });
  for (const type of ["pointerdown", "pointermove", "pointerup"])
    addEventListener(type, (e) => { pointer = e.pointerType; }, true);
  addEventListener("touchstart", () => { touches += 1; }, { capture: true, passive: true });
  const runner = el("runner");
  const pace = (play) => {
    if (play && timer === null) timer = setInterval(() => { x = (x + 1.3) % 88; runner.style.left = x + "%"; }, 33);
    if (!play && timer !== null) { clearInterval(timer); timer = null; }
  };
  const box = (id) => {
    const r = el(id).getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const hints = () => navigator.userAgentData
    ? { platform: navigator.userAgentData.platform, mobile: navigator.userAgentData.mobile,
        brands: navigator.userAgentData.brands.map((b) => b.brand) }
    : null;
  const report = () => encodeURIComponent(JSON.stringify({
    path: location.pathname + location.search,
    scrollY: Math.round(window.scrollY),
    sel: String(window.getSelection() || ""),
    field: el("field").value,
    focused: (document.activeElement && document.activeElement.id) || "",
    submitted: 0,
    view: [innerWidth, innerHeight],
    parts: { link: box("popup"), field: box("field"), word: box("runner") },
    ua: navigator.userAgent,
    platform: navigator.platform,
    uaData: hints(),
    touchPoints: navigator.maxTouchPoints,
    dpr: devicePixelRatio,
    dark: matchMedia("(prefers-color-scheme: dark)").matches,
    pointer,
    touches,
    cookie: document.cookie,
    stored: "",
    title: document.title,
    acts: {
      alerts, confirmed, prompted, cancels, changes, opened,
      tone: audio === null ? "" : audio.state,
      parts: Object.fromEntries(ids.map((id) => [id, box(id)])),
    },
  }));
  const ask = () => fetch("/beacon?token=" + token + "&report=" + report(), { cache: "no-store" })
    .then((r) => r.json()).then((a) => pace(a.play === true)).catch(() => {});
  ask();
  setInterval(ask, ${FIXTURE_ASK_MS});
</script>
</body></html>`;
}

/** The fixture server, on an ephemeral loopback port; the page starts still. */
export async function startLiveFixture(): Promise<LiveFixture> {
  let loads = 0;
  let nexts = 0;
  let playing = false;
  let last: FixtureReport | null = null;
  let icons = 0;
  let files = 0;
  const slow = { asked: 0, answered: 0, aborted: 0 };
  /** PT-5b: `/gate` — its door, its counts, and the loads waiting at it. */
  let gateOpen = true;
  const gated = { asked: 0, answered: 0 };
  const atGate = new Set<() => void>();
  /** PT-5a: the servers opened on once-refusing ports, closed with the fixture. */
  const revived: Server[] = [];
  const lastAt = new Map<string, FixtureReport>();
  /** PT-5d: how many times each page asked, by its path and query. */
  const reportsAt = new Map<string, number>();
  const framesLoads = new Map<string, number>();
  /** PT-5b2: how many times each pathname was asked for; and the answers that never come (`/hang.png`). */
  const asks = new Map<string, number>();
  const hung = new Set<ServerResponse>();
  /** PT-5c2: the bodies `/cut` holds open, by the address each was asked at (its path and query). */
  const cutting = new Map<ServerResponse, string>();
  /** PT-5c2: `/held.css`'s answers owed, by the name each waits for; the names whose pages may paint. */
  const sheets = new Map<() => void, string>();
  const painting = new Set<string>();
  /** PT-5b3: the hold, and the tidying, owed to the next ask of a page at this path. */
  let holding: { readonly path: string; readonly ms: number } | null = null;
  let tidying: string | null = null;
  /** PT-5d: where the page at a path is sent at its next ask (`goFrame`). */
  const going = new Map<string, string>();
  /** PT-5d: the three sites' origins — known once the server listens. */
  let frameOrigin = "";
  let innerOrigin = "";
  const cookies = new Map<string, string>();
  const agents = new Map<string, string>();
  const tokens: string[] = [];
  const html = (res: ServerResponse, body: string): void => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  };
  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    asks.set(url.pathname, (asks.get(url.pathname) ?? 0) + 1);
    if (url.pathname !== "/beacon" && url.pathname !== "/held")
      agents.set(url.pathname + url.search, String(req.headers["user-agent"] ?? ""));
    if (url.pathname === "/hang.png") {
      // never answered: whoever waits on it never finishes loading (closed with the fixture)
      hung.add(res);
      res.on("close", () => hung.delete(res));
      return;
    }
    if (url.pathname === "/topaint" || url.pathname === "/unpainted") {
      cookies.set(url.pathname + url.search, req.headers.cookie ?? "");
      const name = url.searchParams.get("p") ?? "";
      html(res, url.pathname === "/topaint" ? toUnpaintedHtml(name) : unpaintedHtml(name));
      return;
    }
    if (url.pathname === "/held.css") {
      // PT-5c2: the stylesheet a page's first paint waits for — answered on the smoke's word (closed with the fixture)
      const name = url.searchParams.get("p") ?? "";
      let done = false;
      const answer = (): void => {
        if (done) return;
        done = true;
        sheets.delete(answer);
        res.writeHead(200, { "content-type": "text/css", "cache-control": "no-store" });
        res.end("html { color-scheme: light; }");
      };
      if (painting.has(name)) {
        answer();
        return;
      }
      sheets.set(answer, name);
      res.on("close", () => {
        done = true;
        sheets.delete(answer);
      });
      return;
    }
    if (url.pathname === "/cut") {
      // PT-5c2: the page at once — and its body never ended: held until the smoke cuts it (closed with the fixture)
      cookies.set(url.pathname + url.search, req.headers.cookie ?? "");
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.write(cutHtml());
      cutting.set(res, url.pathname + url.search);
      res.on("close", () => cutting.delete(res));
      return;
    }
    if (url.pathname.startsWith("/frames/")) {
      // PT-5d: the pages of three sites
      cookies.set(url.pathname + url.search, req.headers.cookie ?? "");
      framesLoads.set(
        url.pathname + url.search,
        (framesLoads.get(url.pathname + url.search) ?? 0) + 1,
      );
      const name = url.searchParams.get("p") ?? "";
      const page =
        url.pathname === "/frames/host"
          ? framesHostHtml(
              name,
              frameOrigin,
              url.searchParams.get("noviewport") !== "1",
              url.searchParams.get("shadow") === "1",
            )
          : url.pathname === "/frames/clipped"
            ? framesClippedHtml(name, frameOrigin)
            : url.pathname === "/frames/covered"
              ? framesCoveredHtml(
                  name,
                  frameOrigin,
                  url.searchParams.get("sly") === "1",
                  url.searchParams.get("slot") === "1",
                )
              : url.pathname === "/frames/frame"
                ? framesFrameHtml(name, innerOrigin)
                : url.pathname === "/frames/inner"
                  ? framesInnerHtml()
                  : url.pathname === "/frames/same"
                    ? framesSameHtml()
                    : url.pathname === "/frames/next"
                      ? framesNextHtml()
                      : url.pathname === "/frames/loop"
                        ? framesLoopHtml()
                        : url.pathname === "/frames/busy"
                          ? framesBusyHtml(
                              name,
                              frameOrigin,
                              url.searchParams.get("on") === "key" ? "key" : "press",
                            )
                          : url.pathname === "/frames/spin"
                            ? framesSpinHtml()
                            : url.pathname === "/frames/opened"
                              ? framesOpenedHtml(name, frameOrigin)
                              : null;
      if (page === null) {
        res.writeHead(404);
        res.end();
        return;
      }
      html(res, page);
      return;
    }
    if (url.pathname === "/zoom") {
      cookies.set(url.pathname + url.search, req.headers.cookie ?? "");
      html(res, zoomHtml());
      return;
    }
    if (url.pathname === "/pending") {
      cookies.set(url.pathname + url.search, req.headers.cookie ?? "");
      html(res, pendingHtml(url.searchParams.get("p") ?? ""));
      return;
    }
    if (
      url.pathname === "/loading" ||
      url.pathname === "/redirecting" ||
      url.pathname === "/busy" ||
      url.pathname === "/cold"
    ) {
      cookies.set(url.pathname + url.search, req.headers.cookie ?? "");
      html(
        res,
        url.pathname === "/loading"
          ? loadingHtml()
          : url.pathname === "/busy"
            ? busyHtml()
            : url.pathname === "/cold"
              ? coldHtml()
              : redirectingHtml(),
      );
      return;
    }
    if (url.pathname === "/held") {
      // (a page's word that its hold began: counted with every ask — `asked("/held")`)
      res.writeHead(204, { "cache-control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/nothing") {
      res.writeHead(204, { "cache-control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/acts" || url.pathname === "/revived") {
      cookies.set(url.pathname + url.search, req.headers.cookie ?? "");
      html(res, url.pathname === "/acts" ? actsHtml() : fixtureHtml("/next"));
      return;
    }
    if (url.pathname === "/slow") {
      // answered late; a load stopped before then (the bar's Stop) closes its request, and is counted as given up
      slow.asked += 1;
      let done = false;
      const timer = setTimeout(() => {
        done = true;
        slow.answered += 1;
        html(res, fixtureHtml("/next"));
      }, FIXTURE_SLOW_MS);
      res.on("close", () => {
        if (done) return;
        clearTimeout(timer);
        slow.aborted += 1;
      });
      return;
    }
    if (url.pathname === "/gate") {
      // the page, held while the gate is shut (never past the cap); a load given up meanwhile is forgotten
      gated.asked += 1;
      cookies.set(url.pathname + url.search, req.headers.cookie ?? "");
      let done = false;
      const answer = (): void => {
        if (done) return;
        done = true;
        clearTimeout(cap);
        atGate.delete(answer);
        gated.answered += 1;
        html(res, fixtureHtml("/page"));
      };
      const cap = setTimeout(answer, FIXTURE_GATE_MS);
      res.on("close", () => {
        if (done) return;
        done = true;
        clearTimeout(cap);
        atGate.delete(answer);
      });
      if (gateOpen) answer();
      else atGate.add(answer);
      return;
    }
    if (url.pathname === "/file.bin") {
      files += 1;
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="pt-5a.bin"',
        "cache-control": "no-store",
      });
      res.end(Buffer.alloc(64, 7));
      return;
    }
    if (url.pathname === "/icon.png") {
      icons += 1;
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      res.end(fixtureIcon());
      return;
    }
    if (url.pathname === "/page" || url.pathname === "/next" || url.pathname === "/legacy") {
      if (url.pathname === "/page") loads += 1;
      else if (url.pathname === "/next") nexts += 1;
      cookies.set(url.pathname + url.search, req.headers.cookie ?? "");
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(fixtureHtml(url.pathname));
      return;
    }
    if (url.pathname === "/beacon") {
      const token = url.searchParams.get("token") ?? "";
      if (token.length > 0 && !tokens.includes(token)) tokens.push(token);
      const said = url.searchParams.get("report");
      if (said !== null && token.length > 0) {
        try {
          const r = JSON.parse(said) as Omit<FixtureReport, "token">;
          last = { ...r, token };
          lastAt.set(last.path, last);
          reportsAt.set(last.path, (reportsAt.get(last.path) ?? 0) + 1);
        } catch {
          /* a report the page did not finish: the last one stands */
        }
      }
      // PT-5b3: a hold owed to the page at this path is told with this answer, once
      let hold = 0;
      if (
        holding !== null &&
        last !== null &&
        last.token === token &&
        last.path.startsWith(holding.path)
      ) {
        hold = holding.ms;
        holding = null;
      }
      let tidy = false;
      if (
        tidying !== null &&
        last !== null &&
        last.token === token &&
        last.path.startsWith(tidying)
      ) {
        tidy = true;
        tidying = null;
      }
      // PT-5d: a page sent elsewhere on the smoke's word is told with this answer, once
      const go = last !== null && last.token === token ? going.get(last.path) : undefined;
      if (go !== undefined && last !== null) going.delete(last.path);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(
        JSON.stringify({
          play: playing,
          ...(hold > 0 ? { hold } : {}),
          ...(tidy ? { tidy } : {}),
          ...(go === undefined ? {} : { go }),
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  };
  const server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  // PT-5d: the same pages on IPv6's loopback too — `[::1]`, a third site — and `localhost` reaches either
  const v6 = createServer(handle);
  const spoke6 = await new Promise<boolean>((resolve) => {
    v6.once("error", () => resolve(false));
    v6.listen(port, "::1", () => resolve(true));
  });
  const hostOrigin = `http://localhost:${port}`;
  frameOrigin = origin;
  innerOrigin = spoke6 ? `http://[::1]:${port}` : hostOrigin;
  return {
    origin,
    hostOrigin,
    innerOrigin,
    url: `${origin}/page`,
    setPlaying: (on) => {
      playing = on;
    },
    loads: () => loads,
    tokens: () => [...tokens],
    report: () => last,
    served: (path) => (path === "/page" ? loads : nexts),
    reportAt: (path) => lastAt.get(path) ?? null,
    cookieSeen: (path) => cookies.get(path) ?? null,
    agentSeen: (path) => agents.get(path) ?? null,
    icons: () => icons,
    slow: () => ({ ...slow }),
    files: () => files,
    asked: (path) => asks.get(path) ?? 0,
    hold: (path, ms) => {
      holding = { path, ms };
    },
    unpainted: (name) => [...sheets.values()].filter((at) => at === name).length,
    paint: (name) => {
      painting.add(name);
      for (const [answer, at] of [...sheets]) if (at === name) answer();
    },
    cut: (path) => {
      let cut = 0;
      for (const [res, at] of [...cutting]) {
        if (!at.startsWith(path)) continue;
        cutting.delete(res);
        res.socket?.destroy();
        cut += 1;
      }
      return cut;
    },
    tidy: (path) => {
      tidying = path;
    },
    goFrame: (path, to) => {
      going.set(path, to);
    },
    reports: (path) => reportsAt.get(path) ?? 0,
    framesServed: (path) => framesLoads.get(path) ?? 0,
    gate: (open) => {
      gateOpen = open;
      if (open) for (const answer of [...atGate]) answer();
    },
    gated: () => ({ ...gated, waiting: atGate.size }),
    async refusing() {
      // a port the system just gave and took back: nobody listens there, so a connection to it is REFUSED
      const probe = createTcpServer();
      await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
      const refused = (probe.address() as AddressInfo).port;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      const host = `127.0.0.1:${refused}`;
      return {
        url: `http://${host}/revived`,
        host,
        async open() {
          const again = createServer(handle);
          revived.push(again);
          await new Promise<void>((resolve, reject) => {
            again.once("error", reject);
            again.listen(refused, "127.0.0.1", resolve);
          });
        },
      };
    },
    close: async () => {
      gateOpen = true;
      for (const answer of [...atGate]) answer();
      for (const res of [...hung]) res.destroy();
      for (const res of [...cutting.keys()]) res.destroy();
      for (const answer of [...sheets.keys()]) answer();
      for (const s of [server, ...(spoke6 ? [v6] : []), ...revived])
        await new Promise<void>((resolve) => {
          s.closeAllConnections?.();
          s.close(() => resolve());
        });
    },
  };
}
