import { describe, expect, it } from "vitest";
import { studioProductRendererUrl, studioRendererUrl } from "../src/studio/url";

describe("studioRendererUrl", () => {
  it.each([
    ["http://127.0.0.1:5173/", "http://127.0.0.1:5173/studio.html"],
    ["http://localhost:43123/index.html", "http://localhost:43123/studio.html"],
    ["http://[::1]:5173/", "http://[::1]:5173/studio.html"],
  ])("derives the Studio document from a loopback renderer: %s", (base, expected) => {
    expect(studioRendererUrl(base)).toBe(expected);
  });

  it.each([
    "not a url",
    "https://127.0.0.1:5173/",
    "http://example.com:5173/",
    "http://user:secret@127.0.0.1:5173/",
  ])("rejects a non-local renderer base: %s", (base) => {
    expect(() => studioRendererUrl(base)).toThrow(/Studio renderer base/);
  });

  it("derives the Studio-capable product document from the same origin", () => {
    expect(studioProductRendererUrl("http://127.0.0.1:5173/")).toBe(
      "http://127.0.0.1:5173/studio-product.html",
    );
  });
});
