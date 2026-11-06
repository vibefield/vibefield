/**
 * Item 187 — the window's door to fieldd's runs (`agent.list`) as Chat's reveals read it at the press
 * (`chat/reveal-run.ts`, History's road; `ChatView`'s `runs`). An `agent.list` row is contracts' own
 * `agent-session-summary.valid.json`, given the run and the terminal a test names. The door answers either rows a test
 * scripts (`runsDoor`), or the rows a test's board holds (`runsOverBoard`, so the list and the board say the same
 * thing, as on a desktop whose terminal doors are published). What it was asked is seen.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentFieldRow } from "@vibefield/contracts";
import type { KeyedCallClient } from "../src/forwarded-call";

const SUMMARY = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../contracts/fixtures/agent-session-summary.valid.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

/** fieldd's `agent.list` row for a run, as this desktop's window reads it. */
export function listedRun(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...SUMMARY, ...over };
}

/** A runs door and what was asked of it. */
export interface RunsDoor {
  readonly door: KeyedCallClient;
  readonly asked: Array<[string, Record<string, unknown>]>;
}

/** The door, answering `agent.list` with `answer`'s rows (read at each ask), or refusing with it. */
export function runsDoor(
  answer: readonly unknown[] | Error | (() => readonly unknown[]),
): RunsDoor {
  const asked: Array<[string, Record<string, unknown>]> = [];
  return {
    asked,
    door: {
      request: async (method, params) => {
        asked.push([method, params]);
        if (answer instanceof Error) throw answer;
        return { sessions: typeof answer === "function" ? answer() : answer };
      },
    },
  };
}

/** The door, answering from the field rows a test's board holds now: each as its `agent.list` row, with the board
 * row's run and terminal (its join, or none). */
export function runsOverBoard(
  rows: () => Iterable<Pick<AgentFieldRow, "runtimeRunId" | "terminal">>,
): RunsDoor {
  return runsDoor(() =>
    [...rows()].map((row) => listedRun({ runtimeRunId: row.runtimeRunId, terminal: row.terminal })),
  );
}

/** A door for a Chat whose test presses no reveal: fieldd lists no run. */
export const NO_RUNS: KeyedCallClient = runsDoor([]).door;
