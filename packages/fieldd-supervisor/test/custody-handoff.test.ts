import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_VERSION, CUSTODY, type CustodyHandoff } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFielddSupervisor,
  type FielddSupervisorEvent,
  type FielddSupervisorOptions,
  SupervisorError,
  tokenPath,
} from "../src/index";
import {
  createHarness,
  FIXTURE_DEAF,
  FIXTURE_EXIT_1,
  FIXTURE_SEALED,
  type Harness,
  readSealedObserved,
  sealedObservePath,
  waitDead,
  waitForEvent,
} from "./helpers";

// OB custody (C1's hand-off, C2's readiness, C6's check) — a supervisor that was handed a custody provider spawns
// fieldd `sealed`: a piped stdin, FIELDD_CUSTODY=stdin, the child asked about BEFORE anything is written to it, then
// ONE line and EOF. Readiness is the child's own ready line and then the pairing; no token file is read, and none is
// written. Nothing of the hand-off is in argv, in the environment, in an event or in an error. The child is helpers'
// FIXTURE_SEALED, which records what it was handed as a digest and never as the secret.

const HANDOFF: CustodyHandoff = {
  v: 1,
  shell: "a3".repeat(32),
  pairing: "b4".repeat(32),
  records: "c5".repeat(32),
};
const SECRETS = [HANDOFF.shell, HANDOFF.pairing, HANDOFF.records];
const LINE_SHA256 = createHash("sha256").update(JSON.stringify(HANDOFF), "utf8").digest("hex");

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function spawnedPid(events: FielddSupervisorEvent[]): number | undefined {
  for (const event of events) {
    if (event.kind !== "lifecycle" || event.event !== "fieldd.supervisor.spawned") continue;
    const pid = event.attrs?.["pid"];
    if (typeof pid === "number") return pid;
  }
  return undefined;
}

/** A supervisor that spawns `fixture` under `root`, sealed unless `extra` says otherwise. */
function sup(
  root: string,
  events: FielddSupervisorEvent[],
  extra: Partial<FielddSupervisorOptions> = {},
  fixture = FIXTURE_SEALED,
  env: Record<string, string> = {},
) {
  const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", fixture);
  return h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: [script] },
      environment: { CV: CONTRACTS_VERSION, OBSERVE_FILE: sealedObservePath(root), ...env },
      shutdownPolicy: "leave-running",
      adoptProbeMs: 300,
      readinessDeadlineMs: 4_000,
      liveness: false,
      custody: { handoff: () => HANDOFF },
      onEvent: (event) => events.push(event),
      ...extra,
    }),
  );
}

/** `ensure()`'s rejection, with the spawned child tracked for cleanup whatever happened. */
async function refusal(
  supervisor: ReturnType<typeof sup>,
  events: FielddSupervisorEvent[],
): Promise<unknown> {
  const outcome = await supervisor.ensure().then(
    (handle) => {
      h.trackPid(handle.childPid);
      return null;
    },
    (error: unknown) => error,
  );
  h.trackPid(spawnedPid(events));
  return outcome;
}

