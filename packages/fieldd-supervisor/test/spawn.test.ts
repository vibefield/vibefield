import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFielddSupervisor,
  type FielddSupervisorEvent,
  type FielddSupervisorOptions,
  SupervisorError,
} from "../src/index";
import {
  createHarness,
  FIXTURE_EXIT_1,
  FIXTURE_IDLE,
  FIXTURE_READY,
  type Harness,
  waitDead,
} from "./helpers";

// §12.2 spawn-when-none, child-exit-before-readiness, bounded readiness
// timeout, concurrent ensure() dedup, and the sun_path pre-spawn guard. The
// fixtures are real child processes (process.execPath) that stand in for
// fieldd: FIXTURE_READY writes run files pointing at the in-test ProductApi.

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

/** Grab the spawned pid out of the supervisor's own log line, so even a child
 * from a rejected ensure() gets cleaned up. */
function spawnedPid(events: FielddSupervisorEvent[]): number | undefined {
  const event = events.find(
    (candidate) =>
      candidate.kind === "lifecycle" && candidate.event === "fieldd.supervisor.spawned",
  );
  return event?.kind === "lifecycle" && typeof event.attrs?.["pid"] === "number"
    ? event.attrs["pid"]
    : undefined;
}

function trackSpawnedPid(events: FielddSupervisorEvent[]) {
  h.trackPid(spawnedPid(events));
}

function hasLifecycle(
  events: FielddSupervisorEvent[],
  event: Extract<FielddSupervisorEvent, { kind: "lifecycle" }>["event"],
): boolean {
  return events.some((candidate) => candidate.kind === "lifecycle" && candidate.event === event);
}

function spawnSup(
  root: string,
  fixture: string,
  env: Record<string, string | undefined>,
  events: FielddSupervisorEvent[],
  extra?: Partial<FielddSupervisorOptions>,
) {
  const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", fixture);
  return h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: [script] },
      environment: { CV: CONTRACTS_VERSION, ...env },
      shutdownPolicy: "leave-running",
      adoptProbeMs: 300,
      readinessDeadlineMs: 3000,
      onEvent: (event) => events.push(event),
      ...extra,
    }),
  );
}

