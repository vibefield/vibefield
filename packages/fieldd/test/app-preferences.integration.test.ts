import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup = [];
});

async function fixture(): Promise<FielddDaemon> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-app-preferences-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await native.start();
  cleanup.push(() => native.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0 });
  cleanup.push(() => daemon.stop());
  return daemon;
}

async function connect(
  daemon: FielddDaemon,
  token: string,
  clientKind: "shell-main" | "renderer" | "debug",
): Promise<WsRpc> {
  const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const rpc = new WsRpc(socket);
  await helloAs(rpc, token, clientKind);
  return rpc;
}

describe("trusted app preferences (D29′ desktop surface)", () => {
  it("returns effective defaults, persists a mutation, and streams the new snapshot", async () => {
    const daemon = await fixture();
    const shell = await connect(daemon, daemon.shellToken, "shell-main");
    const sub = (await shell.call("storage.appPreferences.subscribe", {})) as {
      subId: string;
      snapshot: { showTray: boolean; backgroundShell: boolean };
    };
    expect(sub.snapshot).toEqual({
      showTray: true,
      backgroundShell: true,
      syncPosture: "automatic",
    });

    await shell.call("storage.appPreferences.set", {
      key: "desktop.showTray",
      value: false,
    });
    await until(() =>
      shell.notifications.some(
        (notification) =>
          notification.method === "storage.appPreferences.delta" &&
          notification.params.subId === sub.subId &&
          (notification.params.payload as { showTray?: boolean } | undefined)?.showTray === false,
      ),
    );
    expect(await shell.call("storage.appPreferences.get", {})).toEqual({
      showTray: false,
      backgroundShell: true,
      syncPosture: "automatic",
    });

    const rendererGrant = daemon.tokens.mint(["settings.manage"], "test-window");
    const renderer = await connect(daemon, rendererGrant.token, "renderer");
    expect(await renderer.call("storage.appPreferences.get", {})).toEqual({
      showTray: false,
      backgroundShell: true,
      syncPosture: "automatic",
    });
  });

  it("requires both the local scope and a trusted desktop client kind", async () => {
    const daemon = await fixture();
    const debug = await connect(daemon, daemon.shellToken, "debug");
    expect((await debug.callErr("storage.appPreferences.get", {})).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );

    const pluginGrant = daemon.tokens.mint(["settings.manage"], "hostile-plugin", {
      pluginId: "vibefield.hostile",
    });
    const plugin = await connect(daemon, pluginGrant.token, "renderer");
    expect((await plugin.callErr("storage.appPreferences.get", {})).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
  });
});
