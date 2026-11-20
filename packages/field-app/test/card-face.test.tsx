// @vitest-environment happy-dom
/**
 * FACE-a (item 405) — one card of the hand, round 5's face (DESIGN.md §5 "The hand's cards are paper", §8 "A card";
 * *Card Stock* round 5, ruled with CS-D5…D12 on 2026-11-09): three things and one line of words on the shipping
 * CardFace — its type's glyph, then its name; the window, what it holds, seen; its faces along its foot — and no index
 * in its corners. The agent's dark card until its window (FACE-b), the × only on a card reached, a drag's waiting
 * faces, the same face at 2.4× when picked up, and the stock's stylesheet and tokens held to the paper's rules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectInk } from "@vibefield/design-kit/project-ink";
import { AGENT_MARK_PROVIDERS } from "@vibefield/puppeteer-view-sdk/toolkit";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardFace, cardLook, faceName } from "../src/frame/cards/CardFace";
import {
  type Card,
  type CardStub,
  cardType,
  fileCardOf,
  messageCardOf,
  pictureCardOf,
  sessionCardOf,
  termCardOf,
  textCardOf,
} from "../src/frame/cards/cards-model";
import { cardName, WAITING_WORDS } from "../src/frame/cards/cards-words";
import { TYPE_GLYPH } from "../src/frame/cards/type-glyphs";

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

const base = (id: string): CardStub => ({ id, origin: { view: "godview", how: "copy" }, at: 0 });

const TEXT = textCardOf("Never drop a paste unsaid. Say its size.", base("text"));
const FILE = fileCardOf(
  {
    name: "routes.ts",
    path: "packages/fieldd/src/files/routes.ts",
    folder: "packages/fieldd/src/files/",
    lines: "/** The files worker's routes. */\nexport const ROUTES = {};",
  },
  base("file"),
);
const SESSION = { handle: "claude·2", project: "vibe-field", state: "working" } as const;
const AGENT = sessionCardOf(SESSION, base("agent"));
const TERM = termCardOf("$ pnpm test\n ✓ a.test.ts (3)\n      Tests  3 passed (3)\n", base("term"));
const MSG = messageCardOf({ speaker: "Vela", time: "14:09", words: "Hold the push." }, base("msg"));
const PICT_STILL = {
  title: "Snapshot",
  width: 1440,
  height: 900,
  src: "vibefield-still://stills/vibefield-still-0007.png",
  path: "/tmp/vibefield-still-0007.png",
} as const;
const PICT = pictureCardOf(PICT_STILL, base("pict"));
const LINK: Card = {
  ...base("link"),
  title: "VibeField",
  about: "vibefield.dev",
  faces: [
    { id: "link", type: "link", label: "Link", url: "https://vibefield.dev/", title: "VibeField" },
  ],
};
const STILL = { src: "blob:vibefield/still-q3", width: 400, height: 300 } as const;
const REF: Card = {
  ...base("ref"),
  title: "Q3 plan",
  about: "Mind map · 7 topics",
  faces: [
    {
      id: "ref",
      type: "ref",
      label: "Live",
      ref: "vf:obj/7hk2qx4m",
      kindName: "Mind map",
      title: "Q3 plan",
      still: STILL,
    },
    { id: "picture", type: "image", label: "Picture", ...STILL },
  ],
};
const PRINTED = [TEXT, FILE, TERM, MSG, PICT, LINK, REF];

/** A mounted card's one face. */
const faceOf = (card: Card): HTMLElement | null =>
  mount(<CardFace card={card} />).querySelector<HTMLElement>(".vf-card");

