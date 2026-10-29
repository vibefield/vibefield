// @vitest-environment happy-dom
/**
 * The edge tray (DESIGN.md §8 edge trays; One Frame FR-4): the notch and its drawer drawn from
 * the wall, the sliver over a covered view, the drawer's grammar on the frame's one owner, and
 * Artifacts' Hub behind the right notch. The right edge's alone since the left edge's clipboard
 * retired into the hand (track HN — `cards.test.tsx`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginSurfaceProps } from "@vibefield/plugin-sdk";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameSurface } from "../src/frame/frame-surface";
import {
  ArtifactsTray,
  SLIVER_GROW_MS,
  TRAY_CLOSE_GRACE_MS,
  TRAY_OPEN_DELAY_MS,
} from "../src/hud/edge-tray/EdgeTray";
import { EdgeTrayView } from "../src/hud/edge-tray/EdgeTrayView";
import {
  DRAWER_FILLET,
  drawerLinePath,
  drawerSpec,
  NOTCH,
  notchGap,
  notchHeight,
  notchPath,
  SLIVER,
  sliverPath,
} from "../src/hud/edge-tray/notch-path";
import {
  getSurfacesSnapshot,
  register,
  type SurfaceEntry,
} from "../src/plugin-host/surface-registry";

vi.mock("../src/plugin-host/plugin-registry-store", () => ({
  usePluginRegistrySnapshot: () => null,
}));

const TRAY_CSS = readFileSync(join(process.cwd(), "src/hud/edge-tray/edge-tray.css"), "utf8");
const CHROME = readFileSync(join(process.cwd(), "src/field/ChromeLayer.tsx"), "utf8");

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
  surfaceNow = null;
  setSurfaceNow = null;
  vi.useRealTimers();
});

/** The frame's ONE owner of the open surface, where FieldView holds it: the
 * tray asks it, and the test reads and moves it. */
let surfaceNow: FrameSurface | null = null;
let setSurfaceNow: ((next: FrameSurface | null) => void) | null = null;
function Owned({ sliver = false }: { sliver?: boolean }): ReactElement {
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  surfaceNow = surface;
  setSurfaceNow = setSurface;
  return (
    <ArtifactsTray
      surface={surface}
      onSurfaceChange={setSurface}
      sliver={sliver}
      windowId="field"
    />
  );
}

/** The Artifact Hub's stand-in: a side-panel contribution whose button closes it. */
function HubSurface(props: PluginSurfaceProps): ReactElement {
  return (
    <button
      type="button"
      className="hub-close"
      onClick={props.slot === "hud.side-panel" ? props.requestClose : undefined}
    >
      Plugin panel content
    </button>
  );
}

function bindHub(pluginId = "vibefield.test-panel"): SurfaceEntry {
  const surfaceId = `${pluginId}.artifacts`;
  const disposable = register(pluginId, surfaceId, "hud.side-panel", HubSurface, 100, "Artifacts");
  disposeEntries.push(() => disposable.dispose());
  const entry = getSurfacesSnapshot().find((candidate) => candidate.surfaceId === surfaceId);
  if (entry === undefined) throw new Error("test side panel did not bind");
  return entry;
}

function mount(node: ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

/** React derives onPointerEnter/Leave from pointerover/pointerout pairs. */
function enter(tray: HTMLElement): void {
  act(() => {
    tray.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: null }));
  });
}
function leave(tray: HTMLElement): void {
  act(() => {
    tray.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
    );
  });
}

/** A rule's body in the tray's stylesheet. */
function rule(selector: string): string {
  const from = TRAY_CSS.indexOf(`${selector} {`);
  return from < 0 ? "" : TRAY_CSS.slice(from, TRAY_CSS.indexOf("}", from));
}

