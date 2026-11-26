// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentLastRunResult, AgentModelMeshOpen } from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// LR (James, 2026-10-15) — what the last run left: the window's question, its
// arithmetic, its still picture, and the curtain that asks it.

const adopted: unknown[] = [];
vi.mock("../src/terminal/pool", () => ({
  adoptCreatedTerminal: (raw: unknown) => {
    adopted.push(raw);
    const sessionId = (raw as { sessionId: string }).sessionId;
    return { sessionId, session: { id: sessionId } };
  },
  // the pool publishes on every roster read, as the real one does, whether or not it moved
  refreshTerminalRoster: async () => {
    const read = await rosterRead();
    poolMoved();
    return read;
  },
  subscribeTerminalPool: (listener: () => void) => {
    poolListeners.add(listener);
    return () => poolListeners.delete(listener);
  },
  terminalPoolSnapshot: () => ({ rosterState: rosterState, roster }),
}));
const poolListeners = new Set<() => void>();
function poolMoved(): void {
  for (const listener of [...poolListeners]) listener();
}
let roster: Array<{ sessionId: string; health: string }> = [];
let rosterState = "observed";
/** the roster read itself: a row may hold it, as a slow fieldd would */
let rosterRead: () => Promise<typeof roster> = async () => roster;

const {
  agentPaneLeft,
  askLastRun,
  composeLastRun,
  consentFacts,
  deckAnswer,
  dismissLastRun,
  lastRunState,
  pictureOpen,
  refreshLastRun,
  rereadLastRun,
  resetLastRunForTests,
  restoreLastRun,
  resumedPaneSession,
  startCleanLastRun,
  stillBoardPort,
} = await import("../src/godview/last-run");
const { answerLine, eyebrow, LastRunCurtain } = await import("../src/godview/LastRunCurtain");
const { setRendererLogger } = await import("../src/logging");

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
/** a running agent `run-studio-q` on `pty-s9`, a bare shell `pty-s4` */
const LEFT = AgentLastRunResult.parse(
  JSON.parse(readFileSync(join(FIXTURES, "agent-last-run.left.json"), "utf8")),
);
const SPAWNED = JSON.parse(readFileSync(join(FIXTURES, "agent-spawn.valid.json"), "utf8")) as {
  terminal: { sessionId: string };
};
const DECK_STORAGE_KEY = "vf-godview-deck-v1";
if (LEFT.state !== "left") throw new Error("fixture");
/** LR, 2026-11-25 — the same picture once Chat (or History) resumed the agent elsewhere: its
 * record is no longer the last run's to continue, so fieldd's gone list holds the shell alone */
const RESUMED_ELSEWHERE = { ...LEFT, gone: LEFT.gone.filter((row) => row.kind === "terminal") };
/** the picture with a second agent, `run-two` on `pty-s10`, left beside the first */
const AGENT_ROW = LEFT.board.rows.find((row) => row.runtimeRunId === "run-studio-q");
if (AGENT_ROW === undefined || AGENT_ROW.terminal === undefined) throw new Error("fixture");
const TWO_AGENTS = {
  ...LEFT,
  board: {
    ...LEFT.board,
    rows: [
      ...LEFT.board.rows,
      {
        ...AGENT_ROW,
        runtimeRunId: "run-two",
        terminal: { ...AGENT_ROW.terminal, runtimeSessionId: "pty-s10" },
      },
    ],
  },
  gone: [...LEFT.gone, { id: "run-two", kind: "agent" as const, sessionId: "pty-s10" }],
};

function saveLayout(ids: string[]): void {
  const leaf = (id: string, index: number) => ({
    kind: "pane",
    id: `pane-${index}`,
    sessionId: id,
  });
  const root =
    ids.length === 1
      ? leaf(ids[0] as string, 0)
      : { kind: "split", first: leaf(ids[0] as string, 0), second: leaf(ids[1] as string, 1) };
  localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify({ version: 1, root }));
}

/** fieldd as the window's client: scripted answers, every call kept. */
function client(answers: Record<string, (params: unknown) => Promise<unknown>>) {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    request: (method: string, params: Record<string, unknown>): Promise<unknown> => {
      calls.push([method, params]);
      const answer = answers[method];
      // a door this fieldd does not have is refused as fieldd refuses one
      return answer !== undefined
        ? answer(params)
        : Promise.reject(
            Object.assign(new Error(`no method ${method}`), { kind: "METHOD_NOT_FOUND" }),
          );
    },
  };
}

