// OB custody (CUSTODY-SPEC §8.1.0, rule 6) — a TYPED run and the floor's started-for table, on the REAL floor and
// through the REAL daemon (agent-gateway-floor.ts, booted `sealed` or `files`).
//
// A typed run is a person's own launch, taken into the fold through the gateway on a bearer an agent can read by
// design. So it is born PLAIN, whatever anything names, and what proves it at the next boot is its PROCESS (a pid
// and the kernel's start), never its terminal alone: the shell under it lives on and runs whatever is typed next.
//
// THE FIRST TWO ROWS GO THROUGH THE REAL DAEMON with nothing injected. `daemon.ts` hands the runtime its link as the
// floor's table only when custody was handed (the level), and the rows WATCH that link's `setStartedFor` with a spy
// that calls through, so every answer is the real floor's. A typed run's terminal was listed long before its
// adoption: it is the case of CUSTODY-SPEC §8.1.0 "v0.24" in which the row is already listed when the run enters,
// so the set is said right then, once, and the floor takes it.
//
// The last row reads the source: that the adoption path cannot pass a spark is a property of a signature.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { linesOf, TYPED_COMMAND } from "./agent-gateway-fixture";
import {
  adopted,
  END_OF_INPUT,
  FLOOR_BUDGET_MS,
  FLOOR_WAIT_MS,
  floor,
  isAlive,
  key,
  listedRow,
  openPane,
  type Pane,
  readRecord,
  rowOf,
  teardownFloors,
  type,
  poll as until,
} from "./agent-gateway-floor";
import { bundleAgentShim } from "./agent-shim-bundle";
import { HANDED } from "./custody-harness";

/** A loaded host takes seconds to start a process: no row here asserts speed. */
const PROCESS_BUDGET_MS = 60_000;
const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), "../src/agent-runtime.ts");
const VERB = "native.terminal.startedFor.set";

type Box = Awaited<ReturnType<typeof floor>>;

let bundleDir: string;
let shimScript: string;
beforeAll(async () => {
  bundleDir = mkdtempSync(join(tmpdir(), "vf-shim-started-"));
  shimScript = await bundleAgentShim(bundleDir);
}, PROCESS_BUDGET_MS);
afterAll(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});
afterEach(async () => {
  await teardownFloors();
}, PROCESS_BUDGET_MS);

/** A name typed at a pane's prompt and adopted, its recipe running: the pane, the fold's row, the signed record. */
async function typedIn(box: Box) {
  const pane = await openPane(box);
  await type(box, pane, TYPED_COMMAND);
  const row = await adopted(box, pane);
  await until(
    () => (linesOf(box.script.managedLog).length === 1 ? true : undefined),
    FLOOR_WAIT_MS,
    "the typed agent's recipe running",
  );
  return { pane, row, record: readRecord(box.dataDir, row.runtimeRunId) };
}

/** The person ends the agent at its prompt, and the fold lets the run go. The shell is theirs, and stays. */
async function endedAtItsPrompt(box: Box, pane: Pane, runtimeRunId: string): Promise<void> {
  await key(box, pane, END_OF_INPUT);
  await until(
    () => (rowOf(box, runtimeRunId) === undefined ? true : undefined),
    FLOOR_WAIT_MS,
    "the row leaving at the agent's end",
  );
}