describe("the notch's geometry (N1 / P4, as ruled 2026-09-23)", () => {
  it("draws the notch as one path from the wall — fillet 12, face 14, 26 × 116", () => {
    expect(notchHeight(NOTCH)).toBe(116);
    expect(notchPath(NOTCH, true)).toBe(
      "M0 0A12 12 0 0 0 12 12H12A14 14 0 0 1 26 26V90A14 14 0 0 1 12 104H12A12 12 0 0 0 0 116Z",
    );
    expect(notchPath(NOTCH, false).endsWith("Z")).toBe(false);
  });

  it("draws the sliver with the same builder — 7 × 96, a fillet of 5, a face of 2 (One Frame §10)", () => {
    expect(notchHeight(SLIVER)).toBe(96);
    expect(notchPath(SLIVER, true)).toBe(
      "M0 0A5 5 0 0 0 5 5H5A2 2 0 0 1 7 7V89A2 2 0 0 1 5 91H5A5 5 0 0 0 0 96Z",
    );
    // Centred in the notch's 26 × 116 frame, the frame the drawing keeps.
    expect(sliverPath(true)).toBe(
      "M0 10A5 5 0 0 0 5 15H5A2 2 0 0 1 7 17V99A2 2 0 0 1 5 101H5A5 5 0 0 0 0 106Z",
    );
    // One path into the other: the same commands, one for one — what lets
    // the morph travel (DESIGN.md §6).
    const commands = (d: string): string => d.replace(/[^A-Za-z]/g, "");
    expect(commands(sliverPath(true))).toBe(commands(notchPath(NOTCH, true)));
    expect(commands(sliverPath(false))).toBe(commands(notchPath(NOTCH, false)));
  });

  it("draws the drawer with the same builder and gaps its hairline under the notch", () => {
    const spec = drawerSpec(152, 652);
    const gap = notchGap(652);
    // centred on the panel: the path starts one fillet above it
    expect(gap).toEqual([DRAWER_FILLET + 326 - 58, DRAWER_FILLET + 326 + 58]);
    const line = drawerLinePath(spec, gap);
    expect(line).toContain(`V${gap[0]}M152 ${gap[1]}V`);
    expect(line.startsWith("M0 0A18 18 0 0 0 18 18H130A22 22 0 0 1 152 40")).toBe(true);
    expect(drawerLinePath(spec, null)).toBe(notchPath(spec, false));
  });
});

describe("EdgeTrayView — the right edge", () => {
  it("draws Artifacts' notch — the package, no count — and the drawer's one column holding its content", () => {
    const el = mount(
      <EdgeTrayView
        label="Artifacts"
        open={true}
        pinned={true}
        content={<p className="hub">the Hub</p>}
        hint="Artifacts"
        onNubClick={() => {}}
        onPointerEnter={() => {}}
        onPointerLeave={() => {}}
      />,
    );
    const tray = el.querySelector<HTMLElement>(".vf-edge-tray");
    expect(tray?.dataset.side).toBe("right");
    expect(tray?.dataset.hudFlight).toBe("right");
    expect(tray?.dataset.pinned).toBe("true");
    const nub = tray?.querySelector(".vf-edge-tray__nub");
    expect(nub?.getAttribute("aria-pressed")).toBe("true");
    expect(nub?.querySelector("[data-glyph]")?.getAttribute("data-glyph")).toBe("package");
    expect(nub?.querySelector(".vf-edge-tray__count")).toBeNull();
    expect(tray?.querySelector(".vf-edge-tray__shape-fill")?.getAttribute("d")).toBe(
      notchPath(NOTCH, true),
    );
    const list = tray?.querySelector(".vf-edge-tray__list");
    expect(list?.hasAttribute("data-content")).toBe(true);
    expect(list?.querySelector(".hub")?.textContent).toBe("the Hub");
    // the left edge's drawer retired into the hand: none of its pieces are left
    expect(el.querySelector('.vf-edge-tray[data-side="left"]')).toBeNull();
    expect(TRAY_CSS).not.toMatch(/__(?:tile|snap|ghost|count|group|filter)\b/u);
    expect(TRAY_CSS).not.toContain('[data-side="left"]');
  });
});