describe("a sealed spawn hands fieldd custody", () => {
  it("on stdin: one line under FIELDD_CUSTODY=stdin, and the child comes up sealed with no token file", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    const handle = await sup(root, events).ensure();
    h.trackPid(handle.childPid);

    expect(handle.ownership).toBe("spawned");
    expect(handle.childPid).toBeGreaterThan(0);
    expect(handle.info.pid).toBe(handle.childPid);
    expect(handle.info.custody).toBe("sealed");
    expect(handle.client.status).toBe("ready");
    const seen = readSealedObserved(root);
    expect(seen.custodyFlag).toBe("stdin");
    // the exact line, by its digest: the hand-off as JSON, and nothing before or after it
    expect(seen.handoffSha256).toBe(LINE_SHA256);
    expect(seen.handoffExpect).toBeNull();
    // readiness was the child's own line and then the pairing: one shell-main hello, and no token on disk
    await waitForEvent(events, (event) => event.kind === "readiness", "the child's readiness line");
    const ready = events.find((event) => event.kind === "readiness");
    const signal = { port: handle.info.port, bootId: handle.info.bootId };
    expect(ready).toMatchObject({ signal });
    expect(seen.hellos).toHaveLength(1);
    expect(seen.hellos[0]).toMatchObject({ clientKind: "shell-main", credential: "object" });
    expect(existsSync(tokenPath(root))).toBe(false);
  });

  it("with nothing of it in argv or env, in an event or in the handle", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    const handle = await sup(root, events).ensure();
    h.trackPid(handle.childPid);
    const seen = readSealedObserved(root);
    expect(seen.secretInArgv).toBe(false);
    expect(seen.secretInEnv).toBe(false);
    const said = JSON.stringify([events, handle.info, seen]);
    for (const secret of SECRETS) expect(said).not.toContain(secret);
  });

  it("asks whether the child is ours before anything is written to it", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    const asked: number[] = [];
    let verifiedAt = 0;
    const custody = {
      handoff: () => HANDOFF,
      async verifyChild(pid: number) {
        asked.push(pid);
        // long enough that a hand-off written early would be seen to arrive first
        await delay(200);
        verifiedAt = Date.now();
        return true;
      },
    };
    const handle = await sup(root, events, { custody }).ensure();
    h.trackPid(handle.childPid);
    expect(asked).toEqual([handle.childPid]);
    const seen = readSealedObserved(root);
    expect(seen.handoffSha256).toBe(LINE_SHA256);
    expect(seen.stdinAtMs).not.toBeNull();
    expect(seen.stdinAtMs ?? 0).toBeGreaterThanOrEqual(verifiedAt);
  });

  it("stops a child that is not ours and hands it nothing: child-not-ours", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    let handoffs = 0;
    const custody = {
      handoff: () => {
        handoffs += 1;
        return HANDOFF;
      },
      verifyChild: async () => false,
    };
    const madeBeforeSpawn = handoffs;
    const error = await refusal(sup(root, events, { custody }), events);
    expect(error).toBeInstanceOf(SupervisorError);
    expect((error as SupervisorError).kind).toBe("child-not-ours");
    for (const secret of SECRETS) expect(String((error as Error).message)).not.toContain(secret);
    // the child was spawned, never reached its line, and is gone
    const pid = spawnedPid(events);
    expect(pid).toBeGreaterThan(0);
    expect(await waitDead(pid as number)).toBe(true);
    expect(events.some((event) => event.kind === "readiness")).toBe(false);
    // it read nothing: the fixture writes what it observed only once its stdin has said something
    expect(existsSync(sealedObservePath(root))).toBe(false);
    // and the provider was asked for no second hand-off to write (the first was the adoption probe's secret)
    expect(handoffs - madeBeforeSpawn).toBeLessThanOrEqual(1);
    for (const secret of SECRETS) expect(JSON.stringify(events)).not.toContain(secret);
  });

  it("takes a verifier that throws as a refusal too", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    const custody = {
      handoff: () => HANDOFF,
      verifyChild: async (): Promise<boolean> => {
        throw new Error("codesign did not answer");
      },
    };
    const error = await refusal(sup(root, events, { custody }), events);
    expect((error as SupervisorError).kind).toBe("child-not-ours");
    expect(await waitDead(spawnedPid(events) as number)).toBe(true);
    expect(existsSync(sealedObservePath(root))).toBe(false);
  });

  it("fails the attempt when the child says ready and cannot prove the pairing, and stops it", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    // the fixture as a planted binary: it reads the hand-off, takes the hello and proves nothing
    const supervisor = sup(root, events, {}, FIXTURE_SEALED, { SEALED_MODE: "accept" });
    const error = await refusal(supervisor, events);
    expect(error).toBeInstanceOf(SupervisorError);
    expect((error as SupervisorError).kind).toBe("spawn-failed");
    expect((error as SupervisorError).probe).toBe("foreign-listener");
    expect(await waitDead(spawnedPid(events) as number)).toBe(true);
  });

  it("keeps a child that exits before its ready line a child-exit, with its own last words", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    const error = await refusal(sup(root, events, {}, FIXTURE_EXIT_1), events);
    expect((error as SupervisorError).kind).toBe("child-exit");
    expect((error as Error).message).toContain("boom: fieldd refused to start");
    for (const secret of SECRETS) expect((error as Error).message).not.toContain(secret);
  });
});