describe("OB custody §8.1 — a typed run and the floor's started-for table (the real floor)", () => {
  it(
    "sealed, through the real daemon: an adopted run is remembered PLAIN and said to the floor with the process that proves it; when it ends with its shell living on, the floor's entry is cleared",
    async () => {
      const box = await floor({ bundle: shimScript, custody: HANDED });
      // WATCHED, never replaced: this is the link daemon.ts handed the runtime, and every answer is the floor's own
      const said = vi.spyOn(box.daemon.native, "setStartedFor");
      const { pane, row, record } = await typedIn(box);
      const runId = row.runtimeRunId;

      const typed = record.process;
      expect(typed, "a typed run's record names its process").toBeDefined();
      expect(record.creationRequestId).toEqual(expect.any(String));
      const entry = {
        run: runId,
        process: { pid: typed?.pid, startedAtMs: Date.parse(typed?.startedAt ?? "") },
        root: record.creationRequestId,
      };
      // one set, for the SHELL's terminal (the typed run lives in the person's own pane), naming no spark
      expect(said.mock.calls).toEqual([[pane.sessionId, entry]]);
      expect(said.mock.calls[0]?.[1]).not.toHaveProperty("spark");
      expect(box.daemon.agents.bornFor(runId)).toEqual({});

      await endedAtItsPrompt(box, pane, runId);
      // the shell lives on, so the floor still lists that terminal as running and the entry would stand: cleared
      expect(listedRow(box, pane.sessionId)?.pid).toBe(pane.pid);
      expect(isAlive(pane.pid)).toBe(true);
      await until(
        () => (said.mock.calls.length >= 2 ? true : undefined),
        FLOOR_WAIT_MS,
        "the clear of the ended run's entry",
      );
      expect(said.mock.calls).toEqual([
        [pane.sessionId, entry],
        [pane.sessionId, undefined],
      ]);
      // the floor's own word on both: it kept the entry, and it dropped it
      const answers = await Promise.all(said.mock.results.map((result) => result.value));
      expect(answers).toEqual(["set", "set"]);
      // ended, the run is still what it was born as
      expect(box.daemon.agents.bornFor(runId)).toEqual({});
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "files, through the real daemon: an adopted run is remembered plain all the same, and the floor is never told, at its adoption or at its end",
    async () => {
      const box = await floor({ bundle: shimScript });
      const said = vi.spyOn(box.daemon.native, "setStartedFor");
      // and by no other road either: every request this fieldd makes of its floor
      const asked = vi.spyOn(box.daemon.native, "request");
      const { pane, row } = await typedIn(box);
      expect(box.daemon.agents.bornFor(row.runtimeRunId)).toEqual({});

      await endedAtItsPrompt(box, pane, row.runtimeRunId);
      expect(isAlive(pane.pid)).toBe(true);
      expect(said).not.toHaveBeenCalled();
      expect(asked.mock.calls.map(([method]) => method)).not.toContain(VERB);
      expect(box.daemon.agents.bornFor(row.runtimeRunId)).toEqual({});
    },
    FLOOR_BUDGET_MS,
  );

  it(
    "sealed, through the real daemon: after a fieldd restart a typed run is vouched by the process its ENTRY names, plain, on the real process table; and its helper root is named again",
    async () => {
      const first = await floor({ bundle: shimScript, custody: HANDED, attach: true });
      const said = vi.spyOn(first.daemon.native, "setStartedFor");
      const { pane, row, record } = await typedIn(first);
      const runId = row.runtimeRunId;
      // the floor has the entry before this fieldd goes
      const taken = await Promise.all(said.mock.results.map((result) => result.value));
      expect(taken).toEqual(["set"]);
      await first.daemon.stop();

      const second = await floor({
        bundle: shimScript,
        custody: HANDED,
        attach: true,
        restartOf: first,
      });
      const again = await until(
        () => {
          const found = rowOf(second, runId);
          return found?.continuation?.reattached === true ? found : undefined;
        },
        FLOOR_WAIT_MS,
        "the typed run re-attached",
      );
      // the entry's process is an instant in milliseconds; the kit's table says the same instant, and it proves
      expect(again.spawnedBy).toBe("user-shell");
      expect(second.daemon.agents.bornFor(runId)).toEqual({});
      expect(second.daemon.agents.runForRoot(record.creationRequestId ?? "")).toMatchObject({
        runtimeRunId: runId,
      });
      await endedAtItsPrompt(second, pane, runId);
      expect(isAlive(pane.pid)).toBe(true);
    },
    FLOOR_BUDGET_MS,
  );

  it("the adoption path cannot pass a spark: its setter takes the run, its process and its root and has NO spark parameter, and `adopt` reaches launch memory through it alone (read from the source)", () => {
    const source = readFileSync(RUNTIME, "utf8");
    const setter = source.indexOf("  private rememberAdopted(");
    expect(setter, "the adoption's own setter").toBeGreaterThan(-1);
    const signature = source.slice(setter, source.indexOf("): void {", setter));
    expect(signature).toContain("typed: { pid: number; startedAt: string }");
    expect(signature).not.toMatch(/spark/iu);
    // what the setter hands launch memory names no spark either: `{}`
    const setterBody = source.slice(setter, source.indexOf("\n  }\n", setter));
    expect(setterBody).toContain("this.remember(entry, {}, {");

    const adopt = source.indexOf("  async adopt(input: AgentAdoptionInput): Promise<void> {");
    expect(adopt, "the adoption's entry").toBeGreaterThan(-1);
    const body = source.slice(adopt, source.indexOf("\n  async withdraw(", adopt));
    expect(body.split("this.rememberAdopted(").length - 1).toBe(1);
    expect(body).not.toContain("this.remember(");
  });
});
