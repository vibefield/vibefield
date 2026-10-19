/**
 * P3 — Jump to's reading (DESIGN.md §8 "History"; AR-D43, K11): the run that
 * continues the chosen conversation HERE, joined from fieldd's fold on the
 * provider-native id, and the words the line says around it. The view's own
 * rows (the create flipping, the press, the refusals) are
 * `history-view.test.tsx`'s; the deck's reveal is `godview-deck.test.tsx`'s.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type HistoryLineDoor,
  historyCreateWaits,
  jumpNote,
  newTerminalNote,
  resumeNote,
} from "../src/frame/line-door";
import { liveRunOf, readLiveRun } from "../src/history/jump";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const SUMMARY = JSON.parse(
  readFileSync(join(FIXTURES, "agent-session-summary.valid.json"), "utf8"),
) as Record<string, unknown>;

const NATIVE = "665e3e71-7c12-4810-925a-e8b92cb6f29d";
const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...SUMMARY,
  sessionId: NATIVE,
  runtimeRunId: "run-agent",
  terminal: { hosted: "local", runtimeSessionId: "pty-agent" },
  ...overrides,
});

describe("the run that continues the chosen conversation here (P3)", () => {
  it("joins on the native id and names the floor session its pane shows", () => {
    const rows = [row({ sessionId: "another-conversation", runtimeRunId: "run-other" }), row()];
    expect(liveRunOf(rows, NATIVE)).toEqual({
      floorSessionId: "pty-agent",
      runtimeRunId: "run-agent",
    });
    expect(liveRunOf(rows, "a-conversation-nobody-runs")).toBeNull();
  });

  it("is not running once its record is stamped with the exit, though its pane is still on the floor", () => {
    expect(
      liveRunOf(
        [row({ continuation: { persisted: true, resumable: true, exited: true } })],
        NATIVE,
      ),
    ).toBeNull();
    // a run whose exit is not stamped still runs, resumable or not
    expect(
      liveRunOf([row({ continuation: { persisted: true, resumable: false } })], NATIVE),
    ).not.toBeNull();
  });

  it("is not running HERE without a terminal on this desktop's floor", () => {
    expect(
      liveRunOf([row({ terminal: { hosted: "remote", runtimeSessionId: "pty" } })], NATIVE),
    ).toBeNull();
    expect(liveRunOf([row({ terminal: { hosted: "none" } })], NATIVE)).toBeNull();
    expect(liveRunOf([row({ terminal: { hosted: "local" } })], NATIVE)).toBeNull();
    expect(liveRunOf([row({ terminal: undefined })], NATIVE)).toBeNull();
  });

  it("passes over a row it cannot read, never refusing the rest (the tolerant reader)", () => {
    expect(liveRunOf([{ sessionId: NATIVE }, "garbage", null, row()], NATIVE)?.floorSessionId).toBe(
      "pty-agent",
    );
  });

  it("asks one plain agent.list, and a fold that cannot answer reads as not running", async () => {
    const asked: Array<[string, Record<string, unknown>]> = [];
    const answering = {
      request: async (method: string, params: Record<string, unknown>) => {
        asked.push([method, params]);
        return { sessions: [row()] };
      },
    };
    expect(await readLiveRun(answering, NATIVE)).toEqual({
      floorSessionId: "pty-agent",
      runtimeRunId: "run-agent",
    });
    expect(asked).toEqual([["agent.list", {}]]);
    const refusing = {
      request: async () => {
        throw Object.assign(new Error("fieldd is restarting"), { kind: "UNAVAILABLE" });
      },
    };
    expect(await readLiveRun(refusing, NATIVE)).toBeNull();
    expect(await readLiveRun({ request: async () => ({ rows: [] }) }, NATIVE)).toBeNull();
  });
});

describe("the line's words around Jump to (P3)", () => {
  const door = (overrides: Partial<HistoryLineDoor>): HistoryLineDoor => ({
    chosen: "ses-1",
    waits: null,
    live: false,
    resume: async () => ({ state: "resumed" }),
    jump: async () => ({ state: "jumped" }),
    ...overrides,
  });

  it("says what a press came to", () => {
    expect(jumpNote({ state: "jumped" })).toBe("Jumped to its pane");
    expect(jumpNote({ state: "ended" })).toBe("This session has ended — Resume it");
    expect(jumpNote({ state: "refused", reason: "the deck did not open to show it" })).toBe(
      "Could not jump — the deck did not open to show it",
    );
    expect(resumeNote({ state: "running" })).toBe("This session is running — Jump to it");
    expect(resumeNote({ state: "resumed" })).toBe("Resumed in the active pane");
  });

  it("PJ-6 (Q4): a resume at the agent's own model, its launch model not taken, says so in fieldd's words", () => {
    const own = "at OpenCode's own model — it can't start a resumed session at a chosen one";
    expect(resumeNote({ state: "resumed", placement: "replace", own })).toBe(
      `Resumed in the active pane, ${own}`,
    );
    expect(resumeNote({ state: "resumed", own })).toBe(`Resumed in the active pane, ${own}`);
  });

  it("says where the deck's rule placed a resume and a new terminal: the active pane (GV-D4, re-ruled 2026-10-18)", () => {
    // the focused pane takes it, whatever the count — "… in a new pane" is
    // never said since the re-ruling — and a door that does not say keeps the
    // sentence it always had
    expect(resumeNote({ state: "resumed", placement: "replace" })).toBe(
      "Resumed in the active pane",
    );
    expect(newTerminalNote({ state: "opened", placement: "replace" })).toBe(
      "Terminal opened in the active pane",
    );
    expect(newTerminalNote({ state: "opened" })).toBe("Terminal opened in the active pane");
    expect(resumeNote({ state: "resumed" })).toBe("Resumed in the active pane");
  });

  it("never makes Jump to wait on the launcher's reading — only on a choice", () => {
    expect(historyCreateWaits(door({ waits: "its folder is gone" }))).toBe("its folder is gone");
    expect(historyCreateWaits(door({ waits: "its folder is gone", live: true }))).toBeNull();
    expect(historyCreateWaits(door({ chosen: null, live: true }))).toBe("choose a session first");
    expect(historyCreateWaits(null)).toBe("choose a session first");
  });
});
