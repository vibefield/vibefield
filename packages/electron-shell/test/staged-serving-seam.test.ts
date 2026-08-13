import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_MODULE_SCHEME } from "@vibefield/contracts";
import { PluginModuleAuthority, PluginRegistryService } from "@vibefield/fieldd";
import { afterEach, describe, expect, it } from "vitest";
import { type AuthorizedModule, servePluginRequest } from "../src/main/plugin-protocol";

// P8b-3e — the seam the two P8b suites never met at (ESP §8.4).
//
// fieldd's authority suite mints tokens and never serves a byte; main's
// protocol suite serves bytes for a stubbed `authorize` and never mints. Both
// halves were green the whole time the join between them was untested, which is
// the shape a contract drift hides in. So this file wires the REAL authority's
// `resolve` into the REAL `servePluginRequest` over a REAL artifact on disk and
// asks what only the pair can answer: does a minted URL hand back the plugin's
// own bytes, and does §8.4's invalidation actually reach them?
//
// Nothing here is double'd — registry, authority, artifact and handler are all
// production code. The ONE thing this file cannot witness is Chromium importing
// what was served, because that needs a browser: `pnpm smoke:canvas` owns that
// row and reports "stagedPlugins":4 from a live renderer.

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

/** Known bytes, AUTHORED here rather than built — `pnpm test` must never depend
 * on `pnpm build`, and a byte-for-byte assertion needs bytes we chose. */
const MODULE_BYTES = 'export const marker = "p8b3e-module";\nexport default { marker };\n';
const STYLE_BYTES = ".p8b3e-seam { --marker: p8b3e-style; }\n";
const SECRET_BYTES = "PRIVATE KEY\n";

/** The manifest shape fieldd's authority suite builds its fixtures from
 * (plugin-modules.test.ts) — mirrored, since that helper is local to its file. */
function manifest(id: string): Record<string, unknown> {
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
  };
}

interface Seam {
  readonly authority: PluginModuleAuthority;
  readonly registry: PluginRegistryService;
  readonly id: string;
  /** Where the bytes actually live. The TEST's own view of the artifact — never
   * something main was told, so a row can distinguish "refused" from "gone". */
  readonly modulePath: string;
  readonly serve: (url: string) => Promise<{ response: Response; refusals: string[] }>;
}

/** A real plugin root, a real registry over it, the real authority on top, and
 * the real handler wired to that authority. */
