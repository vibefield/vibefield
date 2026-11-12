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
import { LAYOUT, SOCKETS, validatePluginManifest } from "@vibefield/contracts";
import {
  buildFixtureRegistry,
  generateRegistryKeypair,
  packVfplugin,
} from "@vibefield/plugin-build";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AuditWriterTestHooks } from "../src/audit-service";
import { bootstrap } from "../src/index";
import { PLUGIN_CURRENT_POINTER_FILE } from "../src/plugin-artifact-store";
import { type PreparedRegistryInstall, RegistryInstallService } from "../src/plugin-install";
import { INSTALL_CARD_TTL_MS, InstallCards } from "../src/plugin-install-cards";
import { manifestHashOf, PluginRegistryService } from "../src/plugin-registry";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { type CapturedLog, captureLogger } from "./drive-fakes";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

// MK-O2 (2026-11-12) — the install card's doors, and the manifest they hold the card to
// (mk-o2/PLAN.md and its addendum on item 322). Every registry here is the test's own: the real
// example plugin packed into an index the test builds and signs with a key it makes, read over
// file://, in temp roots it removes. A manifest is rewritten only inside the test's own temp root.
// No network, no real data dir, no child.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const HERE = dirname(fileURLToPath(import.meta.url));
const KV_DIR = join(HERE, "..", "..", "..", "examples", "plugins", "kv-service");
const KV_ID = "vibefield.example.kv";
const MISMATCH = { pluginKind: "PLUGIN_ARTIFACT_MISMATCH" };

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The test's own registry: the example plugin as VibeField's own (rung R1), so the community
 * gate is not met. */
async function registry() {
  const dir = temp("vf-card-registry-");
  const { bytes } = await packVfplugin({ rootDir: KV_DIR });
  const keys = generateRegistryKeypair();
  buildFixtureRegistry({
    dir,
    secretKey: keys.secretKey,
    plugins: [{ manifestDir: KV_DIR, artifactBytes: bytes, rung: "R1" }],
  });
  return { url: pathToFileURL(join(dir, "index.json")).href, keys };
}

async function installerFor(reg: Awaited<ReturnType<typeof registry>>, logs: CapturedLog[] = []) {
  const dataDir = temp("vf-card-data-");
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
    logger: captureLogger(logs),
  });
  return { installedRoot, plugins, installer };
}

/** The example's manifest in a candidate's slot, rewritten in place (this test's own temp root):
 * the same id and version, another title. */
