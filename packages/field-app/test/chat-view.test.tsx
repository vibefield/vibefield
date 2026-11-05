// @vitest-environment happy-dom
/**
 * SP-1b, SP-1d, CP-3 — Chat (DESIGN.md §8 "Chat's list", "Chat's thread"; CH-D1, CH-D3, CH-D4, CP3-D8): the panel the
 * catalog mounts on fixtures (`ChatPanelView`), the window's one feed (`sparks-feed.ts`: the field board, the sparks
 * fieldd keeps and, since CP-3, the needs-you queue) and the controller (`ChatView`: the shown spark's own pane while
 * it is awake, Wake by `compose.sparks.open` while it sleeps). The pane itself is `spark-pane.test.tsx`'s; this window
 * holds no terminal pool, so its place says what such a window says. The live witness of the list is James's first
 * sight in `pnpm dev`; the board's own rows are fieldd's (agent-field.test.ts there), the queue's needs-queue.test.ts.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentFieldRow,
  ComposeSparksSayParams,
  NeedsItem,
  SparkSummary,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerPort } from "../src/chat/ChatComposer";
import { type ChatAct, ChatPanelView } from "../src/chat/ChatPanelView";
import { ChatView } from "../src/chat/ChatView";
import { sparkEntriesOf } from "../src/chat/spark-status";
import {
  FieldBoard,
  type SparksPort,
  sparksPortOver,
  startSparksFeed,
} from "../src/chat/sparks-feed";
import { sparkIsNew } from "../src/chat/thread-items";
import { THREAD_MARK_WORDS, type ThreadMark } from "../src/chat/thread-marks";
import { sparkPaneOf } from "../src/chat/thread-pane-door";
import { ChatPreview } from "../src/design-system/ChatPreview";
import type { ChatState } from "../src/design-system/chat-fixtures";
import type { FrameSurface } from "../src/frame/frame-surface";
import { NO_TERMINALS } from "../src/terminal/terminal-words";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** This window holds no terminal pool, as the real one says here, unless a test gives it one: Send then goes on to
 * wake the spark itself. */
const pool = vi.hoisted(() => ({ configured: false }));
vi.mock("../src/terminal/pool", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  terminalPoolConfigured: () => pool.configured,
}));

const AT = "2026-10-31T05:00:00.000Z";
const NOW = Date.parse("2026-10-31T05:30:00.000Z");

function spark(id: string, name: string, over: Partial<SparkSummary> = {}): SparkSummary {
  return {
    id,
    name,
    face: { seed: name.length * 977 },
    agent: "claude",
    profiles: ["this-mac"],
    thinksUnder: "this-mac",
    folder: `/f/${name}`,
    createdAt: AT,
    updatedAt: AT,
    session: { runtimeRunId: `run-${name}`, terminalSessionId: `pty-${name}`, live: true },
    ...over,
  };
}

function row(over: Partial<AgentFieldRow> & Pick<AgentFieldRow, "runtimeRunId">): AgentFieldRow {
  return {
    revision: 1,
    kind: "claude",
    label: "Claude Code",
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

const VELA = spark("sp-vela0001", "Vela");
const KIWI = spark("sp-kiwi0001", "Kiwi", { session: { runtimeRunId: "run-Kiwi", live: false } });
const { session: _never, ...NOVA } = spark("sp-nova0001", "Nova");
const VELA_ASKS = row({
  runtimeRunId: "run-Vela",
  spark: "sp-vela0001",
  status: "blocked",
  lastActivityAt: "2026-10-31T05:29:50.000Z",
  blockers: [{ id: "q-1", kind: "question", since: AT }],
  terminal: { hosted: "local", runtimeSessionId: "pty-Vela" },
});

/** Kiwi, asleep, waits on your OK to send to one of your sessions (CP-3): the queue's item, as fieldd says it. */
const KIWI_HOLDS: NeedsItem = {
  id: "ny-kiwisend01",
  kind: "held-send",
  state: "open",
  from: { name: "Kiwi", session: "run-Kiwi", spark: "sp-kiwi0001" },
  spark: "sp-kiwi0001",
  asked: AT,
  words: "run the tests in packages/fieldd",
  choices: ["Allow", "Not now"],
  to: { session: "run-his", name: "claude·2" },
};

/** The window side of EL9: the queue's list as fieldd's fixture says it. */
const NEEDS_LIST: unknown = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../contracts/fixtures/needs-list.valid.json"),
    "utf8",
  ),
);

/** What @'s rows would read of fieldd: nothing to offer here (the composer's own suite reads the rows). */
const PORT: ComposerPort = {
  profileSets: async () => [],
  models: async () => {
    throw new Error("no picker here");
  },
};

/** Chat as the frame mounts it: FieldView's place, the one owner of the frame's open surface, stands around it. Chat
 * is the view showing unless the test says it is not (the frame keeps it mounted in another view). */
