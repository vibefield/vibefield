import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAYOUT, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src";
import { SettingsDocService } from "../src/settings-doc";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup = [];
});

/** `seed` writes this test's own settings doc, in its own temp root, before the daemon boots. */
async function boot(
  seed?: (dataDir: string) => Promise<void>,
): Promise<{ daemon: FielddDaemon; dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-app-preferences-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  if (seed !== undefined) await seed(dataDir);
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await native.start();
  cleanup.push(() => native.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon, dataDir };
}

async function fixture(): Promise<FielddDaemon> {
  return (await boot()).daemon;
}

/** The plugins ledger's lines (JSONL) under this test's own data dir. */
function pluginsLedger(dataDir: string): Array<Record<string, unknown>> {
  const dir = join(dataDir, ...LAYOUT.AUDIT_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("plugins.") && f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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
      screenshotHotkey: true,
      syncPosture: "automatic",
      confirmQuit: true,
      connectAsks: true,
      keepRunningOnQuit: false,
      sounds: true,
      communityPlugins: false,
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
      screenshotHotkey: true,
      syncPosture: "automatic",
      confirmQuit: true,
      connectAsks: true,
      keepRunningOnQuit: false,
      sounds: true,
      communityPlugins: false,
    });

    const rendererGrant = daemon.tokens.mint(["settings.manage"], "test-window");
    const renderer = await connect(daemon, rendererGrant.token, "renderer");
    expect(await renderer.call("storage.appPreferences.get", {})).toEqual({
      showTray: false,
      backgroundShell: true,
      screenshotHotkey: true,
      syncPosture: "automatic",
      confirmQuit: true,
      connectAsks: true,
      keepRunningOnQuit: false,
      sounds: true,
      communityPlugins: false,
    });
    await renderer.call("storage.appPreferences.set", {
      key: "desktop.screenshotHotkey",
      value: false,
    });
    await until(() =>
      shell.notifications.some(
        (notification) =>
          notification.method === "storage.appPreferences.delta" &&
          notification.params.subId === sub.subId &&
          (notification.params.payload as { screenshotHotkey?: boolean } | undefined)
            ?.screenshotHotkey === false,
      ),
    );
    expect(await shell.call("storage.appPreferences.get", {})).toMatchObject({
      screenshotHotkey: false,
    });
  });

  it("quiets the sounds until a moment, and a null ends Quiet (SD-2, SD-D22)", async () => {
    const daemon = await fixture();
    const shell = await connect(daemon, daemon.shellToken, "shell-main");
    const until8 = Date.UTC(2026, 10, 6, 8);
    await shell.call("storage.appPreferences.set", {
      key: "desktop.soundsQuietUntil",
      value: until8,
    });
    expect(await shell.call("storage.appPreferences.get", {})).toMatchObject({
      sounds: true,
      soundsQuietUntil: until8,
    });
    await shell.call("storage.appPreferences.set", {
      key: "desktop.soundsQuietUntil",
      value: null,
    });
    const after = (await shell.call("storage.appPreferences.get", {})) as Record<string, unknown>;
    expect("soundsQuietUntil" in after).toBe(false);
    await shell.call("storage.appPreferences.set", { key: "desktop.sounds", value: false });
    expect(await shell.call("storage.appPreferences.get", {})).toMatchObject({ sounds: false });
    await expect(
      shell.call("storage.appPreferences.set", { key: "desktop.soundsQuietUntil", value: true }),
    ).rejects.toThrow();
  });

  it("refuses an ON for Community plugins until MK-4, lets an OFF through, audits each (D4, S2)", async () => {
    const { daemon, dataDir } = await boot();
    const shell = await connect(daemon, daemon.shellToken, "shell-main");
    const grant = daemon.tokens.mint(["settings.manage"], "test-window");
    const renderer = await connect(daemon, grant.token, "renderer");
    const refused = await shell.callErr("storage.appPreferences.set", {
      key: "plugins.community",
      value: true,
    });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(
      await renderer.call("storage.appPreferences.set", { key: "plugins.community", value: false }),
    ).toEqual({ ok: true });
    expect(await shell.call("storage.appPreferences.get", {})).toMatchObject({
      communityPlugins: false,
    });
    await until(
      () =>
        pluginsLedger(dataDir).filter(
          (l) => l.action === "plugin.community.set" && l.phase === "outcome",
        ).length === 2,
    );
    const lines = pluginsLedger(dataDir).filter((l) => l.action === "plugin.community.set");
    expect(lines.map((l) => l.phase)).toEqual(["attempt", "outcome", "attempt", "outcome"]);
    expect(lines[0]?.attrs).toEqual({
      preference: "plugins.community",
      value: true,
      principalKind: "shell-main",
      clientKind: "shell-main",
    });
    expect(lines[2]?.attrs).toEqual({
      preference: "plugins.community",
      value: false,
      principalKind: "local-token",
      clientKind: "renderer",
    });
    expect(lines[1]).toMatchObject({ outcome: "denied", reasonCode: "COMMUNITY_SWITCH_CLOSED" });
    expect(lines[3]).toMatchObject({ outcome: "succeeded" });
    expect(lines[3]?.reasonCode).toBeUndefined();
    const written = JSON.stringify(lines);
    expect(written.includes(daemon.shellToken)).toBe(false);
    expect(written.includes(grant.token)).toBe(false);
  });

  it("an ON found in the doc reads true, and the door can still turn it off ((D)'s residue)", async () => {
    const { daemon } = await boot(async (dataDir) => {
      const doc = new SettingsDocService({ dataDir });
      await doc.setAppValue("plugins.community", true, "test");
      await doc.dispose();
    });
    const shell = await connect(daemon, daemon.shellToken, "shell-main");
    expect(await shell.call("storage.appPreferences.get", {})).toMatchObject({
      communityPlugins: true,
    });
    await shell.call("storage.appPreferences.set", { key: "plugins.community", value: false });
    expect(await shell.call("storage.appPreferences.get", {})).toMatchObject({
      communityPlugins: false,
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
