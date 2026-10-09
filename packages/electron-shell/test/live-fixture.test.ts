/**
 * PT-2 — the smoke's fixture page (testing/live-fixture.ts): served on 127.0.0.1 in the fixture's known hue, its pace the
 * smoke's (the beacon's answer), its memory's token counted once — the RELOAD row's same-page proof.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  FIXTURE_ASK_MS,
  FIXTURE_HUE,
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
});