describe("the sliver — a notch over a covered view (One Frame §10, FR-4)", () => {
  const view = (sliver: boolean, open = false): HTMLElement =>
    mount(
      <EdgeTrayView
        label="Artifacts"
        open={open}
        pinned={open}
        sliver={sliver}
        content={null}
        hint="Artifacts"
        onNubClick={() => {}}
        onPointerEnter={() => {}}
        onPointerLeave={() => {}}
      />,
    );

  it("rests as a sliver over a covered view, whole on Canvas, and never while its drawer is open", () => {
    expect(view(true).querySelector(".vf-edge-tray__nub")?.hasAttribute("data-sliver")).toBe(true);
    act(() => root?.unmount());
    root = null;
    expect(view(false).querySelector(".vf-edge-tray__nub")?.hasAttribute("data-sliver")).toBe(
      false,
    );
    act(() => root?.unmount());
    root = null;
    expect(view(true, true).querySelector(".vf-edge-tray__nub")?.hasAttribute("data-sliver")).toBe(
      false,
    );
  });

  it("hands its CSS both drawings, so ONE path morphs between them", () => {
    const nub = view(true).querySelector<HTMLElement>(".vf-edge-tray__nub");
    expect(nub?.style.getPropertyValue("--vf-sliver-fill")).toBe(`path("${sliverPath(true)}")`);
    expect(nub?.style.getPropertyValue("--vf-sliver-line")).toBe(`path("${sliverPath(false)}")`);
    expect(nub?.style.getPropertyValue("--vf-notch-fill")).toBe(
      `path("${notchPath(NOTCH, true)}")`,
    );
    expect(nub?.style.getPropertyValue("--vf-notch-line")).toBe(
      `path("${notchPath(NOTCH, false)}")`,
    );
  });

  it("is drawn 7 × 96 in the 8 px gutter, its hit box the sliver, and grows in 240 ms on the island curve", () => {
    const resting = ".vf-edge-tray__nub[data-sliver]:not(:hover, :focus-visible)";
    expect(rule(resting)).toContain("width: 8px;");
    expect(rule(resting)).toContain("height: 96px;");
    // No wider target at rest: a pane's text beside it never takes a stray press.
    expect(rule(`${resting}::after`)).toContain("content: none;");
    expect(rule(`${resting} .vf-edge-tray__shape-fill`)).toContain("d: var(--vf-sliver-fill);");
    expect(rule(".vf-edge-tray__nub[data-sliver] .vf-edge-tray__shape-fill")).toContain(
      "d: var(--vf-notch-fill);",
    );
    expect(TRAY_CSS).toContain("transition: d 240ms var(--vf-ease-island);");
    expect(rule(".vf-edge-tray__nub")).toContain("width 240ms var(--vf-ease-island)");
    // The glyph hidden at rest.
    expect(rule(`${resting} .vf-edge-tray__glyph`)).toContain("opacity: 0;");
    // The drawing keeps the notch's frame whatever the nub's box is.
    expect(rule(".vf-edge-tray__shape")).toContain("width: var(--vf-nub-w);");
    expect(rule(".vf-edge-tray__shape")).toContain("height: var(--vf-nub-h);");
  });

  it("stands above the cover with the line — the frame's edge, not the canvas's", () => {
    expect(rule(".vf-edge-tray")).toContain("z-index: 62;");
  });

  it("opens its drawer only once it IS the notch: the growth, then the notch's own delay", () => {
    vi.useFakeTimers();
    bindHub();
    const el = mount(<Owned sliver />);
    const tray = el.querySelector(".vf-edge-tray") as HTMLElement;
    enter(tray);
    act(() => {
      vi.advanceTimersByTime(TRAY_OPEN_DELAY_MS + 1);
    });
    expect(tray.getAttribute("data-open")).toBe("false");
    act(() => {
      vi.advanceTimersByTime(SLIVER_GROW_MS);
    });
    expect(tray.getAttribute("data-open")).toBe("true");
    expect(surfaceNow).toBe("artifacts");
  });
});

describe("the edge on the frame's one owner (One Frame FR-4, F11)", () => {
  it("is mounted by ChromeLayer on the owner, resting as a sliver under a cover — and the side panel and the left tray are gone", () => {
    expect(CHROME).toMatch(
      /<ArtifactsTray\s+surface=\{surface\}\s+onSurfaceChange=\{onSurfaceChange\}\s+sliver=\{covered\}/u,
    );
    expect(CHROME).not.toContain("ClipboardTray");
    expect(CHROME).not.toContain("SidePanel");
    // …and the head's right cluster with it: the readout alone (FR-4, F10).
    expect(CHROME).not.toContain("aside=");
  });

  it("holds its drawer in the one value: opening it folds the others, and another opening folds it and its pin", () => {
    bindHub();
    const el = mount(<Owned />);
    const tray = el.querySelector('.vf-edge-tray[data-side="right"]') as HTMLElement;
    act(() => setSurfaceNow?.("palette"));
    act(() => (tray.querySelector(".vf-edge-tray__nub") as HTMLButtonElement).click());
    expect(surfaceNow).toBe("artifacts");
    expect(tray.dataset.pinned).toBe("true");
    act(() => setSurfaceNow?.("zoom"));
    expect(tray.dataset.open).toBe("false");
    // A fold from outside takes the pin with it.
    expect(tray.dataset.pinned).toBe("false");
    act(() => setSurfaceNow?.(null));
    expect(tray.dataset.open).toBe("false");
  });

  it("never folds, from a stale timer, a surface that opened since", () => {
    vi.useFakeTimers();
    bindHub();
    const el = mount(<Owned />);
    const tray = el.querySelector(".vf-edge-tray") as HTMLElement;
    enter(tray);
    act(() => {
      vi.advanceTimersByTime(TRAY_OPEN_DELAY_MS + 1);
    });
    expect(surfaceNow).toBe("artifacts");
    leave(tray);
    act(() => setSurfaceNow?.("palette"));
    act(() => {
      vi.advanceTimersByTime(TRAY_CLOSE_GRACE_MS + 1);
    });
    expect(surfaceNow).toBe("palette");
  });

  it("opens after the hover delay, closes after the grace, and a click pins", () => {
    vi.useFakeTimers();
    bindHub();
    const el = mount(<Owned />);
    const tray = el.querySelector(".vf-edge-tray") as HTMLElement;
    const nub = el.querySelector(".vf-edge-tray__nub") as HTMLButtonElement;
    expect(tray.getAttribute("data-open")).toBe("false");
    enter(tray);
    act(() => {
      vi.advanceTimersByTime(TRAY_OPEN_DELAY_MS - 1);
    });
    expect(tray.getAttribute("data-open")).toBe("false");
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(tray.getAttribute("data-open")).toBe("true");
    leave(tray);
    act(() => {
      vi.advanceTimersByTime(TRAY_CLOSE_GRACE_MS + 1);
    });
    expect(tray.getAttribute("data-open")).toBe("false");

    act(() => nub.click());
    expect(tray.getAttribute("data-pinned")).toBe("true");
    expect(tray.getAttribute("data-open")).toBe("true");
    leave(tray);
    act(() => {
      vi.advanceTimersByTime(TRAY_CLOSE_GRACE_MS + 1);
    });
    expect(tray.getAttribute("data-open")).toBe("true");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(tray.getAttribute("data-pinned")).toBe("false");
    expect(tray.getAttribute("data-open")).toBe("false");
  });

  it("stays open while it holds the keyboard; Escape folds it and gives focus back to its notch", () => {
    vi.useFakeTimers();
    bindHub();
    const el = mount(<Owned />);
    const tray = el.querySelector(".vf-edge-tray") as HTMLElement;
    enter(tray);
    act(() => {
      vi.advanceTimersByTime(TRAY_OPEN_DELAY_MS + 1);
    });
    (el.querySelector(".hub-close") as HTMLElement).focus();
    leave(tray);
    act(() => {
      vi.advanceTimersByTime(TRAY_CLOSE_GRACE_MS + 1);
    });
    expect(tray.dataset.open).toBe("true");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(tray.dataset.open).toBe("false");
    expect(surfaceNow).toBeNull();
    expect(document.activeElement).toBe(el.querySelector(".vf-edge-tray__nub"));
  });
});

