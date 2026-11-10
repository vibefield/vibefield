import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_VERSION, type CustodyHandoff } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFielddSupervisor,
  type FielddSupervisorEvent,
  type FielddSupervisorOptions,
  SupervisorError,
  tokenPath,
} from "../src/index";
import {
  createHarness,
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
