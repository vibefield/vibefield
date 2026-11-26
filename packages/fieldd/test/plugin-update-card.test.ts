import {
  cpSync,
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
import { LAYOUT, SOCKETS } from "@vibefield/contracts";
import {
  buildFixtureRegistry,
  type FixturePlugin,
  generateRegistryKeypair,
  packVfplugin,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap } from "../src/index";
import { PLUGIN_CURRENT_POINTER_FILE } from "../src/plugin-artifact-store";
import { RegistryInstallService } from "../src/plugin-install";
import { PluginRegistryService } from "../src/plugin-registry";
import {
  type RowPowers,
  UPDATE_ASKS_MORE,
  UPDATE_CARD_MOVED,
  type UpdateCardBasis,
  updateAsksFor,
  updateCardMoved,
} from "../src/plugin-update-asks";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { type CapturedLog, captureLogger } from "./drive-fakes";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

// MK-UC (2026-11-14; James's pick on the board, 2026-11-12 06:08:01Z: "Yes: show the card when an
// update asks for more") — the update card's compare and its doors (mk-uc/PLAN.md, from
// mk-o2/PLAN-update-card.md). Every registry here is the test's own: the real example plugin, or a
// plugin the test writes, packed into an index the test builds and signs with a key it makes, read
// over file://, in temp roots it removes. No network, no real data dir, no child.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const HERE = dirname(fileURLToPath(import.meta.url));
const KV_DIR = join(HERE, "..", "..", "..", "examples", "plugins", "kv-service");
const KV_ID = "vibefield.example.kv";
const ENTRY_ID = "vibefield.fixture.update-card";

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A release of the example KV plugin at `version`, asking for its own powers and `more`: its
 * folder copied into the test's own temp root (its installed packages left behind, which a pack
 * never reads), as VibeField's own (rung R1), so the community gate is not met. With `contracts`,
 * the contracts range it needs, which the list carries as its floor. */
async function kvRelease(
  parent: string,
  version: string,
  more: readonly string[] = [],
  contracts?: string,
): Promise<FixturePlugin> {
  const root = join(parent, `kv-${version}`);
  cpSync(KV_DIR, root, { recursive: true, filter: (src) => !src.includes("node_modules") });
  const path = join(root, "vibefield.plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as {
    version: string;
    capabilities: string[];
    engines: Record<string, string>;
  };
  manifest.version = version;
  manifest.capabilities = [...manifest.capabilities, ...more];
  if (contracts !== undefined) manifest.engines = { ...manifest.engines, contracts };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const { bytes } = await packVfplugin({ rootDir: root });
  return { manifestDir: root, artifactBytes: bytes, rung: "R1" };
}

/** A plugin the test writes: a service, and with `renderer` a renderer too, asking for
 * `terminal.attach`, which only a renderer may use. */
async function entryRelease(
  parent: string,
  version: string,
  renderer: boolean,
): Promise<FixturePlugin> {
  const root = join(parent, `entry-${version}`);
  mkdirSync(root, { recursive: true });
  const manifest = {
    manifestVersion: 1,
    id: ENTRY_ID,
    version,
    title: "Update card fixture",
    engines: { app: ">=0.0.0", contracts: "^0.1.0" },
    entries: renderer
      ? { service: "./service.js", renderer: "./renderer.js" }
      : { service: "./service.js" },
    activation: [],
    capabilities: ["terminal.attach"],
    contributes: {},
  };
  writeFileSync(join(root, "vibefield.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(root, "service.js"), "export function activate() {}\n");
  if (renderer) writeFileSync(join(root, "renderer.js"), "export function activate() {}\n");
  const { bytes } = await packVfplugin({ rootDir: root });
  return { manifestDir: root, artifactBytes: bytes, rung: "R1" };
}

/** The test's own signed list over file:// (releases newest first), and its key. */
function registryOf(releases: FixturePlugin[]) {
  const dir = temp("vf-uc-registry-");
  const keys = generateRegistryKeypair();
  buildFixtureRegistry({ dir, secretKey: keys.secretKey, plugins: releases });
  return { url: pathToFileURL(join(dir, "index.json")).href, keys };
}

/** A registry and an installer of their own, with no daemon. */
async function installerOn(releases: FixturePlugin[]) {
  const reg = registryOf(releases);
  const dataDir = temp("vf-uc-data-");
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
    registryUrl: reg.url,
    registryPublicKey: reg.keys.publicKey,
  });
  return { plugins, installer, dataDir };
}

