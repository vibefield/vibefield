// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { placeBuds } from "../src/frame/cards/bloom/bloom-geometry";
import type { BloomModel } from "../src/frame/cards/bloom/bloom-model";
import { CardBloomView } from "../src/frame/cards/bloom/CardBloomView";

// THE CARD'S BLOOM, DRAWN (OB-D2, OB-D12 A; DESIGN.md §8 "The hand"): it renders the landing table's model and authors
// no rule or reason of its own.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MODEL: BloomModel = {
  where: "claude·2 · Godview",
  hub: "live",
  onlyFit: null,
  buds: [
    {
      face: "live",
      type: "ref",
      label: "Live",
      verb: "Hand over",
      noun: "the live map",
      lands: true,
    },
    {
      face: "outline",
      type: "text",
      label: "Outline",
      verb: "Paste",
      noun: "its outline",
      lands: true,
    },
    {
      face: "opml",
      type: "file",
      label: "OPML",
      verb: "Paste",
      noun: "the OPML's path",
      lands: true,
    },
    {
      face: "picture",
      type: "image",
      label: "Picture",
      verb: "Paste",
      noun: "the picture's path",
      lands: false,
      reason: "This pane can't take a picture yet",
    },
  ],
};

const AT = { x: 590, y: 400 };
const FIELD = { width: 1180, height: 780 };

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function mount(choose = vi.fn(), settleMs = 0) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      createElement(CardBloomView, { model: MODEL, at: AT, field: FIELD, choose, settleMs }),
    ),
  );
  return { el: host, choose };
}

const buds = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(".vf-card-bloom-bud")];
const on = (el: HTMLElement) => el.querySelector<HTMLElement>(".vf-card-bloom-bud[data-on]");
const key = (k: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
const say = (el: HTMLElement) => ({
  verb: el.querySelector(".vf-card-bloom-verb")?.textContent,
  noun: el.querySelector(".vf-card-bloom-noun")?.textContent,
});
const pointAt = (type: string, x: number, y: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
  });

describe("the card's bloom", () => {
  it("draws every face in the card's order, wearing its type's glyph", () => {
    const { el } = mount();
    expect(buds(el).map((b) => b.dataset.face)).toEqual(["live", "outline", "opml", "picture"]);
    expect(
      buds(el).map((b) => b.querySelector("[data-glyph]")?.getAttribute("data-glyph")),
    ).toEqual(["type-ref", "type-text", "document", "type-image"]);
  });

  it("opens on the hub, saying what choosing it does and where it lands", () => {
    const { el } = mount();
    expect(on(el)?.dataset.face).toBe("live");
    expect(say(el)).toEqual({ verb: "Hand over", noun: "the live map" });
    expect(el.querySelector(".vf-card-bloom-where")?.textContent).toBe("claude·2 · Godview");
    expect(el.querySelector(".vf-card-bloom-words")?.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps a face that can't land in its place, faint, with the table's reason", () => {
    const { el } = mount();
    const faint = buds(el)[3];
    expect(faint?.hasAttribute("data-faint")).toBe(true);
    expect(faint?.getAttribute("aria-disabled")).toBe("true");
    expect(el.textContent).toContain("This pane can't take a picture yet");
    expect(buds(el)[0]?.hasAttribute("data-faint")).toBe(false);
  });

  it("walks with the arrows and takes with Return", () => {
    const { el, choose } = mount();
    key("ArrowRight");
    expect(on(el)?.dataset.face).toBe("outline");
    expect(say(el)).toEqual({ verb: "Paste", noun: "its outline" });
    key("Enter");
    expect(choose).toHaveBeenCalledExactlyOnceWith("outline");
  });

  it("takes a bud by its number", () => {
    const { choose } = mount();
    key("3");
    expect(choose).toHaveBeenCalledExactlyOnceWith("opml");
  });

  it("says Not here on a faint bud, lands nothing and stays open", () => {
    const { el, choose } = mount();
    key("4");
    expect(choose).not.toHaveBeenCalled();
    expect(on(el)?.dataset.face).toBe("picture");
    expect(say(el)).toEqual({ verb: "Not", noun: "here" });
  });

  it("puts the card back on Escape", () => {
    const { choose } = mount();
    key("Escape");
    expect(choose).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("chooses by direction and a click", () => {
    const { el, choose } = mount();
    const b = placeBuds(4, AT, FIELD).buds[1];
    if (b === undefined) throw new Error("no bud");
    pointAt("pointermove", b.x, b.y);
    expect(on(el)?.dataset.face).toBe("outline");
    pointAt("click", b.x, b.y);
    expect(choose).toHaveBeenCalledExactlyOnceWith("outline");
  });

  it("says Cancel on open ground, and a click there puts the card back", () => {
    const { el, choose } = mount();
    pointAt("pointermove", AT.x, AT.y + 300);
    expect(on(el)).toBeNull();
    expect(say(el)).toEqual({ verb: "", noun: "Cancel" });
    pointAt("click", AT.x, AT.y + 300);
    expect(choose).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("a click inside the dead zone takes the hub", () => {
    const { choose } = mount();
    pointAt("click", AT.x + 5, AT.y + 5);
    expect(choose).toHaveBeenCalledExactlyOnceWith("live");
  });

  it("ignores the pointer for its first 90ms: the hand is still moving", () => {
    const { el } = mount(vi.fn(), 90);
    const b = placeBuds(4, AT, FIELD).buds[1];
    if (b === undefined) throw new Error("no bud");
    pointAt("pointermove", b.x, b.y);
    expect(on(el)?.dataset.face).toBe("live");
  });

  it("stands each bud on its ring", () => {
    const { el } = mount();
    const placed = placeBuds(4, AT, FIELD).buds;
    buds(el).forEach((b, i) => {
      expect(Number.parseFloat(b.style.left)).toBeCloseTo(placed[i]?.x ?? 0, 3);
      expect(Number.parseFloat(b.style.top)).toBeCloseTo(placed[i]?.y ?? 0, 3);
    });
  });
});
