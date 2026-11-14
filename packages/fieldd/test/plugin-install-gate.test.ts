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
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LAYOUT, type RegistryIndex, SOCKETS } from "@vibefield/contracts";
import {
  buildFixtureRegistry,
  generateRegistryKeypair,
  packVfplugin,
  signRegistryIndex,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { AuditService } from "../src/audit-service";
import { bootstrap } from "../src/index";
import { InstallSetReconciler } from "../src/install-reconciler";
import { PLUGIN_CURRENT_POINTER_FILE } from "../src/plugin-artifact-store";
import { PluginCatalogService } from "../src/plugin-catalog";
import { CommunityHold } from "../src/plugin-community-hold";
import { RegistryInstallService } from "../src/plugin-install";
import { PluginRegistryService } from "../src/plugin-registry";
import type { SettingsDocService } from "../src/settings-doc";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { type CapturedLog, captureLogger } from "./drive-fakes";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

// MK-2c — the install gate (MK-2's custody note §1 G1, G2, G4; VF-PM 2026-11-11 08:48:07Z, 10:08:59Z, 10:12:49Z).
// Every registry here is the test's own: the real example plugin packed into an index the test builds and signs with
// a key it makes, read over file:// or through an injected fetch, in temp roots it removes. No network, no real data
// dir, no child. The gate opens two ways: a predicate a test hands to an installer it builds itself, and, in the
// doors' test, the daemon's own switch turned on through its door once the switch is drawn (MK-O3D).

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const HERE = dirname(fileURLToPath(import.meta.url));
const KV_DIR = join(HERE, "..", "..", "..", "examples", "plugins", "kv-service");
const KV_ID = "vibefield.example.kv";
const CLOSED = {
  pluginKind: "PLUGIN_CAPABILITY_DENIED",
  reasonCode: "COMMUNITY_SWITCH_CLOSED",
};

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

type Keys = ReturnType<typeof generateRegistryKeypair>;

interface Registry {
  dir: string;
  url: string;
  keys: Keys;
  index: RegistryIndex;
}

/** The test's own registry: the example plugin, listed at `rung` (absent: no rung, so community). */
async function registry(rung?: "R1"): Promise<Registry> {
  const dir = temp("vf-gate-registry-");
  const { bytes } = await packVfplugin({ rootDir: KV_DIR });
  const keys = generateRegistryKeypair();
  const built = buildFixtureRegistry({
    dir,
    secretKey: keys.secretKey,
    plugins: [
      { manifestDir: KV_DIR, artifactBytes: bytes, ...(rung !== undefined ? { rung } : {}) },
    ],
  });
  return { dir, url: pathToFileURL(join(dir, "index.json")).href, keys, index: built.index };
}

/** Changes the test's own index and signs the new bytes with the test's own key. */
function resign(reg: Registry, change: (index: Record<string, unknown>) => void): void {
  const index = JSON.parse(readFileSync(join(reg.dir, "index.json"), "utf8")) as Record<
    string,
    unknown
  >;
  change(index);
  const bytes = Buffer.from(JSON.stringify(index), "utf8");
  writeFileSync(join(reg.dir, "index.json"), bytes);
  writeFileSync(join(reg.dir, "index.json.sig"), signRegistryIndex(bytes, reg.keys.secretKey));
}

async function installerFor(
  reg: Registry,
  opts: {
    registryUrl?: string;
    fetchImpl?: typeof fetch;
    communityAllowed?: () => Promise<boolean>;
    indexFloor?: () => Promise<number | null>;
    logs?: CapturedLog[];
  } = {},
) {
  const dataDir = temp("vf-gate-data-");
  const installedRoot = join(dataDir, "plugins", "installed");
  mkdirSync(installedRoot, { recursive: true });
  const plugins = new PluginRegistryService({
    dataDir,
    roots: { bundled: [], devLinked: [], installed: [installedRoot] },
  });
  cleanup.push(() => plugins.dispose());
  await plugins.refresh();
  const installer = new RegistryInstallService({
    dataDir,
    plugins,
    registryUrl: opts.registryUrl ?? reg.url,
    registryPublicKey: reg.keys.publicKey,
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.communityAllowed !== undefined ? { communityAllowed: opts.communityAllowed } : {}),
    ...(opts.indexFloor !== undefined ? { indexFloor: opts.indexFloor } : {}),
    logger: captureLogger(opts.logs ?? []),
  });
  return { dataDir, installedRoot, plugins, installer };
}

