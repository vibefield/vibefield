// @vitest-environment node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { dropLateAck, LATE_ACK } from "./late-ack-runner";

// Item 213: the late-ack runner drops ONE message and nothing else. Its filter is held here directly, and its wrap of
// vitest's own `onTaskUpdate` by child vitest runs over fixtures/late-ack. Those runs are under inject-runner.ts, whose
// every update also rejects with a message of the row's choosing, and the G shape, where a real unhandled rejection
// still reds a run. The drop through vitest's real 60 s timer is the fixture's `stall` mode, a hand run (its config
// says how).

const FIELD_APP = fileURLToPath(new URL("..", import.meta.url));
const VITEST = join(FIELD_APP, "node_modules/vitest/vitest.mjs");
// A child vitest boots in 1–2 s alone and far slower on a loaded CI runner (item 202's class), so each child row
// budgets two minutes rather than vitest's 5 s default. The child is killed a little sooner, so it never outlives its row.
const CHILD_BUDGET_MS = 120_000;

function runProbe(probe: {
  mode?: "pass" | "reject";
  inject?: string;
}): Promise<{ code: number | null; output: string }> {
  // The parent's VITEST_* variables describe this run's worker, not the child's, and a LATE_ACK_* left in the shell
  // would choose the child's runner for it.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("VITEST") && !name.startsWith("LATE_ACK_"),
    ),
  );
  return new Promise((settle, fail) => {
    const child = spawn(
      process.execPath,
      [VITEST, "run", "--config", join(FIELD_APP, "test/fixtures/late-ack/vitest.config.ts")],
      {
        cwd: FIELD_APP,
        env: {
          ...env,
          LATE_ACK_FIXTURE: probe.mode ?? "pass",
          ...(probe.inject === undefined ? {} : { LATE_ACK_INJECT: probe.inject }),
          NO_COLOR: "1",
        },
        signal: AbortSignal.timeout(CHILD_BUDGET_MS - 5_000),
        stdio: "pipe",
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", fail);
    child.on("close", (code) => settle({ code, output: stripVTControlCharacters(output) }));
  });
}

describe("item 213's late-ack runner", () => {
  it("is the runner field-app's suite runs under", () => {
    const config = readFileSync(join(FIELD_APP, "vitest.config.ts"), "utf8");
    expect(config).toMatch(/^\s*runner: "\.\/test\/late-ack-runner\.ts",$/m);
  });

  it("drops the worker's late ack to a progress report, and nothing else", async () => {
    const seen: unknown[] = [];
    await expect(
      dropLateAck((packs, events) => {
        seen.push(packs, events);
        return Promise.resolve();
      })([], []),
    ).resolves.toBeUndefined();
    expect(seen).toEqual([[], []]);

    await expect(
      dropLateAck(() => Promise.reject(new Error(LATE_ACK)))([], []),
    ).resolves.toBeUndefined();

    const others: unknown[] = [
      new Error('[vitest-worker]: Timeout calling "fetch" with "["/src/x.ts","ssr"]"'),
      new Error(`${LATE_ACK} with "[]"`),
      new Error("a real failure"),
      LATE_ACK, // the message alone, not an Error
    ];
    for (const other of others) {
      await expect(dropLateAck(() => Promise.reject(other))([], [])).rejects.toBe(other);
    }
  });

  it("wraps vitest's own onTaskUpdate in a real run: a late ack on every update leaves it green", {
    timeout: CHILD_BUDGET_MS,
  }, async () => {
    const { code, output } = await runProbe({ inject: LATE_ACK });
    expect(output).not.toContain(LATE_ACK);
    expect(output).toMatch(/Tests\s+2 passed/);
    expect(code).toBe(0);
  });

  it("and passes any other rejection of it through: the run reds", {
    timeout: CHILD_BUDGET_MS,
  }, async () => {
    const other = '[vitest-worker]: Timeout calling "onQueued"';
    const { code, output } = await runProbe({ inject: other });
    expect(output).toContain(other);
    expect(output).toMatch(/Tests\s+2 passed/);
    expect(code).toBe(1);
  });

  it("still reds a child run on a real unhandled rejection (the G shape)", {
    timeout: CHILD_BUDGET_MS,
  }, async () => {
    const { code, output } = await runProbe({ mode: "reject" });
    expect(output).toContain("a real unhandled rejection");
    expect(output).toMatch(/Errors\s+1 error/);
    expect(output).toMatch(/Tests\s+2 passed/);
    expect(code).toBe(1);
  });
});
