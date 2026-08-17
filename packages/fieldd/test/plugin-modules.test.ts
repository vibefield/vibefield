import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PLUGIN_MODULE_SCHEME,
  type PluginManifestV1,
  type PluginRecord,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { PluginModuleAuthority } from "../src/plugin-modules";
import { type PluginRegistryCandidate, PluginRegistryService } from "../src/plugin-registry";

// P8b — the module authority, tested against ESP §8.4's clauses one at a time.
// The section is short and every sentence in it is a rule, so each gets a row:
// fieldd decides; the renderer gets a URL and never a path; main serves only
// what was pre-authorized under the current generation; and every URL dies on
// disable, reload, quarantine, or an install-revision change.

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

function manifest(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id,
    version: "0.1.0",
    title: id,
    engines: { app: ">=0.0.0", contracts: "^0.1.0" },
    entries: { renderer: "./dist/renderer.js" },
    activation: [],
    capabilities: [],
    contributes: {},
    ...extra,
  };
}

/** A plugin dir with a BUILT artifact — the P8a shape: dist/renderer.js plus
 * the stylesheet beside it. */
function writePlugin(root: string, dir: string, m: Record<string, unknown>, css = true): string {
  const pdir = join(root, dir);
  mkdirSync(join(pdir, "dist"), { recursive: true });
  writeFileSync(join(pdir, "vibefield.plugin.json"), `${JSON.stringify(m, null, 2)}\n`);
  writeFileSync(join(pdir, "dist", "renderer.js"), "export default {};\n");
  if (css) writeFileSync(join(pdir, "dist", "renderer.css"), ".x{}\n");
  return pdir;
}

