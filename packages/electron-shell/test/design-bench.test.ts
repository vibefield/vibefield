import { describe, expect, it } from "vitest";
import { parseUiBenchUrl } from "../src/design-bench/url";

describe("parseUiBenchUrl", () => {
  it.each([
    "http://127.0.0.1:5174/design-system.html",
    "http://localhost:5174/design-system.html?theme=dark",
    "http://[::1]:5174/design-system.html",
  ])("accepts the local design-system entry: %s", (url) => {
    expect(parseUiBenchUrl(url)).toBe(url);
  });

  it.each([
    undefined,
    "",
    "https://127.0.0.1:5174/design-system.html",
    "http://example.com/design-system.html",
    "http://127.0.0.1:5174/",
    "http://user:secret@127.0.0.1:5174/design-system.html",
  ])("rejects a non-bench renderer URL: %s", (url) => {
    expect(() => parseUiBenchUrl(url)).toThrow(/VIBEFIELD_UI_BENCH_URL/);
  });
});
