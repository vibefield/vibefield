// @vitest-environment happy-dom

import { stateStages } from "@vibecook/puppeteer-views";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProductAppearance } from "../src/appearance/product-appearance";
import { DesignSystemPage } from "../src/design-system/DesignSystemPage";
import type {
  DesignSystemStudioController,
  DesignSystemStudioState,
} from "../src/design-system/studio-controller";

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
  HTMLElement.prototype.scrollIntoView = vi.fn();
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

  it("renders the complete single-page inventory", () => {
    const links = container!.querySelectorAll<HTMLAnchorElement>(".vf-ds-sidebar nav a");
    expect(links.length).toBeGreaterThanOrEqual(12);
    for (const link of links) {
      expect(
        container?.querySelector(link.hash),
        `Missing section for ${link.textContent}`,
      ).not.toBeNull();
    }
    expect(container?.querySelector('#living-mark a[href="./logo-studio.html"]')).not.toBeNull();
    expect(container?.textContent).toContain("The field, in one frame.");
    expect(container?.textContent).toContain("The actual field, under glass");
    expect(container?.textContent).toContain("Infinite canvas and visual tuning workbench");
    expect(container?.textContent).toContain("Field chrome playground");
    expect(container?.textContent).toContain("Godview stage");
    expect(container?.textContent).toContain(
      "Swarm bodies — every drawn state, on the package's own fixtures",
    );
    expect(container?.textContent).toContain("The interface, accounted for");
    // DESIGN.md §13: the glyph section mounts the shipping set from the kit leaf, all 49.
    expect(container?.querySelectorAll("#glyphs .vf-ds-glyph")).toHaveLength(49);
    // One Frame FR-1: the view frame on fixtures — the shipping track and cover
    // over a field, and a plate per state the page's Chrome & Composer plates
    // show for the frame (the last the keys as Windows prints them).
    expect(container?.querySelector(".vf-ds-frame-stage .vf-views-line")).not.toBeNull();
    expect(container?.querySelector(".vf-ds-frame-stage .vf-cover")).not.toBeNull();
    expect(
      [...(container?.querySelectorAll(".vf-ds-views-plate") ?? [])].map((plate) =>
        plate.getAttribute("data-state"),
      ),
    ).toEqual(["rest", "cmd", "gv", "hx", "note", "rest"]);
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
    ).toHaveLength(12);

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
    // The swarm's bodies (AR-5): the views package's own fixtures on the
    // SHIPPING view. A happy-dom window has no WebGPU, so the section says so
    // — the same honest line the product draws — while every body stays
    // reachable as a button, and the buttons between them name every drawn
    // state the design record has.
    const bodies = container?.querySelector<HTMLElement>("[data-swarm-bodies-catalog]");
    expect(bodies?.querySelector(".vf-monitor-swarm")?.getAttribute("data-swarm-renderer")).toBe(
      "unavailable",
    );
    expect(bodies?.textContent).toContain("WEBGPU UNAVAILABLE");
    const bodyButtons = Array.from(bodies?.querySelectorAll(".vf-monitor-swarm-list button") ?? []);
    expect(bodyButtons).toHaveLength(stateStages(0).length);
    expect(
      new Set(bodyButtons.map((body) => body.getAttribute("data-agent-bubble-visual"))),
    ).toEqual(new Set(["terminal-empty", "terminal-running", "idle", "working", "blocked"]));
    expect(container?.querySelector(".vf-artifact-panel")).not.toBeNull();
    expect(container?.querySelector(".vf-command-palette")).not.toBeNull();
    expect(container?.querySelector(".vf-loading-veil")).not.toBeNull();
    expect(container?.querySelector(".vf-navigation-breadcrumbs__trail")).not.toBeNull();
    expect(container?.querySelector(".vf-settings-dialog")).not.toBeNull();
    expect(container?.querySelector(".vf-widget-tray")).not.toBeNull();
    expect(container?.querySelectorAll("[data-onboarding-preview]")).toHaveLength(12);
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
      "users",
      "ready-failed",
      "finishing-failed",
    ]) {
      expect(container?.querySelector(`[data-onboarding-preview="${state}"]`)).not.toBeNull();
    }
    expect(container?.querySelectorAll(".vf-wizard-shell")).toHaveLength(12);
    expect(container?.querySelector(".vf-zoom-pill")).not.toBeNull();
    expect(container?.querySelector("[data-ground-workbench]")).not.toBeNull();
    expect(container?.querySelector("[data-visual-tweak-controls]")).not.toBeNull();
    // the chrome playground's, the workbench's, and the view frame's stage (FR-1)
    expect(container?.querySelectorAll('[data-ground-renderer="unavailable"]')).toHaveLength(3);
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

    // UA-P-0g — the lab reaches the refusals and the act itself, through the
    // production derivation: the adapter hands `linkFace` a wire snapshot, so a
    // posture the catalog can show is one the shipping surfaces can show.
    await choose("connect", "already linked");
    expect(frame("connect").textContent).toContain('the local user "Work" is already linked');
    await choose("connect", "offline");
    expect(frame("connect").textContent).toContain("Not linked yet");
    await choose("connect", "Link Tailscale account");
    expect(frame("connect").textContent).toContain("Linking…");

    await choose("posture", "unavailable");
    expect(frame("posture").textContent).toContain("This daemon is not reporting preferences");
  });

  it("mounts the spawn bloom on the shipping monitor with its fixture door, and a create lands as a new terminal (SB-3)", async () => {
    const bloom = container?.querySelector<HTMLElement>("[data-spawn-bloom-catalog]");
    if (!bloom) throw new Error("Spawn bloom catalog not found");
    // The SHIPPING swarm view: happy-dom has no WebGPU, so it draws its honest
    // line and its keyboard list — the fixture's three agents — and the profile
    // tabs the fixture's managed profiles call for.
    expect(bloom.querySelector(".vf-monitor-swarm")?.getAttribute("data-swarm-renderer")).toBe(
      "unavailable",
    );
    expect(
      bloom.querySelectorAll(".vf-monitor-swarm-list li button:not([data-swarm-new-terminal])"),
    ).toHaveLength(3);
    expect(bloom.querySelector('[data-profile-tab="work"]')).not.toBeNull();
    expect(bloom.querySelector('[data-profile-tab="demo"]')).not.toBeNull();

    // The hidden list's keys door is there, beside the bodies.
    expect(bloom.querySelector("[data-swarm-new-terminal]")).not.toBeNull();

    // The list view: its ＋ opens the same tree as a two-step menu (SB-D11), in
    // the bloom's order (the feed's) with the keys landing on the default;
    // choosing Work asks the fixture door, which answers `mounted` under it,
    // and the catalog keeps the birth as a deck would — a new terminal row.
    const list = container?.querySelector<HTMLElement>("[data-spawn-bloom-list-catalog]");
    if (!list) throw new Error("Spawn bloom list catalog not found");
    const before = list.querySelectorAll(".vf-monitor-list-row").length;
    await act(async () => list.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click());
    const menu = list.querySelector('[role="menu"][aria-label="New terminal"]');
    expect(
      Array.from(menu?.querySelectorAll('[data-bloom-bud-kind="profile"]') ?? []).map((item) =>
        item.getAttribute("data-bloom-bud-id"),
      ),
    ).toEqual(["native", "work", "demo"]);
    expect(document.activeElement?.getAttribute("data-bloom-bud-id")).toBe("work");
    await act(async () => menu?.querySelector<HTMLElement>('[data-bloom-bud-id="work"]')?.click());
    expect(list.querySelectorAll(".vf-monitor-list-row")).toHaveLength(before + 1);
    expect(list.querySelector(".vf-monitor-ack")?.textContent).toBe(
      "terminal opened under Work in the active pane",
    );
  });

  it("shows the launcher of a pane born under a profile — New · Under Work, and an agent with no sign-in (SB-3)", () => {
    const captions = Array.from(container?.querySelectorAll(".vf-pane-launcher-cap-under") ?? []);
    // two specimens, each in the light and the dark deck
    expect(captions).toHaveLength(4);
    for (const caption of captions) expect(caption.textContent).toContain("Under Work");
    expect(
      captions[0]?.parentElement?.parentElement?.querySelector('[data-profile-glyph="briefcase"]'),
    ).not.toBeNull();
    expect(
      container?.querySelector('.vf-pane-launcher-agent.is-off[title$="· no sign-in"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("can’t launch: no sign-in");
  });

  it("keeps the swarm's state matrix live and inspectable", async () => {
    const catalog = container?.querySelector<HTMLElement>("[data-swarm-bodies-catalog]");
    if (!catalog) throw new Error("Swarm bodies catalog not found");

    expect(catalog.getAttribute("data-swarm-bodies-theme")).toBe("light");
    expect(catalog.classList.contains("theme-light")).toBe(true);
    await act(async () => button("DARK THEME").click());
    expect(catalog.getAttribute("data-swarm-bodies-theme")).toBe("dark");
    expect(catalog.classList.contains("theme-dark")).toBe(true);

    await act(async () => button("PAUSE MOTION").click());
    expect(catalog.getAttribute("data-godview-animations")).toBe("off");
    expect(button("REPLAY ARRIVALS").disabled).toBe(true);

    // Selecting a body is the host's verb (`actions.select`); the catalog's
    // adapter answers it the way a deck would, by making the row current.
    const first = catalog.querySelector<HTMLButtonElement>(".vf-monitor-swarm-list button");
    expect(first?.getAttribute("aria-current")).toBeNull();
    await act(async () => first?.click());
    expect(first?.getAttribute("aria-current")).toBe("true");
  });
});
