// @vitest-environment happy-dom

import { stateStages } from "@vibefield/puppeteer-views";
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
// *Corrected 2026-10-28 (item 85):* CI's runner is the slower host, and on it a render passed 60 s ("Hook timed out in
// 60000ms", verify run 40728506315's first attempt). There a row (render, body and unmount: vitest's own time) took
// 4.6–47.6 s in nine green runs of 10-27/28 and 22–84 s on that attempt. The page had not grown: alone on this Mac a row
// took 1.5–2.8 s at load 15–18 (×3, 24 rows), against 10-05's 1.3–1.7 s render and 0.9 s body. 120 s is twice the 60 s
// that render passed.
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
    // GV-D1: every Godview stage wears the head — the shipping view, mounted
    // by the shipping monitor, never a copy — with the registry's five circles
    // and nothing of the instrument bar it replaced.
    const stages = [...(container?.querySelectorAll(".vf-ds-godview-frame > .vf-godview") ?? [])];
    expect(stages.length).toBeGreaterThanOrEqual(5);
    for (const stage of stages) {
      expect(stage.classList.contains("theme-light")).toBe(true);
      expect(
        [
          ...stage.querySelectorAll(
            '.vf-stories-slot .vf-stories [role="group"][aria-label="Monitor view"] button',
          ),
        ].map((button) => button.getAttribute("aria-label")),
      ).toEqual(["SWARM view", "LIST view", "RAIN view", "TIMELINE view", "SPEND view"]);
      expect(stage.querySelector(".vf-godview-header")).toBeNull();
    }
    expect(container?.textContent).toContain(
      "Swarm bodies — every drawn state, on the package's own fixtures",
    );
    // MV-7: spend's specimen, on the shipping view through GodviewPreview and its fixture door
    expect(container?.textContent).toContain("Spend — where the money went");
    expect(container?.querySelector("[data-godview-spend-catalog] .vf-godview")).not.toBeNull();
    // AO-6b — the limit moment: the shipping card on the shipping stage's claims strip,
    // over the shipping rule's fixture
    const limit = container?.querySelector(
      "[data-godview-limit-catalog] .vf-godview .vf-monitor-claims .vf-monitor-moment",
    );
    expect(limit?.querySelector(".vf-monitor-moment-use")?.textContent).toBe("92% · 7 days");
    expect(limit?.querySelector(".vf-monitor-moment-title")?.textContent).toBe(
      "Another subscription?",
    );
    expect([...(limit?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
      "Add a profile…",
      "Not now",
    ]);
    expect(container?.textContent).toContain("The interface, accounted for");
    // Round 3 (GV-D7, GV-D12): the Lip's specimen is the shipping stage — its groove
    // in its pill, its well — holding panes that wear the shipping frame.
    expect(container?.textContent).toContain("Deck — the Lip: the groove and the well");
    const lip = container?.querySelector("[data-godview-lip-catalog] .vf-godview");
    expect(lip?.querySelector('[role="separator"] .vf-godview-deck-groove')).not.toBeNull();
    const well = lip?.querySelector(".vf-godview-deck-well > .vf-godview-terminal-deck-body");
    expect(well?.querySelectorAll(".ghostty-pane").length).toBeGreaterThanOrEqual(2);
    expect(well?.querySelector(".ghostty-pane.is-active .vf-pane-frame")).not.toBeNull();
    // …the Lip's first button, live on the page (GV-D7), beside the separator
    const minimize = lip?.querySelector('button[aria-label="Minimize the terminals"]');
    expect(minimize?.closest('[role="separator"]')).toBeNull();
    expect(minimize?.closest(".vf-godview-terminal-deck")).not.toBeNull();
    // GV-D6: the terminals away — the monitor alone, the sheet kept, unseen and inert
    expect(container?.textContent).toContain("Deck — away: the monitor alone");
    // GV-D11: maximized — the same stage, its bar the window's title bar: the
    // sheet laid out at the top, a hairline, minimize and restore at its end
    expect(container?.textContent).toContain("Deck — maximized: the bar as the title bar");
    const full = container?.querySelector("[data-godview-maximized-catalog] .vf-godview");
    expect(full?.getAttribute("data-godview-deck")).toBe("maximized");
    expect(full?.getAttribute("data-godview-deck-layout")).toBe("maximized");
    expect(full?.querySelector(".vf-godview-deck-controls > .vf-godview-deck-hair")).not.toBeNull();
    expect(
      full?.querySelector('button[aria-label="Restore the terminals to their place"]'),
    ).not.toBeNull();
    const away = container?.querySelector("[data-godview-away-catalog] .vf-godview");
    expect(away?.getAttribute("data-godview-deck")).toBe("away");
    expect(away?.querySelector(".vf-godview-terminal-deck")?.hasAttribute("inert")).toBe(true);
    expect(away?.querySelector(".vf-godview-monitor-stage")).not.toBeNull();
    // DESIGN.md §13: the glyph section mounts the shipping set from the kit leaf, all 64 —
    // the wrapper's three (round 3) among them, drawn by the shipping component.
    expect(container?.querySelectorAll("#glyphs .vf-ds-glyph")).toHaveLength(64);
    for (const name of ["minimize", "maximize", "restore"]) {
      const tile = [...(container?.querySelectorAll("#glyphs .vf-ds-glyph") ?? [])].find(
        (figure) => figure.querySelector("code")?.textContent === name,
      );
      expect(tile?.querySelector("svg.vf-glyph"), name).not.toBeNull();
      expect(tile?.querySelector("small")?.textContent, name).toBe("instrument");
    }
    // HN-8 (§13): Artifacts' glyph in a button is `package`, the pill's button's and the covered
    // views' circle's, at rest and at the circle's 18 — never `sidepanel`, the retired side
    // panel's toggle, inverted. (Named for the button: the head's `artifacts` plate is below.)
    const artifactsButton = container?.querySelector<HTMLElement>(
      '#glyphs button[title="Artifacts"]',
    );
    const packageGlyph = artifactsButton?.querySelector("[data-glyph]");
    expect(packageGlyph?.getAttribute("data-glyph")).toBe("package");
    expect(packageGlyph?.getAttribute("width")).toBe("18");
    expect(artifactsButton?.dataset.active).toBe("false");
    // One Frame FR-1: the view frame on fixtures — the shipping track and cover
    // over a field, and a plate per state the page's Chrome & Composer plates
    // show for the frame (the last the keys as Windows prints them).
    expect(container?.querySelector(".vf-ds-frame-stage .vf-views-line")).not.toBeNull();
    expect(container?.querySelector(".vf-ds-frame-stage .vf-cover")).not.toBeNull();
    expect(
      [...(container?.querySelectorAll(".vf-ds-views-plate") ?? [])].map((plate) =>
        plate.getAttribute("data-state"),
      ),
    ).toEqual(["rest", "cmd", "gv", "hx", "import", "note", "rest"]);
    // AO-4b — History's arc on the shipping track, on the canvas while it imports
    const importing = container?.querySelector('.vf-ds-views-plate[data-state="import"]');
    expect(
      importing?.querySelector('.vf-views-cell[data-view="history"] .vf-views-arc'),
    ).not.toBeNull();
    expect(
      importing?.querySelector('.vf-views-cell[data-view="history"]')?.getAttribute("aria-label"),
    ).toBe("History, importing");
    // One Frame FR-2, LN-D1: the line — live on its real controller over the
    // frame's field (the track at its left end), and a plate per state the Cards
    // in Hand page draws for it, the last Godview's keys as Windows prints them.
    expect(container?.querySelector(".vf-ds-frame-stage .vf-line > .vf-views-line")).not.toBeNull();
    // …its capture a fixture door whose tool comes up and is let go (ViewFramePreview): the live
    // snapshot is ready, never the no-door wait the catalog once drew for it
    const liveSnapshot = container?.querySelector(".vf-ds-frame-stage .vf-line-snapshot");
    expect(liveSnapshot?.hasAttribute("aria-disabled")).toBe(false);
    expect(liveSnapshot?.getAttribute("title")).toBe("Snapshot  ⌃⌘A");
    expect(
      [...(container?.querySelectorAll(".vf-ds-line-plate") ?? [])].map(
        (plate) => `${plate.getAttribute("data-state")}:${plate.getAttribute("data-keys")}`,
      ),
    ).toEqual([
      "rest:mac",
      "snap-hover:mac",
      "snap-on:mac",
      "snap-waits:mac",
      "objects:mac",
      "held:mac",
      "gv:mac",
      "hx:mac",
      "opened:mac",
      "refused:mac",
      "gv:other",
    ]);
    // no draft on any plate, nor on the live line (LN-D3: the typing lives where it is read)
    expect(container?.querySelector(".vf-line-input, .vf-line-send, .vf-at-menu")).toBeNull();
    // the snapshot's states on the shipping view: a ghost at rest, under the pointer, filled
    // while the tool is up, faint where no capture door is
    const plate = (state: string): Element | null =>
      container?.querySelector(`.vf-ds-line-plate[data-state="${state}"]`) ?? null;
    const snap = (state: string): Element | null =>
      plate(state)?.querySelector(".vf-line-snapshot") ?? null;
    expect(snap("rest")?.getAttribute("title")).toBe("Snapshot  ⌃⌘A");
    expect(snap("snap-hover")?.hasAttribute("data-hot")).toBe(true);
    expect(snap("snap-on")?.getAttribute("data-on")).toBe("true");
    expect(snap("snap-waits")?.getAttribute("aria-disabled")).toBe("true");
    expect(snap("snap-waits")?.getAttribute("title")).toBe("Snapshot — no capture here");
    // the note at its two places, in the product's own words: a new terminal over the create
    const opened = plate("opened")?.querySelector(".vf-line-note");
    expect(opened?.getAttribute("data-at")).toBe("create");
    expect(opened?.textContent).toBe("Terminal opened in the active pane");
    // D6 — the failure: a paste too large for its pane, said from the line's left edge
    // (`inputRefusalNote` over a fixture refusal)
    const refused = plate("refused")?.querySelector(".vf-line-note");
    expect(refused?.getAttribute("data-at")).toBe("line");
    expect(refused?.textContent).toBe(
      "Not pasted into vibe-field — 300 KB, and one paste carries 261 KB of it",
    );
    // HN-7 — History's plate: its create is New terminal, named for the project the room shows,
    // and the caption under the plates says what they draw (the design lens's 14: it said
    // "History's Resume waiting")
    expect(plate("hx")?.querySelector(".vf-line-create")?.getAttribute("title")).toBe(
      "New terminal in vibe-field  ⌘T",
    );
    const lineCaption = plate("hx")?.parentElement?.nextElementSibling?.textContent ?? "";
    expect(lineCaption).toContain("History's New terminal in the project the room shows");
    expect(lineCaption).not.toContain("History's Resume");
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
      "package-dot:mac",
      "folder:mac",
      "narrow:mac",
      "renaming:mac",
      "explorer:mac",
      "artifacts:mac",
      "artifacts-off:mac",
      "artifacts-cant-run:mac",
      "artifacts-opening:mac",
      "artifacts-not-starting:mac",
      "covered:mac",
      "zoom:mac",
      "palette:mac",
      "sync-question:mac",
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
    // TS-6 (TS-D13) — the sync question in the explorer, in place of its tiles
    const question = headPlate("sync-question");
    expect(question?.querySelector('form[aria-label="Sync question"]')).not.toBeNull();
    expect(question?.querySelector(".vf-head-docs")?.hasAttribute("hidden")).toBe(true);
    expect(question?.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    // HN-8 (PL-D1, PL-D2) — the package after the chevron's rule, with its standing dot in its
    // own plate; the sheet on Artifacts holding the Hub's own adapter, and with none bound each of
    // its four words (ruling 10); and under a cover the same sheet, grown from the package circle,
    // on Artifacts alone
    const pack = headPlate("top")?.querySelector<HTMLButtonElement>(".vf-head-pack");
    expect(pack?.previousElementSibling?.className).toBe("vf-head-rule");
    expect(pack?.previousElementSibling?.previousElementSibling?.className).toBe("vf-head-chev");
    expect(pack?.title).toBe("Artifacts");
    expect(pack?.querySelector(".vf-head-pack-dot")).toBeNull();
    const dotted = headPlate("package-dot")?.querySelector<HTMLButtonElement>(".vf-head-pack");
    expect(dotted?.querySelector(".vf-head-pack-dot")).not.toBeNull();
    expect(dotted?.title).toBe("Artifacts — vibe-field's source is unavailable");
    const artifacts = headPlate("artifacts");
    const on = artifacts?.querySelector<HTMLButtonElement>('.vf-head-pack[aria-expanded="true"]');
    expect(on?.title).toBe("Close  Esc");
    expect(artifacts?.querySelector(".vf-head-chev")?.getAttribute("title")).toBe("Fields");
    expect(
      artifacts?.querySelector('[data-shelf="artifacts"][data-shown] .vf-artifact-panel'),
    ).not.toBeNull();
    const off = headPlate("artifacts-off")?.querySelector('[data-shelf="artifacts"]');
    expect(off?.textContent).toContain("Artifacts are off");
    expect(off?.textContent).toContain("Turn on the Browser plugin in Settings › Plugins.");
    const cantRun = headPlate("artifacts-cant-run")?.querySelector('[data-shelf="artifacts"]');
    expect(cantRun?.textContent).toContain("Artifacts can't run");
    expect(cantRun?.textContent).toContain(
      "The Browser plugin can't run in this VibeField — see Settings › Plugins.",
    );
    expect(
      headPlate("artifacts-opening")?.querySelector(".vf-head-waits[data-late]")?.textContent,
    ).toBe("Opening Artifacts…");
    // past the 10 s bound the plate says so at once, with nothing left to turn from
    const stalled = headPlate("artifacts-not-starting")?.querySelector(".vf-head-waits");
    expect(stalled?.hasAttribute("data-late")).toBe(false);
    expect(stalled?.hasAttribute("data-turning")).toBe(false);
    expect(stalled?.textContent).toContain("Artifacts aren't starting");
    expect(stalled?.textContent).toContain(
      "Turn the Browser plugin off and on in Settings › Plugins.",
    );
    const covered = headPlate("covered");
    expect(covered?.querySelector(".vf-head")?.hasAttribute("data-covered")).toBe(true);
    expect(covered?.querySelector('[data-head-place][data-open="true"]')).toBeNull();
    const circleSheet = covered?.querySelector('.vf-head-sheet[data-open="true"]');
    expect(circleSheet?.querySelector(".vf-head-sheet-name")?.textContent).toBe("Artifacts");
    expect(
      circleSheet?.querySelector('[data-shelf="artifacts"] .vf-artifact-panel'),
    ).not.toBeNull();
    expect(
      headPlate("palette")?.querySelector('[role="dialog"][aria-label="Command palette"]'),
    ).not.toBeNull();
    expect(container?.querySelector(".vf-ds-field-stage .vf-head-zoom")).not.toBeNull();
    expect(plate("objects")?.querySelector('.vf-line-create[aria-expanded="true"]')).not.toBeNull();
    // in hand the create is faint — "Put it down first" (R14)
    expect(plate("held")?.querySelector(".vf-line-create")?.getAttribute("title")).toBe(
      "Put it down first",
    );
    expect(plate("held")?.querySelector(".vf-line-create")?.getAttribute("aria-disabled")).toBe(
      "true",
    );
    // HN-7 (LN-D2): History's create is New terminal in the project the room shows — never
    // waiting on a chosen session (its Resume is the palette's row: the History plates below)
    const hx = plate("hx")?.querySelector(".vf-line-create");
    expect(hx?.hasAttribute("aria-disabled")).toBe(false);
    expect(hx?.getAttribute("title")).toBe("New terminal in vibe-field  ⌘T");
    expect(hx?.querySelector("[data-shown] [data-glyph]")?.getAttribute("data-glyph")).toBe(
      "start",
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
    // PJ-4 — History by project's plate (its rows: history-projects-plate.test.tsx)
    expect(history("projects")?.querySelector(".vf-history .ah-frame")).not.toBeNull();
    // HN-7 — Resume's plates draw it where it lives now: the palette's History row, after New
    // terminal (the line's create there, the project shown in its tooltip)
    for (const state of ["chosen", "running"]) {
      const rows = [...(history(state)?.querySelectorAll(".vf-command-palette [data-row]") ?? [])];
      expect(rows.map((row) => row.getAttribute("data-row"))).toContain("chosen-session");
      expect(history(state)?.querySelector(".vf-line-create")?.getAttribute("title")).toBe(
        "New terminal in vibe-field  ⌘T",
      );
    }
    // AO-6b — a new agent with a past: the shipping row at the room's head
    const head = history("new-agent")?.querySelector(".vf-history .vf-history-new-agent");
    expect(head?.querySelector(".vf-history-new-agent-words")?.textContent).toMatch(
      /^.+ has history on this Mac\. 240 MB, last used in August\.$/u,
    );
    expect([...(head?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
      "Bring it in",
      "Not now",
    ]);
    expect(
      [...(container?.querySelectorAll(".vf-ds-peek-plate") ?? [])].map((plate) =>
        plate.getAttribute("data-state"),
      ),
    ).toEqual(["peek-live", "peek-unconnected", "peek-closed", "peek-open"]);
    expect(history("peek-closed")?.querySelector(".vf-peek-button kbd")?.textContent).toBe("⌘F");
    expect(history("peek-closed")?.querySelector(".vf-peek-pop")).toBeNull();
    // P2 — Godview's Live now, the same controller over the monitor's door as a
    // fixture holds it: waiting first, a shell last, the scope row's filters
    const live = history("peek-live");
    expect(
      [...(live?.querySelectorAll('.vf-peek-row[data-kind="live"] .vf-peek-dot') ?? [])].map(
        (dot) => dot.getAttribute("data-state"),
      ),
    ).toEqual(["blocked", "working", "shell"]);
    expect(live?.querySelector(".vf-peek-row .vf-peek-os")?.textContent).toBe("studio");
    expect(
      [...(live?.querySelectorAll(".vf-peek-dd-label") ?? [])].map((label) => label.textContent),
    ).toEqual(["All desktops", "Every profile"]);
    // TS-4 — this Mac not connected: its runs alone, This Mac wears the filter,
    // and the filter's menu ends on the ghost row
    const unconnected = history("peek-unconnected");
    expect(unconnected?.querySelector(".vf-peek-row .vf-peek-os")).toBeNull();
    expect(unconnected?.querySelector('[data-peek-dd="desk"] .vf-peek-dd-label')?.textContent).toBe(
      "MacBook Pro",
    );
    act(() =>
      unconnected?.querySelector<HTMLButtonElement>('[data-peek-dd="desk"] .vf-peek-dd')?.click(),
    );
    expect(unconnected?.querySelector(".vf-peek-menu [data-ghost]")?.textContent).toBe(
      "Your other devicesConnect…",
    );
    expect(
      history("peek-open")?.querySelector<HTMLInputElement>(".vf-peek-pop .vf-peek-field input")
        ?.value,
    ).toBe("plus");
    expect(document.activeElement?.closest(".vf-peek-pop")).toBeFalsy();
    // HN-8 (PL-D2) — the package circle: the shipping view at the head's left over each covered
    // view's own ground, in the head's own words — over Godview's stage, its Stories row there to
    // keep its side from it; over History's band, a source unavailable; and in the terminals'
    // title bar while they are maximized, folded there, two sources unavailable
    const packagePlates = [
      ...(container?.querySelectorAll<HTMLElement>(".vf-ds-package-plate") ?? []),
    ];
    expect(packagePlates.map((p) => p.dataset.state)).toEqual(["godview", "history", "bar"]);
    const packagePlate = (state: string): HTMLElement | undefined =>
      packagePlates.find((p) => p.dataset.state === state);
    const overGodview = packagePlate("godview");
    expect(overGodview?.querySelector(".vf-godview .vf-stories")).not.toBeNull();
    expect(overGodview?.querySelector(".vf-package-circle")?.hasAttribute("data-bar")).toBe(false);
    expect(overGodview?.querySelector(".vf-package-dot")).toBeNull();
    expect(overGodview?.querySelector(".vf-package-button")?.getAttribute("title")).toBe(
      "Artifacts",
    );
    const overHistory = packagePlate("history");
    expect(overHistory?.querySelector(".vf-history")).not.toBeNull();
    expect(overHistory?.querySelector(".vf-package-circle .vf-package-dot")).not.toBeNull();
    expect(overHistory?.querySelector(".vf-package-button")?.getAttribute("title")).toBe(
      "Artifacts — vibe-field's source is unavailable",
    );
    const inTheBar = packagePlate("bar");
    expect(inTheBar?.querySelector(".vf-godview")?.getAttribute("data-godview-deck")).toBe(
      "maximized",
    );
    expect(inTheBar?.querySelector(".vf-package-circle")?.getAttribute("data-bar")).toBe("true");
    expect(inTheBar?.querySelector(".vf-package-circle .vf-package-dot")).not.toBeNull();
    expect(inTheBar?.querySelector(".vf-package-button")?.getAttribute("aria-label")).toBe(
      "Artifacts — 2 sources unavailable",
    );
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
    // HN — the hand: a plate per state, each the shipping fan (and the carried card) placed by the
    // product's own model over fixture cards, and never taking the page's keyboard
    const cardPlates = [...(container?.querySelectorAll<HTMLElement>(".vf-ds-cards-plate") ?? [])];
    expect(cardPlates.map((p) => p.dataset.state)).toEqual([
      "rest",
      "reached",
      "raised",
      "held",
      "carried",
      "from",
      "from",
      "from",
    ]);
    const cardPlate = (state: string): HTMLElement | undefined =>
      cardPlates.find((p) => p.dataset.state === state);
    expect(cardPlate("rest")?.querySelectorAll(".vf-cards .vf-card")).toHaveLength(6);
    expect(cardPlate("rest")?.querySelector(".vf-card-x")).toBeNull();
    const reached = cardPlate("reached");
    expect(reached?.querySelectorAll(".vf-card-x")).toHaveLength(1);
    expect(reached?.querySelector(".vf-cards-label")?.textContent).toBe("Godview · swarm · 5m ago");
    const raisedFan = cardPlate("raised")?.querySelector(".vf-cards");
    expect(raisedFan?.getAttribute("role")).toBe("listbox");
    expect(raisedFan?.querySelector("[data-focus]")?.getAttribute("data-slot")).toBe("fx-term");
    const heldLayer = cardPlate("held")?.querySelector<HTMLElement>(".vf-cards-held");
    expect(heldLayer?.dataset.phase).toBe("up");
    expect(heldLayer?.getAttribute("role")).toBe("dialog");
    const heldBar = [...(heldLayer?.querySelectorAll(".vf-cards-bar button") ?? [])];
    expect(heldBar.map((b) => b.textContent)).toEqual(["Remove", "Done"]);
    expect(document.activeElement?.closest(".vf-ds-cards-plate")).toBeFalsy();
    const carriedPlate = cardPlate("carried");
    const keptPlace = carriedPlate?.querySelector('[data-slot="fx-text"]');
    expect(keptPlace?.getAttribute("data-phase")).toBe("hidden");
    const carriedCard = carriedPlate?.querySelector(".vf-cards-carried .vf-card");
    expect(carriedCard?.getAttribute("data-card")).toBe("fx-text");
    expect(carriedPlate?.querySelector(".vf-cards-carried-ring")).not.toBeNull();
    const answer = carriedPlate?.querySelector(".vf-cards-carried-label");
    expect(answer?.textContent).toBe("Paste into vibe-field");
    // …where a paste, a copy in Settings and one in History came from, each card reached on its
    // own plate, the product's own provenance above it (LC-21: a paste says its act alone)
    const fromPlates = cardPlates.filter((p) => p.dataset.state === "from");
    expect(fromPlates.map((p) => p.dataset.reach)).toEqual([
      "fx-from-paste",
      "fx-from-settings",
      "fx-from-history",
    ]);
    const over = fromPlates.map((p) => p.querySelector(".vf-cards-label")?.textContent);
    expect(over).toEqual(["⌘V · just now", "Canvas · Settings · just now", "History · just now"]);
    // …and the faces on the shipping CardFace: the six kinds by day and by the Moon, a drag's two
    // waiting faces, the two the desk's Copy deals (UI_SYSTEM's list), and what another app,
    // Settings and History deal — a file that is not words by its kind and size (§9)
    const faceRows = [...(container?.querySelectorAll(".vf-ds-card-faces") ?? [])];
    const kindsOf = (row: Element): string =>
      [...row.querySelectorAll<HTMLElement>(".vf-card")].map((card) => card.dataset.kind).join(" ");
    expect(faceRows.map(kindsOf)).toEqual([
      "text file agent term msg pict",
      "text file agent term msg pict",
      "pict file",
      "text pict",
      "file text text text",
    ]);
    expect(faceRows.map((row) => row.classList.contains("dark"))).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(faceRows[0]?.querySelector('[data-kind="agent"] .vf-card-project i')).not.toBeNull();
    const copyNote = faceRows[3]?.querySelector('[data-kind="text"] .vf-card-words b');
    expect(copyNote?.textContent).toBe("Ship the hand on Thursday.");
    const copyPicture = faceRows[3]?.querySelector('[data-kind="pict"] .vf-card-name');
    expect(copyPicture?.textContent).toBe("2 objects");
    const facts = faceRows[4]?.querySelector('[data-kind="file"] [data-facts]');
    expect(facts?.textContent).toBe("PDF · 2.4 MB");
  });

  it("exposes theme and representative component-state controls", async () => {
    const themeToggle = container?.querySelector<HTMLButtonElement>(".vf-ds-theme-toggle");
    expect(themeToggle?.getAttribute("aria-label")).toBe("Switch to dark mode");
    await act(async () => themeToggle?.click());
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("vf-dark")).toBe("true");
    // One theme control per onboarding frame: eleven since AO-1 (2026-10-27),
    // when Ready and the second user's finishing folded into Setting up; twelve
    // since AO-3, the agent chapter's History pane; fourteen since AO-5's Agents
    // and Profiles; thirteen since TS-6 retired the posture pane (TS-D13).
    expect(
      container?.querySelectorAll(
        '[data-onboarding-preview] button[aria-label="Switch to light mode"]',
      ),
    ).toHaveLength(13);

    // One Frame FR-3: the playground's head runs on its real controller — its
    // chevron grows the pill into the fields explorer through the one owner.
    const place = container?.querySelector<HTMLElement>(".vf-ds-field-stage [data-head-place]");
    expect(place?.dataset.open).toBe("false");
    await act(async () =>
      place?.querySelector<HTMLButtonElement>('button[aria-label="Fields"]')?.click(),
    );
    expect(place?.dataset.open).toBe("true");
    // HN-8: its package turns the same sheet to Artifacts in place — which waits here, with no
    // plugin host in the catalog to bind the Hub, as a window's does at boot
    await act(async () => place?.querySelector<HTMLButtonElement>(".vf-head-pack")?.click());
    expect(place?.dataset.open).toBe("true");
    expect(place?.querySelector('[data-shelf="artifacts"][data-shown]')?.textContent).toBe(
      "Opening Artifacts…",
    );

    expect(container?.querySelector(".vf-godview .vf-monitor-list")).not.toBeNull();
    // GV-D1: the head in the other theme too — the page is dark, so the frame's
    // tokens the head is drawn in are the night's (`.dark .vf-stories`), and
    // every stage that follows the page is Godview's dark.
    const darkStages = [
      ...(container?.querySelectorAll(".vf-ds-godview-frame > .vf-godview.theme-dark") ?? []),
    ];
    expect(darkStages.length).toBeGreaterThanOrEqual(5);
    for (const stage of darkStages) {
      expect(stage.closest(".dark")).toBe(document.documentElement);
      expect(stage.querySelectorAll(".vf-stories .vf-story").length).toBe(5);
    }
    // System control is the palette's act in the product; the stage specimen
    // stages the catalog's own button for the shipping panel.
    const control = container?.querySelector<HTMLButtonElement>(
      '.vf-ds-godview-controls button[aria-controls="vf-godview-tweak-panel"]',
    );
    expect(control?.textContent).toBe("System control");
    expect(control?.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("vf-godview-tweak-panel")).toBeNull();
    await act(async () => control?.click());
    expect(control?.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("vf-godview-tweak-panel")?.textContent).toContain(
      "SYSTEM CONTROL",
    );
    await act(async () => control?.click());
    expect(document.getElementById("vf-godview-tweak-panel")).toBeNull();
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
    // AO-1 (2026-10-27): pane 3 retired, and Ready and the second user's
    // finishing folded into Setting up — the end of every path — whose own
    // refusals (the answers not saved, the desk that could not open) are frames.
    // AO-3 adds the agent chapter's History pane, AO-5 its Agents and Profiles.
    // TS-6 (TS-D13): the sync question's pane left setup for the first new field.
    expect(container?.querySelectorAll("[data-onboarding-preview]")).toHaveLength(13);
    for (const state of [
      "welcome",
      "field",
      "agents",
      "profiles",
      "history",
      "connect",
      "setting-up",
      "deriving",
      "welcome-back",
      "setting-up-second-user",
      "setting-up-write-failed",
      "setting-up-desk-failed",
      "users",
    ]) {
      expect(container?.querySelector(`[data-onboarding-preview="${state}"]`)).not.toBeNull();
    }
    expect(container?.querySelectorAll(".vf-wizard-shell")).toHaveLength(13);
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
    // HN-8: the Hub's plate gives it the Artifacts shelf's width, a container its tile form
    // answers — the plugin's own panel, Publish… first in its catalog
    const shelf = container?.querySelector(".vf-ds-shelf-stage");
    expect(shelf?.firstElementChild?.className).toBe("vf-artifact-panel");
    expect(shelf?.querySelector(".vf-artifact-list > li")?.className).toBe("vf-artifact-publish");
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

    // TS-2 — every face of the Connect pane, through the production derivation:
    // the adapter hands `linkFace` a wire snapshot, so a face the catalog can
    // show is one the shipping surfaces can show (UA-P-0g's rule, kept).
    await choose("connect", "connected");
    expect(frame("connect").textContent).toContain("Connected.");
    expect(frame("connect").textContent).toContain("james@example.com");
    await choose("connect", "approval");
    expect(frame("connect").textContent).toContain("Waiting for approval.");
    expect(frame("connect").textContent).toContain("truffle-vibefield-studio");
    await choose("connect", "signed out");
    expect(frame("connect").textContent).toContain("Sign in to Tailscale again.");
    await choose("connect", "removed");
    expect(frame("connect").textContent).toContain("This Mac was removed from your network.");
    // TS-8b — a network that requires device logs, refusing a capture or a link
    // that stood before, and a Mac Tailnet Lock holds (DESIGN.md §9)
    await choose("connect", "logs required");
    expect(frame("connect").textContent).toContain("Your network requires device logs.");
    expect(frame("connect").textContent).toContain("Send logs on this network");
    await choose("connect", "connected before");
    expect(frame("connect").textContent).toContain("Your network requires device logs.");
    await choose("connect", "connected");
    await choose("connect", "not yet trusted");
    expect(frame("connect").textContent).toContain("Connected, not yet trusted.");
    expect(frame("connect").textContent).toContain("truffle-vibefield-studio");
    await choose("connect", "refused");
    expect(frame("connect").textContent).toContain("That account already has a field here.");
    expect(frame("connect").textContent).toContain('the local user "Work" is already linked');
    await choose("connect", "ask");
    expect(frame("connect").textContent).toContain("Your field, on every device.");
    expect(frame("connect").textContent).toContain("Private network by Tailscale.");
    await choose("connect", "what it sees");
    expect(frame("connect").textContent).toContain("Only you can reach this Mac.");
    await choose("connect", "devices");
    await choose("connect", "Continue with Tailscale");
    expect(frame("connect").textContent).toContain("Opening Tailscale…");

    // AO-1 — Setting up, fed the boot machine's states by hand: one line under the logo
    // (FG-D21 B), the desk's own stage under it while it opens, then the welcome on that line.
    const standing = (state: string): Element | null =>
      frame(state).querySelector('.vf-wizard-status-words:not([data-state="out"])');
    const said = (state: string): [string, string] => [
      standing(state)?.querySelector(".vf-wizard-status-line")?.textContent ?? "",
      standing(state)?.querySelector(".vf-wizard-status-sub")?.textContent ?? "",
    ];
    expect(said("setting-up")).toEqual(["Opening your field…", "drawing the board"]);
    await choose("setting-up", "ready");
    expect(said("setting-up")).toEqual([
      "Welcome to your field, James.",
      "Your face in the bottom-left corner opens Settings — so does ⌘,.",
    ]);
    expect(standing("setting-up")?.getAttribute("data-ink")).toBe("true");
    // the answers being written: the desk's line, nothing under it yet
    await choose("setting-up", "saving");
    expect(said("setting-up")).toEqual(["Opening your field…", ""]);
    // AO-4b — History's line once the desk is ready, in the room's words with its count under it,
    // and Start now once the first pass has run 8s past the desk
    await choose("setting-up", "finding");
    expect(said("setting-up")).toEqual(["Discovering conversations…", "1,215 files checked"]);
    expect(frame("setting-up").textContent).not.toContain("Start now");
    await choose("setting-up", "slow");
    expect(said("setting-up")).toEqual(["Discovering conversations…", "1,215 files checked"]);
    expect(frame("setting-up").textContent).toContain("Start now");
    expect(frame("setting-up").textContent).toContain(
      "Finding sessions in a history this size takes longer. It carries on in History.",
    );
    await choose("setting-up", "ready");
    expect(said("setting-up")[0]).toBe("Welcome to your field, James.");
    expect(frame("setting-up").textContent).not.toContain("Start now");

    // AO-3 — the History pane: its rows with every switch on, then a no.
    expect(frame("history").querySelectorAll('[role="switch"][aria-checked="true"]')).toHaveLength(
      3,
    );
    expect(frame("history").textContent).toContain("Bring in history");
    await choose("history", "all off");
    expect(frame("history").textContent).toContain("Continue without history");
    await choose("history", "looking");
    expect(frame("history").textContent).toContain("Looking for past sessions…");

    // AO-5 — the Agents pane: ready rows and a supported one missing, the
    // preview agents behind More agents, then a Mac with none.
    expect(frame("agents").textContent).toContain("Your agents are ready.");
    expect(frame("agents").querySelectorAll('.vf-agents-pane-row[data-state="ready"]').length).toBe(
      2,
    );
    expect(frame("agents").textContent).toContain("Not on this Mac");
    expect(
      frame("agents").querySelector(".vf-agents-pane-more")?.getAttribute("aria-expanded"),
    ).toBe("false");
    await choose("agents", "more");
    expect(
      frame("agents").querySelector(".vf-agents-pane-more")?.getAttribute("aria-expanded"),
    ).toBe("true");
    await choose("agents", "first");
    expect(frame("agents").textContent).toContain("Add your first agent.");
    expect(frame("agents").textContent).toContain("Add agents anytime in Settings → Agents.");
    await choose("agents", "unavailable");
    expect(frame("agents").textContent).toContain("Your agents.");
    expect(frame("agents").textContent).toContain("Try again");

    // AO-5 — the Profiles pane: This Mac's own sign-ins and the offer, then Add
    // a profile… grown in place, a step at a time.
    expect(frame("profiles").textContent).toContain("Every subscription, side by side.");
    expect(frame("profiles").querySelector(".vf-profiles-pane-add")).not.toBeNull();
    await choose("profiles", "second person");
    expect(frame("profiles").textContent).toContain(
      "These sign-ins belong to this Mac, so everyone using VibeField here shares them.",
    );
    await choose("profiles", "name");
    expect(frame("profiles").querySelector("#vf-profiles-pane-name")).not.toBeNull();
    await choose("profiles", "signing in");
    expect(frame("profiles").querySelector(".vf-profiles-signin")).not.toBeNull();
    expect(frame("profiles").textContent).toContain("Finish or cancel the sign-in first.");
    await choose("profiles", "ready");
    expect(frame("profiles").textContent).toContain(
      "Work is ready. It starts with clean settings: its own skills and servers.",
    );
  });

  it("mounts the spawn bloom on the shipping monitor with its fixture door, and a create lands as a new terminal (SB-3)", async () => {
    const bloom = container?.querySelector<HTMLElement>("[data-spawn-bloom-catalog]");
    if (!bloom) throw new Error("Spawn bloom catalog not found");
    // The SHIPPING swarm view: happy-dom has no WebGPU, so it draws its honest
    // line and its keyboard list — the fixture's three agents; the profiles
    // its managed profiles call for are chosen in search's Live now (GV-D3,
    // P2), so the bar draws no tabs.
    expect(bloom.querySelector(".vf-monitor-swarm")?.textContent).toContain("WEBGPU UNAVAILABLE");
    expect(
      bloom.querySelector("[data-monitor-view-slot]")?.getAttribute("data-monitor-view-renderer"),
    ).toBe("unavailable");
    expect(
      bloom.querySelectorAll(".vf-monitor-swarm-list li button:not([data-swarm-new-terminal])"),
    ).toHaveLength(3);
    expect(bloom.querySelector("[data-profile-tab]")).toBeNull();

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
