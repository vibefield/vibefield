import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PluginRegistryService } from "../src/plugin-registry";

// PLUG-P6 — §15.2 grant calculation + §15.4 generations + §18.5 reload, at the
// registry level (the live cascade — lease revocation, connection drops — is
// the daemon's, covered by the kill-matrix e2e).

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

const ID = "vibefield.fixture.grants";

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id: ID,
    version: "1.0.0",
    title: "Grants fixture",
    engines: { app: "*", contracts: "*" },
    entries: { service: "./service.js" },
    activation: ["onStartup"],
    backgroundReason: "test fixture",
    capabilities: ["services.provide", "background", "storage.self", "shell.clipboard"],
    contributes: {
      services: [
        {
          namespace: `x.${ID}`,
          methods: [
            {
              name: "ping",
              kind: "query",
              requiredCapability: "workspace.read",
              idempotent: true,
              locality: "local",
              input: {},
              output: {},
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

async function setup(m: Record<string, unknown> = manifest()): Promise<{
  registry: PluginRegistryService;
  dataDir: string;
  pluginDir: string;
}> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-grants-"));
  const root = mkdtempSync(join(tmpdir(), "vf-grants-root-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const pluginDir = join(root, "fixture");
  mkdirSync(pluginDir);
  writeFileSync(join(pluginDir, "vibefield.plugin.json"), JSON.stringify(m));
  const registry = new PluginRegistryService({
    dataDir,
    roots: { bundled: [], devLinked: [root] },
  });
  cleanup.push(() => registry.dispose());
  await registry.refresh();
  return { registry, dataDir, pluginDir };
}

describe("grant calculation (§15.2)", () => {
  it("entry-kind eligibility thins grants and surfaces denials honestly", async () => {
    const { registry } = await setup();
    const row = registry.get(ID);
    expect(row?.state).toBe("enabled");
    // shell.clipboard is renderer-only; this manifest is service-only
    expect(row?.grantedCapabilities).toEqual(["services.provide", "background", "storage.self"]);
    expect(row?.deniedCapabilities).toEqual([
      { capability: "shell.clipboard", reason: "entry-kind" },
    ]);
    expect(row?.grantGeneration).toBe(0);
  });

  it("setGrant revokes, persists across refresh, and bumps the generation", async () => {
    const { registry } = await setup();
    const { record, changed } = await registry.setGrant(ID, "storage.self", false);
    expect(changed).toBe(true);
    expect(record.grantedCapabilities).toEqual(["services.provide", "background"]);
    expect(record.deniedCapabilities).toContainEqual({
      capability: "storage.self",
      reason: "revoked",
    });
    expect(record.grantGeneration).toBe(1);
    // idempotent re-set: no movement, no generation bump
    const again = await registry.setGrant(ID, "storage.self", false);
    expect(again.changed).toBe(false);
    expect(again.record.grantGeneration).toBe(1);
    // the decision is device-local persisted state — a §9.2 re-scan keeps it
    await registry.refresh();
    expect(registry.get(ID)?.grantedCapabilities).toEqual(["services.provide", "background"]);
    expect(registry.get(ID)?.grantGeneration).toBe(1);
    // re-grant restores
    const back = await registry.setGrant(ID, "storage.self", true);
    expect(back.changed).toBe(true);
    expect(back.record.grantedCapabilities).toContain("storage.self");
    expect(back.record.grantGeneration).toBe(2);
  });

  it("refuses decisions on capabilities the manifest never requested", async () => {
    const { registry } = await setup();
    await expect(registry.setGrant(ID, "canvas.write", true)).rejects.toThrowError(
      /does not request/,
    );
  });

  it("enable never resurrects a revoked capability (§15.2 through one algorithm)", async () => {
    const { registry } = await setup();
    await registry.setGrant(ID, "storage.self", false);
    await registry.disable(ID);
    expect(registry.get(ID)?.grantedCapabilities).toEqual([]);
    await registry.enable(ID);
    expect(registry.get(ID)?.grantedCapabilities).toEqual(["services.provide", "background"]);
  });
});

describe("developer reload (§18.5)", () => {
  it("validate-then-apply swaps the row; the id may not change", async () => {
    const { registry, pluginDir } = await setup();
    writeFileSync(
      join(pluginDir, "vibefield.plugin.json"),
      JSON.stringify(manifest({ version: "1.1.0" })),
    );
    const candidate = await registry.validateReload(ID);
    expect(candidate.version).toBe("1.1.0");
    // live row untouched until apply
    expect(registry.get(ID)?.version).toBe("1.0.0");
    const applied = registry.applyReload(ID, candidate);
    expect(applied.version).toBe("1.1.0");
    // id change refused
    writeFileSync(
      join(pluginDir, "vibefield.plugin.json"),
      JSON.stringify(manifest({ id: "vibefield.fixture.other" })),
    );
    await expect(registry.validateReload(ID)).rejects.toThrowError(/may not change the plugin id/);
  });

  it("an invalid new manifest refuses and leaves the live version untouched", async () => {
    const { registry, pluginDir } = await setup();
    writeFileSync(join(pluginDir, "vibefield.plugin.json"), "{ not json");
    await expect(registry.validateReload(ID)).rejects.toThrowError(/live version untouched/);
    expect(registry.get(ID)?.state).toBe("enabled");
    expect(registry.get(ID)?.version).toBe("1.0.0");
  });

  it("durable widget schemas may only move forward", async () => {
    const widget = (schemaVersion: number) => ({
      type: `${ID}.card`,
      title: "Card",
      schemaVersion,
      surface: "dom",
      sizeMode: "fixed",
      defaultSize: { w: 100, h: 100 },
    });
    const withWidget = (v: number) =>
      manifest({
        entries: { renderer: "./renderer.js", service: "./service.js" },
        contributes: { widgets: [widget(v)] },
        activation: ["onStartup"],
      });
    const { registry, pluginDir } = await setup(withWidget(3));
    writeFileSync(join(pluginDir, "vibefield.plugin.json"), JSON.stringify(withWidget(2)));
    await expect(registry.validateReload(ID)).rejects.toThrowError(/regresses schemaVersion/);
    writeFileSync(join(pluginDir, "vibefield.plugin.json"), JSON.stringify(withWidget(4)));
    const ok = await registry.validateReload(ID);
    expect(ok.contributions.widgets[0]?.schemaVersion).toBe(4);
  });

  it("reload is dev-linked only", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-grants-b-"));
    const root = mkdtempSync(join(tmpdir(), "vf-grants-broot-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const dir = join(root, "fixture");
    mkdirSync(dir);
    writeFileSync(join(dir, "vibefield.plugin.json"), JSON.stringify(manifest()));
    const registry = new PluginRegistryService({
      dataDir,
      roots: { bundled: [root], devLinked: [] },
    });
    cleanup.push(() => registry.dispose());
    await registry.refresh();
    await expect(registry.validateReload(ID)).rejects.toThrowError(/dev-linked sources only/);
  });
});
