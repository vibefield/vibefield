/**
 * TH-1 — the flow, drawn (`chat/ThreadFlowView.tsx`; DESIGN.md §8 "Chat's thread"): the catalog's thread plates,
 * mounted as the catalog mounts them (the shipping view over the product's own projection of fixture record lines,
 * docs/UI_SYSTEM.md), and the flow alone for what an agent's words may never become.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { CrewCard } from "../src/chat/crew-card";
import { ThreadFlowView } from "../src/chat/ThreadFlowView";
import { FLOW_WORDS } from "../src/chat/transcript-items";
import { ChatPreview } from "../src/design-system/ChatPreview";
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
        pressable: true,
        label: "vibe-field, Opus 5.5, high, Done",
      },
      {
        runtimeRunId: "run-22",
        agent: "claude",
        name: "vibe-field·2",
        model: "Opus 5.5 · high",
        state: "working",
        pressable: true,
        label: "vibe-field·2, Opus 5.5, high, Working",
      },
      {
        runtimeRunId: "run-23",
        agent: "claude",
        name: "Claude Code in vibe-field",
        model: "Opus 5.5 · high",
        state: "ended",
        pressable: false,
        label: "Claude Code in vibe-field, Opus 5.5, high, Ended",
      },
    ],
    line: null,
    label: "2 agents · Opus 5.5 · high, 1 of 2 done",
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
});
