/**
 * TH-1 — the flow, drawn (`chat/ThreadFlowView.tsx`; DESIGN.md §8 "Chat's thread"): the catalog's thread plates,
 * mounted as the catalog mounts them (the shipping view over the product's own projection of fixture record lines,
 * docs/UI_SYSTEM.md), and the flow alone for what an agent's words may never become.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { CrewCard, CrewCardRow } from "../src/chat/crew-card";
import { ThreadFlowView } from "../src/chat/ThreadFlowView";
import { FLOW_WORDS } from "../src/chat/transcript-items";
import { ChatPreview } from "../src/design-system/ChatPreview";
import { CrewCardPlates } from "../src/design-system/CrewCardPreview";
import type { ChatState } from "../src/design-system/chat-fixtures";

let host: HTMLElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

async function mount(node: React.ReactElement): Promise<void> {
  act(() => root?.unmount());
  host?.remove();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(node));
}

const plate = (state: ChatState) => mount(<ChatPreview state={state} locale="en-US" />);
const $ = (selector: string) => host?.querySelector<HTMLElement>(selector) ?? null;
const $$ = (selector: string) => [...(host?.querySelectorAll<HTMLElement>(selector) ?? [])];
const words = (element: Element | null | undefined) =>
  (element?.textContent ?? "").replace(/\s+/gu, " ").trim();
const rows = () => $$(".vf-chat-flow-col > *").map((row) => row.dataset.row);

describe("the thread's plates (TH-1)", () => {
  it("draws the conversation in the pane's place, the earlier one folded, and the composer at the foot", async () => {
    await plate("thread");
    expect($(".vf-spark-pane")).toBeNull();
    expect($(".vf-chat-flow")?.dataset.flowState).toBe("ready");
    expect(rows()).toEqual([
      "earlier",
      "day",
      "you",
      "tools",
      "reply",
      "act",
      "day",
      "act",
      "you",
      "reply",
    ]);
    expect(words($('[data-row="earlier"]'))).toBe(FLOW_WORDS.earlier(1));
    // VibeField's own served call leaves the count; the line opens to each tool by its kind
    const tools = $('[data-row="tools"] button');
    expect(words(tools)).toBe("Used 3 tools");
    expect(tools?.getAttribute("aria-expanded")).toBe("false");
    act(() => tools?.click());
    expect($$(".vf-chat-tool-rows li").map((row) => words(row.querySelector("span")))).toEqual([
      "Read a file",
      "Ran a command",
      "Edited a file",
    ]);
    // your chip is drawn as its words, never the run id it carries for the spark's tools
    const chip = $(".vf-chat-bubble-chip");
    expect([chip?.dataset.chip, words(chip)]).toEqual(["session", "Claude Code in vibe-field"]);
    expect(words($$('[data-row="you"]').at(-1)?.querySelector(".vf-chat-receipt"))).toBe(
      "Delivered",
    );
    expect($$('[data-row="you"]')[0]?.querySelector(".vf-chat-receipt")).toBeNull();
    expect(words($$('[data-row="act"]').at(-1))).toBe(
      'VibeField told Juno: you answered Lyra\'s question "Push the fix?": Yes',
    );
    expect($(".vf-chat-composer")).not.toBeNull();
  });

  it("draws Vela's face once per run of its rows", async () => {
    await plate("thread");
    const leads = $$(".vf-chat-flow-col > .vf-chat-msg").map(
      (row) => row.firstElementChild?.classList.contains("vf-chat-msg-gap") === false,
    );
    expect(leads).toEqual([true, false, false, true, true]);
  });

  it("opens every conversation, each with its own line, once asked", async () => {
    await plate("thread-earlier");
    expect(rows()[0]).toBe("day");
    expect(
      $$('[data-row="day"]')
        .map((row) => words(row))
        .filter((line) => line.startsWith("A new conversation")),
    ).toHaveLength(2);
    expect($('[data-row="earlier"]')).toBeNull();
  });

  it("draws a reply in the named subset, its link as words", async () => {
    await plate("thread-long");
    const reply = $('[data-row="reply"] .vf-chat-reply-text');
    expect(reply?.querySelector("p strong")?.textContent).toBe("What changed");
    expect(reply?.querySelectorAll("ul li code")).toHaveLength(2);
    expect(reply?.querySelector("pre.vf-chat-code code")?.textContent).toBe(
      "useLayoutEffect(() => editor.current?.focus(), []);",
    );
    expect(words(reply?.querySelector("blockquote"))).toBe("The other suites were already green.");
    expect(reply?.querySelector("a")).toBeNull();
    expect(words(reply)).toContain("The run is in the CI log.");
    // Spark QA F1, 2026-11-25 — a table drawn as one: its head's cells name their columns, its cells in the subset,
    // each set by its column's colons, in a box of its own that scrolls sideways (thread-flow.css)
    const table = reply?.querySelector(":scope > .vf-chat-table > table");
    expect(
      [...(table?.querySelectorAll("thead th") ?? [])].map((th) => [
        th.getAttribute("scope"),
        words(th),
        th.getAttribute("data-align"),
      ]),
    ).toEqual([
      ["col", "Suite", null],
      ["col", "Tests", "right"],
      ["col", "Time", "right"],
    ]);
    expect(
      [...(table?.querySelectorAll("tbody tr") ?? [])].map((tr) =>
        [...tr.querySelectorAll("td")].map(words),
      ),
    ).toEqual([
      ["chat-composer", "42", "1.2 s"],
      ["thread-flow", "18", "0.9 s"],
    ]);
    expect(table?.querySelectorAll("tbody td:first-child > code")).toHaveLength(2);
  });

  it("scrolls a wide table sideways inside its own box, never widening the thread (Spark QA F1, 2026-11-25)", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/chat/thread-flow.css"),
      "utf8",
    );
    const box = css.match(/^\.vf-chat-reply-text \.vf-chat-table \{([^}]*)\}/mu)?.[1] ?? "";
    expect(box).toContain("max-width: 100%;");
    expect(box).toContain("overflow-x: auto;");
    // a cell's words break only where they may, so a wide table scrolls rather than splitting its words
    const cells = css.match(/^\.vf-chat-table th,\n\.vf-chat-table td \{([^}]*)\}/mu)?.[1] ?? "";
    expect(cells).toContain("overflow-wrap: normal;");
  });

  it("draws an asleep spark's conversation too", async () => {
    await plate("thread-asleep");
    expect(rows()).toEqual(["day", "reply"]);
    expect($(".vf-spark-pane")).toBeNull();
  });

  it("says each receipt, and none under words typed into the terminal", async () => {
    await plate("thread-receipts");
    expect(
      $$('[data-row="you"]').map((row) => words(row.querySelector(".vf-chat-receipt")) || null),
    ).toEqual([
      null,
      "Not delivered: Juno's session ended",
      "Juno may not have it: look in its pane",
      null,
      "Queued",
    ]);
    expect($('[data-row="you"] .vf-chat-receipt[data-tone="attention"]')).not.toBeNull();
  });

  it("draws Thinking… at the foot while the spark's own run works", async () => {
    await plate("thread-thinking");
    expect(rows().at(-1)).toBe("thinking");
    expect(words($('[data-row="thinking"]'))).toBe("Thinking…");
    expect(words($$('[data-row="you"]').at(-1)?.querySelector(".vf-chat-receipt"))).toBe(
      "Queued · Juno is busy; it lands when it's done",
    );
  });

  it("says the honest lines", async () => {
    await plate("thread-honest");
    expect($$('[data-row="honest"]').map((row) => row.dataset.honest)).toEqual([
      "dropped",
      "before",
      "gap",
    ]);
  });

  it("says reading, and fieldd's refusal, in the flow's place", async () => {
    await plate("thread-reading");
    expect(words($(".vf-chat-flow"))).toBe(FLOW_WORDS.reading("Juno"));
    await plate("thread-unreadable");
    expect($(".vf-chat-flow")?.dataset.flowState).toBe("unreadable");
    expect(words($(".vf-chat-flow"))).toMatch(/^Couldn't read Juno's conversation: /u);
  });

  it("stands the hello as the flow's first row while the spark is new", async () => {
    await plate("thread-hello");
    expect(rows()).toEqual(["hello"]);
    expect($$('[data-row="hello"] .vf-chat-starter')).toHaveLength(3);
    // the hello stands once: none among the foot's items
    expect($$(".vf-chat-items > *")).toHaveLength(0);
  });
});

describe("the needs-you card at the foot (TH-1; TH-Q26 (a), TH-Q29 (a))", () => {
  it("holds the spark's own run's ask at the foot, above the composer, in its name", async () => {
    await plate("thread-asks");
    const card = $(".vf-chat-foot .vf-chat-items > .vf-needs-card");
    expect(card?.hasAttribute("data-own")).toBe(true);
    expect(words(card?.querySelector(".vf-needs-eyebrow"))).toBe("Asking you");
    expect(words(card?.querySelector(".vf-needs-question"))).toBe("Vela has a question");
    expect(words(card?.querySelector(".vf-needs-act"))).toBe("Show");
    // the flow stands beside it, never under it
    expect(rows()).toEqual(["day", "you", "reply"]);
    expect($(".vf-chat-flow .vf-needs-card")).toBeNull();
  });

  it("holds the hello's starters in their places, wordless, while this Mac's agents and board are read (ES-4)", async () => {
    const hello = {
      state: "ready",
      items: [
        {
          kind: "hello",
          key: "hello",
          face: { seed: 1, status: "ready" },
          words: "Hi, I'm Vela.",
          starters: [{ glyph: "agents", words: "Spawn 4 Grok agents to research a topic each" }],
        },
      ],
    } as const;
    const heldOf = (): (string | undefined)[] =>
      [...document.querySelectorAll<HTMLElement>('[data-row="hello"] .vf-chat-starter')].map(
        (starter) => starter.dataset.held,
      );
    await mount(
      <ThreadFlowView name="Vela" face={{ seed: 1, status: "ready" }} flow={hello} startersHeld />,
    );
    expect(heldOf()).toEqual(["true"]);
    await mount(<ThreadFlowView name="Vela" face={{ seed: 1, status: "ready" }} flow={hello} />);
    expect(heldOf()).toEqual([undefined]);
  });

  it("keeps the hello first in the flow while an ask stands at the foot (CO-Q2 (b))", async () => {
    await plate("thread-hello-asks");
    expect(rows()).toEqual(["hello"]);
    expect($$(".vf-chat-items > .vf-needs-card")).toHaveLength(1);
    expect(words($(".vf-needs-question"))).toBe("Polaris asks for your OK");
  });
});

describe("an agent's words are never markup (EL7)", () => {
  it("draws markup, a link and an image as text", async () => {
    await mount(
      <ThreadFlowView
        name="Vela"
        face={{ seed: 1, status: "ready" }}
        flow={{
          state: "ready",
          items: [
            {
              kind: "reply",
              key: "r",
              lead: true,
              text: '<img src=x onerror="alert(1)"> [press](javascript:alert(1)) ![p](https://evil.invalid/p.png)',
            },
            {
              kind: "you",
              key: "y",
              text: "<b>bold?</b>",
              chips: [],
              receipt: null,
            },
          ],
        }}
      />,
    );
    expect($("img")).toBeNull();
    expect($("a")).toBeNull();
    expect($("b")).toBeNull();
    expect(words($('[data-row="reply"]'))).toBe('<img src=x onerror="alert(1)"> press p');
    expect(words($('[data-row="you"]'))).toBe("<b>bold?</b>");
  });

  it("draws a table's cells as text too (Spark QA F1, 2026-11-25)", async () => {
    await mount(
      <ThreadFlowView
        name="Vela"
        face={{ seed: 1, status: "ready" }}
        flow={{
          state: "ready",
          items: [
            {
              kind: "reply",
              key: "r",
              lead: true,
              text: '| <img src=x onerror="alert(1)"> | [press](javascript:alert(1)) |\n|---|---|\n| <b>x</b> | `<i>y</i>` |',
            },
          ],
        }}
      />,
    );
    expect($("img")).toBeNull();
    expect($("a")).toBeNull();
    expect($("b")).toBeNull();
    expect($("i")).toBeNull();
    expect($$(".vf-chat-table th").map(words)).toEqual(['<img src=x onerror="alert(1)">', "press"]);
    expect($$(".vf-chat-table td").map(words)).toEqual(["<b>x</b>", "<i>y</i>"]);
  });
});

describe("a crew's card in the flow (SP-1e2's renderer half; DESIGN.md §8 'Chat's crew card')", () => {
  const CARD: CrewCard = {
    id: "cr-000001",
    title: "2 agents",
    dim: " · Opus 5.5 · high",
    count: { words: "1 of 2 done", ring: 0.5, check: false },
    rows: [
      {
        runtimeRunId: "run-21",
        agent: "claude",
        name: "vibe-field",
        model: "Opus 5.5 · high",
        state: "done",
        passing: null,
        pressable: true,
        label: "vibe-field, Opus 5.5, high, Done",
      },
      {
        runtimeRunId: "run-22",
        agent: "claude",
        name: "vibe-field·2",
        model: "Opus 5.5 · high",
        state: "working",
        passing: null,
        pressable: true,
        label: "vibe-field·2, Opus 5.5, high, Working",
      },
      {
        runtimeRunId: "run-23",
        agent: "claude",
        name: "Claude Code in vibe-field",
        model: "Opus 5.5 · high",
        state: "ended",
        passing: null,
        pressable: false,
        label: "Claude Code in vibe-field, Opus 5.5, high, Ended",
      },
    ],
    line: null,
    label: "2 agents · Opus 5.5 · high, 1 of 2 done",
    // SP-1e4 — its working member is at work: Pause all and Stop all would each take it
    atWork: true,
    acts: { pause: ["run-22"], stop: ["run-22"] },
  };
  const crewFlow = (crew: string) =>
    ({
      state: "ready",
      items: [
        {
          kind: "act",
          key: `act:crew:${crew}`,
          what: "crew",
          words: "Started 2 agents · Opus 5.5 · high",
          lead: true,
          crew,
        },
      ],
    }) as const;

  it("hangs the card under its act line in the line's body, a group named by its head, its rows and foot in order", async () => {
    const pressed: string[] = [];
    let opened = 0;
    await mount(
      <ThreadFlowView
        name="Vela"
        face={{ seed: 1, status: "ready" }}
        flow={crewFlow("cr-000001")}
        crews={new Map([["cr-000001", CARD]])}
        onCrewRow={(run) => pressed.push(run)}
        onOpenGodview={() => {
          opened += 1;
        }}
      />,
    );
    const card = $('[data-row="act"] .vf-chat-msg-body > .vf-crew-card');
    expect(card).not.toBeNull();
    expect(words($('[data-row="act"] .vf-chat-quiet'))).toBe("Started 2 agents · Opus 5.5 · high");
    expect(card?.getAttribute("role")).toBe("group");
    expect(card?.getAttribute("aria-label")).toBe(CARD.label);
    expect(words($(".vf-crew-head"))).toBe("2 agents · Opus 5.5 · high 1 of 2 done");
    expect($$(".vf-crew-row").map((r) => r.dataset.state)).toEqual(["done", "working", "ended"]);
    // a working row's mark breathes; an Ended row is no button
    expect($$(".vf-crew-row")[1]?.querySelector(".vf-crew-breath")).not.toBeNull();
    expect($$(".vf-crew-row").map((r) => r.tagName)).toEqual(["BUTTON", "BUTTON", "DIV"]);
    expect($$(".vf-crew-row")[1]?.getAttribute("aria-label")).toBe(
      "vibe-field·2, Opus 5.5, high, Working",
    );
    // the ring, filled by the members no longer at work
    expect($(".vf-crew-ring")?.dataset.fill).toBe("0.5");
    await act(async () => $$(".vf-crew-row")[1]?.click());
    await act(async () => $$(".vf-crew-row")[2]?.click());
    expect(pressed).toEqual(["run-22"]);
    const open = $(".vf-crew-foot button");
    expect(words(open)).toBe("Open in Godview");
    await act(async () => open?.click());
    expect(opened).toBe(1);
  });

  it("stands a crew's act line alone when there is no card for its crew", async () => {
    await mount(
      <ThreadFlowView
        name="Vela"
        face={{ seed: 1, status: "ready" }}
        flow={crewFlow("cr-000009")}
        crews={new Map([["cr-000001", CARD]])}
      />,
    );
    expect($('[data-row="act"]')).not.toBeNull();
    expect($(".vf-crew-card")).toBeNull();
  });

  it("stands Pause all and Stop all after Open in Godview only while a member is at work, each handing its card, and says a row's passing word in its state's place (SP-1e4)", async () => {
    const pressed: string[] = [];
    const still: CrewCard = {
      ...CARD,
      rows: CARD.rows.map(
        (row): CrewCardRow =>
          row.runtimeRunId === "run-22"
            ? { ...row, passing: "still", label: "vibe-field·2, Opus 5.5, high, Still running" }
            : row,
      ),
    };
    await mount(
      <ThreadFlowView
        name="Vela"
        face={{ seed: 1, status: "ready" }}
        flow={crewFlow("cr-000001")}
        crews={new Map([["cr-000001", still]])}
        onPauseAll={(card) => pressed.push(`pause ${card.id}`)}
        onStopAll={(card) => pressed.push(`stop ${card.id}`)}
      />,
    );
    const foot = $$(".vf-crew-foot button");
    expect(foot.map(words)).toEqual(["Open in Godview", "Pause all", "Stop all"]);
    await act(async () => foot[1]?.click());
    await act(async () => foot[2]?.click());
    expect(pressed).toEqual(["pause cr-000001", "stop cr-000001"]);
    // the passing word stands alone in its state's place, the row keeping its state; its name says it too
    const held = $$(".vf-crew-row")[1];
    expect([held?.dataset.state, held?.dataset.passing]).toEqual(["working", "still"]);
    expect(words(held?.querySelector(".vf-crew-state"))).toBe("Still running");
    expect(held?.querySelector(".vf-crew-breath")).toBeNull();
    expect(held?.getAttribute("aria-label")).toBe("vibe-field·2, Opus 5.5, high, Still running");
    // Still running in the attention ink, by the row's mark and the card's own CSS (tokens only)
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/chat/crew-card.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\[data-passing="still"\] \.vf-crew-state \{\s*color: var\(--vf-ink-attention\);/u,
    );
    // no member at work: Open in Godview alone
    const resting: CrewCard = { ...CARD, atWork: false, acts: { pause: [], stop: [] } };
    await mount(
      <ThreadFlowView
        name="Vela"
        face={{ seed: 1, status: "ready" }}
        flow={crewFlow("cr-000001")}
        crews={new Map([["cr-000001", resting]])}
      />,
    );
    expect($$(".vf-crew-foot button").map(words)).toEqual(["Open in Godview"]);
    // each act stands only while it has a member to take: one Starting member is Stop all's, not Pause all's
    const starting: CrewCard = { ...CARD, acts: { pause: [], stop: ["run-22"] } };
    await mount(
      <ThreadFlowView
        name="Vela"
        face={{ seed: 1, status: "ready" }}
        flow={crewFlow("cr-000001")}
        crews={new Map([["cr-000001", starting]])}
      />,
    );
    expect($$(".vf-crew-foot button").map(words)).toEqual(["Open in Godview", "Stop all"]);
  });
});

describe("the crew card's plates (SP-1e2's renderer half; docs/UI_SYSTEM.md, SR-Q11)", () => {
  /** each plate's first card: its head's words, its rows' states, its names, its foot's line */
  const cardIn = (id: string) => {
    const plate = $(`.vf-ds-crew-plates:not(.dark) [data-plate="${id}"]`);
    const card = plate?.querySelector<HTMLElement>(".vf-crew-card") ?? null;
    return {
      plate,
      head: words(card?.querySelector(".vf-crew-head")),
      states: [...(card?.querySelectorAll<HTMLElement>(".vf-crew-row") ?? [])].map(
        (row) => row.dataset.state ?? null,
      ),
      names: [...(card?.querySelectorAll<HTMLElement>(".vf-crew-name") ?? [])].map(words),
      line: words(card?.querySelector(".vf-crew-line")),
    };
  };

  it("draws every plate on the product's reading, by this page's light and the Moon's", async () => {
    await mount(<CrewCardPlates locale="en-US" />);
    expect($$(".vf-ds-crew-plates")).toHaveLength(2);
    expect($$(".vf-ds-crew-plates.dark .vf-crew-card").length).toBe(
      $$(".vf-ds-crew-plates:not(.dark) .vf-crew-card").length,
    );
    const head = "4 agents · Opus 5.5 · high";
    const running = ["done", "working", "needs", "working"];
    const table: [string, string, (string | null)[], string][] = [
      ["starting", "4 agents 0 of 4 done", Array(4).fill("starting"), ""],
      ["running", `${head} 1 of 4 done`, running, ""],
      ["all-done", `${head} All done`, Array(4).fill("done"), ""],
      ["renumbered", `${head} 1 of 4 done · 1 ended`, ["ended", "working", "working", "done"], ""],
      ["reload", `${head} All done`, ["done", "ended", "ended", "ended"], ""],
      [
        "crews-unreadable",
        `${head} 4 still running`,
        running,
        "VibeField can't read Vela's crews right now",
      ],
      [
        "board-unreadable",
        head,
        [null, null, null, null],
        "VibeField can't read what's running right now",
      ],
      [
        "asleep",
        `${head} 2 of 4 done`,
        ["done", "working", "working", "done"],
        "Vela is asleep — it hears these when it wakes",
      ],
      ["done-ended", `${head} 1 of 4 done · 1 ended`, ["done", "ended", "working", "working"], ""],
      ["all-ended", `${head} All ended`, Array(4).fill("ended"), ""],
      ["differ", "4 agents 1 of 4 done", ["working", "working", "done", "working"], ""],
      [
        "no-effort",
        "4 agents · Opus 5.5 1 of 4 done",
        ["done", "working", "working", "working"],
        "",
      ],
      ["blind", "Agents", [], "VibeField can't read Vela's crews right now"],
      ["narrow", `${head} 1 of 4 done`, running, ""],
      // SP-1e4's
      [
        "acts",
        "5 agents · Opus 5.5 · high 0 of 5 done · 1 paused",
        ["working", "paused", "working", "working", "working"],
        "",
      ],
    ];
    for (const [id, words, states, line] of table) {
      const card = cardIn(id);
      expect([card.head, card.states, card.line], id).toEqual([words, states, line]);
    }
    // names follow @: one ended and named as fieldd named it, the others renumbered
    expect(cardIn("renumbered").names).toEqual([
      "Claude Code in vibe-field",
      "vibe-field",
      "vibe-field·2",
      "vibe-field·3",
    ]);
    // the board unreadable: @ offers no handle, so each is named as fieldd names a run
    expect(cardIn("board-unreadable").names).toEqual(Array(4).fill("Claude Code in vibe-field"));
    // a member's ask at the foot, under the card; a narrow thread
    expect(cardIn("running").plate?.querySelector(".vf-needs-card")).not.toBeNull();
    expect(cardIn("narrow").plate?.hasAttribute("data-narrow")).toBe(true);
    // two crews, each under its own line
    const two = cardIn("two-crews").plate;
    expect([...(two?.querySelectorAll<HTMLElement>(".vf-crew-head") ?? [])].map(words)).toEqual([
      `${head} 1 of 4 done`,
      "1 agent · Opus 5.5 · high 0 of 1 done",
    ]);
    // SP-1e4 — the crew's acts: a turn pausing, one paused, a stop fieldd takes no further, one stopping, and one at
    // work that Pause all can take, so the foot stands both acts
    const acts = cardIn("acts").plate;
    const passing = [...(acts?.querySelectorAll<HTMLElement>(".vf-crew-row") ?? [])].map(
      (row) => row.dataset.passing ?? null,
    );
    expect(passing).toEqual(["pausing", null, "still", "stopping", null]);
    const foot = [...(acts?.querySelectorAll<HTMLElement>(".vf-crew-foot button") ?? [])];
    expect(foot.map(words)).toEqual(["Open in Godview", "Pause all", "Stop all"]);
  });
});
