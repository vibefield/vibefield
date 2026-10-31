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
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatComposer, type ComposerPort } from "../src/chat/ChatComposer";
import { ChatView } from "../src/chat/ChatView";
import type { DraftPart } from "../src/chat/composer-draft";
import { sparkEntriesOf } from "../src/chat/spark-status";
import { type SparksPort, startSparksFeed } from "../src/chat/sparks-feed";
import type { ThreadSendOutcome } from "../src/chat/thread-send";
import { ChatPreview } from "../src/design-system/ChatPreview";
import { CHAT_STATES, type ChatState } from "../src/design-system/chat-fixtures";
import { CardTargets } from "../src/frame/cards/card-targets";
import type { FrameSurface } from "../src/frame/frame-surface";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  providers: async () =>
    [A, B].map((entry) => ({
      id: entry.id,
      label: entry.label,
      available: true,
      resumable: true,
      personas: [],
    })),
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
  readonly parked: (readonly DraftPart[])[];
}

/** The composer under FieldView's place (the one owner of the open surface), over a running feed. */
async function mountComposer(
  outcome: () => Promise<ThreadSendOutcome> = async () => ({ state: "pasted" }),
  parked: readonly DraftPart[] = [],
): Promise<Mounted> {
  stopFeed = startSparksFeed(feed());
  const said: string[] = [];
  const parks: (readonly DraftPart[])[] = [];
  const send = vi.fn((_text: string, _stills: readonly string[]) => outcome());
  const entry = sparkEntriesOf([VELA], ROWS)[0];
  if (entry === undefined) throw new Error("no entry");
  function Owner(): ReactElement {
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    surfaceNow = surface;
    setSurfaceNow = setSurface;
    return (
      <ChatComposer
        entry={entry as NonNullable<typeof entry>}
        active
        parked={parked}
        onPark={(parts) => parks.push(parts)}
        surface={surface}
        onSurfaceChange={setSurface}
        port={port}
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

  it("keeps each spark's own draft when another thread is chosen, and finds it on coming back", async () => {
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
    typeText("for Vela");
    const row = (id: string) => q<HTMLButtonElement>(`.vf-chat-row[data-spark="${id}"]`);
    act(() => row("sp-juno0001").click());
    await settle();
    expect(q(".vf-chat-thread").getAttribute("aria-label")).toBe("Juno's thread");
    expect(editor().textContent).toBe("");
    expect(q(".vf-chat-ph").textContent).toBe("Message Juno…");
    act(() => row("sp-vela0001").click());
    await settle();
    expect(editor().textContent).toBe("for Vela");
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
      '"Claude Code · Working"',
      '"Add to your message to Vela"',
      '"Added to your message to Vela"',
      "**Its own model**",
    ]) {
      expect(design, said).toContain(said);
    }
  });
});
