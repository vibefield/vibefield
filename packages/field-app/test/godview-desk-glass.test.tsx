// @vitest-environment happy-dom
/**
 * The glass is the desk (TL-3, 2026-11-19; DESIGN.md §8 "The glass is the desk").
 *
 * Under the panes, in the deck's well, stands the desk's own still, so a pane's ground at its alpha is the only layer
 * over it. What is held here: where the picture is placed (from the still's resting box and the well's); when it is
 * wanted at all; that it is drawn once per still and only while wanted, as an object URL revoked at every way it can
 * stop being shown; that the well stands it under the panes; and that Settings' miniature stands its well on its own
 * stand-in canvas. Whether the desk reads right through a pane is a capture's to show, not a row's.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DeskStill, resetDeskStillForTest } from "../src/field/desk/desk-still";
import { DEFAULT_DECK_APPEARANCE } from "../src/godview/deck-appearance";
import {
  createDeskGlass,
  DeskGlass,
  type DeskGlassSeams,
  GLASS,
  glassPlacement,
  glassWanted,
} from "../src/godview/desk-glass";
import { GodviewStage } from "../src/godview/GodviewStage";
import { GodviewMiniature } from "../src/panels/terminal/GodviewMiniature";
import { BUILTIN_THEMES } from "../src/panels/terminal/theme-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const godview = readFileSync(join(PACKAGE_ROOT, "src/godview/godview.css"), "utf8");

/** One rule's body in `godview.css`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return godview.match(new RegExp(`^${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

/** The still's notice, stood in: what stands, and a word to every listener when it changes. */
function stillStandIn() {
  let current: DeskStill = { face: "none", generation: 0, canvas: null, width: 0, height: 0 };
  const listeners = new Set<() => void>();
  return {
    still: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** the same still, told again */
    tell() {
      for (const listener of listeners) listener();
    },
    show(face: DeskStill["face"]) {
      current =
        face === "still"
          ? {
              face,
              generation: current.generation + 1,
              canvas: document.createElement("canvas"),
              width: 2400,
              height: 1600,
            }
          : { face, generation: current.generation + 1, canvas: null, width: 0, height: 0 };
      for (const listener of listeners) listener();
    },
  };
}

/** The glass's seams over the stand-in: each draw is held until the row answers it, and every URL is counted. */
function seamsOver(notice: ReturnType<typeof stillStandIn>) {
  const draws: { readonly still: DeskStill; answer: (picture: Blob | null) => void }[] = [];
  const made: string[] = [];
  const revoked: string[] = [];
  let urls = 0;
  const seams: DeskGlassSeams = {
    still: notice.still,
    subscribe: notice.subscribe,
    draw: (still) =>
      new Promise<Blob | null>((resolve) => {
        draws.push({ still, answer: resolve });
      }),
    createUrl: () => {
      urls += 1;
      const url = `blob:glass-${urls}`;
      made.push(url);
      return url;
    },
    revokeUrl: (url) => {
      revoked.push(url);
    },
  };
  return { seams, draws, made, revoked };
}

const PICTURE = new Blob(["jpeg"], { type: GLASS.pictureType });

