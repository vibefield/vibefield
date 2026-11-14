// @vitest-environment happy-dom
/**
 * Item 403 — the press in the catalog (DESIGN.md §5 "the press"; docs/UI_SYSTEM.md, the fixture adapter): the catalog's
 * hand wears the print the shipping hook makes, for the page's own theme, handed to it as a host hands the product its
 * own, at the window's pixel density and at a held card's 2.4×; and where the press prints nothing (WebGL2 refused),
 * the flat stock. The press itself is card-press.test's; here it answers as a stand-in.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardsPress } from "../src/design-system/CardsPreview";
import type { PrintSpec } from "../src/frame/cards/press/press";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const printStock = vi.hoisted(() => vi.fn<(spec: PrintSpec) => Promise<string | null>>());
vi.mock("../src/frame/cards/press/press", () => ({ printStock }));

/** The four prints the hook puts on the root. */
const PROPS = [
  "--vf-card-print-front",
  "--vf-card-print-back",
  "--vf-card-print-front-held",
  "--vf-card-print-back-held",
] as const;

const mounted: Root[] = [];

beforeEach(() => {
  // the window is idle at once: the hook prints when it is
  vi.stubGlobal("requestIdleCallback", (task: () => void) => {
    task();
    return 1;
  });
  vi.stubGlobal("cancelIdleCallback", () => undefined);
  printStock.mockImplementation(
    async (asked) => `blob:${asked.side}@${asked.density}:${asked.night ? "night" : "day"}`,
  );
});

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  const html = document.documentElement;
  for (const name of PROPS) html.style.removeProperty(name);
  delete html.dataset.vfCardPrint;
  printStock.mockReset();
  vi.unstubAllGlobals();
});

function mount(dark: boolean): Root {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CardsPress dark={dark} />));
  mounted.push(root);
  return root;
}

const spec = (side: "front" | "back", density: number, night: boolean): PrintSpec => ({
  side,
  width: 120,
  height: 168,
  density,
  night,
});

describe("the catalog's cards wear the press's print (item 403)", () => {
  it("prints for the page's theme, at the window's density and a held card's 2.4×, and puts the prints on the root", async () => {
    mount(true);
    const html = document.documentElement;
    await vi.waitFor(() => expect(html.dataset.vfCardPrint).toBe("ready"));
    const density = window.devicePixelRatio || 1;
    expect(printStock.mock.calls.map(([asked]) => asked)).toEqual([
      spec("front", density, true),
      spec("back", density, true),
      spec("front", density * 2.4, true),
      spec("back", density * 2.4, true),
    ]);
    expect(html.style.getPropertyValue("--vf-card-print-front")).toBe(
      `url("blob:front@${density}:night")`,
    );
    expect(html.style.getPropertyValue("--vf-card-print-back-held")).toBe(
      `url("blob:back@${density * 2.4}:night")`,
    );
  });

  it("prints again when the page's theme turns: the page's, never the app's", async () => {
    const root = mount(false);
    const html = document.documentElement;
    await vi.waitFor(() => expect(html.dataset.vfCardPrint).toBe("ready"));
    expect(printStock.mock.calls.every(([asked]) => !asked.night)).toBe(true);
    act(() => root.render(<CardsPress dark />));
    await vi.waitFor(() =>
      expect(html.style.getPropertyValue("--vf-card-print-front")).toMatch(/:night"\)$/u),
    );
    expect(printStock.mock.calls.filter(([asked]) => asked.night)).toHaveLength(4);
  });

  it("keeps the flat stock where the press prints nothing — WebGL2 refused", async () => {
    printStock.mockResolvedValue(null);
    const html = document.documentElement;
    // a print from before stands on the root until the press answers
    html.dataset.vfCardPrint = "ready";
    html.style.setProperty("--vf-card-print-front", 'url("blob:before")');
    mount(false);
    await vi.waitFor(() => expect(html.dataset.vfCardPrint).toBeUndefined());
    expect(printStock).toHaveBeenCalledTimes(4);
    for (const name of PROPS) expect(html.style.getPropertyValue(name)).toBe("");
  });
});
