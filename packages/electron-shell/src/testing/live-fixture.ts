// PT-2 — THE SMOKE'S FIXTURE PAGES, served by the smoke itself on 127.0.0.1 (the browser source's policy admits any http(s) host,
// loopback included — browser-security.ts `isAllowedBrowserTopLevelUrl`/`isAllowedBrowserRequest`, and the producer loads its
// `initialUrl` through the first): owned pages whose pixels the live-pane rows judge by colour count, contrast and the fixture's
// OWN KNOWN HUE, never a hash, and whose memory tells whether a window reload re-attached the SAME page.
//   /still — a still page: a ground of FIXTURE_HUE, a white headline block and three bars; once laid out it paints nothing more
//            (the IDLE row). Its memory: a token made at load, beaconed at once and every 500 ms (`/beacon?page=still&token=…`) —
//            the same token after a reload is the same page (the RELOAD row, the reuseKey proof).
//   /play  — the same ground with a bar crossing it, moved every 33 ms: a page painting ~30 times a second (the PLAYING row).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** The fixture's ground: a saturated blue, far from the mat's green and the sample page's warm whites. */
export const FIXTURE_HUE = { r: 29, g: 111, b: 216 } as const;

export type FixturePage = "still" | "play";

export interface LiveFixture {
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  url(page: FixturePage): string;
  /** How many times the page was served — a reload of the page itself serves it again. */
  loads(page: FixturePage): number;
  /** The tokens the page's memory beaconed, in order of first arrival (one page, one token). */
  tokens(page: FixturePage): readonly string[];
  close(): Promise<void>;
}

const hex = (c: { r: number; g: number; b: number }): string =>
  `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** A fixture page's HTML: its ground, its headline and bars, its memory; `/play` adds the crossing bar. */
export function fixtureHtml(page: FixturePage): string {
  const ground = hex(FIXTURE_HUE);
  const play =
    page === "play"
      ? `<div id="runner" style="position:absolute;left:0;top:62%;width:12%;height:18%;background:#ffd34d;border-radius:6px"></div>
<script>
  const runner = document.getElementById("runner");
  let x = 0;
  setInterval(() => { x = (x + 1.3) % 88; runner.style.left = x + "%"; }, 33);
</script>`
      : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>PT-2 fixture · ${page}</title>
<style>
  html, body { margin: 0; height: 100%; background: ${ground}; overflow: hidden; font: 600 48px/1.2 -apple-system, sans-serif; }
  .head { position: absolute; left: 8%; top: 10%; width: 56%; height: 14%; background: #ffffff; border-radius: 8px; }
  .bar { position: absolute; left: 8%; height: 4%; background: rgba(255,255,255,0.72); border-radius: 4px; }
</style></head>
<body>
<div class="head"></div>
<div class="bar" style="top:32%;width:64%"></div>
<div class="bar" style="top:40%;width:58%"></div>
<div class="bar" style="top:48%;width:40%"></div>
${play}
<script>
  const token = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  const beacon = () => fetch("/beacon?page=${page}&token=" + token, { cache: "no-store" }).catch(() => {});
  beacon();
  setInterval(beacon, 500);
</script>
</body></html>`;
}

/** The fixture server, on an ephemeral loopback port. */
export async function startLiveFixture(): Promise<LiveFixture> {
  const loads: Record<FixturePage, number> = { still: 0, play: 0 };
  const tokens: Record<FixturePage, string[]> = { still: [], play: [] };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const page = url.pathname.slice(1);
    if (page === "still" || page === "play") {
      loads[page] += 1;
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(fixtureHtml(page));
      return;
    }
    if (url.pathname === "/beacon") {
      const which = url.searchParams.get("page");
      const token = url.searchParams.get("token") ?? "";
      if (
        (which === "still" || which === "play") &&
        token.length > 0 &&
        !tokens[which].includes(token)
      )
        tokens[which].push(token);
      res.writeHead(204, { "cache-control": "no-store" });
      res.end();
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
    url: (page) => `${origin}/${page}`,
    loads: (page) => loads[page],
    tokens: (page) => [...tokens[page]],
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
