// @vitest-environment happy-dom

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { PluginStyleBoundary } from "../src/plugin-host/PluginStyleBoundary";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// DK-8: these rows drove the boundary through `withPluginFace`/`withBuiltInFace` (faces.tsx), the
// host's wrapper for a widget's React face — retired with `contributes.widgets` (no plugin component
// mounts under the camera since DK-2). The boundary itself stays: a plugin's HUD SURFACE renders
// inside it (hud/PluginSurfaceSlot.tsx).

function Panel(): ReactElement {
  return <span className="flex">plugin surface</span>;
}

describe("host plugin CSS boundary", () => {
  it("wraps a plugin's DOM in its exact plugin scope without adding layout", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <PluginStyleBoundary pluginId="com.example.weather">
          <Panel />
        </PluginStyleBoundary>,
      ),
    );

    const boundary = host.querySelector<HTMLElement>('[data-vf-plugin="com.example.weather"]');
    expect(boundary).not.toBeNull();
    expect(boundary?.style.display).toBe("contents");
    expect(boundary?.querySelector(".flex")?.textContent).toBe("plugin surface");

    await act(async () => root.unmount());
  });
});