describe('round 5\'s face: three things and one line of words (DESIGN.md §8 "A card")', () => {
  it('wears each type\'s own glyph (§13 "The six types", CS-D10 A)', () => {
    expect(TYPE_GLYPH).toEqual({
      text: "type-text",
      image: "type-image",
      file: "document",
      link: "link",
      session: "agents",
      ref: "type-ref",
    });
  });

  it("heads every card but the agent's with its type's glyph, then its name — and prints no index in its corners", () => {
    for (const card of PRINTED) {
      const face = faceOf(card);
      expect(face?.dataset.kind).toBe(cardLook(card));
      expect(face?.dataset.card).toBe(card.id);
      const type = face?.querySelector(".vf-card-head .vf-card-type");
      expect(type?.getAttribute("data-glyph")).toBe(TYPE_GLYPH[cardType(card)]);
      expect(type?.getAttribute("width")).toBe("10.4");
      expect(face?.querySelector(".vf-card-head .vf-card-name")?.textContent).toBe(faceName(card));
      // HN-D1's two indexes retire with round 5
      expect(face?.querySelector(".vf-card-ix")).toBeNull();
      // the stock and its gloss, around the face
      expect(face?.querySelector(".vf-card-stock")).not.toBeNull();
      expect(face?.querySelector(".vf-card-gloss")).not.toBeNull();
    }
  });

  it("names a text card by its first sentence, a terminal copy by its command, and says it on one line", () => {
    expect(faceName(TEXT)).toBe("Never drop a paste unsaid.");
    expect(faceName(TERM)).toBe("pnpm test");
    expect(faceName(MSG)).toBe("Vela: Hold the push.");
    expect(faceName(FILE)).toBe("routes.ts");
    expect(faceName(PICT)).toBe("Snapshot");
    expect(faceName(REF)).toBe("Q3 plan");
    const long = messageCardOf(
      { speaker: "Vela", time: "14:09", words: "codex·2 wants to push.\nclaude·2 would hold." },
      base("msg"),
    );
    expect(faceName(long)).toBe("Vela: codex·2 wants to push. claude·2 would hold.");
    // no measure in this DOM: the name stands whole at its largest size, and the stylesheet holds it
    const name = faceOf(TEXT)?.querySelector<HTMLElement>(".vf-card-name");
    expect(name?.style.getPropertyValue("--card-name")).toBe("11.5px");
  });

  it("marks its faces along its foot as their types' glyphs, in the card's order — the first, what it is, the darker", () => {
    const foot = faceOf(REF)?.querySelector(".vf-card-faces");
    const marks = [...(foot?.querySelectorAll("[data-glyph]") ?? [])];
    const glyphs = marks.map((mark) => mark.getAttribute("data-glyph"));
    expect(glyphs).toEqual(["type-ref", "type-image"]);
    expect(marks.map((mark) => mark.getAttribute("width"))).toEqual(["7.4", "7.4"]);
    expect(rule(".vf-card-faces")).toContain("color: var(--vf-card-face-ink-2);");
    expect(rule(".vf-card-faces > :first-child")).toContain("color: var(--vf-card-face-ink);");
    // one face, one mark
    expect(faceOf(FILE)?.querySelectorAll(".vf-card-faces [data-glyph]")).toHaveLength(1);
  });

  it("sets the head, the window and the foot on round 5's grid, in the card's own units", () => {
    const type = rule(".vf-card-type");
    expect(type).toContain("top: 11.7px;");
    expect(type).toContain("left: 8.7px;");
    expect(type).toContain("color: var(--vf-card-type-ink);");
    const name = rule(".vf-card-name");
    // its foot is its baseline, 21 down a 168 card
    expect(name).toContain("bottom: 147px;");
    expect(name).toContain("left: 21.4px;");
    expect(name).toContain("max-width: 88.6px;");
    expect(name).toContain("font-size: var(--card-name, 11.5px);");
    expect(name).toContain("font-weight: 700;");
    expect(name).toContain("letter-spacing: -0.22px;");
    expect(name).toContain("text-box: trim-both cap alphabetic;");
    expect(name).toContain("white-space: nowrap;");
    const window = rule(".vf-card-window");
    for (const set of ["top: 29px;", "left: 10px;", "width: 100px;", "height: 110px;"]) {
      expect(window).toContain(set);
    }
    expect(window).toContain("border-radius: 3.5px;");
    expect(window).toContain("background: var(--vf-card-plate);");
    expect(rule(".vf-card-window::after")).toContain(
      "box-shadow: inset 0 0 0 0.35px var(--vf-card-frame);",
    );
    const foot = rule(".vf-card-faces");
    expect(foot).toContain("top: 148.9px;");
    expect(foot).toContain("left: 9.075px;");
    expect(foot).toContain("gap: 2.6px;");
  });

  it("holds what follows a text card's name in its window, or all of its words when that is all it says", () => {
    const words = faceOf(TEXT)?.querySelector<HTMLElement>('[data-window="text"] .vf-card-words');
    expect(words?.textContent).toBe("Say its size.");
    // no measure in this DOM: the middle of its three sizes
    expect(words?.style.getPropertyValue("--card-words")).toBe("7.4px");
    expect(words?.style.getPropertyValue("--card-pitch")).toBe("10px");
    expect(words?.style.getPropertyValue("--card-lines")).toBe("10");
    const one = textCardOf("Hold the push.", base("one"));
    expect(faceOf(one)?.querySelector(".vf-card-words")?.textContent).toBe("Hold the push.");
    expect(faceOf(MSG)?.querySelector(".vf-card-words")?.textContent).toBe("Hold the push.");
    // a long paste sets only what its window can hold
    const paste = textCardOf(`Read this. ${"word ".repeat(400)}`, base("paste"));
    expect(faceOf(paste)?.querySelector(".vf-card-words")?.textContent?.length).toBe(600);
    // its lines balanced as the page sets them, never a lone word on the last (R-D 20)
    expect(rule(".vf-card-words")).toContain("text-wrap: pretty;");
    expect(rule(".vf-card-words")).toContain("-webkit-line-clamp: var(--card-lines, 10);");
  });

  it("prints a terminal copy's output in its window, each line from its first mark, its passes in the pass ink", () => {
    const out = faceOf(TERM)?.querySelector('[data-window="term"] .vf-card-out');
    const lines = [...(out?.children ?? [])];
    const said = lines.map((line) => line.textContent);
    expect(said).toEqual(["✓ a.test.ts (3)", "Tests 3 passed (3)"]);
    expect(lines[0]?.querySelector("b.vf-card-pass")?.textContent).toBe("✓");
    expect(lines[1]?.hasAttribute("data-quiet")).toBe(true);
    expect(lines[1]?.querySelector("b.vf-card-pass")?.textContent).toBe("3 passed");
    // a copy from no prompt is named by its first line, and its window holds the rest
    const noPrompt = termCardOf("first line\nsecond line", base("plain"));
    expect(faceName(noPrompt)).toBe("first line");
    expect(faceOf(noPrompt)?.querySelector(".vf-card-out")?.textContent).toBe("second line");
    // a command alone: its window shows it, its prompt quieter than the command
    const ls = faceOf(termCardOf("$ ls", base("ls")))?.querySelector(".vf-card-out > div");
    expect(ls?.querySelector(".vf-card-prompt")?.textContent).toBe("$ ");
    expect(ls?.querySelector("b")?.textContent).toBe("ls");
    expect(rule(".vf-card-pass")).toContain("color: var(--vf-card-pass);");
    expect(rule(".vf-card-out")).toContain("font-family: var(--vf-font-mono);");
  });

  it("pages a file's first lines in its window with no numbers, the comment quieter; a file that is not words is a blank page", () => {
    const page = faceOf(FILE)?.querySelector('[data-window="file"] .vf-card-lines');
    const lines = [...(page?.children ?? [])];
    expect(lines.map((line) => line.textContent)).toEqual([
      "/** The files worker's routes. */",
      "export const ROUTES = {};",
    ]);
    expect(lines.map((line) => line.hasAttribute("data-quiet"))).toEqual([true, false]);
    expect(rule(".vf-card-lines")).toContain(
      "mask-image: linear-gradient(rgb(0 0 0) calc(100% - 30px), transparent);",
    );
    // a PDF: where it lives and what it is are not printed (its kind and size are said in the bar, held)
    const pdf = fileCardOf({ name: "report.pdf", facts: "PDF · 2.4 MB" }, base("pdf"));
    const blank = faceOf(pdf);
    expect(blank?.querySelector('[data-window="file"]')?.textContent).toBe("");
    expect(blank?.textContent).not.toContain("PDF · 2.4 MB");
    expect(faceOf(FILE)?.textContent).not.toContain("packages/fieldd/src/files/");
  });

  it("fills an image's window with the picture, its ground until it loads, never a broken image; a ref shows its still", () => {
    const window = faceOf(PICT)?.querySelector<HTMLElement>('[data-window="image"]');
    const img = window?.querySelector("img");
    expect(img?.getAttribute("src")).toBe(PICT_STILL.src);
    expect(img?.getAttribute("draggable")).toBe("false");
    // a still the ring no longer keeps: the picture's ground, never a broken image
    act(() => {
      img?.dispatchEvent(new Event("error"));
    });
    expect(window?.querySelector("img")).toBeNull();
    const bare = faceOf(pictureCardOf({ ...PICT_STILL, src: "" }, base("bare")));
    expect(bare?.querySelector("img")).toBeNull();
    // its size is said in the bar over it, held, never printed
    expect(faceOf(PICT)?.textContent).not.toContain("1440 × 900");
    expect(rule('.vf-card-window:is([data-window="image"], [data-window="ref"])')).toContain(
      "background: var(--vf-card-photo);",
    );
    expect(rule(".vf-card-window img")).toContain("object-fit: cover;");
    // a ref's window is its still until its own window (FACE-b); a link's is its bare page
    const still = faceOf(REF)?.querySelector('[data-window="ref"] img');
    expect(still?.getAttribute("src")).toBe(STILL.src);
    expect(faceOf(LINK)?.querySelector('[data-window="link"]')?.textContent).toBe("");
  });

  it("draws the agent's card on the dark stock until its window, its mark the SDK's when it has one, else the agents glyph", () => {
    const marked = AGENT_MARK_PROVIDERS[0];
    expect(marked).toBeDefined();
    const withMark = mount(
      <CardFace card={sessionCardOf({ ...SESSION, agent: marked ?? "" }, base("agent"))} />,
    );
    const mark = withMark.querySelector(".vf-card-mark");
    expect(mark?.querySelector("svg path")).not.toBeNull();
    expect(mark?.querySelector("[data-glyph]")).toBeNull();
    const without = mount(<CardFace card={AGENT} />);
    const glyph = without.querySelector(".vf-card-mark [data-glyph]");
    expect(glyph?.getAttribute("data-glyph")).toBe("agents");
    // its own face: no head, no window, no foot, and no index (FACE-b gives it round 5's)
    const printed = ".vf-card-head, .vf-card-window, .vf-card-faces, .vf-card-ix";
    expect(without.querySelector(printed)).toBeNull();
    // an agent the toolkit has only a letter for takes the glyph, never a letter
    const lettered = mount(
      <CardFace
        card={sessionCardOf({ ...SESSION, agent: "an-agent-with-no-mark" }, base("agent"))}
      />,
    );
    expect(lettered.querySelector(".vf-card-mark [data-glyph]")).not.toBeNull();
    // its project, and its state at its foot
    expect(without.querySelector(".vf-card-project")?.textContent).toBe("vibe-field");
    const working = without.querySelector<HTMLElement>(".vf-card-state");
    expect(working?.dataset.tone).toBe("working");
    expect(working?.textContent).toBe("Working");
    const waiting = mount(
      <CardFace card={sessionCardOf({ ...SESSION, state: "waiting" }, base("agent"))} />,
    );
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
    const inked = mount(
      <CardFace card={sessionCardOf({ ...SESSION, projectInk: 3 }, base("agent"))} />,
    );
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
    const long = messageCardOf(
      {
        speaker: "Vela",
        time: "14:09",
        words:
          "codex·2 wants to push to main.\nclaude·2 is still writing the LANDED entry, so I'd hold.",
      },
      base("msg"),
    );
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
    // CS-D7 B: the × is white at rest on the chip's dark stock, so the red needs no ink of its own
    expect(rule(".vf-card-x")).toContain("color: var(--vf-state-on-solid);");
    expect(rule(".vf-card-x")).toContain("background: var(--vf-card-dark-stock);");
  });

  it("says only its kind while a drag from another app is on its way (HN-D2)", () => {
    const wait: CardStub = { ...base("w"), waiting: true };
    const text = faceOf(textCardOf("", wait));
    expect(text?.hasAttribute("data-waiting")).toBe(true);
    expect(text?.querySelector(".vf-card-name")?.textContent).toBe(WAITING_WORDS.text);
    expect(text?.querySelector('[data-window="text"]')?.textContent).toBe("");
    const pict = faceOf(pictureCardOf({ title: "", width: 0, height: 0, src: "" }, wait));
    expect(pict?.querySelector(".vf-card-name")?.textContent).toBe("An image");
    expect(pict?.querySelector('[data-window="image"][data-waiting]')).not.toBeNull();
    expect(pict?.querySelector("img")).toBeNull();
    // as the page draws it (R-D 20): the card's ink at 6% for a ground, under the window's own hairline
    expect(rule(".vf-card-window[data-waiting]")).toContain(
      "background: color-mix(in srgb, var(--card-ink) 6%, transparent);",
    );
    const one = faceOf(fileCardOf({ name: "" }, wait));
    expect(one?.querySelector(".vf-card-name")?.textContent).toBe("A file");
    expect(one?.querySelector('[data-window="file"] .vf-card-wait')?.textContent).toBe(
      "Let go to see it",
    );
    const three = faceOf(fileCardOf({ name: WAITING_WORDS.files(3) }, wait));
    expect(three?.querySelector(".vf-card-name")?.textContent).toBe("3 files");
  });

  it("is the same face at 2.4× when picked up: nothing is set finer (round 5 retires HN-D5's finer setting)", () => {
    const el = mount(<CardFace card={TEXT} held />);
    expect(el.querySelector(".vf-card")?.hasAttribute("data-held")).toBe(true);
    expect(rule(".vf-card[data-held] .vf-card-face")).toBe("");
    expect(CARDS_CSS).not.toContain("5.6px");
    // the agent's own face keeps its ems of 9.5 until its window
    expect(rule(".vf-card-face")).toContain("font-size: 9.5px;");
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
    // the stock's own inks are its tokens, never the chrome's; the index's retired with the index
    const card = rule(".vf-card");
    expect(card).toContain("--card-stock: var(--vf-card-stock);");
    expect(card).toContain("--card-ink: var(--vf-card-stock-ink);");
    expect(card).toContain("--card-cut: var(--vf-card-cut);");
    // …times the lamp's light on a card picked up as it turns (§5 "The lamp, live"; 1 everywhere else)
    expect(card).toContain(
      "filter: brightness(calc(var(--vf-card-dim) * var(--vf-cards-lamp, 1)));",
    );
    expect(card).toContain("var(--vf-card-shade)");
    expect(CARDS_CSS).not.toMatch(/--card-ix|vf-card-ix|vf-card-index/u);
    expect(rule(".vf-card-stock::after")).toContain("background-image: var(--vf-card-grain);");
  });

  it("defines one paper for both themes, the press's own, but for the night's reading light", () => {
    const root = TOKENS.slice(TOKENS.indexOf(":root {"), TOKENS.indexOf("\n}\n"));
    const dark = TOKENS.slice(TOKENS.indexOf(".dark {"));
    for (const token of [
      // the stock IS the press's paper: its hex is written once, in the token the press reads (item 403)
      "--vf-card-stock: var(--vf-card-press-paper);",
      "--vf-card-press-paper: #f4efe5;",
      "--vf-card-edge: #d6d0c3;",
      "--vf-card-stock-ink: #1c1611;",
      "--vf-card-stock-ink-2: rgb(28 22 17 / 64%);",
      "--vf-card-stock-ink-3: rgb(28 22 17 / 42%);",
      "--vf-card-type-ink: rgb(28 22 17 / 86%);",
      "--vf-card-face-ink: rgb(28 22 17 / 78%);",
      "--vf-card-face-ink-2: rgb(28 22 17 / 34%);",
      "--vf-card-frame: rgb(28 22 17 / 12%);",
      "--vf-card-plate: #ebe4d7;",
      "--vf-card-cut: rgb(58 46 22 / 15%);",
      "--vf-card-pass: #2b8a4f;",
      "--vf-card-photo: #cfd3cf;",
      "--vf-card-dark-stock: #1c1c1e;",
      "--vf-card-dark-edge: #050506;",
      "--vf-card-dim: 1;",
      "--vf-card-shade: 1;",
    ]) {
      expect(root).toContain(token);
    }
    // HN-D1's indexes retire with round 5, and their inks with them
    expect(TOKENS).not.toMatch(/--vf-card-(?:dark-)?index/u);
    expect(root).toMatch(/--vf-card-grain: url\("data:image\/svg\+xml,/u);
    expect(dark).toContain("--vf-card-dim: 0.86;");
    expect(dark).toContain("--vf-card-shade: 1.7;");
    // the same paper by night: nothing else of the stock is redefined
    expect(dark).not.toMatch(
      /--vf-card-(?:stock|edge|cut|pass|photo|grain|dark|type|face|frame|plate|press)/u,
    );
    // §2.2's dark surface keeps its white ink — Settings → Terminal's miniature reads it
    expect(root).toContain("--vf-card-ink: #ffffff;");
  });
});
