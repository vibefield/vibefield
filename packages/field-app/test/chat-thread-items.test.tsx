// @vitest-environment happy-dom
/**
 * SP-1d, TH-1 — THE THREAD'S FIRST WORDS (DESIGN.md §8 "Chat's thread": the hello and three starters, the thread's
 * items; NS-D4 A; TH-Q36 (a), CO-Q2 (b)): a new spark's hello and its starters are its conversation's first row, on
 * the shipping `ThreadFlowView` under Chat's real controller (`ChatView`), a running feed and a scripted transcript
 * door (`transcript-door-fixture.ts`); what waits on you stands in the thread's foot (`ThreadItemsView`). Send's road
 * itself is `thread-send.test.ts`'s; here `sendToThread` is scripted — it stands the bubble as the real road does once
 * a message passes the window's checks — so a starter is seen to go the way the composer's Send goes, and what each
 * outcome leaves standing. The data is `thread-items.test.ts`'s and `transcript-items.test.ts`'s.
 * *TH-1, the pane leaves Chat:* the hello was a card in the foot standing over the pane while the thread was quiet,
 * and left at a draft's first character or the pane taking the keyboard; those rows retired with it.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG,
  type AgentFieldRow,
  type ComposeSparksSayParams,
  type NeedsItem,
  type SparkSummary,
} from "@vibefield/contracts";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_HANDLES } from "../src/chat/at-rows";
import type { ComposerPort } from "../src/chat/ChatComposer";
import { ChatView } from "../src/chat/ChatView";
import { NEEDS_IDLE, needsNamesOf } from "../src/chat/needs-card";
import { pendingSaysNow, resetPendingSaysForTest } from "../src/chat/pending-says";
import { type SparksPort, startSparksFeed } from "../src/chat/sparks-feed";
import { ThreadItemsView } from "../src/chat/ThreadItemsView";
import { helloWords, STARTERS, type ThreadItem } from "../src/chat/thread-items";
import type { ThreadSendDeps, ThreadSendOutcome } from "../src/chat/thread-send";
import type { TranscriptDoor } from "../src/chat/transcript-port";
import { ChatPreview } from "../src/design-system/ChatPreview";
import type { ChatState } from "../src/design-system/chat-fixtures";
import type { FrameSurface } from "../src/frame/frame-surface";
import { hearLineSays } from "../src/frame/line-door";
import { NO_TRANSCRIPTS } from "./transcript-door-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Send's road, scripted: what each send was handed (and the world Chat lent the last one), and what it comes to. */
const road = vi.hoisted(() => {
  /** what fieldd answers a say queued at once (TH-1) */
  const queued = {
    state: "queued",
    receipt: { spark: "sp-vela0001", requestId: "say-0000000001", queued: true, state: "queued" },
  } as const;
  return {
    queued,
    sent: [] as { readonly text: string; readonly stills: readonly string[] }[],
    /** what Chat's controller lent the last send, and the request id it minted for it */
    deps: null as ThreadSendDeps | null,
    requestId: null as string | null,
    outcome: (): Promise<ThreadSendOutcome> => Promise.resolve(queued),
  };
});
vi.mock("../src/chat/thread-send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/chat/thread-send")>();
  return {
    ...actual,
    sendToThread: (
      deps: ThreadSendDeps,
      message: { readonly text: string },
      stills: readonly string[],
      requestId: string,
    ) => {
      road.sent.push({ text: message.text, stills });
      road.deps = deps;
      road.requestId = requestId;
      // the real road stands the bubble once the message passes the window's own checks
      deps.sending?.(requestId);
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
  // just hatched: fieldd has not seen her work
  turnedAt: null,
  session: { runtimeRunId: "run-Vela", terminalSessionId: "pty-Vela", live: true },
};

/** When fieldd first saw Vela work (TU-1): her record's and her run's `turnedAt` once she has. */
const TURNED = "2026-10-31T05:00:40.000Z";
/** Vela once she has worked: her record says so. */
const WORKED: SparkSummary = { ...VELA, turnedAt: TURNED };

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
  profileSets: async () => [],
  models: async () => {
    throw new Error("no picker here");
  },
};

