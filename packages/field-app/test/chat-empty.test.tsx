import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CATALOG, type AgentProviderSummary } from "@vibefield/contracts";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatEmptyView } from "../src/chat/ChatEmptyView";
import { ChatPanelView } from "../src/chat/ChatPanelView";
import { nightAgentsOf, offWords } from "../src/chat/night-agents";
import { STARTERS } from "../src/chat/thread-items";
import { ChatPreview } from "../src/design-system/ChatPreview";
import { settingsOpening } from "../src/field/shell-presentation";
import { sayLineCreateOver } from "../src/frame/line-door";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// CHAT, EMPTY: THE NIGHT (track ES; ES-D1…D7 A, ruled by James on the ES page *The night that becomes the window*,
// D2–D7 2026-11-08 04:27:25–26Z and D1 04:31:19Z; DESIGN.md §8 "Chat's list", Empty: the night; §2.4 "On the night";
// §5 night glass; §9 Chat's words). With no spark, Chat's whole panel is the hatch's night, and on it, in the night's
// ink: the headline, the sentence, New spark with its key, and the hello's three starters as first jobs.

const NOW = Date.parse("2026-11-08T05:00:00.000Z");
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(HERE, path), "utf8");

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(element: ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}
const $ = (selector: string): HTMLElement | null =>
  host?.querySelector<HTMLElement>(selector) ?? null;
const starters = (): HTMLButtonElement[] => [
  ...(host?.querySelectorAll<HTMLButtonElement>(".vf-chat-empty .vf-chat-starter") ?? []),
];
/** The words an element shows, each text a word apart, as a person reads them. */
function words(element: HTMLElement | null): string {
  if (element === null) return "";
  const parts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.replace(/\s+/gu, " ").trim();
    if (text) parts.push(text);
  }
  return parts.join(" ");
}
const button = (selector: string): HTMLButtonElement | null =>
  host?.querySelector<HTMLButtonElement>(selector) ?? null;

/** The catalog's rows that can be a spark and that cannot (CP-5a's claim, `offers.spark`). */
const SPARKING = AGENT_CATALOG.filter((row) => row.offers.spark);
const PLAIN = AGENT_CATALOG.find((row) => !row.offers.spark);
function provider(
  row: (typeof AGENT_CATALOG)[number],
  over: Partial<AgentProviderSummary> = {},
): AgentProviderSummary {
  return {
    id: row.id,
    label: row.label,
    available: true,
    resumable: false,
    personas: [],
    offers: { spawn: true, spark: row.offers.spark },
    ...over,
  };
}