function rewriteManifest(root: string): void {
  const path = join(root, "vibefield.plugin.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  manifest.title = "Not what the card showed";
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

const mismatches = (logs: CapturedLog[]) =>
  logs.filter((l) => l.event === "fieldd.plugin_install.card_mismatch").map((l) => l.attrs);

describe("the install card's manifest (MK-O2)", () => {
  it("prepare answers the row of the manifest the signed list pins, and moves no pointer", async () => {
    const reg = await registry();
    const { installer, plugins, installedRoot } = await installerFor(reg);
    const candidate = await installer.prepare({ id: KV_ID });
    const own = validatePluginManifest(
      JSON.parse(readFileSync(join(KV_DIR, "vibefield.plugin.json"), "utf8")),
    );
    if (!own.ok) throw new Error("the example's own manifest does not validate");
    expect(candidate.pinnedManifestHash).toBe(manifestHashOf(own.manifest));
    expect(candidate.runtime.record.manifestHash).toBe(candidate.pinnedManifestHash);
    expect(candidate.runtime.record.requestedCapabilities).toEqual(own.manifest.capabilities);
    expect(candidate.runtime.record.contributions.objects).toEqual(
      own.manifest.contributes?.objects ?? [],
    );
    expect(existsSync(join(installedRoot, KV_ID, PLUGIN_CURRENT_POINTER_FILE))).toBe(false);
    expect(plugins.get(KV_ID)).toBeUndefined();
  });

  it("2′: refuses at prepare a row read from a manifest rewritten after the stage, and throws it away", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    const { installer, plugins, installedRoot } = await installerFor(reg, logs);
    let slot: string | undefined;
    const inspect = plugins.inspectRegistryCandidate.bind(plugins);
    plugins.inspectRegistryCandidate = async (input) => {
      slot = input.root;
      rewriteManifest(input.root);
      return await inspect(input);
    };
    await expect(installer.prepare({ id: KV_ID })).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: MISMATCH,
    });
    // the event names the card's own check, whichever tree the stage's comparison is on
    expect(mismatches(logs)).toEqual([{ pluginId: KV_ID, at: "prepare" }]);
    expect(slot).toBeDefined();
    expect(existsSync(slot ?? "")).toBe(false);
    expect(existsSync(join(installedRoot, KV_ID, PLUGIN_CURRENT_POINTER_FILE))).toBe(false);
  });

  it("3: refuses at commit a manifest rewritten after prepare, before the pointer moves", async () => {
    const reg = await registry();
    const logs: CapturedLog[] = [];
    const { installer, plugins, installedRoot } = await installerFor(reg, logs);
    const candidate = await installer.prepare({ id: KV_ID });
    rewriteManifest(candidate.artifact.root);
    await expect(installer.commit(candidate)).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      details: MISMATCH,
    });
    expect(mismatches(logs)).toEqual([{ pluginId: KV_ID, at: "commit" }]);
    expect(existsSync(join(installedRoot, KV_ID, PLUGIN_CURRENT_POINTER_FILE))).toBe(false);
    expect(await installer.discard(candidate)).toBe(true);
    await plugins.refresh();
    expect(plugins.get(KV_ID)).toBeUndefined();
  });
});

/** A stand-in for a prepared candidate: the holder reads its id and its slot alone. */
const stand = (id: string, slot: string) =>
  ({ id, artifact: { slot } }) as unknown as PreparedRegistryInstall;

describe("the waiting cards (MK-O2)", () => {
  it("throws a download away after fifteen minutes, and the handle then holds nothing", async () => {
    vi.useFakeTimers();
    cleanup.push(() => {
      vi.useRealTimers();
    });
    const thrown: string[] = [];
    const cards = new InstallCards(async (p) => {
      thrown.push(p.artifact.slot);
      return true;
    });
    const handle = await cards.hold(stand(KV_ID, "slot-a"));
    expect(handle).toMatch(/^[0-9a-f]{32}$/);
    await vi.advanceTimersByTimeAsync(INSTALL_CARD_TTL_MS - 1);
    expect(thrown).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(thrown).toEqual(["slot-a"]);
    expect(cards.take(handle)).toBeUndefined();
  });

  it("a second card for a plugin drops the first, throwing it away unless they share a slot", async () => {
    const thrown: string[] = [];
    const cards = new InstallCards(async (p) => {
      thrown.push(p.artifact.slot);
      return true;
    });
    const first = await cards.hold(stand(KV_ID, "slot-a"));
    const second = await cards.hold(stand(KV_ID, "slot-a"));
    expect(thrown).toEqual([]);
    expect(cards.take(first)).toBeUndefined();
    const third = await cards.hold(stand(KV_ID, "slot-b"));
    expect(thrown).toEqual(["slot-a"]);
    expect(cards.take(second)).toBeUndefined();
    expect(cards.take(third)?.artifact.slot).toBe("slot-b");
    expect(cards.take(third)).toBeUndefined();
  });
});

/** fieldd booted on the test's own data dir and registry (a mock native plane, no child), and the
 * shell's own connection to it. */