/** A row's two compared fields, with each denial's reason. */
const row = (
  requested: string[],
  denied: Array<[string, "entry-kind" | "revoked"]> = [],
): RowPowers => ({
  requestedCapabilities: requested,
  deniedCapabilities: denied.map(([capability, reason]) => ({ capability, reason })),
});

describe("what an update asks for (MK-UC)", () => {
  it("is what the update could use that the version you have couldn't, in its order", () => {
    const installed = row(["storage.self"]);
    const update = row(["net.outbound", "storage.self", "background"]);
    expect(updateAsksFor(installed, update)).toEqual(["net.outbound", "background"]);
  });

  it("never counts a power turned off on this desktop, which stays off by its id", () => {
    const installed = row(["storage.self"], [["storage.self", "revoked"]]);
    const update = row(["storage.self", "net.outbound"], [["storage.self", "revoked"]]);
    expect(updateAsksFor(installed, update)).toEqual(["net.outbound"]);
  });

  it("counts a power the version you have asked for and couldn't use, which the update can", () => {
    const installed = row(["terminal.attach"], [["terminal.attach", "entry-kind"]]);
    expect(updateAsksFor(installed, row(["terminal.attach"]))).toEqual(["terminal.attach"]);
  });

  it("asks for nothing when it keeps or drops powers, and says a repeated power once", () => {
    const installed = row(["storage.self", "net.outbound"]);
    expect(updateAsksFor(installed, row(["storage.self", "net.outbound"]))).toEqual([]);
    expect(updateAsksFor(installed, row(["storage.self"]))).toEqual([]);
    expect(updateAsksFor(row([]), row(["background", "background"]))).toEqual(["background"]);
  });

  // the review's fix (2026-11-14): an update card's Update holds the plugin to what the card was
  // read against
  it("holds a card to its version, its pinned manifest and the powers it named", () => {
    const pinned = `sha256:${"2".repeat(64)}`;
    const live = {
      installRevision: "a".repeat(64),
      manifestHash: `sha256:${"1".repeat(64)}`,
      ...row(["storage.self"]),
    };
    const card: UpdateCardBasis = {
      installRevision: live.installRevision,
      manifestHash: live.manifestHash,
      asksFor: ["net.outbound"],
    };
    const fresh = { manifestHash: pinned, ...row(["storage.self", "net.outbound"]) };
    expect(updateCardMoved(card, live, fresh, pinned)).toBeNull();
    // a power turned off while it waited is off in both rows: the card still holds
    const offNow = { ...live, ...row(["storage.self"], [["storage.self", "revoked"]]) };
    const freshOff = {
      ...fresh,
      ...row(["storage.self", "net.outbound"], [["storage.self", "revoked"]]),
    };
    expect(updateCardMoved(card, offNow, freshOff, pinned)).toBeNull();
    const otherVersion = { ...live, installRevision: "b".repeat(64) };
    expect(updateCardMoved(card, otherVersion, fresh, pinned)).toBe("version");
    expect(updateCardMoved(card, undefined, fresh, pinned)).toBe("version");
    expect(updateCardMoved(card, live, fresh, `sha256:${"3".repeat(64)}`)).toBe("files");
    const more = { ...fresh, ...row(["storage.self", "net.outbound", "background"]) };
    expect(updateCardMoved(card, live, more, pinned)).toBe("asks");
  });
});