async function fixture(css = true): Promise<{
  authority: PluginModuleAuthority;
  registry: PluginRegistryService;
  id: string;
}> {
  const root = mkdtempSync(join(tmpdir(), "plugmod-"));
  const dataDir = mkdtempSync(join(tmpdir(), "plugmod-data-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const id = "vibefield.fixture.staged";
  writePlugin(root, "staged", manifest(id), css);
  const registry = new PluginRegistryService({
    dataDir,
    roots: { bundled: [root], devLinked: [], installed: [] },
  });
  cleanup.push(() => registry.dispose());
  await registry.refresh();
  return { authority: new PluginModuleAuthority({ plugins: registry }), registry, id };
}

function registryRecord(
  id: string,
  slot: string,
  manifestHash: string,
  overrides: Partial<PluginRecord> = {},
): PluginRecord {
  return {
    id,
    version: "0.1.0",
    title: id,
    source: "registry",
    manifestHash,
    installRevision: slot,
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: [],
    grantedCapabilities: [],
    deniedCapabilities: [],
    grantGeneration: 0,
    contributions: {
      widgets: [],
      behaviors: [],
      commands: [],
      surfaces: [],
      capabilities: [],
    },
    renderer: "inactive",
    service: "none",
    registry: {
      indexRef: "file:///registry/index.json",
      artifactSha256: `sha256:${slot}`,
      publisher: "candidate-authority-test",
    },
    ...overrides,
  };
}

async function candidateFixture(): Promise<{
  authority: PluginModuleAuthority;
  oldRecord: PluginRecord;
  candidate: PluginRegistryCandidate;
  setCurrent(record: PluginRecord): void;
}> {
  const root = mkdtempSync(join(tmpdir(), "plugmod-candidate-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const id = "vibefield.fixture.candidate";
  const sharedManifest = manifest(id);
  const oldRoot = writePlugin(root, "old", sharedManifest);
  const candidateRoot = writePlugin(root, "candidate", sharedManifest);
  writeFileSync(join(oldRoot, "dist", "renderer.js"), "export const revision = 'old';\n");
  writeFileSync(join(candidateRoot, "dist", "renderer.js"), "export const revision = 'new';\n");
  const manifestHash = `sha256:${"c".repeat(64)}`;
  const oldRecord = registryRecord(id, "a".repeat(64), manifestHash);
  const candidateRecord = registryRecord(id, "b".repeat(64), manifestHash);
  let generation = 1;
  let current = oldRecord;
  const roots = new Map([
    [oldRecord.installRevision, oldRoot],
    [candidateRecord.installRevision, candidateRoot],
  ]);
  const plugins = {
    get(pluginId: string): PluginRecord | undefined {
      return pluginId === id ? current : undefined;
    },
    snapshot() {
      return { generation, plugins: [current], problems: [] };
    },
    rootPath(pluginId: string): string | undefined {
      return pluginId === id ? roots.get(current.installRevision) : undefined;
    },
  };
  return {
    authority: new PluginModuleAuthority({ plugins }),
    oldRecord,
    candidate: {
      record: candidateRecord,
      manifest: sharedManifest as PluginManifestV1,
      root: candidateRoot,
      artifactSha256: `sha256:${candidateRecord.installRevision}`,
    },
    setCurrent(record) {
      current = record;
      generation += 1;
    },
  };
}

describe("PluginModuleAuthority (ESP §8.4)", () => {
  it("hands the renderer URLs on the plugin scheme and NO filesystem path", async () => {
    const { authority, id } = await fixture();
    const result = await authority.modules();
    const entry = result.modules.find((m) => m.pluginId === id);
    expect(entry).toBeDefined();
    expect(entry?.moduleUrl.startsWith(`${PLUGIN_MODULE_SCHEME}://`)).toBe(true);
    expect(entry?.styleUrl?.startsWith(`${PLUGIN_MODULE_SCHEME}://`)).toBe(true);
    // The clause with teeth: serialize the whole projection and prove no path
    // shape survives anywhere in it, rather than checking the fields we
    // remembered to look at.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("/dist/");
    expect(serialized).not.toContain(tmpdir());
    // …and it carries what ctx.plugin has been missing (§11.4).
    expect(entry?.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(entry?.installRevision.length).toBeGreaterThan(0);
  });

  it("resolves an authorized token to the bytes main may serve", async () => {
    const { authority, id } = await fixture();
    const { modules } = await authority.modules();
    const url = modules[0]?.moduleUrl ?? "";
    const token = url.slice(`${PLUGIN_MODULE_SCHEME}://`.length);
    const resolved = await authority.resolve(token);
    expect(resolved?.pluginId).toBe(id);
    expect(resolved?.contentType).toBe("text/javascript");
    expect(resolved?.path.endsWith(join("dist", "renderer.js"))).toBe(true);
  });

  it("refuses a token that was never minted", async () => {
    const { authority } = await fixture();
    expect(await authority.resolve("f".repeat(32))).toBeUndefined();
  });

  it("INVALIDATES every URL when the plugin is disabled — the §8.4 control", async () => {
    const { authority, registry, id } = await fixture();
    const { modules } = await authority.modules();
    const token = (modules[0]?.moduleUrl ?? "").slice(`${PLUGIN_MODULE_SCHEME}://`.length);
    expect(await authority.resolve(token)).toBeDefined();

    // Disabling moves the registry generation, which is the whole invalidation
    // mechanism: the old token is not revoked, it ceases to exist.
    await registry.disable(id);
    expect(await authority.resolve(token)).toBeUndefined();
    expect((await authority.modules()).modules).toHaveLength(0);

    // Re-enabling authorizes a FRESH token; the old one never comes back, so a
    // URL that leaked while enabled cannot be replayed after a disable/enable.
    await registry.enable(id);
    const after = await authority.modules();
    expect(after.modules).toHaveLength(1);
    const fresh = (after.modules[0]?.moduleUrl ?? "").slice(`${PLUGIN_MODULE_SCHEME}://`.length);
    expect(fresh).not.toBe(token);
    expect(await authority.resolve(token)).toBeUndefined();
  });

  it("REFUSES a token whose file became a symlink out of the plugin root (EL7)", async () => {
    // The mint-time check compares path STRINGS, so a same-uid process can
    // swap dist/renderer.js for a link AFTER a token is minted and the string
    // check would never notice. Electron main cannot catch this either —
    // catching it needs the plugin root, and main knowing a root would be main
    // discovering plugins (§8.4). So containment is re-proven on the
    // authorizing side at the moment the answer is given, and this is the
    // control for it: authorize once, plant the link, authorize again.
    const { authority, id } = await fixture();
    const { modules } = await authority.modules();
    const token = (modules[0]?.moduleUrl ?? "").slice(`${PLUGIN_MODULE_SCHEME}://`.length);
    const resolved = await authority.resolve(token);
    expect(resolved).toBeDefined();
    expect(resolved?.pluginId).toBe(id);

    const secretDir = mkdtempSync(join(tmpdir(), "plugmod-secret-"));
    cleanup.push(() => rmSync(secretDir, { recursive: true, force: true }));
    const secret = join(secretDir, "id_ed25519");
    writeFileSync(secret, "PRIVATE KEY\n");
    // Same token, same generation — only the bytes underneath moved.
    rmSync(resolved?.path ?? "", { force: true });
    symlinkSync(secret, resolved?.path ?? "");

    expect(await authority.resolve(token)).toBeUndefined();
  });

  it("authorizes no stylesheet when the plugin ships none", async () => {
    const { authority } = await fixture(false);
    const { modules } = await authority.modules();
    expect(modules[0]?.styleUrl).toBeUndefined();
  });

  it("authorizes nothing for a plugin that declares no renderer entry", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugmod-svc-"));
    const dataDir = mkdtempSync(join(tmpdir(), "plugmod-svc-data-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const pdir = join(root, "service-only");
    mkdirSync(pdir, { recursive: true });
    writeFileSync(
      join(pdir, "vibefield.plugin.json"),
      JSON.stringify(manifest("vibefield.fixture.svc", { entries: { service: "./service.js" } })),
    );
    writeFileSync(join(pdir, "service.js"), "export default {};\n");
    const registry = new PluginRegistryService({
      dataDir,
      roots: { bundled: [root], devLinked: [], installed: [] },
    });
    cleanup.push(() => registry.dispose());
    await registry.refresh();
    const authority = new PluginModuleAuthority({ plugins: registry });
    expect((await authority.modules()).modules).toHaveLength(0);
  });
});

describe("PluginModuleAuthority candidate episodes (PRC-5c)", () => {
  it("authorizes code-only candidate bytes without moving the live module set", async () => {
    const rig = await candidateFixture();
    const live = (await rig.authority.modules()).modules[0]!;
    const prepared = await rig.authority.prepareCandidate({
      updateId: "pupd_candidate_bytes",
      baseInstallRevision: rig.oldRecord.installRevision,
      candidate: rig.candidate,
    });
    expect(prepared.module).toBeDefined();
    expect(prepared.module?.manifestHash).toBe(live.manifestHash);
    expect(prepared.module?.installRevision).not.toBe(live.installRevision);
    expect(JSON.stringify(prepared.module)).not.toContain(rig.candidate.root);
    expect((await rig.authority.modules()).modules[0]?.installRevision).toBe(
      rig.oldRecord.installRevision,
    );

    const liveToken = live.moduleUrl.slice(`${PLUGIN_MODULE_SCHEME}://`.length);
    const candidateToken = prepared.module!.moduleUrl.slice(`${PLUGIN_MODULE_SCHEME}://`.length);
    expect((await rig.authority.resolve(liveToken))?.path).toContain(join("old", "dist"));
    expect((await rig.authority.resolve(candidateToken))?.path).toContain(
      join("candidate", "dist"),
    );
  });

  it("promotes only after the exact candidate row is current and then follows disable", async () => {
    const rig = await candidateFixture();
    const prepared = await rig.authority.prepareCandidate({
      updateId: "pupd_candidate_promote",
      baseInstallRevision: rig.oldRecord.installRevision,
      candidate: rig.candidate,
    });
    const token = prepared.module!.moduleUrl.slice(`${PLUGIN_MODULE_SCHEME}://`.length);
    expect(() => prepared.promote()).toThrow(/not current/);

    rig.setCurrent(rig.candidate.record);
    prepared.promote();
    expect(await rig.authority.resolve(token)).toBeDefined();

    rig.setCurrent({ ...rig.candidate.record, state: "disabled", enabled: false });
    expect(await rig.authority.resolve(token)).toBeUndefined();
    prepared.dispose();
  });

  it("revokes a prepared episode on same-artifact authority movement", async () => {
    const rig = await candidateFixture();
    const prepared = await rig.authority.prepareCandidate({
      updateId: "pupd_candidate_stale",
      baseInstallRevision: rig.oldRecord.installRevision,
      candidate: rig.candidate,
    });
    const token = prepared.module!.moduleUrl.slice(`${PLUGIN_MODULE_SCHEME}://`.length);
    rig.setCurrent({ ...rig.oldRecord, grantGeneration: 1 });

    expect(await rig.authority.resolve(token)).toBeUndefined();
    prepared.dispose();
    rig.setCurrent(rig.oldRecord);
    await expect(
      rig.authority.prepareCandidate({
        updateId: "pupd_candidate_retry",
        baseInstallRevision: rig.oldRecord.installRevision,
        candidate: rig.candidate,
      }),
    ).resolves.toBeDefined();
  });
});
