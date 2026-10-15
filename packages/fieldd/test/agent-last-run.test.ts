import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentLastRunResult,
  type AgentModelBoardRow,
  type AgentModelSnapshot,
} from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LastRunKeeper, type LastRunKeeperOptions, mergePictures } from "../src/agent-last-run";

// LR (James, 2026-10-15) — what the last run left: one picture of the board,
// read before a boot writes, held while the floor's sessions are missing, and
// let go on an answer or when nothing was lost.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const golden = JSON.parse(readFileSync(join(FIXTURES, "agent-last-run.left.json"), "utf8")) as {
  board: AgentModelSnapshot;
};
/** a running agent (`run-studio-q` on `pty-s9`) and a bare shell (`pty-s4`) */
const [AGENT, SHELL] = golden.board.rows as [AgentModelBoardRow, AgentModelBoardRow];

let dir: string;
let lastPath: string;
let leftPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vf-last-run-"));
  lastPath = join(dir, "agents", "last-board.json");
  leftPath = join(dir, "agents", "left-board.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function picture(rows: AgentModelBoardRow[], asOf = "2026-10-15T20:39:12.000Z"): string {
  return `${JSON.stringify({ v: 1, asOf, board: { revision: 7, rows } })}\n`;
}

function seed(path: string, rows: AgentModelBoardRow[], asOf?: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, picture(rows, asOf));
}

