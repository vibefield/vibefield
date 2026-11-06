/**
 * TH-2 — Jump to's one reveal for Chat (`chat/reveal-run.ts`; DESIGN.md §8 "Chat's thread", the head's act; GV-D4's
 * doors): the head's Jump to and the needs-you card's Show go to a run's own terminal in Godview by History's Jump to
 * path (`frame/live-open.ts`), the row read at the press. A run with no terminal on this desktop's floor is never said
 * to be shown, and a run that is not running is said so, before anything moves. The head's own rows and the press are
 * `chat-view.test.tsx`'s; the card's, `needs-card.test.tsx`'s; the deck's reveal is `godview-deck.test.tsx`'s.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentFieldRow } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { floorSessionOf, NOT_ON_THIS_FLOOR, NOT_RUNNING, revealRun } from "../src/chat/reveal-run";
import type { GodviewFindDoor } from "../src/frame/find-door";
import { jumpNote, type LineViewDoor } from "../src/frame/line-door";
import { LIVE_OPEN_WAIT_MS, type LiveOpenDoors } from "../src/frame/live-open";

const AT = "2026-11-05T03:00:00.000Z";

function row(over: Partial<AgentFieldRow> = {}): AgentFieldRow {
  return {
    runtimeRunId: "run-Vela",
    revision: 1,
    kind: "claude",
    label: "Claude Code",
    tier: "managed",
    device: "dev-1",
    status: "working",
    statusSince: AT,
    stateChangedAt: AT,
    createdAt: AT,
    alive: true,
    blockers: [],
    spark: "sp-vela0001",
    terminal: { hosted: "local", runtimeSessionId: "pty-Vela" },
    ...over,
  };
}

/** The frame's doors, as History's Jump to meets them: the deck reveals by the floor session, and what waited how
 * long is seen. */
function doors(reveal: LineViewDoor["reveal"] = async () => ({ state: "opened" }) as const) {
  const requested: string[] = [];
  const waited: number[] = [];
  const revealed = vi.fn(reveal);
  const select = vi.fn();
  const find = { select } as unknown as GodviewFindDoor;
  const at: LiveOpenDoors = {
    requestView: (view) => requested.push(view),
    whenGodviewCanPlace: async (ms) => {
      waited.push(ms);
      return { reveal: revealed } as unknown as LineViewDoor;
    },
    whenGodviewFindDoor: async () => find,
    godviewFindDoor: () => find,
  };
  return { at, requested, waited, revealed, select };
}

describe("the floor session Jump to shows (TH-2)", () => {
  it("is the run's own terminal on this desktop's floor, alive", () => {
    expect(floorSessionOf(row())).toBe("pty-Vela");
    // an idle or blocked run's terminal is shown as a working one's
    expect(floorSessionOf(row({ status: "blocked" }))).toBe("pty-Vela");
  });

  it("is none for a run elsewhere, with no terminal, or not running (History's `liveRunOf` rule, local only)", () => {
    expect(
      floorSessionOf(row({ terminal: { hosted: "remote", runtimeSessionId: "pty" } })),
    ).toBeNull();
    expect(floorSessionOf(row({ terminal: { hosted: "none" } }))).toBeNull();
    expect(floorSessionOf(row({ terminal: { hosted: "local" } }))).toBeNull();
    expect(floorSessionOf(row({ terminal: undefined }))).toBeNull();
    expect(floorSessionOf(row({ alive: false }))).toBeNull();
    expect(floorSessionOf(null)).toBeNull();
  });
});

describe("revealing a run (TH-2; History's Jump to path)", () => {
  it("asks for Godview, waits for a deck that can place within Jump to's bound, and reveals the floor session", async () => {
    const d = doors();
    await expect(revealRun(row(), d.at)).resolves.toEqual({ state: "jumped" });
    expect(d.requested).toEqual(["godview"]);
    expect(d.waited).toEqual([LIVE_OPEN_WAIT_MS]);
    expect(d.revealed).toHaveBeenCalledWith("pty-Vela");
    expect(d.select).not.toHaveBeenCalled();
    expect(jumpNote({ state: "jumped" })).toBe("Jumped to its pane");
  });

  it("never says a run is shown without a terminal on this desktop's floor, and moves nothing", async () => {
    for (const away of [
      row({ terminal: { hosted: "remote", runtimeSessionId: "pty" } }),
      row({ terminal: { hosted: "none" } }),
      row({ terminal: { hosted: "local" } }),
    ]) {
      const d = doors();
      await expect(revealRun(away, d.at)).resolves.toEqual({
        state: "refused",
        reason: NOT_ON_THIS_FLOOR,
      });
      expect(d.requested).toEqual([]);
      // never Godview's find door, which would say "shown" for a run it only selected
      expect(d.select).not.toHaveBeenCalled();
    }
    expect(jumpNote({ state: "refused", reason: NOT_ON_THIS_FLOOR })).toBe(
      "Could not jump — its terminal is not on this desktop's floor",
    );
  });

  it("says a run gone by the press is not running, read at the press, and moves nothing", async () => {
    for (const gone of [null, row({ alive: false })]) {
      const d = doors();
      await expect(revealRun(gone, d.at)).resolves.toEqual({
        state: "refused",
        reason: NOT_RUNNING,
      });
      expect(d.requested).toEqual([]);
    }
    expect(jumpNote({ state: "refused", reason: NOT_RUNNING })).toBe(
      "Could not jump — it is not running",
    );
  });

  it("says the deck's own refusals in its words, as History's Jump to does", async () => {
    const none = doors();
    none.at.whenGodviewCanPlace = async () => null;
    await expect(revealRun(row(), none.at)).resolves.toEqual({
      state: "refused",
      reason: "the deck did not open to show it",
    });
    const refusing = doors(
      async () => ({ state: "refused", reason: "the pane is closing" }) as const,
    );
    await expect(revealRun(row(), refusing.at)).resolves.toEqual({
      state: "refused",
      reason: "the pane is closing",
    });
  });
});

