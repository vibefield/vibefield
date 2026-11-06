import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFielddSupervisor,
  type FielddSupervisorEvent,
  type FielddSupervisorOptions,
  productPath,
  runDir,
  SupervisorError,
  type SupervisorLifecycleEventName,
  tokenPath,
  tryAdopt,
} from "../src/index";
import { createHarness, FIXTURE_READY, type Harness } from "./helpers";

// §12.2 "valid adopt" + the tryAdopt failure taxonomy + "actual dynamic
// endpoint use" + re-attempt after the handle's client closes. Adoption needs
// only a live product server whose token verify accepts the shell token; spawn
// must never fire on these paths (a spawn command that would error if it did).

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

/** An adopt-only supervisor: if adoption works the spawn is never reached, so
 * the spawn command is an inert no-op. */
function adoptSup(root: string, extra?: Partial<FielddSupervisorOptions>) {
  return h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: ["--eval", ""] },
      environment: {},
      shutdownPolicy: "leave-running",
      adoptProbeMs: 800,
      readinessDeadlineMs: 3000,
      ...extra,
    }),
  );
}

/** Item 212 (RV #30) — a supervisor over a busy incumbent. Its spawn is a real FIXTURE_READY child that records its
 * start in SPAWN_MARKER, so a row can tell an adoption from a takeover; `react` sees each event as it is emitted. */
function busySup(
  root: string,
  product: { readonly port: number; readonly token: string },
  events: FielddSupervisorEvent[],
  react: (event: FielddSupervisorEvent) => void = () => undefined,
  extra?: Partial<FielddSupervisorOptions>,
) {
  const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_READY);
  return h.track(
    createFielddSupervisor({
      dataRoot: root,
      spawn: { command: process.execPath, args: [script] },
      environment: {
        CV: CONTRACTS_VERSION,
        TEST_PRODUCT_PORT: String(product.port),
        SHELL_TOKEN: product.token,
        SPAWN_MARKER: join(root, "spawns.log"),
      },
      shutdownPolicy: "leave-running",
      adoptProbeMs: 300,
      readinessDeadlineMs: 3000,
      onEvent: (event) => {
        events.push(event);
        react(event);
      },
      ...extra,
    }),
  );
}

function isLifecycle(event: FielddSupervisorEvent, name: SupervisorLifecycleEventName): boolean {
  return event.kind === "lifecycle" && event.event === name;
}

const lifecycleNames = (events: readonly FielddSupervisorEvent[]) =>
  events.flatMap((event) => (event.kind === "lifecycle" ? [event.event] : []));

function lifecycleAttrs(
  events: readonly FielddSupervisorEvent[],
  name: SupervisorLifecycleEventName,
) {
  const event = events.find((candidate) => isLifecycle(candidate, name));
  return event?.kind === "lifecycle" ? event.attrs : undefined;
}

/** The spawned child's pid from the supervisor's own line, so a row's spawn is reaped even when it was not owned. */
function spawnedPid(events: readonly FielddSupervisorEvent[]): number | undefined {
  const pid = lifecycleAttrs(events, "fieldd.supervisor.spawned")?.["pid"];
  return typeof pid === "number" ? pid : undefined;
}

describe("adopt: a live fieldd is discovered, not respawned", () => {
  it("valid adopt — ownership adopted, tolerant info, client READY, request flows", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    // an EXTRA unknown field must survive the tolerant (.passthrough) reader
    h.writeRunFiles(root, {
      port,
      pid: process.pid,
      token,
      extra: { futureField: "survives-passthrough" },
    });

    const handle = await adoptSup(root).ensure();

    expect(handle.ownership).toBe("adopted");
    expect(handle.childPid).toBeUndefined();
    expect(handle.info.port).toBe(port);
    expect(handle.info["futureField"]).toBe("survives-passthrough");
    expect(handle.client.status).toBe("ready");
    // a real request through the adopted client resolves against the server
    await expect(handle.client.request("system.health")).resolves.toEqual({
      ok: true,
      state: "READY",
    });
  });

  it("readiness uses product.json's ACTUAL bound port — no arithmetic", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid, token });
    const handle = await adoptSup(root).ensure();
    // the ephemeral port is whatever the OS bound; the handle reflects it exactly
    expect(handle.info.port).toBe(port);
    expect(port).toBeGreaterThan(0);
  });

  it("ensure() after the handle's client closes runs a NEW attempt", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid, token });
    const sup = adoptSup(root);

    const first = await sup.ensure();
    expect(first.client.status).toBe("ready");
    first.client.close(); // the live handle is now dead

    const second = await sup.ensure();
    expect(second).not.toBe(first); // a fresh attempt, not the closed handle
    expect(second.client.status).toBe("ready");
    await expect(second.client.request("system.health")).resolves.toMatchObject({ ok: true });
  });

  it("adopts only the development build identity the caller expects", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port,
      pid: process.pid,
      token,
      buildId: "dev-current",
    });

    const handle = await adoptSup(root, { expectedBuildId: "dev-current" }).ensure();
    expect(handle.ownership).toBe("adopted");
    expect(handle.info.buildId).toBe("dev-current");
  });

  it("an adopted fieldd that stops answering is said unresponsive, then wedged, and never signalled (item 212, RV #67; ESR §5.3)", async () => {
    const { port, token } = await h.startProduct({ health: "never" });
    const root = h.mkRoot();
    // the recorded pid is THIS test process: alive, and a signal sent to it would end the test
    h.writeRunFiles(root, { port, pid: process.pid, token });
    const events: FielddSupervisorEvent[] = [];
    const handle = await adoptSup(root, {
      liveness: { intervalMs: 200, missThreshold: 2, confirmMs: 1_000 },
      onEvent: (event) => events.push(event),
    }).ensure();
    expect(handle.ownership).toBe("adopted");
    const heard: string[] = [];
    handle.onLiveness((liveness) => heard.push(liveness.kind));

    await expect.poll(() => handle.liveness.kind, { timeout: 8_000 }).toBe("wedged");
    expect(heard).toEqual(["unresponsive", "wedged"]);
    // only said: no ladder for a fieldd this shell did not start, and its client is left as it stands
    expect(lifecycleNames(events)).not.toContain("fieldd.supervisor.wedge_killed");
    expect(lifecycleNames(events)).not.toContain("fieldd.supervisor.stop_requested");
    expect(handle.client.status).toBe("ready");
  }, 15_000);
});

