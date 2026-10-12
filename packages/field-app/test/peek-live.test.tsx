// @vitest-environment happy-dom
/**
 * Live now — the Peek's live half (P2; DESIGN.md §8 "Search — the Peek"; One
 * Frame §23, GV-D3/D8/D9). Four pieces, each on its own:
 *
 *   · THE FIND DOOR (`find-door.ts`): Godview's monitor publishes its live
 *     rows, rosetta's port, its select and its filters; the frame reads them,
 *     waits (bounded) for them, and names the filter the button wears.
 *   · THE ORCHESTRATION (`use-live-find.ts`) — FindSheet's, rewritten on
 *     puppeteer's exported find model: one debounced ask per pause, numbered so
 *     a late answer to an older ask is dropped, an unanswered ask keeping the
 *     hits the last answer showed, and the facts asked again every 30 s.
 *   · THE ROWS AND WORDS (`peek-live.ts`): the kit's order and sentences.
 *   · OPENING A ROW (`live-open.ts`): Godview's select; from History, Jump to's
 *     reveal on the floor session, and a peer's run selected through the door.
 */
import type {
  FindRow,
  HistoryPort,
  HistorySearchRequest,
  HistorySearchResponse,
} from "@vibecook/puppeteer-views";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterToken,
  type GodviewFindDoor,
  getGodviewFindDoor,
  type LiveFilters,
  type LiveFindAgent,
  NO_LIVE_FILTERS,
  publishGodviewFindDoor,
  resetGodviewFindDoorForTest,
  whenGodviewFindDoor,
} from "../src/frame/find-door";
import type { LineViewDoor } from "../src/frame/line-door";
import { LIVE_OPEN_WAIT_MS, type LiveOpenDoors, openLiveRow } from "../src/frame/live-open";
import { PeekView } from "../src/frame/PeekView";
import {
  liveFoot,
  liveIndexWords,
  liveNone,
  type PeekLiveRow,
  peekLiveRows,
} from "../src/frame/peek-live";
import { NO_PEEK_FILTERS } from "../src/frame/peek-model";
import { LIVE_FACTS_REFRESH_MS, type LiveFind, useLiveFind } from "../src/frame/use-live-find";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const CHECKED_AT = "2026-10-09T12:00:00.000Z";

function run(
  id: string,
  extra: Partial<LiveFindAgent> & { native?: string; provider?: string } = {},
): LiveFindAgent {
  const { native, provider, ...rest } = extra;
  return {
    id,
    createdAtMs: NOW - 60_000,
    status: "working",
    project: id,
    detail: "",
    color: "#000",
    desk: { id: "here", name: "MacBook Pro", os: "macos", self: true },
    ...(provider === undefined
      ? {}
      : {
          agent: {
            provider: { id: provider, label: provider === "claude" ? "Claude Code" : provider },
            ...(native === undefined ? {} : { nativeSessionId: native }),
          },
        }),
    ...rest,
  };
}