// C6c (CUSTODY-SPEC §2.4, "one budget for the check") — the supervisor is fieldd's SPAWNER: the spawn, the wait on
// the check and the hand-off's write are all its own, so everything between a spawn and its write is its to bound,
// here and not behind the seam it asks.
//
// GIVEN AN INJECTED VERIFIER, every row below: `verifyChild` is the one thing a host binds here, and each row hands
// the REAL supervisor a stand-in for it and a real child (FIXTURE_SEALED, which writes what it observed only once
// its stdin has said something; FIXTURE_EXIT_1, which leaves at once; FIXTURE_DEAF, which will never read). They
// show the supervisor's rule given that verifier. They do NOT show that production binds one: the binding is the
// shell's provider, no row runs main's real composition root in vitest, and that proof is owed to a signed build.
// What the check itself is worth is not these rows' claim either: it stops a wrong binary that stays itself.
describe("the check between a spawn and its hand-off has one budget", () => {
  const notOurs = (event: FielddSupervisorEvent): boolean =>
    event.kind === "lifecycle" && event.event === "fieldd.supervisor.child_not_ours";
  const handed = (event: FielddSupervisorEvent): boolean =>
    event.kind === "lifecycle" && event.event === "fieldd.supervisor.custody_handed";
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it("ends a child whose check never settles, at the budget, deaf to a late yes", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    let asked: (pid: number) => void = () => undefined;
    const askedOnce = new Promise<number>((resolve) => {
      asked = resolve;
    });
    let answer: (ours: boolean) => void = () => undefined;
    const custody = {
      handoff: () => HANDOFF,
      // the tool that would say whose code the child is hangs: no answer, no throw
      verifyChild(pid: number): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
          answer = resolve;
          asked(pid);
        });
      },
    };
    let error: unknown;
    let pid = 0;
    try {
      // only the supervisor's own clock is faked: the child is real, and its exit is a real event
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      try {
        const outcome = refusal(sup(root, events, { custody }), events);
        pid = await askedOnce;
        h.trackPid(pid);
        // one tick short of the budget the supervisor is still asking, and the child is still there
        await vi.advanceTimersByTimeAsync(CUSTODY.CHILD_CHECK_BUDGET_MS - 1);
        expect(events.some(notOurs)).toBe(false);
        expect(alive(pid)).toBe(true);
        // at the budget it stops asking, and the child is refused as one that was not shown to be ours
        await vi.advanceTimersByTimeAsync(1);
        expect(events.find(notOurs)).toMatchObject({ attrs: { pid, reason: "over-budget" } });
        error = await outcome;
      } finally {
        vi.useRealTimers();
      }
      expect(error).toBeInstanceOf(SupervisorError);
      expect((error as SupervisorError).kind).toBe("child-not-ours");
      for (const secret of SECRETS) expect(String((error as Error).message)).not.toContain(secret);
      expect(await waitDead(pid)).toBe(true);
      // the tool answers at last, and says yes: nobody is listening, and nothing was or is written
      answer(true);
      await delay(100);
      expect(events.some(handed)).toBe(false);
      expect(existsSync(sealedObservePath(root))).toBe(false);
    } finally {
      // a supervisor that is still asking (this row's red) is let go on to its end: nothing outlives the row
      answer(false);
    }
  });

  it("lets a child that left while it was asked about say so itself: child-exit", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    const custody = {
      handoff: () => HANDOFF,
      // the tool, asked about a pid that is gone, says no: that no is about nothing
      async verifyChild(pid: number) {
        await waitDead(pid);
        return false;
      },
    };
    const error = await refusal(sup(root, events, { custody }, FIXTURE_EXIT_1), events);
    expect((error as SupervisorError).kind).toBe("child-exit");
    expect((error as Error).message).toContain("boom: fieldd refused to start");
    expect(events.some(notOurs)).toBe(false);
    expect(events.some(handed)).toBe(false);
  });

  it("stops asking the moment the attempt is given up, and hands nothing after", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    let asked: () => void = () => undefined;
    const askedOnce = new Promise<void>((resolve) => {
      asked = resolve;
    });
    let answered = false;
    const custody = {
      handoff: () => HANDOFF,
      // slow, and it would say yes
      async verifyChild() {
        asked();
        await delay(2_000);
        answered = true;
        return true;
      },
    };
    const given = new AbortController();
    const supervisor = sup(root, events, { custody });
    const outcome = supervisor.ensure({ signal: given.signal }).then(
      () => null,
      (failure: unknown) => failure,
    );
    await askedOnce;
    given.abort();
    const error = await outcome;
    h.trackPid(spawnedPid(events));
    // it did not wait for the tool: the attempt ended before the answer came
    expect(answered).toBe(false);
    expect((error as SupervisorError).kind).toBe("aborted");
    expect(await waitDead(spawnedPid(events) as number)).toBe(true);
    expect(events.some(handed)).toBe(false);
    expect(existsSync(sealedObservePath(root))).toBe(false);
  });

  it("names a refusal by a code, and repeats nothing of what the tool threw", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    // what a file error's message carries: an absolute path, which holds a person's home
    const canary = join(root, "planted", "canary-7f3a");
    const custody = {
      handoff: () => HANDOFF,
      verifyChild: async (): Promise<boolean> => {
        throw new Error(`ENOENT: no such file or directory, open '${canary}'`);
      },
    };
    const error = await refusal(sup(root, events, { custody }), events);
    expect((error as SupervisorError).kind).toBe("child-not-ours");
    // "refused" here, "over-budget" above: the log tells the two apart by this word and by nothing an error said
    expect(events.find(notOurs)).toMatchObject({ attrs: { reason: "refused" } });
    const said = JSON.stringify([events, String((error as Error).message)]);
    expect(said).not.toContain("canary-7f3a");
    expect(said).not.toContain("ENOENT");
  });

  // A pin, green before C6c and after it: the write's failure was already an outcome. FIXTURE_DEAF stands for a
  // child that already left, without the race of an exit: the pipe has no reader either way.
  it("takes a write the child will never read as an outcome, never a throw", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    const mark = join(root, "deaf.pid");
    const custody = {
      handoff: () => HANDOFF,
      // yes, but only once the child has shut its stdin: the write then goes to a pipe nobody reads
      async verifyChild() {
        while (!existsSync(mark)) await delay(10);
        return true;
      },
    };
    const extra = { custody, readinessDeadlineMs: 600 };
    const supervisor = sup(root, events, extra, FIXTURE_DEAF, { MARK_FILE: mark });
    const error = await refusal(supervisor, events);
    // the attempt ends as any start that never says ready ends: nothing threw at the write, and nothing was handed
    expect(error).toBeInstanceOf(SupervisorError);
    expect((error as SupervisorError).kind).toBe("readiness-timeout");
    expect(events.some(handed)).toBe(false);
    expect(await waitDead(spawnedPid(events) as number)).toBe(true);
  });
});

describe("a supervisor with no custody is today's", () => {
  it("sets no flag and writes nothing to the child's stdin", async () => {
    const root = h.mkRoot();
    const events: FielddSupervisorEvent[] = [];
    // the planted-listener mode needs no hand-off, so it boots, says what it saw, and writes no run files:
    // at `files` that is a readiness-timeout, which is all this row needs of it
    const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_SEALED);
    const supervisor = h.track(
      createFielddSupervisor({
        dataRoot: root,
        spawn: { command: process.execPath, args: [script] },
        environment: {
          CV: CONTRACTS_VERSION,
          OBSERVE_FILE: sealedObservePath(root),
          SEALED_MODE: "accept",
        },
        shutdownPolicy: "leave-running",
        adoptProbeMs: 300,
        readinessDeadlineMs: 900,
        liveness: false,
        onEvent: (event) => events.push(event),
      }),
    );
    const error = await refusal(supervisor, events);
    expect((error as SupervisorError).kind).toBe("readiness-timeout");
    const seen = readSealedObserved(root);
    expect(seen.custodyFlag).toBeNull();
    expect(seen.stdinAtMs).toBeNull();
    expect(seen.hellos).toEqual([]);
  });
});