describe("tryAdopt: the non-adoption taxonomy (§12.2)", () => {
  it("no run files → no-run-files", async () => {
    const probe = await tryAdopt(h.mkRoot(), 300);
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.failure).toBe("no-run-files");
  });

  it("invalid JSON in product.json → malformed-product", async () => {
    const root = h.mkRoot();
    mkdirSync(runDir(root), { recursive: true });
    writeFileSync(tokenPath(root), "a-token");
    writeFileSync(productPath(root), "{ this is not json ]");
    const probe = await tryAdopt(root, 300);
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.failure).toBe("malformed-product");
  });

  it("schema-violating product.json → malformed-product", async () => {
    const root = h.mkRoot();
    mkdirSync(runDir(root), { recursive: true });
    writeFileSync(tokenPath(root), "a-token");
    // valid JSON, but `port` is missing / non-positive → ProductInfo rejects it
    writeFileSync(productPath(root), JSON.stringify({ pid: 10, bootId: "b" }));
    const probe = await tryAdopt(root, 300);
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.failure).toBe("malformed-product");
  });

  it("a different development build is rejected from adoption", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port,
      pid: process.pid,
      token,
      buildId: "dev-stale",
    });

    const probe = await tryAdopt(root, 800, undefined, "dev-current");
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.failure).toBe("incompatible-build");
  });

  it("never spawns over a live daemon from a different development build", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port,
      pid: process.pid,
      token,
      buildId: "dev-stale",
    });
    const supervisor = adoptSup(root, { expectedBuildId: "dev-current" });

    const error = await supervisor.ensure().then(
      () => null,
      (candidate: unknown) => candidate,
    );
    expect(error).toBeInstanceOf(SupervisorError);
    expect((error as SupervisorError).kind).toBe("incompatible-build");
    expect((error as SupervisorError).probe).toBe("incompatible-build");
  });

  it("a legacy or production product is incompatible only when a dev build is required", async () => {
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: process.pid, token, buildId: null });

    const devProbe = await tryAdopt(root, 800, undefined, "dev-current");
    expect(devProbe.ok).toBe(false);
    if (!devProbe.ok) expect(devProbe.failure).toBe("incompatible-build");

    const productionProbe = await tryAdopt(root, 800);
    expect(productionProbe.ok).toBe(true);
    if (productionProbe.ok) productionProbe.client.close();
  });

  it("a live listener that REJECTS the shell token → foreign-listener (EL7)", async () => {
    const { port, token } = await h.startProduct({ verify: () => null });
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: 4242, token });
    const probe = await tryAdopt(root, 800);
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.failure).toBe("foreign-listener");
  });

  it("run files pointing at a CLOSED port → stale-files (one-shot dial verdict)", async () => {
    // A ProductApi we boot then close leaves the recorded port dead. The
    // client schedules a reconnect on the refused dial; the probe reads that
    // first "reconnecting" transition as its verdict — stale run files —
    // instead of riding the timer into a misleading probe-timeout.
    const { api, port, token } = await h.startProduct();
    const root = h.mkRoot();
    h.writeRunFiles(root, { port, pid: 4242, token });
    api.close();
    const started = Date.now();
    const probe = await tryAdopt(root, 800);
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.failure).toBe("stale-files");
    // and FAST — the verdict lands on the failed dial, well before probeMs
    expect(Date.now() - started).toBeLessThan(700);
  });
});