/** The board's frames as the feed hears them: a test hands it another, within the same window's life. */
let pushFrame: ((payload: unknown, kind: "snapshot" | "delta") => void) | null = null;
/** The needs-you queue's open items as the feed's first reading hears them (CP-3); none unless a test says. */
let queued: readonly NeedsItem[] = [];
/** The queue's next frame, whole, as needs.subscribe sends it. */
let pushNeeds: ((items: readonly NeedsItem[]) => void) | null = null;

function feed(
  rows: AgentFieldRow[],
  record: SparkSummary,
  open: SparksPort["open"] = async () => record,
): SparksPort {
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
    // the head's Pause (TH-2) is not this test's
    pause: async () => {
      throw new Error("nothing is paused here");
    },
    onReconnected: () => () => undefined,
    open,
    say: async (params) => {
      says.push(params);
      return { spark: params.spark, requestId: params.requestId, queued: true, state: "waking" };
    },
  };
}

/** What the feed's say was asked, in order (TH-1). */
let says: ComposeSparksSayParams[] = [];

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
  road.requestId = null;
  says = [];
  resetPendingSaysForTest();
  queued = [];
  road.outcome = () => Promise.resolve(road.queued);
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

/** Chat as the frame mounts it, over a feed of Vela and her own run (and the wake it answers, `open`). */
async function mountChat(
  rows: AgentFieldRow[] = [own()],
  record: SparkSummary = VELA,
  open?: SparksPort["open"],
  transcripts: TranscriptDoor = NO_TRANSCRIPTS,
): Promise<void> {
  stopFeed = startSparksFeed(feed(rows, record, open));
  function Owner(): ReactElement {
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    return (
      <ChatView
        active
        surface={surface}
        onSurfaceChange={setSurface}
        port={PORT}
        transcripts={transcripts}
      />
    );
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
/** The hello: its conversation's first row (TH-1). */
const hello = (): HTMLElement | null => $('.vf-chat-flow [data-row="hello"]');
const helloSays = (): string => words(hello()?.querySelector(".vf-chat-reply-text") ?? null);
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

describe('the hello and its starters (DESIGN.md §8 "Chat\'s thread"; NS-D4; TH-1)', () => {
  it("draws a new spark's hello as its conversation's first row: its words beside its face, the three starters", async () => {
    await mountChat();
    const row = hello();
    expect(row?.closest(".vf-chat-flow")).not.toBeNull();
    expect(row?.parentElement?.firstElementChild).toBe(row);
    expect(helloSays()).toBe(helloWords("Vela"));
    const face = row?.querySelector(".vf-spark-face");
    expect(face?.getAttribute("data-framed")).toBe("true");
    // the starters are the design kit's buttons, each its glyph and its words, in the page's order
    expect(starters().map((button) => words(button))).toEqual(STARTERS.map((s) => s.words));
    expect(starters().every((button) => button.classList.contains("vf-ui-button"))).toBe(true);
    expect(
      starters().map((button) => button.querySelector(".vf-glyph")?.getAttribute("data-glyph")),
    ).toEqual(["agents", "panes", "duplicate"]);
    // nothing stands in the foot for it: the foot is what waits on you
    expect($(".vf-chat-items")).toBeNull();
  });

  it("sends a starter pressed as Send sends: queued as yours, the note saying nothing, and its bubble takes the hello's place", async () => {
    await mountChat();
    await act(async () => starters()[0]?.click());
    await settle();
    expect(road.sent).toEqual([
      { text: "Spawn 4 Grok agents to research a topic each", stills: [] },
    ]);
    expect(said).toEqual([]);
    // the first send takes them away, its bubble the conversation's first
    expect(hello()).toBeNull();
    expect(words($('.vf-chat-flow [data-row="you"]'))).toContain(
      "Spawn 4 Grok agents to research a topic each",
    );
  });

  it("keeps the hello when a starter's send is not taken, and says why in Send's own words", async () => {
    let finish: (outcome: ThreadSendOutcome) => void = () => undefined;
    road.outcome = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await mountChat();
    await act(async () => starters()[1]?.click());
    // its bubble stands while the send runs, so the hello has given way
    expect(hello()).toBeNull();
    await act(async () => finish({ state: "failed", reason: "fieldd isn't running" }));
    await settle();
    expect(said).toEqual(["Couldn't send to Vela: fieldd isn't running"]);
    // a send refused leaves no bubble, so the hello and its starters stand, at rest
    expect(hello()).not.toBeNull();
    expect($(".vf-chat-starters")?.hasAttribute("aria-busy")).toBe(false);
  });

  it("stands while you write: a draft no longer takes it away (TH-1; CO-Q2 (b))", async () => {
    await mountChat();
    expect(hello()).not.toBeNull();
    typeText("h");
    expect(hello()).not.toBeNull();
    typeText("");
    expect(hello()).not.toBeNull();
  });

  it("gives way once the composer's send is queued, to its bubble", async () => {
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

  it("never says hello for a spark that has worked: an idle spark's thread is its conversation alone", async () => {
    // fieldd's record says it, though the board counts nothing (a re-attached run counts nothing it read back)
    await mountChat([own({ turnedAt: TURNED })], WORKED);
    expect($(".vf-chat-flow")).not.toBeNull();
    expect(hello()).toBeNull();
    expect($(".vf-chat-items")).toBeNull();
  });

  it("says no hello for a woken spark that has worked: its resumed run carries the conversation's time", async () => {
    // Wake resumes the spark's session into a new run, which its record names; the run inherits its conversation's
    // turnedAt, and counts nothing from the transcript it reads back
    const WOKEN = "2026-11-01T09:00:00.000Z";
    await mountChat(
      [own({ runtimeRunId: "run-Vela2", createdAt: WOKEN, statusSince: WOKEN, turnedAt: TURNED })],
      {
        ...WORKED,
        updatedAt: WOKEN,
        session: { runtimeRunId: "run-Vela2", terminalSessionId: "pty-Vela", live: true },
      },
    );
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Vela's thread");
    expect($(".vf-chat-composer")).not.toBeNull();
    expect(hello()).toBeNull();
  });

  it("takes the hello away at its run's first turn, as the row says it, before the list is read again", async () => {
    await mountChat();
    expect(hello()).not.toBeNull();
    // the row's push says the first turn; the list still says null until it is read again
    await act(async () =>
      pushFrame?.({ revision: 2, rows: [own({ turnedAt: TURNED })] }, "snapshot"),
    );
    await settle();
    expect($(".vf-chat-composer")).not.toBeNull();
    expect(hello()).toBeNull();
  });

  it("says hello for a spark asleep before it ever worked, its run off the board, Wake in its head", async () => {
    await mountChat([], { ...VELA, session: { runtimeRunId: "run-Vela", live: false } });
    expect($(".vf-chat-thread-line")).toBeNull();
    expect(words($('.vf-chat-thread-acts button[data-act="wake"]'))).toBe("Wake");
    expect(helloSays()).toBe(helloWords("Vela"));
    expect(starters()).toHaveLength(3);
  });
});

describe("one act at a time into a thread, a wake's, a starter's or Send's (DESIGN.md §8 \"Chat's thread\", \"Chat's composer\")", () => {
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
    // typed during the starter's wait: its bubble stands in the hello's place, and Send waits, busy
    typeText("and summarise it");
    expect(hello()).toBeNull();
    expect($(".vf-chat-send")?.getAttribute("aria-busy")).toBe("true");
    await press("Enter");
    await act(async () => $(".vf-chat-send")?.click());
    expect(road.sent.map((send) => send.text)).toEqual([
      "Spawn 4 Grok agents to research a topic each",
    ]);
    await act(async () => finish(road.queued));
    await settle();
    expect($(".vf-chat-send")?.hasAttribute("aria-busy")).toBe(false);
    // the starter's send done, Send sends what was typed meanwhile
    road.outcome = () => Promise.resolve(road.queued);
    await press("Enter");
    await settle();
    expect(road.sent.map((send) => send.text)).toEqual([
      "Spawn 4 Grok agents to research a topic each",
      "and summarise it",
    ]);
  });

  it("keeps the starters waiting while Wake's wake runs, so a starter never wakes the spark a second time", async () => {
    let woken: () => void = () => undefined;
    const asleep: SparkSummary = { ...VELA, session: { runtimeRunId: "run-Vela", live: false } };
    const opened: string[] = [];
    await mountChat([], asleep, (spark) => {
      opened.push(spark);
      return new Promise((resolve) => {
        woken = () => resolve(asleep);
      });
    });
    // asleep before it ever worked: its hello stands, and Wake is the head's (TH-2)
    expect(hello()).not.toBeNull();
    await act(async () =>
      host
        ?.querySelector<HTMLButtonElement>('.vf-chat-thread-acts button[data-act="wake"]')
        ?.click(),
    );
    expect(opened).toEqual(["sp-vela0001"]);
    expect($(".vf-chat-starters")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => starters()[1]?.click());
    expect(road.sent).toEqual([]);
    await act(async () => woken());
    await settle();
    expect($(".vf-chat-starters")?.hasAttribute("aria-busy")).toBe(false);
  });

  it("keeps Wake waiting while a send runs into an asleep thread, so the spark is woken once", async () => {
    let finish: (outcome: ThreadSendOutcome) => void = () => undefined;
    road.outcome = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const asleep: SparkSummary = { ...VELA, session: { runtimeRunId: "run-Vela", live: false } };
    const opened: string[] = [];
    await mountChat([], asleep, async (spark) => {
      opened.push(spark);
      return asleep;
    });
    // Wake is the head's (TH-2)
    const wake = (): HTMLButtonElement | null =>
      host?.querySelector<HTMLButtonElement>('.vf-chat-thread-acts button[data-act="wake"]') ??
      null;
    expect(words(wake())).toBe("Wake");
    typeText("carry on with the migration");
    // the send's own wake is the one: Wake pressed in Return's tick, before the hold is drawn, asks for none …
    await act(async () => {
      $(".vf-chat-input")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      wake()?.click();
    });
    expect(road.sent.map((send) => send.text)).toEqual(["carry on with the migration"]);
    expect(opened).toEqual([]);
    // … and drawn, the head's Wake waits
    expect(wake()?.disabled).toBe(true);
    await act(async () => wake()?.click());
    expect(opened).toEqual([]);
    await act(async () => finish(road.queued));
    await settle();
    expect(wake()?.disabled).toBe(false);
  });

  it("turns away a Return pressed in Wake's own tick by the thread's hold, before Send is drawn busy: nothing sent, said or let go (final critique 11)", async () => {
    let woken: () => void = () => undefined;
    const asleep: SparkSummary = { ...VELA, session: { runtimeRunId: "run-Vela", live: false } };
    const opened: string[] = [];
    await mountChat([], asleep, (spark) => {
      opened.push(spark);
      return new Promise((resolve) => {
        woken = () => resolve(asleep);
      });
    });
    // Wake is the head's (TH-2)
    const wake = (): HTMLButtonElement | null =>
      host?.querySelector<HTMLButtonElement>('.vf-chat-thread-acts button[data-act="wake"]') ??
      null;
    typeText("carry on with the migration");
    // Wake, then Return in the same tick: the hold is Wake's, though Send is not drawn busy yet
    await act(async () => {
      wake()?.click();
      $(".vf-chat-input")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(opened).toEqual(["sp-vela0001"]);
    expect(road.sent).toEqual([]);
    expect(said).toEqual([]);
    // the hold stands, Wake's, until its wake ends: Send waits, and the draft is kept
    expect($(".vf-chat-send")?.getAttribute("aria-busy")).toBe("true");
    expect($(".vf-chat-input")?.textContent).toBe("carry on with the migration");
    await act(async () => woken());
    await settle();
    expect($(".vf-chat-send")?.hasAttribute("aria-busy")).toBe(false);
  });
});

describe('what Chat lends Send (TH-1; DESIGN.md §8 "Chat\'s composer", Send)', () => {
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

  it("lends the feed's say for the thread's spark, its chips only when it has some, and stands the bubble at once", async () => {
    let finish: (outcome: ThreadSendOutcome) => void = () => undefined;
    road.outcome = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await mountChat();
    const deps = await sendNow("look at the failing test");
    const requestId = road.requestId ?? "";
    expect(deps.needsWake).toBe(false);
    await deps.say({ text: "look at the failing test", chips: [], requestId });
    await deps.say({ text: "x y", chips: [{ start: 2, length: 1, kind: "card" }], requestId });
    expect(says).toEqual([
      { spark: "sp-vela0001", text: "look at the failing test", requestId },
      {
        spark: "sp-vela0001",
        text: "x y",
        chips: [{ start: 2, length: 1, kind: "card" }],
        requestId,
      },
    ]);
    // its bubble stands once the window's own checks pass, with no receipt yet
    act(() => deps.sending?.(requestId));
    expect(pendingSaysNow("sp-vela0001")).toMatchObject([
      { requestId, text: "look at the failing test", chips: [] },
    ]);
    expect(pendingSaysNow("sp-vela0001")[0]?.state).toBeUndefined();
    // queued: the bubble takes the receipt's state
    await act(async () =>
      finish({ ...road.queued, receipt: { ...road.queued.receipt, requestId, state: "waiting" } }),
    );
    await settle();
    expect(pendingSaysNow("sp-vela0001")[0]?.state).toBe("waiting");
  });

  it("lets the bubble go when the send is not taken, and stands it waking for a spark asleep", async () => {
    let finish: (outcome: ThreadSendOutcome) => void = () => undefined;
    road.outcome = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const asleep: SparkSummary = { ...VELA, session: { runtimeRunId: "run-Vela", live: false } };
    await mountChat([], asleep);
    const deps = await sendNow("carry on");
    expect(deps.needsWake).toBe(true);
    act(() => deps.sending?.(road.requestId ?? ""));
    expect(pendingSaysNow("sp-vela0001")[0]?.state).toBe("waking");
    await act(async () => finish({ state: "wake-refused", reason: "its folder is gone" }));
    await settle();
    expect(pendingSaysNow("sp-vela0001")).toEqual([]);
    expect(said).toEqual(["Couldn't wake Vela: its folder is gone"]);
  });
});

describe('Send while the spark waits on you (TH-1; ER-C2; DESIGN.md §8 "Chat\'s composer", as amended)', () => {
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

  it("queues while its own run asks in its terminal: nothing is pasted, and the queue waits for the answer", async () => {
    queued = [VELA_ASKS];
    await mountChat(
      [
        own({
          status: "blocked",
          blockers: [{ id: "p-1", kind: "permission", since: AT }],
          turnedAt: TURNED,
        }),
      ],
      WORKED,
    );
    expect(words($(".vf-chat-thread-status"))).toBe("Needs your OK");
    const deps = await sendNow("and the docs too");
    // Send reads no blocker and waits on no pane: it is handed its message and the say
    expect(road.sent.map((send) => send.text)).toEqual(["and the docs too"]);
    expect(Object.keys(deps).sort()).toEqual(["needsWake", "say", "sending", "stillKept", "wake"]);
  });

  it("wakes a sleeping spark with an item first, though its word says Asking you throughout", async () => {
    queued = [VELA_ASKS];
    const asleep = { ...WORKED, session: { runtimeRunId: "run-Vela", live: false } };
    await mountChat([own({ alive: false, turnedAt: TURNED })], asleep);
    expect(words($(".vf-chat-thread-status"))).toBe("Asking you");
    // asleep, read from its session: Wake in its head
    expect(words($('.vf-chat-thread-acts button[data-act="wake"]'))).toBe("Wake");
    const deps = await sendNow("go on");
    expect(deps.needsWake).toBe(true);
  });
});

describe("the thread's foot: what waits on you, above the composer, covering nothing (TH-1; TH-Q26 (a), CO-Q2 (b))", () => {
  it("stands a needs-you card in the foot, in the column's flow, while the hello stands first in the conversation", async () => {
    // The product's stylesheets, in the document, so the column computes as it does in the window. happy-dom lays
    // nothing out, so the measure is the box's own terms: the items stand in the foot, in its flow, never positioned
    // over anything; the flow is the same element with the card and without it. The pixels are James's eye.
    const here = dirname(fileURLToPath(import.meta.url));
    const sheet = document.createElement("style");
    sheet.textContent = readFileSync(join(here, "../src/chat/chat.css"), "utf8");
    document.head.appendChild(sheet);
    try {
      // an ask is no turn (Q2): Vela is still new, so her hello stands with the card at the foot
      queued = [VELA_ASKS];
      await mountChat();
      const flow = $(".vf-chat-flow");
      expect(hello()).not.toBeNull();
      const items = $(".vf-chat-items");
      expect(items?.parentElement?.className).toBe("vf-chat-foot");
      expect(items?.querySelector(".vf-needs-card")).not.toBeNull();
      expect(getComputedStyle(items as HTMLElement).position).not.toBe("absolute");
      // the foot: the card, then the composer
      const foot = [...($(".vf-chat-foot")?.children ?? [])].map((child) => child.className);
      expect(foot[0]).toBe("vf-chat-items");
      expect(foot.some((name) => name.includes("vf-chat-composer"))).toBe(true);
      // the card's way out moves nothing in the conversation: the same flow, the hello still first
      vi.useFakeTimers();
      await act(async () => pushNeeds?.([]));
      act(() => {
        vi.advanceTimersByTime(180);
      });
      expect($(".vf-needs-card")).toBeNull();
      expect($(".vf-chat-flow")).toBe(flow);
      expect(hello()).not.toBeNull();
    } finally {
      sheet.remove();
    }
  });

  it("draws every kind of item by its own case (the seam CP-3 extended; a kind left undrawn fails to compile)", () => {
    const DRAWN = ["needs"] as const satisfies readonly ThreadItem["kind"][];
    // a kind in the union that this list does not name is a type error here, as it is in `ThreadItemsView`
    const undrawn: [Exclude<ThreadItem["kind"], (typeof DRAWN)[number]>] extends [never]
      ? true
      : false = true;
    expect(undrawn).toBe(true);
    const items: Record<(typeof DRAWN)[number], ThreadItem> = {
      needs: {
        kind: "needs",
        item: VELA_ASKS,
        names: needsNamesOf(VELA_ASKS, NO_HANDLES),
        spark: { id: VELA.id, name: VELA.name },
        own: false,
        of: 1,
        waits: true,
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
    // with no act handed in (the catalog), a card's act pressed does nothing
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

  it("draws a spark just hatched saying hello, and no hello where the shown spark has worked", async () => {
    await plate("hello");
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Polaris's thread");
    expect(helloSays()).toBe(helloWords("Polaris"));
    expect(starters()).toHaveLength(3);
    expect($(".vf-chat-composer")).not.toBeNull();
    for (const state of ["list", "asleep", "thread"] as const) {
      await plate(state);
      expect(hello(), state).toBeNull();
    }
  });

  it("draws the starters waiting while a starter's send runs, and at rest on the hello's own plate", async () => {
    await plate("starting");
    expect(helloSays()).toBe(helloWords("Polaris"));
    expect($(".vf-chat-starters")?.getAttribute("aria-busy")).toBe("true");
    expect(starters()).toHaveLength(3);
    await plate("hello");
    expect($(".vf-chat-starters")?.hasAttribute("aria-busy")).toBe(false);
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