beforeEach(() => {
  setRendererLogger({
    child: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }),
  } as never);
  resetLastRunForTests();
  localStorage.clear();
  adopted.length = 0;
  roster = [];
  rosterState = "observed";
  rosterRead = async () => roster;
});

describe("LR — the question, as arithmetic", () => {
  it("counts the agents to resume, the deck's dead shells, and the shells that cannot come back", () => {
    // the agent's pane and one shell pane were saved; the bare shell `pty-s4` had none
    const question = composeLastRun(LEFT, ["pty-s9", "pane-shell"], new Set());
    expect(question?.agents).toEqual([
      { id: "run-studio-q", sessionId: "pty-s9", name: "Claude Code in vibe-field" },
    ]);
    expect(question?.shells, "the agent's own pane is the agent's, not a shell").toBe(1);
    expect(question?.unplaced).toBe(1);
    expect(question?.asOf).toBe(LEFT.state === "left" ? LEFT.asOf : undefined);
  });

  it("asks nothing when nothing a restore could bring back was lost", () => {
    expect(composeLastRun({ state: "none" }, [], null)).toBeNull();
    // only a bare shell with no pane: drawn, never restorable — nothing to ask
    if (LEFT.state !== "left") throw new Error("fixture");
    const shellOnly = { ...LEFT, gone: LEFT.gone.filter((row) => row.kind === "terminal") };
    expect(composeLastRun(shellOnly, [], new Set())).toBeNull();
  });

  it("calls no saved pane dead on a roster it could not read (GT-3's rule)", () => {
    expect(composeLastRun(null, ["a", "b"], null)).toBeNull();
    expect(composeLastRun(null, ["a", "b"], new Set(["a"]))?.shells).toBe(1);
  });

  it("counts a pane saved twice once", () => {
    expect(composeLastRun(null, ["a", "a"], new Set())?.shells).toBe(1);
  });

  // LR, 2026-11-25 — the gate over live sessions: the spark Chat woke was counted "1 terminal"
  it("never counts an agent's pane as a terminal, when its agent is no longer gone", () => {
    const question = composeLastRun(RESUMED_ELSEWHERE, ["pty-s9", "pane-shell"], new Set());
    expect(question?.agents).toEqual([]);
    expect(question?.shells, "an agent's pane is the agent's, never a terminal").toBe(1);
  });

  it("asks nothing when the only dead pane showed an agent that is no longer gone", () => {
    expect(composeLastRun(RESUMED_ELSEWHERE, ["pty-s9"], new Set())).toBeNull();
  });
});

describe("LR — the still picture", () => {
  it("is the window's one door's open, every row on its own desktop, live", async () => {
    if (LEFT.state !== "left") throw new Error("fixture");
    const open = pictureOpen(LEFT.board, LEFT.asOf);
    expect(AgentModelMeshOpen.safeParse(open).success).toBe(true);
    expect(open.devices).toHaveLength(1);
    expect(open.devices[0]).toMatchObject({ device: "dev-01HQ9S7UD1", state: "live" });
    const port = stillBoardPort(open);
    const frames: unknown[] = [];
    const subscribed = await port.subscribe((frame) => frames.push(frame));
    expect(subscribed.snapshot).toBe(open);
    subscribed.unsubscribe();
    expect(frames, "a picture never moves").toEqual([]);
  });
});

