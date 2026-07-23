import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { helloAs, until, WsRpc } from "./ws-rpc";

// PLUG-P4 — the worker host end-to-end (spec §14.2/§18): a REAL worker runs
// the fixture service (fixtures/service-roots/svc/alpha), provides
// x.vibefield.fixture.svc.*, and the suite drives activation → round trip →
// sanitized provider errors → §14.5 subscription conformance → the §18.3
// crash ladder to quarantine → re-enable clears → §16.5 disable deactivates.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SVC_ROOT = join(HERE, "fixtures", "service-roots", "svc");
const NS = "x.vibefield.fixture.svc";
const ID = "vibefield.fixture.svc";

async function setup(): Promise<{
  daemon: FielddDaemon;
  pluginLogs: Array<{ pluginId: string; level: string; message: string }>;
}> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-svchost-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
  await mock.start();
  cleanup.push(() => mock.stop());
  const pluginLogs: Array<{ pluginId: string; level: string; message: string }> = [];
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    pluginRoots: { bundled: [SVC_ROOT] },
    pluginLog: (record) => pluginLogs.push(record),
  });
  cleanup.push(() => daemon.stop());
  return { daemon, pluginLogs };
}

async function openRpc(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

const serviceState = (daemon: FielddDaemon): string =>
  daemon.plugins.snapshot().plugins.find((p) => p.id === ID)?.service ?? "missing";

describe("ServiceHost — the worker end-to-end (§14.2)", () => {
  it("activates onStartup, serves x.* round-trips, sanitizes provider errors, streams §14.5 subs", async () => {
    const { daemon, pluginLogs } = await setup();
    // startEligible is fire-and-forget — the state stream is the truth
    await until(() => serviceState(daemon) === "active", 8000);
    expect(pluginLogs).toContainEqual({
      pluginId: ID,
      level: "info",
      message: "[stdout] fixture service stdout",
    });
    expect(daemon.services.snapshot().providers.map((p) => p.namespace)).toEqual([NS]);

    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");

    // the round trip (shell principal passes custom-cap gates — recorded v1)
    const echoed = (await rpc.call(`${NS}.echo`, { msg: "hello" })) as { echo: string };
    expect(echoed).toEqual({ echo: "hello" });

    // input schema refusal happens HOST-side, before the worker sees it
    const bad = await rpc.callErr(`${NS}.echo`, { msg: 7 });
    expect(bad.data?.kind).toBe("PRECONDITION_FAILED");

    // a throwing handler is a sanitized INTERNAL, the worker survives
    const boom = await rpc.callErr(`${NS}.boom`, {});
    expect(boom.data?.kind).toBe("INTERNAL");
    expect(boom.message).toContain("boom");
    expect(serviceState(daemon)).toBe("active");

    // §14.5 — snapshot-then-delta, schema-validated
    const sub = (await rpc.call(`${NS}.ticks`, {})) as {
      subId: string;
      snapshot: { kind: string; value: { n: number } };
    };
    expect(sub.snapshot.kind).toBe("snapshot");
    expect(sub.snapshot.value).toEqual({ n: 0 });
    await until(() =>
      rpc.notifications.some(
        (n) =>
          n.params.subId === sub.subId && (n.params.payload as { kind?: string })?.kind === "delta",
      ),
    );
    await rpc.call("system.unsubscribe", { subId: sub.subId });
  });

  it("climbs the §18.3 ladder to quarantine, re-enable clears, disable deactivates (§16.5)", async () => {
    const { daemon } = await setup();
    await until(() => serviceState(daemon) === "active", 8000);
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");

    // die REPLIES before the worker's delayed exit — always wait for the state
    // to LEAVE active first, or the next call lands on the dying generation
    const crash = async () => {
      await rpc.call(`${NS}.die`, {});
      await until(() => serviceState(daemon) !== "active", 5000);
    };

    // crash 1: die → worker exits → providers withdraw → restart after ~1s
    await crash();
    expect(serviceState(daemon)).toBe("restarting");
    // a withdrawn provider answers NOT_FOUND, never a hang
    const gone = await rpc.callErr(`${NS}.echo`, { msg: "x" });
    expect(gone.data?.kind).toBe("NOT_FOUND");
    await until(() => serviceState(daemon) === "active", 8000);

    // crash 2 → backoff 2s → active again
    await crash();
    await until(() => serviceState(daemon) === "active", 12000);

    // crash 3 inside the window → quarantined, no restart
    await crash();
    await until(() => serviceState(daemon) === "quarantined", 8000);
    await new Promise((r) => setTimeout(r, 1200)); // no silent resurrection
    expect(serviceState(daemon)).toBe("quarantined");

    // §18.3 — an explicit re-enable clears quarantine and restarts fresh
    await rpc.call("plugins.enable", { id: ID });
    await until(() => serviceState(daemon) === "active", 8000);
    const back = (await rpc.call(`${NS}.echo`, { msg: "again" })) as { echo: string };
    expect(back).toEqual({ echo: "again" });

    // §16.5 — disable deactivates the worker and withdraws providers
    await rpc.call("plugins.disable", { id: ID });
    await until(() => serviceState(daemon) === "inactive", 8000);
    expect(daemon.services.snapshot().providers).toEqual([]);
    const off = await rpc.callErr(`${NS}.echo`, { msg: "x" });
    expect(off.data?.kind).toBe("NOT_FOUND");
  }, 60_000);
});

describe("the example KV service — a real plugin through the real host", () => {
  // the one seam the SDK mock cannot prove: the WORKER importing service.js
  // from examples/plugins resolves @vibefield/plugin-sdk via the package's own
  // workspace link, activates, and serves over the product surface
  // generous cap: the worker's FIRST product dial type-strips the whole
  // contracts+zod graph in-worker before hello (dev-source mode only)
  it("dev-linked kv-service activates and round-trips set/get/watch", {
    timeout: 30_000,
  }, async () => {
    const EXAMPLES = join(HERE, "..", "..", "..", "examples", "plugins");
    const dataDir = mkdtempSync(join(tmpdir(), "vf-kv-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
    await mock.start();
    cleanup.push(() => mock.stop());
    const daemon = await bootstrap({
      dataDir,
      controlPort: 0,
      pluginRoots: { devLinked: [EXAMPLES] },
    });
    cleanup.push(() => daemon.stop());
    const kvState = () =>
      daemon.plugins.snapshot().plugins.find((p) => p.id === "vibefield.example.kv")?.service;
    await until(() => kvState() === "active", 8000);

    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    const kv = "x.vibefield.example.kv";
    expect(await rpc.call(`${kv}.get`, { key: "a" })).toEqual({ value: null });
    const sub = (await rpc.call(`${kv}.watch`, { key: "a" })) as {
      subId: string;
      snapshot: { kind: string; value: { value: string | null } };
    };
    expect(sub.snapshot).toEqual({ kind: "snapshot", value: { value: null } });
    expect(await rpc.call(`${kv}.set`, { key: "a", value: "1" })).toEqual({ ok: true });
    expect(await rpc.call(`${kv}.get`, { key: "a" })).toEqual({ value: "1" });
    await until(() =>
      rpc.notifications.some(
        (n) =>
          n.params.subId === sub.subId &&
          JSON.stringify((n.params.payload as { value?: unknown })?.value) ===
            JSON.stringify({ value: "1" }),
      ),
    );
  });
});