describe("the install gate (MK-2c)", () => {
  it("refuses a community entry at prepare while community plugins are off, before any artifact fetch", async () => {
    const reg = await registry();
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      const path = join(reg.dir, url.slice("https://registry.test/".length));
      return new Response(new Uint8Array(readFileSync(path)));
    }) as unknown as typeof fetch;
    const { installer, installedRoot } = await installerFor(reg, {
      registryUrl: "https://registry.test/index.json",
      fetchImpl,
    });
    await expect(installer.prepare({ id: KV_ID })).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { ...CLOSED, generatedAt: reg.index.generatedAt },
    });
    expect(asked).toEqual([
      "https://registry.test/index.json",
      "https://registry.test/index.json.sig",
    ]);
    expect(existsSync(join(installedRoot, KV_ID))).toBe(false);
  });

  it("installs VibeField's own entry, its display copies carried in memory alone (item 330)", async () => {
    const reg = await registry("R1");
    resign(reg, (index) => {
      const entry = (index.plugins as Record<string, Record<string, unknown>>)[KV_ID]!;
      entry.listing = { title: "Key-value store", publisherName: "VibeField" };
    });
    const { installer, plugins } = await installerFor(reg);
    const candidate = await installer.prepare({ id: KV_ID });
    expect(candidate.listedAs).toBe("vibefield");
    // the file beside the slot: the list's address, the hash, and the plugin's namespace as its
    // publisher (MK-E11), never the repository's address; no display copy
    const written = {
      indexRef: reg.url,
      artifactSha256: candidate.artifact.artifactSha256,
      publisher: "vibefield",
    };
    const sidecar = JSON.parse(
      readFileSync(join(candidate.artifact.root, ".vf-registry.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(sidecar).toEqual(written);
    // the candidate the card is read from shows the signed entry's copies, carried from prepare
    const shown = candidate.runtime.record.registry;
    expect([shown?.rung, shown?.publisherName]).toEqual(["R1", "VibeField"]);
    // once installed, the row is read from the folder, which holds no copy: G3's read of the held
    // list says whose it is (`plugin-catalog.ts`, `listedAsFor`)
    await installer.commit(candidate);
    expect(plugins.get(KV_ID)?.registry).toEqual(written);
  });

  it("installs a community entry when the installer's own gate is open", async () => {
    const reg = await registry();
    const { installer, plugins } = await installerFor(reg, { communityAllowed: async () => true });
    const candidate = await installer.prepare({ id: KV_ID });
    expect(candidate.listedAs).toBe("community");
    await installer.commit(candidate);
    expect(plugins.get(KV_ID)?.version).toBe(candidate.version);
  });

  it("asks again at commit: a gate that closed after prepare refuses before the pointer moves", async () => {
    const reg = await registry();
    let allowed = true;
    const { installer, plugins, installedRoot } = await installerFor(reg, {
      communityAllowed: async () => allowed,
    });
    const candidate = await installer.prepare({ id: KV_ID });
    allowed = false;
    await expect(installer.commit(candidate)).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { ...CLOSED, generatedAt: reg.index.generatedAt },
    });
    expect(existsSync(join(installedRoot, KV_ID, PLUGIN_CURRENT_POINTER_FILE))).toBe(false);
    expect(await installer.discard(candidate)).toBe(true);
    await plugins.refresh();
    expect(plugins.get(KV_ID)).toBeUndefined();
  });

  it("holds an install's and an updates check's index to the held list's floor", async () => {
    const reg = await registry("R1");
    const logs: CapturedLog[] = [];
    let catalog: PluginCatalogService | undefined;
    const { installer, plugins, dataDir } = await installerFor(reg, {
      logs,
      indexFloor: async () => (await catalog?.heldGeneratedAt()) ?? null,
    });
    catalog = new PluginCatalogService({ dataDir, installer, plugins });
    const at = reg.index.generatedAt;
    // the test's own held file in its own temp root, in the catalog's one-file shape
    const hold = (generatedAt: number, keys: Keys = reg.keys) => {
      const bytes = Buffer.from(
        JSON.stringify({ schemaVersion: 1, generatedAt, plugins: {} }),
        "utf8",
      );
      mkdirSync(join(dataDir, "plugins", "catalog"), { recursive: true });
      const held = {
        signature: signRegistryIndex(bytes, keys.secretKey),
        checkedAt: 1,
        index: bytes.toString("base64"),
      };
      writeFileSync(join(dataDir, "plugins", "catalog", "held.json"), JSON.stringify(held));
    };
    const passes = async () => {
      const candidate = await installer.prepare({ id: KV_ID });
      await installer.discard(candidate);
    };
    await passes(); // no list held: nothing changes
    hold(at + 1, generateRegistryKeypair());
    await passes(); // a held file that does not verify sets no floor
    hold(at);
    await passes(); // an equal list passes
    hold(at + 1);
    await expect(installer.prepare({ id: KV_ID })).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    await expect(installer.updatesCheck()).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    const refused = logs.filter((l) => l.event === "fieldd.plugin_install.index_refused");
    const rollback = { reason: "rollback", heldGeneratedAt: at + 1, generatedAt: at };
    expect(refused.map((l) => l.attrs)).toEqual([rollback, rollback]);
  });

  it("a synced community entry parks, and its refusal is said once per id per list", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    const { installer, plugins } = await installerFor(reg);
    const reconciler = new InstallSetReconciler({
      settingsDoc: {
        installSet: async () => ({
          [KV_ID]: { pluginId: KV_ID, source: "registry", enabled: true, grants: [] },
        }),
        // MK-2d: the reconciler's removal half reads this; nothing here is removed
        removedPlugins: async () => new Set<string>(),
      } as unknown as SettingsDocService,
      plugins,
      installer,
      teardown: async () => undefined,
      restart: () => undefined,
      audit: {
        requiredSystem: async (_mutation: unknown, effect: () => Promise<unknown>) => effect(),
      } as unknown as Pick<AuditService, "requiredSystem">,
      logger: captureLogger(logs),
    });
    const parked = () => logs.filter((l) => l.event === "fieldd.install_reconciler.entry_parked");
    await reconciler.reconcile();
    await reconciler.reconcile();
    expect(parked().length).toBe(1);
    resign(reg, (index) => {
      index.generatedAt = reg.index.generatedAt + 1;
    });
    await reconciler.reconcile();
    await reconciler.reconcile();
    expect(parked().length).toBe(2);
    expect(plugins.get(KV_ID)).toBeUndefined();
  });

  it("a parked community entry is tried once more when the answer moves to allowed, and installs (MK-O3D, C40)", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    let allowed = false;
    const communityAllowed = async () => allowed;
    const { installer, plugins } = await installerFor(reg, { communityAllowed });
    const reconciler = new InstallSetReconciler({
      settingsDoc: {
        installSet: async () => ({
          [KV_ID]: { pluginId: KV_ID, source: "registry", enabled: true, grants: [] },
        }),
        removedPlugins: async () => new Set<string>(),
      } as unknown as SettingsDocService,
      plugins,
      installer,
      teardown: async () => undefined,
      restart: () => undefined,
      audit: {
        requiredSystem: async (_mutation: unknown, effect: () => Promise<unknown>) => effect(),
      } as unknown as Pick<AuditService, "requiredSystem">,
      logger: captureLogger(logs),
    });
    // as `daemon.ts` wires them: one read for the install gate and the hold, and the hold's
    // `opened` walks the install set once more. The install set here never moves.
    const walks: Array<Promise<void>> = [];
    const community = new CommunityHold({
      plugins,
      allowed: communityAllowed,
      teardown: async () => undefined,
      restart: () => undefined,
      opened: () => {
        walks.push(reconciler.reconcile());
      },
    });
    const parked = () => logs.filter((l) => l.event === "fieldd.install_reconciler.entry_parked");
    await community.switchMoved(); // boot's first answer: off
    await reconciler.reconcile(); // boot's walk: the community entry parks
    expect([parked().length, plugins.get(KV_ID)]).toEqual([1, undefined]);
    await community.switchMoved(); // another app preference moved, not the answer
    expect(walks.length).toBe(0);
    allowed = true;
    await community.switchMoved();
    expect(walks.length).toBe(1);
    await Promise.all(walks);
    expect(plugins.get(KV_ID)?.source).toBe("registry");
    await community.switchMoved(); // still allowed: no second walk
    expect([walks.length, parked().length]).toEqual([1, 1]);
  });
});

