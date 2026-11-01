// @vitest-environment happy-dom
/**
 * SP-1d — THE THREAD'S FIRST WORDS (DESIGN.md §8 "Chat's thread": the thread's items, the hello and three starters;
 * NS-D4 A; CH-D5 A; VF-PM's Q2, 2026-10-31): a new spark's hello and its starters stand in the thread's foot, over
 * the pane, on the shipping `ThreadItemsView` under Chat's real controller (`ChatView`) and a running feed. Send's road
 * itself is `thread-send.test.ts`'s; here `sendToThread` is scripted, so a starter is seen to go the way the
 * composer's Send goes, and what each outcome leaves standing. The data is `thread-items.test.ts`'s; the pane taking
 * the keyboard is `spark-pane.test.tsx`'s.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG,
  type AgentFieldRow,
  type NeedsItem,
  type SparkSummary,
} from "@vibefield/contracts";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerPort } from "../src/chat/ChatComposer";
import { ChatView } from "../src/chat/ChatView";
import { NEEDS_IDLE } from "../src/chat/needs-card";
import { type SparksPort, startSparksFeed } from "../src/chat/sparks-feed";
import { ThreadItemsView } from "../src/chat/ThreadItemsView";
import { helloWords, STARTERS, type ThreadItem } from "../src/chat/thread-items";
import type { ThreadSendDeps, ThreadSendOutcome } from "../src/chat/thread-send";
import { ChatPreview } from "../src/design-system/ChatPreview";
import type { ChatState } from "../src/design-system/chat-fixtures";
import type { FrameSurface } from "../src/frame/frame-surface";
import { hearLineSays } from "../src/frame/line-door";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Send's road, scripted: what each send was handed, and what it comes to. */
const road = vi.hoisted(() => ({
  sent: [] as { readonly text: string; readonly stills: readonly string[] }[],
  /** what Chat's controller lent the last send: the facts Send reads of the spark (CP-3) */
  deps: null as ThreadSendDeps | null,
  outcome: (): Promise<ThreadSendOutcome> => Promise.resolve({ state: "pasted" }),
}));
vi.mock("../src/chat/thread-send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/chat/thread-send")>();
  return {
    ...actual,
    sendToThread: (deps: ThreadSendDeps, text: string, stills: readonly string[]) => {
      road.sent.push({ text, stills });
      road.deps = deps;
      return road.outcome();
    },
  };
});

const AT = "2026-10-31T05:00:00.000Z";
const AGENT = AGENT_CATALOG[0];

const VELA: SparkSummary = {
  id: "sp-vela0001",
  name: "Vela",
  face: { seed: 7 },
  agent: AGENT.id,
  profiles: ["native"],
  thinksUnder: "native",
  folder: "/f/vela",
  createdAt: AT,
  updatedAt: AT,
  session: { runtimeRunId: "run-Vela", terminalSessionId: "pty-Vela", live: true },
};

/** Vela's own run: up, idle, and no turn taken yet — unless a test says otherwise. */
function own(over: Partial<AgentFieldRow> = {}): AgentFieldRow {
  return {
    runtimeRunId: "run-Vela",
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
    spark: VELA.id,
    terminal: { hosted: "local", runtimeSessionId: "pty-Vela" },
    ...over,
  };
}

const PORT: ComposerPort = {
  providers: async () => [],
  profileSets: async () => [],
  models: async () => {
    throw new Error("no picker here");
  },
};

/** The board's frames as the feed hears them: a test hands it another (fieldd restarted and re-attached). */
let pushFrame: ((payload: unknown, kind: "snapshot" | "delta") => void) | null = null;
/** The needs-you queue's open items as the feed's first reading hears them (CP-3); none unless a test says. */
let queued: readonly NeedsItem[] = [];
/** The queue's next frame, whole, as needs.subscribe sends it. */
let pushNeeds: ((items: readonly NeedsItem[]) => void) | null = null;

function feed(rows: AgentFieldRow[], record: SparkSummary): SparksPort {
  return {
    list: async () => [record],
    watch: async (onFrame) => {
      pushFrame = onFrame;
      onFrame({ revision: 1, rows }, "snapshot");
      return () => undefined;
    },
    watchNeeds: async (onItems) => {
      pushNeeds = onItems;
      onItems(queued);
      return () => undefined;
    },
    answer: async () => {
      throw new Error("nothing is answered here");
    },
    open: async () => record,
  };
}

