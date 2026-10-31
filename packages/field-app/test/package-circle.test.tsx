// @vitest-environment happy-dom
/**
 * The package circle (DESIGN.md §8 "The head" — the package circle; PL-D2 ruled by James
 * 2026-10-29, Cards in Hand; HN-8). The shipping controller, `PackageCircle`, on a harness that
 * stands where FieldView does — the frame's one owner of the open surface and its one reading of
 * the shelf the sheet shows (`useShownShelf`) — and holds the window's view as main would, the
 * head's reading of the catalog fed as `artifact.subscribe` feeds it (`head-artifacts.ts`), and a
 * stand-in for the pill's sheet beside it (a section holding a button, inert while it is folded,
 * as the head's sheet is). The rows: the circle stands under a cover only; it grows the sheet on
 * Artifacts through the one value (`artifacts`) and folds it, stepping aside exactly while the
 * sheet shows; it wears the head's dot and words; the keyboard comes back to it when the sheet it
 * grew folds (the keyboard's way into the real sheet is head.test's, beside the head); and
 * while Godview's terminals are maximized it stands in their title bar, stepping out and back on
 * search's own two steps (GV-D11), never apart from search. Its stylesheet is held to the entry's
 * numbers, and the frame mounts it before the head, so the sheet grows over it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FrameView } from "@vibefield/contracts";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishGodviewDeck, resetGodviewDeckDoorForTest } from "../src/frame/deck-door";
import { type FrameSurface, foldSurface } from "../src/frame/frame-surface";
import { useShownShelf } from "../src/frame/Head";
import { resetArtifactCatalog, setArtifactCatalog } from "../src/frame/head-artifacts";
import { PackageCircle } from "../src/frame/PackageCircle";
import { Peek } from "../src/frame/Peek";
import type { PeekPort } from "../src/frame/peek-port";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const sheet = readFileSync(join(SRC, "frame", "package-circle.css"), "utf8");
const escaped = (selector: string): string => selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** One rule's declarations, by its exact selector. */
const rule = (selector: string): string =>
  sheet.match(new RegExp(`^${escaped(selector)} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
/** The declarations of a rule whose list of selectors starts with `first`. */
const ruleFrom = (first: string): string =>
  sheet.match(new RegExp(`^${escaped(first)},\\n[^{]*\\{([^}]*)\\}`, "m"))?.[1] ?? "";

/** A port nobody asks: the Peek stands closed beside the circle. */
const QUIET_PORT: PeekPort = {
  search: () => new Promise(() => undefined),
  latest: () => new Promise(() => undefined),
  projects: async () => [],
};

const FIXTURES = join(HERE, "..", "..", "contracts", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
/** One artifact, as the catalog's projection carries it (the contract's own fixture). */
const VIEW = fixture("artifact-view.valid.json");
/** The whole list `artifact.subscribe` sends: one live artifact, and these titles' sources
 * unavailable. */
const catalog = (...unavailable: readonly string[]): unknown[] => [
  VIEW,
  ...unavailable.map((title) => ({
    ...VIEW,
    title,
    advertisedAvailability: "source-unavailable",
    availability: "source-unavailable",
  })),
];

let root: Root | null = null;
let host: HTMLElement | null = null;
let surfaceNow: FrameSurface | null = null;
let setSurfaceNow: ((next: FrameSurface | null) => void) | null = null;
let setViewNow: ((view: FrameView) => void) | null = null;

beforeEach(() => {
  resetGodviewDeckDoorForTest();
  resetArtifactCatalog();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  surfaceNow = null;
  resetGodviewDeckDoorForTest();
  resetArtifactCatalog();
});

/** FieldView's place: the frame's one owner, the window's view and its one reading of the shelf
 * the sheet shows — and the sheet's stand-in. `search` stands the Peek's own controller beside
 * the circle, closed. */
function mount(opts: { view?: FrameView; search?: boolean } = {}): void {
  function Owner(): ReactElement {
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    const [view, setView] = useState<FrameView>(opts.view ?? "canvas");
    const shelf = useShownShelf(surface, view);
    surfaceNow = surface;
    setSurfaceNow = setSurface;
    setViewNow = setView;
    return (
      <>
        <PackageCircle view={view} surface={surface} shelf={shelf} onSurfaceChange={setSurface} />
        <section data-sheet="" inert={shelf !== "artifacts"}>
          <button type="button" data-in-sheet="">
            Publish…
          </button>
        </section>
        <input data-elsewhere="" aria-label="Elsewhere" />
        {opts.search === true ? (
          <Peek
            view={view}
            keys="mac"
            surface={surface}
            onSurfaceChange={setSurface}
            port={QUIET_PORT}
            onOpenPast={() => undefined}
            bindKeys={false}
            takeFocus={false}
          />
        ) : null}
      </>
    );
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Owner />));
}

const circle = (): HTMLElement | null =>
  host?.querySelector<HTMLElement>(".vf-package-circle") ?? null;
const button = (): HTMLButtonElement | null =>
  host?.querySelector<HTMLButtonElement>(".vf-package-button") ?? null;
/** Where the one button stands and its step: `data-bar`, `data-step`. */
const placeOf = (selector: string): [string | null, string | null] => {
  const at = host?.querySelector<HTMLElement>(selector);
  return [at?.getAttribute("data-bar") ?? null, at?.getAttribute("data-step") ?? null];
};

describe("the package circle (PL-D2; DESIGN.md §8, the head)", () => {
  it("stands under a cover alone — Godview, History and Chat — and on Canvas the pill holds the package", () => {
    mount();
    expect(circle()).toBeNull();
    act(() => setViewNow?.("godview"));
    expect(circle()).not.toBeNull();
    // it stands in the window's drag strip, and takes its own press
    expect(circle()?.classList.contains("no-drag")).toBe(true);
    expect(button()?.getAttribute("aria-label")).toBe("Artifacts");
    expect(button()?.getAttribute("title")).toBe("Artifacts");
    // `package` 18
    const glyph = button()?.querySelector('svg[data-glyph="package"]');
    expect(glyph?.getAttribute("width")).toBe("18");
    act(() => setViewNow?.("history"));
    expect(circle()).not.toBeNull();
    act(() => setViewNow?.("assistant"));
    expect(circle()).not.toBeNull();
    act(() => setViewNow?.("canvas"));
    expect(circle()).toBeNull();
  });

  it("grows the pill's sheet on Artifacts through the frame's one value and folds it; opening it folds whatever was open, and anything opening folds it", () => {
    mount({ view: "godview" });
    act(() => button()?.click());
    expect(surfaceNow).toBe("artifacts");
    // the button whose shelf shows is on, and says what pressing it again does
    expect(button()?.getAttribute("aria-expanded")).toBe("true");
    expect(button()?.getAttribute("title")).toBe("Close  Esc");
    expect(button()?.getAttribute("aria-label")).toBe("Close the artifacts");
    // the sheet stands in its place, so it steps aside (its stylesheet's rows below)
    expect(circle()?.getAttribute("data-open")).toBe("true");
    act(() => button()?.click());
    expect(surfaceNow).toBeNull();
    expect(button()?.getAttribute("aria-expanded")).toBe("false");
    expect(button()?.getAttribute("title")).toBe("Artifacts");
    expect(circle()?.hasAttribute("data-open")).toBe(false);
    act(() => setSurfaceNow?.("palette"));
    act(() => button()?.click());
    expect(surfaceNow).toBe("artifacts");
    act(() => setSurfaceNow?.("me"));
    expect(button()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("wears the head's dot while an artifact's source is unavailable, with the sheet shut, and its words say which, or how many", () => {
    mount({ view: "history" });
    const dot = (): Element | null => button()?.querySelector(".vf-package-dot") ?? null;
    expect(dot()).toBeNull();
    // the head reads the catalog itself: the circle wears what it read, the Hub or no Hub
    act(() => setArtifactCatalog(catalog("vibe-field")));
    expect(surfaceNow).toBeNull();
    expect(dot()).not.toBeNull();
    // the words are the button's name; the dot only shows them
    expect(dot()?.getAttribute("aria-hidden")).toBe("true");
    expect(button()?.getAttribute("title")).toBe("Artifacts — vibe-field's source is unavailable");
    expect(button()?.getAttribute("aria-label")).toBe(
      "Artifacts — vibe-field's source is unavailable",
    );
    act(() => setArtifactCatalog(catalog("vibe-field", "sketchbook")));
    expect(button()?.getAttribute("title")).toBe("Artifacts — 2 sources unavailable");
    // a standing state only: nothing at all once the sources are back
    act(() => setArtifactCatalog(catalog()));
    expect(dot()).toBeNull();
    expect(button()?.getAttribute("title")).toBe("Artifacts");
  });

  it("takes the keyboard back when the sheet it grew folds with the keyboard inside it, and never from what took it", () => {
    mount({ view: "godview" });
    const inSheet = (): HTMLButtonElement | null =>
      host?.querySelector<HTMLButtonElement>("[data-in-sheet]") ?? null;
    act(() => button()?.focus());
    act(() => button()?.click());
    act(() => inSheet()?.focus());
    expect(document.activeElement).toBe(inSheet());
    // Esc, the sheet's: the owner folds it and the folded sheet is inert
    act(() => setSurfaceNow?.(foldSurface(surfaceNow, "artifacts")));
    expect(surfaceNow).toBeNull();
    expect(document.activeElement).toBe(button());
    // opened again, and the keyboard taken as it folds (the palette's field): it stays there
    act(() => button()?.click());
    const elsewhere = host?.querySelector<HTMLInputElement>("[data-elsewhere]") ?? null;
    act(() => elsewhere?.focus());
    act(() => setSurfaceNow?.("palette"));
    expect(document.activeElement).toBe(elsewhere);
    // a sheet the circle did not open gives the keyboard to nobody here
    act(() => setSurfaceNow?.("artifacts"));
    act(() => inSheet()?.focus());
    act(() => setSurfaceNow?.(null));
    expect(document.activeElement).not.toBe(button());
  });

  it("stands in the terminals' title bar while they are maximized — the same button, still opening the sheet — and steps out of it with search: out over 120 ms, back over 200, never apart (GV-D11)", () => {
    vi.useFakeTimers();
    try {
      mount({ view: "godview", search: true });
      const before = button();
      /** The circle's place and step — search's, at every moment. */
      const now = (): [string | null, string | null] => {
        const place = placeOf(".vf-package-circle");
        expect(place).toEqual(placeOf(".vf-peek-find"));
        return place;
      };
      expect(now()).toEqual([null, null]);
      // into the bar: at once, no step
      act(() => publishGodviewDeck("maximized"));
      expect(now()).toEqual(["true", null]);
      expect(button()).toBe(before);
      expect(host?.querySelectorAll(".vf-package-button")).toHaveLength(1);
      // from the bar it grows the same sheet
      act(() => button()?.click());
      expect(surfaceNow).toBe("artifacts");
      act(() => button()?.click());
      expect(surfaceNow).toBeNull();
      // out of it: the bar's control fades where it stands for 120 and the deck's two frames…
      act(() => publishGodviewDeck("up"));
      expect(now()).toEqual(["true", "out"]);
      act(() => vi.advanceTimersByTime(153));
      expect(now()).toEqual(["true", "out"]);
      // …then the head's circle fades in over 200
      act(() => vi.advanceTimersByTime(1));
      expect(now()).toEqual([null, "in"]);
      act(() => vi.advanceTimersByTime(199));
      expect(now()).toEqual([null, "in"]);
      act(() => vi.advanceTimersByTime(1));
      expect(now()).toEqual([null, null]);
      expect(button()).toBe(before);
      // maximized again mid-step: back in the bar at once
      act(() => publishGodviewDeck("maximized"));
      act(() => publishGodviewDeck("up"));
      act(() => vi.advanceTimersByTime(60));
      act(() => publishGodviewDeck("maximized"));
      expect(now()).toEqual(["true", null]);
      act(() => vi.advanceTimersByTime(400));
      expect(now()).toEqual(["true", null]);
      // in History it never stands in a bar, whatever the door says
      act(() => setViewNow?.("history"));
      expect(placeOf(".vf-package-circle")).toEqual([null, null]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes its place at once under reduced motion", () => {
    vi.useFakeTimers();
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      mount({ view: "godview" });
      act(() => publishGodviewDeck("maximized"));
      expect(placeOf(".vf-package-circle")).toEqual(["true", null]);
      act(() => publishGodviewDeck("up"));
      expect(placeOf(".vf-package-circle")).toEqual([null, null]);
    } finally {
      window.matchMedia = matchMedia;
      vi.useRealTimers();
    }
  });

  it("steps aside only while its sheet shows — the owner's one reading of the shelf — never for the frame between a change of view and the line's fold (ruling 6)", () => {
    mount();
    // the pill's sheet, open on Artifacts on Canvas…
    act(() => setSurfaceNow?.("artifacts"));
    // …as a cover rises: the owner holds `artifacts` until the line folds it, but no sheet shows
    act(() => setViewNow?.("godview"));
    expect(surfaceNow).toBe("artifacts");
    expect(circle()?.hasAttribute("data-open")).toBe(false);
    expect(button()?.getAttribute("aria-expanded")).toBe("false");
    // the same between two covers, the covered sheet folding as the view changes
    act(() => setSurfaceNow?.(null));
    act(() => button()?.click());
    expect(circle()?.getAttribute("data-open")).toBe("true");
    act(() => setViewNow?.("history"));
    expect(surfaceNow).toBe("artifacts");
    expect(circle()?.hasAttribute("data-open")).toBe(false);
  });

  it("is the frame's: ChromeLayer mounts it on the window's view, the one owner and its one reading of the shelf, before the head, so the sheet grows over the circle it came from (M1)", () => {
    const layer = readFileSync(join(SRC, "field", "ChromeLayer.tsx"), "utf8");
    /** An element's opening tag in the layer, its props one word each, however it is wrapped. */
    const tag = (name: string): { at: number; words: string[] } => {
      const at = layer.search(new RegExp(`<${name}\\s`, "u"));
      return { at, words: layer.slice(at, layer.indexOf("/>", at)).trim().split(/\s+/u) };
    };
    const circleTag = tag("PackageCircle");
    expect(circleTag.words).toEqual([
      "<PackageCircle",
      "view={view}",
      "surface={surface}",
      "shelf={shelf}",
      "onSurfaceChange={onSurfaceChange}",
    ]);
    const headTag = tag("Head");
    expect(circleTag.at).toBeGreaterThan(-1);
    expect(circleTag.at).toBeLessThan(headTag.at);
    // the head is handed the same reading, so the two never part (ruling 6)
    expect(headTag.words).toContain("shelf={shelf}");
    expect(headTag.words).toContain("surface={surface}");
  });
});

describe("the circle's stylesheet, held to DESIGN.md's entry", () => {
  it("stands it at the head's left — 40 at x 96, top 8, on the line's glass — above the cover with the line (62)", () => {
    const at = rule(".vf-package-circle");
    expect(at).toContain("position: absolute;");
    expect(at).toContain("z-index: 62;");
    expect(at).toContain("top: 8px;");
    expect(at).toContain("left: 96px;");
    expect(at).toContain("width: 40px;");
    expect(at).toContain("height: 40px;");
    expect(at).toContain("border-radius: 20px;");
    // the line's glass (§5), by day and by night
    expect(at).toContain(
      "background: color-mix(in srgb, var(--vf-chrome-solid) 88%, transparent);",
    );
    expect(at).toContain("backdrop-filter: blur(24px);");
    expect(at.replace(/\s+/g, " ")).toContain(
      "box-shadow: 0 0 0 1px var(--vf-hairline), var(--vf-shadow-island);",
    );
    const night = rule(".dark .vf-package-circle");
    expect(night).toContain("color-mix(in srgb, var(--vf-chrome-solid) 94%, transparent)");
    expect(night).toContain("0 0 0 1px var(--vf-hairline-strong)");
    expect(night).toContain("inset 0 1px 0 rgb(255 255 255 / 6%)");
    // `package` in secondary ink, primary under the pointer and while its sheet shows
    expect(rule(".vf-package-button")).toContain("color: var(--vf-text-secondary);");
    expect(sheet).toContain(
      '.vf-package-button:hover,\n.vf-package-button[aria-expanded="true"] {',
    );
    expect(ruleFrom(".vf-package-button:hover")).toContain("color: var(--vf-text-primary);");
  });

  it("puts the dot 7 in from the circle's top right: 6 across, orange, ringed 1.5 in the solid chrome", () => {
    const dot = rule(".vf-package-dot");
    expect(dot).toContain("top: 7px;");
    expect(dot).toContain("right: 7px;");
    expect(dot).toContain("width: 6px;");
    expect(dot).toContain("height: 6px;");
    expect(dot).toContain("background: var(--vf-orange);");
    expect(dot).toContain("box-shadow: 0 0 0 1.5px var(--vf-chrome-solid);");
  });

  it("folds into the bar's own controls' box at 96 — 30 × 24, corners 8, `package` 13 in the deck's ink at 64%, the full ink on a 10% fill — and its step out takes no pointer", () => {
    const bar = rule(".vf-package-circle[data-bar]");
    expect(bar).toContain("top: 3px;");
    expect(bar).toContain("width: var(--vf-godview-deck-control-width);");
    expect(bar).toContain("height: var(--vf-godview-deck-control-height);");
    expect(bar).toContain("border-radius: var(--vf-godview-deck-control-radius);");
    expect(bar).toContain("backdrop-filter: none;");
    expect(bar).toContain("box-shadow: none;");
    // the left keeps the circle's 96, clear of the lights
    expect(bar).not.toContain("left:");
    // the deck's ink, lent on the document while the terminals are maximized
    const ink = "var(--vf-godview-bar-ink, var(--vf-text-primary))";
    expect(rule(".vf-package-circle[data-bar] .vf-package-button")).toContain(
      `color: color-mix(in srgb, ${ink} 64%, transparent);`,
    );
    const hot = ruleFrom(".vf-package-circle[data-bar] .vf-package-button:hover");
    expect(hot).toContain(`color: ${ink};`);
    expect(hot.replace(/\s+/g, " ")).toContain(
      `background: color-mix( in srgb, ${ink} 10%, transparent );`,
    );
    const glyph = rule(".vf-package-circle[data-bar] .vf-package-button > .vf-glyph");
    expect(glyph).toContain("width: 13px;");
    expect(glyph).toContain("height: 13px;");
    const out = rule('.vf-package-circle[data-step="out"]');
    expect(out).toContain("opacity: 0;");
    expect(out).toContain("pointer-events: none;");
    expect(out).toContain("transition: opacity 120ms ease;");
    expect(rule('.vf-package-circle[data-step="in"]')).toContain(
      "animation: vf-package-fade 200ms ease;",
    );
  });

  it("steps aside while its sheet shows — at once, by opacity, so the keyboard can come back to it — and returns as the sheet's fold ends: 600 ms, 90 under reduced motion (M1)", () => {
    const aside = rule(".vf-package-circle[data-open]");
    expect(aside).toContain("opacity: 0;");
    expect(aside).toContain("pointer-events: none;");
    // never `visibility`: a hidden button cannot take the keyboard back
    expect(aside).not.toContain("visibility");
    expect(aside).not.toContain("transition");
    // back only once the fold is over, and never across the bar's own step
    expect(rule(".vf-package-circle:not([data-open]):not([data-step])")).toContain(
      "transition: opacity 0s linear 600ms;",
    );
    const reduced = sheet.slice(sheet.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced.replace(/\s+/g, " ")).toContain(
      ".vf-package-circle:not([data-open]):not([data-step]) { transition-delay: 90ms; }",
    );
  });

  it("is tokens only: no hex, and no curve of its own", () => {
    expect(sheet).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(sheet).not.toMatch(/cubic-bezier/);
  });
});
