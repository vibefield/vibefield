import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type PluginRecord, type PluginRegistrySnapshot, SOCKETS } from "@vibefield/contracts";
import {
  buildFixtureRegistry,
  generateRegistryKeypair,
  packVfplugin,
  signRegistryIndex,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

// MK-O3, O3-C — the stop on a booted daemon (`mk-o3/PLAN-O3C.md` §4 test 3, accepted by VF-PM
// 2026-11-12 08:31:12Z; James's pick "Stop" on his docket, 2026-11-11 22:33:55Z). The plugin list
// is the test's own: the real example plugin packed into an index the test builds and signs with a
// key it makes, read over file://, in temp roots it removes. No network, no real data dir. Each
// boot is read as a window first reads it: the first `plugins.list` the API answers, which already
// stands after the second refresh.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const HERE = dirname(fileURLToPath(import.meta.url));
const KV_DIR = join(HERE, "..", "..", "..", "examples", "plugins", "kv-service");
const KV_ID = "vibefield.example.kv";

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("the stop on a booted daemon (MK-O3, O3-C)", () => {
  it("a plugin from the plugin list loads as VibeField's, is held as a community one, and is held with no list", {
    timeout: 120_000,
  }, async () => {
    // the test's own plugin list: the example plugin at VibeField's own rung
    const listDir = temp("vf-stop-list-");
    const { bytes } = await packVfplugin({ rootDir: KV_DIR });
    const keys = generateRegistryKeypair();
    const built = buildFixtureRegistry({
      dir: listDir,
      secretKey: keys.secretKey,
      plugins: [{ manifestDir: KV_DIR, artifactBytes: bytes, rung: "R1" }],
    });
    const listUrl = pathToFileURL(join(listDir, "index.json")).href;

    const dataDir = temp("vf-stop-data-");
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());

    let daemon: FielddDaemon | null = null;
    cleanup.push(async () => {
      if (daemon !== null) await daemon.stop();
    });
    /** Boots on the test's data dir, and answers the example plugin's row as the API's first
     * `plugins.list` says it. */
    const boot = async (install = false): Promise<PluginRecord | undefined> => {
      daemon = await bootstrap({
        dataDir,
        controlPort: 0,
        registryUrl: listUrl,
        registryPublicKey: keys.publicKey,
      });
      const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      try {
        const shell = new WsRpc(socket);
        await helloAs(shell, daemon.shellToken, "shell-main");
        const first = (await shell.call("plugins.list", {})) as PluginRegistrySnapshot;
        if (install) await shell.call("plugins.install", { id: KV_ID });
        const row = install
          ? ((await shell.call("plugins.get", { id: KV_ID })) as PluginRecord)
          : first.plugins.find((p) => p.id === KV_ID);
        return row;
      } finally {
        socket.close();
        await daemon.stop();
        daemon = null;
      }
    };
    const shape = (row: PluginRecord | undefined) => [row?.state, row?.enabled, row?.held];
    const LOADED = ["enabled", true, undefined];
    const HELD = ["disabled", false, "community-off"];

    // 1. installed while the list names it as VibeField's own: the install holds that list (O3-B),
    //    so it loads
    expect(shape(await boot(true))).toEqual(LOADED);
    // 2. the next boot: loaded in the first list the API answers
    expect(shape(await boot())).toEqual(LOADED);

    // 3. a newer list that no longer names it as VibeField's own, held as the catalog holds one:
    //    held, as if turned off, and the person's own switch is not written
    const index = JSON.parse(readFileSync(join(listDir, "index.json"), "utf8")) as {
      generatedAt: number;
      plugins: Record<string, Record<string, unknown>>;
    };
    index.generatedAt = built.index.generatedAt + 1;
    delete index.plugins[KV_ID]?.rung;
    const newer = Buffer.from(JSON.stringify(index), "utf8");
    const heldFile = join(dataDir, "plugins", "catalog", "held.json");
    expect(existsSync(heldFile)).toBe(true);
    writeFileSync(
      heldFile,
      JSON.stringify({
        signature: signRegistryIndex(newer, keys.secretKey),
        checkedAt: 1,
        index: newer.toString("base64"),
      }),
    );
    expect(shape(await boot())).toEqual(HELD);
    const recordsPath = join(dataDir, "fieldd", "plugins", "install-records.json");
    const records = existsSync(recordsPath)
      ? (JSON.parse(readFileSync(recordsPath, "utf8")) as {
          plugins: Record<string, { enabled?: boolean }>;
        })
      : { plugins: {} };
    expect(records.plugins[KV_ID]?.enabled).not.toBe(false);

    // 4. no list held at all: held
    rmSync(heldFile);
    expect(shape(await boot())).toEqual(HELD);
  });
});
