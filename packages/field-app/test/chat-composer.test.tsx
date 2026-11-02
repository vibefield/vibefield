// @vitest-environment happy-dom
/**
 * SP-1d — Chat's composer, at the grain the repo tests chrome (DESIGN.md §8 "Chat's composer"): the shipping
 * composition `draft mic send` on its real controller, under a stateful owner of the frame's open surface (FieldView's
 * place); @ typed into the draft, its rows (CH-D5 A), an agent's menu (its model and effort), the chips, Send, and the
 * thread keeping its draft. The draft's model is `chat-draft.test.ts`'s, @'s rows `chat-at-rows.test.ts`'s, Send's
 * road `thread-send.test.ts`'s, the hand's place on it `chat-prompt-target.test.tsx`'s.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG,
  type AgentFieldRow,
  type AgentModelsResult,
  type AgentProfileSet,
  type SparkSummary,
} from "@vibefield/contracts";
import { type FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { act, type ReactElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AT_WORDS } from "../src/chat/at-rows";
import { ChatComposer, type ComposerPort } from "../src/chat/ChatComposer";
import { ChatView } from "../src/chat/ChatView";
import type { DraftPart } from "../src/chat/composer-draft";
import { CANNOT_LIST_AGENTS } from "../src/chat/new-spark";
import { sparkEntriesOf } from "../src/chat/spark-status";
import { type SparksPort, sparksPortOver, startSparksFeed } from "../src/chat/sparks-feed";
import type { ThreadSendOutcome } from "../src/chat/thread-send";
import { ChatPreview } from "../src/design-system/ChatPreview";
import { CHAT_STATES, type ChatState } from "../src/design-system/chat-fixtures";
import { CardTargets } from "../src/frame/cards/card-targets";
import { listenForOtherApps } from "../src/frame/cards/cards-outside";
import { CardStore } from "../src/frame/cards/cards-store";
import type { FrameSurface } from "../src/frame/frame-surface";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Send's road under Chat's own controller (`ChatView`), scripted: what each send was handed, and what it comes to.
 * The composer mounted alone is handed its `send`; the road itself is `thread-send.test.ts`'s. */
const road = vi.hoisted(() => ({
  sent: [] as string[],
  outcome: (): Promise<ThreadSendOutcome> => Promise.resolve({ state: "pasted" }),
}));
vi.mock("../src/chat/thread-send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/chat/thread-send")>();
  return {
    ...actual,
    sendToThread: (_deps: unknown, text: string) => {
      road.sent.push(text);
      return road.outcome();
    },
  };
});

const [A, B] = [AGENT_CATALOG[0], AGENT_CATALOG[1]];
const AT = "2026-10-31T05:00:00.000Z";

function sparkOf(id: string, name: string, over: Partial<SparkSummary> = {}): SparkSummary {
  return {
    id,
    name,
    face: { seed: 7 },
    agent: A.id,
    profiles: ["native", "work"],
    thinksUnder: "native",
    folder: `/f/${name}`,
    createdAt: AT,
    updatedAt: AT,
    session: { runtimeRunId: `run-${name}`, terminalSessionId: `pty-${name}`, live: true },
    ...over,
  };
}

const VELA = sparkOf("sp-vela0001", "Vela");
const JUNO = sparkOf("sp-juno0001", "Juno", { updatedAt: "2026-10-31T04:00:00.000Z" });

const set = (id: string, label: string, kind: "native" | "managed", providers: string[]) =>
  ({
    id,
    kind,
    label,
    default: kind === "native",
    createdAt: AT,
    personas: providers.map((provider) => ({
      profileId: kind === "native" ? `${provider}:native-default` : `${id}-${provider}`,
      provider,
      label: "Default",
      kind: kind === "native" ? "native-default" : "managed",
      createdAt: AT,
      set: id,
      identity: { loggedIn: true, verifiedAt: AT },
    })),
  }) satisfies AgentProfileSet;

const SETS: AgentProfileSet[] = [
  set("native", "This Mac", "native", [A.id]),
  set("work", "Work", "managed", [B.id]),
];