const READY = { reachable: true, readiness: "ready" as const, checkedAt: CHECKED_AT };

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  resetGodviewFindDoorForTest();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe("the find door (`find-door.ts`)", () => {
  const door = (filters: LiveFilters = NO_LIVE_FILTERS): GodviewFindDoor => ({
    rows: () => [],
    subscribeRows: () => () => undefined,
    holdKeys: () => () => undefined,
    viewHoldsKeys: () => false,
    transcripts: {
      status: async () => READY,
      facts: async () => [],
      search: async () => ({ status: READY, answered: true, hits: [], clipped: false }),
    },
    select: vi.fn(),
    filters,
    setDesk: vi.fn(),
    setProfile: vi.fn(),
  });

  it("publishes, reads, and waits — bounded — for the monitor to publish", async () => {
    expect(getGodviewFindDoor()).toBeNull();
    vi.useFakeTimers();
    const none = whenGodviewFindDoor(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(none).resolves.toBeNull();
    const waiting = whenGodviewFindDoor(5_000);
    const published = door();
    publishGodviewFindDoor(published);
    await expect(waiting).resolves.toBe(published);
    expect(getGodviewFindDoor()).toBe(published);
    await expect(whenGodviewFindDoor(0)).resolves.toBe(published);
  });

  it("names the filter the button wears: the desktop, the profile, both — or none", () => {
    const desks = [
      {
        id: "here",
        name: "MacBook Pro",
        os: "macos" as const,
        here: true,
        note: "2 agents",
        quiet: false,
      },
      {
        id: "studio",
        name: "studio",
        os: "linux" as const,
        here: false,
        note: "1 agent",
        quiet: false,
      },
    ];
    const profiles = [
      { id: "native", label: "This Mac" },
      { id: "work", label: "Work" },
    ];
    expect(filterToken({ desks, desk: null, profiles, profile: null })).toBeNull();
    expect(filterToken({ desks, desk: "studio", profiles, profile: null })).toEqual({
      desk: desks[1],
      profile: null,
    });
    expect(filterToken({ desks, desk: "studio", profiles, profile: "work" })).toEqual({
      desk: desks[1],
      profile: profiles[1],
    });
    // a choice the lists no longer hold names nothing (it fell back to all)
    expect(filterToken({ desks: [], desk: "gone", profiles: [], profile: "gone" })).toBeNull();
  });
});

describe("the rows and the words (`peek-live.ts`)", () => {
  const found = (agent: LiveFindAgent, hits = 0, title?: string): FindRow<LiveFindAgent> => ({
    agent,
    ...(title === undefined ? {} : { title }),
    factsScore: 0,
    matched: [],
    hits: Array.from({ length: hits }, (_, index) => ({
      sessionId: `s-${agent.id}`,
      timelineId: `t-${agent.id}-${index}`,
      kind: index % 2 === 0 ? "user" : "agent",
      at: NOW - index * 1_000,
      snippet: `the [word] ${index}`,
    })),
    score: 0,
    lastActiveMs: NOW,
  });

  it("orders by lines matched, then waiting → working → idle → shell, find's rank breaking the rest", () => {
    const idle = run("idle", { status: "idle", provider: "claude" });
    const blocked = run("blocked", { status: "blocked", provider: "codex" });
    const working = run("working", { provider: "claude" });
    const hit = run("hit", { status: "idle", provider: "claude" });
    const rows = peekLiveRows(
      [found(idle), found(working), found(blocked), found(hit, 2, "Ask about words")],
      [idle, working, blocked, hit],
      "word",
    );
    expect(rows.map((row) => row.id)).toEqual(["hit", "blocked", "working", "idle"]);
    const first = rows[0] as PeekLiveRow;
    expect(first.title).toBe("Ask about words");
    expect(first.when).toBe("idle");
    expect(first.agent).toBe("Claude Code");
    expect(first.lines.map((line) => line.who)).toEqual(["you", "agent"]);
    expect(rows[1]?.when).toBe("waiting");
  });

  it("before a word lists every live session — the bare shells, which find's model leaves out, last", () => {
    const shell = run("pty-1", { project: "" });
    const agent = run("claude-1", { provider: "claude" });
    const rows = peekLiveRows([found(agent)], [shell, agent], "");
    expect(rows.map((row) => [row.id, row.state, row.title, row.agent])).toEqual([
      ["claude-1", "working", "claude-1", "Claude Code"],
      ["pty-1", "shell", "Terminal", "shell"],
    ]);
    // with words, a shell is listed only when its facts hold them (find's rule)
    expect(peekLiveRows([found(agent)], [shell, agent], "x").map((row) => row.id)).toEqual([
      "claude-1",
    ]);
  });

  it("says where a peer's run runs, and names this desktop's floor session", () => {
    const peer = run("peer", {
      provider: "codex",
      desk: { id: "studio", name: "studio", os: "linux", self: false },
    });
    const own = run("own", { provider: "claude", floorSessionId: "pty-7" });
    const [ownRow, peerRow] = peekLiveRows([found(own), found(peer)], [own, peer], "");
    expect(ownRow?.remote).toBeNull();
    expect(ownRow?.floorSessionId).toBe("pty-7");
    expect(peerRow?.remote).toEqual({ name: "studio", os: "linux" });
    expect(peerRow?.floorSessionId).toBeNull();
  });

  it("the foot and the empty body, in the kit's words — and honest while the feed is out", () => {
    const rows = peekLiveRows([found(run("a", { provider: "claude" }), 2)], [], "word");
    const base = {
      feed: { kind: "live" as const },
      status: READY,
      searching: false,
      answered: true,
      clipped: false,
    };
    expect(liveFoot({ ...base, query: "", rows: [] })).toBe("Nothing runs right now");
    expect(liveFoot({ ...base, query: "", rows })).toBe("1 live session, waiting first");
    expect(liveFoot({ ...base, query: "word", rows })).toBe("1 session · 2 lines matched");
    expect(liveFoot({ ...base, query: "word", rows, searching: true, answered: false })).toBe(
      "1 session · 2 lines matched · searching",
    );
    expect(liveFoot({ ...base, query: "word", rows, answered: false })).toBe(
      "1 session · 2 lines matched · the words were not searched",
    );
    expect(liveFoot({ ...base, query: "word", rows, clipped: true })).toBe(
      "1 session · 2 lines matched · the first page only — narrow the search",
    );
    expect(
      liveFoot({
        ...base,
        query: "",
        rows,
        status: { reachable: false, detail: "no deck", checkedAt: CHECKED_AT },
      }),
    ).toBe("1 live session, waiting first · transcript search off — no deck");
    expect(liveFoot({ ...base, feed: { kind: "connecting" }, query: "", rows: [] })).toBe(
      "Asking what runs…",
    );
    expect(
      liveFoot({
        ...base,
        feed: { kind: "unavailable", reason: "fieldd refused" },
        query: "",
        rows,
      }),
    ).toBe("What runs could not be read — fieldd refused");
    expect(
      liveIndexWords({ ...READY, readiness: "building", progress: { done: 2, total: 5 } }),
    ).toBe("indexing · 40%");
    expect(liveNone({ kind: "live" }, "word", false)).toBe(
      "No live session holds every word of “word”.",
    );
    expect(liveNone({ kind: "live" }, "", true)).toBe("Nothing the filters keep runs right now.");
    expect(liveNone({ kind: "connecting" }, "word", false)).toBeNull();
  });
});

describe("the orchestration (`use-live-find.ts`, FindSheet's on the exported model)", () => {
  interface Asked {
    request: HistorySearchRequest;
    answer(response: Partial<HistorySearchResponse>): void;
    fail(): void;
  }

  function scriptedHistory(): {
    port: HistoryPort;
    asked: Asked[];
    facts: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  } {
    const asked: Asked[] = [];
    const facts = vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        nativeSessionId: id,
        sessionId: `rs-${id}`,
        rootSessionId: `rs-${id}`,
        title: `Title of ${id}`,
        updatedAt: NOW,
        streamState: "live",
      })),
    );
    const status = vi.fn(async () => READY);
    return {
      asked,
      facts,
      status,
      port: {
        status,
        facts,
        search: (request) =>
          new Promise((resolve, reject) => {
            asked.push({
              request,
              answer: (response) =>
                resolve({ status: READY, answered: true, hits: [], clipped: false, ...response }),
              fail: () => reject(new Error("refused")),
            });
          }),
      },
    };
  }

  let latest: LiveFind | null = null;
  function Probe(props: {
    active: boolean;
    runs: readonly LiveFindAgent[];
    history: HistoryPort;
    query: string;
  }): ReactElement | null {
    latest = useLiveFind({ ...props, now: () => NOW });
    return null;
  }

  async function render(props: Parameters<typeof Probe>[0]): Promise<void> {
    if (root === null) {
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
    }
    await act(async () => root?.render(<Probe {...props} />));
  }

  const RUNS = [
    run("a", { provider: "claude", native: "native-a" }),
    run("b", { provider: "codex", native: "native-b" }),
  ];
  const hit = (native: string, timelineId: string) => ({
    sessionId: `rs-${native}`,
    rootSessionId: `rs-${native}`,
    nativeSessionId: native,
    timelineId,
    kind: "user",
    at: NOW,
    snippet: "a [word]",
  });

  it("asks once per pause in the typing (Find's 120 ms), scoped to the live runs", async () => {
    vi.useFakeTimers();
    const history = scriptedHistory();
    await render({ active: true, runs: RUNS, history: history.port, query: "" });
    for (const query of ["w", "wo", "wor", "word"]) {
      await render({ active: true, runs: RUNS, history: history.port, query });
      await act(async () => vi.advanceTimersByTimeAsync(60));
    }
    expect(history.asked).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(history.asked).toHaveLength(1);
    expect(history.asked[0]?.request).toMatchObject({
      query: "word",
      nativeSessionIds: ["native-a", "native-b"],
      prefix: true,
    });
    expect(latest?.searching).toBe(true);
    await act(async () => history.asked[0]?.answer({ hits: [hit("native-b", "t1")] }));
    expect(latest?.searching).toBe(false);
    expect(latest?.found.map((row) => [row.agent.id, row.hits.length])).toEqual([["b", 1]]);
  });

  it("numbers its asks: a late answer to an older ask never lands over the newer one", async () => {
    vi.useFakeTimers();
    const history = scriptedHistory();
    await render({ active: true, runs: RUNS, history: history.port, query: "first" });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await render({ active: true, runs: RUNS, history: history.port, query: "second" });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(history.asked.map((ask) => ask.request.query)).toEqual(["first", "second"]);
    await act(async () => history.asked[1]?.answer({ hits: [hit("native-a", "t2")] }));
    await act(async () => history.asked[0]?.answer({ hits: [hit("native-b", "t1")] }));
    expect(latest?.found.flatMap((row) => row.hits.map((each) => each.timelineId))).toEqual(["t2"]);
  });

  it("keeps the last answer's hits when an ask goes unanswered, and says it was not answered", async () => {
    vi.useFakeTimers();
    const history = scriptedHistory();
    await render({ active: true, runs: RUNS, history: history.port, query: "word" });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => history.asked[0]?.answer({ hits: [hit("native-a", "t1")] }));
    await render({ active: true, runs: RUNS, history: history.port, query: "words" });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => history.asked[1]?.answer({ answered: false, hits: [] }));
    expect(latest?.answered).toBe(false);
    expect(latest?.found.flatMap((row) => row.hits.map((each) => each.timelineId))).toEqual(["t1"]);
    // and a refused ask keeps them too
    await render({ active: true, runs: RUNS, history: history.port, query: "wordy" });
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => history.asked[2]?.fail());
    expect(latest?.answered).toBe(false);
    expect(latest?.found.flatMap((row) => row.hits.map((each) => each.timelineId))).toEqual(["t1"]);
  });

  it("asks the titles while it shows and every 30 s after — and nothing while it does not", async () => {
    vi.useFakeTimers();
    const history = scriptedHistory();
    await render({ active: false, runs: RUNS, history: history.port, query: "" });
    await act(async () => vi.advanceTimersByTimeAsync(LIVE_FACTS_REFRESH_MS * 2));
    expect(history.facts).not.toHaveBeenCalled();
    expect(history.status).not.toHaveBeenCalled();
    await render({ active: true, runs: RUNS, history: history.port, query: "" });
    expect(history.facts).toHaveBeenCalledTimes(1);
    expect(history.facts).toHaveBeenLastCalledWith(["native-a", "native-b"]);
    // the transcript's title names the row
    expect(latest?.found.map((row) => row.title)).toEqual([
      "Title of native-a",
      "Title of native-b",
    ]);
    await act(async () => vi.advanceTimersByTimeAsync(LIVE_FACTS_REFRESH_MS));
    expect(history.facts).toHaveBeenCalledTimes(2);
    await render({ active: false, runs: RUNS, history: history.port, query: "" });
    await act(async () => vi.advanceTimersByTimeAsync(LIVE_FACTS_REFRESH_MS * 3));
    expect(history.facts).toHaveBeenCalledTimes(2);
  });
});