describe("LR — asking, restoring, starting clean", () => {
  it("reads fieldd's picture and the deck's layout, and asks", async () => {
    saveLayout(["pty-s9", "pane-shell"]);
    roster = [];
    const fieldd = client({ "agent.lastRun": async () => LEFT });
    await askLastRun(fieldd);
    const state = lastRunState();
    expect(state.phase).toBe("asking");
    expect(consentFacts()).toEqual({ agents: 1, shells: 1, unplaced: 1 });
    expect(deckAnswer(), "the deck waits on the person").toBeNull();
    // asked once per window
    await askLastRun(fieldd);
    expect(fieldd.calls.filter(([method]) => method === "agent.lastRun")).toHaveLength(1);
  });

  it("asks fieldd again while it is starting, then asks", async () => {
    vi.useFakeTimers();
    let asks = 0;
    const fieldd = client({
      "agent.lastRun": async () => {
        asks += 1;
        if (asks < 3) throw Object.assign(new Error("starting"), { retryable: true });
        return LEFT;
      },
    });
    const asked = askLastRun(fieldd);
    await vi.advanceTimersByTimeAsync(2_000);
    await asked;
    vi.useRealTimers();
    expect(asks).toBe(3);
    expect(lastRunState().phase).toBe("asking");
  });

  it("asks again while the window's connection is still coming up", async () => {
    vi.useFakeTimers();
    let asks = 0;
    const fieldd = client({
      "agent.lastRun": async () => {
        asks += 1;
        // a transport failure: no refusal, no kind — the door was never reached
        if (asks < 2) throw new Error("socket not open");
        return LEFT;
      },
    });
    const asked = askLastRun(fieldd);
    await vi.advanceTimersByTimeAsync(1_000);
    await asked;
    vi.useRealTimers();
    expect(asks).toBe(2);
    expect(lastRunState().phase).toBe("asking");
  });

  it("asks from the deck's layout alone when fieldd has no such door", async () => {
    saveLayout(["dead-1"]);
    await askLastRun(client({}));
    expect(lastRunState().phase).toBe("asking");
    expect(consentFacts()).toEqual({ agents: 0, shells: 1, unplaced: 0 });
  });

  it("answers the deck at once, unarmed, when nothing was lost — and lets fieldd's picture go", async () => {
    if (LEFT.state !== "left") throw new Error("fixture");
    const shellOnly = { ...LEFT, gone: LEFT.gone.filter((row) => row.kind === "terminal") };
    const fieldd = client({
      "agent.lastRun": async () => shellOnly,
      "agent.lastRunForget": async () => ({ forgotten: true }),
    });
    await askLastRun(fieldd);
    expect(deckAnswer()).toEqual({ rehydrate: false });
    expect(fieldd.calls.map(([method]) => method)).toEqual([
      "agent.lastRun",
      "agent.lastRunForget",
    ]);
  });

  it("restore resumes every agent by its record, hands its terminal to its pane, and forgets", async () => {
    saveLayout(["pty-s9"]);
    const fieldd = client({
      "agent.lastRun": async () => LEFT,
      // the spawn's own golden answer: a new run and its terminal's ticket
      "agent.resume": async () => SPAWNED,
      "agent.lastRunForget": async () => ({ forgotten: true }),
    });
    await askLastRun(fieldd);
    await restoreLastRun(fieldd);
    // item 468 (2026-11-18): the birth names the session its pane showed (`succeeds`), the pane
    // the rehydration hands the new terminal to, so other screens draw the two as one body
    expect(fieldd.calls).toContainEqual([
      "agent.resume",
      { runtimeRunId: "run-studio-q", succeeds: "pty-s9" },
    ]);
    expect(adopted).toEqual([SPAWNED.terminal]);
    expect(resumedPaneSession("pty-s9")).toEqual({ id: SPAWNED.terminal.sessionId });
    expect(fieldd.calls.at(-1)?.[0]).toBe("agent.lastRunForget");
    expect(deckAnswer()).toEqual({ rehydrate: true });
    expect(lastRunState().phase).toBe("answered");
  });

  it("restore names no session for an agent the last run left without one", async () => {
    if (LEFT.state !== "left") throw new Error("fixture");
    // item 468 (2026-11-18): no pane showed it, so its birth takes no one's place
    const unjoined = {
      ...LEFT,
      gone: LEFT.gone.map((row) => (row.kind === "agent" ? { id: row.id, kind: row.kind } : row)),
    };
    saveLayout(["pty-s9"]);
    const fieldd = client({
      "agent.lastRun": async () => unjoined,
      "agent.resume": async () => SPAWNED,
      "agent.lastRunForget": async () => ({ forgotten: true }),
    });
    await askLastRun(fieldd);
    await restoreLastRun(fieldd);
    const resumes = fieldd.calls.filter(([method]) => method === "agent.resume");
    expect(resumes).toEqual([["agent.resume", { runtimeRunId: "run-studio-q" }]]);
    expect(Object.keys(resumes[0]?.[1] as Record<string, unknown>)).toEqual(["runtimeRunId"]);
  });

  it("restore says which agents it could not resume, in fieldd's words, before the curtain lifts", async () => {
    saveLayout(["pty-s9"]);
    const fieldd = client({
      "agent.lastRun": async () => LEFT,
      "agent.resume": async () => {
        throw Object.assign(new Error("signed out"), {
          kind: "PRECONDITION_FAILED",
          details: { state: "signed-out" },
        });
      },
      "agent.lastRunForget": async () => ({ forgotten: true }),
    });
    await askLastRun(fieldd);
    await restoreLastRun(fieldd);
    const state = lastRunState();
    expect(state.phase).toBe("restored");
    if (state.phase === "restored") {
      expect(state.resumed).toBe(0);
      expect(state.failed).toEqual([
        { name: "Claude Code in vibe-field", reason: "its profile is signed out" },
      ]);
    }
    expect(deckAnswer(), "the deck goes on with its own panes meanwhile").toEqual({
      rehydrate: true,
    });
    dismissLastRun();
    expect(lastRunState().phase).toBe("answered");
  });

  it("start clean forgets the deck's layout and fieldd's picture, and resumes nothing", async () => {
    saveLayout(["pty-s9"]);
    const fieldd = client({
      "agent.lastRun": async () => LEFT,
      "agent.lastRunForget": async () => ({ forgotten: true }),
    });
    await askLastRun(fieldd);
    await startCleanLastRun(fieldd);
    expect(localStorage.getItem(DECK_STORAGE_KEY)).toBeNull();
    expect(fieldd.calls.map(([method]) => method)).not.toContain("agent.resume");
    expect(fieldd.calls.at(-1)?.[0]).toBe("agent.lastRunForget");
    expect(deckAnswer()).toEqual({ rehydrate: false });
  });
});

