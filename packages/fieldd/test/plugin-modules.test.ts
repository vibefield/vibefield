import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_MODULE_SCHEME } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { PluginModuleAuthority } from "../src/plugin-modules";
import { PluginRegistryService } from "../src/plugin-registry";

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
