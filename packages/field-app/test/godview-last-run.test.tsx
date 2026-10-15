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
  refreshTerminalRoster: async () => roster,
  terminalPoolSnapshot: () => ({ rosterState: rosterState }),
}));
let roster: Array<{ sessionId: string; health: string }> = [];
let rosterState = "observed";

const {
  askLastRun,
  composeLastRun,
  consentFacts,
  deckAnswer,
  dismissLastRun,
  lastRunState,
  pictureOpen,
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
    expect(fieldd.calls).toContainEqual(["agent.resume", { runtimeRunId: "run-studio-q" }]);
    expect(adopted).toEqual([SPAWNED.terminal]);
    expect(resumedPaneSession("pty-s9")).toEqual({ id: SPAWNED.terminal.sessionId });
    expect(fieldd.calls.at(-1)?.[0]).toBe("agent.lastRunForget");
    expect(deckAnswer()).toEqual({ rehydrate: true });
    expect(lastRunState().phase).toBe("answered");
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
    const now = new Date("2026-10-15T22:00:00.000Z");
    const at = (asOf: string) => eyebrow({ ...question, asOf }, now);
    expect(at("2026-10-15T20:39:12.000Z")).toMatch(/^Last run · \d/u);
    expect(at("2026-10-14T20:39:12.000Z")).toMatch(/^Last run · yesterday /u);
    expect(at("2026-10-01T20:39:12.000Z")).toMatch(/^Last run · \D+ \d+ \d/u);
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
