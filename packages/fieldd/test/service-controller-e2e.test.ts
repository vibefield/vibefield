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

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, "fixtures", "service-roots", "controller");
const pluginId = "vibefield.prc.controller";
const namespace = `x.${pluginId}`;

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup = [];
});

async function setup(): Promise<{ daemon: FielddDaemon; rpc: WsRpc }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-service-controller-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    pluginRoots: { bundled: [pluginRoot] },
  });
  cleanup.push(() => daemon.stop());
  await until(
    () =>
      daemon.plugins.snapshot().plugins.find((plugin) => plugin.id === pluginId)?.service ===
      "active",
    8_000,
  );
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, daemon.shellToken, "shell-main");
  return { daemon, rpc };
}

describe("ServiceHost controller through the real worker and grant API", () => {
  it("rotates a live product client for renderer-only movement and replaces service authority", {
    timeout: 30_000,
  }, async () => {
    const { daemon, rpc } = await setup();
    const instance = async (): Promise<string> =>
      ((await rpc.call(`${namespace}.instance`, {})) as { id: string }).id;
    const touch = async (value: string): Promise<unknown> =>
      await rpc.call(`${namespace}.touch`, { value });

    const first = await instance();
    await expect(touch("before")).resolves.toEqual({ value: "before" });

    await rpc.call("plugins.grants.set", {
      id: pluginId,
      capability: "shell.open",
      granted: false,
    });
    expect(await instance()).toBe(first);
    await expect(touch("rotated")).resolves.toEqual({ value: "rotated" });
    expect(daemon.services.snapshot().providers.map((provider) => provider.namespace)).toEqual([
      namespace,
    ]);

    await rpc.call("plugins.grants.set", {
      id: pluginId,
      capability: "process.spawn",
      granted: false,
    });
    const replaced = await instance();
    expect(replaced).not.toBe(first);
    await expect(touch("replaced")).resolves.toEqual({ value: "replaced" });
  });
});