describe("the compare over the registry's own rows (MK-UC)", () => {
  it("a power turned off here is denied in the update's row too, and is not counted", async () => {
    const releases = temp("vf-uc-releases-");
    const { plugins, installer } = await installerOn([
      await kvRelease(releases, "0.2.0", ["net.outbound"]),
      await kvRelease(releases, "0.1.0"),
    ]);
    await installer.install({ id: KV_ID, version: "0.1.0" });
    await plugins.setGrant(KV_ID, "storage.self", false);
    const installed = plugins.get(KV_ID);
    if (installed === undefined) throw new Error("0.1.0 did not install");
    const prepared = await installer.prepare({ id: KV_ID });
    const off = { capability: "storage.self", reason: "revoked" };
    expect(installed.deniedCapabilities).toContainEqual(off);
    expect(prepared.runtime.record.deniedCapabilities).toContainEqual(off);
    expect(updateAsksFor(installed, prepared.runtime.record)).toEqual(["net.outbound"]);
    expect(await installer.discard(prepared)).toBe(true);
  });

  it("a power newly usable through the update's new entry is counted", async () => {
    const releases = temp("vf-uc-releases-");
    const { plugins, installer } = await installerOn([
      await entryRelease(releases, "2.0.0", true),
      await entryRelease(releases, "1.0.0", false),
    ]);
    await installer.install({ id: ENTRY_ID, version: "1.0.0" });
    const installed = plugins.get(ENTRY_ID);
    if (installed === undefined) throw new Error("1.0.0 did not install");
    expect(installed.deniedCapabilities).toEqual([
      { capability: "terminal.attach", reason: "entry-kind" },
    ]);
    const prepared = await installer.prepare({ id: ENTRY_ID });
    expect(prepared.runtime.record.requestedCapabilities).toEqual(installed.requestedCapabilities);
    expect(updateAsksFor(installed, prepared.runtime.record)).toEqual(["terminal.attach"]);
    expect(await installer.discard(prepared)).toBe(true);
  });

  // the review's fix (2026-11-14): a decision the version you have cannot show moves no field of
  // its row, so only the candidate read again sees it
  it("while a card waits, a power newly usable shows in the candidate read again", async () => {
    const releases = temp("vf-uc-releases-");
    const { plugins, installer } = await installerOn([
      await entryRelease(releases, "2.0.0", true),
      await entryRelease(releases, "1.0.0", false),
    ]);
    await installer.install({ id: ENTRY_ID, version: "1.0.0" });
    // turned off while 1.0.0 cannot use it: kept by its id, and 1.0.0's row does not move
    expect((await plugins.setGrant(ENTRY_ID, "terminal.attach", false)).changed).toBe(false);
    const installed = plugins.get(ENTRY_ID);
    if (installed === undefined) throw new Error("1.0.0 did not install");
    const prepared = await installer.prepare({ id: ENTRY_ID });
    const card: UpdateCardBasis = {
      installRevision: installed.installRevision,
      manifestHash: installed.manifestHash,
      asksFor: updateAsksFor(installed, prepared.runtime.record),
    };
    expect(card.asksFor).toEqual([]);
    const readAgain = async () => {
      const fresh = await plugins.inspectRegistryCandidate({
        pluginId: ENTRY_ID,
        root: prepared.artifact.root,
        artifactSha256: prepared.artifact.artifactSha256,
      });
      return fresh.record;
    };
    const pinned = prepared.pinnedManifestHash;
    expect(updateCardMoved(card, plugins.get(ENTRY_ID), await readAgain(), pinned)).toBeNull();
    // turned on while the card waits: 1.0.0's row still does not move, and 2.0.0 could use it
    expect((await plugins.setGrant(ENTRY_ID, "terminal.attach", true)).changed).toBe(false);
    expect(plugins.get(ENTRY_ID)?.grantGeneration).toBe(installed.grantGeneration);
    expect(updateCardMoved(card, plugins.get(ENTRY_ID), await readAgain(), pinned)).toBe("asks");
    expect(await installer.discard(prepared)).toBe(true);
  });

  // N24 (2026-11-14; DESIGN.md §8 "The updates flow", owed (MK) until now): a read says in the log
  // what it can't update for a plugin you have, never only to its caller
  it("a read logs an update that needs a newer VibeField and a plugin the list no longer names", async () => {
    const releases = temp("vf-uc-releases-");
    const { plugins, installer, dataDir } = await installerOn([
      await kvRelease(releases, "0.1.0"),
      await entryRelease(releases, "1.0.0", false),
    ]);
    await installer.install({ id: KV_ID, version: "0.1.0" });
    await installer.install({ id: ENTRY_ID, version: "1.0.0" });
    // the next list: KV's newer release needs a newer VibeField, and the fixture plugin is gone
    const next = registryOf([await kvRelease(releases, "0.2.0", [], "^99.0.0")]);
    const logs: CapturedLog[] = [];
    const reader = new RegistryInstallService({
      dataDir,
      plugins,
      registryUrl: next.url,
      registryPublicKey: next.keys.publicKey,
      logger: captureLogger(logs),
    });
    const read = await reader.updatesCheck();
    expect(read.updates.map((update) => [update.id, update.compatible])).toEqual([[KV_ID, false]]);
    expect(read.missing).toEqual([ENTRY_ID]);
    const said = logs.filter((line) => line.event.startsWith("fieldd.plugin_updates."));
    expect(said).toHaveLength(2);
    expect(said).toContainEqual({
      event: "fieldd.plugin_updates.incompatible",
      attrs: expect.objectContaining({
        pluginId: KV_ID,
        installedVersion: "0.1.0",
        version: "0.2.0",
        minContracts: "^99.0.0",
      }),
    });
    expect(said).toContainEqual({
      event: "fieldd.plugin_updates.unlisted",
      attrs: { pluginId: ENTRY_ID, installedVersion: "1.0.0" },
    });
  });
});

