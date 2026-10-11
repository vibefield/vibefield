// @vitest-environment happy-dom
/**
 * HISTORY'S LIVE NOW, its feed (docket PK5 (a); `godview/monitor/live-feed.ts`).
 * The monitor's own feed over this window's fieldd client — the model board's
 * one ask, `agent.subscribe {projection: "model", scope: "mesh"}` — answered here
 * by fieldd's real backend and board projection on scripted sources
 * (`model-board-fixture.ts`). Held only while the Peek's Live now shows
 * (peek.test.tsx proves the holding); this proves what it reads: honest while
 * it asks, every live run joined as Godview's monitor joins them (this
 * desktop's floor session, where a run runs), the same snapshot while nothing
 * moved, a listener told when a run moves, and one ask, closed on dispose.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { LiveFeed } from "../src/frame/find-door";
import { openHistoryLiveFeed } from "../src/godview/monitor/live-feed";
import { managedSummary } from "./managed-session-fixture";
import { type ScriptedModelBoard, scriptedModelBoard } from "./model-board-fixture";

/** Frames applied as they land: the test's own clock is the board's publish. */
const NOW_SCHEDULER = {
  request(work: () => void): () => void {
    work();
    return () => undefined;
  },
};

let board: ScriptedModelBoard | null = null;
let feed: LiveFeed | null = null;

afterEach(() => {
  feed?.dispose();
  feed = null;
  board?.dispose();
  board = null;
});

async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) await new Promise((done) => setTimeout(done, 0));
}

/** A window's fieldd client as the feed asks it: the model board's two doors. */
function clientOver(scripted: ScriptedModelBoard) {
  const asked: string[] = [];
  return {
    asked,
    client: {
      request: async (method: string, params: Record<string, unknown>) => {
        asked.push(method);
        if (method === "agent.reportShown") {
          return scripted.port.reportShown((params["ids"] as string[]) ?? []);
        }
        throw new Error(`${method} is not scripted`);
      },
      subscribe: (
        method: string,
        _params: Record<string, unknown>,
        onFrame: (payload: unknown, kind?: "snapshot" | "delta") => void,
        opts?: { onReplayFailed?: (error: unknown) => void },
      ) => {
        asked.push(method);
        return scripted.port.subscribe(onFrame, opts);
      },
    },
  };
}

describe("History's live feed (PK5)", () => {
  it("asks once, says it is asking, then lists every live run joined to this desktop's floor", async () => {
    board = scriptedModelBoard({
      rows: [managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a", kind: "claude" })],
    });
    const { client, asked } = clientOver(board);
    feed = openHistoryLiveFeed(client, { scheduler: NOW_SCHEDULER });
    expect(feed.read().state.kind).toBe("connecting");
    await settle();
    expect(asked.filter((method) => method === "agent.subscribe")).toHaveLength(1);
    const snapshot = feed.read();
    expect(snapshot.state).toEqual({ kind: "live" });
    const run = snapshot.runs.find((row) => row.agent !== undefined);
    expect(run?.floorSessionId).toBe("pty-a");
    expect(run?.desk.self).toBe(true);
    expect(run?.agent?.nativeSessionId).toBe("run-a-native");
    // nothing moved: the same snapshot (useSyncExternalStore's contract)
    expect(feed.read()).toBe(snapshot);
  });

  it("tells its listener when a run moves, and closes its one ask on dispose", async () => {
    board = scriptedModelBoard({
      rows: [managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a", kind: "claude" })],
    });
    feed = openHistoryLiveFeed(clientOver(board).client, { scheduler: NOW_SCHEDULER });
    await settle();
    let heard = 0;
    const off = feed.subscribe(() => {
      heard += 1;
    });
    const before = feed.read();
    board.publish([
      managedSummary({ runtimeRunId: "run-a", terminalSessionId: "pty-a", kind: "claude" }),
      managedSummary({ runtimeRunId: "run-b", terminalSessionId: "pty-b", kind: "codex" }),
    ]);
    await settle();
    expect(heard).toBeGreaterThan(0);
    const after = feed.read();
    expect(after).not.toBe(before);
    expect(
      after.runs.filter((row) => row.agent !== undefined).map((row) => row.floorSessionId),
    ).toEqual(expect.arrayContaining(["pty-a", "pty-b"]));
    off();
    expect(board.closed()).toBe(0);
    feed.dispose();
    feed = null;
    expect(board.closed()).toBe(1);
  });
});
