/**
 * PT-2 — the smoke's fixture pages (testing/live-fixture.ts): served on 127.0.0.1, the still page in the fixture's known hue with
 * its memory's beacon, the playing page's crossing bar; loads and tokens counted for the RELOAD row's same-page proof.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
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

describe("the live pane's fixture pages", () => {
  it("serves the still and the playing page on loopback, each counted per load", async () => {
    fixture = await startLiveFixture();
    expect(fixture.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const still = await fetch(fixture.url("still"));
    expect(still.status).toBe(200);
    const html = await still.text();
    expect(html).toContain("#1d6fd8");
    expect(html).not.toContain("runner");
    expect(await (await fetch(fixture.url("play"))).text()).toContain("runner");
    expect(fixture.loads("still")).toBe(1);
    expect(fixture.loads("play")).toBe(1);
    expect((await fetch(`${fixture.origin}/elsewhere`)).status).toBe(404);
  });

  it("keeps each page's memory tokens in order, once each — one page, one token", async () => {
    fixture = await startLiveFixture();
    for (const token of ["a1", "a1", "b2"])
      expect((await fetch(`${fixture.origin}/beacon?page=still&token=${token}`)).status).toBe(204);
    await fetch(`${fixture.origin}/beacon?page=play&token=c3`);
    await fetch(`${fixture.origin}/beacon?page=other&token=d4`);
    expect(fixture.tokens("still")).toEqual(["a1", "b2"]);
    expect(fixture.tokens("play")).toEqual(["c3"]);
  });

  it("paints its ground in the known hue, a white headline and bars; only the playing page moves", () => {
    expect(FIXTURE_HUE).toEqual({ r: 29, g: 111, b: 216 });
    expect(fixtureHtml("still")).toMatch(/background: #1d6fd8/);
    expect(fixtureHtml("still")).not.toMatch(/setInterval\(\(\) => \{ x =/);
    expect(fixtureHtml("play")).toMatch(/setInterval\(\(\) => \{ x =/);
  });
});
