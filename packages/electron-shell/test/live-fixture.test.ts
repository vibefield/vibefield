/**
 * PT-2 — the smoke's fixture page (testing/live-fixture.ts): served on 127.0.0.1 in the fixture's known hue, its pace the
 * smoke's (the beacon's answer), its memory's token counted once — the RELOAD row's same-page proof. PT-3 — the page in use:
 * its link to `/next`, its field, its word, its height past its view, and its report of what it saw, the latest kept.
 * PT-4 — the page as a device sees it: it says its agent, its hints, its fingers, its density, its scheme and its last
 * pointer's type; its title and its one-colour favicon; a value kept in a cookie and its storage, each page's word by its address.
 */
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  FIXTURE_ASK_MS,
  FIXTURE_COOKIE,
  FIXTURE_HUE,
  FIXTURE_ICON_HUE,
  FIXTURE_PARTS,
  FIXTURE_TITLE,
  fixtureHtml,
  fixtureIcon,
  type LiveFixture,
  startLiveFixture,
} from "../src/testing/live-fixture";

let fixture: LiveFixture | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe("the live pane's fixture page", () => {
  it("serves the page on loopback, counted per load; nothing else", async () => {
    fixture = await startLiveFixture();
    expect(fixture.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(fixture.url).toBe(`${fixture.origin}/page`);
    const page = await fetch(fixture.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("#1d6fd8");
    expect(fixture.loads()).toBe(1);
    await fetch(fixture.url);
    expect(fixture.loads()).toBe(2);
    expect((await fetch(`${fixture.origin}/elsewhere`)).status).toBe(404);
  });

  it("answers each ask with the smoke's pace — still until it plays", async () => {
    fixture = await startLiveFixture();
    const ask = async (): Promise<unknown> =>
      (await fetch(`${fixture?.origin}/beacon?token=t1`)).json();
    expect(await ask()).toEqual({ play: false });
    fixture.setPlaying(true);
    expect(await ask()).toEqual({ play: true });
    fixture.setPlaying(false);
    expect(await ask()).toEqual({ play: false });
  });

  it("keeps the page's memory tokens in order, once each — one page, one token", async () => {
    fixture = await startLiveFixture();
    for (const token of ["a1", "a1", "b2", ""])
      expect((await fetch(`${fixture.origin}/beacon?token=${token}`)).status).toBe(200);
    expect(fixture.tokens()).toEqual(["a1", "b2"]);
  });

  it("paints its ground in the known hue; it asks every quarter second and its runner moves only while it plays", () => {
    expect(FIXTURE_HUE).toEqual({ r: 29, g: 111, b: 216 });
    expect(FIXTURE_ASK_MS).toBe(250);
    const html = fixtureHtml();
    expect(html).toMatch(/background: #1d6fd8/);
    expect(html).toMatch(/setInterval\(ask, 250\)/);
    expect(html).toMatch(/if \(play && timer === null\) timer = setInterval/);
    expect(html).toMatch(/if \(!play && timer !== null\) \{ clearInterval\(timer\)/);
  });

  it("PT-3: serves /next apart from /page, each counted; the page's latest report kept with its token, a torn one ignored", async () => {
    fixture = await startLiveFixture();
    expect(fixture.report()).toBeNull();
    const next = await fetch(`${fixture.origin}/next`);
    expect(next.status).toBe(200);
    expect(fixture.served("/next")).toBe(1);
    expect(fixture.served("/page")).toBe(0);
    expect(fixture.loads()).toBe(0);
    await fetch(fixture.url);
    expect(fixture.served("/page")).toBe(1);
    const said = {
      path: "/next?typed=1",
      scrollY: 384,
      sel: "portals",
      field: "hello",
      focused: "field",
      submitted: 1,
      view: [1280, 800],
      parts: {
        link: { x: 1, y: 2, w: 3, h: 4 },
        field: { x: 5, y: 6, w: 7, h: 8 },
        word: { x: 9, y: 10, w: 11, h: 12 },
      },
    };
    const ask = (token: string, report: string): Promise<Response> =>
      fetch(`${fixture?.origin}/beacon?token=${token}&report=${encodeURIComponent(report)}`);
    expect((await ask("t1", JSON.stringify(said))).status).toBe(200);
    expect(fixture.report()).toEqual({ ...said, token: "t1" });
    expect((await ask("t1", '{"path":')).status).toBe(200);
    expect(fixture.report()).toEqual({ ...said, token: "t1" });
    await ask("t2", JSON.stringify({ ...said, path: "/page", scrollY: 0 }));
    expect(fixture.report()?.token).toBe("t2");
    expect(fixture.report()?.path).toBe("/page");
  });

  it("PT-3: the page in use — a link to /next, a field, the word, a page past its view; it reports what it saw", () => {
    const page = fixtureHtml();
    expect(page).toMatch(/<a id="next" href="\/next">/);
    expect(page).toMatch(/<form id="form" action="\/next"><input id="field" type="text"/);
    expect(page).toContain(
      'addEventListener("submit", (e) => { e.preventDefault(); submitted += 1; })',
    );
    expect(page).toContain(`<span id="word">${FIXTURE_PARTS.word}</span>`);
    expect(page).toMatch(/#tall \{ height: 400vh; \}/);
    // what it reports with each ask: where it is, its scroll, its selection, its field, its focus, its view and its parts
    for (const said of [
      "path: location.pathname + location.search",
      "scrollY: Math.round(window.scrollY)",
      "sel: String(window.getSelection()",
      "field: field.value",
      "focused: (document.activeElement",
      "submitted,",
      "view: [innerWidth, innerHeight]",
      'parts: { link: box("next"), field: box("field"), word: box("word") }',
    ])
      expect(page).toContain(said);
    expect(page).toContain('"/beacon?token=" + token + "&report=" + report()');
    // /next: the same page by another address, its headline narrower
    expect(page).toMatch(/\.head \{[^}]*width: 56%/);
    expect(fixtureHtml("/next")).toMatch(/\.head \{[^}]*width: 30%/);
  });

  it("PT-4: its favicon is ONE flat colour — a 32 × 32 PNG whose every pixel is the icon's hue — served as an image and counted; /page names it, /next names none", async () => {
    const png = fixtureIcon();
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR: 32 × 32, 8 bits a channel, RGBA
    expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]]).toEqual([32, 32, 8, 6]);
    // its one IDAT, inflated: 32 rows of filter 0 and 32 pixels of the hue
    const at = png.indexOf("IDAT", 0, "latin1");
    const rows = inflateSync(png.subarray(at + 4, at + 4 + png.readUInt32BE(at - 4)));
    expect(rows.length).toBe(32 * (1 + 32 * 4));
    const { r, g, b } = FIXTURE_ICON_HUE;
    for (const y of [0, 17, 31]) {
      expect(rows[y * 129]).toBe(0);
      for (const x of [0, 9, 31])
        expect([...rows.subarray(y * 129 + 1 + x * 4, y * 129 + 5 + x * 4)]).toEqual([
          r,
          g,
          b,
          255,
        ]);
    }
    expect(png.subarray(-8, -4).toString("latin1")).toBe("IEND");
    fixture = await startLiveFixture();
    expect(fixture.icons()).toBe(0);
    const served = await fetch(`${fixture.origin}/icon.png`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer()).equals(png)).toBe(true);
    expect(fixture.icons()).toBe(1);
    // no /favicon.ico: a page that names no icon has none
    expect((await fetch(`${fixture.origin}/favicon.ico`)).status).toBe(404);
    expect(fixtureHtml()).toContain('<link rel="icon" type="image/png" href="/icon.png">');
    expect(fixtureHtml("/next")).not.toContain('rel="icon"');
    expect(fixtureHtml()).toContain(`<title>${FIXTURE_TITLE}</title>`);
    // a page made for phones: it names its viewport (a phone lays a page with none out 980 px wide)
    for (const path of ["/page", "/next"] as const)
      expect(fixtureHtml(path)).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
      );
    // /legacy: the same page naming NO viewport — its own title, the same icon — served, and counted as neither
    const legacy = fixtureHtml("/legacy");
    expect(legacy).not.toContain('name="viewport"');
    expect(legacy).toContain(`<title>${FIXTURE_TITLE} — legacy</title>`);
    expect(legacy).toContain('<link rel="icon" type="image/png" href="/icon.png">');
    expect(legacy).toMatch(/\.head \{[^}]*width: 56%/);
    expect((await fetch(`${fixture.origin}/legacy`)).status).toBe(200);
    expect([fixture.served("/page"), fixture.served("/next")]).toEqual([0, 0]);
    expect(fixtureHtml("/next")).toContain(`<title>${FIXTURE_TITLE} — next</title>`);
  });

  it("PT-4: the page says how it is seen — its agent and hints, its fingers, its density, its scheme, its last pointer's type and its touches — and what it keeps: a cookie, its storage, its title", () => {
    const page = fixtureHtml();
    for (const said of [
      "ua: navigator.userAgent,",
      "platform: navigator.platform,",
      "uaData: hints(),",
      "touchPoints: navigator.maxTouchPoints,",
      "dpr: devicePixelRatio,",
      'dark: matchMedia("(prefers-color-scheme: dark)").matches,',
      "pointer,",
      "touches,",
      "cookie: document.cookie,",
      "stored: stored(),",
      "title: document.title,",
    ])
      expect(page).toContain(said);
    expect(page).toContain(
      'for (const type of ["pointerdown", "pointermove", "pointerup"])\n    addEventListener(type, (e) => { pointer = e.pointerType; }, true);',
    );
    expect(page).toContain('addEventListener("touchstart", () => { touches += 1; }');
    expect(page).toContain("navigator.userAgentData.brands.map((b) => b.brand)");
    // `?store=<v>`: kept in a cookie for the whole origin and in the page's storage
    expect(FIXTURE_COOKIE).toBe("pt4");
    expect(page).toContain(
      'document.cookie = "pt4=" + encodeURIComponent(store) + "; path=/; max-age=3600";',
    );
    expect(page).toContain('localStorage.setItem("pt4", store)');
  });

  it("PT-4: each page's latest word is kept by its ADDRESS too — two pages, two words — and the Cookie header each load came with", async () => {
    fixture = await startLiveFixture();
    expect(fixture.reportAt("/page")).toBeNull();
    expect(fixture.cookieSeen("/page?read=1")).toBeNull();
    const ask = (token: string, path: string, cookie: string): Promise<Response> =>
      fetch(
        `${fixture?.origin}/beacon?token=${token}&report=${encodeURIComponent(JSON.stringify({ path, cookie }))}`,
      );
    await ask("t1", "/page?store=v1", "pt4=v1");
    await ask("t2", "/page?read=1", "pt4=v1");
    await ask("t1", "/page?store=v1", "pt4=v1; other=1");
    expect(fixture.reportAt("/page?read=1")).toMatchObject({ token: "t2", cookie: "pt4=v1" });
    expect(fixture.reportAt("/page?store=v1")).toMatchObject({
      token: "t1",
      cookie: "pt4=v1; other=1",
    });
    expect(fixture.report()?.token).toBe("t1");
    expect(fixture.reportAt("/next")).toBeNull();
    // a load's Cookie header, by the address loaded: none, then the one it came with
    await fetch(`${fixture.origin}/page?store=v1`);
    await fetch(`${fixture.origin}/page?read=1`, { headers: { cookie: "pt4=v1" } });
    expect(fixture.cookieSeen("/page?store=v1")).toBe("");
    expect(fixture.cookieSeen("/page?read=1")).toBe("pt4=v1");
    expect(fixture.served("/page")).toBe(2);
  });
});