describe('Chat, empty: the night (DESIGN.md §8 "Chat\'s list"; track ES)', () => {
  it("stands its words on the hatch's night in the night's ink: the headline, the sentence, New spark with its key, and the hello's three starters as first jobs (ES-D1 A, ES-D6 A)", () => {
    mount(<ChatPanelView reading={{ state: "ready", entries: [] }} chosen={null} now={NOW} />);
    const empty = $(".vf-chat-empty");
    if (empty === null) throw new Error("no night drawn");
    // §2.4: the night's ink is one scope, worn by what stands on the night; §2.10: the night is the kit's own
    expect(empty.classList.contains("vf-on-night")).toBe(true);
    expect(empty.querySelector(".vf-spark-night")).not.toBeNull();
    expect(words($(".vf-chat-empty-column"))).toBe(
      [
        "Make your first spark",
        "A spark is an agent VibeField starts to run your other agents.",
        "New spark",
        "⌘N",
        "Or give it a first job",
        ...STARTERS.map((starter) => starter.words),
      ].join(" "),
    );
    // "No sparks yet" retires on the Mac (§8, amended), and no list stands before the first spark
    expect(host?.textContent).not.toContain("No sparks yet");
    expect($(".vf-chat-panel-state")).toBeNull();
    expect($(".vf-chat-list")).toBeNull();
    // New spark is the kit's primary, the line's create: its key printed on it and announced
    const create = button(".vf-chat-empty-new");
    expect(create?.classList.contains("vf-ui-button")).toBe(true);
    expect(create?.dataset.variant).toBe("primary");
    expect(create?.getAttribute("aria-keyshortcuts")).toBe("Meta+N");
    expect(create?.disabled).toBe(false);
    // the jobs are the hello's own starter, one button for one behaviour (ES-D2 A)
    expect(starters()).toHaveLength(3);
    expect(starters().every((starter) => starter.classList.contains("vf-ui-button"))).toBe(true);
  });

  it("prints the key the window's keys are: Ctrl+N off the Mac", () => {
    mount(<ChatEmptyView keys="other" />);
    expect(words(button(".vf-chat-empty-new"))).toBe("New spark Ctrl+N");
    expect(button(".vf-chat-empty-new")?.getAttribute("aria-keyshortcuts")).toBe("Control+N");
  });

  it("opens the New spark sheet from New spark and from each first job (ES-D2 A; the sheet carries the job from ES-2)", () => {
    const asked: string[] = [];
    mount(
      <ChatEmptyView onNewSpark={() => asked.push("new")} onJob={(job) => asked.push(job.words)} />,
    );
    act(() => button(".vf-chat-empty-new")?.click());
    act(() => starters()[1]?.click());
    expect(asked).toEqual(["new", STARTERS[1]?.words]);
  });

  it("is Off when no agent here can be a spark: New spark off from the kit's own button, the sentence naming the agents that can, Open Agents settings, and no job (§7; §9)", () => {
    const asked: string[] = [];
    mount(
      <ChatEmptyView
        agents={{ state: "read", here: 0, elsewhere: ["Claude Code"] }}
        onNewSpark={() => asked.push("new")}
        onAgents={() => asked.push("agents")}
      />,
    );
    const create = button(".vf-chat-empty-new");
    // item 241's rule: the view hands the kit's button `disabled` and draws no Off of its own; 241b's kit draws Off on
    // `:disabled:not([data-running])` (G2), and the night's New spark never runs — it opens the sheet
    expect(create?.disabled).toBe(true);
    expect(create?.hasAttribute("data-running")).toBe(false);
    expect(create?.getAttribute("style")).toBeNull();
    expect(words($(".vf-chat-empty-why"))).toBe(
      "A spark thinks with Claude Code, which isn't on this Mac yet.",
    );
    expect(words(button(".vf-chat-empty-agents"))).toBe("Open Agents settings");
    act(() => button(".vf-chat-empty-agents")?.click());
    expect(asked).toEqual(["agents"]);
    expect(starters()).toHaveLength(0);
    expect(words($(".vf-chat-empty-column"))).not.toContain("Or give it a first job");
  });

  it("stays live while the agents are read, and where they could not be (the sheet then says why at its foot)", () => {
    mount(<ChatEmptyView agents={{ state: "reading" }} />);
    expect(button(".vf-chat-empty-new")?.disabled).toBe(false);
    act(() => root?.render(<ChatEmptyView agents={{ state: "unread" }} />));
    expect(button(".vf-chat-empty-new")?.disabled).toBe(false);
    expect($(".vf-chat-empty-why")).toBeNull();
  });

  it("says which agents can be a spark as §9 words it: one, two, or more", () => {
    expect(offWords(["Claude Code"])).toBe(
      "A spark thinks with Claude Code, which isn't on this Mac yet.",
    );
    expect(offWords(["Claude Code", "Codex"])).toBe(
      "A spark thinks with Claude Code or Codex, which aren't on this Mac yet.",
    );
    expect(offWords(["Claude Code", "Codex", "Grok"])).toBe(
      "A spark thinks with Claude Code, Codex or Grok, which aren't on this Mac yet.",
    );
  });

  it("reads the agents that can be a spark as the sheet does — installed and claimed (`offers.spark`) — and names the claimed ones not here", () => {
    const [spark] = SPARKING;
    if (spark === undefined || PLAIN === undefined)
      throw new Error("the catalog has a spark row and a plain one");
    expect(nightAgentsOf([provider(spark), provider(PLAIN)])).toEqual({
      state: "read",
      here: 1,
      elsewhere: [],
    });
    expect(nightAgentsOf([provider(spark, { available: false }), provider(PLAIN)])).toEqual({
      state: "read",
      here: 0,
      elsewhere: [spark.label],
    });
    // fieldd lists none that can: the catalog's own spark rows are named, never a blank sentence
    expect(nightAgentsOf([provider(PLAIN)])).toEqual({
      state: "read",
      here: 0,
      elsewhere: SPARKING.map((row) => row.label),
    });
  });

  it("opens Settings on Agents for Open Agents settings (the window's one Settings owner)", () => {
    expect(settingsOpening("agents")).toEqual({ page: "agents" });
  });

  it("keeps its look in tokens: night glass on the starters, the hush behind the words, no colour of its own (§5; UI_SYSTEM)", () => {
    const css = read("../src/chat/chat-empty.css");
    expect(css).not.toMatch(/#[\da-f]{3,8}\b/iu);
    expect(css).not.toMatch(/rgba?\(/u);
    for (const token of [
      "--vf-night-glass",
      "--vf-night-glass-hover",
      "--vf-night-glass-ring",
      "--vf-night-glass-blur",
      "--vf-night-hush",
    ])
      expect(css, token).toContain(`var(${token})`);
    // §3's Headline: 40 light at −0.02em, on the night alone
    const title = css.match(/^\.vf-chat-empty-title \{([^}]*)\}/mu)?.[1] ?? "";
    expect(title).toMatch(/font-size: 40px;/u);
    expect(title).toMatch(/font-weight: 300;/u);
    expect(title).toMatch(/letter-spacing: -0\.02em;/u);
  });

  it("lets the label and the jobs step aside in a short panel, under 440 tall: the night, the words and New spark stay (§8)", () => {
    const css = read("../src/chat/chat-empty.css");
    expect(css).toMatch(
      /@container [a-z-]+ \(max-height: 439px\) \{\s*\.vf-chat-empty-or,\s*\.vf-chat-empty-jobs \{\s*display: none;/u,
    );
  });
});

describe("the lean (track ES, ES-3a; DESIGN.md §6, the lean: the portal's first move, shown before it is made)", () => {
  const night = (): HTMLElement | null => $(".vf-chat-empty");
  const leaning = (): boolean => night()?.dataset.lean === "true";
  const over = (element: Element | null | undefined) =>
    act(() => {
      element?.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true, relatedTarget: null }),
      );
    });
  const out = (element: Element | null | undefined) =>
    act(() => {
      element?.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
    });
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("leans the night under the pointer or the keyboard's focus on New spark or a job, and lets it go once nothing holds it for 90ms", () => {
    vi.useFakeTimers();
    try {
      mount(<ChatEmptyView />);
      expect(leaning()).toBe(false);
      over(button(".vf-chat-empty-new"));
      expect(leaning()).toBe(true);
      out(button(".vf-chat-empty-new"));
      wait(89);
      expect(leaning()).toBe(true);
      wait(1);
      expect(leaning()).toBe(false);
      // from New spark to a job within the 90ms, it never lets go between them
      over(button(".vf-chat-empty-new"));
      out(button(".vf-chat-empty-new"));
      wait(50);
      over(starters()[1]);
      wait(100);
      expect(leaning()).toBe(true);
      out(starters()[1]);
      wait(90);
      expect(leaning()).toBe(false);
      // the keyboard's focus holds it as the pointer does
      act(() => starters()[0]?.focus());
      expect(leaning()).toBe(true);
      act(() => starters()[0]?.blur());
      wait(90);
      expect(leaning()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leans for the line's ✦ while Chat is the view (the frame says, the night hears), and not while Chat is not", () => {
    vi.useFakeTimers();
    try {
      mount(<ChatEmptyView active />);
      act(() => sayLineCreateOver(true));
      expect(leaning()).toBe(true);
      act(() => sayLineCreateOver(false));
      wait(90);
      expect(leaning()).toBe(false);
      act(() => root?.render(<ChatEmptyView active={false} />));
      act(() => sayLineCreateOver(true));
      expect(leaning()).toBe(false);
      act(() => sayLineCreateOver(false));
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves the night alone by §6's numbers: its edge in 6, corners 22 to 16, in on the island curve, back on the retract curve, and nothing under reduced motion", () => {
    const css = read("../src/chat/chat-empty.css");
    const rest = css.match(/^\.vf-chat-empty \.vf-spark-night \{([^}]*)\}/mu)?.[1] ?? "";
    expect(rest).toMatch(/clip-path: inset\(0 round 22px\);/u);
    expect(rest).toMatch(/clip-path 240ms cubic-bezier\(0\.4, 0, 1, 1\)/u);
    const lean =
      css.match(/^\.vf-chat-empty\[data-lean="true"\] \.vf-spark-night \{([^}]*)\}/mu)?.[1] ?? "";
    expect(lean).toMatch(/clip-path: inset\(6px round 16px\);/u);
    expect(lean).toMatch(/clip-path 240ms var\(--vf-ease-island\)/u);
    // reduced motion (M6): nothing moves
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(
      /\.vf-chat-empty\[data-lean="true"\] \.vf-spark-night \{\s*clip-path: inset\(0 round 22px\);/u,
    );
  });
});

describe("the catalog's night (docs/UI_SYSTEM.md: the plate mounts the shipping view)", () => {
  it("draws the empty plates on the shipping panel and its shipping night: live, Off, and a short panel", () => {
    mount(<ChatPreview state="empty" />);
    expect($(".vf-chat-empty")).not.toBeNull();
    expect(button(".vf-chat-empty-new")?.disabled).toBe(false);
    act(() => root?.render(<ChatPreview key="off" state="empty-off" />));
    expect(button(".vf-chat-empty-new")?.disabled).toBe(true);
    expect(words($(".vf-chat-empty-why"))).toBe(
      "A spark thinks with Claude Code, which isn't on this Mac yet.",
    );
    act(() => root?.render(<ChatPreview key="short" state="empty-short" />));
    expect($(".vf-chat-empty")).not.toBeNull();
  });
});
