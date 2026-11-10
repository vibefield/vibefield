import { join } from "node:path";
import { CONTRACTS_VERSION, CUSTODY, type CustodyHandoff } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFielddSupervisor, type FielddSupervisorOptions } from "../src/index";
import {
  createHarness,
  FIXTURE_SEALED,
  type Harness,
  readSealedObserved,
  sealedObservePath,
} from "./helpers";

// OB custody (C5) — the shell is one of a mark's two survivors. After any adoption or spawn at `sealed` the supervisor
// opens fieldd's marks stream on the paired connection, keeps the highest value it has heard per name for this data
// root, tells its custody provider each rise, and hands what it keeps to the next fieldd it spawns as the hand-off's
// `expect`: a store put back below its mark is then seen to be stale by a fieldd that never saw the mark rise.

const GRANTS = CUSTODY.MARK_OBJECT_GRANTS;
const HANDOFF: CustodyHandoff = {
  v: 1,
  shell: "a3".repeat(32),
  pairing: "b4".repeat(32),
  records: "c5".repeat(32),
};
type Frames = ReadonlyArray<{ marks: Record<string, number> }>;

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, what: string, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`${what} did not come within ${ms} ms`);
    await delay(10);
  }
}

/** A custody provider that keeps what it is told, each telling as its own copy. */
function provider(handoff: CustodyHandoff = HANDOFF) {
  const noted: Array<Record<string, number>> = [];
  const custody = {
    handoff: () => handoff,
    noted: (marks: Readonly<Record<string, number>>): void => {
      noted.push({ ...marks });
    },
  };
  return { noted, custody };
}

/** A sealed supervisor whose every spawn is FIXTURE_SEALED saying `frames` on its marks stream. */
function spawning(root: string, frames: Frames, custody: FielddSupervisorOptions["custody"]) {
  const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_SEALED);
  return h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: [script] },
      environment: {
        CV: CONTRACTS_VERSION,
        OBSERVE_FILE: sealedObservePath(root),
        SEALED_MARKS_FRAMES: JSON.stringify(frames),
      },
      shutdownPolicy: "leave-running",
      adoptProbeMs: 300,
      readinessDeadlineMs: 4_000,
      liveness: false,
      ...(custody !== undefined ? { custody } : {}),
    }),
  );
}

describe("the supervisor remembers fieldd's marks", () => {
  it("hands the highest mark it saw to the next spawn", async () => {
    const root = h.mkRoot();
    // the stream ends on a LOWER value than it reached: a mark only rises, so what is kept must not fall
    const frames = [
      { marks: { [GRANTS]: 3 } },
      { marks: { [GRANTS]: 8 } },
      { marks: { [GRANTS]: 5 } },
    ];
    const told = provider();
    const supervisor = spawning(root, frames, told.custody);

    const first = await supervisor.ensure();
    h.trackPid(first.childPid);
    // a first spawn has heard nothing yet, and says nothing it did not hear
    expect(readSealedObserved(root).handoffExpect).toBeNull();
    await until(() => told.noted.some((marks) => marks[GRANTS] === 8), "the mark's rise to 8");
    await delay(150);

    await first.stopOwned();
    const second = await supervisor.ensure();
    h.trackPid(second.childPid);
    expect(second.ownership).toBe("spawned");
    expect(second.childPid).not.toBe(first.childPid);
    expect(readSealedObserved(root).handoffExpect).toEqual({ [GRANTS]: 8 });
  });

  it("tells its provider each rise, whole, and never a fall or a frame that changed nothing", async () => {
    const root = h.mkRoot();
    const frames = [
      { marks: { [GRANTS]: 3 } },
      { marks: { [GRANTS]: 8, "desk.undo": 1 } },
      { marks: { [GRANTS]: 5, "desk.undo": 1 } },
    ];
    const told = provider();
    const handle = await spawning(root, frames, told.custody).ensure();
    h.trackPid(handle.childPid);
    await until(() => told.noted.length >= 2, "the second rise");
    await delay(150);
    expect(told.noted).toEqual([{ [GRANTS]: 3 }, { [GRANTS]: 8, "desk.undo": 1 }]);
    expect(readSealedObserved(root).subscribes).toBe(1);
  });

  it("raises the provider's own expect by what it saw, and lowers none of it", async () => {
    const root = h.mkRoot();
    const frames = [{ marks: { [GRANTS]: 8, "desk.undo": 1 } }];
    // the provider remembers marks of its own: one below what fieldd says, one above
    const told = provider({ ...HANDOFF, expect: { [GRANTS]: 6, "desk.undo": 2 } });
    const supervisor = spawning(root, frames, told.custody);

    const first = await supervisor.ensure();
    h.trackPid(first.childPid);
    expect(readSealedObserved(root).handoffExpect).toEqual({ [GRANTS]: 6, "desk.undo": 2 });
    await until(() => told.noted.length >= 1, "the daemon's marks");

    await first.stopOwned();
    const second = await supervisor.ensure();
    h.trackPid(second.childPid);
    expect(readSealedObserved(root).handoffExpect).toEqual({ [GRANTS]: 8, "desk.undo": 2 });
  });

  it("opens the stream after an adoption too", async () => {
    const root = h.mkRoot();
    const marks = [{ marks: { [GRANTS]: 4 } }];
    const daemon = await h.startSealedDaemon(root, { handoff: HANDOFF, marks });
    const told = provider();
    const supervisor = h.track(
      createFielddSupervisor({
        dataRoot: root,
        // adoption works, so the spawn is never reached: an inert command
        spawn: { command: process.execPath, args: ["--eval", ""] },
        environment: {},
        shutdownPolicy: "leave-running",
        adoptProbeMs: 800,
        readinessDeadlineMs: 3_000,
        liveness: false,
        custody: told.custody,
      }),
    );
    const handle = await supervisor.ensure();
    expect(handle.ownership).toBe("adopted");
    await until(() => told.noted.length >= 1, "the adopted daemon's marks");
    expect(told.noted).toEqual([{ [GRANTS]: 4 }]);
    expect(daemon.observed().subscribes).toBe(1);
  });

  it("takes no mark whose name is off the pattern, and no frame that is not a frame", async () => {
    const root = h.mkRoot();
    const frames = [
      { marks: { "Not A Name": 9, [GRANTS]: 2 } },
      // a count below zero: the whole frame is no frame, and nothing of it is kept
      { marks: { [GRANTS]: -1, "desk.undo": 7 } },
      { marks: { [GRANTS]: 3 } },
    ];
    const told = provider();
    const handle = await spawning(root, frames, told.custody).ensure();
    h.trackPid(handle.childPid);
    await until(() => told.noted.length >= 2, "the two marks that are marks");
    await delay(100);
    expect(told.noted).toEqual([{ [GRANTS]: 2 }, { [GRANTS]: 3 }]);
  });
});
