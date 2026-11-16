import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

/**
 * Item 482 (2026-11-16) — a subscription the handler refuses leaves nothing behind.
 *
 * Two handlers add their change listener BEFORE they await their snapshot, and a snapshot that
 * throws used to leave that listener on its emitter: `storage.settings.subscribe` (the plugin
 * settings service's `changed`, then a snapshot that answers NOT_FOUND for a plugin it does not
 * know) and `storage.appPreferences.subscribe` (the settings doc's `changed`, then the app values'
 * read). The door gives a refused ask's room back, so nothing counted those listeners: each
 * refused ask grew the emitter by one, for as long as the daemon ran. The listener stays added
 * before the await (a change between the read and the listener would be lost); a throw takes it
 * off again. Both rows count the emitter's listeners, before and after.
 */

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup = [];
});

/** The boot of `app-preferences.integration.test.ts`: its own temp root, a mock floor. */
async function boot(): Promise<FielddDaemon> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-listener-leak-"));
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

describe("item 482 — a refused subscription leaves no listener behind", () => {
  it("storage.settings.subscribe for 1,000 absent plugins: every one NOT_FOUND, and the settings service holds no listener more", async () => {
    const daemon = await boot();
    // The shell's grant carries `plugins.manage`, so `settingsCaller` takes the named plugin as
    // asked (it checks no record for a window or main) and the handler reaches `settings.on`;
    // the snapshot is what answers NOT_FOUND, for a plugin the registry does not hold.
    const shell = await connect(daemon, daemon.shellToken, "shell-main");
    const before = daemon.pluginSettings.listenerCount("changed");

    // one at a time: each refusal is the handler's, never the door's for room
    for (let n = 0; n < 1_000; n += 1) {
      const refused = await shell.callErr("storage.settings.subscribe", {
        pluginId: `absent-${n}`,
      });
      expect(refused.data?.kind, `ask ${n}`).toBe("NOT_FOUND");
    }

    expect(daemon.pluginSettings.listenerCount("changed")).toBe(before);
  }, 60_000);

  it("storage.appPreferences.subscribe whose snapshot fails: the ask refused, and the settings doc holds no listener more", async () => {
    const daemon = await boot();
    const shell = await connect(daemon, daemon.shellToken, "shell-main");
    const before = daemon.settingsDoc.listenerCount("changed");

    // The app values' read fails for the ask. It rejects for as long as the ask is out, not
    // once: a reader the boot left running could otherwise take the one rejection, and the row
    // would pass for the wrong reason. It is restored before the count is read.
    const appValues = vi
      .spyOn(daemon.settingsDoc, "appValues")
      .mockRejectedValue(new Error("the app values could not be read"));
    const refused = await shell.callErr("storage.appPreferences.subscribe", {});
    appValues.mockRestore();

    expect(refused.data?.kind).toBe("INTERNAL");
    expect(refused.message).toBe("the app values could not be read");
    expect(daemon.settingsDoc.listenerCount("changed")).toBe(before);

    // and the door is whole: the same ask, the read restored, is admitted
    const sub = (await shell.call("storage.appPreferences.subscribe", {})) as { subId: string };
    expect(typeof sub.subId).toBe("string");
    expect(daemon.settingsDoc.listenerCount("changed")).toBe(before + 1);
  });
});