/** A keeper over a board this test moves by hand. */
function keeper(over: Partial<LastRunKeeperOptions> & { rows?: AgentModelBoardRow[] } = {}) {
  let rows = over.rows ?? [];
  let revision = 0;
  const listeners = new Set<() => void>();
  const state = {
    floorUp: true,
    settled: true,
    live: new Set<string>() as Set<string> | undefined,
    runs: new Set<string>(),
    continuable: new Set<string>([AGENT.runtimeRunId]),
  };
  const subject = new LastRunKeeper({
    lastPath,
    leftPath,
    board: {
      snapshot: () => ({ revision, rows }),
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    floorUp: () => state.floorUp,
    settled: () => state.settled,
    liveSessions: () => state.live,
    liveRuns: () => state.runs,
    continuable: (id) => state.continuable.has(id),
    writeDelayMs: 0,
    settleMs: 0,
    ...over,
  });
  return {
    subject,
    state,
    move(next: AgentModelBoardRow[]): void {
      rows = next;
      revision += 1;
      for (const fn of listeners) fn();
    },
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe("LR — the board's picture", () => {
  it("is written as the board moves, 0600, while the floor is up", async () => {
    const { subject, move } = keeper();
    subject.start();
    move([AGENT, SHELL]);
    await tick();
    const written = JSON.parse(readFileSync(lastPath, "utf8")) as {
      v: number;
      board: AgentModelSnapshot;
    };
    expect(written.v).toBe(1);
    expect(written.board.rows.map((row) => row.runtimeRunId)).toEqual(["run-studio-q", "pty-s4"]);
    if (process.platform !== "win32") expect(statSync(lastPath).mode & 0o777).toBe(0o600);
    subject.dispose();
  });

  it("is NOT rewritten while the floor is down: its sessions' exits never scrub the picture", async () => {
    const { subject, state, move } = keeper();
    subject.start();
    move([AGENT, SHELL]);
    await tick();
    state.floorUp = false;
    move([]);
    await tick();
    subject.dispose();
    const written = JSON.parse(readFileSync(lastPath, "utf8")) as { board: AgentModelSnapshot };
    expect(written.board.rows).toHaveLength(2);
  });

  it("holds what the floor lost when it comes back under the same fieldd", async () => {
    const { subject, state, move } = keeper();
    subject.start();
    move([AGENT, SHELL]);
    await tick();
    state.floorUp = false;
    move([]);
    await tick();
    state.floorUp = true;
    move([]);
    await tick();
    const read = AgentLastRunResult.parse(subject.read());
    expect(read.state).toBe("left");
    if (read.state === "left")
      expect(read.gone.map((row) => row.id)).toEqual(["run-studio-q", "pty-s4"]);
    expect(existsSync(leftPath)).toBe(true);
    subject.dispose();
  });
});

describe("LR — what the last run left (agent.lastRun)", () => {
  it("says nothing was left on a first boot", () => {
    const { subject } = keeper();
    subject.start();
    expect(subject.read()).toEqual({ state: "none" });
    subject.dispose();
  });

  it("reads the last picture before this boot writes, and names what did not survive", async () => {
    seed(lastPath, [AGENT, SHELL]);
    const { subject, move } = keeper();
    subject.start();
    move([]);
    await tick();
    const read = AgentLastRunResult.parse(subject.read());
    expect(read).toMatchObject({ state: "left", asOf: "2026-10-15T20:39:12.000Z" });
    if (read.state !== "left") return;
    expect(read.board.rows).toHaveLength(2);
    expect(read.gone).toEqual([
      { id: "run-studio-q", kind: "agent", sessionId: "pty-s9" },
      { id: "pty-s4", kind: "terminal", sessionId: "pty-s4" },
    ]);
    // held on disk for a second restart; this boot's (empty) board is the last
    expect(existsSync(leftPath)).toBe(true);
    subject.dispose();
  });

  it("is starting — retryable — until the re-attach has settled and the floor has listed", () => {
    seed(lastPath, [AGENT]);
    const { subject, state } = keeper();
    subject.start();
    state.settled = false;
    expect(() => subject.read()).toThrow(/not known until the restart has settled/);
    state.settled = true;
    state.live = undefined;
    try {
      subject.read();
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        kind: "UNAVAILABLE",
        retryable: true,
        details: { service: "agent-last-run", state: "starting" },
      });
    }
    subject.dispose();
  });

  it("asks nothing when every session survived, and lets the picture go", () => {
    seed(lastPath, [AGENT, SHELL]);
    const { subject, state } = keeper();
    state.runs.add("run-studio-q");
    state.live?.add("pty-s4");
    subject.start();
    expect(subject.read()).toEqual({ state: "none" });
    expect(existsSync(leftPath)).toBe(false);
    subject.dispose();
  });

  it("offers only an agent its record can continue, and only one that was running", () => {
    const ended = {
      ...AGENT,
      runtimeRunId: "run-ended",
      alive: false,
    } as AgentModelBoardRow;
    const unrecorded = { ...AGENT, runtimeRunId: "run-unrecorded" } as AgentModelBoardRow;
    seed(lastPath, [AGENT, ended, unrecorded]);
    const { subject, state } = keeper();
    state.continuable.add("run-ended");
    subject.start();
    const read = AgentLastRunResult.parse(subject.read());
    expect(read.state === "left" ? read.gone.map((row) => row.id) : []).toEqual(["run-studio-q"]);
    subject.dispose();
  });

  it("keeps the question across a second restart before the answer", async () => {
    seed(leftPath, [AGENT], "2026-10-15T20:39:12.000Z");
    seed(lastPath, [SHELL], "2026-10-15T21:02:00.000Z");
    const { subject } = keeper();
    subject.start();
    const read = AgentLastRunResult.parse(subject.read());
    expect(read).toMatchObject({ state: "left", asOf: "2026-10-15T21:02:00.000Z" });
    if (read.state === "left")
      expect(read.gone.map((row) => row.id)).toEqual(["run-studio-q", "pty-s4"]);
    subject.dispose();
  });

  it("forgets on the answer", () => {
    seed(lastPath, [AGENT]);
    const { subject } = keeper();
    subject.start();
    expect(subject.read().state).toBe("left");
    expect(subject.forget()).toEqual({ forgotten: true });
    expect(existsSync(leftPath)).toBe(false);
    expect(subject.read()).toEqual({ state: "none" });
    expect(subject.forget()).toEqual({ forgotten: false });
    subject.dispose();
  });

  it("sets a picture that does not parse aside rather than failing the boot", () => {
    seed(lastPath, [AGENT]);
    writeFileSync(lastPath, "{ not json");
    writeFileSync(leftPath, JSON.stringify({ v: 2, asOf: "x", board: {} }));
    const { subject } = keeper();
    expect(() => subject.start()).not.toThrow();
    expect(subject.read()).toEqual({ state: "none" });
    subject.dispose();
  });
});

describe("LR — two pictures as one", () => {
  it("merges by row id, the later row and the later moment winning", () => {
    const earlier = {
      asOf: "2026-10-15T20:00:00.000Z",
      board: { revision: 3, rows: [AGENT, SHELL] },
    };
    const moved = { ...SHELL, revision: 99 } as AgentModelBoardRow;
    const later = { asOf: "2026-10-15T21:00:00.000Z", board: { revision: 5, rows: [moved] } };
    const merged = mergePictures(earlier, later);
    expect(merged?.asOf).toBe("2026-10-15T21:00:00.000Z");
    expect(merged?.board.rows.map((row) => [row.runtimeRunId, row.revision])).toEqual([
      ["run-studio-q", 11],
      ["pty-s4", 99],
    ]);
    expect(mergePictures(undefined, later)).toBe(later);
    expect(mergePictures(earlier, undefined)).toBe(earlier);
  });
});