/** fieldd booted on the test's own data dir and list (a mock native plane, no child), and the
 * shell's own connection to it. */
async function shellOn(releases: FixturePlugin[]) {
  const reg = registryOf(releases);
  const dataDir = temp("vf-uc-door-");
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
  return { dataDir, daemon, shell };
}

type Prepared = {
  candidate: string;
  record: { id: string; version: string; manifestHash: string; installRevision: string };
  update?: { from: string; asksFor: string[] };
};

/** The plugins ledger's rows for `actions`, in the order they were written. */
function ledger(dataDir: string, actions: readonly string[]): Array<Record<string, unknown>> {
  const dir = join(dataDir, ...LAYOUT.AUDIT_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith("plugins.") && f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((l) => actions.includes(String(l.action)));
}

/** The plugin's revision folders on disk (the store's `revisions`, `plugin-artifact-store.ts`). Item 279's S3
 * (2026-11-24) keeps each slot's verified list and its signature beside the slot (`<sha>.index.json`,
 * `<sha>.index.json.sig`), so only the slot directories themselves are counted: 64 hex characters. */
function revisions(dataDir: string, id: string): string[] {
  const dir = join(dataDir, "plugins", "installed", id, "revisions");
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => /^[0-9a-f]{64}$/u.test(name))
        .sort()
    : [];
}

/** KV's service running, as the registry's snapshot says it: `get` returns the stored row, whose
 * `service` is the manifest's ("inactive"); the live state is merged in `snapshot()` alone
 * (`plugin-registry.ts` `snapshot`, `setServiceEntryState`), as `plugin-install-card.test.ts`
 * reads it. */
function serviceActive(daemon: { plugins: PluginRegistryService }): boolean {
  return daemon.plugins.snapshot().plugins.find((p) => p.id === KV_ID)?.service === "active";
}

/** KV's stored grants as one comparable value: its generation and its granted powers. */
function grantState(daemon: { plugins: PluginRegistryService }): string {
  const row = daemon.plugins.get(KV_ID);
  return `${row?.grantGeneration ?? "none"}:${(row?.grantedCapabilities ?? []).join(",")}`;
}

/** Resolves once `holds` is true of what `read` answers and `read` has answered the same value for
 * `quietMs` on end; quiet while `holds` is false does not end the wait. Rejects at `timeoutMs`. */
