import { join } from "node:path";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFielddSupervisor,
  type FielddSupervisorOptions,
  SupervisorError,
} from "../src/index";
import { createHarness, FIXTURE_IDLE, type Harness } from "./helpers";

// §12.2 abort during probe/readiness, dispose() cancelling an in-flight
// ensure() (and stopping the child it spawned), and idempotent dispose. The
// idle fixture never becomes ready, so ensure() sits in the readiness loop
// exactly where cancellation must bite.

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function spawnedPid(logs: string[]): number | undefined {
  const m = logs.join("\n").match(/spawned fieldd pid=(\d+)/);
  return m ? Number(m[1]) : undefined;
}

function idleSup(root: string, logs: string[], extra?: Partial<FielddSupervisorOptions>) {
  const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_IDLE);
  return h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: [script] },
      environment: { CV: CONTRACTS_VERSION },
      shutdownPolicy: "stop-owned",
      adoptProbeMs: 300,
      readinessDeadlineMs: 10_000, // long: the abort/dispose must be what ends it
      onLog: (l) => logs.push(l),
      ...extra,
    }),
  );
}

describe("cancellation", () => {
  it("an external AbortSignal fired during readiness rejects with kind aborted", async () => {
    const root = h.mkRoot();
    const logs: string[] = [];
    const sup = idleSup(root, logs);
    const ac = new AbortController();

    const started = Date.now();
    // attach the settling handler UP FRONT so the eventual rejection is never
    // momentarily unhandled (which vitest would flag as an error)
    const settled = sup.ensure({ signal: ac.signal }).then(
      () => null,
      (e: unknown) => e,
    );
    await sleep(300); // let it spawn and enter the readiness loop
    ac.abort();

    const err = await settled;
    h.trackPid(spawnedPid(logs));

    expect(err).toBeInstanceOf(SupervisorError);
    expect((err as SupervisorError).kind).toBe("aborted");
    // it ended on the abort, nowhere near the 10s deadline
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("dispose() during an in-flight ensure() rejects it AND stops the spawned child", async () => {
    const root = h.mkRoot();
    const logs: string[] = [];
    const sup = idleSup(root, logs);

    // handle the rejection up front: dispose() rejects the in-flight ensure()
    // during its own await, so a handler attached afterward would leave a
    // window where the rejection is unhandled
    const settled = sup.ensure().then(
      () => null,
      (e: unknown) => e,
    );
    await sleep(300); // ensure the child is spawned and logged
    const pid = spawnedPid(logs);
    expect(pid).toBeGreaterThan(0);
    h.trackPid(pid); // backstop if dispose somehow doesn't reap it

    await sup.dispose(); // aborts the in-flight run AND (stop-owned) kills the child

    const err = await settled;
    expect(err).toBeInstanceOf(SupervisorError);
    expect((err as SupervisorError).kind).toBe("aborted");

    // the in-flight spawned child is dead after dispose resolves
    let childAlive = true;
    try {
      process.kill(pid as number, 0);
    } catch {
      childAlive = false;
    }
    expect(childAlive).toBe(false);
  });

  it("a signal already aborted BEFORE ensure() rejects immediately with aborted", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid, token });
    const sup = h.track(
      createFielddSupervisor({
        dataRoot: root,
        spawn: { command: process.execPath, args: ["--eval", ""] },
        environment: {},
        shutdownPolicy: "leave-running",
        readinessDeadlineMs: 3000,
      }),
    );
    const err = await sup.ensure({ signal: AbortSignal.abort() }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SupervisorError);
    expect((err as SupervisorError).kind).toBe("aborted");
  });

  it("dispose() is idempotent — a second call does not throw", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid, token });
    const sup = h.track(
      createFielddSupervisor({
        dataRoot: root,
        spawn: { command: process.execPath, args: ["--eval", ""] },
        environment: {},
        shutdownPolicy: "stop-owned",
        adoptProbeMs: 800,
        readinessDeadlineMs: 3000,
      }),
    );
    await sup.ensure();
    await expect(sup.dispose()).resolves.toBeUndefined();
    await expect(sup.dispose()).resolves.toBeUndefined();
  });

  it("ensure() after dispose() rejects with kind disposed", async () => {
    const root = h.mkRoot();
    const sup = h.track(
      createFielddSupervisor({
        dataRoot: root,
        spawn: { command: process.execPath, args: ["--eval", ""] },
        environment: {},
        shutdownPolicy: "leave-running",
        readinessDeadlineMs: 3000,
      }),
    );
    await sup.dispose();
    const err = await sup.ensure().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SupervisorError);
    expect((err as SupervisorError).kind).toBe("disposed");
  });
});