function Chat({
  active = true,
  port = PORT,
}: {
  active?: boolean;
  port?: ComposerPort;
}): ReactElement {
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  return <ChatView active={active} surface={surface} onSurfaceChange={setSurface} port={port} />;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let stop: (() => void) | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  stop?.();
  stop = null;
  pool.configured = false;
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
const rows = (): HTMLElement[] => [...(host?.querySelectorAll<HTMLElement>(".vf-chat-row") ?? [])];
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
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe('the panel (DESIGN.md §8 "Chat\'s list")', () => {
  const ready = (
    sparks: readonly SparkSummary[],
    board: readonly AgentFieldRow[],
    items: readonly NeedsItem[] = [],
  ) => ({ state: "ready", entries: sparkEntriesOf(sparks, board, { items }) }) as const;

  it("lists the sparks newest activity first, each its face, its name, its time and its word", () => {
    mount(
      <ChatPanelView
        reading={ready([KIWI, VELA, NOVA], [VELA_ASKS])}
        chosen={null}
        now={NOW}
        locale="en-US"
      />,
    );
    expect($(".vf-chat-list-head")?.textContent).toBe("Sparks3");
    expect(rows().map((r) => r.dataset.spark)).toEqual([
      "sp-vela0001",
      "sp-kiwi0001",
      "sp-nova0001",
    ]);
    const [vela, kiwi, nova] = rows();
    expect(vela?.querySelector(".vf-spark-face")).not.toBeNull();
    expect(vela?.querySelector(".vf-chat-row-label")?.textContent).toBe("Vela");
    expect(vela?.querySelector(".vf-chat-row-time")?.textContent).toBe("now");
    expect(vela?.querySelector(".vf-chat-row-status")?.textContent).toBe("Asking you");
    expect(kiwi?.querySelector(".vf-chat-row-status")?.textContent).toBe("Asleep");
    expect(nova?.querySelector(".vf-chat-row-status")?.textContent).toBe("Hello");
    // the newest is the chosen one until another is chosen, on the ready fill
    expect(vela?.getAttribute("aria-pressed")).toBe("true");
    expect(kiwi?.getAttribute("aria-pressed")).toBe("false");
  });

  it("turns a needs-you word to the attention ink and puts the orange dot on its row — never on the face (S-4)", () => {
    mount(<ChatPanelView reading={ready([VELA, KIWI], [VELA_ASKS])} chosen={null} now={NOW} />);
    const [vela, kiwi] = rows();
    expect(vela?.querySelector(".vf-chat-row-status")?.getAttribute("data-tone")).toBe("attention");
    expect(vela?.querySelector(".vf-chat-row-dot")?.getAttribute("data-mark")).toBe("needs");
    expect(kiwi?.querySelector(".vf-chat-row-status")?.hasAttribute("data-tone")).toBe(false);
    expect(kiwi?.querySelector(".vf-chat-row-dot")).toBeNull();
  });

  it("draws each thread's mark on its row: a needs-you dot that outlasts the need, and unread's cyan one (SP-1d)", () => {
    const LYRA = spark("sp-lyra0001", "Lyra");
    mount(
      <ChatPanelView
        reading={ready([VELA, KIWI, LYRA], [VELA_ASKS])}
        chosen={null}
        now={NOW}
        marks={
          new Map<string, ThreadMark>([
            ["sp-vela0001", "needs"],
            ["sp-kiwi0001", "needs"],
            ["sp-lyra0001", "unread"],
          ])
        }
      />,
    );
    const row = (id: string): HTMLElement | null => $(`.vf-chat-row[data-spark="${id}"]`);
    expect(row("sp-vela0001")?.querySelector(".vf-chat-row-dot")?.getAttribute("data-mark")).toBe(
      "needs",
    );
    // Kiwi's need has ended (asleep since): the dot stands until its thread is opened, and the word is the status now
    expect(row("sp-kiwi0001")?.querySelector(".vf-chat-row-dot")?.getAttribute("data-mark")).toBe(
      "needs",
    );
    expect(
      words(row("sp-kiwi0001")?.querySelector<HTMLElement>(".vf-chat-row-status") ?? null),
    ).toBe("Asleep");
    expect(
      row("sp-kiwi0001")?.querySelector(".vf-chat-row-status")?.hasAttribute("data-tone"),
    ).toBe(false);
    expect(row("sp-lyra0001")?.querySelector(".vf-chat-row-dot")?.getAttribute("data-mark")).toBe(
      "unread",
    );
    // the same dot, in --vf-cyan; the need's stays --vf-orange
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(here, "../src/chat/chat.css"), "utf8");
    expect(css).toMatch(/\.vf-chat-row-dot \{[^}]*background: var\(--vf-orange\)/);
    expect(css).toMatch(
      /\.vf-chat-row-dot\[data-mark="unread"\] \{[^}]*background: var\(--vf-cyan\)/,
    );
  });

  it("says a dot that outlasts the status word in the row's accessible name: unread, or needed you (SP-1d)", () => {
    const LYRA = spark("sp-lyra0001", "Lyra");
    const NOVA_NEW = spark("sp-nova0001", "Nova");
    mount(
      <ChatPanelView
        reading={ready([VELA, KIWI, LYRA, NOVA_NEW], [VELA_ASKS])}
        chosen={null}
        now={NOW}
        marks={
          new Map<string, ThreadMark>([
            ["sp-vela0001", "needs"],
            ["sp-kiwi0001", "needs"],
            ["sp-lyra0001", "unread"],
          ])
        }
      />,
    );
    const row = (id: string): HTMLElement | null => $(`.vf-chat-row[data-spark="${id}"]`);
    /** The word only a screen reader reads, right after the status word, inside the row's button. */
    const lasting = (id: string): string | null =>
      row(id)?.querySelector(".vf-chat-row-status + .sr-only")?.textContent ?? null;
    // Kiwi's need has ended (asleep since): its word says Asleep, so the dot's need is said after it
    expect(lasting("sp-kiwi0001")).toBe(", needed you");
    expect(lasting("sp-lyra0001")).toBe(", unread");
    // Vela's need stands: its word already says it, so nothing is added; a row with no dot adds nothing
    expect(row("sp-vela0001")?.querySelector(".sr-only")).toBeNull();
    expect(row("sp-nova0001")?.querySelector(".sr-only")).toBeNull();
    // the dot itself stays a picture: the words are the name's
    expect(row("sp-kiwi0001")?.querySelector(".vf-chat-row-dot")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("draws an awake spark's own pane under its head, with no line and no Show (SP-1d)", () => {
    const draw = (pane?: ReactElement) =>
      act(() =>
        root?.render(
          <ChatPanelView
            reading={ready([VELA, KIWI, NOVA], [VELA_ASKS])}
            chosen={null}
            now={NOW}
            {...(pane === undefined ? {} : { pane })}
          />,
        ),
      );
    mount(<div />);
    draw(<div data-the-pane="vela" />);
    expect(words($(".vf-chat-thread-head"))).toBe("Vela Asking you");
    expect($(".vf-chat-thread-line")).toBeNull();
    expect($("[data-the-pane]")?.closest(".vf-chat-thread")).not.toBeNull();
    expect($(".vf-chat-thread button")).toBeNull();
    // with no pane handed in, its place says what a window with no terminals says — never a blank
    draw();
    expect($(".vf-chat-pane")?.getAttribute("data-pane-state")).toBe("no-terminals");
    expect(words($(".vf-chat-pane"))).toBe(NO_TERMINALS);
  });

  it("gives an asleep or not-started spark one honest line in the pane's place: Wake, or nothing yet", () => {
    const onChoose = vi.fn();
    const onWake = vi.fn();
    const draw = (chosen: string | null, act$: ChatAct = { state: "idle" }) =>
      act(() =>
        root?.render(
          <ChatPanelView
            reading={ready([VELA, KIWI, NOVA], [VELA_ASKS])}
            chosen={chosen}
            now={NOW}
            act={act$}
            onChoose={onChoose}
            onWake={onWake}
            pane={<div data-the-pane="vela" />}
          />,
        ),
      );
    mount(<div />);
    draw(null);
    act(() => rows()[1]?.click());
    expect(onChoose).toHaveBeenLastCalledWith("sp-kiwi0001");
    draw("sp-kiwi0001");
    expect(words($(".vf-chat-thread-line"))).toBe("Kiwi is asleep Wake");
    // no pane is drawn for a spark with none, whatever the controller hands in
    expect($("[data-the-pane]")).toBeNull();
    expect($(".vf-chat-pane")).toBeNull();
    act(() => $(".vf-chat-thread-line button")?.click());
    expect(onWake.mock.calls[0]?.[0]?.spark.id).toBe("sp-kiwi0001");
    draw("sp-kiwi0001", { state: "busy" });
    expect(words($(".vf-chat-thread-line"))).toBe("Kiwi is asleep Waking…");
    draw("sp-nova0001");
    expect(words($(".vf-chat-thread-line"))).toBe("Nova hasn't started yet");
    expect($(".vf-chat-thread-line button")).toBeNull();
    // Send wakes a spark that has not started (SP-1d's composer): the line says so while it does, and a refusal once
    draw("sp-nova0001", { state: "busy" });
    expect(words($(".vf-chat-thread-line"))).toBe("Waking…");
    draw("sp-nova0001", { state: "refused", reason: "the spark's agent has no sign-in" });
    expect(words($(".vf-chat-thread-line"))).toBe(
      "Couldn't wake Nova: the spark's agent has no sign-in",
    );
  });

  it("says a sleeping spark's item in its word, and still says it sleeps: the line, Wake, and no pane (CP-3; critique 7)", () => {
    const onWake = vi.fn();
    mount(
      <ChatPanelView
        reading={ready([KIWI, VELA], [VELA_ASKS], [KIWI_HOLDS])}
        chosen="sp-kiwi0001"
        now={NOW}
        onWake={onWake}
        pane={<div data-the-pane="kiwi" />}
      />,
    );
    const kiwi = $('.vf-chat-row[data-spark="sp-kiwi0001"]');
    expect(words(kiwi?.querySelector<HTMLElement>(".vf-chat-row-status") ?? null)).toBe(
      "Needs your OK",
    );
    expect(kiwi?.querySelector(".vf-chat-row-status")?.getAttribute("data-tone")).toBe("attention");
    expect(kiwi?.querySelector(".vf-chat-row-dot")?.getAttribute("data-mark")).toBe("needs");
    // the head says the item's word, in the attention ink; the face says the same status (S-3)
    expect(words($(".vf-chat-thread-head"))).toBe("Kiwi Needs your OK");
    expect($(".vf-chat-thread-status")?.getAttribute("data-tone")).toBe("attention");
    // awake is read from its session, never its word: asleep, with Wake, and no pane mounted
    expect(words($(".vf-chat-thread-line"))).toBe("Kiwi is asleep Wake");
    expect($("[data-the-pane]")).toBeNull();
    act(() => $(".vf-chat-thread-line button")?.click());
    expect(onWake.mock.calls[0]?.[0]?.spark.id).toBe("sp-kiwi0001");
  });

  /** One of the Chat specimen's plates, mounted as the catalog mounts it. */
  async function plate(state: ChatState): Promise<void> {
    act(() => root?.unmount());
    host?.remove();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<ChatPreview state={state} />));
  }

  it("draws the catalog's waiting plate on the product's reading: Kiwi asleep, its held send Needs your OK, Wake on its line (CP-3)", async () => {
    await plate("waiting");
    const status = (id: string): string =>
      words($(`.vf-chat-row[data-spark="${id}"] .vf-chat-row-status`));
    expect(status("sp-kiwi0001")).toBe("Needs your OK");
    // Vela's own run's ask is read once, as her row's blocker
    expect(status("sp-vela0001")).toBe("Asking you");
    expect(
      $('.vf-chat-row[data-spark="sp-kiwi0001"] .vf-chat-row-dot')?.getAttribute("data-mark"),
    ).toBe("needs");
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Kiwi's thread");
    expect(words($(".vf-chat-thread-line"))).toBe("Kiwi is asleep Wake");
  });

  it("draws the catalog's rows with the product's own marks: Vela's need orange, Lyra's unread thread cyan, and Kiwi's ended need still orange (SP-1d)", async () => {
    await plate("list");
    const mark = (id: string): string | null =>
      $(`.vf-chat-row[data-spark="${id}"] .vf-chat-row-dot`)?.getAttribute("data-mark") ?? null;
    const lasting = (id: string): string | null =>
      $(`.vf-chat-row[data-spark="${id}"] .vf-chat-row-status + .sr-only`)?.textContent ?? null;
    expect(mark("sp-vela0001")).toBe("needs");
    expect(mark("sp-lyra0001")).toBe("unread");
    expect(mark("sp-juno0001")).toBeNull();
    // Kiwi asked you while its thread was off screen and has fallen asleep since: its dot outlasts the need, said in
    // its row's name (final critique 9)
    expect(mark("sp-kiwi0001")).toBe("needs");
    expect(lasting("sp-kiwi0001")).toBe(`, ${THREAD_MARK_WORDS.needs}`);
    expect(lasting("sp-vela0001")).toBeNull();
    // a thread on screen latches nothing, as opening it reads it: shown, Kiwi wears no dot
    await plate("asleep");
    expect(mark("sp-kiwi0001")).toBeNull();
    expect(mark("sp-lyra0001")).toBe("unread");
  });

  it("draws the thread's line in its plates in the product's own words: Wake under way and refused, and a spark not started yet (final critique 9)", async () => {
    const line = (): HTMLElement | null => $(".vf-chat-thread-line");
    const wake = (): HTMLButtonElement | null =>
      host?.querySelector<HTMLButtonElement>(".vf-chat-thread-line button") ?? null;
    // Wake pressed: its button waits, and it holds the thread, so Send waits too (one act at a time)
    await plate("waking");
    expect(words(line())).toBe("Kiwi is asleep Waking…");
    expect(wake()?.disabled).toBe(true);
    expect($(".vf-chat-send")?.getAttribute("aria-busy")).toBe("true");
    // …and refused, in fieldd's words, said on the line once; Wake stands to be pressed again
    await plate("wake-refused");
    expect(words(line())).toBe(
      "Couldn't wake Kiwi: fieldd is not answering (the daemon is restarting) Wake",
    );
    expect(wake()?.disabled).toBe(false);
    expect($(".vf-chat-send")?.hasAttribute("aria-busy")).toBe(false);
    // a spark whose session never started: no act of its own, Send wakes it
    await plate("not-started");
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Polaris's thread");
    expect(words(line())).toBe("Polaris hasn't started yet");
    expect(wake()).toBeNull();
  });

  it("keeps the thread a fixed box: the pane takes every height left, and the foot is where the thread's items stand over it", () => {
    mount(
      <ChatPanelView
        reading={ready([VELA], [VELA_ASKS])}
        chosen={null}
        now={NOW}
        pane={<div data-the-pane="vela" />}
      />,
    );
    const column = $(".vf-chat-thread");
    expect([...(column?.children ?? [])].map((child) => child.className)).toEqual([
      "vf-chat-thread-head",
      // the pane's chrome boundary renders its child alone
      "",
      "vf-chat-foot",
    ]);
    // the items' rule, in the product's stylesheet: positioned in the foot, never in the column's flow
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(here, "../src/chat/chat.css"), "utf8");
    const rule = (selector: string) =>
      css.match(new RegExp(`^\\${selector} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
    expect(rule(".vf-chat-pane")).toMatch(/flex: 1 1 auto;/);
    expect(rule(".vf-chat-foot")).toMatch(/position: relative;/);
    expect(rule(".vf-chat-items")).toMatch(/position: absolute;/);
    expect(rule(".vf-chat-items")).toMatch(/bottom: calc\(100% \+ 12px\);/);
  });

  it("says each of its other states in words — opening, unavailable, no sparks yet — never a blank", () => {
    mount(<ChatPanelView reading={{ state: "opening" }} chosen={null} now={NOW} />);
    expect(words($(".vf-chat-panel-state"))).toBe("Opening Chat…");
    act(() =>
      root?.render(
        <ChatPanelView
          reading={{ state: "unavailable", reason: "fieldd is not answering" }}
          chosen={null}
          now={NOW}
        />,
      ),
    );
    expect(words($(".vf-chat-panel-state"))).toBe(
      "Chat can't read your sparks fieldd is not answering",
    );
    act(() => root?.render(<ChatPanelView reading={ready([], [])} chosen={null} now={NOW} />));
    expect(words($(".vf-chat-panel-state"))).toBe("No sparks yet");
    expect(rows()).toEqual([]);
  });
});

describe("the field board, as one window reads it (MF-1)", () => {
  it("applies a snapshot, then deltas on top of its since, and asks again at a gap", () => {
    const board = new FieldBoard();
    expect(board.apply({ revision: 4, epoch: "e1", rows: [VELA_ASKS] }, "snapshot")).toBe(true);
    expect(board.rows().map((r) => r.runtimeRunId)).toEqual(["run-Vela"]);
    const idle = { ...VELA_ASKS, status: "idle", blockers: [] };
    expect(
      board.apply({ since: 4, revision: 5, epoch: "e1", upserts: [idle], removed: [] }, "delta"),
    ).toBe(true);
    expect(board.rows()[0]?.status).toBe("idle");
    expect(
      board.apply({ since: 5, revision: 6, upserts: [], removed: ["run-Vela"] }, "delta"),
    ).toBe(true);
    expect(board.rows()).toEqual([]);
    // a frame lost, or another epoch: a gap
    expect(board.apply({ since: 9, revision: 10, upserts: [], removed: [] }, "delta")).toBe(false);
    expect(
      board.apply({ since: 6, revision: 7, epoch: "e2", upserts: [], removed: [] }, "delta"),
    ).toBe(false);
  });

  it("passes over a row it cannot read, keeps the rest, and drops what that row would have replaced", () => {
    const board = new FieldBoard();
    board.apply(
      { revision: 1, rows: [VELA_ASKS, { runtimeRunId: "run-new", status: 42 }] },
      "snapshot",
    );
    expect(board.rows().map((r) => r.runtimeRunId)).toEqual(["run-Vela"]);
    board.apply(
      { since: 1, revision: 2, upserts: [{ runtimeRunId: "run-Vela", alive: "yes" }], removed: [] },
      "delta",
    );
    expect(board.rows()).toEqual([]);
  });
});

describe("the needs-you queue, as one window reads it (CP-3; needs.subscribe)", () => {
  /** A client whose needs.subscribe hears `early` before it answers its snapshot, as a busy socket can. */
  function client(snapshot: unknown, early: readonly unknown[]): FielddClient {
    return {
      subscribe: async (
        method: string,
        _params: unknown,
        onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
      ) => {
        expect(method).toBe("needs.subscribe");
        for (const payload of early) onEvent(payload, "delta");
        return { subId: "s-1", snapshot, unsubscribe: () => undefined };
      },
    } as unknown as FielddClient;
  }

  it("reads fieldd's list item by item, its snapshot first and a change heard before it after (the window side of EL9)", async () => {
    const heard: string[][] = [];
    const listed = NEEDS_LIST as { items: unknown[] };
    const stop = await sparksPortOver(
      client({ items: [...listed.items, { id: "ny-bad", kind: 7 }] }, [{ items: [] }]),
    ).watchNeeds((items) => heard.push(items.map((each) => each.kind)));
    // the one it cannot read is passed over, and the rest stand; the early frame waited behind the snapshot
    expect(heard).toEqual([["question", "held-send", "held-spawn", "agent-ask"], []]);
    stop();
  });

  it("reads a frame with no list as no items, never a blank thrown", async () => {
    const heard: number[] = [];
    await sparksPortOver(client({ items: "nope" }, [42])).watchNeeds((items) =>
      heard.push(items.length),
    );
    expect(heard).toEqual([0, 0]);
  });

  it("answers an item by its act's place (needs.answer {item, choice}), and reads the item fieldd hands back", async () => {
    const fixture = (name: string): unknown =>
      JSON.parse(
        readFileSync(
          join(dirname(fileURLToPath(import.meta.url)), `../../contracts/fixtures/${name}`),
          "utf8",
        ),
      );
    const params = fixture("needs-answer-params.valid.json") as { item: string; choice: number };
    const asked: unknown[] = [];
    const answering = {
      request: async (method: string, body: unknown) => {
        asked.push([method, body]);
        return fixture("needs-answer-result.valid.json");
      },
    } as unknown as FielddClient;
    const item = await sparksPortOver(answering).answer(params.item, params.choice);
    // the act travels by its place, never its word, so a rewording is no wire change
    expect(asked).toEqual([["needs.answer", params]]);
    expect([item.state, item.answer?.choice, item.answer?.told]).toEqual(["answered", 0, false]);
    // a reply that is not an item is a refusal thrown, never a guess
    const garbled = { request: async () => ({ item: { id: 7 } }) } as unknown as FielddClient;
    await expect(sparksPortOver(garbled).answer(params.item, 0)).rejects.toThrow();
  });

  it("says your words through compose.sparks.say, chips and all, and reads its receipt (TH-1; the window side of EL9)", async () => {
    const fixture = (name: string): unknown =>
      JSON.parse(
        readFileSync(
          join(dirname(fileURLToPath(import.meta.url)), `../../contracts/fixtures/${name}`),
          "utf8",
        ),
      );
    const params = fixture("compose-sparks-say-params.chips.json") as ComposeSparksSayParams;
    const asked: unknown[] = [];
    const saying = {
      request: async (method: string, body: unknown) => {
        asked.push([method, body]);
        return fixture("compose-sparks-say.waking.json");
      },
    } as unknown as FielddClient;
    const receipt = await sparksPortOver(saying).say(params);
    expect(asked).toEqual([["compose.sparks.say", params]]);
    expect(receipt.state).toBe("waking");
    // a reply that is not a receipt is a refusal thrown, never a guess
    const garbled = { request: async () => ({ state: 7 }) } as unknown as FielddClient;
    await expect(sparksPortOver(garbled).say(params)).rejects.toThrow();
  });
});

describe("whether a spark has worked, as one window reads it (TU-1, Q1; the window side of EL9)", () => {
  const golden = (name: string): unknown =>
    JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), `../../contracts/fixtures/${name}`),
        "utf8",
      ),
    );

  it("reads fieldd's sparks and board as their goldens say them: new for a spark that has never worked, never for one that has or says neither", async () => {
    const asked: string[] = [];
    const client = {
      request: async (method: string) => {
        asked.push(method);
        return golden("compose-sparks-list.turned.json");
      },
    } as unknown as FielddClient;
    const sparks = await sparksPortOver(client).list();
    expect(asked).toEqual(["compose.sparks.list"]);
    expect(sparks.map((each) => each.turnedAt)).toEqual([
      "2026-11-01T08:40:12.000Z",
      null,
      undefined,
    ]);
    const board = new FieldBoard();
    expect(board.apply(golden("agent-field-snapshot.turned.json"), "snapshot")).toBe(true);
    const entries = sparkEntriesOf(sparks, board.rows());
    expect(
      Object.fromEntries(entries.map((entry) => [entry.spark.name, sparkIsNew(entry)])),
    ).toEqual({ Vela: false, Lyra: true, Juno: false });
  });
});

/** A port the test drives: the list it answers, and the board it moves. */
function scripted(listed: SparkSummary[]) {
  const port = {
    lists: 0,
    listed,
    frame: null as ((payload: unknown, kind: "snapshot" | "delta") => void) | null,
    revision: 0,
    woke: [] as string[],
    refuse: null as string | null,
    /** the queue's frames, once its subscribe answered: whole, as needs.subscribe sends them */
    needs: null as ((items: readonly NeedsItem[]) => void) | null,
    /** the queue's first answer: its snapshot, or a refusal (an older fieldd has no needs.subscribe) */
    queue: [] as readonly NeedsItem[] | Error,
    /** a wake that takes its time: open answers once this settles */
    held: null as Promise<void> | null,
  };
  const door: SparksPort = {
    list: async () => {
      port.lists += 1;
      return port.listed;
    },
    watch: async (onFrame) => {
      port.frame = onFrame;
      onFrame({ revision: 0, rows: [] }, "snapshot");
      return () => {
        port.frame = null;
      };
    },
    watchNeeds: async (onItems) => {
      if (port.queue instanceof Error) throw port.queue;
      port.needs = onItems;
      onItems(port.queue);
      return () => {
        port.needs = null;
      };
    },
    // the card's answers are needs-card.test.tsx's
    answer: async () => {
      throw new Error("nothing is answered here");
    },
    // Send's say (TH-1) is not this test's
    say: async () => {
      throw new Error("nothing is said here");
    },
    onReconnected: () => () => undefined,
    open: async (id) => {
      port.woke.push(id);
      if (port.held !== null) await port.held;
      if (port.refuse !== null) throw new Error(port.refuse);
      return port.listed.find((s) => s.id === id) ?? VELA;
    },
  };
  const move = (upserts: AgentFieldRow[], removed: string[] = []) => {
    const since = port.revision;
    port.revision += 1;
    port.frame?.({ since, revision: port.revision, upserts, removed }, "delta");
  };
  return { port, door, move };
}

const settle = () => act(async () => undefined);

describe("Chat, live (the feed and its acts)", () => {
  it("reads the sparks fieldd keeps and the board's rows, and asks the list again when the board's sparks change", async () => {
    const { port, door, move } = scripted([VELA]);
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    expect(words($(".vf-chat-row-status"))).toBe("Hello");
    const lists = port.lists;
    await act(async () => move([{ ...VELA_ASKS, revision: 2 }]));
    expect(words($(".vf-chat-row-status"))).toBe("Asking you");
    // Vela's run appeared on the board: the list is asked again, once
    expect(port.lists).toBe(lists + 1);
    // a new spark's run: its record is read
    port.listed = [VELA, spark("sp-lyra0001", "Lyra")];
    await act(async () =>
      move([row({ runtimeRunId: "run-Lyra", spark: "sp-lyra0001", status: "working" })]),
    );
    await settle();
    expect(rows().map((r) => r.dataset.spark)).toContain("sp-lyra0001");
    // a delta that names nothing new asks for nothing
    const after = port.lists;
    await act(async () => move([{ ...VELA_ASKS, revision: 3, lastActivityAt: AT }]));
    expect(port.lists).toBe(after);
  });

  it("asks the list again once when a spark's own run first works, and not for a later frame of the same time (D5)", async () => {
    const { port, door, move } = scripted([VELA]);
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    const own = row({ runtimeRunId: "run-Vela", spark: VELA.id, turnedAt: null });
    await act(async () => move([own]));
    const lists = port.lists;
    // the row's push says the first turn: the spark's own record is read again, so its fact follows the row's
    await act(async () => move([{ ...own, revision: 2, turnedAt: AT }]));
    expect(port.lists).toBe(lists + 1);
    await act(async () => move([{ ...own, revision: 3, turnedAt: AT, lastActivityAt: AT }]));
    expect(port.lists).toBe(lists + 1);
  });

  it("mounts an awake spark's own pane as its thread, with no Show (SP-1d)", async () => {
    const { door, move } = scripted([VELA]);
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    await act(async () => move([VELA_ASKS]));
    expect($(".vf-chat-thread-line")).toBeNull();
    // this window holds no terminal pool: the pane's place says so (the pane is spark-pane.test.tsx's)
    expect($(".vf-chat-pane")?.getAttribute("data-pane-state")).toBe("no-terminals");
    // no Show: the thread's only buttons are its composer's (SP-1d's composer, `chat-composer.test.tsx`)
    const buttons = [...(host?.querySelectorAll(".vf-chat-thread button") ?? [])];
    expect(buttons.every((button) => button.closest(".vf-chat-composer") !== null)).toBe(true);
    expect($(".vf-chat-foot .vf-chat-composer")).not.toBeNull();
  });

  it("opens on the newest spark and keeps it: a newer activity elsewhere moves that row up, never the thread", async () => {
    const LYRA = spark("sp-lyra0001", "Lyra");
    // Vela's record is the newer when Chat opens, so the thread opens on her
    const { door, move } = scripted([{ ...VELA, updatedAt: "2026-10-31T05:10:00.000Z" }, LYRA]);
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    await act(async () =>
      move([
        row({
          runtimeRunId: "run-Vela",
          spark: "sp-vela0001",
          lastActivityAt: "2026-10-31T05:29:00.000Z",
          terminal: { hosted: "local", runtimeSessionId: "pty-Vela" },
        }),
        row({ runtimeRunId: "run-Lyra", spark: "sp-lyra0001", lastActivityAt: AT }),
      ]),
    );
    await settle();
    expect(rows().map((r) => r.dataset.spark)).toEqual(["sp-vela0001", "sp-lyra0001"]);
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Vela's thread");
    const velaPane = $(".vf-chat-pane");
    expect(velaPane).not.toBeNull();
    expect(sparkPaneOf("sp-vela0001")).not.toBeNull();
    // nothing was chosen, and Lyra's run works: her activity is newer, so her row moves up
    await act(async () =>
      move([
        row({
          runtimeRunId: "run-Lyra",
          spark: "sp-lyra0001",
          status: "working",
          lastActivityAt: "2026-10-31T05:29:59.000Z",
        }),
      ]),
    );
    await settle();
    expect(rows().map((r) => r.dataset.spark)).toEqual(["sp-lyra0001", "sp-vela0001"]);
    // the thread, and the pane mounted in it, stay Vela's: the same element, never Lyra's
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Vela's thread");
    expect($(".vf-chat-pane")).toBe(velaPane);
    expect(sparkPaneOf("sp-vela0001")).not.toBeNull();
    expect(sparkPaneOf("sp-lyra0001")).toBeNull();
    expect(rows()[1]?.getAttribute("aria-pressed")).toBe("true");
    // choosing is what moves the thread
    act(() => rows()[0]?.click());
    await settle();
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Lyra's thread");
  });

  it("reads a thread by showing it: a turn that ends in another marks that row unread until it is chosen (SP-1d)", async () => {
    const LYRA = spark("sp-lyra0001", "Lyra");
    const { door, move } = scripted([{ ...VELA, updatedAt: "2026-10-31T05:10:00.000Z" }, LYRA]);
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    const velaRun = (status: "idle" | "working") =>
      row({
        runtimeRunId: "run-Vela",
        spark: "sp-vela0001",
        status,
        lastActivityAt: "2026-10-31T05:29:00.000Z",
        terminal: { hosted: "local", runtimeSessionId: "pty-Vela" },
      });
    const lyraRun = (status: "idle" | "working") =>
      row({ runtimeRunId: "run-Lyra", spark: "sp-lyra0001", status, lastActivityAt: AT });
    const dotOf = (id: string): string | null =>
      $(`.vf-chat-row[data-spark="${id}"]`)
        ?.querySelector(".vf-chat-row-dot")
        ?.getAttribute("data-mark") ?? null;
    await act(async () => move([velaRun("idle"), lyraRun("working")]));
    await settle();
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Vela's thread");
    // Lyra's turn ends while Vela's thread is the one on screen
    await act(async () => move([lyraRun("idle")]));
    expect(dotOf("sp-lyra0001")).toBe("unread");
    // Vela's own turn ends where you can see it: nothing to read
    await act(async () => move([velaRun("working")]));
    await act(async () => move([velaRun("idle")]));
    expect(dotOf("sp-vela0001")).toBeNull();
    // choosing Lyra's row opens her thread, and opening it reads it
    act(() => $('.vf-chat-row[data-spark="sp-lyra0001"]')?.click());
    await settle();
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Lyra's thread");
    expect(dotOf("sp-lyra0001")).toBeNull();
  });

  it("shows no thread while Chat is not the view: the chosen spark's turn ending then is unread when Chat comes back", async () => {
    const { door, move } = scripted([VELA]);
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    const velaRun = (status: "idle" | "working") =>
      row({ runtimeRunId: "run-Vela", spark: "sp-vela0001", status, lastActivityAt: AT });
    const dot = (): string | null =>
      $(".vf-chat-row .vf-chat-row-dot")?.getAttribute("data-mark") ?? null;
    await act(async () => move([velaRun("working")]));
    await settle();
    // the window goes to another view; Chat stays mounted, its thread no longer on screen
    act(() => root?.render(<Chat active={false} />));
    await act(async () => move([velaRun("idle")]));
    expect(dot()).toBe("unread");
    // Chat is the view again, on Vela's thread: read
    act(() => root?.render(<Chat />));
    await settle();
    expect(dot()).toBeNull();
  });

  it("reads the Agent Profiles once for every thread: on Chat's first show, never on a thread switch, again at each @ open (CO)", async () => {
    const LYRA = spark("sp-lyra0001", "Lyra");
    const { door } = scripted([{ ...VELA, updatedAt: "2026-10-31T05:10:00.000Z" }, LYRA]);
    let reads = 0;
    const counted: ComposerPort = {
      ...PORT,
      profileSets: async () => {
        reads += 1;
        return [];
      },
    };
    stop = startSparksFeed(door);
    // mounted in another view: nothing is read until Chat shows
    mount(<Chat active={false} port={counted} />);
    await settle();
    expect(reads).toBe(0);
    act(() => root?.render(<Chat port={counted} />));
    await settle();
    expect(reads).toBe(1);
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Vela's thread");
    // a thread switch draws the next thread's composer, which reads nothing of its own
    act(() => $('.vf-chat-row[data-spark="sp-lyra0001"]')?.click());
    await settle();
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Lyra's thread");
    act(() => $('.vf-chat-row[data-spark="sp-vela0001"]')?.click());
    await settle();
    expect(reads).toBe(1);
    // another view and back: the first show is past
    act(() => root?.render(<Chat active={false} port={counted} />));
    act(() => root?.render(<Chat port={counted} />));
    await settle();
    expect(reads).toBe(1);
    // @ opens: read again; writing on inside it reads nothing more; @ opened again reads again
    typeText("ask @");
    await settle();
    expect($(".vf-chat-at")).not.toBeNull();
    expect(reads).toBe(2);
    typeText("ask @v");
    await settle();
    expect(reads).toBe(2);
    typeText("ask");
    await settle();
    expect($(".vf-chat-at")).toBeNull();
    typeText("ask @");
    await settle();
    expect(reads).toBe(3);
  });

  it("reads the queue beside the board: an item for a spark is its word and its dot, and leaves with them (CP-3)", async () => {
    const { port, door, move } = scripted([VELA, KIWI]);
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    await act(async () => move([row({ runtimeRunId: "run-Vela", spark: "sp-vela0001" })]));
    const status = (id: string): string =>
      words($(`.vf-chat-row[data-spark="${id}"] .vf-chat-row-status`));
    const dot = (id: string): string | null =>
      $(`.vf-chat-row[data-spark="${id}"] .vf-chat-row-dot`)?.getAttribute("data-mark") ?? null;
    expect(status("sp-kiwi0001")).toBe("Asleep");
    await act(async () => port.needs?.([KIWI_HOLDS]));
    expect(status("sp-kiwi0001")).toBe("Needs your OK");
    expect(dot("sp-kiwi0001")).toBe("needs");
    expect(status("sp-vela0001")).toBe("Ready");
    // answered (here or in another window): the queue's next frame has it gone, and the word goes with it
    await act(async () => port.needs?.([]));
    expect(status("sp-kiwi0001")).toBe("Asleep");
  });

  it("leaves the list as the board says it when an older fieldd has no queue: no item, never a guess (CP-3)", async () => {
    const { port, door } = scripted([VELA, KIWI]);
    port.queue = Object.assign(new Error("no such method: needs.subscribe"), { code: "NOT_FOUND" });
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    expect(rows().map((r) => words(r.querySelector<HTMLElement>(".vf-chat-row-status")))).toEqual([
      "Asleep",
      "Hello",
    ]);
    expect($(".vf-chat-row-dot")).toBeNull();
  });

  it("wakes an asleep spark through compose.sparks.open, and reads its record again", async () => {
    const { port, door } = scripted([KIWI]);
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    expect(words($(".vf-chat-thread-line"))).toBe("Kiwi is asleep Wake");
    const lists = port.lists;
    port.listed = [{ ...KIWI, session: { runtimeRunId: "run-Kiwi2", live: true } }];
    await act(async () => $(".vf-chat-thread-line button")?.click());
    await settle();
    expect(port.woke).toEqual(["sp-kiwi0001"]);
    expect(port.lists).toBe(lists + 1);
    // awake, its line gives way to its pane's place (being found, in a window with terminals; here, the Peek's words)
    expect($(".vf-chat-thread-line")).toBeNull();
    expect($(".vf-chat-pane")?.getAttribute("data-pane-state")).toBe("no-terminals");
  });

  it("wakes a spark once: Send pressed while Wake's wake runs waits, busy, and asks for no second open (SP-1d)", async () => {
    const { port, door } = scripted([KIWI]);
    let answer: () => void = () => undefined;
    port.held = new Promise((resolve) => {
      answer = resolve;
    });
    // a window with terminals: a Send into the asleep thread would wake the spark itself
    pool.configured = true;
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    await act(async () => $(".vf-chat-thread-line button")?.click());
    expect(port.woke).toEqual(["sp-kiwi0001"]);
    // typed while the wake runs, and sent by Return and by the button: Send waits, busy, and the draft stays
    act(() => {
      const field = $(".vf-chat-input");
      if (field === null) throw new Error("no draft");
      field.focus();
      const node = document.createTextNode("carry on with the migration");
      field.append(node);
      const range = document.createRange();
      range.setStart(node, node.length);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect($(".vf-chat-send")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      $(".vf-chat-input")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await act(async () => $(".vf-chat-send")?.click());
    await settle();
    expect(port.woke).toEqual(["sp-kiwi0001"]);
    expect($(".vf-chat-input")?.textContent).toBe("carry on with the migration");
    // the wake answered: the thread is let go, and Send no longer waits
    await act(async () => answer());
    await settle();
    expect($(".vf-chat-send")?.hasAttribute("aria-busy")).toBe(false);
  });

  it("says a refused Wake in fieldd's words where the act was, and keeps the act", async () => {
    const { port, door } = scripted([KIWI]);
    port.refuse = "the spark's agent has no sign-in";
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    await act(async () => $(".vf-chat-thread-line button")?.click());
    await settle();
    expect(port.woke).toEqual(["sp-kiwi0001"]);
    expect(words($(".vf-chat-thread-line"))).toBe(
      "Couldn't wake Kiwi: the spark's agent has no sign-in Wake",
    );
  });
});

describe("Chat's words are DESIGN.md's (§8 \"Chat's list\", \"Chat's thread\")", () => {
  it("says, in every state, exactly the words the canon records", () => {
    // the doc wraps its lines; a sentence is the same sentence across a wrap
    const here = dirname(fileURLToPath(import.meta.url));
    const design = readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");
    for (const said of [
      "No sparks yet",
      "Opening Chat…",
      "Chat can't read your sparks",
      "Vela is asleep",
      "Vela hasn't started yet",
      "Vela needs you",
      "Waking…",
      "Couldn't wake Vela: …",
      // the pane's place (SP-1d)
      "Finding Vela's pane…",
      "Vela's terminal is not on this desktop's floor.",
      "Couldn't find Vela's pane: …",
      NO_TERMINALS,
      // a row's lasting mark, after its status word (SP-1d)
      `"Asleep, ${THREAD_MARK_WORDS.needs}"`,
      `"Ready, ${THREAD_MARK_WORDS.unread}"`,
    ]) {
      expect(design, said).toContain(said);
    }
  });
});
