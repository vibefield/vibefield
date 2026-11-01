// @vitest-environment happy-dom
/**
 * CP-3 — THE NEEDS-YOU CARD (DESIGN.md §8 "Chat's thread", the needs-you card; §9 "The person's queue's words",
 * "Chat's words"; CP3-D1, CP3-D4, CP3-D8; VF-PM's P2, 2026-10-31): the queue's item for the shown spark, drawn by Chat
 * as a thread item in SP-1d's foot overlay, answered by its act's place (`needs.answer {item, choice}`). Its words
 * (`needsCardWords`, `needsSaid`), the shipping view (`NeedsCardView`) and its controller (`useNeedsCard`, under the
 * real `ChatView` and a running feed). The ruled witnesses on the window's side: an answer clears the item; a held send
 * is answered only by Allow (its words land in fieldd: needs-queue.test.ts); the cap holds a spawn until Allow one
 * more. The items are fieldd's fixture's (the window side of EL9).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG,
  type AgentFieldRow,
  NeedsItem,
  type NeedsItemId,
  type SparkSummary,
} from "@vibefield/contracts";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerPort } from "../src/chat/ChatComposer";
import { ChatView } from "../src/chat/ChatView";
import { NeedsCardView } from "../src/chat/NeedsCardView";
import {
  NEEDS_FADE_MS,
  NEEDS_LEAVE_MS,
  NEEDS_SAID_MS,
  type NeedsAct,
  needsCardOf,
  needsCardWords,
  needsSaid,
} from "../src/chat/needs-card";
import { sparkEntriesOf } from "../src/chat/spark-status";
import { type SparksPort, startSparksFeed } from "../src/chat/sparks-feed";
import { threadItemsOf, threadQuiet } from "../src/chat/thread-items";
import { ChatPreview } from "../src/design-system/ChatPreview";
import { NeedsCardPlates } from "../src/design-system/NeedsCardPreview";
import type { FrameSurface } from "../src/frame/frame-surface";
import { hearLineSays } from "../src/frame/line-door";
import { resetStatusLineForTest, statusLineSaid } from "../src/frame/status-line";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Show goes to the ask's pane in Godview by Jump to's path; scripted, so where it was sent is seen. */
const shown = vi.hoisted(() => ({
  opened: [] as { readonly row: unknown; readonly from: unknown }[],
  outcome: { state: "shown" } as { state: "shown" } | { state: "refused"; reason: string },
}));
vi.mock("../src/frame/live-open", () => ({
  openLiveRow: async (row: unknown, from: unknown) => {
    shown.opened.push({ row, from });
    return shown.outcome;
  },
}));

const here = dirname(fileURLToPath(import.meta.url));
const AT = "2026-10-31T16:00:00.000Z";
const AGENT = AGENT_CATALOG[0];

/** fieldd's own list of open items (the contracts fixture): Vela's question, her held send to claude·2 (two words
 * waiting), her held spawn past the cap, and claude·2's permission (an agent she started). */
const LISTED = (
  JSON.parse(
    readFileSync(join(here, "../../contracts/fixtures/needs-list.valid.json"), "utf8"),
  ) as { items: unknown[] }
).items.map((raw) => NeedsItem.parse(raw));
const [QUESTION, HELD_SEND, HELD_SPAWN, AGENT_ASK] = LISTED as [
  NeedsItem,
  NeedsItem,
  NeedsItem,
  NeedsItem,
];
/** fieldd's fixture of a kind this build never heard of, asked by Vela in her thread. */
const UNKNOWN = NeedsItem.parse({
  ...JSON.parse(
    readFileSync(join(here, "../../contracts/fixtures/needs-item.unknown-kind.json"), "utf8"),
  ),
  from: { name: "Vela", session: "run-12", spark: "sp-7k2m9q4x" },
  spark: "sp-7k2m9q4x",
});

const VELA: SparkSummary = {
  id: "sp-7k2m9q4x",
  name: "Vela",
  face: { seed: 7 },
  agent: AGENT.id,
  profiles: ["native"],
  thinksUnder: "native",
  folder: "/f/vela",
  createdAt: AT,
  updatedAt: AT,
  session: { runtimeRunId: "run-12", terminalSessionId: "pty-12", live: true },
};
const LYRA: SparkSummary = {
  ...VELA,
  id: "sp-lyra0001",
  name: "Lyra",
  face: { seed: 11 },
  session: { runtimeRunId: "run-40", terminalSessionId: "pty-40", live: true },
};