async function seam(): Promise<Seam> {
  const root = mkdtempSync(join(tmpdir(), "seam-plugins-"));
  const dataDir = mkdtempSync(join(tmpdir(), "seam-data-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));

  const id = "vibefield.fixture.seam";
  const pluginDir = join(root, "seam");
  mkdirSync(join(pluginDir, "dist"), { recursive: true });
  writeFileSync(
    join(pluginDir, "vibefield.plugin.json"),
    `${JSON.stringify(manifest(id), null, 2)}\n`,
  );
  writeFileSync(join(pluginDir, "dist", "renderer.js"), MODULE_BYTES);
  writeFileSync(join(pluginDir, "dist", "renderer.css"), STYLE_BYTES);

  const registry = new PluginRegistryService({
    dataDir,
    roots: { bundled: [root], devLinked: [], installed: [] },
  });
  cleanup.push(() => registry.dispose());
  await registry.refresh();
  const authority = new PluginModuleAuthority({ plugins: registry });

  // THE SEAM, with no adapter in between: a resolution already IS an
  // AuthorizedModule (path + contentType), so a shape drift on either side has
  // to fail the typecheck rather than be papered over by a test's own glue.
  const serve = async (url: string): Promise<{ response: Response; refusals: string[] }> => {
    const refusals: string[] = [];
    const response = await servePluginRequest(url, {
      authorize: (token) => authority.resolve(token),
      onRefusal: (reason) => refusals.push(reason),
    });
    return { response, refusals };
  };

  return { authority, registry, id, modulePath: join(pluginDir, "dist", "renderer.js"), serve };
}

/** The one authorized row, or a failure that says so — `modules[0]` being
 * undefined is a broken fixture, not a passing assertion. */
async function moduleRow(authority: PluginModuleAuthority) {
  const { modules } = await authority.modules();
  const row = modules[0];
  if (row === undefined) throw new Error("the authority authorized no module");
  return row;
}

describe("staged serving, authority → protocol (ESP §8.4)", () => {
  it("serves the plugin's own bytes for a URL the authority minted", async () => {
    const { authority, serve } = await seam();
    const row = await moduleRow(authority);
    expect(row.moduleUrl.startsWith(`${PLUGIN_MODULE_SCHEME}://`)).toBe(true);

    const { response } = await serve(row.moduleUrl);
    expect(response.status).toBe(200);
    // Byte-for-byte, not "contains": the point of the seam is that the bytes
    // the renderer would import are the artifact's, unaltered in transit.
    expect(await response.text()).toBe(MODULE_BYTES);
    expect(response.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("serves the derived stylesheet as CSS over the same seam", async () => {
    const { authority, serve } = await seam();
    const row = await moduleRow(authority);
    expect(row.styleUrl).toBeDefined();

    const { response } = await serve(row.styleUrl ?? "");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(STYLE_BYTES);
    expect(response.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
  });

  it("refuses a well-formed token this authority never minted", async () => {
    const { serve } = await seam();
    const { response, refusals } = await serve(`${PLUGIN_MODULE_SCHEME}://${"a".repeat(32)}`);
    expect(response.status).toBe(404);
    expect(refusals).toEqual(["unauthorized"]);
  });

  it("DISABLE kills the bytes and enable mints a live URL — §8.4 through the protocol", async () => {
    const { authority, registry, id, modulePath, serve } = await seam();
    const before = await moduleRow(authority);
    expect((await serve(before.moduleUrl)).response.status).toBe(200);

    await registry.disable(id);
    const dead = await serve(before.moduleUrl);
    expect(dead.response.status).toBe(404);
    // The refusal is AUTHORIZATION, and the artifact is still exactly where it
    // was — so this row can only be measuring the generation move.
    expect(dead.refusals).toEqual(["unauthorized"]);
    expect(existsSync(modulePath)).toBe(true);
    expect((await authority.modules()).modules).toHaveLength(0);

    await registry.enable(id);
    const after = await moduleRow(authority);
    expect(after.moduleUrl).not.toBe(before.moduleUrl);
    const fresh = await serve(after.moduleUrl);
    expect(fresh.response.status).toBe(200);
    expect(await fresh.response.text()).toBe(MODULE_BYTES);
    // A URL that leaked while the plugin was enabled is not replayable after
    // the round trip: the old token never comes back.
    expect((await serve(before.moduleUrl)).response.status).toBe(404);
  });

  it("…and that control can fail: a main that REMEMBERED would serve the disabled plugin", async () => {
    // The sensitivity check for the row above. §8.4 lets main serve only from a
    // pre-authorized, generation-bound mapping, asked for per request — this is
    // what the "per request" buys. Swap the live authority for glue that caches
    // its first yes, hold every other input identical, and the disable stops
    // being enforced; so the 404 above is produced by the generation rebuild
    // rather than by anything incidental to disabling a plugin.
    const { authority, registry, id } = await seam();
    const row = await moduleRow(authority);
    const remembered = new Map<string, AuthorizedModule>();
    const authorize = async (token: string): Promise<AuthorizedModule | undefined> => {
      const cached = remembered.get(token);
      if (cached !== undefined) return cached;
      const resolved = await authority.resolve(token);
      if (resolved !== undefined) remembered.set(token, resolved);
      return resolved;
    };
    expect((await servePluginRequest(row.moduleUrl, { authorize })).status).toBe(200);

    await registry.disable(id);
    expect((await servePluginRequest(row.moduleUrl, { authorize })).status).toBe(200);
    // Same URL, same instant, same handler — only the wiring differs.
    const honest = await servePluginRequest(row.moduleUrl, {
      authorize: (token) => authority.resolve(token),
    });
    expect(honest.status).toBe(404);
  });

  it("REFUSES a module swapped for a symlink out of the root after minting (EL7)", async () => {
    // Main follows a link happily and MUST — containment needs the plugin root,
    // and main knowing a root would be main discovering plugins (§8.4); its own
    // suite pins that. So on this path the only thing between a same-uid
    // attacker and the renderer is the authority's realpath check, re-proven at
    // authorization time. Same token, same generation: only the bytes moved.
    const { authority, modulePath, serve } = await seam();
    const row = await moduleRow(authority);
    expect((await serve(row.moduleUrl)).response.status).toBe(200);

    const secretDir = mkdtempSync(join(tmpdir(), "seam-secret-"));
    cleanup.push(() => rmSync(secretDir, { recursive: true, force: true }));
    const secret = join(secretDir, "id_ed25519");
    writeFileSync(secret, SECRET_BYTES);
    rmSync(modulePath, { force: true });
    symlinkSync(secret, modulePath);

    const { response, refusals } = await serve(row.moduleUrl);
    expect(response.status).toBe(404);
    expect(refusals).toEqual(["unauthorized"]);
    expect(await response.text()).not.toContain("PRIVATE KEY");
  });
});