describe("opening a live row (`live-open.ts`)", () => {
  function doors(): LiveOpenDoors & {
    requested: string[];
    reveal: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  } {
    const requested: string[] = [];
    const reveal = vi.fn(async () => ({ state: "opened" as const }));
    const select = vi.fn();
    const find = { select } as unknown as GodviewFindDoor;
    return {
      requested,
      reveal,
      select,
      requestView: (view) => requested.push(view),
      whenGodviewCanPlace: async () => ({ reveal }) as unknown as LineViewDoor,
      whenGodviewFindDoor: async () => find,
      godviewFindDoor: () => find,
    };
  }
  const row = (floorSessionId: string | null): PeekLiveRow => {
    const [made] = peekLiveRows(
      [
        {
          agent: run("row-1", { provider: "claude" }),
          factsScore: 0,
          matched: [],
          hits: [],
          score: 0,
          lastActiveMs: NOW,
        },
      ],
      [],
      "",
    );
    if (made === undefined) throw new Error("no row");
    return { ...made, floorSessionId };
  };

  it("in Godview, the view's own select — nothing else asked", async () => {
    const at = doors();
    await expect(openLiveRow(row("pty-1"), "godview", at)).resolves.toEqual({ state: "shown" });
    expect(at.select).toHaveBeenCalledExactlyOnceWith("row-1");
    expect(at.requested).toEqual([]);
    expect(at.reveal).not.toHaveBeenCalled();
  });

  it("from History, Jump to's path: Godview asked for, and the deck reveals the floor session", async () => {
    const at = doors();
    await expect(openLiveRow(row("pty-1"), "history", at)).resolves.toEqual({ state: "shown" });
    expect(at.requested).toEqual(["godview"]);
    expect(at.reveal).toHaveBeenCalledExactlyOnceWith("pty-1");
    expect(at.select).not.toHaveBeenCalled();
  });

  it("from History, a peer's run (no floor session here) is selected through Godview's door", async () => {
    const at = doors();
    await expect(openLiveRow(row(null), "history", at)).resolves.toEqual({ state: "shown" });
    expect(at.requested).toEqual(["godview"]);
    expect(at.select).toHaveBeenCalledExactlyOnceWith("row-1");
  });

  it("says why when nothing could show it", async () => {
    const at = { ...doors(), whenGodviewCanPlace: async () => null, godviewFindDoor: () => null };
    await expect(openLiveRow(row("pty-1"), "history", at)).resolves.toEqual({
      state: "refused",
      reason: "the deck did not open to show it",
    });
    await expect(openLiveRow(row("pty-1"), "godview", at)).resolves.toEqual({
      state: "refused",
      reason: "Godview is not showing its runs",
    });
  });

  it("from History, a deck that never shows it is refused in Jump to's words once the bound passes (2026-10-11)", async () => {
    // Jump to's path, and Jump to's bound: the deck's mounts wait their turn
    // (AR-4b), and a turn that never ends is said, never waited on
    const at = {
      ...doors(),
      whenGodviewCanPlace: async () =>
        ({ reveal: () => new Promise(() => undefined) }) as unknown as LineViewDoor,
    };
    const STILL_WAITING = { state: "still waiting" } as const;
    vi.useFakeTimers();
    try {
      const opening = openLiveRow(row("pty-1"), "history", at);
      await vi.advanceTimersByTimeAsync(LIVE_OPEN_WAIT_MS + 1_000);
      expect(await Promise.race([opening, Promise.resolve(STILL_WAITING)])).toEqual({
        state: "refused",
        reason: "no pane showed it in 20 s",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Live now's chrome pieces each stand alone (MV-8b)", () => {
  it("a live peek that throws says so where it stood; the rows and the filters stay", async () => {
    const [row] = peekLiveRows(
      [
        {
          agent: run("row-1", { provider: "claude", floorSessionId: "pty-1" }),
          factsScore: 0,
          matched: [],
          hits: [],
          score: 0,
          lastActiveMs: NOW,
        },
      ],
      [],
      "",
    );
    if (row === undefined) throw new Error("no row");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host, { onCaughtError: () => undefined });
    const props = {
      open: true,
      keys: "mac" as const,
      view: "godview" as const,
      layout: { width: 900, height: 560, folded: false },
      query: "",
      scope: "live" as const,
      filters: NO_PEEK_FILTERS,
      projects: [],
      agents: [],
      liveFilters: {
        desks: [
          {
            id: "a",
            name: "here",
            os: "macos" as const,
            here: true,
            note: "1 agent",
            quiet: false,
          },
          {
            id: "b",
            name: "studio",
            os: "linux" as const,
            here: false,
            note: "0 agents",
            quiet: false,
          },
        ],
        desk: null,
        profiles: [],
        profile: null,
      },
      rows: [row],
      hot: 0,
      foot: "1 live session, waiting first",
      none: null,
      menu: null,
      onQuery: () => undefined,
      onScope: () => undefined,
      onMenu: () => undefined,
      onFilters: () => undefined,
      onOpen: () => undefined,
      onClose: () => undefined,
    };
    await act(async () =>
      root?.render(
        <PeekView
          {...props}
          renderLive={() => {
            throw new Error("the pane could not be drawn");
          }}
        />,
      ),
    );
    const said = [...(host.querySelectorAll('span[role="status"]') ?? [])].map(
      (span) => span.textContent,
    );
    expect(said).toContain("Live peek unavailable");
    expect(host.querySelectorAll('.vf-peek-row[data-kind="live"]')).toHaveLength(1);
    expect(host.querySelector('[data-peek-dd="desk"]')).not.toBeNull();
  });
});