/** Vela's question in the needs-you queue (CP-3): a card in her thread, never a menu in her pane. */
const VELA_ASKS: NeedsItem = {
  id: "ny-velaasks01",
  kind: "question",
  state: "open",
  from: { name: "Vela", session: "run-Vela", spark: VELA.id },
  spark: VELA.id,
  asked: AT,
  words: "Push the fix?",
  choices: ["Push", "Not now"],
};

let root: Root | null = null;
let host: HTMLElement | null = null;
let stopFeed: (() => void) | null = null;
let stopHearing: (() => void) | null = null;
let said: string[] = [];

beforeEach(() => {
  road.sent = [];
  road.deps = null;
  queued = [];
  road.outcome = () => Promise.resolve({ state: "pasted" });
  said = [];
  stopHearing = hearLineSays((text) => said.push(text));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  stopFeed?.();
  stopFeed = null;
  pushFrame = null;
  pushNeeds = null;
  vi.useRealTimers();
  stopHearing?.();
  stopHearing = null;
});

/** Chat as the frame mounts it, over a feed of Vela and her own run. */
async function mountChat(
  rows: AgentFieldRow[] = [own()],
  record: SparkSummary = VELA,
): Promise<void> {
  stopFeed = startSparksFeed(feed(rows, record));
  function Owner(): ReactElement {
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    return <ChatView active surface={surface} onSurfaceChange={setSurface} port={PORT} />;
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<Owner />));
  await settle();
}

const settle = () => act(async () => undefined);
const $ = (selector: string): HTMLElement | null =>
  host?.querySelector<HTMLElement>(selector) ?? null;