// Item 212 (RV #30, gap3-2) — the busy incumbent's kill matrix. A probe-timeout is a listener that took the dial and
// not the hello inside the budget: a fieldd BUSY, not gone. Its recorded pid is asked whether it exists (`kill(pid,
// 0)`, which delivers no signal) and it is waited on as long as a spawn is waited for (the readiness bound); then a
// named takeover. Each row is driven by the supervisor's own events and the gate, never a sleep: the incumbent answers
// when the test opens the gate, and not before.
describe("the busy incumbent's kill matrix (item 212, RV #30): a probe-timeout is busy, not gone", () => {
  const PATIENCE_MS = 2_500;

  it("row 1 — a LIVE incumbent busy past the first probe is waited for and adopted when it answers, never superseded", async () => {
    const product = await h.startProduct();
    const gate = await h.startGatedProxy(product.port);
    const root = h.mkRoot();
    h.writeRunFiles(root, {
      port: gate.port,
      pid: process.pid,
      token: product.token,
      bootId: "incumbent",
    });
    const events: FielddSupervisorEvent[] = [];
    // the incumbent answers once the supervisor says it waits: after the first probe gave up, never before
    const sup = busySup(root, product, events, (event) => {
      if (isLifecycle(event, "fieldd.supervisor.adopt_waiting")) gate.open();
    });

    const handle = await sup.ensure();
    h.trackPid(handle.childPid);
    h.trackPid(spawnedPid(events));

    expect(handle.ownership).toBe("adopted");
    expect(handle.info.bootId).toBe("incumbent");
    expect(lifecycleNames(events)).toEqual(
      expect.arrayContaining([
        "fieldd.supervisor.adopt_waiting",
        "fieldd.supervisor.adopted",
        "fieldd.supervisor.adopted_after_wait",
      ]),
    );
    expect(lifecycleNames(events)).not.toContain("fieldd.supervisor.spawned");
    expect(existsSync(join(root, "spawns.log"))).toBe(false);
    // the adopted client is the incumbent's, through its one port
    await expect(handle.client.request("system.health")).resolves.toMatchObject({ ok: true });
  });

  it("row 2 — a DEAD incumbent (its recorded pid an exited child's) ends the wait at once, and the spawn is plain", async () => {
    const product = await h.startProduct();
    // never opened: the dial is taken, the hello never answered
    const gate = await h.startGatedProxy(product.port);
    const root = h.mkRoot();
    // a pid that WAS a process: spawnSync returns once its child has exited and been reaped
    const dead = spawnSync(process.execPath, ["--eval", ""]).pid;
    h.writeRunFiles(root, {
      port: gate.port,
      pid: dead,
      token: product.token,
      bootId: "incumbent",
    });
    const events: FielddSupervisorEvent[] = [];
    const sup = busySup(root, product, events, undefined, { readinessDeadlineMs: PATIENCE_MS });

    const handle = await sup.ensure();
    h.trackPid(handle.childPid);
    h.trackPid(spawnedPid(events));

    expect(lifecycleNames(events)).toContain("fieldd.supervisor.incumbent_gone");
    const gone = lifecycleAttrs(events, "fieldd.supervisor.incumbent_gone");
    expect(gone).toMatchObject({ pid: dead });
    // at once: the existence check comes before any second probe, far inside the patience
    expect(gone?.["waitedMs"]).toBeLessThan(PATIENCE_MS / 2);
    // nothing live was superseded, so nothing is named a takeover
    expect(lifecycleNames(events)).not.toContain("fieldd.supervisor.takeover");
    expect(handle.ownership).toBe("spawned");
  }, 15_000);

  it("row 3 — a SILENT listener past the patience is a named takeover: the bound delays the spawn, never blocks it (EL7)", async () => {
    const product = await h.startProduct();
    const gate = await h.startGatedProxy(product.port); // never opened: silent past the patience
    const root = h.mkRoot();
    // the recorded pid is THIS test process: alive, and a signal sent to it would end the test
    h.writeRunFiles(root, {
      port: gate.port,
      pid: process.pid,
      token: product.token,
      bootId: "incumbent",
    });
    const events: FielddSupervisorEvent[] = [];
    const sup = busySup(root, product, events, undefined, { readinessDeadlineMs: PATIENCE_MS });

    const handle = await sup.ensure();
    h.trackPid(handle.childPid);
    h.trackPid(spawnedPid(events));

    expect(lifecycleNames(events)).toContain("fieldd.supervisor.takeover");
    const takeover = lifecycleAttrs(events, "fieldd.supervisor.takeover");
    expect(takeover).toMatchObject({ probeFailure: "probe-timeout" });
    // waited the whole patience, the bound a spawn is given — no new constant
    expect(takeover?.["waitedMs"]).toBeGreaterThanOrEqual(PATIENCE_MS - 50);
    expect(lifecycleNames(events)).toContain("fieldd.supervisor.adopt_waiting");
    expect(lifecycleNames(events)).not.toContain("fieldd.supervisor.incumbent_gone");
    expect(handle.ownership).toBe("spawned");
  }, 15_000);
});