describe("LR — the question read again while it stands (2026-11-25)", () => {
  /** fieldd whose picture moves under the question: `left` is what its next read answers */
  function moving(first: unknown) {
    let left: unknown = first;
    const fieldd = client({
      "agent.lastRun": async () => {
        if (left instanceof Error) throw left;
        return left;
      },
      "agent.lastRunForget": async () => ({ forgotten: true }),
      "agent.resume": async () => SPAWNED,
    });
    return {
      fieldd,
      answer: (next: unknown) => {
        left = next;
      },
      reads: () => fieldd.calls.filter(([method]) => method === "agent.lastRun").length,
    };
  }

  it("lifts the curtain by itself once nothing the last run left is still gone", async () => {
    saveLayout(["pty-s9"]);
    roster = [];
    const door = moving(LEFT);
    await askLastRun(door.fieldd);
    expect(consentFacts()).toEqual({ agents: 1, shells: 0, unplaced: 1 });
    // Chat woke the agent: fieldd finds nothing gone (and lets its picture go), and a session is born
    door.answer({ state: "none" });
    roster = [{ sessionId: "pty-new", health: "live" }];
    await refreshLastRun(door.fieldd);
    expect(lastRunState()).toEqual({ phase: "answered", rehydrate: false });
    expect(deckAnswer(), "the deck mounts unarmed, as a launch with nothing to ask").toEqual({
      rehydrate: false,
    });
    expect(door.fieldd.calls.map(([method]) => method)).not.toContain("agent.lastRunForget");
  });

  it("shrinks the count to what is still gone, and the agent that left takes its pane with it", async () => {
    saveLayout(["pty-s9", "pty-s10"]);
    roster = [];
    const door = moving(TWO_AGENTS);
    await askLastRun(door.fieldd);
    expect(consentFacts()).toEqual({ agents: 2, shells: 0, unplaced: 1 });
    door.answer({
      ...TWO_AGENTS,
      gone: TWO_AGENTS.gone.filter((row) => row.id !== "run-studio-q"),
    });
    await refreshLastRun(door.fieldd);
    expect(consentFacts()).toEqual({ agents: 1, shells: 0, unplaced: 1 });
    const state = lastRunState();
    expect(state.phase).toBe("asking");
    if (state.phase === "asking") {
      expect(state.question.agents.map((agent) => agent.id)).toEqual(["run-two"]);
    }
    expect(agentPaneLeft("pty-s9"), "its agent is not coming back").toBe(true);
    expect(agentPaneLeft("pty-s10"), "a restore resumes its agent into it").toBe(false);
    // the same numbers again publish nothing: the question is the same object
    const asked = lastRunState();
    await refreshLastRun(door.fieldd);
    expect(door.reads()).toBe(3);
    expect(lastRunState()).toBe(asked);
  });

  it("names an agent's pane left only while its agent is not among the gone", async () => {
    saveLayout(["pty-s9", "pane-shell"]);
    roster = [];
    await askLastRun(moving(RESUMED_ELSEWHERE).fieldd);
    expect(consentFacts()).toEqual({ agents: 0, shells: 1, unplaced: 1 });
    expect(agentPaneLeft("pty-s9")).toBe(true);
    expect(agentPaneLeft("pane-shell"), "a shell's pane is a shell's").toBe(false);
    resetLastRunForTests();
    expect(agentPaneLeft("pty-s9"), "cleared with the store").toBe(false);
    await askLastRun(moving(LEFT).fieldd);
    expect(agentPaneLeft("pty-s9"), "its agent is the restore's to resume").toBe(false);
  });

  it("reads once and keeps the question when fieldd does not answer", async () => {
    saveLayout(["pty-s9"]);
    const door = moving(LEFT);
    await askLastRun(door.fieldd);
    const asked = lastRunState();
    door.answer(Object.assign(new Error("starting"), { retryable: true }));
    await refreshLastRun(door.fieldd);
    expect(door.reads(), "one read, no retry loop").toBe(2);
    expect(lastRunState()).toBe(asked);
  });

  it("reads nothing while a restore is in flight, and never races one", async () => {
    const question = composeLastRun(LEFT, ["pty-s9"], new Set());
    if (question === null) throw new Error("fixture");
    resetLastRunForTests({ phase: "restoring", question });
    const door = moving({ state: "none" });
    await refreshLastRun(door.fieldd);
    expect(door.fieldd.calls).toEqual([]);
    expect(lastRunState().phase).toBe("restoring");
  });

  it("drops a read that lands after the person answered", async () => {
    saveLayout(["pty-s9"]);
    let land: (left: unknown) => void = () => undefined;
    let held = false;
    const fieldd = client({
      "agent.lastRun": () =>
        held ? new Promise((resolve) => (land = resolve)) : Promise.resolve(LEFT),
      "agent.resume": async () => SPAWNED,
      "agent.lastRunForget": async () => ({ forgotten: true }),
    });
    await askLastRun(fieldd);
    held = true;
    const refreshing = refreshLastRun(fieldd);
    await restoreLastRun(fieldd);
    expect(lastRunState()).toEqual({ phase: "answered", rehydrate: true });
    // a picture that would ask again, and differently: two agents where the answer was about one
    land(TWO_AGENTS);
    await refreshing;
    expect(lastRunState(), "the person's answer stands").toEqual({
      phase: "answered",
      rehydrate: true,
    });
  });

  it("drops a read whose roster lands after the person answered", async () => {
    saveLayout(["pty-s9"]);
    const door = moving(LEFT);
    await askLastRun(door.fieldd);
    door.answer(TWO_AGENTS);
    let land: (() => void) | null = null;
    rosterRead = () =>
      new Promise((resolve) => {
        land = () => resolve(roster);
      });
    const refreshing = refreshLastRun(door.fieldd);
    await vi.waitFor(() => expect(land, "the read waits on the roster").not.toBeNull());
    await restoreLastRun(door.fieldd);
    expect(lastRunState()).toEqual({ phase: "answered", rehydrate: true });
    (land as (() => void) | null)?.();
    await refreshing;
    expect(lastRunState(), "the person's answer stands").toEqual({
      phase: "answered",
      rehydrate: true,
    });
  });

  // LR (mend), 2026-11-25 — GT-3's "a roster this window could not read says nothing is dead" is
  // the launch's rule; read again, it would unsay the terminals the person was just told
  it("keeps the question as it stands when the roster cannot be read again", async () => {
    saveLayout(["pty-s9", "pane-shell"]);
    const door = moving(LEFT);
    await askLastRun(door.fieldd);
    expect(consentFacts()).toEqual({ agents: 1, shells: 1, unplaced: 1 });
    const asked = lastRunState();
    rosterState = "unavailable";
    // an agent still gone: the count keeps its terminal
    await refreshLastRun(door.fieldd);
    expect(lastRunState(), "the terminal is not unsaid").toBe(asked);
    // Chat woke the agent: only the terminal is left, and it is not let go unread
    door.answer(RESUMED_ELSEWHERE);
    await refreshLastRun(door.fieldd);
    expect(lastRunState(), "never half of Start clean").toBe(asked);
    expect(door.fieldd.calls.map(([method]) => method)).not.toContain("agent.lastRunForget");
  });

  it("keeps the question as it stands when the deck's layout cannot be read again", async () => {
    saveLayout(["pty-s9", "pane-shell"]);
    const door = moving(LEFT);
    await askLastRun(door.fieldd);
    const asked = lastRunState();
    door.answer(RESUMED_ELSEWHERE);
    const read = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    try {
      await refreshLastRun(door.fieldd);
      expect(read, "the layout was asked for").toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
    expect(lastRunState()).toBe(asked);
    expect(door.fieldd.calls.map(([method]) => method)).not.toContain("agent.lastRunForget");
  });

  it("lets a read that began before another, and lands after it, go", async () => {
    saveLayout(["pty-s9", "pty-s10"]);
    const door = moving(TWO_AGENTS);
    await askLastRun(door.fieldd);
    expect(consentFacts()).toEqual({ agents: 2, shells: 0, unplaced: 1 });
    // the first read is slow, and answers what was gone when it was asked: both agents
    let land: (left: unknown) => void = () => undefined;
    const answers = door.fieldd.request;
    door.fieldd.request = (method, params) => {
      if (method !== "agent.lastRun") return answers(method, params);
      door.fieldd.calls.push([method, params]);
      return new Promise((resolve) => {
        land = resolve;
      });
    };
    const first = refreshLastRun(door.fieldd);
    door.fieldd.request = answers;
    // the second is asked after Chat woke run-studio-q, and answers at once
    door.answer({
      ...TWO_AGENTS,
      gone: TWO_AGENTS.gone.filter((row) => row.id !== "run-studio-q"),
    });
    await refreshLastRun(door.fieldd);
    expect(consentFacts()).toEqual({ agents: 1, shells: 0, unplaced: 1 });
    land(TWO_AGENTS);
    await first;
    const state = lastRunState();
    expect(state.phase).toBe("asking");
    if (state.phase === "asking") {
      expect(
        state.question.agents.map((agent) => agent.id),
        "the later read stands",
      ).toEqual(["run-two"]);
    }
    expect(agentPaneLeft("pty-s9")).toBe(true);
  });

  it("lifts before it lets fieldd's picture go, so a stale question is never answered", async () => {
    saveLayout(["pty-s9"]);
    const door = moving(LEFT);
    await askLastRun(door.fieldd);
    expect(consentFacts()).toEqual({ agents: 1, shells: 0, unplaced: 1 });
    // Chat woke the agent; fieldd still holds a picture of the bare shell no pane showed
    door.answer(RESUMED_ELSEWHERE);
    let heard: () => void = () => undefined;
    const answers = door.fieldd.request;
    door.fieldd.request = (method, params) => {
      if (method !== "agent.lastRunForget") return answers(method, params);
      door.fieldd.calls.push([method, params]);
      return new Promise((resolve) => {
        heard = () => resolve({ forgotten: true });
      });
    };
    const refreshing = refreshLastRun(door.fieldd);
    await vi.waitFor(() =>
      expect(door.fieldd.calls.map(([method]) => method)).toContain("agent.lastRunForget"),
    );
    expect(lastRunState(), "answered while fieldd hears the forget").toEqual({
      phase: "answered",
      rehydrate: false,
    });
    // a Restore pressed on the curtain as it lifts finds nothing to answer
    await restoreLastRun(door.fieldd);
    heard();
    await refreshing;
    expect(door.fieldd.calls.map(([method]) => method)).not.toContain("agent.resume");
    expect(lastRunState()).toEqual({ phase: "answered", rehydrate: false });
    expect(agentPaneLeft("pty-s9")).toBe(true);
  });

  it("keeps the picture the person is answering about when fieldd lets it go", async () => {
    saveLayout(["pty-s9", "pane-shell"]);
    const door = moving(LEFT);
    await askLastRun(door.fieldd);
    const before = lastRunState();
    if (before.phase !== "asking") throw new Error("asking");
    // Chat woke the agent: fieldd finds nothing gone and lets its picture go, but the shell's
    // pane is still dead, so the question stands without the agent
    door.answer({ state: "none" });
    await refreshLastRun(door.fieldd);
    const after = lastRunState();
    // the bare shell no pane showed is no longer gone either, or fieldd would still hold it
    expect(consentFacts()).toEqual({ agents: 0, shells: 1, unplaced: 0 });
    if (after.phase !== "asking") throw new Error("asking");
    expect(after.question.asOf, "the eyebrow keeps its moment").toBe(before.question.asOf);
    expect(after.question.board, "the still picture does not move").toBe(before.question.board);
  });
});

describe("LR — the question read again, on the window's clock (2026-11-25)", () => {
  // LR (mend), 2026-11-25 — the overlay's trigger, in its own rows: the wait, one read at a time,
  // the roster's key (never its identity, or every read would schedule the next), and the stop
  let stop: () => void = () => undefined;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    stop();
    stop = () => undefined;
    poolListeners.clear();
    vi.useRealTimers();
  });
  const born = (...ids: string[]) => {
    roster = ids.map((sessionId) => ({ sessionId, health: "live" }));
    poolMoved();
  };

  it("reads once for a burst of births, after the wait", async () => {
    const read = vi.fn(async () => undefined);
    stop = rereadLastRun(read, false);
    born("pty-a");
    await vi.advanceTimersByTimeAsync(200);
    born("pty-a", "pty-b");
    await vi.advanceTimersByTimeAsync(200);
    born("pty-a", "pty-b", "pty-c");
    await vi.advanceTimersByTimeAsync(499);
    expect(read, "the wait trails the last birth").not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledOnce();
  });

  it("reads nothing more when a read's own roster read finds the same floor", async () => {
    roster = [{ sessionId: "pty-a", health: "live" }];
    // the pool publishes a new roster on every read, as the real one does: the floor is the same
    const read = vi.fn(async () => poolMoved());
    stop = rereadLastRun(read, true);
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(600);
    expect(read, "no read schedules the next").toHaveBeenCalledOnce();
    // a session that exited is not a birth
    roster = [...roster, { sessionId: "pty-z", health: "exited" }];
    poolMoved();
    await vi.advanceTimersByTimeAsync(600);
    expect(read).toHaveBeenCalledOnce();
  });

  it("reads once more after a read in flight when the roster moved under it", async () => {
    let land: () => void = () => undefined;
    const read = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        }),
    );
    stop = rereadLastRun(read, true);
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledOnce();
    born("pty-a");
    born("pty-a", "pty-b");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(read, "one read at a time").toHaveBeenCalledOnce();
    land();
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(2);
    land();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(read, "once more, not once per change").toHaveBeenCalledTimes(2);
  });

  it("reads as Godview opens onto it, and only then, with nothing moving", async () => {
    const opened = vi.fn(async () => undefined);
    stop = rereadLastRun(opened, true);
    await vi.advanceTimersByTimeAsync(500);
    expect(opened).toHaveBeenCalledOnce();
    stop();
    const closed = vi.fn(async () => undefined);
    stop = rereadLastRun(closed, false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(closed).not.toHaveBeenCalled();
  });

  it("reads nothing once stopped, and leaves no wait behind", async () => {
    const read = vi.fn(async () => undefined);
    stop = rereadLastRun(read, true);
    born("pty-a");
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount(), "the wait is cancelled").toBe(0);
    born("pty-a", "pty-b");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(read).not.toHaveBeenCalled();
    expect(poolListeners.size, "and the roster is no longer heard").toBe(0);
  });
});