describe("ArtifactsTray — the Hub behind the right notch (One Frame FR-4, FC-D10)", () => {
  it("draws no notch while nothing offers the Hub — a door to nothing would be a lie", () => {
    const el = mount(<Owned />);
    expect(el.querySelector('.vf-edge-tray[data-side="right"]')).toBeNull();
  });

  it("holds the side panel's contents in its drawer — package, no count — and folds on the Hub's own close", async () => {
    vi.useFakeTimers();
    bindHub();
    const el = mount(<Owned />);
    const right = el.querySelector('.vf-edge-tray[data-side="right"]') as HTMLElement;
    const nub = right.querySelector(".vf-edge-tray__nub") as HTMLButtonElement;
    expect(nub.getAttribute("aria-label")).toBe("Artifacts");
    expect(nub.querySelector("[data-glyph]")?.getAttribute("data-glyph")).toBe("package");
    expect(nub.querySelector(".vf-edge-tray__count")).toBeNull();
    // The Hub mounts only for an open drawer…
    expect(right.textContent).not.toContain("Plugin panel content");
    act(() => nub.click());
    expect(surfaceNow).toBe("artifacts");
    const scope = right.querySelector<HTMLElement>('[data-vf-plugin="vibefield.test-panel"]');
    expect(scope?.textContent).toBe("Plugin panel content");
    // …in the drawer's column, a container its narrow form answers.
    expect(right.querySelector(".vf-edge-tray__list")?.hasAttribute("data-content")).toBe(true);
    act(() => (right.querySelector(".hub-close") as HTMLButtonElement).click());
    expect(surfaceNow).toBeNull();
    // …and stays through the drawer's travel out, so it never slides away empty.
    expect(right.textContent).toContain("Plugin panel content");
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(right.textContent).not.toContain("Plugin panel content");
  });

  it("folds when the Hub is unbound — disabled or reloading — and its notch goes with it", () => {
    const entry = bindHub();
    const el = mount(<Owned />);
    act(() =>
      (
        el.querySelector('.vf-edge-tray[data-side="right"] .vf-edge-tray__nub') as HTMLButtonElement
      ).click(),
    );
    expect(surfaceNow).toBe("artifacts");
    act(() => {
      for (const dispose of disposeEntries.splice(0)) dispose();
    });
    expect(getSurfacesSnapshot().some((s) => s.surfaceId === entry.surfaceId)).toBe(false);
    expect(surfaceNow).toBeNull();
    expect(el.querySelector('.vf-edge-tray[data-side="right"]')).toBeNull();
  });

  it("refuses a second v1 side-panel contribution until the first unbinds", () => {
    bindHub("vibefield.first-panel");
    expect(() =>
      register(
        "vibefield.second-panel",
        "vibefield.second-panel.artifacts",
        "hud.side-panel",
        HubSurface,
      ),
    ).toThrow(/already has its one v1 contribution/);
  });
});
