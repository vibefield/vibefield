import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstallSetEntry, RegistryListedAs } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditService } from "../src/audit-service";
import { InstallSetReconciler } from "../src/install-reconciler";
import { PluginArtifactStore } from "../src/plugin-artifact-store";
import type { RegistryInstallService } from "../src/plugin-install";
import { type CommunityGate, PluginRegistryService } from "../src/plugin-registry";
import type { SettingsDocService } from "../src/settings-doc";

// MK-O3, O3-C — the registry's hold (`mk-o3/PLAN-O3C.md`, accepted by VF-PM 2026-11-12 08:31:12Z;
// James's pick "Stop" on his docket, 2026-11-11 22:33:55Z, which the plugins page's store agrees
// with at 23:03:23Z). Every root here is the test's own temp folder: a bundled plugin, a
// development one, and two installs under the installed root, which the registry reads as plugins
// from the plugin list. Each install is published as VibeField's own install publishes one, a
// revision under its pointer: since item 279 (S2, M293) a folder with no pointer is not an install.
// No daemon, no network, no child.

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

const BUNDLED = "vibefield.fixture.bundled";
const DEV = "vibefield.fixture.dev";
const COMMUNITY = "acme.burndown";
const OURS = "vibefield.desk-things";

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writePlugin(root: string, id: string): void {
  writePluginAt(join(root, id), id);
}

