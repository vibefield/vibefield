import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFielddSupervisor,
  type FielddSupervisorOptions,
  productPath,
  runDir,
  tokenPath,
  tryAdopt,
} from "../src/index";
import { createHarness, type Harness } from "./helpers";

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