describe("the doors with community plugins off, then on (MK-2c, MK-O3D)", () => {
  it("refuse a community entry while off, audited as denied; the drawn switch turns it on, and off holds it", {
    timeout: 120_000,
  }, async () => {
    const reg = await registry();
    const dataDir = temp("vf-gate-door-");
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await native.start();
    cleanup.push(() => native.stop());
    const daemon = await bootstrap({
      dataDir,
      controlPort: 0,
      registryUrl: reg.url,
      registryPublicKey: reg.keys.publicKey,
    });
    cleanup.push(() => daemon.stop());
    const socket = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    cleanup.push(() => socket.close());
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const shell = new WsRpc(socket);
    await helloAs(shell, daemon.shellToken, "shell-main");

    const refused = await shell.callErr("plugins.install", { id: KV_ID });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(refused.data?.details).toMatchObject({ ...CLOSED, generatedAt: reg.index.generatedAt });
    expect(daemon.plugins.get(KV_ID)).toBeUndefined();
    const card = await shell.callErr("plugins.install.prepare", { id: KV_ID });
    expect(card.data?.details).toMatchObject({ ...CLOSED, generatedAt: reg.index.generatedAt });

    const ledger = (action: string) => {
      const dir = join(dataDir, ...LAYOUT.AUDIT_DIR);
      if (!existsSync(dir)) return [] as Array<Record<string, unknown>>;
      return readdirSync(dir)
        .filter((f) => f.startsWith("plugins.") && f.endsWith(".jsonl"))
        .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((l) => l.action === action);
    };
    const doors = ["plugin.install", "plugin.install.prepare"];
    await until(() => doors.every((action) => ledger(action).some((l) => l.phase === "outcome")));
    for (const action of doors) {
      const lines = ledger(action);
      expect(lines.map((l) => l.phase)).toEqual(["attempt", "outcome"]);
      // MK-O3D (N26): `denied`, with the switch's own reason code; MK-2c's Q3 (VF-PM 10:08:59Z) said `failed`, by
      // the error's kind, and left a `denied` for MK-4
      expect([action, lines[1]?.outcome, lines[1]?.reasonCode]).toEqual([
        action,
        "denied",
        "COMMUNITY_SWITCH_CLOSED",
      ]);
    }

    // MK-O3D: the switch is drawn, so its door takes an ON, and the install gate and the stop (O3-C) follow it
    const turn = (value: boolean) =>
      shell.call("storage.appPreferences.set", { key: "plugins.community", value });
    expect(await turn(true)).toEqual({ ok: true });
    await shell.call("plugins.install", { id: KV_ID });
    const shape = () => {
      const row = daemon.plugins.get(KV_ID);
      return [row?.state, row?.enabled, row?.held];
    };
    const RUNS = ["enabled", true, undefined];
    const HELD = ["disabled", false, "community-off"];
    expect(shape()).toEqual(RUNS);
    // turned off, it is held as if turned off; turned on again, it runs as it was
    expect(await turn(false)).toEqual({ ok: true });
    await until(() => shape()[2] === "community-off", 8000, "held once community plugins are off");
    expect(shape()).toEqual(HELD);
    expect(await turn(true)).toEqual({ ok: true });
    await until(() => shape()[1] === true, 8000, "back as it was once they are on again");
    expect(shape()).toEqual(RUNS);
  });
});