function row(over: Partial<AgentFieldRow> & Pick<AgentFieldRow, "runtimeRunId">): AgentFieldRow {
  return {
    revision: 1,
    kind: AGENT.id,
    label: AGENT.label,
    tier: "managed",
    device: "dev-1",
    status: "idle",
    statusSince: AT,
    stateChangedAt: AT,
    createdAt: AT,
    alive: true,
    blockers: [],
    usage: { cumulativeTokens: 4_000 },
    ...over,
  };
}

/** Vela's own run, idle with a transcript behind it; claude·2, the agent she started, live under her. */
const ROWS: AgentFieldRow[] = [
  row({
    runtimeRunId: "run-12",
    spark: VELA.id,
    terminal: { hosted: "local", runtimeSessionId: "pty-12" },
  }),
  row({
    runtimeRunId: "run-31",
    origin: { by: "spark", spark: VELA.id },
    terminal: { hosted: "local", runtimeSessionId: "pty-31" },
  }),
  row({ runtimeRunId: "run-40", spark: LYRA.id }),
];

const entryOf = (items: readonly NeedsItem[], spark: SparkSummary = VELA) => {
  const entry = sparkEntriesOf([spark], ROWS, { items }).find((each) => each.spark.id === spark.id);
  if (entry === undefined) throw new Error("no entry");
  return entry;
};

/** The answered item fieldd hands back: the item as it was, with its answer. */
const answered = (item: NeedsItem, choice: number, over: Record<string, unknown> = {}): NeedsItem =>
  NeedsItem.parse({
    ...item,
    state: "answered",
    answer: { choice, at: AT, outcome: "done", told: true, ...over },
  });

let root: Root | null = null;
let host: HTMLElement | null = null;
let stopFeed: (() => void) | null = null;
let stopHearing: (() => void) | null = null;
let noted: string[] = [];

beforeEach(() => {
  shown.opened = [];
  shown.outcome = { state: "shown" };
  noted = [];
  stopHearing = hearLineSays((text) => noted.push(text));
  resetStatusLineForTest();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  stopFeed?.();
  stopFeed = null;
  stopHearing?.();
  stopHearing = null;
  vi.useRealTimers();
});

const $ = (selector: string): HTMLElement | null =>
  host?.querySelector<HTMLElement>(selector) ?? null;
const card = (): HTMLElement | null => $(".vf-needs-card");
const acts = (): HTMLButtonElement[] => [
  ...(host?.querySelectorAll<HTMLButtonElement>(".vf-needs-act") ?? []),
];

/** The words an element shows, each text a word apart, as a person reads them. */
function words(element: Element | null): string {
  if (element === null) return "";
  const parts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.replace(/\s+/gu, " ").trim();
    if (text) parts.push(text);
  }
  return parts.join(" ");
}

function mount(element: ReactElement): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
}