/** Let the draws' answers reach the glass. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("where the desk's picture stands in the well (TL-3)", () => {
  it("places the still's resting box in the well's coordinates", () => {
    const still = { left: 0, top: 0, width: 1200, height: 800 };
    const well = { left: 8, top: 330, width: 1184, height: 462 };
    // receded: 0.98 about its centre, 12 and 8 in from its edges
    expect(glassPlacement(still, 0.98, well)).toEqual({ x: 4, y: -322, width: 1176, height: 784 });
    // whole (Reduce motion keeps the still at 1)
    expect(glassPlacement(still, 1, well)).toEqual({ x: -8, y: -330, width: 1200, height: 800 });
  });

  it("wants the desk only while Godview shows panes that are not solid, and never under Reduce transparency", () => {
    expect(glassWanted(true, 0.82, false)).toBe(true);
    expect(glassWanted(false, 0.82, false)).toBe(false);
    expect(glassWanted(true, 1, false)).toBe(false);
    expect(glassWanted(true, 0.82, true)).toBe(false);
  });
});

describe("the desk's picture: drawn once per still while wanted, revoked at every end (TL-3)", () => {
  it("draws nothing at all while the glass is not wanted", async () => {
    const notice = stillStandIn();
    const { seams, draws, made } = seamsOver(notice);
    const glass = createDeskGlass(seams);
    notice.show("still");
    await settle();
    expect(draws).toHaveLength(0);
    expect(made).toHaveLength(0);
    expect(glass.face()).toBeNull();
    glass.dispose();
  });

  it("draws one picture per still, at a quarter of its size, and shows it once drawn", async () => {
    const notice = stillStandIn();
    const { seams, draws, made } = seamsOver(notice);
    const glass = createDeskGlass(seams);
    notice.show("still");
    glass.want(true);
    expect(draws).toHaveLength(1);
    expect(GLASS.pictureScale).toBe(0.25);
    draws[0]?.answer(PICTURE);
    await settle();
    expect(made).toEqual(["blob:glass-1"]);
    expect(glass.face()).toEqual({ kind: "picture", url: "blob:glass-1" });
    // the same still told again draws nothing more
    notice.tell();
    expect(draws).toHaveLength(1);
    expect(glass.face()).toEqual({ kind: "picture", url: "blob:glass-1" });
    glass.dispose();
  });

  it("revokes a picture when a newer still replaces it, once the newer one is drawn", async () => {
    const notice = stillStandIn();
    const { seams, draws, revoked } = seamsOver(notice);
    const glass = createDeskGlass(seams);
    notice.show("still");
    glass.want(true);
    draws[0]?.answer(PICTURE);
    await settle();
    notice.show("still");
    expect(draws).toHaveLength(2);
    // the one held stands until its replacement is drawn
    expect(glass.face()).toEqual({ kind: "picture", url: "blob:glass-1" });
    expect(revoked).toEqual([]);
    draws[1]?.answer(PICTURE);
    await settle();
    expect(glass.face()).toEqual({ kind: "picture", url: "blob:glass-2" });
    expect(revoked).toEqual(["blob:glass-1"]);
    glass.dispose();
  });

  it("revokes it when the cover drops its still", async () => {
    const notice = stillStandIn();
    const { seams, draws, revoked } = seamsOver(notice);
    const glass = createDeskGlass(seams);
    notice.show("still");
    glass.want(true);
    draws[0]?.answer(PICTURE);
    await settle();
    notice.show("none");
    expect(revoked).toEqual(["blob:glass-1"]);
    expect(glass.face()).toBeNull();
    glass.dispose();
  });

  it("revokes it when the cover stands on the mat's ground, and stands the well on the ground too", async () => {
    const notice = stillStandIn();
    const { seams, draws, revoked } = seamsOver(notice);
    const glass = createDeskGlass(seams);
    notice.show("still");
    glass.want(true);
    draws[0]?.answer(PICTURE);
    await settle();
    notice.show("ground");
    expect(revoked).toEqual(["blob:glass-1"]);
    expect(glass.face()).toEqual({ kind: "ground" });
    glass.dispose();
  });

  it("revokes it when the glass is no longer wanted (Godview lowered, the panes solid, Reduce transparency)", async () => {
    const notice = stillStandIn();
    const { seams, draws, made, revoked } = seamsOver(notice);
    const glass = createDeskGlass(seams);
    notice.show("still");
    glass.want(true);
    draws[0]?.answer(PICTURE);
    await settle();
    glass.want(false);
    expect(revoked).toEqual(["blob:glass-1"]);
    expect(glass.face()).toBeNull();
    // wanted again over the same still: drawn anew
    glass.want(true);
    expect(draws).toHaveLength(2);
    draws[1]?.answer(PICTURE);
    await settle();
    expect(made).toEqual(["blob:glass-1", "blob:glass-2"]);
    glass.dispose();
    expect(revoked).toEqual(["blob:glass-1", "blob:glass-2"]);
  });

  it("revokes it when the well goes, and never makes a URL of a picture drawn after", async () => {
    const notice = stillStandIn();
    const { seams, draws, made, revoked } = seamsOver(notice);
    const glass = createDeskGlass(seams);
    notice.show("still");
    glass.want(true);
    glass.dispose();
    draws[0]?.answer(PICTURE);
    await settle();
    expect(made).toEqual([]);
    expect(revoked).toEqual([]);
    expect(glass.face()).toBeNull();
  });

  it("never makes a URL of a picture that comes after its still was dropped or the glass let go", async () => {
    const notice = stillStandIn();
    const { seams, draws, made } = seamsOver(notice);
    const glass = createDeskGlass(seams);
    notice.show("still");
    glass.want(true);
    notice.show("none");
    draws[0]?.answer(PICTURE);
    await settle();
    expect(made).toEqual([]);
    notice.show("still");
    glass.want(false);
    draws[1]?.answer(PICTURE);
    await settle();
    expect(made).toEqual([]);
    glass.dispose();
  });

  it("stands the well on the mat's ground when the still drew nothing", async () => {
    const notice = stillStandIn();
    const { seams, draws, made } = seamsOver(notice);
    const glass = createDeskGlass(seams);
    notice.show("still");
    glass.want(true);
    draws[0]?.answer(null);
    await settle();
    expect(made).toEqual([]);
    expect(glass.face()).toEqual({ kind: "ground" });
    glass.dispose();
  });
});

describe("the well stands on the desk (TL-3)", () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    resetDeskStillForTest();
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
    resetDeskStillForTest();
    vi.restoreAllMocks();
  });

  it("stands the glass first in the well, under the panes, and says what it stands on", async () => {
    const notice = stillStandIn();
    const { seams, draws } = seamsOver(notice);
    notice.show("still");
    root = createRoot(host);
    act(() =>
      root?.render(
        <GodviewStage
          open
          theme="light"
          tuningOpen={false}
          animations={false}
          wellGround={<DeskGlass wanted seams={seams} />}
          deck={<div className="the-panes" />}
        />,
      ),
    );
    expect(draws).toHaveLength(1);
    await act(async () => {
      draws[0]?.answer(PICTURE);
      await settle();
    });
    const well = host.querySelector(".vf-godview-deck-well");
    const glass = well?.firstElementChild as HTMLElement | null;
    expect(glass?.className).toBe("vf-godview-deck-glass");
    expect(glass?.dataset.glass).toBe("picture");
    expect(glass?.getAttribute("aria-hidden")).toBe("true");
    expect(glass?.style.backgroundImage).toContain("blob:glass-1");
    expect(glass?.nextElementSibling?.className).toBe("vf-godview-terminal-deck-body");
  });

  it("draws the glass as the well's ground: the picture over the mat's ground, never a backdrop filter", () => {
    const glass = rule(".vf-godview-deck-glass");
    expect(glass).toContain("position: absolute;");
    expect(glass).toContain("inset: 0;");
    expect(glass).toContain("border-radius: inherit;");
    expect(glass).toContain("background-color: var(--vf-mat-ground);");
    expect(glass).toContain("background-repeat: no-repeat;");
    expect(glass).toContain(
      "background-position: var(--vf-godview-glass-x, 0) var(--vf-godview-glass-y, 0);",
    );
    expect(glass).toContain(
      "background-size: var(--vf-godview-glass-w, 100%) var(--vf-godview-glass-h, 100%);",
    );
    expect(glass).toContain("pointer-events: none;");
    expect(glass).not.toMatch(/filter/);
  });

  it("stands Settings' miniature's well on its own stand-in canvas while its panes are glass", () => {
    root = createRoot(host);
    const draw = (opacity: number): void =>
      act(() =>
        root?.render(
          <GodviewMiniature
            variant="window"
            mode="light"
            theme={BUILTIN_THEMES.light}
            palette={Array.from({ length: 16 }, () => "#808080")}
            appearance={{ ...DEFAULT_DECK_APPEARANCE, opacity }}
          />,
        ),
      );
    draw(0.82);
    const mini = host.querySelector(".vf-ts-mini");
    const glass = mini?.querySelector(".vf-godview-deck-well > .vf-ts-mini-glass") ?? null;
    expect(glass, "the well's ground").not.toBeNull();
    expect(glass?.querySelector(".vf-ts-mini-field") ?? null).not.toBeNull();
    expect(glass?.nextElementSibling?.className).toBe("vf-godview-terminal-deck-body");
    // the window variant's well stands under the 100 of monitor and the Lip's 30
    expect((glass as HTMLElement | null)?.style.getPropertyValue("--vf-ts-mini-glass-top")).toBe(
      "-130px",
    );
    draw(1);
    expect(host.querySelector(".vf-ts-mini-glass")).toBeNull();
  });
});
