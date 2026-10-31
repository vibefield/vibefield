// @vitest-environment happy-dom
/**
 * HN-1 — one card of the hand (HN-D1, "one stock, six faces"; DESIGN.md §5 "The hand's cards are
 * paper"): each kind's face on the shipping CardFace — its index printed twice, its name first,
 * the agent's dark card, the × only on a card reached, a drag's waiting faces — and the stock's
 * stylesheet and tokens held to the paper's rules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectInk } from "@vibefield/design-kit/project-ink";
import { AGENT_MARK_PROVIDERS } from "@vibefield/puppeteer-view-sdk/toolkit";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CARD_INDEX, CardFace, cardTitle, pictureRatio } from "../src/frame/cards/CardFace";
import {
  type AgentCard,
  type Card,
  type FileCard,
  type MsgCard,
  type PictCard,
  type TextCard,
  termCardOf,
  textCardOf,
} from "../src/frame/cards/cards-model";
import { cardName, WAITING_WORDS } from "../src/frame/cards/cards-words";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CARDS_CSS = readFileSync(join(process.cwd(), "src/frame/cards/cards.css"), "utf8");
const TOKENS = readFileSync(join(process.cwd(), "../design-kit/src/tokens.css"), "utf8");

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function mount(node: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

/** A colour property's declaration in the stylesheet: its name and its value. */
const COLOUR_DECLARATION = /^\s*(color|background|fill|stroke|outline)\s*:\s*([^;]+);/gmu;
/** A colour printed from a token (the stock's own `--card-*` are its tokens, set from them), or
 * none at all; an rgb() here is the stock's own white or black, which the literal check holds. */