describe('what the card says (DESIGN.md §8 "Chat\'s thread", the needs-you card; §9 "Chat\'s words")', () => {
  it("says a spark's own question as it asked it, its choices then Not now, the first primary", () => {
    const said = needsCardWords(needsCardOf(entryOf([QUESTION]), QUESTION));
    expect(said.eyebrow).toBe("Asking you");
    expect(said.question).toBe("Push the fix to main now, or hold it for the review?");
    expect(said.words).toBeNull();
    expect(said.sub).toBeNull();
    expect(said.acts).toEqual([
      { choice: 0, word: "Push", primary: true },
      { choice: 1, word: "Hold", primary: false },
      { choice: 2, word: "Not now", primary: false },
    ]);
    expect(said.show).toBe(false);
    expect(said.label).toBe("Asking you: Push the fix to main now, or hold it for the review?");
  });

  it('counts what waits with it, and names its place when more wait ("1 of 3")', () => {
    const entry = entryOf([QUESTION, HELD_SEND, HELD_SPAWN]);
    const it3 = needsCardOf(entry, QUESTION);
    expect(it3.of).toBe(3);
    expect(needsCardWords(it3).label).toBe(
      "Asking you: Push the fix to main now, or hold it for the review?, 1 of 3",
    );
    // the one this window answers, gone from the queue meanwhile, still counts itself
    expect(needsCardOf(entryOf([HELD_SEND, HELD_SPAWN]), QUESTION).of).toBe(3);
    expect(needsCardOf(entryOf([QUESTION]), QUESTION).of).toBe(1);
  });

  it("says a held send: to whom, its first held words and how many more, and how long a yes lasts", () => {
    const said = needsCardWords(needsCardOf(entryOf([HELD_SEND]), HELD_SEND));
    expect(said.eyebrow).toBe("Needs your OK");
    expect(said.question).toBe("Vela wants to send to claude·2");
    expect(said.words).toBe("run the tests in packages/fieldd and tell me what fails");
    expect(said.more).toBe("and 1 more");
    expect(said.sub).toBe("Your yes lasts until claude·2 ends.");
    expect(said.acts.map((each) => each.word)).toEqual(["Allow", "Not now"]);
    // words fieldd cut end in "…"
    const cut = NeedsItem.parse({ ...HELD_SEND, cut: true, count: 1 });
    const cutSaid = needsCardWords(needsCardOf(entryOf([cut]), cut));
    expect(cutSaid.words).toBe("run the tests in packages/fieldd and tell me what fails…");
    expect(cutSaid.more).toBeNull();
  });

  it("says a held spawn past the cap: the agent by the catalog's label, its folder, its task, and the cap", () => {
    const said = needsCardWords(needsCardOf(entryOf([HELD_SPAWN]), HELD_SPAWN));
    const label = AGENT_CATALOG.find((entry) => entry.id === HELD_SPAWN.agent)?.label;
    expect(said.eyebrow).toBe("Needs your OK");
    expect(said.question).toBe(`Vela wants another agent: ${label} in vibe-field`);
    expect(said.words).toBe("review the input queue's restore for a forged file");
    expect(said.sub).toBe("8 of Vela's agents are running, the most a spark may run.");
    expect(said.acts.map((each) => [each.word, each.primary])).toEqual([
      ["Allow one more", true],
      ["Not now", false],
    ]);
  });

  it("says an agent's own ask with its asker, answered in its pane: Show alone", () => {
    const said = needsCardWords(needsCardOf(entryOf([AGENT_ASK]), AGENT_ASK));
    expect(said.eyebrow).toBe("Needs your OK · claude·2");
    expect(said.question).toBe("claude·2 asks to run Bash");
    expect(said.sub).toBe("Answer it in its pane.");
    expect(said.acts).toEqual([]);
    expect(said.show).toBe(true);
    expect(said.label).toBe("Needs your OK, claude·2: claude·2 asks to run Bash");
    const noTool = NeedsItem.parse({ ...AGENT_ASK, tool: undefined });
    expect(needsCardWords(needsCardOf(entryOf([noTool]), noTool)).question).toBe(
      "claude·2 asks for your OK",
    );
    const question = NeedsItem.parse({ ...AGENT_ASK, ask: "question", tool: undefined });
    const asked = needsCardWords(needsCardOf(entryOf([question]), question));
    expect(asked.eyebrow).toBe("Asking you · claude·2");
    expect(asked.question).toBe("claude·2 has a question");
    const other = NeedsItem.parse({ ...AGENT_ASK, ask: "elicitation", tool: undefined });
    expect(needsCardWords(needsCardOf(entryOf([other]), other)).question).toBe(
      "claude·2 needs you",
    );
    // answered in its pane, never here (CP-L4, AR-6): choices handed with it draw no act
    const offered = NeedsItem.parse({ ...AGENT_ASK, choices: ["Yes", "No"] });
    const shown = needsCardWords(needsCardOf(entryOf([offered]), offered));
    expect([shown.acts, shown.show]).toEqual([[], true]);
  });

  it("draws a kind this build does not know, never drops it: Needs your OK, its words, its acts by their place", () => {
    const said = needsCardWords(needsCardOf(entryOf([UNKNOWN]), UNKNOWN));
    expect(said.eyebrow).toBe("Needs your OK");
    expect(said.question).toBe("Vela needs you");
    expect(said.words).toBe(UNKNOWN.words ?? null);
    expect(said.acts.map((each) => each.choice)).toEqual(
      (UNKNOWN.choices ?? []).map((_, index) => index),
    );
    // with no choices it shows its session's pane, else it has no act at all
    const bare = NeedsItem.parse({ ...UNKNOWN, choices: undefined });
    expect(needsCardWords(needsCardOf(entryOf([bare]), bare)).show).toBe(
      bare.from.session !== undefined,
    );
    const nowhere = NeedsItem.parse({
      ...UNKNOWN,
      choices: undefined,
      from: { name: UNKNOWN.from.name },
    });
    const none = needsCardWords(needsCardOf(entryOf([nowhere]), nowhere));
    expect([none.acts, none.show]).toEqual([[], false]);
  });

  it("says what you said once answered, and what the act came to when it did not go as asked", () => {
    expect(needsSaid(answered(QUESTION, 0), 0)).toEqual({ text: "You said Push", tone: "done" });
    expect(
      needsSaid(answered(HELD_SEND, 0, { outcome: "failed", reason: "claude·2 ended" }), 0),
    ).toEqual({
      text: "You said Allow · Couldn't send Vela's words to claude·2: claude·2 ended",
      tone: "failed",
    });
    expect(
      needsSaid(answered(HELD_SPAWN, 0, { outcome: "failed", reason: "no sign-in" }), 0),
    ).toEqual({
      text: "You said Allow one more · Couldn't start the agent: no sign-in",
      tone: "failed",
    });
    expect(
      needsSaid(answered(QUESTION, 1, { outcome: "failed", reason: "the disk is full" }), 1),
    ).toEqual({ text: "You said Hold · Couldn't finish it: the disk is full", tone: "failed" });
    const asleep = { told: false, waits: "Vela's session is not running yet" };
    expect(needsSaid(answered(QUESTION, 0, asleep), 0)).toEqual({
      text: "You said Push · Vela hears it when it wakes: Vela's session is not running yet",
      tone: "unheard",
    });
    // when both hold, the act's failure is what the line says
    expect(
      needsSaid(answered(HELD_SPAWN, 0, { ...asleep, outcome: "failed", reason: "no sign-in" }), 0)
        .tone,
    ).toBe("failed");
  });

  it("says only the words the canon records", () => {
    const design = readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");
    for (const text of [
      "Asking you",
      "Needs your OK · claude·2",
      "1 of 3",
      "Vela wants to send to claude·2",
      "Vela wants another agent: Claude Code in vibe-field",
      "claude·2 asks to run Bash",
      "claude·2 asks for your OK",
      "claude·2 has a question",
      "claude·2 needs you",
      "Vela needs you",
      "and 2 more",
      "Your yes lasts until claude·2 ends.",
      "8 of Vela's agents are running, the most a spark may run.",
      "Answer it in its pane.",
      "Allow…",
      "Couldn't answer: …",
      "You said Allow",
      "Couldn't send Vela's words to claude·2: …",
      "Couldn't start the agent: …",
      "Couldn't finish it: …",
      "Vela hears it when it wakes: …",
      "Could not jump — ‹why›",
    ]) {
      expect(design, text).toContain(text);
    }
  });
});

