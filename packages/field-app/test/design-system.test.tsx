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

// A PAGE-SCALE BUDGET (DK-11, measured): every test here renders the WHOLE catalog page in its beforeEach, then re-renders
// or queries it whole. Alone that render takes 1.3–1.7 s and a test's body at most 0.9 s; inside the full `pnpm test` on a
// shared machine (load 111–310, 2026-10-05) the render took up to 31.5 s (mean 7–8 s) and a body up to 5.0 s — past
// vitest's 10 s hook and 5 s test defaults, so every gate failed here. 60 s gives the worst render measured about twice
// its time; a render that hangs still fails. The suite's other page-scale files budget 30–60 s (doc-manager, and
// history-search until the Peek retired it, 2026-10-08).
const PAGE_BUDGET_MS = 60_000;

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
  // Rendering the whole catalog takes seconds alone and passes vitest's 10 s hook default
  // under a loaded gate (2026-10-08: red in most loaded gates since 10-07).
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

  it("renders the complete single-page inventory", () => {
    const links = container!.querySelectorAll<HTMLAnchorElement>(".vf-ds-sidebar nav a");
    expect(links.length).toBeGreaterThanOrEqual(12);
    for (const link of links) {
      expect(
        container?.querySelector(link.hash),
        `Missing section for ${link.textContent}`,
      ).not.toBeNull();
    }
    expect(container?.textContent).toContain("The field, in one frame.");
    expect(container?.textContent).toContain("The actual field, under glass");
    expect(container?.textContent).toContain("Infinite canvas and visual tuning workbench");
    expect(container?.textContent).toContain("Field chrome playground");
    expect(container?.textContent).toContain("Godview stage");
    expect(container?.textContent).toContain(
      "Swarm bodies — every drawn state, on the package's own fixtures",
    );
    // MV-7: spend's specimen, on the shipping view through GodviewPreview and its fixture door
    expect(container?.textContent).toContain("Spend — where the money went");
    expect(container?.querySelector("[data-godview-spend-catalog] .vf-godview")).not.toBeNull();
    expect(container?.textContent).toContain("The interface, accounted for");
    // DESIGN.md §13: the glyph section mounts the shipping set from the kit leaf, all 60.
    expect(container?.querySelectorAll("#glyphs .vf-ds-glyph")).toHaveLength(60);
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
    // One Frame FR-2: the line — live on its real controller over the frame's
    // field (the track at its left end), and a plate per state the page's §03
    // plates draw for it, the last Godview's keys as Windows prints them.
    expect(container?.querySelector(".vf-ds-frame-stage .vf-line > .vf-views-line")).not.toBeNull();
    expect(
      [...(container?.querySelectorAll(".vf-ds-line-plate") ?? [])].map(
        (plate) => `${plate.getAttribute("data-state")}:${plate.getAttribute("data-keys")}`,
      ),
    ).toEqual([
      "rest:mac",
      "typing:mac",
      "at:mac",
      "aimed:mac",
      "objects:mac",
      "held:mac",
      "gv:mac",
      "hx:mac",
      "sent:mac",
      "faces:mac",
      "sent-aimed:mac",
      "gv:other",
      "flight:null",
    ]);
    // DK-14 — Send to…: a note's chip in its paper with the @ typed and the list open; the faces by kind; the flight
    const sent = container?.querySelector('.vf-ds-line-plate[data-state="sent"]');
    expect(
      sent?.querySelector('.vf-line-chip[data-chip="desk"][data-paper]')?.textContent,
    ).toContain("Ship the desk by Friday,…");
    expect(sent?.querySelector(".vf-at-menu")).not.toBeNull();
    expect(
      [
        ...(container?.querySelectorAll(
          '.vf-ds-line-plate[data-state="faces"] .vf-line-chip[data-chip="desk"] .vf-line-chip-label',
        ) ?? []),
      ].map((el) => el.textContent),
    ).toEqual(["Clock", "2 objects", "Clock"]);
    expect(
      container?.querySelector(
        '.vf-ds-line-plate[data-state="flight"] .vf-line-flier .vf-line-chip',
      ),
    ).not.toBeNull();
    // DK-13 — the pegboard: a plate per state over a fixture tray, the shipping filters placed by the product's model
    const boardPlates = [...(container?.querySelectorAll<HTMLElement>(".vf-ds-board-plate") ?? [])];
    expect(boardPlates.map((p) => p.dataset.state)).toEqual([
      "Out — All",
      "A category chosen — Surfaces",
      "Past the band's width — the far end fading",
      "Rising — 80 % of the slide",
      "A specimen in the keyboard's focus",
    ]);
    const boardPlate = (state: string): HTMLElement | undefined =>
      boardPlates.find((p) => p.dataset.state === state);
    expect(
      [...(boardPlate("Out — All")?.querySelectorAll(".vf-pegboard-track > button") ?? [])].map(
        (b) => b.textContent,
      ),
    ).toEqual(["All", "Comments", "Paper", "Surfaces", "Things"]);
    expect(
      boardPlate("A category chosen — Surfaces")?.querySelector(
        '.vf-pegboard-track > button[aria-pressed="true"]',
      )?.textContent,
    ).toBe("Surfaces");
    expect(
      boardPlate("A specimen in the keyboard's focus")?.querySelector(
        ".vf-pegboard-ring[data-shown]",
      ),
    ).not.toBeNull();
    expect(
      Number(
        boardPlate("Rising — 80 % of the slide")?.querySelector<HTMLElement>(".vf-pegboard-filters")
          ?.style.opacity,
      ),
    ).toBeCloseTo(0.5, 6);
    // One Frame FR-3: the head — a plate per state the page's head plates draw
    // (and FitPath and renaming, which the brief adds), the zoom's keys as
    // Windows says them last; the live head in the playground.
    expect(
      [...(container?.querySelectorAll(".vf-ds-head-plate") ?? [])].map(
        (plate) => `${plate.getAttribute("data-state")}:${plate.getAttribute("data-keys")}`,
      ),
    ).toEqual([
      "top:mac",
      "folder:mac",
      "narrow:mac",
      "renaming:mac",
      "explorer:mac",
      "zoom:mac",
      "palette:mac",
      "zoom:other",
    ]);
    const headPlate = (state: string, keys = "mac"): Element | null =>
      container?.querySelector(`.vf-ds-head-plate[data-state="${state}"][data-keys="${keys}"]`) ??
      null;
    expect(headPlate("top")?.querySelector(".vf-head-path")?.textContent).toBe("Studio desk");
    expect(headPlate("top")?.textContent).not.toContain("Root");
    expect(
      [...(headPlate("folder")?.querySelectorAll(".vf-head-crumb, .vf-head-here") ?? [])].map(
        (name) => name.textContent,
      ),
    ).toEqual(["Studio desk", "Sketches"]);
    expect(headPlate("renaming")?.querySelector<HTMLInputElement>(".vf-head-rename")?.value).toBe(
      "Studio desk",
    );
    expect(headPlate("explorer")?.querySelector(".vf-head-docs > :first-child")?.textContent).toBe(
      "New field",
    );
    expect(
      [...(headPlate("zoom")?.querySelectorAll(".vf-head-zoom-menu .vf-menu-key") ?? [])].map(
        (key) => key.textContent,
      ),
    ).toEqual(["⌘+", "⌘−", "⇧1", "⌘0"]);
    expect(
      [
        ...(headPlate("zoom", "other")?.querySelectorAll(".vf-head-zoom-menu .vf-menu-key") ?? []),
      ].map((key) => key.textContent),
    ).toEqual(["Ctrl+Plus", "Ctrl+Minus", "Shift+1", "Ctrl+0"]);
    expect(
      headPlate("palette")?.querySelector('[role="dialog"][aria-label="Command palette"]'),
    ).not.toBeNull();
    expect(container?.querySelector(".vf-ds-field-stage .vf-head-zoom")).not.toBeNull();
    const plate = (state: string): Element | null =>
      container?.querySelector(`.vf-ds-line-plate[data-state="${state}"]`) ?? null;
    expect(plate("at")?.querySelector(".vf-at-menu")).not.toBeNull();
    expect(plate("typing")?.querySelector(".vf-line-chip")).not.toBeNull();
    expect(plate("aimed")?.querySelector(".vf-line-ph")?.textContent).toBe("Message vibe-field…");
    expect(plate("objects")?.querySelector('.vf-line-create[aria-expanded="true"]')).not.toBeNull();
    // in hand the create is faint — "Put it down first" (R14)
    expect(plate("held")?.querySelector(".vf-line-create")?.getAttribute("title")).toBe(
      "Put it down first",
    );
    expect(plate("held")?.querySelector(".vf-line-create")?.getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(plate("hx")?.querySelector(".vf-line-create")?.getAttribute("aria-disabled")).toBe(
      "true",
    );
    // History's search is the frame's Peek (2026-10-08): no History plate
    // draws the room's own search, the empty transcript names ⌘F (K2), and the
    // Peek's plates mount the shipping controller — the button at rest, and
    // the popup drawn open in the plate, never taking the page's focus.
    const history = (state: string): Element | null =>
      container?.querySelector(`.vf-ds-history-plate[data-state="${state}"]`) ?? null;
    expect(container?.querySelector(".vf-ds-history-plate .ah-launcher")).toBeNull();
    expect(history("room")?.querySelector(".ah-col--measure")?.textContent).toContain(
      "Pick a session, or search with ⌘F.",
    );
    expect(
      [...(container?.querySelectorAll(".vf-ds-peek-plate") ?? [])].map((plate) =>
        plate.getAttribute("data-state"),
      ),
    ).toEqual(["peek-closed", "peek-open", "peek-latest", "peek-none", "peek-narrow"]);
    expect(history("peek-closed")?.querySelector(".vf-peek-button kbd")?.textContent).toBe("⌘F");
    expect(history("peek-closed")?.querySelector(".vf-peek-pop")).toBeNull();
    expect(
      history("peek-open")?.querySelector<HTMLInputElement>(".vf-peek-pop .vf-peek-field input")
        ?.value,
    ).toBe("plus");
    expect(history("peek-none")?.querySelector(".vf-peek-pop")).not.toBeNull();
    expect(document.activeElement?.closest(".vf-peek-pop")).toBeFalsy();
    // DK-12 — the tools in hand: a plate per specimen, the shipping bar in its hand's role, its tools in their order
    const hands = [...(container?.querySelectorAll(".vf-ds-bar-plate") ?? [])].filter((p) =>
      p.getAttribute("data-state")?.startsWith("In hand"),
    );
    expect(
      hands.map((p) => p.querySelector("[data-selection-bar]")?.getAttribute("data-face")),
    ).toEqual(["hand", "hand", "hand", "hand"]);
    expect(
      hands.map((p) =>
        [...(p.querySelectorAll('[data-face-row="hand"] [data-tool]') ?? [])]
          .map((t) => t.getAttribute("data-tool"))
          .join(" "),
      ),
    ).toEqual([
      "turn:-1 turn:1 pen:felt pen:ball pen:fountain pen:red undo",
      "marker:black marker:blue marker:red marker:green eraser undo redo",
      "month:-1 month:1 today pen",
      "seconds ring24 zone-back zone-ahead dial",
    ]);
    expect(hands[0]?.querySelector("[data-readout]")?.textContent).toBe("Page 1");
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

    // One Frame FR-3: the playground's head runs on its real controller — its
    // chevron grows the pill into the fields explorer through the one owner.
    const place = container?.querySelector<HTMLElement>(".vf-ds-field-stage [data-head-place]");
    expect(place?.dataset.open).toBe("false");
    await act(async () =>
      place?.querySelector<HTMLButtonElement>('button[aria-label="Fields"]')?.click(),
    );
    expect(place?.dataset.open).toBe("true");

    expect(container?.querySelector(".vf-godview .vf-monitor-list")).not.toBeNull();
    // The swarm's bodies (AR-5): the views package's own fixtures on the
    // SHIPPING view, through the view host since MV-5. A happy-dom window has
    // no WebGPU, so the view says so — the same honest line the product draws,
    // and its report, which the slot mirrors on its own element — while every
    // body stays reachable as a button, and the buttons between them name
    // every drawn state the design record has.
    const bodies = container?.querySelector<HTMLElement>("[data-swarm-bodies-catalog]");
    expect(
      bodies?.querySelector("[data-monitor-view-slot]")?.getAttribute("data-monitor-view-renderer"),
    ).toBe("unavailable");
    expect(bodies?.textContent).toContain("WEBGPU UNAVAILABLE");
    const bodyButtons = Array.from(bodies?.querySelectorAll(".vf-monitor-swarm-list button") ?? []);
    expect(bodyButtons).toHaveLength(stateStages(0).length);
    expect(
      new Set(bodyButtons.map((body) => body.getAttribute("data-agent-bubble-visual"))),
    ).toEqual(new Set(["terminal-empty", "terminal-running", "idle", "working", "blocked"]));
    expect(container?.querySelector(".vf-artifact-panel")).not.toBeNull();
    expect(container?.querySelector(".vf-command-palette")).not.toBeNull();
    expect(container?.querySelector(".vf-loading-veil")).not.toBeNull();
    expect(container?.querySelector(".vf-settings-dialog")).not.toBeNull();
    // The old Objects sheet is gone (DK-13, R21): the playground's line raises the PEGBOARD behind it — the
    // desk's drawer's stand-in with the shipping filters in its band — and its ⊕ is what turns to ✕; the stage
    // neither recedes nor dims (no sheet, no backdrop).
    expect(container?.querySelector(".vf-widget-tray")).toBeNull();
    const playground = container?.querySelector(".vf-ds-field-stage");
    expect(playground?.querySelector("[data-tray-toggle]")).toBeNull();
    expect(playground?.querySelector(".vf-ds-stage-board .vf-pegboard")).toBeNull();
    await act(async () => playground?.querySelector<HTMLButtonElement>(".vf-line-create")?.click());
    expect(playground?.querySelector('.vf-line-create[aria-expanded="true"]')).not.toBeNull();
    expect(playground?.getAttribute("data-board-open")).toBe("true");
    expect(playground?.querySelector(".vf-ds-stage-board .vf-ds-board-standin")).not.toBeNull();
    expect(
      playground?.querySelector(
        '.vf-ds-stage-board .vf-pegboard-track > button[aria-pressed="true"]',
      )?.textContent,
    ).toBe("All");
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
    expect(container?.querySelector(".vf-ds-field-stage .vf-head-zoom")).not.toBeNull();
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
    expect(bloom.querySelector(".vf-monitor-swarm")?.textContent).toContain("WEBGPU UNAVAILABLE");
    expect(
      bloom.querySelector("[data-monitor-view-slot]")?.getAttribute("data-monitor-view-renderer"),
    ).toBe("unavailable");
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

    // The motion switch is the host's theme (MV-W4): off, the view holds still
    await act(async () => button("PAUSE MOTION").click());
    expect(catalog.getAttribute("data-godview-animations")).toBe("off");
    expect(button("REPLAY ARRIVALS").disabled).toBe(true);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 32)));
    expect(catalog.querySelector(".vf-monitor-swarm")?.classList.contains("is-still")).toBe(true);

    // Selecting a body is the host's verb (`commands.select`); the catalog's
    // adapter answers it the way a deck would, by making the row current.
    const first = catalog.querySelector<HTMLButtonElement>(".vf-monitor-swarm-list button");
    expect(first?.getAttribute("aria-current")).toBeNull();
    await act(async () => {
      first?.click();
      // the view host hands the view its next input on the next frame
      await new Promise((resolve) => setTimeout(resolve, 32));
    });
    expect(first?.getAttribute("aria-current")).toBe("true");
  });
});