describe("spawn: no adoptable fieldd exists", () => {
  it("spawns the fixture, reaches readiness, ownership spawned + childPid set", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    const logs: FielddSupervisorEvent[] = [];
    const sup = spawnSup(
      root,
      FIXTURE_READY,
      { TEST_PRODUCT_PORT: String(port), SHELL_TOKEN: token },
      logs,
    );

    const handle = await sup.ensure();
    trackSpawnedPid(logs);
    h.trackPid(handle.childPid);

    expect(handle.ownership).toBe("spawned");
    expect(handle.childPid).toBeGreaterThan(0);
    // readiness bound to the fixture's recorded (real) port
    expect(handle.info.port).toBe(port);
    expect(handle.info.pid).toBe(handle.childPid);
    expect(handle.client.status).toBe("ready");
    expect(logs.filter((event) => event.kind === "readiness")).toEqual([
      {
        kind: "readiness",
        signal: { ready: true, port, bootId: "boot-fixture" },
      },
    ]);
    expect(logs.some((event) => event.kind === "unexpected-stdout")).toBe(false);
  });

  it("passes the expected development build identity to a spawned fieldd", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    const logs: FielddSupervisorEvent[] = [];
    const sup = spawnSup(
      root,
      FIXTURE_READY,
      { TEST_PRODUCT_PORT: String(port), SHELL_TOKEN: token },
      logs,
      { expectedBuildId: "dev-spawn-current" },
    );

    const handle = await sup.ensure();
    trackSpawnedPid(logs);
    h.trackPid(handle.childPid);
    expect(handle.ownership).toBe("spawned");
    expect(handle.info.buildId).toBe("dev-spawn-current");
  });

  it("replaces dead run files from an older development build", async () => {
    const staleProduct = await h.startProduct();
    staleProduct.api.close();
    const liveProduct = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port: staleProduct.port,
      pid: 4242,
      token: staleProduct.token,
      buildId: "dev-stale",
    });
    const logs: FielddSupervisorEvent[] = [];
    const sup = spawnSup(
      root,
      FIXTURE_READY,
      {
        TEST_PRODUCT_PORT: String(liveProduct.port),
        SHELL_TOKEN: liveProduct.token,
      },
      logs,
      { expectedBuildId: "dev-current" },
    );

    const handle = await sup.ensure();
    h.trackPid(handle.childPid);
    expect(handle.ownership).toBe("spawned");
    expect(handle.info.buildId).toBe("dev-current");
  });

  it("child exits before readiness → rejects PROMPTLY with kind child-exit + stderr tail", async () => {
    const root = h.mkRoot();
    const logs: FielddSupervisorEvent[] = [];
    // no ProductApi: the fixture dies before it could ever become ready
    const sup = spawnSup(root, FIXTURE_EXIT_1, {}, logs, { readinessDeadlineMs: 5000 });

    const started = Date.now();
    const err = await sup.ensure().then(
      () => null,
      (e: unknown) => e,
    );
    trackSpawnedPid(logs);

    expect(err).toBeInstanceOf(SupervisorError);
    const se = err as SupervisorError;
    expect(se.kind).toBe("child-exit");
    expect(se.message).toContain("boom: fieldd refused to start"); // the stderr tail
    // prompt: nowhere near the 5s deadline (woke on the exit event)
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("never-ready child → bounded readiness-timeout with the probe detail", async () => {
    const root = h.mkRoot();
    const logs: FielddSupervisorEvent[] = [];
    const sup = spawnSup(root, FIXTURE_IDLE, {}, logs, {
      shutdownPolicy: "stop-owned",
      readinessDeadlineMs: 1500,
    });

    const started = Date.now();
    const err = await sup.ensure().then(
      () => null,
      (e: unknown) => e,
    );
    trackSpawnedPid(logs);

    expect(err).toBeInstanceOf(SupervisorError);
    const se = err as SupervisorError;
    expect(se.kind).toBe("readiness-timeout");
    expect(se.message).toContain("no-run-files"); // last probe detail
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(1400);
    expect(elapsed).toBeLessThan(4000); // honored the deadline (+ bounded stop)
    // review P1: the rejection must not leave the never-ready child running
    const pid = spawnedPid(logs);
    expect(pid).toBeGreaterThan(0);
    expect(await waitDead(pid as number)).toBe(true);
  });

  it("a timed-out attempt kills its child; a Retry spawns fresh — never two", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    const logs: FielddSupervisorEvent[] = [];
    // attempt 1: an idle stand-in that never becomes ready. leave-running on
    // purpose — the attempt-terminal stop is POLICY-INDEPENDENT (a child that
    // never reached readiness is no daemon; the two-plane law doesn't apply).
    const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_IDLE);
    const sup = h.track(
      createFielddSupervisor({
        dataRoot: root,
        spawn: { command: process.execPath, args: [script] },
        environment: { CV: CONTRACTS_VERSION, TEST_PRODUCT_PORT: String(port), SHELL_TOKEN: token },
        shutdownPolicy: "leave-running",
        adoptProbeMs: 200,
        readinessDeadlineMs: 900,
        onEvent: (event) => logs.push(event),
      }),
    );

    const err = await sup.ensure().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SupervisorError);
    expect((err as SupervisorError).kind).toBe("readiness-timeout");
    const pid1 = spawnedPid(logs);
    h.trackPid(pid1);
    expect(pid1).toBeGreaterThan(0);
    expect(await waitDead(pid1 as number)).toBe(true); // dead BEFORE the retry

    // attempt 2: the same script path now behaves like a healthy fieldd — the
    // retry must spawn fresh and own it, with exactly one child alive
    h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_READY);
    const handle = await sup.ensure();
    h.trackPid(handle.childPid);
    expect(handle.ownership).toBe("spawned");
    expect(handle.childPid).toBeGreaterThan(0);
    expect(handle.childPid).not.toBe(pid1);
    expect(handle.client.status).toBe("ready");
  });

  it("concurrent ensure() before readiness share ONE handle and spawn exactly once", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    const marker = join(root, "spawns.log");
    const logs: FielddSupervisorEvent[] = [];
    const sup = spawnSup(
      root,
      FIXTURE_READY,
      { TEST_PRODUCT_PORT: String(port), SHELL_TOKEN: token, SPAWN_MARKER: marker },
      logs,
    );

    const p1 = sup.ensure();
    const p2 = sup.ensure(); // second call while the first is in flight
    const [a, b] = await Promise.all([p1, p2]);
    trackSpawnedPid(logs);
    h.trackPid(a.childPid);

    expect(a).toBe(b); // the exact same live handle object
    // the marker got exactly one line: spawnFieldd ran once, not twice
    const starts = readFileSync(marker, "utf8").trim().split("\n").filter(Boolean);
    expect(starts).toHaveLength(1);
  });

  it("ignores observer failures so diagnostics cannot control daemon ownership", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_READY);
    const sup = h.track(
      createFielddSupervisor({
        dataRoot: root,
        spawn: { command: process.execPath, args: [script] },
        environment: {
          CV: CONTRACTS_VERSION,
          TEST_PRODUCT_PORT: String(port),
          SHELL_TOKEN: token,
        },
        shutdownPolicy: "leave-running",
        adoptProbeMs: 300,
        readinessDeadlineMs: 3_000,
        onEvent() {
          throw new Error("observer failure");
        },
      }),
    );

    const handle = await sup.ensure();
    h.trackPid(handle.childPid);
    expect(handle.ownership).toBe("spawned");
    expect(handle.client.status).toBe("ready");
  });

  it("loses the race (product.json pid ≠ ours) → adopts the incumbent, stops its own spawn", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    const logs: FielddSupervisorEvent[] = [];
    // the fixture writes a product.json whose pid is NOT its own (the test
    // runner's pid — alive and certainly different), so the supervisor concludes
    // another daemon already owns the root and must not claim ownership.
    const sup = spawnSup(
      root,
      FIXTURE_READY,
      { TEST_PRODUCT_PORT: String(port), SHELL_TOKEN: token, PID_OVERRIDE: String(process.pid) },
      logs,
    );

    const handle = await sup.ensure();
    const ourSpawn = spawnedPid(logs);
    h.trackPid(ourSpawn);

    expect(handle.ownership).toBe("adopted"); // never claims a daemon it didn't win
    expect(handle.childPid).toBeUndefined(); // no owned child on an adopted handle
    expect(handle.info.pid).toBe(process.pid); // the recorded (foreign) pid, verbatim
    expect(hasLifecycle(logs, "fieldd.supervisor.spawn_race_lost")).toBe(true);
    // the losing spawn is torn down, not orphaned
    expect(ourSpawn).toBeGreaterThan(0);
    expect(await waitDead(ourSpawn as number)).toBe(true);
    // and the adopted server still answers through the returned handle
    await expect(handle.client.request("system.health")).resolves.toMatchObject({ ok: true });
  });
});

describe("the sun_path guard (slice-0 finding 4)", () => {
  it("an over-long data root rejects data-root-too-long BEFORE any spawn", async () => {
    const root = h.mkLongRoot();
    const sentinel = join(root, "spawned-anyway");
    const logs: FielddSupervisorEvent[] = [];
    const sup = h.track(
      createFielddSupervisor({
        dataRoot: root,
        // if the guard failed to short-circuit, this spawn would create the file
        spawn: {
          command: process.execPath,
          args: ["--eval", `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "x")`],
        },
        environment: {},
        shutdownPolicy: "leave-running",
        readinessDeadlineMs: 2000,
        onEvent: (event) => logs.push(event),
      }),
    );

    const err = await sup.ensure().then(
      () => null,
      (e: unknown) => e,
    );
    trackSpawnedPid(logs);

    expect(err).toBeInstanceOf(SupervisorError);
    expect((err as SupervisorError).kind).toBe("data-root-too-long");
    expect(existsSync(sentinel)).toBe(false); // nothing was spawned
    expect(hasLifecycle(logs, "fieldd.supervisor.spawned")).toBe(false);
  });
});