describe("the card, drawn (the shipping NeedsCardView)", () => {
  const draw = (item: NeedsItem, act?: NeedsAct, motion = {}) =>
    mount(<NeedsCardView card={needsCardOf(entryOf([item, HELD_SPAWN]), item, act, motion)} />);

  it("is a group named by its eyebrow and question, its acts the kit's buttons, the first primary and Not now last", () => {
    draw(QUESTION);
    const root = card();
    expect(root?.getAttribute("data-item")).toBe("needs");
    expect(root?.getAttribute("role")).toBe("group");
    expect(root?.getAttribute("aria-label")).toBe(
      "Asking you: Push the fix to main now, or hold it for the review?, 1 of 2",
    );
    expect(root?.hasAttribute("data-waits")).toBe(true);
    expect(words($(".vf-needs-eyebrow"))).toBe("Asking you");
    expect(words($(".vf-needs-place"))).toBe("1 of 2");
    expect(acts().map((button) => [words(button), button.dataset.variant])).toEqual([
      ["Push", "primary"],
      ["Hold", "quiet"],
      ["Not now", "quiet"],
    ]);
    expect(acts().every((button) => button.classList.contains("vf-ui-button"))).toBe(true);
    // a card that arrives never takes the keyboard; it can be given it (tabindex −1)
    expect(root?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(document.body);
  });

  it("describes itself by its words and its sub", () => {
    draw(HELD_SEND);
    const described = (card()?.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => words(document.getElementById(id)));
    expect(described).toEqual([
      "run the tests in packages/fieldd and tell me what fails and 1 more",
      "Your yes lasts until claude·2 ends.",
    ]);
  });

  it("while it answers, every act waits: the pressed one says its word with an ellipsis, the others dim", () => {
    draw(HELD_SEND, { state: "busy", choice: 0 });
    expect(acts().map((button) => words(button))).toEqual(["Allow…", "Not now"]);
    expect(acts()[0]?.getAttribute("aria-disabled")).toBe("true");
    expect(acts()[0]?.disabled).toBe(false);
    expect(acts()[1]?.disabled).toBe(true);
  });

  it("says a refusal under its words in the attention ink, and its acts stay", () => {
    draw(QUESTION, { state: "refused", reason: "already answered: Hold" });
    const refused = $(".vf-needs-refused");
    expect(words(refused)).toBe("Couldn't answer: already answered: Hold");
    expect(refused?.getAttribute("role")).toBe("status");
    expect(acts().map((button) => button.disabled)).toEqual([false, false, false]);
  });

  it("dims a refused card's acts once its item no longer waits, so nothing on it answers again", () => {
    const pressed: number[] = [];
    mount(
      <NeedsCardView
        card={needsCardOf(entryOf([HELD_SPAWN]), QUESTION, {
          state: "refused",
          reason: "already answered: Hold",
        })}
        onAnswer={(_item, choice) => void pressed.push(choice)}
      />,
    );
    expect(words($(".vf-needs-refused"))).toBe("Couldn't answer: already answered: Hold");
    expect(acts().map((button) => [words(button), button.disabled])).toEqual([
      ["Push", true],
      ["Hold", true],
      ["Not now", true],
    ]);
    act(() => {
      for (const button of acts()) button.click();
    });
    expect(pressed).toEqual([]);
  });

  it("answered here, gives its acts and count to one line: what you said, ringed in the hairline again", () => {
    draw(answered(QUESTION, 0), { state: "said", choice: 0 });
    expect(acts()).toEqual([]);
    expect($(".vf-needs-place")).toBeNull();
    const line = $(".vf-needs-said");
    expect(words(line)).toBe("You said Push");
    expect(line?.getAttribute("role")).toBe("status");
    expect(line?.querySelector(".vf-glyph")?.getAttribute("data-glyph")).toBe("check");
    expect(card()?.hasAttribute("data-waits")).toBe(false);
    act(() => root?.unmount());
    host?.remove();
    draw(answered(HELD_SPAWN, 0, { outcome: "failed", reason: "no sign-in" }), {
      state: "said",
      choice: 0,
    });
    expect($(".vf-needs-said")?.getAttribute("data-tone")).toBe("failed");
    expect($(".vf-needs-said .vf-glyph")?.getAttribute("data-glyph")).toBe("exclaim");
  });

  it("goes inert on its way out, and fades where it stands with reduced motion", () => {
    draw(QUESTION, undefined, { leaving: true, reduced: true });
    expect(card()?.hasAttribute("inert")).toBe(true);
    expect(card()?.hasAttribute("data-leaving")).toBe(true);
    expect(card()?.getAttribute("data-motion")).toBe("reduced");
  });

  it("is drawn by the numbers DESIGN.md gives, in tokens and the named easings", () => {
    const css = readFileSync(join(here, "../src/chat/needs-card.css"), "utf8");
    const rule = (selector: string) =>
      css.match(
        new RegExp(`^${selector.replace(/[.[\]()"=]/g, "\\$&")} \\{([^}]*)\\}`, "m"),
      )?.[1] ?? "";
    expect(rule(".vf-needs-card")).toMatch(/padding: 14px 16px;/);
    expect(rule(".vf-needs-card")).toMatch(/gap: 5px;/);
    expect(rule(".vf-needs-card")).toMatch(/border-radius: 16px;/);
    expect(rule(".vf-needs-card")).toMatch(/animation: vf-needs-in 240ms var\(--vf-ease-island\)/);
    expect(rule(".vf-needs-card[data-waits]")).toMatch(
      /0 0 0 1\.5px color-mix\(in srgb, var\(--vf-orange\) 75%, transparent\)/,
    );
    expect(rule(".vf-needs-card[data-leaving]")).toMatch(/animation: vf-needs-out 180ms ease/);
    expect(rule('.vf-needs-card[data-motion="reduced"]')).toMatch(/120ms ease/);
    expect(rule(".vf-needs-acts")).toMatch(/padding-top: 8px;/);
    expect(rule(".vf-needs-acts")).toMatch(/gap: 8px;/);
    expect(rule(".vf-needs-said")).toMatch(/padding-top: 4px;/);
    expect(css).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect([NEEDS_SAID_MS, NEEDS_LEAVE_MS, NEEDS_FADE_MS]).toEqual([2_400, 180, 120]);
  });
});

describe("what stands in the thread while a card does (the thread's items, one at a time)", () => {
  it("stands the card in the hello's place: a thread with something waiting on you is not quiet", () => {
    const entry = entryOf([QUESTION]);
    expect(threadQuiet(entry, true, false)).toBe(false);
    const it1 = needsCardOf(entry, QUESTION);
    expect(threadItemsOf(entry, true, it1)).toEqual([it1]);
    expect(threadItemsOf(entry, false, null)).toEqual([]);
  });
});

// ── the controller: ChatView over a running feed ──

/** The queue and its doors, as the test drives them. */
const queue = {
  items: [] as readonly NeedsItem[],
  push: null as ((items: readonly NeedsItem[]) => void) | null,
  asked: [] as { readonly item: NeedsItemId; readonly choice: number }[],
  /** each answer's settling, in order asked */
  answers: [] as {
    readonly resolve: (item: NeedsItem) => void;
    readonly reject: (error: Error) => void;
  }[],
};

function feed(sparks: SparkSummary[] = [VELA]): SparksPort {
  return {
    list: async () => sparks,
    watch: async (onFrame) => {
      onFrame({ revision: 1, rows: ROWS }, "snapshot");
      return () => undefined;
    },
    watchNeeds: async (onItems) => {
      queue.push = onItems;
      onItems(queue.items);
      return () => undefined;
    },
    answer: (item, choice) => {
      queue.asked.push({ item, choice });
      return new Promise((resolve, reject) => queue.answers.push({ resolve, reject }));
    },
    onReconnected: () => () => undefined,
    open: async (id) => sparks.find((spark) => spark.id === id) ?? VELA,
  };
}

const PORT: ComposerPort = {
  profileSets: async () => [],
  models: async () => {
    throw new Error("no picker here");
  },
};

let setActive: ((active: boolean) => void) | null = null;

async function mountChat(items: readonly NeedsItem[], sparks: SparkSummary[] = [VELA]) {
  queue.items = items;
  queue.asked = [];
  queue.answers = [];
  stopFeed = startSparksFeed(feed(sparks));
  function Owner(): ReactElement {
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    const [active, set] = useState(true);
    setActive = set;
    return <ChatView active={active} surface={surface} onSurfaceChange={setSurface} port={PORT} />;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<Owner />));
  await settle();
}

