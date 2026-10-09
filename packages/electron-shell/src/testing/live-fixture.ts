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
  close(): Promise<void>;
}

const hex = (c: { r: number; g: number; b: number }): string =>
  `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** The page's HTML: its ground, headline, bars and runner; its memory; its pace, asked of the server. */
export function fixtureHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>PT-2 fixture</title>
<style>
  html, body { margin: 0; height: 100%; background: ${hex(FIXTURE_HUE)}; overflow: hidden; }
  .head { position: absolute; left: 8%; top: 10%; width: 56%; height: 14%; background: #ffffff; border-radius: 8px; }
  .bar { position: absolute; left: 8%; height: 4%; background: rgba(255,255,255,0.72); border-radius: 4px; }
  #runner { position: absolute; left: 0; top: 62%; width: 12%; height: 18%; background: #ffd34d; border-radius: 6px; }
</style></head>
<body>
<div class="head"></div>
<div class="bar" style="top:32%;width:64%"></div>
<div class="bar" style="top:40%;width:58%"></div>
<div class="bar" style="top:48%;width:40%"></div>
<div id="runner"></div>
<script>
  const token = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  const runner = document.getElementById("runner");
  let x = 0, timer = null;
  const pace = (play) => {
    if (play && timer === null) timer = setInterval(() => { x = (x + 1.3) % 88; runner.style.left = x + "%"; }, 33);
    if (!play && timer !== null) { clearInterval(timer); timer = null; }
  };
  const ask = () => fetch("/beacon?token=" + token, { cache: "no-store" })
    .then((r) => r.json()).then((a) => pace(a.play === true)).catch(() => {});
  ask();
  setInterval(ask, ${FIXTURE_ASK_MS});
</script>
</body></html>`;
}

/** The fixture server, on an ephemeral loopback port; the page starts still. */
export async function startLiveFixture(): Promise<LiveFixture> {
  let loads = 0;
  let playing = false;
  const tokens: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/page") {
      loads += 1;
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(fixtureHtml());
      return;
    }
    if (url.pathname === "/beacon") {
      const token = url.searchParams.get("token") ?? "";
      if (token.length > 0 && !tokens.includes(token)) tokens.push(token);
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
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