const hello = (): HTMLElement | null => $(".vf-chat-hello");
const starters = (): HTMLButtonElement[] => [
  ...(host?.querySelectorAll<HTMLButtonElement>(".vf-chat-starter") ?? []),
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

/** Type into the draft as the browser leaves it: the text in the editor, the caret at its end, an input event. */
function typeText(text: string): void {
  act(() => {
    const field = $(".vf-chat-input");
    if (field === null) throw new Error("no draft");
    field.focus();
    field.textContent = "";
    const node = document.createTextNode(text);
    field.append(node);
    const range = document.createRange();
    range.setStart(node, node.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe('the hello and its starters (DESIGN.md §8 "Chat\'s thread"; NS-D4)', () => {
  it("draws a new spark's hello in the thread's foot: one card, its face as the lead, the three starters", async () => {
    await mountChat();
    const card = hello();
    expect(card?.closest(".vf-chat-items")?.parentElement?.className).toBe("vf-chat-foot");
    expect(words(card?.querySelector(".vf-chat-hello-words") ?? null)).toBe(helloWords("Vela"));
    const face = card?.querySelector(".vf-spark-face");
    expect(face?.getAttribute("data-framed")).toBe("true");
    // the starters are the design kit's buttons, each its glyph and its words, in the page's order
    expect(starters().map((button) => words(button))).toEqual(STARTERS.map((s) => s.words));
    expect(starters().every((button) => button.classList.contains("vf-ui-button"))).toBe(true);
    expect(
      starters().map((button) => button.querySelector(".vf-glyph")?.getAttribute("data-glyph")),
    ).toEqual(["agents", "panes", "duplicate"]);
  });

  it("sends a starter pressed as Send sends: pasted into the pane, Return left to you, and the hello leaves", async () => {
    await mountChat();
    await act(async () => starters()[0]?.click());
    await settle();
    expect(road.sent).toEqual([
      { text: "Spawn 4 Grok agents to research a topic each", stills: [] },
    ]);
    expect(said).toEqual(["Pasted into Vela's pane — Return sends it"]);
    // the first send takes them away for the window's life
    expect(hello()).toBeNull();
  });

  it("keeps the hello when a starter's paste is not taken, and says why in Send's own words", async () => {
    let finish: (outcome: ThreadSendOutcome) => void = () => undefined;
    road.outcome = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await mountChat();
    await act(async () => starters()[1]?.click());
    // while its send runs the starters wait, and a second press sends nothing
    expect($(".vf-chat-starters")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => starters()[2]?.click());
    expect(road.sent.map((send) => send.text)).toEqual(["Keep track of my agents in vibe-field"]);
    await act(async () => finish({ state: "no-terminals" }));
    await settle();
    expect(said).toEqual(["Not sent — this window has no terminals"]);
    expect(hello()).not.toBeNull();
    expect($(".vf-chat-starters")?.hasAttribute("aria-busy")).toBe(false);
  });

  it("leaves the moment the draft holds anything, and comes back when it is emptied", async () => {
    await mountChat();
    expect(hello()).not.toBeNull();
    typeText("h");
    expect(hello()).toBeNull();
    typeText("");
    expect(hello()).not.toBeNull();
  });

  it("leaves for the window's life once the composer's send is pasted", async () => {
    await mountChat();
    typeText("look at the failing test");
    await act(async () => {
      $(".vf-chat-input")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await settle();
    expect(road.sent.map((send) => send.text)).toEqual(["look at the failing test"]);
    // the draft is cleared by the send, and the hello does not come back
    expect($(".vf-chat-input")?.textContent).toBe("");
    expect(hello()).toBeNull();
  });

  it("never says hello for a spark that has had a turn: an idle spark with a transcript shows its pane alone", async () => {
    await mountChat([own({ usage: { cumulativeTokens: 18_400 } })]);
    expect($(".vf-chat-pane")).not.toBeNull();
    expect($(".vf-chat-items")).toBeNull();
  });

  it("says no hello for a woken spark: its resumed run is idle and has counted nothing from its transcript", async () => {
    // Wake resumes the spark's session into a new run, which its record names; the board counts no usage read back
    // from the transcript, so the run reads idle with nothing spent until its next live turn
    const WOKEN = "2026-11-01T09:00:00.000Z";
    await mountChat([own({ runtimeRunId: "run-Vela2", createdAt: WOKEN, statusSince: WOKEN })], {
      ...VELA,
      updatedAt: WOKEN,
      session: { runtimeRunId: "run-Vela2", terminalSessionId: "pty-Vela", live: true },
    });
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Vela's thread");
    expect($(".vf-chat-composer")).not.toBeNull();
    expect($(".vf-chat-items")).toBeNull();
  });

  it("says no hello once the window saw a turn, when fieldd re-attaches the run and its count is gone", async () => {
    await mountChat([own({ usage: { cumulativeTokens: 18_400 } })]);
    expect($(".vf-chat-items")).toBeNull();
    // fieldd restarts and re-attaches the same run: its transcript is read back, so the board counts nothing
    await act(async () => pushFrame?.({ revision: 1, rows: [own()] }, "snapshot"));
    await settle();
    expect($(".vf-chat-composer")).not.toBeNull();
    expect($(".vf-chat-items")).toBeNull();
  });
});

describe("one send at a time into a thread, a starter's or Send's (DESIGN.md §8 \"Chat's thread\", \"Chat's composer\")", () => {
  const press = (key: string) =>
    act(async () => {
      $(".vf-chat-input")?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });

  it("keeps Send waiting while a starter's send runs, so two messages never sit in the agent's one input", async () => {
    let finish: (outcome: ThreadSendOutcome) => void = () => undefined;
    road.outcome = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await mountChat();
    await act(async () => starters()[0]?.click());
    // typed during the starter's wait: the hello leaves, and Send waits, busy
    typeText("and summarise it");
    expect(hello()).toBeNull();
    expect($(".vf-chat-send")?.getAttribute("aria-busy")).toBe("true");
    await press("Enter");
    await act(async () => $(".vf-chat-send")?.click());
    expect(road.sent.map((send) => send.text)).toEqual([
      "Spawn 4 Grok agents to research a topic each",
    ]);
    await act(async () => finish({ state: "pasted" }));
    await settle();
    expect($(".vf-chat-send")?.hasAttribute("aria-busy")).toBe(false);
    // the starter's send done, Send sends what was typed meanwhile
    road.outcome = () => Promise.resolve({ state: "pasted" });
    await press("Enter");
    await settle();
    expect(road.sent.map((send) => send.text)).toEqual([
      "Spawn 4 Grok agents to research a topic each",
      "and summarise it",
    ]);
  });

  it("keeps the starters waiting while Send's send runs", async () => {
    let finish: (outcome: ThreadSendOutcome) => void = () => undefined;
    road.outcome = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await mountChat();
    typeText("look at the failing test");
    await press("Enter");
    // the draft emptied while Send's send runs, the hello comes back: its starters wait
    typeText("");
    expect(hello()).not.toBeNull();
    expect($(".vf-chat-starters")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => starters()[1]?.click());
    expect(road.sent.map((send) => send.text)).toEqual(["look at the failing test"]);
    await act(async () => finish({ state: "not-taking" }));
    await settle();
    expect($(".vf-chat-starters")?.hasAttribute("aria-busy")).toBe(false);
  });
});

describe('what Chat lends Send while the queue holds an item (CP-3; DESIGN.md §8 "Chat\'s composer", as amended)', () => {
  const sendNow = async (text: string): Promise<ThreadSendDeps> => {
    typeText(text);
    await act(async () => {
      $(".vf-chat-input")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await settle();
    if (road.deps === null) throw new Error("nothing was sent");
    return road.deps;
  };

  it("lets a card in the thread stand without stopping Send; its own run's blocker, a menu in its pane, stops it", async () => {
    queued = [VELA_ASKS];
    await mountChat([own({ usage: { cumulativeTokens: 18_400 } })]);
    expect(words($(".vf-chat-thread-status"))).toBe("Asking you");
    const deps = await sendNow("and the docs too");
    expect(deps.blocked()).toBe(false);
    // the same spark's own run then asks in its pane: Send would paste into its menu
    await act(async () =>
      pushFrame?.(
        {
          since: 1,
          revision: 2,
          upserts: [
            own({
              revision: 2,
              status: "blocked",
              blockers: [{ id: "p-1", kind: "permission", since: AT }],
              usage: { cumulativeTokens: 18_400 },
            }),
          ],
          removed: [],
        },
        "delta",
      ),
    );
    expect(deps.blocked()).toBe(true);
  });

  it("hears a sleeping spark with an item only once its woken run says so (R-4), though its word says Asking you throughout", async () => {
    queued = [VELA_ASKS];
    const asleep = { ...VELA, session: { runtimeRunId: "run-Vela", live: false } };
    await mountChat([own({ alive: false, usage: { cumulativeTokens: 18_400 } })], asleep);
    expect(words($(".vf-chat-thread-status"))).toBe("Asking you");
    expect(words($(".vf-chat-thread-line"))).toBe("Vela is asleep Wake");
    const deps = await sendNow("go on");
    expect(deps.needsWake).toBe(true);
    expect(await deps.heard(0)).toBe(false);
    // woken: its run is back on the board, idle, and heard
    const heard = deps.heard(5_000);
    await act(async () =>
      pushFrame?.(
        {
          since: 1,
          revision: 2,
          upserts: [own({ revision: 2, usage: { cumulativeTokens: 18_400 } })],
          removed: [],
        },
        "delta",
      ),
    );
    expect(await heard).toBe(true);
  });
});

describe("the thread's items never move or resize the pane (VF-PM's Q2: one rule for every item)", () => {
  it("toggling the hello, or standing a needs-you card, leaves the pane's box as it stood: the same element, the same flow, the items out of it", async () => {
    // The product's stylesheet, in the document, so the column computes as it does in the window. happy-dom lays
    // nothing out (every rect is 0 × 0), so the measure is the box's own terms: the pane is the same element, styled
    // the same, and the foot holds the same things IN FLOW with the hello and without it — the items stand out of
    // the flow, absolute in the foot, so the foot's height, and the pane's (`flex: 1 1 auto`, every height the head
    // and the foot leave), cannot change. The pixels are James's eye at the landing.
    const here = dirname(fileURLToPath(import.meta.url));
    const sheet = document.createElement("style");
    sheet.textContent = readFileSync(join(here, "../src/chat/chat.css"), "utf8");
    document.head.appendChild(sheet);
    try {
      await mountChat();
      const pane = $(".vf-chat-pane");
      const box = (element: HTMLElement | null) => {
        if (element === null) throw new Error("no pane");
        const style = getComputedStyle(element);
        return [style.flex, style.height, style.minHeight, style.marginTop, style.marginBottom];
      };
      /** What stands in the column's flow, and in the foot's: an absolute child is out of both. */
      const flow = () => {
        const inFlow = (parent: Element | null) =>
          [...(parent?.children ?? [])]
            .filter((child) => getComputedStyle(child).position !== "absolute")
            .map((child) => child.className || child.tagName);
        return { column: inFlow($(".vf-chat-thread")), foot: inFlow($(".vf-chat-foot")) };
      };
      const items = $(".vf-chat-items");
      expect(items).not.toBeNull();
      expect(getComputedStyle(items as HTMLElement).position).toBe("absolute");
      const withHello = { box: box(pane), flow: flow() };
      expect(withHello.box[0]).toMatch(/^1 1 auto/u);

      typeText("h");
      expect(hello()).toBeNull();
      expect($(".vf-chat-pane")).toBe(pane);
      expect({ box: box($(".vf-chat-pane")), flow: flow() }).toEqual(withHello);

      typeText("");
      expect(hello()).not.toBeNull();
      expect($(".vf-chat-pane")).toBe(pane);
      expect({ box: box($(".vf-chat-pane")), flow: flow() }).toEqual(withHello);

      // CP-3: the needs-you card stands by the same rule, in the hello's place, and its way out moves nothing either
      vi.useFakeTimers();
      await act(async () => pushNeeds?.([VELA_ASKS]));
      expect(hello()).toBeNull();
      expect($(".vf-chat-items > .vf-needs-card")).not.toBeNull();
      expect($(".vf-chat-pane")).toBe(pane);
      expect({ box: box($(".vf-chat-pane")), flow: flow() }).toEqual(withHello);
      await act(async () => pushNeeds?.([]));
      expect($(".vf-needs-card")?.hasAttribute("data-leaving")).toBe(true);
      expect({ box: box($(".vf-chat-pane")), flow: flow() }).toEqual(withHello);
      act(() => {
        vi.advanceTimersByTime(180);
      });
      expect($(".vf-needs-card")).toBeNull();
      // an item is a turn the window saw (a spark asks in a turn), so Vela is no longer new: no hello comes back
      expect(hello()).toBeNull();
      expect($(".vf-chat-pane")).toBe(pane);
      expect({ box: box($(".vf-chat-pane")), flow: flow() }).toEqual(withHello);
    } finally {
      sheet.remove();
    }
  });

  it("draws every kind of item by its own case (the seam CP-3 extended; a kind left undrawn fails to compile)", () => {
    const DRAWN = ["hello", "needs"] as const satisfies readonly ThreadItem["kind"][];
    // a kind in the union that this list does not name is a type error here, as it is in `ThreadItemsView`
    const undrawn: [Exclude<ThreadItem["kind"], (typeof DRAWN)[number]>] extends [never]
      ? true
      : false = true;
    expect(undrawn).toBe(true);
    const items: Record<(typeof DRAWN)[number], ThreadItem> = {
      hello: {
        kind: "hello",
        face: { seed: 7, status: "hello" },
        words: helloWords("Vela"),
        starters: STARTERS,
      },
      needs: {
        kind: "needs",
        item: VELA_ASKS,
        spark: { id: VELA.id, name: VELA.name },
        of: 1,
        act: NEEDS_IDLE,
        leaving: false,
        reduced: false,
      },
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(<ThreadItemsView items={DRAWN.map((kind) => items[kind])} />));
    expect(
      [...(host.querySelectorAll(".vf-chat-items > *") ?? [])].map((item) =>
        item.getAttribute("data-item"),
      ),
    ).toEqual([...DRAWN]);
    // with no act handed in (the catalog), a starter pressed does nothing, nor does a card's act
    act(() => starters()[0]?.click());
    act(() => host?.querySelector<HTMLButtonElement>(".vf-needs-act")?.click());
    expect(road.sent).toEqual([]);
  });
});

describe("the catalog's hello plate (docs/UI_SYSTEM.md: the shipping view on fixtures)", () => {
  async function plate(state: ChatState): Promise<void> {
    act(() => root?.unmount());
    host?.remove();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<ChatPreview state={state} />));
  }

  it("draws a spark just hatched saying hello, and no hello where the shown spark has had a turn", async () => {
    await plate("hello");
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Polaris's thread");
    expect(words($(".vf-chat-hello-words"))).toBe(helloWords("Polaris"));
    expect(starters()).toHaveLength(3);
    expect($(".vf-chat-composer")).not.toBeNull();
    for (const state of ["list", "finding", "gone", "fault", "asleep"] as const) {
      await plate(state);
      expect(hello(), state).toBeNull();
    }
  });
});

describe("the hello's words are DESIGN.md's (§8 \"Chat's thread\", §9 \"Chat's words\")", () => {
  it("says exactly the words the canon records", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const design = readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");
    for (const text of [helloWords("Vela"), ...STARTERS.map((starter) => starter.words)]) {
      expect(design, text).toContain(text);
    }
  });
});