describe("LR — the curtain", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  async function draw(state: Parameters<typeof LastRunCurtain>[0]["state"]) {
    const handlers = { restore: vi.fn(), clean: vi.fn(), go: vi.fn() };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <LastRunCurtain
          state={state}
          onRestore={handlers.restore}
          onStartClean={handlers.clean}
          onContinue={handlers.go}
          now={new Date("2026-10-15T22:00:00.000Z")}
        />,
      ),
    );
    return handlers;
  }

  const question = composeLastRun(LEFT, ["pty-s9", "pane-shell"], new Set());
  if (question === null) throw new Error("fixture");

  it("states the count huge, what each answer does, and asks with two equal answers", async () => {
    const handlers = await draw({ phase: "asking", question });
    const dialog = container?.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(container?.querySelector(".vf-last-run-words")?.textContent).toBe(
      "1 agent · 1 terminal",
    );
    expect(container?.textContent).toContain(answerLine(question));
    expect(container?.textContent).toContain("1 shell that had no pane can't come back.");
    const buttons = [...(container?.querySelectorAll("button") ?? [])];
    expect(buttons.map((button) => button.textContent)).toEqual(["Restore", "Start clean"]);
    expect(new Set(buttons.map((button) => button.className)).size, "neither is the safe one").toBe(
      1,
    );
    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    expect(handlers.restore).toHaveBeenCalledOnce();
    expect(handlers.clean).toHaveBeenCalledOnce();
  });

  it("holds both answers while restoring, and says what it is doing", async () => {
    await draw({ phase: "restoring", question });
    const buttons = [...(container?.querySelectorAll("button") ?? [])];
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(container?.textContent).toContain("Resuming 1 agent…");
  });

  it("draws its held answers as §7 says: the running press keeps its look, the other is off, neither fades whole", async () => {
    // the review: UM-R5 took this fade off the strip's acts and left it here, so "Restoring…" and "Start clean" both
    // dimmed whole at 0.55, where §7 keeps the look of a pill naming its own press and draws the other one off
    await draw({ phase: "restoring", question });
    const [restore, clean] = [...(container?.querySelectorAll("button") ?? [])];
    expect(restore?.textContent).toBe("Restoring…");
    expect(restore?.hasAttribute("data-running")).toBe(true);
    expect(clean?.hasAttribute("data-running")).toBe(false);
    const sheet = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "godview", "godview.css"),
      "utf8",
    );
    const off = /\n\.vf-last-run-act:disabled \{[^}]*\}/u.exec(sheet)?.[0] ?? "";
    expect(off).toContain("cursor: default;");
    expect(off).not.toContain("opacity");
    const quiet = /\n\.vf-last-run-act:disabled:not\(\[data-running\]\) \{[^}]*\}/u.exec(
      sheet,
    )?.[0];
    expect(quiet).toContain("color: var(--text-faint);");
  });

  it("names each agent it could not resume, then lets the person continue", async () => {
    const handlers = await draw({
      phase: "restored",
      question,
      resumed: 0,
      failed: [{ name: "Claude Code in vibe-field", reason: "its folder is gone" }],
    });
    expect(container?.querySelector(".vf-last-run-words")?.textContent).toBe(
      "0 of 1 agent resumed",
    );
    expect(container?.textContent).toContain("Claude Code in vibe-field — its folder is gone");
    await act(async () => container?.querySelector("button")?.click());
    expect(handlers.go).toHaveBeenCalledOnce();
  });

  it("draws nothing once answered", async () => {
    await draw({ phase: "answered", rehydrate: true });
    expect(container?.innerHTML).toBe("");
  });

  it("says when the picture was taken: a clock today, the day otherwise", () => {
    // Item 250 (2026-11-08): the instants are LOCAL wall-clock times, so "today" and "yesterday"
    // are the host's own days by construction, as `eyebrow`'s `toDateString` reads them. They were
    // UTC literals (now 10-15T22:00Z, the picture 20:39Z), which hold only where the host's offset
    // on 10-15 lies outside [+02:00, +03:21) (derived, not run). vf-m2's Europe/Amsterdam, at
    // +02:00 then, read "yesterday 10:39 PM" where a clock was asked (run 221).
    const local = (day: number) => new Date(2026, 9, day, 20, 39, 12).toISOString();
    const now = new Date(2026, 9, 15, 22, 0);
    const at = (asOf: string) => eyebrow({ ...question, asOf }, now);
    expect(at(local(15))).toMatch(/^Last run · \d/u);
    expect(at(local(14))).toMatch(/^Last run · yesterday /u);
    expect(at(local(1))).toMatch(/^Last run · \D+ \d+ \d/u);
    expect(eyebrow({ ...question, asOf: undefined }, now)).toBe("Last run");
  });

  it("says each answer in the numbers it states", () => {
    expect(answerLine({ agents: [], shells: 2, unplaced: 0 })).toBe(
      "Restore opens a new shell in each terminal's folder (at home where one had none here). Start clean lets them go.",
    );
    expect(answerLine({ agents: [{ id: "a", name: "Codex" }], shells: 0, unplaced: 0 })).toBe(
      "Restore resumes the agent's conversation where it was. Start clean lets it go.",
    );
  });
});
