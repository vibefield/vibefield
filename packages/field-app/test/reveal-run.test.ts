/**
 * TH-2 — Jump to's one reveal for Chat (`chat/reveal-run.ts`; DESIGN.md §8 "Chat's thread", the head's act; GV-D4's
 * doors): the head's Jump to and the needs-you card's Show go to a run's own terminal in Godview by History's Jump to
 * path (`frame/live-open.ts`), the row read at the press. A run with no terminal on this desktop's floor is never said
 * to be shown, and a run that is not running is said so, before anything moves. The head's own rows and the press are
 * `chat-view.test.tsx`'s; the card's, `needs-card.test.tsx`'s; the deck's reveal is `godview-deck.test.tsx`'s.
 */
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