const MODELS = (provider: string, profileSet: string): AgentModelsResult => ({
  provider,
  profileSet,
  catalog: {
    provider,
    cwd: "/f",
    observedAt: AT,
    source: { kind: "native-protocol", freshness: "live" },
    completeness: "complete",
    customModels: false,
    models: [
      {
        id: "deep",
        label: "Deep",
        controls: [
          {
            id: "effort",
            label: "Effort",
            role: "effort",
            values: [
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
            defaultValue: "low",
          },
        ],
      },
      { id: "quick", label: "Quick", controls: [] },
    ],
  },
  refreshing: false,
});

const port: ComposerPort = {
  profileSets: async () => SETS,
  models: async (provider, profileSet) => MODELS(provider, profileSet),
};

function boardRow(
  over: Partial<AgentFieldRow> & Pick<AgentFieldRow, "runtimeRunId">,
): AgentFieldRow {
  return {
    revision: 1,
    kind: A.id,
    label: A.label,
    tier: "managed",
    device: "dev-1",
    status: "idle",
    statusSince: AT,
    stateChangedAt: AT,
    createdAt: AT,
    alive: true,
    blockers: [],
    ...over,
  };
}

const ROWS: AgentFieldRow[] = [
  boardRow({ runtimeRunId: "run-Vela", spark: "sp-vela0001", lastActivityAt: AT }),
  boardRow({
    runtimeRunId: "run-his",
    status: "working",
    project: { name: "vibe-field" },
    lastActivityAt: "2026-10-31T05:10:00.000Z",
  }),
];

/** A feed over fixture sparks and a board, as the frame's host starts one. */
function feed(sparks: SparkSummary[] = [VELA], rows: AgentFieldRow[] = ROWS): SparksPort {
  return {
    list: async () => sparks,
    watch: async (onFrame) => {
      onFrame({ revision: 1, rows }, "snapshot");
      return () => undefined;
    },
    // the needs-you queue holds nothing here (CP-3: Chat's reading of it is chat-view.test.tsx's)
    watchNeeds: async (onItems) => {
      onItems([]);
      return () => undefined;
    },
    answer: async () => {
      throw new Error("nothing is answered here");
    },
    onReconnected: () => () => undefined,
    open: async () => VELA,
  };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let stopFeed: (() => void) | null = null;
let surfaceNow: FrameSurface | null = null;
let setSurfaceNow: ((next: FrameSurface | null) => void) | null = null;

beforeEach(() => {
  surfaceNow = null;
  road.sent = [];
  road.outcome = () => Promise.resolve({ state: "pasted" });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  stopFeed?.();
  stopFeed = null;
});

interface Mounted {
  readonly send: ReturnType<typeof vi.fn>;
  readonly said: string[];
  /** the thread's draft as it stood after each change */
  readonly parked: (readonly DraftPart[])[];
}

/** The composer under FieldView's place (the one owner of the open surface), over a running feed, its draft kept as
 * Chat keeps a thread's (one copy: what the composer parks, and a send's clearing). */
async function mountComposer(
  outcome: () => Promise<ThreadSendOutcome | null> = async () => ({ state: "pasted" }),
  parked: readonly DraftPart[] = [],
  asks: ComposerPort = port,
  board: SparksPort = feed(),
): Promise<Mounted> {
  stopFeed = startSparksFeed(board);
  const said: string[] = [];
  const parks: (readonly DraftPart[])[] = [];
  const send = vi.fn((_text: string, _stills: readonly string[]) => outcome());
  const entry = sparkEntriesOf([VELA], ROWS)[0];
  if (entry === undefined) throw new Error("no entry");
  function Owner(): ReactElement {
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    surfaceNow = surface;
    setSurfaceNow = setSurface;
    const [draft, setDraft] = useState(parked);
    useEffect(() => {
      parks.push(draft);
    }, [draft]);
    return (
      <ChatComposer
        entry={entry as NonNullable<typeof entry>}
        active
        parked={draft}
        onPark={setDraft}
        surface={surface}
        onSurfaceChange={setSurface}
        port={asks}
        send={send}
        say={(text) => {
          said.push(text);
          return true;
        }}
        targets={new CardTargets()}
      />
    );
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<Owner />));
  return { send, said, parked: parks };
}

const q = <T extends Element = HTMLElement>(selector: string): T => {
  const element = host?.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const editor = (): HTMLElement => q(".vf-chat-input");
const send = (): HTMLButtonElement => q<HTMLButtonElement>(".vf-chat-send");
const settle = () => act(async () => undefined);

/** The caret at the end of `node`, and the editor told, as typing leaves it. */
function typed(field: HTMLElement, node: Text): void {
  const range = document.createRange();
  range.setStart(node, node.length);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Type into the draft the way the browser leaves it: the text in the editor, the caret at its end, an input event. */
function typeText(text: string): void {
  act(() => {
    const field = editor();
    field.focus();
    field.textContent = "";
    const node = document.createTextNode(text);
    field.append(node);
    typed(field, node);
  });
}

/** Type on at the draft's end, after whatever chips it holds. */
function typeOn(text: string): void {
  act(() => {
    const field = editor();
    field.focus();
    const last = field.lastChild;
    const node = last instanceof Text ? last : field.appendChild(document.createTextNode(""));
    node.data += text;
    typed(field, node);
  });
}

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const menu = (): HTMLElement | null => host?.querySelector<HTMLElement>(".vf-chat-at") ?? null;
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
const chipLabels = (): string[] =>
  [...editor().querySelectorAll(".vf-chat-chip-label")].map((chip) => chip.textContent ?? "");

describe("the composer's composition (DESIGN.md §8 \"Chat's composer\")", () => {
  it("draws the draft, the mic and send in the thread, saying who the message goes to", async () => {
    await mountComposer();
    const box = q(".vf-chat-composer");
    expect(box.getAttribute("aria-label")).toBe("Message Vela");
    expect([...box.children].map((child) => child.className)).toEqual([
      "vf-chat-draft",
      "vf-chat-mic",
      "vf-chat-send",
    ]);
    expect(q(".vf-chat-ph").textContent).toBe("Message Vela…");
    expect(editor().getAttribute("aria-placeholder")).toBe("Message Vela…");
    expect(send().getAttribute("aria-label")).toBe("Send to Vela");
    // FC-D1: @ is typed, never a button; no attach button either
    const buttons = [...box.querySelectorAll("button")];
    expect(buttons.some((b) => /^@$|attach|mention/i.test(b.textContent ?? ""))).toBe(false);
  });

  it("draws the mic waiting and says why — the desktop has no dictation door", async () => {
    await mountComposer();
    const mic = q(".vf-chat-mic");
    expect(mic.getAttribute("aria-disabled")).toBe("true");
    expect(mic.getAttribute("title")).toBe("Dictation — not on the desktop yet");
  });

  it("inverts send once there is something, and keeps it quiet over a mention still being typed", async () => {
    await mountComposer();
    expect(send().getAttribute("aria-disabled")).toBe("true");
    typeText("ship it");
    expect(host?.querySelector(".vf-chat-ph")).toBeNull();
    expect(send().getAttribute("data-armed")).toBe("true");
    typeText("@");
    await settle();
    expect(send().getAttribute("aria-disabled")).toBe("true");
    typeText("ask @");
    await settle();
    expect(send().getAttribute("data-armed")).toBe("true");
  });

  it("draws an agent's mark at DESIGN's sizes — 20 in @'s rows, 15 on a chip — since the mark draws at its text's size (final critique 4)", async () => {
    // the mark is the agent's own, drawn at 1em: its box's font size is its size
    await mountComposer();
    typeText("ask @");
    await settle();
    expect(menu()?.querySelector(".vf-chat-at-mark svg")?.getAttribute("width")).toBe("1em");
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/chat/chat-composer.css"),
      "utf8",
    );
    const rule = (selector: string): string =>
      css.match(new RegExp(`^\\${selector} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
    for (const [selector, size] of [
      [".vf-chat-at-mark", 20],
      [".vf-chat-chip-mark", 15],
    ] as const) {
      expect(rule(selector), selector).toMatch(new RegExp(`\\bwidth: ${size}px;`));
      expect(rule(selector), selector).toMatch(new RegExp(`font-size: ${size}px;`));
      expect(rule(selector), selector).toMatch(/line-height: 1;/);
    }
  });
});

describe("the composer's keys (DESIGN.md §8 \"Chat's composer\", Keys)", () => {
  it("gives the keyboard back on Esc with @ closed (CB-2); with @ open, Esc closes it and keeps the keyboard", async () => {
    await mountComposer();
    typeText("ping @");
    await settle();
    expect(document.activeElement).toBe(editor());
    press(editor(), { key: "Escape" });
    expect(surfaceNow).toBeNull();
    expect(document.activeElement).toBe(editor());
    press(editor(), { key: "Escape" });
    expect(document.activeElement).not.toBe(editor());
    expect(editor().textContent).toBe("ping @");
  });

  it("lands text dragged inside the window at the caret as plain text on one line, and deals no card", async () => {
    // the window's hand hears another app's drags (`listenForOtherApps`); a drag that began in this page is not one
    const hand = new CardStore();
    const stopHearing = listenForOtherApps({ store: hand });
    try {
      await mountComposer();
      typeText("see ");
      act(() => {
        document.body.dispatchEvent(new Event("dragstart", { bubbles: true }));
      });
      const data = new DataTransfer();
      data.setData("text/plain", "a\nb");
      const drop = new MouseEvent("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: data });
      act(() => {
        editor().dispatchEvent(drop);
      });
      expect(drop.defaultPrevented).toBe(true);
      expect(editor().textContent).toBe("see a b");
      expect(editor().querySelector(".vf-chat-chip")).toBeNull();
      expect(hand.snapshot().cards).toEqual([]);
    } finally {
      stopHearing();
    }
  });
});

describe("@ in Chat's composer (DESIGN.md §8, @'s rows in Chat; the surface `at`)", () => {
  it("opens as the frame's surface `at`, both groups read bottom-up, the nearest row hot", async () => {
    await mountComposer();
    typeText("ask @");
    await settle();
    expect(surfaceNow).toBe("at");
    const list = menu();
    expect(list?.getAttribute("role")).toBe("menu");
    expect(
      [...(list?.querySelectorAll(".vf-chat-at-eye") ?? [])].map((e) => e.textContent),
    ).toEqual(["Start an agent", "Running in its profiles"]);
    const rows = [...(list?.querySelectorAll<HTMLElement>(".vf-chat-at-row") ?? [])];
    expect(rows.map((row) => row.dataset.row)).toEqual([
      `agent:${A.id}:native`,
      `agent:${B.id}:work`,
      "session:run-his",
    ]);
    // the nearest is hot; the session says its handle in mono, its agent and its word, never its run id
    expect(rows.at(-1)?.hasAttribute("data-hot")).toBe(true);
    expect(words(rows.at(-1) ?? null)).toBe(`vibe-field ${A.label} · Working`);
    expect(words(list)).not.toContain("run-his");
    // more than one profile: each agent row says its profile as a pill
    expect(rows[1]?.querySelector(".vf-ui-pill")?.textContent).toBe("Work");
  });

  it("closes on an @ inside a word, on Esc (keeping what was typed), and when another surface opens", async () => {
    await mountComposer();
    typeText("mail a@b");
    expect(surfaceNow).toBeNull();
    typeText("ping @vi");
    await settle();
    expect(surfaceNow).toBe("at");
    const esc = press(editor(), { key: "Escape" });
    expect(esc.defaultPrevented).toBe(true);
    expect(surfaceNow).toBeNull();
    expect(editor().textContent).toBe("ping @vi");
    typeText("ping @");
    await settle();
    expect(menu()).not.toBeNull();
    act(() => setSurfaceNow?.("palette"));
    expect(menu()).toBeNull();
  });

  it("filters both groups by what follows the @, and says Nothing called when nothing matches", async () => {
    await mountComposer();
    typeText("@vibe");
    await settle();
    expect(
      [...(menu()?.querySelectorAll<HTMLElement>(".vf-chat-at-row") ?? [])].map(
        (r) => r.dataset.row,
      ),
    ).toEqual(["session:run-his"]);
    typeText("@zzz");
    await settle();
    expect(words(menu())).toBe('Nothing called "zzz"');
  });

  it("says the New spark sheet's words, and offers no row, when its profiles can't be read; the next @ reads again", async () => {
    let fails = true;
    await mountComposer(undefined, undefined, {
      ...port,
      profileSets: async () => {
        if (fails) throw new Error("fieldd is not answering");
        return SETS;
      },
    });
    typeText("ask @");
    await settle();
    expect(words(menu())).toBe(CANNOT_LIST_AGENTS);
    expect(menu()?.querySelectorAll(".vf-chat-at-row").length).toBe(0);
    press(editor(), { key: "Escape" });
    fails = false;
    typeText("ask @");
    // while that read runs, @ is reading again, never still the failure it reads past (SP-1d's fix review)
    expect(words(menu())).toContain(AT_WORDS.reading);
    expect(words(menu())).not.toContain(CANNOT_LIST_AGENTS);
    await settle();
    expect(
      [...(menu()?.querySelectorAll<HTMLElement>(".vf-chat-at-row") ?? [])].map(
        (r) => r.dataset.row,
      ),
    ).toEqual([`agent:${A.id}:native`, `agent:${B.id}:work`, "session:run-his"]);
  });

  /** The window's feed over a board refused with `first` until `board.refusal` is null: how many times it was asked,
   * and the window's client reconnected (`SparksPort.onReconnected`) when the test says. */
  function refusedBoard(first: Error) {
    const board = { asks: 0, refusal: first as Error | null, reconnected: new Set<() => void>() };
    const door: SparksPort = {
      ...feed(),
      watch: async (onFrame) => {
        board.asks += 1;
        if (board.refusal !== null) throw board.refusal;
        onFrame({ revision: 1, rows: ROWS }, "snapshot");
        return () => undefined;
      },
      onReconnected: (listener) => {
        board.reconnected.add(listener);
        return () => board.reconnected.delete(listener);
      },
    };
    const reconnect = () =>
      act(async () => {
        for (const listener of [...board.reconnected]) listener();
      });
    return { board, door, reconnect };
  }
  const atRowIds = (): string[] =>
    [...(menu()?.querySelectorAll<HTMLElement>(".vf-chat-at-row") ?? [])].map(
      (r) => r.dataset.row ?? "",
    );

  it("keeps Start an agent standing when the window's board can't be read, and says what's running can't be (SP-1d's review)", async () => {
    // the agents to start are its profiles' alone: only the sessions are read off the board
    const { door } = refusedBoard(new Error("fieldd refused the board"));
    await mountComposer(undefined, undefined, port, door);
    typeText("ask @");
    await settle();
    expect(atRowIds()).toEqual([`agent:${A.id}:native`, `agent:${B.id}:work`]);
    expect(words(menu())).toContain(`${AT_WORDS.sessions} ${AT_WORDS.sessionsFailed}`);
    expect(words(menu())).not.toContain(CANNOT_LIST_AGENTS);
    expect(words(menu())).not.toContain(AT_WORDS.reading);
  });

  it("asks again for a board refused as the socket closed, once the window's client reconnects, and offers its sessions then (SP-1d's review)", async () => {
    // the connection closed under the ask while the same fieldd stayed up (a reconnect, not a restart: a restart
    // replaces the window's document): the client's own retryable refusal
    const { board, door, reconnect } = refusedBoard(
      new FielddRpcError("UNAVAILABLE", "connection closed", true),
    );
    await mountComposer(undefined, undefined, port, door);
    typeText("ask @");
    await settle();
    expect(words(menu())).toContain(AT_WORDS.sessionsFailed);
    expect(board.asks).toBe(1);
    // the next @ asks the board for nothing: only the client reconnected does
    press(editor(), { key: "Escape" });
    typeText("ask @");
    await settle();
    expect(board.asks).toBe(1);
    board.refusal = null;
    await reconnect();
    await settle();
    expect(board.asks).toBe(2);
    expect(atRowIds()).toEqual([`agent:${A.id}:native`, `agent:${B.id}:work`, "session:run-his"]);
    expect(words(menu())).not.toContain(AT_WORDS.sessionsFailed);
    // a board read stands: another reconnect asks for nothing (the client replays its subscription itself)
    await reconnect();
    expect(board.asks).toBe(2);
  });

  it("never asks again for a board fieldd refused for good (SP-1d's review)", async () => {
    const { board, door, reconnect } = refusedBoard(
      new FielddRpcError("FORBIDDEN_SCOPE", "the full projection is local to its device", false),
    );
    await mountComposer(undefined, undefined, port, door);
    typeText("ask @");
    await settle();
    await reconnect();
    await settle();
    expect(board.asks).toBe(1);
    expect(words(menu())).toContain(AT_WORDS.sessionsFailed);
  });

  it("says the window's client reconnected each time it is ready again, and on no other status (SP-1d's review)", () => {
    const heard = new Set<() => void>();
    const client = {
      status: "ready",
      onStatusChange: (listener: () => void) => {
        heard.add(listener);
        return () => heard.delete(listener);
      },
    };
    const to = (status: string): void => {
      client.status = status;
      for (const listener of [...heard]) listener();
    };
    let reconnects = 0;
    const stop = sparksPortOver(client as unknown as FielddClient).onReconnected(() => {
      reconnects += 1;
    });
    to("reconnecting");
    expect(reconnects).toBe(0);
    to("ready");
    expect(reconnects).toBe(1);
    to("reconnecting");
    to("ready");
    expect(reconnects).toBe(2);
    // a fieldd restart refuses the window's token: the client fails, and main replaces the document instead
    to("failed");
    expect(reconnects).toBe(2);
    stop();
    to("reconnecting");
    to("ready");
    expect(reconnects).toBe(2);
  });

  it("takes a session with Return: its chip is its handle, the @ and its query gone", async () => {
    await mountComposer();
    typeText("ask @vib");
    await settle();
    press(editor(), { key: "Enter" });
    await settle();
    expect(surfaceNow).toBeNull();
    expect(chipLabels()).toEqual(["vibe-field"]);
    expect(editor().querySelector('[data-chip="session"]')).not.toBeNull();
    expect(editor().textContent).not.toContain("@vib");
  });

  it("turns @'s list into a taken agent's menu: Its own model, its picker's models, then Effort", async () => {
    await mountComposer();
    typeText("start @");
    await settle();
    press(editor(), { key: "ArrowUp" });
    press(editor(), { key: "ArrowUp" });
    press(editor(), { key: "Tab" });
    await settle();
    expect(chipLabels()).toEqual([`${A.label} · This Mac`]);
    expect(surfaceNow).toBe("at");
    const box = menu();
    expect(box?.dataset.at).toBe("menu");
    expect(box?.getAttribute("aria-label")).toBe(`${A.label}'s model`);
    expect(
      [...(box?.querySelectorAll<HTMLElement>(".vf-chat-at-row") ?? [])].map((r) => r.textContent),
    ).toEqual(["Its own model", "Deep", "Quick"]);
    // ↓ then Return keeps the hot model: the chip says it in the sheet's spelling
    press(editor(), { key: "ArrowDown" });
    press(editor(), { key: "Enter" });
    await settle();
    expect(chipLabels()).toEqual([`${A.label} · Deep · This Mac`]);
    expect(surfaceNow).toBeNull();
    // the chip pressed opens its menu again; ← → turn Effort under the chosen model, and Esc folds it as it stands
    const chip = editor().querySelector<HTMLElement>('[data-chip="agent"]');
    act(() => {
      chip?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(menu()?.dataset.at).toBe("menu");
    expect(menu()?.querySelector(".vf-chat-at-effort")).not.toBeNull();
    press(editor(), { key: "ArrowRight" });
    await settle();
    expect(chipLabels()).toEqual([`${A.label} · Deep · High · This Mac`]);
    press(editor(), { key: "Escape" });
    expect(surfaceNow).toBeNull();
    expect(chipLabels()).toEqual([`${A.label} · Deep · High · This Mac`]);
  });

  it("removes a chip with its ×, and sets nothing else aside", async () => {
    await mountComposer();
    typeText("ask @vib");
    await settle();
    press(editor(), { key: "Enter" });
    await settle();
    const x = editor().querySelector<HTMLElement>("[data-chip-remove]");
    expect(x?.getAttribute("aria-label")).toBe("Remove vibe-field");
    expect(editor().querySelector('[data-chip="session"]')?.getAttribute("contenteditable")).toBe(
      "false",
    );
    act(() => {
      x?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(chipLabels()).toEqual([]);
    expect(editor().textContent).toBe("ask  ");
  });
});

describe("the draft's paste (DESIGN.md §8: ⌘V pastes into it as plain text on one line)", () => {
  it("puts another app's text at the caret on one line, never markup", async () => {
    await mountComposer();
    typeText("see ");
    const data = new DataTransfer();
    data.setData("text/plain", "line one\nline two");
    data.setData("text/html", "<b>bold</b>");
    const paste = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    act(() => {
      editor().dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(true);
    expect(editor().textContent).toBe("see line one line two");
    expect(editor().querySelector("b")).toBeNull();
  });
});

describe('Send (DESIGN.md §8 "Chat\'s composer")', () => {
  it("Return pastes into Vela's pane and never presses Return: the message goes to Send, the note says so, the draft clears", async () => {
    const mounted = await mountComposer();
    typeText("run the tests");
    press(editor(), { key: "Enter" });
    await settle();
    expect(mounted.send).toHaveBeenCalledTimes(1);
    expect(mounted.send.mock.calls[0]).toEqual(["run the tests", []]);
    expect(mounted.said).toEqual(["Pasted into Vela's pane — Return sends it"]);
    expect(editor().textContent).toBe("");
    expect(q(".vf-chat-ph").textContent).toBe("Message Vela…");
    // ⇧Return types nothing and sends nothing: the draft is one line
    typeText("two");
    press(editor(), { key: "Enter", shiftKey: true });
    await settle();
    expect(mounted.send).toHaveBeenCalledTimes(1);
  });

  it("keeps a send not taken whole, says why, and never copies it", async () => {
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: write },
      configurable: true,
    });
    const mounted = await mountComposer(async () => ({ state: "not-taking" }));
    typeText("ask @vib");
    await settle();
    press(editor(), { key: "Enter" });
    await settle();
    typeOn("to rebase");
    act(() => send().click());
    await settle();
    expect(mounted.send.mock.calls[0]?.[0]).toBe(
      `ask ${A.label} in vibe-field (session run-his) to rebase`,
    );
    expect(mounted.said).toEqual(["Not pasted — Vela's pane is not taking input"]);
    expect(chipLabels()).toEqual(["vibe-field"]);
    expect(editor().textContent).toContain("to rebase");
    expect(write).not.toHaveBeenCalled();
  });

  it("says nothing and keeps the draft whole when the thread's hold turns the send away (final critique 11)", async () => {
    // another act holds the thread (a Wake pressed in this tick, before Send is drawn busy): Chat's send answers null
    const mounted = await mountComposer(async () => null);
    typeText("carry on with the migration");
    press(editor(), { key: "Enter" });
    await settle();
    expect(mounted.send).toHaveBeenCalledTimes(1);
    expect(mounted.said).toEqual([]);
    expect(editor().textContent).toBe("carry on with the migration");
    expect(send().hasAttribute("aria-busy")).toBe(false);
  });

  it("waits while a send runs: busy, and a second press does nothing", async () => {
    let finish: (outcome: ThreadSendOutcome) => void = () => undefined;
    const mounted = await mountComposer(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    typeText("hello");
    act(() => send().click());
    expect(send().getAttribute("aria-busy")).toBe("true");
    act(() => send().click());
    press(editor(), { key: "Enter" });
    expect(mounted.send).toHaveBeenCalledTimes(1);
    await act(async () => finish({ state: "pasted" }));
    expect(send().hasAttribute("aria-busy")).toBe(false);
  });

  it("clears only what a send carried: what was typed while it ran stays in the draft", async () => {
    let finish: (outcome: ThreadSendOutcome) => void = () => undefined;
    const mounted = await mountComposer(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    typeText("run the tests");
    act(() => send().click());
    // the spark is still waking: the draft is a field meanwhile
    typeOn(" and then the docs");
    await act(async () => finish({ state: "pasted" }));
    expect(mounted.send.mock.calls[0]?.[0]).toBe("run the tests");
    expect(mounted.said).toEqual(["Pasted into Vela's pane — Return sends it"]);
    expect(editor().textContent).toBe("and then the docs");
    expect(mounted.parked.at(-1)).toEqual([{ kind: "text", text: "and then the docs" }]);
  });
});

describe("the draft is the thread's (DESIGN.md §8 \"Chat's composer\")", () => {
  it("parks every change of the draft as it is typed, with no redraw, and draws a parked draft back", async () => {
    const mounted = await mountComposer();
    typeText("h");
    expect(mounted.parked.at(-1)).toEqual([{ kind: "text", text: "h" }]);
    act(() => root?.unmount());
    root = null;
    host?.remove();
    stopFeed?.();
    await mountComposer(undefined, [{ kind: "text", text: "half a thought" }]);
    expect(editor().textContent).toBe("half a thought");
    expect(host?.querySelector(".vf-chat-ph")).toBeNull();
  });

  /** Chat as the frame mounts it, over a feed of Vela and Juno, Vela's thread shown. */
  async function mountChat(): Promise<void> {
    stopFeed = startSparksFeed(feed([VELA, JUNO]));
    function Owner(): ReactElement {
      const [surface, setSurface] = useState<FrameSurface | null>(null);
      return <ChatView active surface={surface} onSurfaceChange={setSurface} port={port} />;
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<Owner />));
    await settle();
    expect(q(".vf-chat-thread").getAttribute("aria-label")).toBe("Vela's thread");
  }
  const choose = async (id: string): Promise<void> => {
    act(() => q<HTMLButtonElement>(`.vf-chat-row[data-spark="${id}"]`).click());
    await settle();
  };

  it("keeps each spark's own draft when another thread is chosen, and finds it on coming back", async () => {
    await mountChat();
    typeText("for Vela");
    await choose("sp-juno0001");
    expect(q(".vf-chat-thread").getAttribute("aria-label")).toBe("Juno's thread");
    expect(editor().textContent).toBe("");
    expect(q(".vf-chat-ph").textContent).toBe("Message Juno…");
    await choose("sp-vela0001");
    expect(editor().textContent).toBe("for Vela");
  });

  it("is never drawn again by its own parking: what is typed comes back from the thread as itself", async () => {
    await mountChat();
    const drawn = editor();
    typeText("for Vela");
    await settle();
    typeOn(", and the docs");
    await settle();
    // the thread kept each change and handed it back; the editor the person types in is the one still standing
    expect(editor()).toBe(drawn);
    expect(editor().textContent).toBe("for Vela, and the docs");
  });

  /** A send held open, as one into a spark being woken waits up to 20 s; `finish` says what it came to. */
  function holdSends(): { finish: (outcome: ThreadSendOutcome) => void } {
    const held = { finish: (_outcome: ThreadSendOutcome): void => undefined };
    road.outcome = () =>
      new Promise((resolve) => {
        held.finish = resolve;
      });
    return held;
  }

  it("clears what a send carried even when its thread was left and chosen again while it ran (correctness-2)", async () => {
    const held = holdSends();
    await mountChat();
    typeText("look at the failing test");
    press(editor(), { key: "Enter" });
    expect(road.sent).toEqual(["look at the failing test"]);
    // while it runs, Juno's thread, then Vela's again: Vela's composer is drawn afresh from the thread's draft
    await choose("sp-juno0001");
    await choose("sp-vela0001");
    expect(editor().textContent).toBe("look at the failing test");
    await act(async () => held.finish({ state: "pasted" }));
    await settle();
    // DESIGN.md §8 "Chat's composer": "Sent, the words and chips it carried are cleared" — in the composer standing
    // now, so a second Send never pastes them again
    expect(editor().textContent).toBe("");
    expect(q(".vf-chat-ph").textContent).toBe("Message Vela…");
  });

  it("keeps what was typed in the thread's composer drawn afresh while the send ran: only what it carried goes", async () => {
    const held = holdSends();
    await mountChat();
    typeText("look at the failing test");
    press(editor(), { key: "Enter" });
    await choose("sp-juno0001");
    await choose("sp-vela0001");
    // the thread's draft as it stands now holds more than was sent
    typeOn(" and fix it");
    await act(async () => held.finish({ state: "pasted" }));
    await settle();
    expect(editor().textContent).toBe("and fix it");
    // and leaving and coming back finds the same
    await choose("sp-juno0001");
    await choose("sp-vela0001");
    expect(editor().textContent).toBe("and fix it");
  });
});

describe("the catalog's composer plates (docs/UI_SYSTEM.md: the shipping view on fixtures)", () => {
  /** One of the Chat specimen's plates, mounted as the catalog mounts it. */
  async function plate(state: ChatState): Promise<void> {
    act(() => root?.unmount());
    host?.remove();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<ChatPreview state={state} />));
  }
  const box = (): HTMLElement | null =>
    host?.querySelector<HTMLElement>(".vf-chat-composer") ?? null;

  it("draws every state's composer, and none where no thread is shown", async () => {
    const threadless: readonly ChatState[] = ["empty", "opening", "unavailable"];
    for (const state of CHAT_STATES) {
      await plate(state);
      if (threadless.includes(state)) expect(box(), state).toBeNull();
      else expect(box()?.getAttribute("aria-label"), state).toMatch(/^Message /u);
    }
  });

  it("draws the typing, @, agent's model and chips plates in the shipping composer's own parts", async () => {
    await plate("typing");
    expect(editor().textContent).toBe("Why does the composer test fail on main?");
    expect(send().hasAttribute("data-armed")).toBe(true);

    await plate("at");
    const rows = menu();
    expect(rows?.dataset.at).toBe("rows");
    expect(words(rows)).toContain("Start an agent");
    expect(words(rows)).toContain("Running in its profiles");
    expect(rows?.querySelectorAll(".vf-chat-at-row").length).toBeGreaterThan(1);
    expect(rows?.querySelector('.vf-chat-at-row[data-hot="true"]')).not.toBeNull();

    await plate("menu");
    const models = menu();
    expect(models?.dataset.at).toBe("menu");
    expect(words(models)).toContain("Its own model");
    expect(models?.querySelector(".vf-chat-at-effort")).not.toBeNull();

    await plate("chips");
    expect(editor().querySelectorAll(".vf-chat-chip")).toHaveLength(3);
    expect(chipLabels()).toContain("vibe-field·2");
  });

  it("draws @'s quiet states, an agent's menu being read and refused, and a send under way, in the composer's own parts", async () => {
    // @ while what it offers is read: the first group's eyebrow over its word, no row
    await plate("at-reading");
    expect(menu()?.dataset.at).toBe("rows");
    expect(words(menu())).toBe("Start an agent Reading its agents…");
    expect(menu()?.querySelector(".vf-chat-at-row")).toBeNull();
    // nothing matches what follows the @
    await plate("at-none");
    expect(words(menu())).toBe('Nothing called "docs"');
    expect(menu()?.querySelector(".vf-chat-at-row")).toBeNull();
    // the spark's profiles hold no sign-in and run none of your sessions
    await plate("at-empty");
    expect(words(menu())).toBe("Nothing to add from Juno's profiles");
    // its profiles can't be read: the New spark sheet's own sentence
    await plate("at-failed");
    expect(words(menu())).toBe(CANNOT_LIST_AGENTS);
    expect(menu()?.querySelector(".vf-chat-at-row")).toBeNull();
    // the board can't be read: the agents to start stand, and the sessions' group says what's running can't be read
    await plate("at-board-failed");
    expect(words(menu())).toMatch(
      new RegExp(`^${AT_WORDS.agents} .+ ${AT_WORDS.sessions} ${AT_WORDS.sessionsFailed}$`, "u"),
    );
    expect(menu()?.querySelectorAll('.vf-chat-at-row[data-row^="agent:"]').length).toBeGreaterThan(
      0,
    );
    expect(menu()?.querySelector('.vf-chat-at-row[data-row^="session:"]')).toBeNull();

    // an agent just taken, its menu open while its picker is read: Its own model, then the word in the picker's place
    await plate("menu-reading");
    expect(menu()?.dataset.at).toBe("menu");
    expect(words(menu())).toContain(`Its own model Reading ${A.label}'s models…`);
    expect(menu()?.querySelector('[data-kind="model"]')?.getAttribute("aria-checked")).toBe("true");
    // …and a picker that can't be read says why, in the words its read failed with
    await plate("menu-failed");
    expect(words(menu())).toContain(
      "Its own model fieldd is not answering (the daemon is restarting)",
    );
    expect(menu()?.querySelectorAll('[data-kind="model"]')).toHaveLength(1);

    // a send under way: send waits, busy, over the draft it carries
    await plate("sending");
    expect(editor().textContent).toBe("Why does the composer test fail on main?");
    expect(send().hasAttribute("data-armed")).toBe(true);
    expect(send().getAttribute("aria-busy")).toBe("true");
    // …and a starter's: the thread takes one send at a time, so send waits too
    await plate("starting");
    expect(send().getAttribute("aria-busy")).toBe("true");
    for (const state of ["typing", "at", "chips"] as const) {
      await plate(state);
      expect(send().hasAttribute("aria-busy"), state).toBe(false);
    }
  });
});

describe("the composer's words are DESIGN.md's (§8 \"Chat's composer\", §9 \"Chat's words\")", () => {
  it("says, in every state, exactly the words the canon records", () => {
    const design = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../DESIGN.md"),
      "utf8",
    ).replace(/\s+/g, " ");
    for (const said of [
      '"Message Lyra…"',
      '"Dictation — not on the desktop yet"',
      '"Running in its profiles"',
      '"Start an agent"',
      '"Reading its agents…"',
      '`Nothing called "cla"`',
      '"Nothing to add from Vela\'s profiles"',
      '"VibeField can\'t list its agents right now"',
      "\"VibeField can't read what's running right now\"",
      '"Claude Code · Working"',
      '"Add to your message to Vela"',
      '"Added to your message to Vela"',
      "**Its own model**",
    ]) {
      expect(design, said).toContain(said);
    }
  });
});