const settle = () => act(async () => undefined);
const frame = (items: readonly NeedsItem[]) => act(async () => queue.push?.(items));
const press = (word: string) =>
  act(async () =>
    acts()
      .find((button) => words(button) === word)
      ?.click(),
  );
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const settleAnswer = (at: number, item: NeedsItem) =>
  act(async () => queue.answers[at]?.resolve(item));

describe("the card in Chat's thread, live (useNeedsCard under ChatView)", () => {
  it("stands in the thread's foot over the pane, before the composer, and never takes the keyboard", async () => {
    await mountChat([QUESTION]);
    const root = card();
    expect(root?.closest(".vf-chat-items")?.parentElement?.className).toBe("vf-chat-foot");
    const foot = [...($(".vf-chat-foot")?.children ?? [])].map((child) => child.className);
    expect(foot[0]).toBe("vf-chat-items");
    expect(foot.some((name) => name.includes("vf-chat-composer"))).toBe(true);
    expect(document.activeElement).toBe(document.body);
    // no hello while it stands, though the draft is empty
    expect($(".vf-chat-hello")).toBeNull();
  });

  it("an answer clears the item: sent by its place, the card stands until fieldd answers, says what you said, then leaves", async () => {
    await mountChat([QUESTION, HELD_SEND]);
    vi.useFakeTimers();
    await press("Hold");
    expect(queue.asked).toEqual([{ item: QUESTION.id, choice: 1 }]);
    // the keyboard is on the card itself while it answers
    expect(document.activeElement).toBe(card());
    expect(acts().map((button) => words(button))).toEqual(["Push", "Hold…", "Not now"]);
    // fieldd drops the item from the queue before it has told the spark: the card stands
    await frame([HELD_SEND]);
    expect(words($(".vf-needs-question"))).toBe(QUESTION.words);
    expect(words($(".vf-needs-place"))).toBe("1 of 2");
    await settleAnswer(0, answered(QUESTION, 1));
    expect(words($(".vf-needs-said"))).toBe("You said Hold");
    tick(NEEDS_SAID_MS - 1);
    expect(card()?.hasAttribute("data-leaving")).toBe(false);
    tick(1);
    // on its way out it is inert, and the next waits for it to go
    expect(card()?.hasAttribute("inert")).toBe(true);
    expect(words($(".vf-needs-said"))).toBe("You said Hold");
    tick(NEEDS_LEAVE_MS);
    // the next rises in its place, and takes the keyboard the last one held: the card, never an act
    expect(words($(".vf-needs-question"))).toBe("Vela wants to send to claude·2");
    expect(card()?.hasAttribute("data-leaving")).toBe(false);
    expect(document.activeElement).toBe(card());
    // an answer that went as asked says nothing on the status line: the pane's line of facts says it
    expect(statusLineSaid()).toEqual([]);
  });

  it("leaves at once, saying nothing, when the item is answered in another window", async () => {
    await mountChat([QUESTION]);
    vi.useFakeTimers();
    await frame([]);
    expect(card()?.hasAttribute("data-leaving")).toBe(true);
    expect(card()?.hasAttribute("inert")).toBe(true);
    tick(NEEDS_LEAVE_MS);
    expect(card()).toBeNull();
    expect(statusLineSaid()).toEqual([]);
    expect(queue.asked).toEqual([]);
  });

  it("a held send is answered only by Allow (its words land in fieldd then), and Not now holds them back", async () => {
    const other = NeedsItem.parse({ ...HELD_SEND, id: "ny-8c41d2e09a77b306" });
    await mountChat([HELD_SEND, other]);
    vi.useFakeTimers();
    expect(words($(".vf-needs-sub"))).toBe("Your yes lasts until claude·2 ends.");
    expect(queue.asked).toEqual([]);
    await press("Allow");
    expect(queue.asked).toEqual([{ item: HELD_SEND.id, choice: 0 }]);
    await frame([other]);
    await settleAnswer(0, answered(HELD_SEND, 0));
    tick(NEEDS_SAID_MS);
    tick(NEEDS_LEAVE_MS);
    await press("Not now");
    expect(queue.asked).toEqual([
      { item: HELD_SEND.id, choice: 0 },
      { item: other.id, choice: 1 },
    ]);
  });

  it("the cap holds a spawn: its card says so, Allow one more starts it, and an agent that could not start is said there", async () => {
    await mountChat([HELD_SPAWN]);
    expect(words($(".vf-needs-sub"))).toBe(
      "8 of Vela's agents are running, the most a spark may run.",
    );
    await press("Allow one more");
    expect(queue.asked).toEqual([{ item: HELD_SPAWN.id, choice: 0 }]);
    await frame([]);
    await settleAnswer(0, answered(HELD_SPAWN, 0, { outcome: "failed", reason: "no sign-in" }));
    const line = $(".vf-needs-said");
    expect(words(line)).toBe("You said Allow one more · Couldn't start the agent: no sign-in");
    expect(line?.getAttribute("data-tone")).toBe("failed");
    // said on the card, so not again on the status line
    expect(statusLineSaid()).toEqual([]);
  });

  it("says a refusal on the card and keeps its acts while the item waits; one no longer waiting dims them and leaves 2.4 s after", async () => {
    await mountChat([QUESTION]);
    await press("Push");
    await act(async () => queue.answers[0]?.reject(new Error("fieldd is restarting")));
    expect(words($(".vf-needs-refused"))).toBe("Couldn't answer: fieldd is restarting");
    expect(acts().map((button) => button.disabled)).toEqual([false, false, false]);
    // pressed again, it answers again
    await press("Push");
    expect(queue.asked).toHaveLength(2);
    vi.useFakeTimers();
    await frame([]);
    await act(async () => queue.answers[1]?.reject(new Error("already answered: Hold")));
    expect(words($(".vf-needs-refused"))).toBe("Couldn't answer: already answered: Hold");
    // its item waits no longer: its acts dim, and a press answers nothing, nor keeps the card longer
    expect(acts().map((button) => button.disabled)).toEqual([true, true, true]);
    tick(NEEDS_SAID_MS / 2);
    await press("Push");
    expect(queue.asked).toHaveLength(2);
    tick(NEEDS_SAID_MS / 2 - 1);
    expect(card()?.hasAttribute("data-leaving")).toBe(false);
    tick(1);
    expect(card()?.hasAttribute("data-leaving")).toBe(true);
    tick(NEEDS_LEAVE_MS);
    expect(card()).toBeNull();
    // the keyboard the card held goes to the draft
    expect(document.activeElement).toBe($(".vf-chat-input"));
  });

  it("says what you said until the queue drops the item, never its acts again, though fieldd's frame comes late", async () => {
    await mountChat([QUESTION]);
    vi.useFakeTimers();
    await press("Push");
    await settleAnswer(0, answered(QUESTION, 0));
    tick(NEEDS_SAID_MS);
    // the queue still lists it: the card stands as answered, its acts gone
    expect(words($(".vf-needs-said"))).toBe("You said Push");
    expect(acts()).toEqual([]);
    expect(card()?.hasAttribute("data-leaving")).toBe(false);
    await frame([]);
    expect(card()?.hasAttribute("data-leaving")).toBe(true);
    tick(NEEDS_LEAVE_MS);
    expect(card()).toBeNull();
    expect(queue.asked).toHaveLength(1);
  });

  it("answers an item once while its answer runs: a second press does nothing", async () => {
    await mountChat([QUESTION]);
    await press("Push");
    // the pressed act holds no handler while it runs, and the others are disabled
    await act(async () => {
      for (const button of acts()) button.click();
    });
    expect(queue.asked).toEqual([{ item: QUESTION.id, choice: 0 }]);
  });

  it("says a refusal that returns off screen on the status line, in the card's words", async () => {
    await mountChat([QUESTION]);
    await press("Hold");
    act(() => setActive?.(false));
    await act(async () => queue.answers[0]?.reject(new Error("fieldd is restarting")));
    expect(statusLineSaid()).toEqual([
      { id: `needs-answer:${QUESTION.id}`, text: "Couldn't answer: fieldd is restarting" },
    ]);
    // back on screen, the item still waits: its card stands with its acts, the refusal said once
    act(() => setActive?.(true));
    await settle();
    expect($(".vf-needs-refused")).toBeNull();
    expect(acts().map((button) => button.disabled)).toEqual([false, false, false]);
  });

  it("goes with its thread at once; an answer that returns off screen and did not go as asked is said on the status line", async () => {
    await mountChat([HELD_SEND], [VELA, LYRA]);
    // Lyra sorts first (a tie by name): Vela's thread is chosen
    await act(async () => $(`.vf-chat-row[data-spark="${VELA.id}"]`)?.click());
    await press("Allow");
    expect(queue.asked).toEqual([{ item: HELD_SEND.id, choice: 0 }]);
    await act(async () => $(`.vf-chat-row[data-spark="${LYRA.id}"]`)?.click());
    expect(card()).toBeNull();
    await frame([]);
    await settleAnswer(0, answered(HELD_SEND, 0, { outcome: "failed", reason: "claude·2 ended" }));
    expect(statusLineSaid()).toEqual([
      {
        id: `needs-answer:${HELD_SEND.id}`,
        text: "You said Allow · Couldn't send Vela's words to claude·2: claude·2 ended",
      },
    ]);
  });

  it("says an unheard answer on the status line when Chat is no longer the view, and a done one nowhere", async () => {
    await mountChat([QUESTION, HELD_SEND]);
    await press("Push");
    act(() => setActive?.(false));
    await frame([HELD_SEND]);
    await settleAnswer(
      0,
      answered(QUESTION, 0, { told: false, waits: "Vela's session is not running yet" }),
    );
    expect(statusLineSaid().map((notice) => notice.text)).toEqual([
      "You said Push · Vela hears it when it wakes: Vela's session is not running yet",
    ]);
    act(() => setActive?.(true));
    await settle();
    await press("Allow");
    act(() => setActive?.(false));
    await frame([]);
    await settleAnswer(1, answered(HELD_SEND, 0));
    expect(statusLineSaid()).toHaveLength(1);
  });

  it("Show goes to an agent's ask's pane in Godview by Jump to's path, and a pane it cannot show is said on the line", async () => {
    await mountChat([AGENT_ASK]);
    expect(acts().map((button) => [words(button), button.dataset.variant])).toEqual([
      ["Show", "quiet"],
    ]);
    await press("Show");
    expect(shown.opened).toEqual([
      { row: { id: "run-31", floorSessionId: "pty-31" }, from: "assistant" },
    ]);
    expect(queue.asked).toEqual([]);
    shown.outcome = { state: "refused", reason: "the deck did not open to show it" };
    await press("Show");
    await settle();
    expect(noted).toEqual(["Could not jump — the deck did not open to show it"]);
  });
});

