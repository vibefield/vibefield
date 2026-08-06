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
    expect(container?.textContent).toContain("Agent circle anatomy and complete state inventory");
    expect(container?.textContent).toContain("The interface, accounted for");
  });

  it("exposes theme and representative component-state controls", async () => {
    const themeToggle = container?.querySelector<HTMLButtonElement>(".vf-ds-theme-toggle");
    expect(themeToggle?.getAttribute("aria-label")).toBe("Switch to dark mode");
    await act(async () => themeToggle?.click());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("vf-dark")).toBe("true");
    expect(
      container?.querySelectorAll(
        '[data-onboarding-preview] button[aria-label="Switch to light mode"]',
      ),
    ).toHaveLength(11);

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
    expect(container?.querySelectorAll("[data-agent-bubble-preview]")).toHaveLength(19);
    expect(
      container
        ?.querySelector('[data-agent-bubble-preview="agent-ready"] [data-agent-bubble-status]')
        ?.getAttribute("data-agent-bubble-visual"),
    ).toBe("working");
    expect(
      container
        ?.querySelector('[data-agent-bubble-preview="agent-working"] [data-agent-bubble-status]')
        ?.getAttribute("data-agent-bubble-visual"),
    ).toBe("ignited");
    expect(
      container
        ?.querySelector(
          '[data-agent-bubble-preview="remote-not-shared"] [data-agent-bubble-status]',
        )
        ?.getAttribute("data-agent-bubble-source"),
    ).toBe("remote");
    expect(container?.querySelector(".vf-artifact-panel")).not.toBeNull();
    expect(container?.querySelector(".vf-command-palette")).not.toBeNull();
    expect(container?.querySelector(".vf-loading-veil")).not.toBeNull();
    expect(container?.querySelector(".vf-navigation-breadcrumbs__trail")).not.toBeNull();
    expect(container?.querySelector(".vf-settings-dialog")).not.toBeNull();
    expect(container?.querySelector(".vf-widget-tray")).not.toBeNull();
    expect(container?.querySelectorAll("[data-onboarding-preview]")).toHaveLength(11);
    for (const state of [
      "welcome",
      "field",
      "setting-up",
      "connect",
      "posture",
      "ready",
      "deriving",
      "welcome-back",
      "finishing",
      "ready-failed",
      "finishing-failed",
    ]) {
      expect(container?.querySelector(`[data-onboarding-preview="${state}"]`)).not.toBeNull();
    }
    expect(container?.querySelectorAll(".vf-wizard-shell")).toHaveLength(11);
    expect(container?.querySelector(".vf-zoom-pill")).not.toBeNull();
    expect(container?.textContent).toContain("No artifacts yet");

    await act(async () => {
      button("populated").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("VibeField docs");
  });

  it("keeps every onboarding state lab interactive", async () => {
    const frame = (state: string): HTMLElement => {
      const match = container?.querySelector<HTMLElement>(`[data-onboarding-preview="${state}"]`);
      if (match === null || match === undefined) {
        throw new Error(`Onboarding preview not found: ${state}`);
      }
      return match;
    };
    const choose = async (state: string, label: string): Promise<void> => {
      const match = Array.from(frame(state).querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === label,
      );
      if (match === undefined) throw new Error(`Onboarding state control not found: ${label}`);
      await act(async () => match.click());
    };

    await choose("field", "error");
    expect(frame("field").textContent).toContain("The profile service refused this write.");

    await choose("connect", "linked");
    expect(frame("connect").textContent).toContain("Linked as james@example.com");

    await choose("posture", "unavailable");
    expect(frame("posture").textContent).toContain("This daemon is not reporting preferences");
  });

  it("keeps the agent-circle state matrix live and inspectable", async () => {
    const catalog = container?.querySelector<HTMLElement>("[data-agent-bubble-catalog]");
    if (!catalog) throw new Error("Agent bubble catalog not found");

    expect(catalog.getAttribute("data-agent-bubble-theme")).toBe("light");
    await act(async () => button("DARK THEME").click());
    expect(catalog.getAttribute("data-agent-bubble-theme")).toBe("dark");

    await act(async () => button("PAUSE MOTION").click());
    expect(catalog.getAttribute("data-godview-animations")).toBe("off");
    expect(button("REPLAY ARRIVALS").disabled).toBe(true);

    const terminal = catalog.querySelector<HTMLButtonElement>(
      '[data-agent-bubble-preview="terminal-idle"] .vf-monitor-bubble',
    );
    await act(async () => terminal?.click());
    expect(terminal?.getAttribute("aria-current")).toBe("true");
    expect(terminal?.classList.contains("is-active")).toBe(true);
  });
});
