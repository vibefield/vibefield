import { describe, expect, it } from "vitest";
import {
  bandLayout,
  cutOf,
  DEVICES,
  deviceForProps,
  drawHead,
  type HeadContext,
  headKey,
  headStateOf,
  PANE_TOOLS,
  resolveAddress,
  shapeOf,
} from "../src";

describe("browser chrome", () => {
  it.each([
    ["example.test:8080/path?q=1#part", "https://example.test:8080/path?q=1#part"],
    ["localhost:3000/a?x=1", "http://localhost:3000/a?x=1"],
    ["127.0.0.1:5000", "http://127.0.0.1:5000"],
    ["[::1]:3000/a", "http://[::1]:3000/a"],
    ["192.168.1.2:8080", "http://192.168.1.2:8080"],
    ["例子.测试/path", "https://例子.测试/path"],
    ["  https://example.test/\npath  ", "https://example.test/path"],
  ])("resolves %s like an address bar", (typed, expected) =>
    expect(resolveAddress(typed)).toBe(expected),
  );

  it.each(["two words", "web performance?"])("preserves the search query %s", (query) => {
    const search = new URL(resolveAddress(query));
    expect(search.protocol).toBe("https:");
    expect(search.searchParams.get("q")).toBe(query);
  });

  it("keeps navigation keys available without duplicating their buttons in the object menu", () => {
    expect(PANE_TOOLS.filter((t) => t.bar !== false).map((t) => t.id)).toEqual(["device", "sound"]);
    for (const id of ["back", "forward", "reload", "address"])
      expect(PANE_TOOLS.find((t) => t.id === id)?.keys?.length).toBeGreaterThan(0);
  });

  it("draws a passive address without a capsule or navigation, and uses separate cached rasters when opened or hovered", () => {
    const shape = shapeOf(cutOf());
    const calls: { name: string; args: unknown[] }[] = [];
    const state: Record<string, unknown> = {};
    const ctx = new Proxy(state, {
      get: (target, name: string) =>
        name in target
          ? target[name]
          : name === "measureText"
            ? (t: string) => ({ width: t.length * 2 })
            : (...args: unknown[]) => calls.push({ name, args }),
      set: (target, name: string, value) => {
        target[name] = value;
        return true;
      },
    }) as unknown as HeadContext;
    const rest = headStateOf("http://example.com", shape);
    drawHead({ width: 0, height: 0 }, ctx, shape, rest, 2, null);
    expect(calls.some((c) => c.name === "roundRect" || c.name === "stroke")).toBe(false);
    expect(calls.some((c) => c.name === "fillText" && c.args[0] === "example.com")).toBe(true);
    const active = { ...rest, interactive: true as const };
    expect(headKey(shape, active, 2)).not.toBe(headKey(shape, rest, 2));
    calls.length = 0;
    drawHead({ width: 0, height: 0 }, ctx, shape, active, 2, null);
    expect(calls.some((c) => c.name === "roundRect")).toBe(true);
    const hover = { ...rest, hint: true as const };
    calls.length = 0;
    drawHead({ width: 0, height: 0 }, ctx, shape, hover, 2, null);
    expect(calls.some((c) => c.name === "fillText" && c.args[0] === "Double-click to browse")).toBe(
      true,
    );
    expect(headKey(shape, hover, 2)).not.toBe(headKey(shape, rest, 2));
  });

  it("keeps back, forward, reload, and address hit areas separate at every preset size", () => {
    for (const d of DEVICES) {
      const L = bandLayout(shapeOf(cutOf(d), d));
      expect(L.back).not.toBeNull();
      expect(L.forward).not.toBeNull();
      expect(L.reload).not.toBeNull();
      expect(L.forward![0] + L.glyph * 0.62).toBeLessThan(L.address[0] - L.address[2]);
      expect(L.address[2] * 2).toBeGreaterThan(L.glyph * 3);
    }
  });

  it("applies custom DPR, input and UA without changing physical density or leaking preset client hints", () => {
    const base = deviceForProps({ device: "phone" });
    const custom = deviceForProps({
      device: "phone",
      deviceScaleFactor: 1,
      inputMode: "desktop",
      userAgentMode: "custom",
      userAgent: "ExampleBrowser/1",
      navigatorPlatform: "Win32",
    });
    expect(custom.density).toBe(base.density);
    expect([custom.dpr, custom.mobile, custom.touch]).toEqual([1, false, false]);
    expect(custom.agent).toEqual({
      userAgent: "ExampleBrowser/1",
      navigatorPlatform: "Win32",
      platform: "",
      platformVersion: "",
      model: "",
    });
    expect(deviceForProps({ device: "phone", userAgentMode: "browser" }).agent).toBeNull();
    expect(deviceForProps({ device: "phone", deviceScaleFactor: NaN }).dpr).toBe(base.dpr);
  });
});