async function settled(
  read: () => string | Promise<string>,
  holds: (value: string) => boolean,
  quietMs: number,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  let since = Date.now();
  while (!holds(last) || Date.now() - since < quietMs) {
    if (Date.now() > deadline) {
      throw new Error(`settled: ${what} — not held and quiet within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    const now = await read();
    if (now !== last || !holds(now)) {
      last = now;
      since = Date.now();
    }
  }
}

/** Waits until this desktop's last act on KV has reached the settings doc and the install
 * reconciler has nothing to apply: the doc's own entry and the registry's row name `version` and
 * `enabled` alike, unchanged for 500 ms. Item 440 (RV's, `lanes/rv/i437/SIGHTING-440.md`): each
 * act publishes unawaited and nothing orders two publications, so an earlier act's publication
 * can be walked in a later act's gap (A) or commit after it (B), and either turns a plugin the
 * person turned off on again. The read is the doc's entry because its version names its writer:
 * only an install's or an update's own publication writes it (an enable's or a disable's `ensure`
 * writes an identity only where no entry stands, `settings-doc.ts` `updateInstallSet`). So the
 * doc at `version` means that publication has committed, and the next act's is the later writer:
 * that closes (B) for these rows. The 500 ms in agreement lets the walk its commit raised find
 * nothing to apply, which closes (A) as far as a test can: the reconciler says nothing when it is
 * idle, and a walk still in flight after that is the product's race, not the row's. */
async function agreed(
  daemon: Awaited<ReturnType<typeof bootstrap>>,
  version: string,
  enabled: boolean,
  what: string,
): Promise<void> {
  const read = async () => {
    const entry = (await daemon.settingsDoc.installSet())[KV_ID];
    const record = daemon.plugins.get(KV_ID);
    return JSON.stringify([entry?.version, entry?.enabled, record?.version, record?.enabled]);
  };
  const want = JSON.stringify([version, enabled, version, enabled]);
  await settled(read, (value) => value === want, 500, 15_000, what);
}

const UPDATE_DOORS = ["plugin.update.prepare", "plugin.update.cancel", "plugin.update"];

describe("the update card's doors (MK-UC)", () => {
  // generous cap: two service activations through the real worker host
  it("an update that asks for more: refused at the one press, shown on its card, then taken", {
    timeout: 60_000,
  }, async () => {
    const releases = temp("vf-uc-releases-");
    const { dataDir, daemon, shell } = await shellOn([
      await kvRelease(releases, "0.2.0", ["net.outbound"]),
      await kvRelease(releases, "0.1.0"),
    ]);
    const pointer = join(dataDir, "plugins", "installed", KV_ID, PLUGIN_CURRENT_POINTER_FILE);
    const active = () => serviceActive(daemon);

    // the version you have: 0.1.0, on, its service running
    await shell.call("plugins.install", { id: KV_ID, version: "0.1.0" });
    await until(active, 15_000, "0.1.0's service");
    await agreed(daemon, "0.1.0", true, "0.1.0's publication, applied and quiet");
    const selected = readFileSync(pointer, "utf8");
    const slots = revisions(dataDir, KV_ID);
    expect(slots.length).toBe(1);

    // prepare without `update` still refuses a plugin this desktop has; with it, one it does not
    const installed = await shell.callErr("plugins.install.prepare", { id: KV_ID });
    expect(installed.data?.kind).toBe("PRECONDITION_FAILED");
    const absent = await shell.callErr("plugins.install.prepare", {
      id: "vibefield.example.absent",
      update: true,
    });
    expect([absent.data?.kind, absent.message]).toEqual([
      "PRECONDITION_FAILED",
      "This plugin isn't installed.",
    ]);

    // the one press refuses it: the reason code, the download thrown away, the pointer unmoved
    const pressed = await shell.callErr("plugins.install", { id: KV_ID });
    expect(pressed.data).toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { reasonCode: UPDATE_ASKS_MORE },
    });
    expect(daemon.plugins.get(KV_ID)?.version).toBe("0.1.0");
    expect(readFileSync(pointer, "utf8")).toBe(selected);
    expect(revisions(dataDir, KV_ID)).toEqual(slots);

    // the card's prepare answers the version you have and the one new power; nothing moves
    const card = (await shell.call("plugins.install.prepare", {
      id: KV_ID,
      update: true,
    })) as Prepared;
    expect(card.record.version).toBe("0.2.0");
    expect(card.update).toEqual({ from: "0.1.0", asksFor: ["net.outbound"] });
    expect(daemon.plugins.get(KV_ID)?.version).toBe("0.1.0");
    expect(readFileSync(pointer, "utf8")).toBe(selected);

    // its Cancel throws the download away and leaves the version you have
    const cancel = { candidate: card.candidate };
    expect(await shell.call("plugins.install.discard", cancel)).toEqual({ discarded: true });
    expect(daemon.plugins.get(KV_ID)?.version).toBe("0.1.0");
    expect(readFileSync(pointer, "utf8")).toBe(selected);
    expect(revisions(dataDir, KV_ID)).toEqual(slots);

    // its Update goes through the barrier: the card's version, its new power, its service again
    const again = (await shell.call("plugins.install.prepare", {
      id: KV_ID,
      update: true,
    })) as Prepared;
    const updated = (await shell.call("plugins.install.commit", {
      candidate: again.candidate,
    })) as { version: string; manifestHash: string };
    expect([updated.version, updated.manifestHash]).toEqual(["0.2.0", again.record.manifestHash]);
    expect(daemon.plugins.get(KV_ID)?.grantedCapabilities).toContain("net.outbound");
    await until(active, 15_000, "0.2.0's service");

    // the three doors' rows: ids, fields and reason codes; the new powers by count alone, and no
    // token (booleans, so a red prints neither)
    const outcomes = () => ledger(dataDir, UPDATE_DOORS).filter((l) => l.phase === "outcome");
    await until(() => outcomes().length === 6, 4_000, "the update doors' outcomes");
    expect(outcomes().map((l) => [l.action, l.outcome])).toEqual([
      ["plugin.update.prepare", "failed"],
      ["plugin.update", "failed"],
      ["plugin.update.prepare", "succeeded"],
      ["plugin.update.cancel", "succeeded"],
      ["plugin.update.prepare", "succeeded"],
      ["plugin.update", "succeeded"],
    ]);
    const prepares = outcomes().filter((l) => l.action === "plugin.update.prepare");
    expect(prepares.slice(1).map((l) => l.attrs)).toMatchObject([
      { from: "0.1.0", asksForCount: 1, version: "0.2.0" },
      { from: "0.1.0", asksForCount: 1, version: "0.2.0" },
    ]);
    expect(outcomes().at(-1)?.attrs).toMatchObject({ version: "0.2.0" });
    const rows = JSON.stringify(ledger(dataDir, UPDATE_DOORS));
    expect(rows.includes(daemon.shellToken)).toBe(false);
    expect(rows.includes("net.outbound")).toBe(false);
  });

  it("an update that asks for nothing new keeps one press; an off plugin's card commits plainly", {
    timeout: 60_000,
  }, async () => {
    const releases = temp("vf-uc-releases-");
    const { dataDir, daemon, shell } = await shellOn([
      await kvRelease(releases, "0.3.0"),
      await kvRelease(releases, "0.2.0"),
      await kvRelease(releases, "0.1.0"),
    ]);
    const active = () => serviceActive(daemon);
    await shell.call("plugins.install", { id: KV_ID, version: "0.1.0" });
    await until(active, 15_000, "0.1.0's service");
    await agreed(daemon, "0.1.0", true, "0.1.0's publication, applied and quiet");

    // nothing new: its card would list no power, and the one press takes it through the barrier
    const quiet = (await shell.call("plugins.install.prepare", {
      id: KV_ID,
      version: "0.2.0",
      update: true,
    })) as Prepared;
    expect(quiet.update).toEqual({ from: "0.1.0", asksFor: [] });
    const cancel = { candidate: quiet.candidate };
    expect(await shell.call("plugins.install.discard", cancel)).toEqual({ discarded: true });
    const pressed = (await shell.call("plugins.install", { id: KV_ID, version: "0.2.0" })) as {
      version: string;
    };
    expect(pressed.version).toBe("0.2.0");
    await until(active, 15_000, "0.2.0's service");
    // item 440: the press's own publication (on) committed and walked before the person's off
    await agreed(daemon, "0.2.0", true, "0.2.0's publication, applied and quiet");

    // turned off, an update's card commits plainly: it moves, it stays off, nothing is revoked
    await shell.call("plugins.disable", { id: KV_ID });
    await agreed(daemon, "0.2.0", false, "the disable, published and quiet");
    const off = (await shell.call("plugins.install.prepare", {
      id: KV_ID,
      update: true,
    })) as Prepared;
    expect(off.update).toEqual({ from: "0.2.0", asksFor: [] });
    const committed = (await shell.call("plugins.install.commit", {
      candidate: off.candidate,
    })) as { version: string; enabled: boolean };
    expect([committed.version, committed.enabled]).toEqual(["0.3.0", false]);
    // it stays off: the card's own publication carries no flip into the doc
    await agreed(daemon, "0.3.0", false, "0.3.0, off, published and quiet");
    const outcomes = () => ledger(dataDir, ["plugin.update"]).filter((l) => l.phase === "outcome");
    await until(() => outcomes().length === 2, 4_000, "the two updates' outcomes");
    const versions = outcomes().map((l) => [l.outcome, (l.attrs as { version?: unknown }).version]);
    expect(versions).toEqual([
      ["succeeded", "0.2.0"],
      ["succeeded", "0.3.0"],
    ]);
    expect(outcomes().at(-1)?.attrs).toMatchObject({ revokedGrantCount: 0 });
  });

  // the review's fix (2026-11-14): the barrier takes the candidate's row read at the card's Update,
  // not the one read at its download
  it("a card's Update takes the plugin as it is then: turned on, or a power off and on", {
    timeout: 90_000,
  }, async () => {
    const releases = temp("vf-uc-releases-");
    const { dataDir, daemon, shell } = await shellOn([
      await kvRelease(releases, "0.3.0", ["net.outbound"]),
      await kvRelease(releases, "0.2.0", ["net.outbound"]),
      await kvRelease(releases, "0.1.0"),
    ]);
    const active = () => serviceActive(daemon);
    await shell.call("plugins.install", { id: KV_ID, version: "0.1.0" });
    await until(active, 15_000, "0.1.0's service");
    // item 440: each person's act here waits until the act before it is published and walked
    await agreed(daemon, "0.1.0", true, "0.1.0's publication, applied and quiet");

    // turned off, the one press is refused an update that asks for more as it is when on (the
    // review's nit 4: this road changed from the compatibility wrapper), and nothing moves
    await shell.call("plugins.disable", { id: KV_ID });
    await agreed(daemon, "0.1.0", false, "the disable, published and quiet");
    const pressed = await shell.callErr("plugins.install", { id: KV_ID, version: "0.2.0" });
    expect(pressed.data).toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { reasonCode: UPDATE_ASKS_MORE },
    });
    expect(daemon.plugins.get(KV_ID)?.version).toBe("0.1.0");

    // off when its card is read, on again before its Update: the barrier starts 0.2.0's service
    const first = (await shell.call("plugins.install.prepare", {
      id: KV_ID,
      version: "0.2.0",
      update: true,
    })) as Prepared;
    expect(first.update).toEqual({ from: "0.1.0", asksFor: ["net.outbound"] });
    await shell.call("plugins.enable", { id: KV_ID });
    await agreed(daemon, "0.1.0", true, "the enable, published and quiet");
    await until(active, 15_000, "0.1.0's service, on again");
    const taken = (await shell.call("plugins.install.commit", {
      candidate: first.candidate,
    })) as { version: string; enabled: boolean };
    expect([taken.version, taken.enabled]).toEqual(["0.2.0", true]);
    expect(daemon.plugins.get(KV_ID)?.grantedCapabilities).toContain("net.outbound");
    await until(active, 15_000, "0.2.0's service");

    // a power turned off and on again while the next card waits: its grants moved twice
    const second = (await shell.call("plugins.install.prepare", {
      id: KV_ID,
      update: true,
    })) as Prepared;
    expect(second.update).toEqual({ from: "0.2.0", asksFor: [] });
    await agreed(daemon, "0.2.0", true, "0.2.0's publication, applied and quiet");
    const generation = daemon.plugins.get(KV_ID)?.grantGeneration ?? 0;
    const storage = { id: KV_ID, capability: "storage.self" };
    await shell.call("plugins.grants.set", { ...storage, granted: false });
    await shell.call("plugins.grants.set", { ...storage, granted: true });
    // Item 437: the install reconciler can replay this desktop's own earlier "off"
    // (`plugins.grants.set` publishes its decision unawaited; `install-reconciler.ts` applies a
    // doc decision the record does not match), so the generation can move more than twice and the
    // grant can flicker before it settles. This row holds what the product promises, and no number
    // the race decides: once the grants are quiet, the last decision stands and the generation
    // moved at least twice. The read row showed it (lanes/mk/fix-uc2/row-ucdiag.sh): generation
    // 3 with the power off when the last on returned, then 4 and on again within 2 s. So the wait
    // ends only when it is on and quiet. If the race ever leaves the grant off after the last on,
    // this row goes red, and that red is item 437's, not the test's.
    const granted = () =>
      daemon.plugins.get(KV_ID)?.grantedCapabilities.includes("storage.self") === true;
    await settled(() => grantState(daemon), granted, 500, 15_000, "the two grants, on and quiet");
    expect(daemon.plugins.get(KV_ID)?.grantedCapabilities).toContain("storage.self");
    expect(daemon.plugins.get(KV_ID)?.grantGeneration ?? 0).toBeGreaterThanOrEqual(generation + 2);
    await until(active, 15_000, "0.2.0's service after the two grants");
    const next = (await shell.call("plugins.install.commit", {
      candidate: second.candidate,
    })) as { version: string };
    expect(next.version).toBe("0.3.0");
    expect(daemon.plugins.get(KV_ID)?.grantedCapabilities).toContain("storage.self");
    await until(active, 15_000, "0.3.0's service");

    const outcomes = () => ledger(dataDir, ["plugin.update"]).filter((l) => l.phase === "outcome");
    await until(() => outcomes().length === 3, 4_000, "the press's and the two cards' outcomes");
    expect(outcomes().map((l) => l.outcome)).toEqual(["failed", "succeeded", "succeeded"]);
    const versions = outcomes()
      .slice(1)
      .map((l) => (l.attrs as { version?: unknown }).version);
    expect(versions).toEqual(["0.2.0", "0.3.0"]);
  });

  // the review's fix (2026-11-14): another version taken while a card waits (DESIGN.md §9)
  it("a card whose plugin changed before its Update changes nothing", {
    timeout: 60_000,
  }, async () => {
    const releases = temp("vf-uc-releases-");
    const { dataDir, daemon, shell } = await shellOn([
      await kvRelease(releases, "0.2.0", ["net.outbound"]),
      await kvRelease(releases, "0.1.5"),
      await kvRelease(releases, "0.1.0"),
    ]);
    const pointer = join(dataDir, "plugins", "installed", KV_ID, PLUGIN_CURRENT_POINTER_FILE);
    const active = () => serviceActive(daemon);
    await shell.call("plugins.install", { id: KV_ID, version: "0.1.0" });
    await until(active, 15_000, "0.1.0's service");
    await agreed(daemon, "0.1.0", true, "0.1.0's publication, applied and quiet");

    // a card for 0.2.0 waits while the one press takes 0.1.5, which asks for nothing new
    const card = (await shell.call("plugins.install.prepare", {
      id: KV_ID,
      version: "0.2.0",
      update: true,
    })) as Prepared;
    expect(card.update).toEqual({ from: "0.1.0", asksFor: ["net.outbound"] });
    await shell.call("plugins.install", { id: KV_ID, version: "0.1.5" });
    await until(active, 15_000, "0.1.5's service");
    const selected = readFileSync(pointer, "utf8");
    expect(revisions(dataDir, KV_ID)).toContain(card.record.installRevision);

    // its Update: the reason code, the download thrown away, the pointer and the service unmoved
    const refused = await shell.callErr("plugins.install.commit", { candidate: card.candidate });
    const words = "This plugin changed before you pressed Update. Press Update again.";
    expect(refused.message).toBe(words);
    expect(refused.data).toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: { reasonCode: UPDATE_CARD_MOVED },
    });
    expect(daemon.plugins.get(KV_ID)?.version).toBe("0.1.5");
    expect(readFileSync(pointer, "utf8")).toBe(selected);
    expect(revisions(dataDir, KV_ID)).not.toContain(card.record.installRevision);
    expect(active()).toBe(true);

    const outcomes = () => ledger(dataDir, ["plugin.update"]).filter((l) => l.phase === "outcome");
    await until(() => outcomes().length === 2, 4_000, "the press's and the card's outcomes");
    expect(outcomes().map((l) => l.outcome)).toEqual(["succeeded", "failed"]);
  });
});
