// @vitest-environment happy-dom

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { withBuiltInFace, withPluginFace } from "../src/plugin-host/faces";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Card(): ReactElement {
  return <span className="flex">plugin face</span>;
}

describe("host plugin CSS boundary", () => {
  it("wraps a DOM plugin face in its exact plugin scope without adding layout", async () => {
    const Face = withPluginFace({
      pluginId: "com.example.weather",
      pluginTitle: "Weather",
      type: "com.example.weather.card",
      surface: "dom",
      component: Card,
    });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<Face />));

    const boundary = host.querySelector<HTMLElement>('[data-vf-plugin="com.example.weather"]');
    expect(boundary).not.toBeNull();
    expect(boundary?.style.display).toBe("contents");
    expect(boundary?.querySelector(".flex")?.textContent).toBe("plugin face");

    await act(async () => root.unmount());
  });

  it("does not put host-owned built-in faces in a plugin selector tree", async () => {
    const Face = withBuiltInFace({
      type: "vibefield.terminal.mirror",
      surface: "dom",
      component: Card,
    });
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<Face />));
    expect(host.querySelector("[data-vf-plugin]")).toBeNull();
    await act(async () => root.unmount());
  });
});
