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

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** The fixture's ground: a saturated blue, far from the mat's green and the sample page's warm whites. */
export const FIXTURE_HUE = { r: 29, g: 111, b: 216 } as const;

/** How often the page asks the server (ms) — its pace follows the answer. */
export const FIXTURE_ASK_MS = 250;

export interface LiveFixture {
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
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
  close(): Promise<void>;
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
export function fixtureHtml(path: "/page" | "/next" = "/page"): string {
  const head = path === "/page" ? 56 : 30;
  const px = (v: number, of: number): string => `${((v / of) * 100).toFixed(4)}%`;
  const { link, field, wordAt } = FIXTURE_PARTS;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>PT-2 fixture</title>
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
</style></head>
<body>
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
  let x = 0, timer = null, submitted = 0;
  document.getElementById("form").addEventListener("submit", (e) => { e.preventDefault(); submitted += 1; });
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
  const tokens: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/page" || url.pathname === "/next") {
      if (url.pathname === "/page") loads += 1;
      else nexts += 1;
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
        } catch {
          /* a report the page did not finish: the last one stands */
        }
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ play: playing }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    url: `${origin}/page`,
    setPlaying: (on) => {
      playing = on;
    },
    loads: () => loads,
    tokens: () => [...tokens],
    report: () => last,
    served: (path) => (path === "/page" ? loads : nexts),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
