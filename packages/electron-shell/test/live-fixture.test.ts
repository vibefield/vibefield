/**
 * PT-2 — the smoke's fixture page (testing/live-fixture.ts): served on 127.0.0.1 in the fixture's known hue, its pace the
 * smoke's (the beacon's answer), its memory's token counted once — the RELOAD row's same-page proof. PT-3 — the page in use:
 * its link to `/next`, its field, its word, its height past its view, and its report of what it saw, the latest kept.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  FIXTURE_ASK_MS,
  FIXTURE_HUE,
  FIXTURE_PARTS,
  fixtureHtml,
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
});
