// @vitest-environment happy-dom
/**
 * SP-1b — Chat (DESIGN.md §8 "Chat's list"; CH-D1, CH-D3, CH-D4): the panel the catalog mounts on fixtures
 * (`ChatPanelView`), the window's one feed (`sparks-feed.ts`: the field board and the sparks fieldd keeps) and the
 * controller's acts (`ChatView`: Show by Jump to's path, Wake by `compose.sparks.open`). The live witness of the
 * list is James's first sight in `pnpm dev`; the board's own rows are fieldd's (agent-field.test.ts there).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentFieldRow, SparkSummary } from "@vibefield/contracts";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const opened = vi.hoisted(() => ({
  rows: [] as unknown[],
  outcome: { state: "shown" } as unknown,
}));
vi.mock("../src/frame/live-open", () => ({
  openLiveRow: async (row: unknown, from: unknown) => {
    opened.rows.push({ row, from });
    return opened.outcome;
  },
}));

import { ChatPanelView } from "../src/chat/ChatPanelView";
import { ChatView } from "../src/chat/ChatView";
import { sparkEntriesOf } from "../src/chat/spark-status";
import { FieldBoard, type SparksPort, startSparksFeed } from "../src/chat/sparks-feed";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

let root: Root | null = null;
let host: HTMLElement | null = null;
let stop: (() => void) | null = null;

beforeEach(() => {
  opened.rows = [];
  opened.outcome = { state: "shown" };
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  stop?.();
  stop = null;
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
    expect(vela?.querySelector(".vf-chat-row-dot")).not.toBeNull();
    expect(kiwi?.querySelector(".vf-chat-row-status")?.hasAttribute("data-tone")).toBe(false);
    expect(kiwi?.querySelector(".vf-chat-row-dot")).toBeNull();
  });

  it("gives the chosen spark's head one honest line and one act: Show, Wake, or nothing yet", () => {
    const onChoose = vi.fn();
    const onShow = vi.fn();
    const onWake = vi.fn();
    const draw = (chosen: string | null) =>
      act(() =>
        root?.render(
          <ChatPanelView
            reading={ready([VELA, KIWI, NOVA], [VELA_ASKS])}
            chosen={chosen}
            now={NOW}
            onChoose={onChoose}
            onShow={onShow}
            onWake={onWake}
          />,
        ),
      );
    mount(<div />);
    draw(null);
    expect(words($(".vf-chat-thread-head"))).toBe("Vela Asking you");
    expect(words($(".vf-chat-thread-line"))).toBe("Vela's pane is in Godview Show");
    act(() => $(".vf-chat-thread-line button")?.click());
    expect(onShow.mock.calls[0]?.[0]?.spark.id).toBe("sp-vela0001");
    act(() => rows()[1]?.click());
    expect(onChoose).toHaveBeenLastCalledWith("sp-kiwi0001");
    draw("sp-kiwi0001");
    expect(words($(".vf-chat-thread-line"))).toBe("Kiwi is asleep Wake");
    act(() => $(".vf-chat-thread-line button")?.click());
    expect(onWake.mock.calls[0]?.[0]?.spark.id).toBe("sp-kiwi0001");
    draw("sp-nova0001");
    expect(words($(".vf-chat-thread-line"))).toBe("Nova hasn't started yet");
    expect($(".vf-chat-thread-line button")).toBeNull();
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
    open: async (id) => {
      port.woke.push(id);
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
    mount(<ChatView active />);
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

  it("shows the spark's own pane by Jump to's path, and says a refusal in its line", async () => {
    const { door, move } = scripted([VELA]);
    stop = startSparksFeed(door);
    mount(<ChatView active />);
    await settle();
    await act(async () => move([VELA_ASKS]));
    await act(async () => $(".vf-chat-thread-line button")?.click());
    expect(opened.rows).toEqual([
      { row: { id: "run-Vela", floorSessionId: "pty-Vela" }, from: "assistant" },
    ]);
    opened.outcome = { state: "refused", reason: "the deck did not open to show it" };
    await act(async () => $(".vf-chat-thread-line button")?.click());
    expect(words($(".vf-chat-thread-line"))).toBe(
      "Couldn't show Vela's pane: the deck did not open to show it Show",
    );
  });

  it("wakes an asleep spark through compose.sparks.open, and reads its record again", async () => {
    const { port, door } = scripted([KIWI]);
    stop = startSparksFeed(door);
    mount(<ChatView active />);
    await settle();
    expect(words($(".vf-chat-thread-line"))).toBe("Kiwi is asleep Wake");
    const lists = port.lists;
    port.listed = [{ ...KIWI, session: { runtimeRunId: "run-Kiwi2", live: true } }];
    await act(async () => $(".vf-chat-thread-line button")?.click());
    await settle();
    expect(port.woke).toEqual(["sp-kiwi0001"]);
    expect(port.lists).toBe(lists + 1);
    expect(words($(".vf-chat-thread-line"))).toBe("Kiwi's pane is in Godview Show");
  });

  it("says a refused Wake in fieldd's words where the act was, and keeps the act", async () => {
    const { port, door } = scripted([KIWI]);
    port.refuse = "the spark's agent has no sign-in";
    stop = startSparksFeed(door);
    mount(<ChatView active />);
    await settle();
    await act(async () => $(".vf-chat-thread-line button")?.click());
    await settle();
    expect(port.woke).toEqual(["sp-kiwi0001"]);
    expect(words($(".vf-chat-thread-line"))).toBe(
      "Couldn't wake Kiwi: the spark's agent has no sign-in Wake",
    );
  });
});

describe("Chat's words are DESIGN.md's (§8 \"Chat's list\")", () => {
  it("says, in every state, exactly the words the canon records", () => {
    // the doc wraps its lines; a sentence is the same sentence across a wrap
    const here = dirname(fileURLToPath(import.meta.url));
    const design = readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");
    for (const said of [
      "No sparks yet",
      "Opening Chat…",
      "Chat can't read your sparks",
      "Vela's pane is in Godview",
      "Vela is asleep",
      "Vela hasn't started yet",
      "Vela needs you",
      "Showing…",
      "Waking…",
    ]) {
      expect(design, said).toContain(said);
    }
  });
});
