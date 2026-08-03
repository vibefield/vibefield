// @vitest-environment happy-dom

import type { PluginSurfaceProps } from "@vibefield/plugin-sdk";
import { act, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidePanelStage, SidePanelToggle } from "../src/hud/SidePanelStage";
import {
  getSurfacesSnapshot,
  register,
  type SurfaceEntry,
} from "../src/plugin-host/surface-registry";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const disposeEntries: Array<() => void> = [];

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  for (const dispose of disposeEntries.splice(0).reverse()) dispose();
  vi.useRealTimers();
});

function Surface(props: PluginSurfaceProps): ReactElement {
  return (
    <button
      type="button"
      onClick={props.slot === "hud.side-panel" ? props.requestClose : undefined}
    >
      Plugin panel content
    </button>
  );
}

function bind(pluginId = "vibefield.test-panel"): SurfaceEntry {
  const surfaceId = `${pluginId}.artifacts`;
  const disposable = register(pluginId, surfaceId, "hud.side-panel", Surface, 100, "Artifacts");
  disposeEntries.push(() => disposable.dispose());
  const entry = getSurfacesSnapshot().find((candidate) => candidate.surfaceId === surfaceId);
  if (entry === undefined) throw new Error("test side panel did not bind");
  return entry;
}

function mount(node: ReactElement): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
}

describe("hud.side-panel host stage", () => {
  it("uses one persistent round toggle with matching active labels", () => {
    const entry = bind();
    const onToggle = vi.fn();
    const buttonRef = createRef<HTMLButtonElement>();
    mount(
      <SidePanelToggle entry={entry} active={false} buttonRef={buttonRef} onToggle={onToggle} />,
    );
    const button = container?.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Open Artifacts");
    expect(button?.getAttribute("aria-pressed")).toBe("false");
    expect(buttonRef.current).toBe(button);
    act(() => button?.click());
    expect(onToggle).toHaveBeenCalledTimes(1);

    act(() =>
      root?.render(
        <SidePanelToggle entry={entry} active buttonRef={buttonRef} onToggle={onToggle} />,
      ),
    );
    expect(button?.getAttribute("aria-label")).toBe("Close Artifacts");
    expect(button?.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the same content mounted through travel-out and honors plugin close", async () => {
    vi.useFakeTimers();
    const entry = bind();
    const onClose = vi.fn();
    mount(<SidePanelStage entry={entry} windowId="field" onClose={onClose} />);
    const panel = container?.querySelector("aside");
    expect(panel?.dataset.open).toBe("true");
    expect(panel?.getAttribute("aria-hidden")).toBe("false");
    expect(container?.textContent).toContain("Plugin panel content");
    act(() => container?.querySelector("button")?.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => root?.render(<SidePanelStage entry={null} windowId="field" onClose={onClose} />));
    expect(panel?.dataset.open).toBe("false");
    expect(panel?.getAttribute("aria-hidden")).toBe("true");
    expect(panel?.inert).toBe(true);
    expect(container?.textContent).toContain("Plugin panel content");
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(container?.textContent).not.toContain("Plugin panel content");
  });

  it("refuses a second v1 side-panel contribution until the first unbinds", () => {
    bind("vibefield.first-panel");
    expect(() =>
      register(
        "vibefield.second-panel",
        "vibefield.second-panel.artifacts",
        "hud.side-panel",
        Surface,
      ),
    ).toThrow(/already has its one v1 contribution/);
  });
});
