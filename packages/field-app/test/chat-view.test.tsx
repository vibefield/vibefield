// @vitest-environment happy-dom
/**
 * SP-1b, SP-1d — Chat (DESIGN.md §8 "Chat's list", "Chat's thread"; CH-D1, CH-D3, CH-D4): the panel the catalog
 * mounts on fixtures (`ChatPanelView`), the window's one feed (`sparks-feed.ts`: the field board and the sparks fieldd
 * keeps) and the controller (`ChatView`: the shown spark's own pane while it is awake, Wake by `compose.sparks.open`
 * while it sleeps). The pane itself is `spark-pane.test.tsx`'s; this window holds no terminal pool, so its place says
 * what such a window says. The live witness of the list is James's first sight in `pnpm dev`; the board's own rows
 * are fieldd's (agent-field.test.ts there).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentFieldRow, SparkSummary } from "@vibefield/contracts";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerPort } from "../src/chat/ChatComposer";
import { type ChatAct, ChatPanelView } from "../src/chat/ChatPanelView";
import { ChatView } from "../src/chat/ChatView";
import { sparkEntriesOf } from "../src/chat/spark-status";
import { FieldBoard, type SparksPort, startSparksFeed } from "../src/chat/sparks-feed";
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

/** What @'s rows would read of fieldd: nothing to offer here (the composer's own suite reads the rows). */
const PORT: ComposerPort = {
  profileSets: async () => [],
  models: async () => {
    throw new Error("no picker here");
  },
};

/** Chat as the frame mounts it: FieldView's place, the one owner of the frame's open surface, stands around it. Chat
 * is the view showing unless the test says it is not (the frame keeps it mounted in another view). */
function Chat({ active = true }: { active?: boolean }): ReactElement {
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  return <ChatView active={active} surface={surface} onSurfaceChange={setSurface} port={PORT} />;
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

describe('the panel (DESIGN.md §8 "Chat\'s list")', () => {
  const ready = (sparks: readonly SparkSummary[], board: readonly AgentFieldRow[]) =>
    ({ state: "ready", entries: sparkEntriesOf(sparks, board) }) as const;

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

  /** One of the Chat specimen's plates, mounted as the catalog mounts it. */
  async function plate(state: ChatState): Promise<void> {
    act(() => root?.unmount());
    host?.remove();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<ChatPreview state={state} />));
  }

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

/** A port the test drives: the list it answers, and the board it moves. */
function scripted(listed: SparkSummary[]) {
  const port = {
    lists: 0,
    listed,
    frame: null as ((payload: unknown, kind: "snapshot" | "delta") => void) | null,
    revision: 0,
    woke: [] as string[],
    refuse: null as string | null,
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
