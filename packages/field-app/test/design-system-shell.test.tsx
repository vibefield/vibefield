// @vitest-environment happy-dom

// ITEM 213 (2) (2026-11-07; the plan lanes/item213/plan-2/plan.md, ruled by VF-PM at 13:16:40Z): the Studio's two
// rows, over the SHIPPING DesignSystemPage with its twelve other sections stubbed. design-system.test.tsx rendered
// the whole catalog for them, and on a loaded CI runner that render held the worker 20–111 s a row (item 213). These
// rows read only the Overview (its Studio toolbar) and the page's own effects: the studio state it subscribes to, and
// the section a studio asks for, scrolled into view. So the page runs for real, and every other section is a bare
// `<section>` with only the id the page's effects look up — never a copy of a section's markup, classes, words or CSS
// (docs/UI_SYSTEM.md, Catalog fidelity). ui-system-boundaries.test.ts reads the contents of src/ files only (it lists
// test/ but never reads a test file), so it cannot see a stub here, and the last row holds them bare.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProductAppearance } from "../src/appearance/product-appearance";
import { DesignSystemPage } from "../src/design-system/DesignSystemPage";
import type {
  DesignSystemStudioController,
  DesignSystemStudioState,
} from "../src/design-system/studio-controller";

// A stub section: the id its own `<Section>` carries (the page's NAV_ITEMS id), and nothing else.
const { stub } = vi.hoisted(() => ({
  stub: (name: string, id: string) => async () => {
    const { createElement } = await import("react");
    return { [name]: () => createElement("section", { id }) };
  },
}));
vi.mock(
  "../src/design-system/sections/FoundationsSection",
  stub("FoundationsSection", "foundations"),
);
vi.mock("../src/design-system/sections/GlyphsSection", stub("GlyphsSection", "glyphs"));
vi.mock(
  "../src/design-system/sections/CanvasGroundSection",
  stub("CanvasGroundSection", "canvas-ground"),
);
vi.mock("../src/design-system/sections/ControlsSection", stub("ControlsSection", "controls"));
vi.mock("../src/design-system/sections/StatusSection", stub("StatusSection", "status"));
vi.mock("../src/design-system/sections/ChromeSection", stub("ChromeSection", "chrome"));
vi.mock("../src/design-system/sections/SurfacesSection", stub("SurfacesSection", "surfaces"));
vi.mock(
  "../src/design-system/sections/LiveSurfacesSection",
  stub("LiveSurfacesSection", "live-surfaces"),
);
vi.mock("../src/design-system/sections/OnboardingSection", stub("OnboardingSection", "onboarding"));
vi.mock("../src/design-system/sections/GodviewSection", stub("GodviewSection", "godview"));
vi.mock("../src/design-system/sections/HistorySection", stub("HistorySection", "history"));
vi.mock("../src/design-system/sections/InventorySection", stub("InventorySection", "inventory"));

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

// The page's budget (design-system.test.tsx's PAGE_BUDGET_MS), kept: stubbed, the page renders in a moment, but a
// row on a loaded CI runner is item 202's class, and a budget asserts nothing.
const PAGE_BUDGET_MS = 120_000;

beforeEach(async () => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
  globalThis.IntersectionObserver = TestIntersectionObserver;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<DesignSystemPage />));
}, PAGE_BUDGET_MS);

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
}, PAGE_BUDGET_MS);

function button(label: string): HTMLButtonElement {
  const match = Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (match === undefined) throw new Error(`Design-system button not found: ${label}`);
  return match;
}

describe("design system page", { timeout: PAGE_BUDGET_MS }, () => {
  it("exposes explicit Studio live and product-focus controls only when hosted", async () => {
    const state: DesignSystemStudioState = {
      appearance: defaultProductAppearance(),
      live: false,
      productConnection: "connected",
      productContext: { theme: "dark", zoom: 1.25 },
      transportError: null,
      requestedSection: null,
      navigationRevision: 0,
      revision: null,
      appliedRevision: null,
      rejection: null,
    };
    const setLive = vi.fn();
    const focusProduct = vi.fn();
    const studio: DesignSystemStudioController = {
      snapshot: () => state,
      subscribe: () => () => undefined,
      setAppearance: vi.fn(),
      setLive,
      focusProduct,
    };
    await act(async () => root?.render(<DesignSystemPage studio={studio} />));

    expect(container?.textContent).toContain("VibeField Studio · Design System");
    expect(container?.textContent).toContain("Local changes");
    expect(container?.textContent).toContain("Connected");
    expect(container?.textContent).toContain("Dark · 125%");
    await act(async () => button("Go live").click());
    await act(async () => button("Bring App Forward").click());
    expect(setLive).toHaveBeenCalledWith(true);
    expect(focusProduct).toHaveBeenCalledOnce();
  });

  it("reports catalog-only, reconnecting, protocol-error, and navigation states honestly", async () => {
    expect(container?.textContent).toContain("Catalog-only browser mode");
    const state: DesignSystemStudioState = {
      appearance: defaultProductAppearance(),
      live: true,
      productConnection: "reconnecting",
      productContext: null,
      transportError: null,
      requestedSection: "appearance",
      navigationRevision: 1,
      revision: 4,
      appliedRevision: null,
      rejection: null,
    };
    const studio: DesignSystemStudioController = {
      snapshot: () => state,
      subscribe: () => () => undefined,
      setAppearance: vi.fn(),
      setLive: vi.fn(),
      focusProduct: vi.fn(),
    };
    await act(async () => root?.render(<DesignSystemPage studio={studio} />));
    expect(container?.textContent).toContain("Reconnecting");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

    state.transportError = "version-mismatch";
    await act(async () => root?.render(<DesignSystemPage studio={studio} />));
    expect(container?.textContent).toContain("Studio disconnected");
    expect(container?.textContent).toContain("different preview protocol versions");
  });

  it("stubs every section but the Overview bare — a section with its id alone, no child (item 213 (2))", () => {
    const sections = Array.from(container?.querySelectorAll("main > section") ?? []);
    expect(sections.map((section) => section.id)).toEqual([
      "foundations",
      "glyphs",
      "canvas-ground",
      "controls",
      "status",
      "chrome",
      "surfaces",
      "live-surfaces",
      "onboarding",
      "godview",
      "history",
      "inventory",
    ]);
    for (const section of sections) {
      expect(section.getAttributeNames(), section.id).toEqual(["id"]);
      expect(section.childNodes.length, section.id).toBe(0);
    }
    expect(container?.querySelector("main > header#overview")?.childNodes.length).toBeGreaterThan(
      0,
    );
  });
});