/** The plugin's two files, written into `dir` itself. */
function writePluginAt(dir: string, id: string): void {
  mkdirSync(join(dir, "dist"), { recursive: true });
  const manifest = {
    manifestVersion: 1,
    id,
    version: "0.1.0",
    title: id,
    engines: { app: ">=0.0.0", contracts: "^0.1.0" },
    entries: { renderer: "./dist/renderer.js" },
    activation: [],
    capabilities: ["canvas.read"],
    contributes: {},
  };
  writeFileSync(join(dir, "vibefield.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, "dist", "renderer.js"), "export default {};\n");
}

/** An install under the installed root as the store publishes one: a marked revision and its
 * pointer, at epoch 1. The artifact's hash is the test's own; nothing here fetches or verifies. */
async function publishPlugin(installed: string, id: string, hex: string): Promise<void> {
  const store = new PluginArtifactStore(installed);
  const staged = await store.stage({
    pluginId: id,
    artifactSha256: `sha256:${hex.repeat(64)}`,
    prepare: async (root) => writePluginAt(root, id),
  });
  await store.commit(staged, null, 1);
}

/** The four roots and a registry over them; `communityHold` as the daemon sets it unless told
 * otherwise. */
async function fixture(opts: { communityHold?: boolean } = {}) {
  const dataDir = temp("vf-hold-data-");
  const bundled = temp("vf-hold-bundled-");
  const dev = temp("vf-hold-dev-");
  const installed = join(dataDir, "plugins", "installed");
  mkdirSync(installed, { recursive: true });
  writePlugin(bundled, BUNDLED);
  writePlugin(dev, DEV);
  await publishPlugin(installed, COMMUNITY, "a");
  await publishPlugin(installed, OURS, "b");
  const registry = new PluginRegistryService({
    dataDir,
    roots: { bundled: [bundled], devLinked: [dev], installed: [installed] },
    ...(opts.communityHold === false ? {} : { communityHold: true as const }),
  });
  cleanup.push(() => registry.dispose());
  const recordsPath = join(dataDir, "fieldd", "plugins", "install-records.json");
  return { registry, recordsPath };
}

const listed = (id: string): RegistryListedAs => (id === OURS ? "vibefield" : "community");
const closed: CommunityGate = async () => ({ allowed: false, listedAs: listed });
const open: CommunityGate = async () => ({ allowed: true });
/** A gate the test turns: closed until `state.allowed`. */
function turnable(state: { allowed: boolean }): CommunityGate {
  return async () => (state.allowed ? { allowed: true } : { allowed: false, listedAs: listed });
}

const shape = (registry: PluginRegistryService, id: string) => {
  const row = registry.get(id);
  return [row?.state, row?.enabled, row?.held, row?.grantedCapabilities, registry.isHeld(id)];
};
const HELD = ["disabled", false, "community-off", [], true];
const LOADED = ["enabled", true, undefined, ["canvas.read"], false];

describe("the registry holds plugins from the plugin list while community plugins are off (MK-O3, O3-C)", () => {
  it("with no gate set yet, holds every one; bundled and development plugins are never held", async () => {
    const { registry } = await fixture();
    await registry.refresh();
    expect(shape(registry, COMMUNITY)).toEqual(HELD);
    expect(shape(registry, OURS)).toEqual(HELD);
    expect(shape(registry, BUNDLED)).toEqual(LOADED);
    expect(shape(registry, DEV)).toEqual(LOADED);
  });

  it("a gate that does not allow them holds the community plugin and loads VibeField's own", async () => {
    const { registry } = await fixture();
    registry.setCommunityGate(closed);
    await registry.refresh();
    expect(shape(registry, COMMUNITY)).toEqual(HELD);
    expect(shape(registry, OURS)).toEqual(LOADED);
  });

  it("a gate that allows them holds nothing", async () => {
    const { registry } = await fixture();
    registry.setCommunityGate(open);
    await registry.refresh();
    expect(shape(registry, COMMUNITY)).toEqual(LOADED);
    expect(shape(registry, OURS)).toEqual(LOADED);
  });

  it("a gate that fails holds every one, for that refresh", async () => {
    const { registry } = await fixture();
    let fails = true;
    registry.setCommunityGate(async () => {
      if (fails) throw new Error("the switch could not be read");
      return { allowed: true };
    });
    await registry.refresh();
    expect(shape(registry, COMMUNITY)).toEqual(HELD);
    expect(shape(registry, OURS)).toEqual(HELD);
    fails = false;
    await registry.refresh();
    expect(shape(registry, COMMUNITY)).toEqual(LOADED);
  });

  it("a registry built without the hold holds nothing, as before", async () => {
    const { registry } = await fixture({ communityHold: false });
    await registry.refresh();
    expect(shape(registry, COMMUNITY)).toEqual(LOADED);
    expect(shape(registry, OURS)).toEqual(LOADED);
  });

  it("turning a held plugin on writes the wish and keeps it held; it loads when the hold lifts", async () => {
    const { registry, recordsPath } = await fixture();
    const state = { allowed: false };
    registry.setCommunityGate(turnable(state));
    await registry.refresh();
    await registry.disable(COMMUNITY);
    const enabled = await registry.enable(COMMUNITY);
    expect([enabled.enabled, enabled.state]).toEqual([false, "disabled"]);
    expect(shape(registry, COMMUNITY)).toEqual(HELD);
    const records = JSON.parse(readFileSync(recordsPath, "utf8")) as {
      plugins: Record<string, { enabled: boolean }>;
    };
    expect(records.plugins[COMMUNITY]?.enabled).toBe(true);
    state.allowed = true;
    await registry.refresh();
    expect(shape(registry, COMMUNITY)).toEqual(LOADED);
  });

  it("a plugin the person turned off stays off when the hold lifts", async () => {
    const { registry } = await fixture();
    const state = { allowed: false };
    registry.setCommunityGate(turnable(state));
    await registry.refresh();
    await registry.disable(COMMUNITY);
    state.allowed = true;
    await registry.refresh();
    const row = registry.get(COMMUNITY);
    expect([row?.state, row?.enabled, row?.held, registry.isHeld(COMMUNITY)]).toEqual([
      "disabled",
      false,
      undefined,
      false,
    ]);
  });

  it("a hold writes no record: refreshes that hold leave the records file unwritten", async () => {
    const { registry, recordsPath } = await fixture();
    await registry.refresh();
    registry.setCommunityGate(closed);
    await registry.refresh();
    await registry.refresh();
    expect(registry.isHeld(COMMUNITY)).toBe(true);
    expect(existsSync(recordsPath)).toBe(false);
  });
});

describe("a synced wish for a held plugin (MK-O3, O3-C)", () => {
  it("an 'on' from another desktop is not applied again while it is held; an 'off' is recorded", async () => {
    const { registry, recordsPath } = await fixture();
    registry.setCommunityGate(closed);
    await registry.refresh();
    let desired = true;
    const entry = (): InstallSetEntry => {
      const wish = { pluginId: COMMUNITY, source: "registry", enabled: desired, grants: [] };
      return wish as InstallSetEntry;
    };
    const acts: string[] = [];
    const reconciler = new InstallSetReconciler({
      settingsDoc: {
        installSet: async () => ({ [COMMUNITY]: entry() }),
        removedPlugins: async () => new Set<string>(),
      } as unknown as SettingsDocService,
      plugins: registry,
      installer: {} as unknown as RegistryInstallService,
      teardown: async () => undefined,
      restart: () => undefined,
      audit: {
        requiredSystem: async (mutation: { action: string }, effect: () => Promise<unknown>) => {
          acts.push(mutation.action);
          return effect();
        },
      } as unknown as Pick<AuditService, "requiredSystem">,
    });
    await reconciler.reconcile();
    await reconciler.reconcile();
    expect(acts).toEqual([]);
    expect(existsSync(recordsPath)).toBe(false);
    desired = false;
    await reconciler.reconcile();
    expect(acts).toEqual(["plugin.disable"]);
    expect(await registry.wantsEnabled(COMMUNITY)).toBe(false);
    expect(shape(registry, COMMUNITY)).toEqual(HELD);
  });

  it("a capability decided while it is held keeps the person's switch, never the hold's off", async () => {
    const state = { allowed: false };
    const { registry } = await fixture();
    registry.setCommunityGate(turnable(state));
    await registry.refresh();
    const { record } = await registry.setGrant(COMMUNITY, "canvas.read", false);
    expect([record.enabled, record.held, record.grantedCapabilities]).toEqual([
      false,
      "community-off",
      [],
    ]);
    expect(await registry.wantsEnabled(COMMUNITY)).toBe(true);
    state.allowed = true;
    await registry.refresh();
    const row = registry.get(COMMUNITY);
    expect([row?.state, row?.enabled, row?.grantedCapabilities]).toEqual(["enabled", true, []]);
    expect(row?.deniedCapabilities.map((d) => d.capability)).toEqual(["canvas.read"]);
  });
});
