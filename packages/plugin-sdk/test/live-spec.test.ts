// PT-2 — THE PAGE A BROWSER FACE OPENS: the `spec` a browser kind hands the host's `LIVE` service, typed on the `/desk` door so
// the plugin and the host read one shape (ICE design-019 §3.2 — the host's contract, never the desk's). The host refuses what it
// cannot read rather than guessing at it.
import { describe, expect, it } from "vitest";
import { type LiveBrowserSpec, liveBrowserSpec } from "../src/desk";

const PAGE: LiveBrowserSpec = {
  source: "browser",
  url: "https://lumen.example/",
  viewport: [1280, 800],
  scheme: "light",
  label: "Browser",
};

describe("liveBrowserSpec — the host reads a browser face's page", () => {
  it("reads the page a browser kind sends, whole", () => {
    expect(liveBrowserSpec({ ...PAGE })).toEqual(PAGE);
    expect(liveBrowserSpec({ ...PAGE, viewport: [402, 874], scheme: "dark" })).toEqual({
      ...PAGE,
      viewport: [402, 874],
      scheme: "dark",
    });
  });

  it("refuses a spec that is not a browser page, or a field it cannot read", () => {
    expect(liveBrowserSpec({ ...PAGE, source: "capture" })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, url: "" })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, url: 42 })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, viewport: [1280] })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, viewport: [1280.5, 800] })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, viewport: [0, 800] })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, viewport: [1280, 40_000] })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, scheme: "desk" })).toBeUndefined();
    expect(liveBrowserSpec({ ...PAGE, label: undefined })).toBeUndefined();
    expect(liveBrowserSpec({})).toBeUndefined();
  });

  it("reads only the fields it names — a spec's extra words never ride along", () => {
    expect(liveBrowserSpec({ ...PAGE, token: "a ticket" })).toEqual(PAGE);
  });
});