const PRINTED_FROM_A_TOKEN = /var\(--(?:vf|card)-|\bnone\b|: (?:inherit|transparent)$|rgb\(/u;

/** A rule's body in the hand's stylesheet. */
function rule(selector: string): string {
  const from = CARDS_CSS.indexOf(`${selector} {`);
  return from < 0 ? "" : CARDS_CSS.slice(from, CARDS_CSS.indexOf("}", from));
}

const base = (id: string) => ({ id, origin: { view: "godview", how: "copy" } as const, at: 0 });

const TEXT = textCardOf("Never drop a paste unsaid. Say its size.", base("text"));
const FILE: FileCard = {
  ...base("file"),
  kind: "file",
  paste: "packages/fieldd/src/files/routes.ts",
  name: "routes.ts",
  folder: "packages/fieldd/src/files/",
  lines: "export const ROUTES = {};",
};
const AGENT: AgentCard = {
  ...base("agent"),
  kind: "agent",
  paste: "claude·2",
  handle: "claude·2",
  project: "vibe-field",
  state: "working",
};
const TERM = termCardOf("$ pnpm test\n ✓ a.test.ts (3)\n      Tests  3 passed (3)\n", base("term"));
const MSG: MsgCard = {
  ...base("msg"),
  kind: "msg",
  paste: "Hold the push.",
  speaker: "Vela",
  time: "14:09",
  words: "Hold the push.",
};
const PICT: PictCard = {
  ...base("pict"),
  kind: "pict",
  title: "Snapshot",
  width: 1440,
  height: 900,
  src: "vibefield-still://stills/vibefield-still-0007.png",
  path: "/tmp/vibefield-still-0007.png",
  paste: "/tmp/vibefield-still-0007.png",
};

describe("one stock, six faces (HN-D1)", () => {
  it("prints each kind's index twice — the top left a fanned hand shows, and the bottom right turned", () => {
    expect(CARD_INDEX).toEqual({
      text: "snippets",
      file: "code",
      agent: "agents",
      term: "terminal",
      msg: "message",
      pict: "capture",
    });
    for (const card of [TEXT, FILE, AGENT, TERM, MSG, PICT]) {
      const el = mount(<CardFace card={card} />);
      const face = el.querySelector<HTMLElement>(".vf-card");
      expect(face?.dataset.kind).toBe(card.kind);
      expect(face?.dataset.card).toBe(card.id);
      const index = [...(face?.querySelectorAll(".vf-card-ix") ?? [])];
      expect(index.map((glyph) => glyph.getAttribute("data-glyph"))).toEqual([
        CARD_INDEX[card.kind],
        CARD_INDEX[card.kind],
      ]);
      expect(index[1]?.getAttribute("class")).toContain("vf-card-ix-tail");
      // the stock and its gloss, around the face
      expect(face?.querySelector(".vf-card-stock")).not.toBeNull();
      expect(face?.querySelector(".vf-card-gloss")).not.toBeNull();
    }
    expect(rule(".vf-card-ix-tail")).toContain("transform: rotate(180deg);");
  });

  it("leads every face with its name, and a picture's with the picture", () => {
    const body = (card: Card): Element | null =>
      mount(<CardFace card={card} />).querySelector(".vf-card-body");
    const words = body(TEXT);
    const title = words?.querySelector(".vf-card-words b");
    expect(title?.textContent).toBe("Never drop a paste unsaid.");
    expect(words?.textContent).toBe("Never drop a paste unsaid. Say its size.");
    // its lines balanced as the page sets them, never a lone word on the last (R-D 20)
    expect(rule(".vf-card-words")).toContain("text-wrap: pretty;");
    expect(body(FILE)?.firstElementChild?.textContent).toBe("routes.ts");
    expect(body(FILE)?.querySelector(".vf-card-path")?.textContent).toBe(
      "packages/fieldd/src/files/",
    );
    expect(body(FILE)?.querySelector(".vf-card-lines")?.textContent).toBe(
      "export const ROUTES = {};",
    );
    expect(body(AGENT)?.firstElementChild?.textContent).toBe("claude·2");
    expect(body(TERM)?.firstElementChild?.textContent).toBe("$ pnpm test");
    expect(body(MSG)?.querySelector(".vf-card-who b")?.textContent).toBe("Vela");
    expect(body(MSG)?.querySelector(".vf-card-who span")?.textContent).toBe("14:09");
    const picture = body(PICT);
    expect(picture?.firstElementChild?.className).toBe("vf-card-photo");
    expect(picture?.querySelector(".vf-card-name")?.textContent).toBe("Snapshot");
    expect(picture?.querySelector(".vf-card-size")?.textContent).toBe("1440 × 900");
  });

  it("titles a text card: a sentence keeps its own stop, a title that is one gets one, a bare line none", () => {
    expect(cardTitle(TEXT)).toBe("Never drop a paste unsaid.");
    const titled: TextCard = { ...TEXT, title: "Release notes", bare: false };
    expect(cardTitle(titled)).toBe("Release notes.");
    const bare = textCardOf("TypeError: x is undefined\n  at f (a.js:1)", base("bare"));
    expect(cardTitle(bare)).toBe("TypeError: x is undefined");
  });

  it("names a terminal copy by its command and inks its passes; a copy from no prompt is all output", () => {
    const out = mount(<CardFace card={TERM} />).querySelector(".vf-card-out");
    expect(out?.querySelectorAll(".vf-card-pass")).toHaveLength(1);
    expect(out?.querySelector(".vf-card-pass")?.textContent).toBe("✓");
    expect(out?.querySelector("b")?.textContent).toBe("      Tests  3 passed (3)");
    expect(out?.textContent).toBe(" ✓ a.test.ts (3)\n      Tests  3 passed (3)");
    const noPrompt = termCardOf("first line\nsecond line", base("plain"));
    const el = mount(<CardFace card={noPrompt} />);
    expect(el.querySelector(".vf-card-cmd")).toBeNull();
    expect(el.querySelector(".vf-card-out")?.textContent).toBe("first line\nsecond line");
    expect(rule(".vf-card-pass")).toContain("color: var(--vf-card-pass);");
  });

  it("draws the agent's card on the dark stock, its mark the SDK's when it has one, else the agents glyph", () => {
    const marked = AGENT_MARK_PROVIDERS[0];
    expect(marked).toBeDefined();
    const withMark = mount(<CardFace card={{ ...AGENT, agent: marked ?? "" }} />);
    const mark = withMark.querySelector(".vf-card-mark");
    expect(mark?.querySelector("svg path")).not.toBeNull();
    expect(mark?.querySelector("[data-glyph]")).toBeNull();
    const without = mount(<CardFace card={AGENT} />).querySelector(".vf-card-mark");
    expect(without?.querySelector("[data-glyph]")?.getAttribute("data-glyph")).toBe("agents");
    // an agent the toolkit has only a letter for takes the glyph, never a letter
    const lettered = mount(<CardFace card={{ ...AGENT, agent: "an-agent-with-no-mark" }} />);
    expect(lettered.querySelector(".vf-card-mark [data-glyph]")).not.toBeNull();
    // its project, and its state at its foot
    expect(without?.parentElement?.querySelector(".vf-card-project")?.textContent).toBe(
      "vibe-field",
    );
    const working = mount(<CardFace card={AGENT} />).querySelector<HTMLElement>(".vf-card-state");
    expect(working?.dataset.tone).toBe("working");
    expect(working?.textContent).toBe("Working");
    const waiting = mount(<CardFace card={{ ...AGENT, state: "waiting" }} />);
    expect(waiting.querySelector<HTMLElement>(".vf-card-state")?.dataset.tone).toBe("attention");
    expect(waiting.querySelector(".vf-card-state")?.textContent).toBe("Waiting for you");
    const dark = rule('.vf-card[data-kind="agent"]');
    expect(dark).toContain("--card-stock: var(--vf-card-dark-stock);");
    expect(dark).toContain("--card-edge: var(--vf-card-dark-edge);");
    expect(dark).toContain("--card-ink: var(--vf-card-dark-ink);");
    // the mark a step under the handle's ink: the dark stock's white at 84% (R-D 20)
    expect(rule(".vf-card-mark")).toContain("color: rgb(255 255 255 / 84%);");
  });

  it("prints the project's dot in its dealt ink before the project's name, high enough to show at rest (R-D 6)", () => {
    const inked = mount(<CardFace card={{ ...AGENT, projectInk: 3 }} />);
    const project = inked.querySelector(".vf-card-project");
    expect(project?.textContent).toBe("vibe-field");
    const dot = project?.firstElementChild as HTMLElement | null | undefined;
    expect(dot?.tagName).toBe("I");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(dot?.style.getPropertyValue("--card-project")).toBe(projectInk(3));
    // no ink dealt, no dot: the name alone
    const plain = mount(<CardFace card={AGENT} />).querySelector(".vf-card-project");
    expect(plain?.querySelector("i")).toBeNull();
    expect(plain?.textContent).toBe("vibe-field");
    expect(rule(".vf-card-project")).toContain("gap: 0.42em;");
    const ink = rule(".vf-card-project i");
    expect(ink).toContain("width: 0.6em;");
    expect(ink).toContain("height: 0.6em;");
    expect(ink).toContain("border-radius: 50%;");
    expect(ink).toContain("background: var(--card-project);");
  });

  it("names its × by the card's name, one line and cut at 60 code points, never a whole message (R-D 19)", () => {
    const long: MsgCard = {
      ...MSG,
      words:
        "codex·2 wants to push to main.\nclaude·2 is still writing the LANDED entry, so I'd hold.",
    };
    const name = cardName(long);
    expect(name).toBe("Vela: codex·2 wants to push to main. claude·2 is still writi…");
    expect(Array.from(name)).toHaveLength(61);
    const x = mount(<CardFace card={long} reached />).querySelector(".vf-card-x");
    expect(x?.getAttribute("aria-label")).toBe(`Remove ${name}`);
    // a short name is whole; a character past the cut is never split
    expect(cardName(TEXT)).toBe("Never drop a paste unsaid.");
    const wide = textCardOf("🂡".repeat(70), base("wide"));
    expect(cardName(wide)).toBe(`${"🂡".repeat(60)}…`);
  });

  it("shows its × only on a card reached, red under the pointer, and a press on it never picks the card up", () => {
    expect(mount(<CardFace card={TEXT} />).querySelector(".vf-card-x")).toBeNull();
    const onRemove = vi.fn();
    const onPress = vi.fn();
    const el = mount(
      <div onPointerDown={onPress}>
        <CardFace card={TEXT} reached onRemove={onRemove} />
      </div>,
    );
    const x = el.querySelector<HTMLButtonElement>(".vf-card-x");
    expect(x?.title).toBe("Remove  ⌫");
    expect(x?.getAttribute("aria-label")).toBe("Remove Never drop a paste unsaid.");
    expect(x?.getAttribute("aria-keyshortcuts")).toBe("Backspace");
    expect(x?.querySelector("[data-glyph]")?.getAttribute("data-glyph")).toBe("close");
    act(() => {
      x?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      x?.click();
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    expect(rule(".vf-card-x:hover")).toContain("background: var(--vf-red);");
    expect(rule(".vf-card-x:hover")).toContain("color: var(--vf-state-on-solid);");
    expect(rule(".vf-card-x")).toContain("background: color-mix(in srgb, var(--card-ink) 8%");
  });

  it("says only its kind while a drag from another app is on its way (HN-D2)", () => {
    const wait = { ...base("w"), paste: "", waiting: true } as const;
    const text: TextCard = { ...wait, kind: "text", title: "", body: "", bare: true };
    const textFace = mount(<CardFace card={text} />);
    expect(textFace.querySelector(".vf-card")?.hasAttribute("data-waiting")).toBe(true);
    expect(textFace.querySelector(".vf-card-words")?.textContent).toBe(WAITING_WORDS.text);
    const pict: PictCard = { ...wait, kind: "pict", title: "", width: 0, height: 0, src: "" };
    const pictFace = mount(<CardFace card={pict} />);
    const photo = pictFace.querySelector(".vf-card-photo[data-waiting]");
    expect(photo?.querySelector("[data-glyph]")?.getAttribute("data-glyph")).toBe("capture");
    expect(photo?.querySelector("img")).toBeNull();
    expect(pictFace.querySelector(".vf-card-name")?.textContent).toBe("An image");
    expect(pictFace.querySelector(".vf-card-size")).toBeNull();
    // as the page draws it (R-D 20): the card's ink at 6% for a ground, a 0.5px hairline at 12%
    const waiting = rule(".vf-card-photo[data-waiting]");
    expect(waiting).toContain("background: color-mix(in srgb, var(--card-ink) 6%, transparent);");
    expect(waiting).toContain(
      "box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--card-ink) 12%, transparent);",
    );
    expect(waiting).not.toContain("dashed");
    const one: FileCard = { ...wait, kind: "file", name: "" };
    const oneFace = mount(<CardFace card={one} />);
    expect(oneFace.querySelector(".vf-card-name")?.textContent).toBe("A file");
    expect(oneFace.querySelector(".vf-card-path")?.textContent).toBe("Let go to see it");
    const three: FileCard = { ...one, name: WAITING_WORDS.files(3) };
    expect(mount(<CardFace card={three} />).querySelector(".vf-card-name")?.textContent).toBe(
      "3 files",
    );
  });

  it("prints a picture at its own proportion, clamped to the face's column, and its ground with no still", () => {
    expect(pictureRatio(PICT)).toBe(1.6);
    expect(pictureRatio({ ...PICT, width: 3000, height: 500 })).toBe(2.2);
    expect(pictureRatio({ ...PICT, width: 500, height: 3000 })).toBe(1);
    expect(pictureRatio({ ...PICT, width: 0, height: 0 })).toBe(1.4);
    const el = mount(<CardFace card={PICT} />);
    const photo = el.querySelector<HTMLElement>(".vf-card-photo");
    expect(photo?.style.getPropertyValue("--card-ar")).toBe("1.6");
    const img = photo?.querySelector("img");
    expect(img?.getAttribute("src")).toBe(PICT.src);
    expect(img?.getAttribute("draggable")).toBe("false");
    // a still the ring no longer keeps: the picture's ground, never a broken image
    act(() => {
      img?.dispatchEvent(new Event("error"));
    });
    expect(photo?.querySelector("img")).toBeNull();
    expect(mount(<CardFace card={{ ...PICT, src: "" }} />).querySelector("img")).toBeNull();
    expect(rule(".vf-card-photo")).toContain("background: var(--vf-card-photo);");
    expect(rule(".vf-card-photo")).toContain("aspect-ratio: var(--card-ar, 1.4);");
  });

  it("sets a held card's type finer inside the same card (HN-D5)", () => {
    const el = mount(<CardFace card={TEXT} held />);
    expect(el.querySelector(".vf-card")?.hasAttribute("data-held")).toBe(true);
    expect(rule(".vf-card-face")).toContain("font-size: 9.5px;");
    expect(rule(".vf-card[data-held] .vf-card-face")).toContain("font-size: 5.6px;");
  });
});

describe("the stock's rules (DESIGN.md §5 \"The hand's cards are paper\")", () => {
  it("holds no hex literal, and prints every colour from a --vf- token — the stock's own light and shade (white and black) aside", () => {
    const css = CARDS_CSS.replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(css).not.toMatch(/#[\da-f]{3,8}\b/iu);
    // the colour words, never the `white-space` property
    expect(css).not.toMatch(/(?<![\w-])(?:white|black)(?![\w-])/u);
    for (const literal of css.match(/\b(?:rgba?|hsla?|oklch|lab|lch)\([^)]*\)/gu) ?? []) {
      expect(literal).toMatch(/^rgb\((?:0 0 0|255 255 255)\b/u);
    }
    const colours = [...css.matchAll(COLOUR_DECLARATION)];
    expect(colours.length).toBeGreaterThan(20);
    for (const [, property, value] of colours) {
      expect(`${property}: ${value}`).toMatch(PRINTED_FROM_A_TOKEN);
    }
    // the stock's own inks are its tokens, never the chrome's
    const card = rule(".vf-card");
    expect(card).toContain("--card-stock: var(--vf-card-stock);");
    expect(card).toContain("--card-ink: var(--vf-card-stock-ink);");
    expect(card).toContain("--card-ix: var(--vf-card-index);");
    expect(card).toContain("--card-cut: var(--vf-card-cut);");
    expect(card).toContain("filter: brightness(var(--vf-card-dim));");
    expect(card).toContain("var(--vf-card-shade)");
    expect(rule(".vf-card-stock::after")).toContain("background-image: var(--vf-card-grain);");
  });

  it("defines one paper for both themes, but for the night's reading light", () => {
    const root = TOKENS.slice(TOKENS.indexOf(":root {"), TOKENS.indexOf("\n}\n"));
    const dark = TOKENS.slice(TOKENS.indexOf(".dark {"));
    for (const token of [
      "--vf-card-stock: #fbfaf7;",
      "--vf-card-edge: #d6d0c3;",
      "--vf-card-stock-ink: rgb(33 31 27 / 92%);",
      "--vf-card-stock-ink-2: rgb(33 31 27 / 64%);",
      "--vf-card-stock-ink-3: rgb(33 31 27 / 42%);",
      "--vf-card-index: rgb(33 31 27 / 58%);",
      "--vf-card-cut: rgb(58 46 22 / 15%);",
      "--vf-card-pass: #1f7a36;",
      "--vf-card-photo: #cfd3cf;",
      "--vf-card-dark-stock: #1c1c1e;",
      "--vf-card-dark-edge: #050506;",
      "--vf-card-dim: 1;",
      "--vf-card-shade: 1;",
    ]) {
      expect(root).toContain(token);
    }
    expect(root).toMatch(/--vf-card-grain: url\("data:image\/svg\+xml,/u);
    expect(dark).toContain("--vf-card-dim: 0.86;");
    expect(dark).toContain("--vf-card-shade: 1.7;");
    // the same paper by night: nothing else of the stock is redefined
    expect(dark).not.toMatch(/--vf-card-(?:stock|edge|index|cut|pass|photo|grain|dark)/u);
    // §2.2's dark surface keeps its white ink — Settings → Terminal's miniature reads it
    expect(root).toContain("--vf-card-ink: #ffffff;");
  });
});
