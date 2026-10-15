import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AgentLastRunForgetResult,
  AgentLastRunResult,
  AgentModelDeskRow,
  AgentModelSnapshot,
} from "../src/agent-field";
import { METHODS } from "../src/methods";
import { LAYOUT } from "../src/registries";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const golden = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

describe("LR — what the last run left (agent.lastRun)", () => {
  it("parses the left picture: the board whole, and the rows that did not survive", () => {
    const left = AgentLastRunResult.parse(golden("agent-last-run.left.json"));
    expect(left.state).toBe("left");
    if (left.state !== "left") return;
    expect(AgentModelSnapshot.safeParse(left.board).success).toBe(true);
    expect(left.board.rows).toHaveLength(2);
    // the agent's row is the model board's own row, chrome facts and all
    expect(AgentModelDeskRow.safeParse(left.board.rows[0]).success).toBe(true);
    expect(left.gone.map((row) => [row.kind, row.id, row.sessionId])).toEqual([
      ["agent", "run-studio-q", "pty-s9"],
      ["terminal", "pty-s4", "pty-s4"],
    ]);
  });

  it("parses nothing left", () => {
    expect(AgentLastRunResult.parse(golden("agent-last-run.none.json"))).toEqual({ state: "none" });
  });

  it("is a tolerant reader: an unknown field rides, an unknown state is refused", () => {
    const left = golden("agent-last-run.left.json") as Record<string, unknown>;
    const parsed = AgentLastRunResult.parse({ ...left, later: 1 }) as Record<string, unknown>;
    expect(parsed["later"]).toBe(1);
    expect(AgentLastRunResult.safeParse({ state: "kept" }).success).toBe(false);
  });

  it("refuses a gone row with no id or an unknown kind", () => {
    const left = golden("agent-last-run.left.json") as { gone: unknown[] };
    expect(AgentLastRunResult.safeParse({ ...left, gone: [{ kind: "agent" }] }).success).toBe(
      false,
    );
    expect(
      AgentLastRunResult.safeParse({ ...left, gone: [{ id: "x", kind: "phone" }] }).success,
    ).toBe(false);
  });

  it("parses the forget's answer", () => {
    expect(AgentLastRunForgetResult.parse(golden("agent-last-run-forget.valid.json"))).toEqual({
      forgotten: true,
    });
  });

  it("declares both doors local: the board's scope to read, spawn's to forget", () => {
    const read = METHODS.find((row) => row.method === "agent.lastRun");
    const forget = METHODS.find((row) => row.method === "agent.lastRunForget");
    expect(read).toMatchObject({ scope: "agent.observe", idempotent: true, locality: "local" });
    expect(forget).toMatchObject({ scope: "agent.spawn", idempotent: true, locality: "local" });
  });

  it("keeps its two files under the user's agents directory", () => {
    expect(LAYOUT.AGENT_LAST_BOARD_FILE).toEqual(["agents", "last-board.json"]);
    expect(LAYOUT.AGENT_LEFT_BOARD_FILE).toEqual(["agents", "left-board.json"]);
  });
});