describe("the catalog's needs-you card (docs/UI_SYSTEM.md: the shipping view on a fixture adapter)", () => {
  it("draws the waiting plate's card in Kiwi's thread, the product's own reading of the fixture queue", async () => {
    mount(<ChatPreview state="waiting" />);
    await settle();
    expect(words($(".vf-needs-eyebrow"))).toBe("Needs your OK");
    expect(words($(".vf-needs-question"))).toMatch(/^Kiwi wants to send to /u);
    expect(card()?.closest(".vf-chat-foot")).not.toBeNull();
  });

  it("draws every kind and state on its plates: an unknown kind, waiting, refused, answered three ways, narrow and by night", async () => {
    mount(<NeedsCardPlates />);
    await settle();
    const plates = [...(host?.querySelectorAll<HTMLElement>("[data-plate]") ?? [])];
    const states = plates.map((plate) => plate.dataset.plate);
    for (const state of [
      "question",
      "held-send",
      "held-spawn",
      "agent-ask",
      "unknown",
      "busy",
      "refused",
      "refused-gone",
      "done",
      "failed",
      "unheard",
      "narrow",
    ]) {
      expect(states, state).toContain(state);
    }
    // every plate is the shipping card, and the night row is the same cards under the night tokens
    for (const plate of plates)
      expect(plate.querySelector(".vf-needs-card"), plate.dataset.plate).not.toBeNull();
    expect(host?.querySelector(".dark .vf-needs-card")).not.toBeNull();
    // refused once another window has answered it, its acts go quiet
    const gone = [
      ...(host?.querySelectorAll<HTMLButtonElement>('[data-plate="refused-gone"] .vf-needs-act') ??
        []),
    ];
    expect(gone.length).toBeGreaterThan(0);
    expect(gone.every((button) => button.disabled)).toBe(true);
    expect(host?.querySelector('[data-plate="unknown"] .vf-needs-question')?.textContent).toMatch(
      / needs you$/u,
    );
  });
});
