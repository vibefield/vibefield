import {
  AGENT_FIELD,
  AgentModelDelta,
  AgentRemoteDelta,
  type AgentSessionSummary,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelSubscription, createRemoteSubscription } from "../src/agent-model-board";
import { managedSummary as summary } from "./agent-field-summary";
import { floorTerminal, stateOf, testMonitor } from "./agent-monitor-fixture";

// Item 137 (PG-3a0's probe, VF-PM 2026-11-01 02:52Z) — A SHELL PROMOTED TO AN AGENT, AS THE OWNER'S BOARDS SEND
// IT. A promoted run carries its shell's model id (M22, `agent-monitor.ts` `hostRunFromSummary`), so for one model id
// the board key changes: the run's key arrives carrying the shell's id while the shell's key leaves, and back again
// when the run ends and its PTY stands. The probe found the owner sends each change as ONE delta, on the `remote` cut
// (a peer window and the phone) and the `model` board (this desktop's windows) alike, and the window's fold, which
// dropped an id by key alone, lost the row in it.
//
// This is the owner-side pin, held to what a reader needs rather than to the batching: replayed by key, every frame
// leaves some key holding the model id, and each change ends with the one key the backend's row now stands under. The
// reader's half, a fold that keeps an id while any key of the device maps to it, is the window's `ModelBoardFold`
// (`field-app/test/godview-model-board.test.ts`, item 137's row) and, from PG-3d, the phone's.

afterEach(() => {
  vi.useRealTimers();
});

type Delta = {
  upserts: readonly { runtimeRunId: string; monitorRow?: { id: string } }[];
  removed: readonly string[];
};

/** Each board key and the model id it carries after `deltas` over `open` (`key→id`, sorted), one entry per frame. */
function keysAfterEach(open: readonly string[], deltas: readonly Delta[]): string[][] {
  const idByKey = new Map(open.map((pair) => pair.split("→") as [string, string]));
  return deltas.map((delta) => {
    for (const row of delta.upserts) {
      if (row.monitorRow === undefined) idByKey.delete(row.runtimeRunId);
      else idByKey.set(row.runtimeRunId, row.monitorRow.id);
    }
    for (const key of delta.removed) idByKey.delete(key);
    return [...idByKey].map(([key, id]) => `${key}→${id}`).sort();
  });
}

const promoted: AgentSessionSummary = summary({
  runtimeRunId: "run-typed",
  status: "working",
  terminal: { hosted: "local", runtimeSessionId: "pty-shell", workloadClass: "interactive" },
});

type Board = "remote" | "model";

async function walk(board: Board) {
  vi.useFakeTimers();
  const monitor = await testMonitor({
    summaries: [],
    terminals: [floorTerminal({ sessionId: "pty-shell", cwd: "/repo", title: "zsh" })],
  });
  monitor.rows();
  const frames: unknown[] = [];
  const floor = board === "remote" ? AGENT_FIELD.REMOTE_MIN_INTERVAL_MS : AGENT_FIELD.FULL_TICK_MS;
  const sub =
    board === "remote"
      ? createRemoteSubscription({
          fold: monitor.fold,
          monitor: monitor.service,
          emit: (frame) => frames.push(frame),
          epoch: "boot.p",
        })
      : createModelSubscription({
          fold: monitor.fold,
          monitor: monitor.service,
          emit: (frame) => frames.push(frame),
          epoch: "boot.p",
        });
  const open = (sub.snapshot.rows as Delta["upserts"]).map(
    (row) => `${row.runtimeRunId}→${row.monitorRow?.id ?? "∅"}`,
  );
  const settle = () => {
    for (let i = 0; i < 4; i += 1) {
      monitor.scheduler.flush();
      vi.advanceTimersByTime(floor * 2);
    }
  };
  settle();
  // the key and the model id of each row, the two facts a reader's fold keys by
  const parse = (frame: unknown): Delta => {
    const delta = board === "remote" ? AgentRemoteDelta.parse(frame) : AgentModelDelta.parse(frame);
    return {
      upserts: delta.upserts.map((row) => {
        const model = (row as { monitorRow?: { id: string } }).monitorRow;
        return model === undefined
          ? { runtimeRunId: row.runtimeRunId }
          : { runtimeRunId: row.runtimeRunId, monitorRow: { id: model.id } };
      }),
      removed: delta.removed,
    };
  };
  // the person types the agent's name in that shell: the fold names a run in the PTY (M22)
  const before = frames.length;
  monitor.fold.publish([promoted]);
  monitor.runtime.push(stateOf(promoted));
  settle();
  const promotion = frames.slice(before).map(parse);
  // the run ends and leaves the PTY standing: a bare terminal again, the same id
  const after = frames.length;
  monitor.fold.publish([]);
  monitor.runtime.remove("run-typed");
  settle();
  const demotion = frames.slice(after).map(parse);
  const backendIds = monitor.rows().map((row) => row.id);
  sub.dispose();
  monitor.service.dispose();
  return { open, promotion, demotion, backendIds };
}

describe("item 137 — a shell promoted to an agent, as the owner's boards send it", () => {
  for (const board of ["remote", "model"] as const) {
    it(`the ${board} board moves the shell's model id between keys and never leaves it without one`, async () => {
      const { open, promotion, demotion, backendIds } = await walk(board);
      expect(open).toEqual(["pty-shell→pty-shell"]);
      expect(promotion.length, "the promotion is sent").toBeGreaterThan(0);
      expect(demotion.length, "the run's end is sent").toBeGreaterThan(0);
      const promoted = keysAfterEach(open, promotion);
      const returned = keysAfterEach(promoted.at(-1) ?? [], demotion);
      // every frame leaves a key holding pty-shell: a reader that keeps an id while a key maps it keeps the row
      for (const keys of [...promoted, ...returned]) {
        expect(
          keys.some((pair) => pair.endsWith("→pty-shell")),
          keys.join(", "),
        ).toBe(true);
      }
      // the run's key carries the shell's id once promoted; the shell's key carries it again once the run ends
      expect(promoted.at(-1)).toEqual(["run-typed→pty-shell"]);
      expect(returned.at(-1)).toEqual(["pty-shell→pty-shell"]);
      // the backend's own word, before and after (M22): one row, the shell's id
      expect(backendIds).toEqual(["pty-shell"]);
    });
  }
});
