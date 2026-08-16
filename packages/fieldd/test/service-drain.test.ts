import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

// PRC-E16 promoted from draft: every row boots the real daemon, router, product fabric, worker
// harness, shared ActivationScope, and a child-bound fixture whose cleanup remains open for 250ms.

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, "fixtures", "service-roots", "drain");
const id = "vibefield.prc.drain-control";
const namespace = "x.vibefield.prc.drain-control";
let cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup = [];
});

async function setup(): Promise<FielddDaemon> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-prc-drain-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    pluginRoots: { devLinked: [pluginRoot] },
  });
  cleanup.push(() => daemon.stop());
  return daemon;
}

async function openRpc(daemon: FielddDaemon): Promise<WsRpc> {
  const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const rpc = new WsRpc(socket);
  await helloAs(rpc, daemon.shellToken, "shell-main");
  return rpc;
}

const serviceState = (daemon: FielddDaemon): string =>
  daemon.plugins.snapshot().plugins.find((plugin) => plugin.id === id)?.service ?? "missing";
const routePublished = (daemon: FielddDaemon): boolean =>
  daemon.services.snapshot().providers.some((provider) => provider.namespace === namespace);

describe("ServiceHost route drain (PRC-2 / §18.2)", () => {
  it("disable enters the shared typed drain before worker cleanup", async () => {
    const daemon = await setup();
    await until(() => serviceState(daemon) === "active", 8_000);
    const rpc = await openRpc(daemon);

    const disabling = rpc.call("plugins.disable", { id });
    let disabled = false;
    void disabling.then(
      () => {
        disabled = true;
      },
      () => {
        disabled = true;
      },
    );
    await until(() => !routePublished(daemon), 2_000);
    expect(disabled).toBe(false);
    const during = await rpc.callErr(`${namespace}.echo`, { msg: "during-drain" });

    expect(during.data?.kind).toBe("UNAVAILABLE");
    await disabling;
    expect(serviceState(daemon)).toBe("inactive");
  });

  it("reload refuses new calls and unrelated messages cannot mask the correlated acknowledgement", {
    timeout: 15_000,
  }, async () => {
    const daemon = await setup();
    await until(() => serviceState(daemon) === "active", 8_000);
    const rpc = await openRpc(daemon);

    const startedAt = Date.now();
    const reloading = rpc.call("plugins.reload", { id });
    let reloaded = false;
    void reloading.then(
      () => {
        reloaded = true;
      },
      () => {
        reloaded = true;
      },
    );
    await until(() => !routePublished(daemon), 2_000);
    expect(reloaded).toBe(false);
    const during = await rpc.callErr(`${namespace}.echo`, { msg: "during-drain" });

    expect(during.data?.kind).toBe("UNAVAILABLE");
    await reloading;
    expect(Date.now() - startedAt).toBeLessThan(1_500);
    await until(() => serviceState(daemon) === "active", 8_000);
  });

  it("lets an admitted old-generation call settle before teardown", async () => {
    const daemon = await setup();
    await until(() => serviceState(daemon) === "active", 8_000);
    const rpc = await openRpc(daemon);

    const oldCall = rpc.call(`${namespace}.slow`, { msg: "old", delayMs: 150 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const startedAt = Date.now();
    const reloading = rpc.call("plugins.reload", { id });
    await until(() => !routePublished(daemon), 2_000);

    expect((await rpc.callErr(`${namespace}.echo`, { msg: "new" })).data?.kind).toBe("UNAVAILABLE");
    await expect(oldCall).resolves.toEqual({ echo: "old" });
    await reloading;
    expect(Date.now() - startedAt).toBeLessThan(1_500);
    await until(() => serviceState(daemon) === "active", 8_000);
  });

  it("gives an active subscription exactly one terminal outcome", async () => {
    const daemon = await setup();
    await until(() => serviceState(daemon) === "active", 8_000);
    const rpc = await openRpc(daemon);
    const sub = (await rpc.call(`${namespace}.ticks`, {})) as {
      subId: string;
      snapshot: { kind: string; value: { n: number } };
    };
    expect(sub.snapshot).toEqual({ kind: "snapshot", value: { n: 0 } });

    const startedAt = Date.now();
    const reloading = rpc.call("plugins.reload", { id });
    let reloaded = false;
    void reloading.then(
      () => {
        reloaded = true;
      },
      () => {
        reloaded = true;
      },
    );
    await until(
      () =>
        rpc.notifications.some(
          (notification) =>
            notification.params.subId === sub.subId &&
            (notification.params.payload as { kind?: string })?.kind === "unavailable",
        ),
      2_000,
    );
    expect(reloaded).toBe(false);
    expect(
      rpc.notifications.some(
        (notification) =>
          notification.params.subId === sub.subId &&
          (notification.params.payload as { kind?: string })?.kind === "unavailable",
      ),
    ).toBe(true);
    await reloading;
    expect(Date.now() - startedAt).toBeLessThan(1_500);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const terminal = rpc.notifications.filter(
      (notification) =>
        notification.params.subId === sub.subId &&
        (notification.params.payload as { kind?: string })?.kind === "unavailable",
    );
    expect(terminal).toHaveLength(1);
    await until(() => serviceState(daemon) === "active", 8_000);
  });
});