// Item 187 (run 167, rung 11m's Jump to): the board's `terminal` join is the tailnet's attach promise. fieldd withholds
// it from every reader of the field board while this desktop's terminal doors are not published (TM-2 F-M4,
// agent-field-daemon.test.ts), so on a desktop off the tailnet a run on this floor reads "not on this desktop's floor".
// Whether a run's terminal is HERE is fieldd's `agent.list`, whole for this desktop's windows, read once at the press:
// History's Jump to road (`history/jump.ts`). The board row keeps what it is right about, whether the run is alive.
const SUMMARY = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../contracts/fixtures/agent-session-summary.valid.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

/** fieldd's `agent.list` row for the run, as this desktop's window reads it */
const listed = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...SUMMARY,
  runtimeRunId: "run-Vela",
  terminal: { hosted: "local", runtimeSessionId: "pty-Vela" },
  ...over,
});

/** The window's door to fieldd's runs: `agent.list` answered with `rows`, or refused; what was asked is seen. */
function runs(rows: readonly unknown[] | Error) {
  const asked: Array<[string, Record<string, unknown>]> = [];
  const door = {
    request: async (method: string, params: Record<string, unknown>) => {
      asked.push([method, params]);
      if (rows instanceof Error) throw rows;
      return { sessions: rows };
    },
  };
  return { door, asked };
}

describe("item 187 — whether a run's terminal is here is fieldd's agent.list, never the board's join", () => {
  it("reveals a run whose board row carries no join, as agent.list puts its terminal on this floor", async () => {
    const d = doors();
    const r = runs([listed({ runtimeRunId: "run-other" }), listed()]);
    await expect(revealRun(row({ terminal: undefined }), r.door, d.at)).resolves.toEqual({
      state: "jumped",
    });
    expect(r.asked).toEqual([["agent.list", {}]]);
    expect(d.requested).toEqual(["godview"]);
    expect(d.revealed).toHaveBeenCalledWith("pty-Vela");
  });

  it("refuses a run agent.list puts elsewhere, or not here, or ended, whatever the board's join says, and moves nothing", async () => {
    for (const answer of [
      [listed({ terminal: { hosted: "remote", runtimeSessionId: "pty-Vela" } })],
      [listed({ terminal: { hosted: "none" } })],
      [listed({ terminal: { hosted: "local" } })],
      [listed({ runtimeRunId: "run-other" })],
      [listed({ continuation: { persisted: true, resumable: true, exited: true } })],
      [],
    ]) {
      const d = doors();
      // the board row says local: it is no longer what decides
      await expect(revealRun(row(), runs(answer).door, d.at)).resolves.toEqual({
        state: "refused",
        reason: NOT_ON_THIS_FLOOR,
      });
      expect(d.requested).toEqual([]);
      expect(d.select).not.toHaveBeenCalled();
    }
  });

  it("says so when agent.list cannot be read, in its own words, and moves nothing", async () => {
    for (const unread of [
      runs(Object.assign(new Error("fieldd is restarting"), { kind: "UNAVAILABLE" })).door,
      { request: async () => ({ rows: [] }) },
    ]) {
      const d = doors();
      await expect(revealRun(row(), unread, d.at)).resolves.toEqual({
        state: "refused",
        reason: "VibeField could not tell where its terminal is",
      });
      expect(d.requested).toEqual([]);
    }
    expect(
      jumpNote({ state: "refused", reason: "VibeField could not tell where its terminal is" }),
    ).toBe("Could not jump — VibeField could not tell where its terminal is");
  });

  it("reads a run not alive on the board as not running, and asks agent.list nothing", async () => {
    for (const gone of [null, row({ alive: false })]) {
      const d = doors();
      const r = runs([listed()]);
      await expect(revealRun(gone, r.door, d.at)).resolves.toEqual({
        state: "refused",
        reason: NOT_RUNNING,
      });
      expect(r.asked).toEqual([]);
      expect(d.requested).toEqual([]);
    }
  });
});