async function shellOn(
  reg: Awaited<ReturnType<typeof registry>>,
  auditTestHooks?: AuditWriterTestHooks,
) {
  const dataDir = temp("vf-card-door-");
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
    ...(auditTestHooks !== undefined ? { auditTestHooks } : {}),
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

type Prepared = { candidate: string; record: { id: string; manifestHash: string } };

describe("the install card's doors (MK-O2)", () => {
  it("prepare, discard and commit; a gone handle and an installed id refused; audited with no token", async () => {
    const { dataDir, daemon, shell } = await shellOn(await registry());

    // prepare answers a handle and the row; nothing is installed. Discard throws it away, once.
    const first = (await shell.call("plugins.install.prepare", { id: KV_ID })) as Prepared;
    expect(first.candidate).toMatch(/^[0-9a-f]{32}$/);
    expect(first.record.id).toBe(KV_ID);
    expect(daemon.plugins.get(KV_ID)).toBeUndefined();
    const cancel = { candidate: first.candidate };
    expect(await shell.call("plugins.install.discard", cancel)).toEqual({ discarded: true });
    expect(await shell.call("plugins.install.discard", cancel)).toEqual({ discarded: false });
    const gone = await shell.callErr("plugins.install.commit", cancel);
    expect(gone.data?.kind).toBe("NOT_FOUND");
    expect(daemon.plugins.get(KV_ID)).toBeUndefined();

    // commit installs what the card showed; then the installed id is refused at prepare
    const second = (await shell.call("plugins.install.prepare", { id: KV_ID })) as Prepared;
    const installed = (await shell.call("plugins.install.commit", {
      candidate: second.candidate,
    })) as { id: string; manifestHash: string };
    expect([installed.id, installed.manifestHash]).toEqual([KV_ID, second.record.manifestHash]);
    expect(daemon.plugins.get(KV_ID)?.manifestHash).toBe(second.record.manifestHash);
    const again = await shell.callErr("plugins.install.prepare", { id: KV_ID });
    expect(again.data?.kind).toBe("PRECONDITION_FAILED");

    // each door's ledger lines: ids, fields and reason codes, never a token
    const actions = ["plugin.install.prepare", "plugin.install", "plugin.install.cancel"];
    const ledger = () => {
      const dir = join(dataDir, ...LAYOUT.AUDIT_DIR);
      if (!existsSync(dir)) return [] as Array<Record<string, unknown>>;
      return readdirSync(dir)
        .filter((f) => f.startsWith("plugins.") && f.endsWith(".jsonl"))
        .flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((l) => actions.includes(String(l.action)));
    };
    // seven asks (three prepares, two discards, two commits), each an attempt and an outcome
    await until(() => ledger().filter((l) => l.phase === "outcome").length === 7);
    const outcomes = ledger().filter((l) => l.phase === "outcome");
    expect(outcomes.map((l) => [l.action, l.outcome])).toEqual([
      ["plugin.install.prepare", "succeeded"],
      ["plugin.install.cancel", "succeeded"],
      ["plugin.install.cancel", "succeeded"],
      ["plugin.install", "failed"],
      ["plugin.install.prepare", "succeeded"],
      ["plugin.install", "succeeded"],
      ["plugin.install.prepare", "failed"],
    ]);
    // a boolean, so a red prints no token (rule 18)
    expect(JSON.stringify(ledger()).includes(daemon.shellToken)).toBe(false);
  });

  it("an attempt row that cannot be written leaves the card waiting: the same card installs after", async () => {
    let failWrites = false;
    const { daemon, shell } = await shellOn(await registry(), {
      beforeWrite: () => {
        if (failWrites) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      },
    });
    const { candidate } = (await shell.call("plugins.install.prepare", { id: KV_ID })) as Prepared;

    // both doors refused before any effect: nothing installed, nothing thrown away
    failWrites = true;
    for (const door of ["plugins.install.commit", "plugins.install.discard"]) {
      const refused = await shell.callErr(door, { candidate });
      expect(refused.data, door).toMatchObject({
        kind: "AUDIT_UNAVAILABLE",
        details: { actionApplied: false },
      });
    }
    expect(daemon.plugins.get(KV_ID)).toBeUndefined();

    failWrites = false;
    const installed = (await shell.call("plugins.install.commit", { candidate })) as { id: string };
    expect(installed.id).toBe(KV_ID);
    expect(daemon.plugins.get(KV_ID)?.id).toBe(KV_ID);
  });
});
