// @vitest-environment happy-dom
/**
 * SP-1b, SP-1d, CP-3 — Chat (DESIGN.md §8 "Chat's list", "Chat's thread"; CH-D1, CH-D3, CH-D4, CP3-D8): the panel the
 * catalog mounts on fixtures (`ChatPanelView`), the window's one feed (`sparks-feed.ts`: the field board, the sparks
 * fieldd keeps and, since CP-3, the needs-you queue) and the controller (`ChatView`: since TH-1 the shown spark's
 * conversation, read from its transcript through a scripted door, `transcript-door-fixture.ts`; Wake by
 * `compose.sparks.open` while it sleeps). The flow's own rows are `thread-flow.test.tsx`'s and `transcript-items.test.ts`'s.
 * The live witness of the list is James's first sight in `pnpm dev`; the board's own rows are fieldd's
 * (agent-field.test.ts there), the queue's needs-queue.test.ts.
 * *TH-1, the pane leaves Chat:* the controller mounted the shown spark's own pane while it was awake
 * (`spark-pane.test.tsx`'s, retired with it), and a window with no terminal pool said so in its place.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG,
  type AgentFieldRow,
  type AgentInterruptResult,
  type AgentProviderSummary,
  type ComposeSparksSayParams,
  type NeedsItem,
  type SparkSummary,
} from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerPort } from "../src/chat/ChatComposer";
import { type ChatAct, ChatPanelView, type ChatPanelViewProps } from "../src/chat/ChatPanelView";
import { ChatView } from "../src/chat/ChatView";
import type { CrewsDoor } from "../src/chat/crews-port";
import { STILL_RUNNING } from "../src/chat/head-act";
import type { NewSparkPort } from "../src/chat/new-spark";
import { pendingSaysNow, resetPendingSaysForTest, standPendingSay } from "../src/chat/pending-says";
import { sparkEntriesOf } from "../src/chat/spark-status";
import {
  FieldBoard,
  type SparksPort,
  sparksPortOver,
  startSparksFeed,
} from "../src/chat/sparks-feed";
import { STARTERS, type Starter, sparkIsNew } from "../src/chat/thread-items";
import { THREAD_MARK_WORDS, type ThreadMark } from "../src/chat/thread-marks";
import { ChatPreview } from "../src/design-system/ChatPreview";
import type { ChatState } from "../src/design-system/chat-fixtures";
import type { KeyedCallClient } from "../src/forwarded-call";
import type { FrameSurface } from "../src/frame/frame-surface";
import { hearLineSays } from "../src/frame/line-door";
import { listedRun, runsDoor, runsOverBoard } from "./runs-door-fixture";
import {
  NO_TRANSCRIPTS,
  type ScriptedTranscripts,
  scriptedTranscripts,
  transcriptLine,
} from "./transcript-door-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Jump to (TH-2) goes to the spark's pane in Godview by Jump to's path; scripted, so where it was sent is seen. */
const shown = vi.hoisted(() => ({
  opened: [] as { readonly row: unknown; readonly from: unknown }[],
  outcome: { state: "shown" } as { state: "shown" } | { state: "refused"; reason: string },
}));
/** SP-1e2 — the views a crew card's Open in Godview asked for. */
const views = vi.hoisted(() => ({ asked: [] as unknown[] }));
vi.mock("../src/frame/view-state", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestView: async (view: unknown) => {
    views.asked.push(view);
  },
}));
vi.mock("../src/frame/live-open", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openLiveRow: async (row: unknown, from: unknown) => {
    shown.opened.push({ row, from });
    return shown.outcome;
  },
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

/** Track ES — the agents fieldd offers (`agent.providers`), read while Chat is empty: one here that can be a spark. */
const SPARK_ROW = AGENT_CATALOG.find((row) => row.offers.spark);
const SPARKING_HERE: AgentProviderSummary[] =
  SPARK_ROW === undefined
    ? []
    : [
        {
          id: SPARK_ROW.id,
          label: SPARK_ROW.label,
          available: true,
          resumable: true,
          personas: [],
          offers: { spawn: true, spark: true },
        },
      ];

/** What @'s rows would read of fieldd: nothing to offer here (the composer's own suite reads the rows); and what the
 * night reads, the sheet's own `agent.providers` (track ES), which the frame hands Chat as the night's door. */
const PORT: ComposerPort & Pick<NewSparkPort, "providers"> = {
  profileSets: async () => [],
  models: async () => {
    throw new Error("no picker here");
  },
  providers: async () => SPARKING_HERE,
};

/** Item 187 — the board rows `scripted`'s feed holds now, which fieldd's `agent.list` answers by default as a desktop
 * whose terminal doors are published does: the list and the board say the same (`runs-door-fixture.ts`). */
const boardNow = new Map<string, AgentFieldRow>();
const BOARD_RUNS = runsOverBoard(() => boardNow.values()).door;

/** Chat as the frame mounts it: FieldView's place, the one owner of the frame's open surface, stands around it. Chat
 * is the view showing unless the test says it is not (the frame keeps it mounted in another view). */
function Chat({
  active = true,
  port = PORT,
  transcripts = NO_TRANSCRIPTS,
  crews,
  runs = BOARD_RUNS,
  onSurface,
  onOpenAgents,
  onFirstJob,
}: {
  active?: boolean;
  port?: ComposerPort & Pick<NewSparkPort, "providers">;
  transcripts?: ScriptedTranscripts["door"];
  crews?: CrewsDoor;
  runs?: KeyedCallClient;
  /** what the frame's open surface became, each time (track ES: New spark and a first job open the sheet) */
  onSurface?: (next: FrameSurface | null) => void;
  /** track ES — Open Agents settings, on the night with no agent that can be a spark */
  onOpenAgents?: () => void;
  /** track ES (ES-2) — the job the night hands the frame as it opens the sheet, or none */
  onFirstJob?: (job: Starter | null) => void;
}): ReactElement {
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  return (
    <ChatView
      active={active}
      surface={surface}
      onSurfaceChange={(next) => {
        onSurface?.(next);
        setSurface(next);
      }}
      port={port}
      transcripts={transcripts}
      {...(crews === undefined ? {} : { crews })}
      runs={runs}
      agents={port}
      {...(onOpenAgents === undefined ? {} : { onOpenAgents })}
      {...(onFirstJob === undefined ? {} : { onFirstJob })}
    />
  );
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let stop: (() => void) | null = null;

/** What the window's line said (Jump to's notes, TH-2). */
let noted: string[] = [];
let stopHearing: (() => void) | null = null;
beforeEach(() => {
  noted = [];
  stopHearing = hearLineSays((text) => noted.push(text));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  stop?.();
  stop = null;
  resetPendingSaysForTest();
  stopHearing?.();
  stopHearing = null;
  shown.opened = [];
  shown.outcome = { state: "shown" };
  views.asked = [];
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
/** The head's acts as a person reads them, in order: each pill's words and the act it is (TH-2). */
const headActs = (): string[][] =>
  [...(host?.querySelectorAll<HTMLButtonElement>(".vf-chat-thread-acts button") ?? [])].map(
    (button) => [words(button), button.dataset.act ?? ""],
  );
const headAct = (name: string): HTMLButtonElement | null =>
  host?.querySelector<HTMLButtonElement>(`.vf-chat-thread-acts button[data-act="${name}"]`) ?? null;
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

  it("draws the shown spark's conversation under its head, and Jump to its head's one act (TH-1; TH-2)", () => {
    const draw = (flow?: ReactElement) =>
      act(() =>
        root?.render(
          <ChatPanelView
            reading={ready([VELA, KIWI, NOVA], [VELA_ASKS])}
            chosen={null}
            now={NOW}
            {...(flow === undefined ? {} : { flow })}
          />,
        ),
      );
    mount(<div />);
    draw(<div data-the-flow="vela" />);
    expect(words($(".vf-chat-thread-head"))).toBe("Vela Asking you Jump to");
    expect($("[data-the-flow]")?.closest(".vf-chat-thread")).not.toBeNull();
    // SP-1d's Show returns as the head's Jump to (TH-2): the thread's one button, a run blocked offering no Pause
    expect(headActs()).toEqual([["Jump to", "jump"]]);
    expect(host?.querySelectorAll(".vf-chat-thread button")).toHaveLength(1);
    // with no flow handed in, the column is the head and the foot alone: nothing stands for a pane
    draw();
    expect([...($(".vf-chat-thread")?.children ?? [])].map((child) => child.className)).toEqual([
      "vf-chat-thread-head",
      "vf-chat-foot",
    ]);
  });

  it("says an asleep spark in its head, with Wake and its refusal there, and gives a spark not started no act (TH-1; TH-2)", () => {
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
            flow={<div data-the-flow="" />}
          />,
        ),
      );
    mount(<div />);
    draw(null);
    act(() => rows()[1]?.click());
    expect(onChoose).toHaveBeenLastCalledWith("sp-kiwi0001");
    draw("sp-kiwi0001");
    // the status word says it sleeps; no line under the head (the pane's line left with it)
    expect(words($(".vf-chat-thread-head"))).toBe("Kiwi Asleep Wake");
    expect($(".vf-chat-thread-line")).toBeNull();
    expect(headActs()).toEqual([["Wake", "wake"]]);
    // its conversation is drawn asleep too
    expect($("[data-the-flow]")?.closest(".vf-chat-thread")).not.toBeNull();
    act(() => headAct("wake")?.click());
    expect(onWake.mock.calls[0]?.[0]?.spark.id).toBe("sp-kiwi0001");
    draw("sp-kiwi0001", { state: "busy" });
    expect(headActs()).toEqual([["Waking…", "wake"]]);
    expect(headAct("wake")?.disabled).toBe(true);
    // refused: fieldd's words in the status's place, in the attention ink, and Wake stands to be pressed again
    draw("sp-kiwi0001", { state: "refused", reason: "the spark's agent has no sign-in" });
    expect(words($(".vf-chat-thread-status"))).toBe(
      "Couldn't wake Kiwi: the spark's agent has no sign-in",
    );
    expect($(".vf-chat-thread-status")?.getAttribute("data-tone")).toBe("attention");
    expect(headActs()).toEqual([["Wake", "wake"]]);
    draw("sp-nova0001");
    // no act of its own: Send starts it
    expect($(".vf-chat-thread-acts")).toBeNull();
    expect($(".vf-chat-thread button")).toBeNull();
    // a refusal Wake never asked for is never said for a spark with no Wake (Send says its own, in its note)
    draw("sp-nova0001", { state: "refused", reason: "the spark's agent has no sign-in" });
    expect(words($(".vf-chat-thread-status"))).not.toContain("Couldn't wake");
  });

  it("says a sleeping spark's item in its word, and still says it sleeps: Wake in its head (CP-3; critique 7; TH-2)", () => {
    const onWake = vi.fn();
    mount(
      <ChatPanelView
        reading={ready([KIWI, VELA], [VELA_ASKS], [KIWI_HOLDS])}
        chosen="sp-kiwi0001"
        now={NOW}
        onWake={onWake}
      />,
    );
    const kiwi = $('.vf-chat-row[data-spark="sp-kiwi0001"]');
    expect(words(kiwi?.querySelector<HTMLElement>(".vf-chat-row-status") ?? null)).toBe(
      "Needs your OK",
    );
    expect(kiwi?.querySelector(".vf-chat-row-status")?.getAttribute("data-tone")).toBe("attention");
    expect(kiwi?.querySelector(".vf-chat-row-dot")?.getAttribute("data-mark")).toBe("needs");
    // the head says the item's word, in the attention ink; the face says the same status (S-3); its act is Wake (TH-2)
    expect(words($(".vf-chat-thread-head"))).toBe("Kiwi Needs your OK Wake");
    expect($(".vf-chat-thread-status")?.getAttribute("data-tone")).toBe("attention");
    // awake is read from its session, never its word: asleep, with Wake
    expect(headActs()).toEqual([["Wake", "wake"]]);
    act(() => headAct("wake")?.click());
    expect(onWake.mock.calls[0]?.[0]?.spark.id).toBe("sp-kiwi0001");
  });

  describe("the head's act (TH-2; DESIGN.md §8 \"Chat's thread\", the head's act; TH-Q3 (b), TH-Q28 (b))", () => {
    const TURN = "2026-10-31T05:29:00.000Z";
    const own = (over: Partial<AgentFieldRow> = {}): AgentFieldRow =>
      row({
        runtimeRunId: "run-Vela",
        spark: "sp-vela0001",
        terminal: { hosted: "local", runtimeSessionId: "pty-Vela" },
        ...over,
      });
    const WORKS = own({ status: "working", statusSince: TURN });
    const draw = (
      board: readonly AgentFieldRow[],
      extra: Partial<ChatPanelViewProps> = {},
      chosen: string | null = "sp-vela0001",
    ) =>
      act(() =>
        root?.render(
          <ChatPanelView
            reading={ready([VELA, KIWI, NOVA], board)}
            chosen={chosen}
            now={NOW}
            {...extra}
          />,
        ),
      );

    it("holds one place at the head's end: Jump to awake, Wake asleep, nothing before the spark started", () => {
      const onJump = vi.fn();
      const onWake = vi.fn();
      mount(<div />);
      draw([own()], { onJump, onWake });
      expect(headActs()).toEqual([["Jump to", "jump"]]);
      const jump = headAct("jump");
      expect(jump?.getAttribute("aria-label")).toBe("Jump to Vela's pane");
      // a quiet pill, its glyph then its word
      expect(jump?.dataset.variant).toBe("quiet");
      expect(jump?.querySelector("svg")).not.toBeNull();
      act(() => jump?.click());
      expect(onJump.mock.calls[0]?.[0]?.spark.id).toBe("sp-vela0001");
      // while it runs, the pill waits and a press does nothing
      draw([own()], { onJump, onWake, jumping: true });
      expect(headAct("jump")?.getAttribute("aria-busy")).toBe("true");
      expect(headAct("jump")?.disabled).toBe(true);
      act(() => headAct("jump")?.click());
      expect(onJump).toHaveBeenCalledTimes(1);
      // asleep: Wake in the same place, with its glyph
      draw([own()], { onJump, onWake }, "sp-kiwi0001");
      expect(headActs()).toEqual([["Wake", "wake"]]);
      expect(headAct("wake")?.querySelector("svg")).not.toBeNull();
      act(() => headAct("wake")?.click());
      expect(onWake.mock.calls[0]?.[0]?.spark.id).toBe("sp-kiwi0001");
      // not started: no act, and no end slot drawn
      draw([own()], { onJump, onWake }, "sp-nova0001");
      expect($(".vf-chat-thread-acts")).toBeNull();
    });

    it("stands Pause current turn before Jump to while Vela's own run works, pausing while it is sent, and offers no End run", () => {
      const onPause = vi.fn();
      mount(<div />);
      draw([own()], { onPause });
      expect(headActs()).toEqual([["Jump to", "jump"]]);
      draw([WORKS], { onPause });
      expect(headActs()).toEqual([
        ["Pause current turn", "pause"],
        ["Jump to", "jump"],
      ]);
      act(() => headAct("pause")?.click());
      expect(onPause.mock.calls[0]?.[0]?.spark.id).toBe("sp-vela0001");
      // pressed: it says so until fieldd answers, and a press does nothing
      draw([WORKS], { onPause, pause: { state: "busy", turn: TURN } });
      expect(words(headAct("pause"))).toBe("Pausing current turn…");
      expect(headAct("pause")?.disabled).toBe(true);
      // fieldd holds the stop as sent (the row's `stop`): still pausing, read from the board
      draw([{ ...WORKS, stop: { sentAt: TURN, stage: "sent" } }], { onPause });
      expect(words(headAct("pause"))).toBe("Pausing current turn…");
      // the turn stopped: the run is idle, and Pause leaves
      draw([own({ stop: { sentAt: TURN, stage: "heard", heardBy: "status" } })], { onPause });
      expect(headActs()).toEqual([["Jump to", "jump"]]);
      // never End run in Chat's head: ending Vela's run is its terminal's, in Godview
      draw([{ ...WORKS, stop: { sentAt: TURN, stage: "sent", unheardAt: TURN } }], { onPause });
      expect(words($(".vf-chat-thread"))).not.toContain("End run");
    });

    it("says a cancellation fieldd could not confirm, and a refused Pause, in the status's place in the attention ink", () => {
      mount(<div />);
      draw([
        { ...WORKS, stop: { sentAt: TURN, stage: "sent", unheardAt: "2026-10-31T05:29:03.000Z" } },
      ]);
      expect(words($(".vf-chat-thread-status"))).toBe(STILL_RUNNING);
      expect($(".vf-chat-thread-status")?.getAttribute("data-tone")).toBe("attention");
      // Pause and Jump to stay; Pause waits, since fieldd sends nothing more for this turn
      expect(headActs()).toEqual([
        ["Pause current turn", "pause"],
        ["Jump to", "jump"],
      ]);
      expect(headAct("pause")?.disabled).toBe(true);
      // refused, in fieldd's words, while that turn works; Pause stands to be pressed again
      const refused = { state: "refused", turn: TURN, reason: "no-terminal-host" } as const;
      draw([WORKS], { pause: refused });
      expect(words($(".vf-chat-thread-status"))).toBe(
        "Couldn't pause Vela's turn: no-terminal-host",
      );
      expect($(".vf-chat-thread-status")?.getAttribute("data-tone")).toBe("attention");
      expect(headAct("pause")?.disabled).toBe(false);
      // the next turn says the status word again
      draw([{ ...WORKS, statusSince: "2026-10-31T05:31:00.000Z" }], { pause: refused });
      expect(words($(".vf-chat-thread-status"))).toBe("Thinking");
      expect($(".vf-chat-thread-status")?.hasAttribute("data-tone")).toBe(false);
    });
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

  it("draws the catalog's waiting plate on the product's reading: Kiwi asleep, its held send Needs your OK, Wake in its head (CP-3; TH-2)", async () => {
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
    expect(headActs()).toEqual([["Wake", "wake"]]);
    // its conversation stands under the head, and its card in the foot (TH-1)
    expect($(".vf-chat-flow")?.getAttribute("data-flow-state")).toBe("ready");
    expect($(".vf-chat-foot .vf-needs-card")).not.toBeNull();
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

  it("draws Wake's plates in the product's own words: under way and refused in the head, and a spark not started yet (final critique 9; TH-1)", async () => {
    const wake = (): HTMLButtonElement | null => headAct("wake");
    // Wake pressed: its pill waits, and it holds the thread, so Send waits too (one act at a time)
    await plate("waking");
    expect(words($(".vf-chat-thread-status"))).toBe("Asleep");
    expect(words(wake())).toBe("Waking…");
    expect(wake()?.disabled).toBe(true);
    expect($(".vf-chat-send")?.getAttribute("aria-busy")).toBe("true");
    // …and refused, in fieldd's words, said in the status's place once; Wake stands to be pressed again
    await plate("wake-refused");
    expect(words($(".vf-chat-thread-status"))).toBe(
      "Couldn't wake Kiwi: fieldd is not answering (the daemon is restarting)",
    );
    expect(words(wake())).toBe("Wake");
    expect(wake()?.disabled).toBe(false);
    expect($(".vf-chat-send")?.hasAttribute("aria-busy")).toBe(false);
    // a spark whose session never started: no act of its own, Send wakes it; its hello is its flow's first row
    await plate("not-started");
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Polaris's thread");
    expect(wake()).toBeNull();
    expect($('.vf-chat-flow [data-row="hello"]')).not.toBeNull();
    // no plate draws a line under the head, nor a pane's place (TH-1)
    expect($(".vf-chat-thread-line")).toBeNull();
    expect($(".vf-chat-pane")).toBeNull();
  });

  it("draws the head's plates on the product's reading: Jump to under way, Juno's turn pausing, and a cancellation not confirmed (TH-2)", async () => {
    // awake and Ready: Jump to alone, its pill waiting while it runs, and Send not held by it
    await plate("jumping");
    expect(headActs()).toEqual([["Jump to", "jump"]]);
    expect(headAct("jump")?.getAttribute("aria-busy")).toBe("true");
    expect($(".vf-chat-send")?.hasAttribute("aria-busy")).toBe(false);
    // Juno at work: Pause before Jump to, pressed and waiting on fieldd
    await plate("pausing");
    expect(headActs()).toEqual([
      ["Pausing current turn…", "pause"],
      ["Jump to", "jump"],
    ]);
    // fieldd could not confirm it: said in the status's place, in the attention ink, and no End run
    await plate("pause-unconfirmed");
    expect(words($(".vf-chat-thread-status"))).toBe(STILL_RUNNING);
    expect($(".vf-chat-thread-status")?.getAttribute("data-tone")).toBe("attention");
    expect(headAct("pause")?.disabled).toBe(true);
    expect(words($(".vf-chat-thread"))).not.toContain("End run");
  });

  it("keeps the thread a fixed box: the head, the flow taking every height left, then the foot, its items above the composer (TH-1)", () => {
    mount(
      <ChatPanelView
        reading={ready([VELA], [VELA_ASKS])}
        chosen={null}
        now={NOW}
        flow={<div className="vf-chat-flow" data-the-flow="vela" />}
      />,
    );
    const column = $(".vf-chat-thread");
    expect([...(column?.children ?? [])].map((child) => child.className)).toEqual([
      "vf-chat-thread-head",
      // the flow's chrome boundary renders its child alone
      "vf-chat-flow",
      "vf-chat-foot",
    ]);
    // the rules, in the product's stylesheets: the flow takes the height; the foot and its items stand in the column
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(here, "../src/chat/chat.css"), "utf8");
    const flowCss = readFileSync(join(here, "../src/chat/thread-flow.css"), "utf8");
    const rule = (sheet: string, selector: string) =>
      sheet.match(new RegExp(`^\\${selector} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
    expect(rule(flowCss, ".vf-chat-flow")).toMatch(/flex: 1 1 auto;/);
    expect(rule(css, ".vf-chat-foot")).toMatch(/margin: 12px auto 16px;/);
    expect(css).not.toMatch(/position: absolute;[^}]*bottom: calc\(100% \+ 12px\)/);
    expect(css).not.toMatch(/\.vf-chat-pane(?![a-z-])/u);
  });

  it("says each of its other states in words — opening, unavailable, and with no spark the night — never a blank", () => {
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
    // track ES (ES-D1…D7 A, 2026-11-08): with no spark the panel is the night, its own words (`chat-empty.test.tsx`);
    // "No sparks yet" retired on the Mac (DESIGN.md §8 "Chat's list", amended)
    expect($(".vf-chat-panel-state")).toBeNull();
    expect(words($(".vf-chat-empty-title"))).toBe("Make your first spark");
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
  boardNow.clear();
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
    /** what Pause asked of agent.pause, by run (TH-2) */
    paused: [] as string[],
    /** agent.pause's answer: accepted, unless the test says otherwise */
    pauseAnswer: Promise.resolve({ accepted: true }) as Promise<AgentInterruptResult>,
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
    pause: async (runtimeRunId) => {
      port.paused.push(runtimeRunId);
      return port.pauseAnswer;
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
    for (const row of upserts) boardNow.set(row.runtimeRunId, row);
    for (const id of removed) boardNow.delete(id);
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

  it("draws an awake spark's conversation as its thread, read through the window's own ticket, with Jump to in its head (TH-1; TH-2)", async () => {
    const { door, move } = scripted([VELA]);
    const transcripts = scriptedTranscripts();
    transcripts.keep(
      "sp-vela0001",
      [{ runtimeRunId: "run-Vela", startedAt: AT, fresh: true }],
      new Map([
        [
          "run-Vela",
          [
            transcriptLine(1, "run", AT, { runtimeRunId: "run-Vela", fresh: true }),
            transcriptLine(2, "reply", "2026-10-31T05:20:00.000Z", {
              messageId: "m-1",
              text: "The suite is green.",
            }),
          ],
        ],
      ]),
    );
    stop = startSparksFeed(door);
    mount(<Chat transcripts={transcripts.door} />);
    await settle();
    await act(async () => move([VELA_ASKS]));
    await settle();
    expect(transcripts.asked).toEqual(["sp-vela0001"]);
    expect($(".vf-chat-flow")?.getAttribute("data-flow-state")).toBe("ready");
    expect(words($('.vf-chat-flow [data-row="reply"]'))).toContain("The suite is green.");
    // a line said since: the worker's tail, drawn as it lands
    await act(async () =>
      transcripts.say(
        "sp-vela0001",
        "run-Vela",
        transcriptLine(3, "reply", "2026-10-31T05:29:00.000Z", {
          messageId: "m-2",
          text: "Pushed.",
        }),
      ),
    );
    await settle();
    expect(words($(".vf-chat-flow"))).toContain("Pushed.");
    // no pane, and no line: the head's one act, Jump to (TH-2), and the composer's buttons
    expect($(".vf-chat-pane")).toBeNull();
    expect($(".vf-chat-thread-line")).toBeNull();
    const buttons = [...(host?.querySelectorAll<HTMLElement>(".vf-chat-thread-head button") ?? [])];
    expect(buttons.map(words)).toEqual(["Jump to"]);
    expect($(".vf-chat-foot .vf-chat-composer")).not.toBeNull();
  });

  it("hangs a crew's card under its act line: a row's press shows that member's pane and says so, an Ended row takes none, and Open in Godview opens it (SP-1e2)", async () => {
    const { door, move } = scripted([VELA]);
    const transcripts = scriptedTranscripts();
    transcripts.keep(
      "sp-vela0001",
      [{ runtimeRunId: "run-Vela", startedAt: AT, fresh: true }],
      new Map([
        [
          "run-Vela",
          [
            transcriptLine(1, "run", AT, { runtimeRunId: "run-Vela", fresh: true }),
            transcriptLine(2, "act", "2026-10-31T05:20:00.000Z", {
              what: "crew",
              text: "Started 2 agents · Opus 5.5 · high",
              crew: "cr-000001",
            }),
          ],
        ],
      ]),
    );
    const member = { at: AT, agent: "claude", folder: "Vela", model: "Opus 5.5", effort: "high" };
    const frame = {
      spark: "sp-vela0001",
      crews: [
        {
          id: "cr-000001",
          sparkRun: "run-Vela",
          at: AT,
          members: [
            { runtimeRunId: "run-m1", ...member },
            { runtimeRunId: "run-m2", ...member, endedAt: AT, name: "Claude Code in Vela" },
          ],
        },
      ],
      waiting: [],
    };
    const asked: string[] = [];
    const crews: CrewsDoor = {
      watch: async (spark, onFrame) => {
        asked.push(spark);
        onFrame(frame);
        return () => undefined;
      },
      onReconnected: () => () => undefined,
    };
    const MEMBER = row({
      runtimeRunId: "run-m1",
      status: "working",
      turnedAt: AT,
      origin: { by: "spark", spark: "sp-vela0001", crew: "cr-000001" },
      terminal: { hosted: "local", runtimeSessionId: "pty-m1" },
      model: { id: "claude-opus-5-5", displayName: "Opus 5.5" },
      effort: { value: "high" },
    });
    stop = startSparksFeed(door);
    mount(<Chat transcripts={transcripts.door} crews={crews} />);
    await settle();
    await act(async () => move([VELA_ASKS, MEMBER]));
    await settle();
    expect(asked).toEqual(["sp-vela0001"]);
    const card = $('.vf-chat-flow [data-row="act"] .vf-crew-card');
    expect(card).not.toBeNull();
    const rows = [...(card?.querySelectorAll<HTMLElement>(".vf-crew-row") ?? [])];
    expect(rows.map((r) => r.dataset.state)).toEqual(["working", "ended"]);
    expect(rows[1]?.tagName).toBe("DIV");
    await act(async () => rows[0]?.click());
    await settle();
    expect(shown.opened.at(-1)?.row).toMatchObject({ id: "run-m1", floorSessionId: "pty-m1" });
    expect(noted.at(-1)).toBe("Jumped to its pane");
    await act(async () => card?.querySelector<HTMLElement>(".vf-crew-foot button")?.click());
    expect(views.asked).toEqual(["godview"]);
  });

  it("reads a thread's record only while Chat is the view, and lets a bubble go once the record shows its send (TH-1)", async () => {
    const { door } = scripted([VELA]);
    const transcripts = scriptedTranscripts();
    transcripts.keep(
      "sp-vela0001",
      [{ runtimeRunId: "run-Vela", startedAt: AT, fresh: true }],
      new Map([
        ["run-Vela", [transcriptLine(1, "run", AT, { runtimeRunId: "run-Vela", fresh: true })]],
      ]),
    );
    stop = startSparksFeed(door);
    mount(<Chat active={false} transcripts={transcripts.door} />);
    await settle();
    // another view: nothing is asked of fieldd
    expect(transcripts.asked).toEqual([]);
    act(() => root?.render(<Chat transcripts={transcripts.door} />));
    await settle();
    expect(transcripts.asked).toEqual(["sp-vela0001"]);
    // a send of this window's stands as its bubble until the record shows it, by its request id
    act(() =>
      standPendingSay("sp-vela0001", {
        requestId: "say-th1-row",
        text: "run the suite",
        chips: [],
        at: "2026-10-31T05:29:00.000Z",
        state: "queued",
      }),
    );
    await settle();
    expect(words($(".vf-chat-flow"))).toContain("run the suite");
    expect(pendingSaysNow("sp-vela0001")).toHaveLength(1);
    await act(async () =>
      transcripts.say(
        "sp-vela0001",
        "run-Vela",
        transcriptLine(2, "you", "2026-10-31T05:29:01.000Z", {
          via: "chat",
          text: "run the suite",
          input: "in-1",
          requestId: "say-th1-row",
          state: "queued",
        }),
      ),
    );
    await settle();
    expect(pendingSaysNow("sp-vela0001")).toEqual([]);
    // the record's bubble stands in its place, once
    expect(
      [...(host?.querySelectorAll(".vf-chat-flow .vf-chat-you") ?? [])].map((each) =>
        words(each as HTMLElement),
      ),
    ).toHaveLength(1);
    // another view again: nothing more is asked, and the thread keeps what it drew
    act(() => root?.render(<Chat active={false} transcripts={transcripts.door} />));
    await settle();
    expect(transcripts.asked).toEqual(["sp-vela0001"]);
    expect($(".vf-chat-flow")?.getAttribute("data-flow-state")).toBe("ready");
    expect(words($(".vf-chat-flow"))).toContain("run the suite");
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
    const velaFlow = $(".vf-chat-flow");
    expect(velaFlow).not.toBeNull();
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
    // the thread, and the flow drawn in it, stay Vela's: the same element, never Lyra's
    expect($(".vf-chat-thread")?.getAttribute("aria-label")).toBe("Vela's thread");
    expect($(".vf-chat-flow")).toBe(velaFlow);
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
    const counted: ComposerPort & Pick<NewSparkPort, "providers"> = {
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
    expect(words($(".vf-chat-thread-status"))).toBe("Asleep");
    expect(headActs()).toEqual([["Wake", "wake"]]);
    const lists = port.lists;
    port.listed = [{ ...KIWI, session: { runtimeRunId: "run-Kiwi2", live: true } }];
    await act(async () => headAct("wake")?.click());
    await settle();
    expect(port.woke).toEqual(["sp-kiwi0001"]);
    expect(port.lists).toBe(lists + 1);
    // awake: its head's act is Jump to, its conversation stands where it stood
    expect(headActs()).toEqual([["Jump to", "jump"]]);
    expect($(".vf-chat-flow")).not.toBeNull();
  });

  it("wakes a spark once: Send pressed while Wake's wake runs waits, busy, and asks for no second open (SP-1d)", async () => {
    const { port, door } = scripted([KIWI]);
    let answer: () => void = () => undefined;
    port.held = new Promise((resolve) => {
      answer = resolve;
    });
    // a Send into the asleep thread would wake the spark itself
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    await act(async () => headAct("wake")?.click());
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

  it("says a refused Wake in fieldd's words in the status's place, and keeps the act in the head (TH-1; TH-2)", async () => {
    const { port, door } = scripted([KIWI]);
    port.refuse = "the spark's agent has no sign-in";
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    await act(async () => headAct("wake")?.click());
    await settle();
    expect(port.woke).toEqual(["sp-kiwi0001"]);
    expect(words($(".vf-chat-thread-status"))).toBe(
      "Couldn't wake Kiwi: the spark's agent has no sign-in",
    );
    expect(headActs()).toEqual([["Wake", "wake"]]);
  });

  it("jumps to Vela's own session in Godview by Jump to's path, its row read at the press, and says so on the line (TH-2)", async () => {
    const { door, move } = scripted([VELA]);
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    await act(async () => move([{ ...VELA_ASKS, status: "idle", blockers: [] }]));
    await act(async () => headAct("jump")?.click());
    await settle();
    expect(shown.opened).toEqual([
      { row: { id: "run-Vela", floorSessionId: "pty-Vela" }, from: "assistant" },
    ]);
    expect(noted).toEqual(["Jumped to its pane"]);
    // a deck that could not show it is said in Jump to's words
    shown.outcome = { state: "refused", reason: "the deck did not open to show it" };
    await act(async () => headAct("jump")?.click());
    await settle();
    expect(noted).toEqual([
      "Jumped to its pane",
      "Could not jump — the deck did not open to show it",
    ]);
    // a run with no terminal on this desktop's floor is never said to be shown, and nothing moves
    await act(async () =>
      move([
        { ...VELA_ASKS, revision: 2, status: "idle", blockers: [], terminal: { hosted: "none" } },
      ]),
    );
    await act(async () => headAct("jump")?.click());
    await settle();
    expect(shown.opened).toHaveLength(2);
    expect(noted.at(-1)).toBe("Could not jump — its terminal is not on this desktop's floor");
  });

  it("jumps to Vela's own session when the board's row carries no join, as fieldd's agent.list puts it on this floor (item 187)", async () => {
    const { door, move } = scripted([VELA]);
    stop = startSparksFeed(door);
    const listed = runsDoor([
      listedRun({
        runtimeRunId: "run-Vela",
        terminal: { hosted: "local", runtimeSessionId: "pty-Vela" },
      }),
    ]);
    mount(<Chat runs={listed.door} />);
    await settle();
    // this desktop's terminal doors are not on the tailnet: fieldd's board withholds the join (TM-2 F-M4)
    await act(async () =>
      move([{ ...VELA_ASKS, status: "idle", blockers: [], terminal: undefined }]),
    );
    await act(async () => headAct("jump")?.click());
    await settle();
    expect(listed.asked).toEqual([["agent.list", {}]]);
    expect(shown.opened).toEqual([
      { row: { id: "run-Vela", floorSessionId: "pty-Vela" }, from: "assistant" },
    ]);
    expect(noted).toEqual(["Jumped to its pane"]);
  });

  it("pauses Vela's current turn through agent.pause once, and says what fieldd answered (TH-2; TH-Q3 (b))", async () => {
    const { port, door, move } = scripted([VELA]);
    stop = startSparksFeed(door);
    mount(<Chat />);
    await settle();
    const works = { ...VELA_ASKS, status: "working" as const, blockers: [], statusSince: AT };
    await act(async () => move([works]));
    let answer: (result: AgentInterruptResult) => void = () => undefined;
    port.pauseAnswer = new Promise((resolve) => {
      answer = resolve;
    });
    await act(async () => headAct("pause")?.click());
    expect(port.paused).toEqual(["run-Vela"]);
    expect(words(headAct("pause"))).toBe("Pausing current turn…");
    // a second press while it runs sends nothing
    await act(async () => headAct("pause")?.click());
    expect(port.paused).toEqual(["run-Vela"]);
    // accepted: delivered, not obeyed, so it stays pausing until the board says the turn stopped
    await act(async () => answer({ accepted: true }));
    await settle();
    expect(words(headAct("pause"))).toBe("Pausing current turn…");
    await act(async () =>
      move([
        {
          ...works,
          revision: 2,
          status: "idle",
          statusSince: "2026-10-31T05:29:02.000Z",
          stop: { sentAt: AT, stage: "heard", heardBy: "status" },
        },
      ]),
    );
    expect(headAct("pause")).toBeNull();
    // the next turn: Pause again, refused in fieldd's words, in the status's place
    port.pauseAnswer = Promise.resolve({ accepted: false, reason: "no-terminal-host" });
    await act(async () =>
      move([{ ...works, revision: 3, statusSince: "2026-10-31T05:30:00.000Z" }]),
    );
    await act(async () => headAct("pause")?.click());
    await settle();
    expect(port.paused).toEqual(["run-Vela", "run-Vela"]);
    expect(words($(".vf-chat-thread-status"))).toBe("Couldn't pause Vela's turn: no-terminal-host");
    // and never End run
    expect(words($(".vf-chat-thread"))).not.toContain("End run");
  });
});

describe("Chat's words are DESIGN.md's (§8 \"Chat's list\", \"Chat's thread\")", () => {
  it("says, in every state, exactly the words the canon records", () => {
    // the doc wraps its lines; a sentence is the same sentence across a wrap
    const here = dirname(fileURLToPath(import.meta.url));
    const design = readFileSync(join(here, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");
    for (const said of [
      // the night (track ES, 2026-11-08; "No sparks yet" retired on the Mac)
      "Make your first spark",
      "A spark is an agent VibeField starts to run your other agents.",
      "Or give it a first job",
      "A spark thinks with Claude Code, which isn't on this Mac yet.",
      "Open Agents settings",
      "Opening Chat…",
      "Chat can't read your sparks",
      "Vela needs you",
      "Waking…",
      "Couldn't wake Vela: …",
      // the head's act (TH-2)
      '"Jump to" ("Jump to Vela\'s pane")',
      "Jumped to its pane",
      "Could not jump — …",
      "Pause current turn",
      "Pausing current turn…",
      "Couldn't pause Vela's turn: …",
      STILL_RUNNING,
      // a row's lasting mark, after its status word (SP-1d)
      `"Asleep, ${THREAD_MARK_WORDS.needs}"`,
      `"Ready, ${THREAD_MARK_WORDS.unread}"`,
    ]) {
      expect(design, said).toContain(said);
    }
  });
});

describe('Chat, empty: the night, live (track ES; DESIGN.md §8 "Chat\'s list", Empty: the night)', () => {
  it("stands the night while the feed holds no spark, reads which agents can be a spark only then, opens the sheet from New spark and from a first job, and gives way to the list when a spark comes", async () => {
    const { port, door, move } = scripted([]);
    stop = startSparksFeed(door);
    let reads = 0;
    const surfaces: (FrameSurface | null)[] = [];
    const counted = {
      ...PORT,
      providers: async () => {
        reads += 1;
        return SPARKING_HERE;
      },
    };
    mount(<Chat port={counted} onSurface={(next) => surfaces.push(next)} />);
    await settle();
    expect($(".vf-chat-empty")).not.toBeNull();
    expect(reads).toBe(1);
    const create = $(".vf-chat-empty-new") as HTMLButtonElement | null;
    expect(create?.disabled).toBe(false);
    act(() => create?.click());
    // a first job opens the same sheet (ES-D2 A: from ES-2 the sheet carries it)
    act(() => host?.querySelector<HTMLElement>(".vf-chat-empty .vf-chat-starter")?.click());
    expect(surfaces).toEqual(["new-spark", "new-spark"]);
    // the first spark: its record is read, and the list stands where the night was
    port.listed = [VELA];
    await act(async () =>
      move([row({ runtimeRunId: "run-Vela", spark: "sp-vela0001", status: "working" })]),
    );
    await settle();
    expect($(".vf-chat-empty")).toBeNull();
    expect(rows().map((r) => r.dataset.spark)).toEqual(["sp-vela0001"]);
  });

  it("hands the frame a first job as it opens the sheet, and New spark none (ES-2; ES-D2 A: the sheet carries it)", async () => {
    const { door } = scripted([]);
    stop = startSparksFeed(door);
    const carried: (Starter | null)[] = [];
    const surfaces: (FrameSurface | null)[] = [];
    mount(
      <Chat onSurface={(next) => surfaces.push(next)} onFirstJob={(job) => carried.push(job)} />,
    );
    await settle();
    act(() => ($(".vf-chat-empty-new") as HTMLButtonElement | null)?.click());
    act(() => host?.querySelectorAll<HTMLElement>(".vf-chat-empty .vf-chat-starter")[2]?.click());
    // ES-4: filled from this Mac, as the night shows it: Claude Code alone here and nothing on the board, so the
    // reviewer is Claude Code and the run keeps its ruled word
    expect(carried).toEqual([
      null,
      {
        glyph: STARTERS[2]?.glyph,
        words: "Have Claude Code review claude·2's work until it's clean",
      },
    ]);
    expect(surfaces).toEqual(["new-spark", "new-spark"]);
  });

  it('fills its jobs from this Mac: the agents it has and the board\'s runs (ES-4; §8, the jobs, "Filled from this Mac")', async () => {
    const { door, move } = scripted([]);
    stop = startSparksFeed(door);
    const ids = ["claude", "codex", "grok"];
    const here = {
      ...PORT,
      providers: async () =>
        AGENT_CATALOG.filter((entry) => ids.includes(entry.id)).map(
          (entry): AgentProviderSummary => ({
            id: entry.id,
            label: entry.label,
            available: true,
            resumable: true,
            personas: [],
            offers: { spawn: true, spark: entry.offers.spark },
          }),
        ),
    };
    mount(<Chat port={here} />);
    await act(async () =>
      move([
        row({
          runtimeRunId: "r-1",
          lastActivityAt: "2026-10-31T05:10:00.000Z",
          project: { name: "ice" },
        }),
        row({
          runtimeRunId: "r-2",
          lastActivityAt: "2026-10-31T05:20:00.000Z",
          project: { name: "ice" },
        }),
      ]),
    );
    await settle();
    const jobs = [
      ...(host?.querySelectorAll<HTMLElement>(".vf-chat-empty .vf-chat-starter") ?? []),
    ];
    expect(jobs.map((job) => words(job))).toEqual([
      "Spawn 4 Grok agents to research a topic each",
      "Keep track of my agents in ice",
      "Have Codex review claude·2's work until it's clean",
    ]);
    expect(jobs.every((job) => job.dataset.held === undefined)).toBe(true);
  });

  it("holds its jobs in their places, wordless, while this Mac's agents are read (ES-4)", async () => {
    const { door } = scripted([]);
    stop = startSparksFeed(door);
    const waiting = {
      ...PORT,
      providers: () => new Promise<AgentProviderSummary[]>(() => undefined),
    };
    mount(<Chat port={waiting} />);
    await settle();
    const jobs = [
      ...(host?.querySelectorAll<HTMLElement>(".vf-chat-empty .vf-chat-starter") ?? []),
    ];
    expect(jobs).toHaveLength(3);
    expect(jobs.every((job) => job.dataset.held === "true")).toBe(true);
  });

  it("is Off when no agent here can be a spark, its sentence naming the one that can, and Open Agents settings asks the window's Settings for Agents", async () => {
    const { door } = scripted([]);
    stop = startSparksFeed(door);
    const asked: string[] = [];
    const none = {
      ...PORT,
      providers: async () => SPARKING_HERE.map((agent) => ({ ...agent, available: false })),
    };
    mount(<Chat port={none} onOpenAgents={() => asked.push("agents")} />);
    await settle();
    expect(($(".vf-chat-empty-new") as HTMLButtonElement | null)?.disabled).toBe(true);
    expect(words($(".vf-chat-empty-why"))).toBe(
      `A spark thinks with ${SPARK_ROW?.label}, which isn't on this Mac yet.`,
    );
    act(() => $(".vf-chat-empty-agents")?.click());
    expect(asked).toEqual(["agents"]);
  });

  it("reads the agents again as the window takes focus back while it is Off: one installed meanwhile turns New spark on, and a live night reads nothing more", async () => {
    const { door } = scripted([]);
    stop = startSparksFeed(door);
    let installed = false;
    let reads = 0;
    const later = {
      ...PORT,
      providers: async () => {
        reads += 1;
        return SPARKING_HERE.map((agent) => ({ ...agent, available: installed }));
      },
    };
    mount(<Chat port={later} />);
    await settle();
    expect(($(".vf-chat-empty-new") as HTMLButtonElement | null)?.disabled).toBe(true);
    // Open Agents settings, then a terminal: the agent is installed while the window is away
    installed = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle();
    expect(reads).toBe(2);
    expect(($(".vf-chat-empty-new") as HTMLButtonElement | null)?.disabled).toBe(false);
    expect($(".vf-chat-empty-why")).toBeNull();
    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle();
    expect(reads).toBe(2);
  });

  it("never reads the agents while Chat holds a spark", async () => {
    const { door } = scripted([VELA]);
    stop = startSparksFeed(door);
    let reads = 0;
    const counted = {
      ...PORT,
      providers: async () => {
        reads += 1;
        return SPARKING_HERE;
      },
    };
    mount(<Chat port={counted} />);
    await settle();
    expect($(".vf-chat-empty")).toBeNull();
    expect(reads).toBe(0);
  });
});
