// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesignSystemPage } from "../src/design-system/DesignSystemPage";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  disconnect(): void {}
  observe(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve(): void {}
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(async () => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
  globalThis.IntersectionObserver = TestIntersectionObserver;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<DesignSystemPage />));
});

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function button(label: string): HTMLButtonElement {
  const match = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (match === undefined) throw new Error(`Design-system button not found: ${label}`);
  return match;
}

describe("design system page", () => {
  it("renders the complete single-page inventory", () => {
    expect(container?.querySelectorAll(".vf-ds-sidebar nav a")).toHaveLength(10);
    expect(container?.querySelectorAll(".vf-ds-section")).toHaveLength(9);
    expect(container?.textContent).toContain("The field, in one frame.");
    expect(container?.textContent).toContain("Field chrome playground");
    expect(container?.textContent).toContain("Godview stage");
    expect(container?.textContent).toContain("The interface, accounted for");
  });

  it("exposes theme and representative component-state controls", async () => {
    await act(async () => button("Switch to dark mode").click());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("vf-dark")).toBe("true");

    const filePill = container?.querySelector<HTMLElement>("[data-file-pill]");
    expect(filePill?.dataset.filePillOpen).toBe("false");
    await act(async () =>
      filePill?.querySelector<HTMLButtonElement>('[title="Browse fields"]')?.click(),
    );
    expect(filePill?.dataset.filePillOpen).toBe("true");

    await act(async () => button("Accept").click());
    expect(container?.querySelector(".vf-ds-living-card")?.getAttribute("data-state")).toBe(
      "accept",
    );

    expect(container?.querySelector(".vf-godview .vf-monitor-list")).not.toBeNull();
    expect(container?.querySelector(".vf-artifact-panel")).not.toBeNull();
    expect(container?.querySelector(".vf-command-palette")).not.toBeNull();
    expect(container?.querySelector(".vf-loading-veil")).not.toBeNull();
    expect(container?.querySelector(".vf-navigation-breadcrumbs__trail")).not.toBeNull();
    expect(container?.querySelector(".vf-settings-dialog")).not.toBeNull();
    expect(container?.querySelector(".vf-widget-tray")).not.toBeNull();
    expect(container?.querySelector(".vf-wizard-pane")).not.toBeNull();
    expect(container?.querySelector(".vf-zoom-pill")).not.toBeNull();
    expect(container?.textContent).toContain("No artifacts yet");

    await act(async () => {
      button("populated").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("VibeField docs");
  });
});
