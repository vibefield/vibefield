import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RegistryIndex } from "@vibefield/contracts";
import {
  buildFixtureRegistry,
  generateRegistryKeypair,
  packVfplugin,
  signRegistryIndex,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import { PluginCatalogService } from "../src/plugin-catalog";
import { RegistryInstallService } from "../src/plugin-install";
import { PluginRegistryService } from "../src/plugin-registry";
import { type CapturedLog, captureLogger } from "./drive-fakes";
import { until } from "./ws-rpc";

// MK-O3 (O3-B, 2026-11-12) — an install holds the plugin list it verified (custody note addendum
// "an install holds the list it verified", accepted 02:58:44Z; James's pick, 03:42:10Z). Every
// registry here is the test's own: the real example plugin packed into an index the test builds
// and signs with a key it makes, read over file://, in temp roots it removes. No network, no real
// data dir, no child.

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

type Keys = ReturnType<typeof generateRegistryKeypair>;
type Signed = { bytes: Buffer; signature: string };

interface Registry {
  dir: string;
  url: string;
  keys: Keys;
  index: RegistryIndex;
}

/** The test's own registry: the example plugin, listed as VibeField's (rung R1). */
async function registry(): Promise<Registry> {
  const dir = temp("vf-holds-registry-");
  const { bytes } = await packVfplugin({ rootDir: KV_DIR });
  const keys = generateRegistryKeypair();
  const built = buildFixtureRegistry({
    dir,
    secretKey: keys.secretKey,
    plugins: [{ manifestDir: KV_DIR, artifactBytes: bytes, rung: "R1" }],
  });
  return { dir, url: pathToFileURL(join(dir, "index.json")).href, keys, index: built.index };
}

/** The index's exact bytes and its signature, as the test's registry serves them. */
function served(reg: Registry): Signed {
  return {
    bytes: readFileSync(join(reg.dir, "index.json")),
    signature: readFileSync(join(reg.dir, "index.json.sig"), "utf8").trim(),
  };
}

/** Changes the test's own index and signs the new bytes, with the registry's own key or `keys`. */
function resign(
  reg: Registry,
  change: (index: Record<string, unknown>) => void,
  keys: Keys = reg.keys,
): void {
  const raw = readFileSync(join(reg.dir, "index.json"), "utf8");
  const index = JSON.parse(raw) as Record<string, unknown>;
  change(index);
  const bytes = Buffer.from(JSON.stringify(index), "utf8");
  writeFileSync(join(reg.dir, "index.json"), bytes);
  writeFileSync(join(reg.dir, "index.json.sig"), signRegistryIndex(bytes, keys.secretKey));
}

interface Wiring {
  logs?: CapturedLog[];
  rename?: typeof rename;
  /** the hand-over in the catalog's place (absent: the catalog's own, as daemon.ts wires it) */
  hold?: (signed: Signed) => Promise<boolean>;
}

/** An installer and a catalog, wired as daemon.ts wires them: the floor and the hand-over. The
 * catalog's picture reads are counted. */
async function wired(reg: Registry, opts: Wiring = {}) {
  const dataDir = temp("vf-holds-data-");
  const installedRoot = join(dataDir, "plugins", "installed");
  mkdirSync(installedRoot, { recursive: true });
  const plugins = new PluginRegistryService({
    dataDir,
    roots: { bundled: [], devLinked: [], installed: [installedRoot] },
  });
  cleanup.push(() => plugins.dispose());
  await plugins.refresh();
  const logger = captureLogger(opts.logs ?? []);
  const listingReads: string[] = [];
  const installer: RegistryInstallService = new RegistryInstallService({
    dataDir,
    plugins,
    registryUrl: reg.url,
    registryPublicKey: reg.keys.publicKey,
    indexFloor: (): Promise<number | null> => catalog.heldGeneratedAt(),
    holdVerifiedIndex: opts.hold ?? ((signed): Promise<boolean> => catalog.holdVerified(signed)),
    logger,
  });
  const catalog: PluginCatalogService = new PluginCatalogService({
    dataDir,
    installer: {
      registryConfigured: () => installer.registryConfigured(),
      fetchSignedIndex: () => installer.fetchSignedIndex(),
      verifyIndex: (bytes, signature) => installer.verifyIndex(bytes, signature),
      parseIndex: (bytes) => installer.parseIndex(bytes),
      fetchListingFile: (indexRef, path, read) => {
        listingReads.push(path);
        return installer.fetchListingFile(indexRef, path, read);
      },
    },
    plugins,
    logger,
    now: () => 7000,
    ...(opts.rename !== undefined ? { rename: opts.rename } : {}),
  });
  return { dataDir, plugins, installer, catalog, listingReads };
}

const heldPath = (dataDir: string) => join(dataDir, "plugins", "catalog", "held.json");

/** The held file as the test reads it: its fields, and the index's bytes decoded. */
function heldOf(dataDir: string) {
  const fields = JSON.parse(readFileSync(heldPath(dataDir), "utf8")) as Record<string, unknown>;
  return { fields, bytes: Buffer.from(String(fields.index), "base64") };
}

const catalogRefusals = (logs: CapturedLog[]) =>
  logs.filter((l) => l.event === "fieldd.plugin_catalog.index_refused").map((l) => l.attrs);

describe("an install holds the list it verified (MK-O3, O3-B)", () => {
  it("an install with no list held leaves the list it verified held, at its time, and fetches no picture", async () => {
    const reg = await registry();
    const icon = randomBytes(40);
    mkdirSync(join(reg.dir, "pictures"), { recursive: true });
    writeFileSync(join(reg.dir, "pictures", "icon.png"), icon);
    const pin = `sha256:${createHash("sha256").update(icon).digest("hex")}`;
    resign(reg, (index) => {
      const plugins = index.plugins as Record<string, Record<string, unknown>>;
      plugins[KV_ID]!.listing = {
        title: "Key value",
        objects: [],
        icon: { path: "pictures/icon.png", sha256: pin },
      };
    });
    const { dataDir, installer, catalog, listingReads } = await wired(reg);
    expect(await catalog.heldGeneratedAt()).toBeNull();

    await installer.install({ id: KV_ID });
    const list = served(reg);
    const held = heldOf(dataDir);
    expect(held.bytes.equals(list.bytes)).toBe(true);
    expect(held.fields.signature).toBe(list.signature);
    expect(held.fields.checkedAt).toBe(7000);
    expect(await catalog.listedAsFor(KV_ID)).toBe("vibefield");
    const answer = await catalog.get();
    expect([answer.state, answer.checkedAt]).toEqual(["ready", 7000]);
    expect(answer.plugins.map((p) => p.id)).toEqual([KV_ID]);

    // the pictures stay inside the person's refresh: the hand-over fetched none, a refresh does
    expect(listingReads).toEqual([]);
    expect(existsSync(join(dataDir, "plugins", "catalog", "pictures"))).toBe(false);
    await catalog.refresh();
    expect(listingReads).toEqual(["pictures/icon.png"]);
  });

  it("a list older than the one held is not held over it, and an equal one passes", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    const { dataDir, catalog } = await wired(reg, { logs });
    const at = reg.index.generatedAt;
    const older = served(reg);
    resign(reg, (index) => {
      index.generatedAt = at + 1;
    });
    const newer = served(reg);
    expect(await catalog.holdVerified(newer)).toBe(true);
    expect(await catalog.holdVerified(older)).toBe(false);
    expect(heldOf(dataDir).bytes.equals(newer.bytes)).toBe(true);
    expect(await catalog.holdVerified(newer)).toBe(true);
    expect(catalogRefusals(logs)).toEqual([
      { reason: "rollback", heldGeneratedAt: at + 1, generatedAt: at },
    ]);
  });

  it("the two writers take turns: an older list handed over beside a newer one never lands over it", async () => {
    const reg = await registry();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let renames = 0;
    // the test's seam: each write waits at its rename until the test lets it go
    const slowRename = async (from: string, to: string): Promise<void> => {
      renames += 1;
      await gate;
      await rename(from, to);
    };
    const { dataDir, catalog } = await wired(reg, { rename: slowRename as typeof rename });
    const older = served(reg);
    resign(reg, (index) => {
      index.generatedAt = reg.index.generatedAt + 1;
    });
    const newer = served(reg);
    const first = catalog.holdVerified(newer);
    const second = catalog.holdVerified(older);
    // the newer list's write is held open at its rename; the older one's floor waits its turn
    await until(() => renames === 1);
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(renames).toBe(1);
    expect(heldOf(dataDir).bytes.equals(newer.bytes)).toBe(true);
  });

  it("a refused list holds nothing: bytes the signature does not cover, bytes that do not parse, a list signed by another key", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    const { dataDir, catalog, installer } = await wired(reg, { logs });
    const list = served(reg);
    const altered = Buffer.concat([list.bytes, Buffer.from(" ")]);
    expect(await catalog.holdVerified({ bytes: altered, signature: list.signature })).toBe(false);
    const junk = Buffer.from(JSON.stringify({ schemaVersion: 1 }), "utf8");
    const signedJunk = { bytes: junk, signature: signRegistryIndex(junk, reg.keys.secretKey) };
    expect(await catalog.holdVerified(signedJunk)).toBe(false);
    expect(catalogRefusals(logs)).toEqual([{ reason: "signature" }]);
    expect(existsSync(heldPath(dataDir))).toBe(false);

    // the installer refuses it before any hand-over
    resign(reg, () => undefined, generateRegistryKeypair());
    await expect(installer.install({ id: KV_ID })).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    expect(existsSync(heldPath(dataDir))).toBe(false);
  });

  it("a hand-over that fails does not fail the install, and is said by its reason code alone", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    const { dataDir, installer, plugins } = await wired(reg, {
      logs,
      hold: async () => {
        throw Object.assign(new Error("disk full at /a/path/of/the/test"), { code: "ENOSPC" });
      },
    });
    await installer.install({ id: KV_ID });
    expect(plugins.get(KV_ID)?.id).toBe(KV_ID);
    const said = logs.filter((l) => l.event === "fieldd.plugin_install.list_not_held");
    expect(said.map((l) => l.attrs)).toEqual([{ reason: "ENOSPC" }]);
    expect(JSON.stringify(said).includes("/a/path/of/the/test")).toBe(false);
    expect(existsSync(heldPath(dataDir))).toBe(false);
  });
});
